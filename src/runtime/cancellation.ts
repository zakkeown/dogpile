import { DogpileError, type JsonObject } from "../types.js";

export function throwIfAborted(signal: AbortSignal | undefined, providerId: string): void {
  if (!signal?.aborted) {
    return;
  }

  throw createAbortErrorFromSignal(signal, providerId);
}

export function createAbortError(providerId: string, detail?: JsonObject, cause?: unknown): DogpileError {
  return new DogpileError({
    code: "aborted",
    message: "The operation was aborted.",
    retryable: false,
    providerId,
    ...(detail !== undefined ? { detail } : {}),
    ...(cause !== undefined ? { cause } : {})
  });
}

export function createAbortErrorFromSignal(signal: AbortSignal, providerId: string): DogpileError {
  if (DogpileError.isInstance(signal.reason)) {
    return signal.reason;
  }

  return createAbortError(providerId, undefined, signal.reason);
}

export function createTimeoutError(providerId: string, timeoutMs: number): DogpileError {
  return new DogpileError({
    code: "timeout",
    message: `The operation timed out after ${timeoutMs}ms.`,
    retryable: true,
    providerId,
    detail: {
      timeoutMs
    }
  });
}
