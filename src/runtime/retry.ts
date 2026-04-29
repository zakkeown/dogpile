import {
  DogpileError,
  type ConfiguredModelProvider,
  type DogpileErrorCode,
  type ModelOutputChunk,
  type ModelRequest,
  type ModelResponse
} from "../types.js";

/**
 * Default DogpileError codes that `withRetry` retries when no `retryOn`
 * predicate is supplied. These map to the transient provider failures listed
 * in `docs/developer-usage.md`.
 */
export const DEFAULT_RETRYABLE_DOGPILE_CODES: readonly DogpileErrorCode[] = [
  "provider-rate-limited",
  "provider-timeout",
  "provider-unavailable"
];

/** Reason passed to `onRetry` and used to drive jitter selection. */
export type RetryJitterMode = "full" | "none";

/**
 * Information about a single retry attempt that has just failed and is about
 * to sleep before the next attempt.
 */
export interface RetryAttemptInfo {
  /** 1-based index of the attempt that just failed. */
  readonly attempt: number;
  /** Maximum number of attempts the policy will make before giving up. */
  readonly maxAttempts: number;
  /** Sleep duration before the next attempt, in milliseconds. */
  readonly delayMs: number;
  /** The error thrown by the failing attempt. */
  readonly error: unknown;
  /** Provider id of the wrapped provider. */
  readonly providerId: string;
}

/**
 * Caller-supplied retry policy for `withRetry`.
 *
 * The defaults match the conservative, neutrality-preserving recipe in
 * `docs/developer-usage.md`. A caller that wants per-error custom logic
 * (e.g. honor a custom `Retry-After` header from a non-Dogpile error shape)
 * should pass `retryOn` and `delayForError`.
 */
export interface RetryPolicy {
  /** Maximum total attempts including the first call. Default: 3. */
  readonly maxAttempts?: number;
  /** Initial backoff delay in milliseconds. Default: 250. */
  readonly baseDelayMs?: number;
  /** Cap on the per-attempt backoff delay. Default: 4000. */
  readonly maxDelayMs?: number;
  /** Jitter strategy. `"full"` uses uniform jitter, `"none"` is deterministic. Default: "full". */
  readonly jitter?: RetryJitterMode;
  /**
   * Predicate deciding whether an error is retryable. Receives the raw error
   * thrown by the wrapped provider; returns `true` to retry, `false` to
   * propagate immediately. Default: matches `DEFAULT_RETRYABLE_DOGPILE_CODES`
   * for `DogpileError`, and treats `AbortError` / `DOMException(AbortError)` /
   * `DogpileError({ code: "aborted" })` as non-retryable.
   */
  readonly retryOn?: (error: unknown) => boolean;
  /**
   * Optional delay override for a specific error. Return a non-negative number
   * (ms) to override the computed backoff for the next attempt — used to
   * honor server-supplied `Retry-After` semantics. Returning `undefined`
   * keeps the computed backoff.
   */
  readonly delayForError?: (error: unknown) => number | undefined;
  /**
   * Side-effect callback invoked after each failing attempt that will be
   * retried. Useful for surfacing retries to a logger or metrics system
   * without wrapping the whole event stream.
   */
  readonly onRetry?: (info: RetryAttemptInfo) => void;
  /**
   * Random source for jitter, primarily for deterministic tests. Must return
   * a value in `[0, 1)`. Default: `Math.random`.
   */
  readonly random?: () => number;
  /**
   * Sleep implementation, primarily for deterministic tests. Default: a
   * `setTimeout`-backed promise that respects `AbortSignal`.
   */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const DEFAULTS = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  jitter: "full" as RetryJitterMode
};

/**
 * Wrap a `ConfiguredModelProvider` with a retry policy. The wrapper:
 *
 * - Preserves the provider `id` so traces remain stable.
 * - Retries `generate()` calls when the policy says the error is retryable.
 * - Propagates `AbortSignal` cancellation immediately — never retries after
 *   the caller cancels.
 * - Honors a `Retry-After`-style hint exposed via `error.detail.retryAfterMs`
 *   when present and the policy did not provide its own `delayForError`.
 * - Forwards `stream()` calls through unchanged — streaming retries cannot be
 *   safely automated because partial output may have already been observed.
 *
 * @example
 * ```ts
 * const robustProvider = withRetry(rawProvider, {
 *   maxAttempts: 4,
 *   baseDelayMs: 500,
 *   onRetry: ({ attempt, delayMs, error }) => {
 *     logger.warn("provider retry", { attempt, delayMs, error });
 *   }
 * });
 * ```
 */
export function withRetry(
  provider: ConfiguredModelProvider,
  policy: RetryPolicy = {}
): ConfiguredModelProvider {
  const settings = {
    maxAttempts: policy.maxAttempts ?? DEFAULTS.maxAttempts,
    baseDelayMs: policy.baseDelayMs ?? DEFAULTS.baseDelayMs,
    maxDelayMs: policy.maxDelayMs ?? DEFAULTS.maxDelayMs,
    jitter: policy.jitter ?? DEFAULTS.jitter,
    retryOn: policy.retryOn ?? defaultRetryOn,
    random: policy.random ?? Math.random,
    sleep: policy.sleep ?? defaultSleep
  };
  if (settings.maxAttempts < 1) {
    throw new DogpileError({
      code: "invalid-configuration",
      message: "withRetry: maxAttempts must be >= 1.",
      detail: { maxAttempts: settings.maxAttempts }
    });
  }
  if (settings.baseDelayMs < 0 || settings.maxDelayMs < 0) {
    throw new DogpileError({
      code: "invalid-configuration",
      message: "withRetry: delay fields must be non-negative.",
      detail: { baseDelayMs: settings.baseDelayMs, maxDelayMs: settings.maxDelayMs }
    });
  }

  const wrapped: ConfiguredModelProvider = {
    id: provider.id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      let lastError: unknown;
      for (let attempt = 1; attempt <= settings.maxAttempts; attempt++) {
        if (request.signal?.aborted) {
          throw abortReason(request.signal);
        }
        try {
          return await provider.generate(request);
        } catch (error) {
          lastError = error;
          if (isAbortError(error) || request.signal?.aborted) {
            throw error;
          }
          const isLastAttempt = attempt >= settings.maxAttempts;
          if (isLastAttempt || !settings.retryOn(error)) {
            throw error;
          }
          const delayMs = chooseDelay({ attempt, error, settings, policy });
          policy.onRetry?.({
            attempt,
            maxAttempts: settings.maxAttempts,
            delayMs,
            error,
            providerId: provider.id
          });
          await settings.sleep(delayMs, request.signal);
        }
      }
      // Unreachable in practice — the loop either returns or throws — but TS
      // needs an explicit fallthrough.
      throw lastError ?? new DogpileError({
        code: "unknown",
        message: "withRetry: exhausted attempts without throwing or returning."
      });
    }
  };

  if (typeof provider.stream === "function") {
    const upstreamStream = provider.stream.bind(provider);
    wrapped.stream = (request: ModelRequest): AsyncIterable<ModelOutputChunk> =>
      upstreamStream(request);
  }

  return wrapped;
}

function chooseDelay(args: {
  attempt: number;
  error: unknown;
  settings: { baseDelayMs: number; maxDelayMs: number; jitter: RetryJitterMode; random: () => number };
  policy: RetryPolicy;
}): number {
  const override = args.policy.delayForError?.(args.error) ?? retryAfterFromError(args.error);
  if (override !== undefined && Number.isFinite(override) && override >= 0) {
    return Math.min(args.settings.maxDelayMs, override);
  }
  const exponential = args.settings.baseDelayMs * 2 ** (args.attempt - 1);
  const capped = Math.min(args.settings.maxDelayMs, exponential);
  if (args.settings.jitter === "none") {
    return capped;
  }
  return Math.floor(capped * args.settings.random());
}

function defaultRetryOn(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (DogpileError.isInstance(error)) {
    if (error.code === "aborted" || error.code === "invalid-configuration") {
      return false;
    }
    return DEFAULT_RETRYABLE_DOGPILE_CODES.includes(error.code);
  }
  // Treat generic network/transient errors as retryable. Most fetch errors
  // surface as `TypeError` with messages like "fetch failed" / "network".
  if (error instanceof TypeError) return true;
  return false;
}

function isAbortError(error: unknown): boolean {
  if (DogpileError.isInstance(error) && error.code === "aborted") return true;
  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (name === "AbortError") return true;
  }
  return false;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DogpileError({ code: "aborted", message: "Request aborted." });
}

function retryAfterFromError(error: unknown): number | undefined {
  if (!DogpileError.isInstance(error)) return undefined;
  const detail = error.detail;
  if (!detail || typeof detail !== "object") return undefined;
  const candidate = (detail as { retryAfterMs?: unknown }).retryAfterMs;
  if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
    return candidate;
  }
  return undefined;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
