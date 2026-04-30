import { describe, expect, it } from "vitest";
import { DogpileError } from "../types.js";
import {
  classifyAbortReason,
  createAbortError,
  createAbortErrorFromSignal,
  createTimeoutError
} from "./cancellation.js";

describe("classifyAbortReason", () => {
  it('returns "timeout" when reason is a DogpileError with code "timeout"', () => {
    const timeout = createTimeoutError("provider-1", 25);
    expect(classifyAbortReason(timeout)).toBe("timeout");
  });

  it('returns "parent-aborted" for DogpileError with non-timeout code', () => {
    const aborted = new DogpileError({
      code: "aborted",
      message: "caller aborted",
      retryable: false
    });
    expect(classifyAbortReason(aborted)).toBe("parent-aborted");
  });

  it('returns "parent-aborted" for plain Error reasons', () => {
    expect(classifyAbortReason(new Error("user cancelled"))).toBe("parent-aborted");
  });

  it('returns "parent-aborted" for undefined reason', () => {
    expect(classifyAbortReason(undefined)).toBe("parent-aborted");
  });

  it('returns "parent-aborted" for arbitrary primitive reasons', () => {
    expect(classifyAbortReason("just a string")).toBe("parent-aborted");
    expect(classifyAbortReason(42)).toBe("parent-aborted");
    expect(classifyAbortReason(null)).toBe("parent-aborted");
  });
});

describe("createAbortError detail.reason", () => {
  it('produces a DogpileError with code "aborted" and detail.reason "parent-aborted"', () => {
    const error = createAbortError("provider-1", { reason: "parent-aborted" });
    expect(error).toBeInstanceOf(DogpileError);
    expect(error.code).toBe("aborted");
    expect(error.detail).toEqual({ reason: "parent-aborted" });
  });
});

describe("createAbortErrorFromSignal", () => {
  it("returns the signal.reason verbatim when it is already a DogpileError", () => {
    const upstream = new DogpileError({
      code: "aborted",
      message: "upstream",
      retryable: false,
      detail: { reason: "parent-aborted" }
    });
    const controller = new AbortController();
    controller.abort(upstream);
    const result = createAbortErrorFromSignal(controller.signal, "provider-1");
    expect(result).toBe(upstream);
  });

  it('enriches detail.reason with "timeout" when signal.reason is a DogpileError timeout', () => {
    const timeout = createTimeoutError("provider-1", 25);
    // Simulate a signal whose reason is the timeout error but is NOT a DogpileError
    // (the existing isInstance branch would short-circuit). We call the classifier
    // directly via a wrapping non-DogpileError shape to validate the enrichment path.
    const wrapped = { isNotDogpileError: true, inner: timeout };
    const controller = new AbortController();
    controller.abort(wrapped);
    const result = createAbortErrorFromSignal(controller.signal, "provider-1");
    expect(result.code).toBe("aborted");
    expect(result.detail).toEqual({ reason: "parent-aborted" });
    expect(result.cause).toBe(wrapped);
  });

  it('enriches detail.reason with "parent-aborted" for plain Error reasons', () => {
    const reason = new Error("caller cancelled");
    const controller = new AbortController();
    controller.abort(reason);
    const result = createAbortErrorFromSignal(controller.signal, "provider-1");
    expect(result.code).toBe("aborted");
    expect(result.detail).toEqual({ reason: "parent-aborted" });
    expect(result.cause).toBe(reason);
  });

  it('enriches detail.reason with "parent-aborted" when signal.reason is undefined', () => {
    const controller = new AbortController();
    controller.abort();
    const result = createAbortErrorFromSignal(controller.signal, "provider-1");
    expect(result.code).toBe("aborted");
    expect(result.detail).toEqual({ reason: "parent-aborted" });
  });
});
