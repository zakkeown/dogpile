import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RETRYABLE_DOGPILE_CODES, withRetry, type RetryAttemptInfo } from "./retry.js";
import {
  DogpileError,
  type ConfiguredModelProvider,
  type ModelRequest,
  type ModelResponse
} from "../types.js";

const baseRequest: ModelRequest = {
  messages: [{ role: "user", content: "hi" }],
  temperature: 0,
  metadata: { runId: "retry-test" }
};

function rateLimited(): DogpileError {
  return new DogpileError({
    code: "provider-rate-limited",
    message: "rate limited",
    detail: { retryAfterMs: 0 }
  });
}

function makeProvider(generate: (req: ModelRequest) => Promise<ModelResponse>): ConfiguredModelProvider {
  return { id: "test-provider", generate };
}

describe("withRetry", () => {
  it("returns the first successful response without retrying", async () => {
    const generate = vi.fn(async () => ({ text: "ok" } as ModelResponse));
    const provider = withRetry(makeProvider(generate), { maxAttempts: 3, sleep: vi.fn() });
    const response = await provider.generate(baseRequest);
    expect(response.text).toBe("ok");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("retries retryable DogpileError codes up to maxAttempts", async () => {
    const generate = vi.fn();
    generate
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(rateLimited())
      .mockResolvedValueOnce({ text: "ok" } as ModelResponse);
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();
    const provider = withRetry(makeProvider(generate), {
      maxAttempts: 3,
      baseDelayMs: 10,
      jitter: "none",
      sleep,
      onRetry
    });
    const response = await provider.generate(baseRequest);
    expect(response.text).toBe("ok");
    expect(generate).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(2);
    const firstCall = onRetry.mock.calls[0]?.[0] as RetryAttemptInfo;
    expect(firstCall.attempt).toBe(1);
    expect(firstCall.providerId).toBe("test-provider");
  });

  it("propagates non-retryable errors immediately", async () => {
    const error = new DogpileError({ code: "invalid-configuration", message: "bad input" });
    const generate = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn();
    const provider = withRetry(makeProvider(generate), { maxAttempts: 3, sleep });
    await expect(provider.generate(baseRequest)).rejects.toThrow(error);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("propagates AbortError without retrying", async () => {
    const error = Object.assign(new Error("aborted"), { name: "AbortError" });
    const generate = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn();
    const provider = withRetry(makeProvider(generate), { maxAttempts: 3, sleep });
    await expect(provider.generate(baseRequest)).rejects.toThrow(error);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("short-circuits when AbortSignal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const generate = vi.fn();
    const provider = withRetry(makeProvider(generate), { maxAttempts: 3, sleep: vi.fn() });
    await expect(provider.generate({ ...baseRequest, signal: controller.signal })).rejects.toBeDefined();
    expect(generate).not.toHaveBeenCalled();
  });

  it("honors retryAfterMs from DogpileError detail when policy lacks delayForError", async () => {
    const generate = vi.fn();
    generate
      .mockRejectedValueOnce(new DogpileError({
        code: "provider-rate-limited",
        message: "rl",
        detail: { retryAfterMs: 750 }
      }))
      .mockResolvedValueOnce({ text: "ok" } as ModelResponse);
    const sleep = vi.fn(async () => {});
    const provider = withRetry(makeProvider(generate), {
      maxAttempts: 2,
      baseDelayMs: 10,
      maxDelayMs: 5_000,
      jitter: "none",
      sleep
    });
    await provider.generate(baseRequest);
    expect(sleep).toHaveBeenCalledWith(750, undefined);
  });

  it("caps overridden delay at maxDelayMs", async () => {
    const generate = vi.fn();
    generate
      .mockRejectedValueOnce(new DogpileError({
        code: "provider-rate-limited",
        message: "rl",
        detail: { retryAfterMs: 60_000 }
      }))
      .mockResolvedValueOnce({ text: "ok" } as ModelResponse);
    const sleep = vi.fn(async () => {});
    const provider = withRetry(makeProvider(generate), {
      maxAttempts: 2,
      baseDelayMs: 10,
      maxDelayMs: 1_000,
      jitter: "none",
      sleep
    });
    await provider.generate(baseRequest);
    expect(sleep).toHaveBeenCalledWith(1_000, undefined);
  });

  it("throws after exhausting all attempts", async () => {
    const error = rateLimited();
    const generate = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn(async () => {});
    const provider = withRetry(makeProvider(generate), {
      maxAttempts: 2,
      baseDelayMs: 1,
      jitter: "none",
      sleep
    });
    await expect(provider.generate(baseRequest)).rejects.toThrow(error);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("preserves provider id and forwards stream() unchanged", async () => {
    const stream = vi.fn(async function* () {
      yield { type: "text", text: "ab" } as never;
    });
    const provider = withRetry({
      id: "streamy",
      generate: async () => ({ text: "x" }),
      stream: stream as never
    }, { maxAttempts: 1, sleep: vi.fn() });
    expect(provider.id).toBe("streamy");
    const iterator = provider.stream!(baseRequest);
    for await (const _ of iterator) {
      // drain
    }
    expect(stream).toHaveBeenCalledOnce();
  });

  it("rejects invalid policy options", () => {
    const provider = makeProvider(async () => ({ text: "x" }));
    expect(() => withRetry(provider, { maxAttempts: 0 })).toThrow(/maxAttempts/);
    expect(() => withRetry(provider, { baseDelayMs: -1 })).toThrow(/non-negative/);
  });

  it("exposes the default retryable DogpileError codes", () => {
    expect([...DEFAULT_RETRYABLE_DOGPILE_CODES]).toEqual([
      "provider-rate-limited",
      "provider-timeout",
      "provider-unavailable"
    ]);
  });
});
