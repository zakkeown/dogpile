import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DogpileError } from "../index.js";
import type { DogpileError as DogpileErrorUnion, DogpileErrorCode } from "../index.js";

const documentedDogpileErrorCodes = [
  "invalid-configuration",
  "aborted",
  "timeout",
  "provider-authentication",
  "provider-invalid-request",
  "provider-invalid-response",
  "provider-not-found",
  "provider-rate-limited",
  "provider-timeout",
  "provider-unavailable",
  "provider-unsupported",
  "provider-error",
  "unknown"
] as const satisfies readonly DogpileErrorCode[];

type DocumentedDogpileErrorCode = (typeof documentedDogpileErrorCodes)[number];
type UndocumentedDogpileErrorCode = Exclude<DogpileErrorCode, DocumentedDogpileErrorCode>;

describe("public DogpileError API", () => {
  it("documents every exported DogpileError code in the reference handling table", () => {
    expectNoUndocumentedDogpileErrorCodes(true);

    const reference = readFileSync(new URL("../../docs/reference.md", import.meta.url), "utf8");
    expect(reference).toContain("## DogpileError Codes");

    for (const code of documentedDogpileErrorCodes) {
      expect(reference).toContain(`| \`${code}\` |`);
    }
  });

  it("constructs stable coded errors and exposes them as the typed public union", () => {
    const error = new DogpileError({
      code: "provider-rate-limited",
      message: "Provider quota was exceeded.",
      retryable: true,
      providerId: "vercel-ai:test",
      detail: {
        statusCode: 429
      }
    });

    const publicError: DogpileErrorUnion = error;

    expect(error).toBeInstanceOf(DogpileError);
    expect(DogpileError.isInstance(error)).toBe(true);
    expect(publicError.code).toBe("provider-rate-limited");
    expect(error.toJSON()).toEqual({
      name: "DogpileError",
      code: "provider-rate-limited",
      message: "Provider quota was exceeded.",
      retryable: true,
      providerId: "vercel-ai:test",
      detail: {
        statusCode: 429
      }
    });
    expect(classifyDogpileError(publicError)).toBe("retryable-provider");
  });

  it("locks the BUDGET-01 detail.reason vocabulary on code: aborted errors", () => {
    // BUDGET-01 / D-08: aborted errors carry `detail.reason: "parent-aborted"`
    // when the parent.signal aborted (BUDGET-01 lands "parent-aborted"; the
    // "timeout" half lands in BUDGET-02). Vocabulary is documented-convention
    // (no exported string-literal type union) but is observable through
    // `error.detail.reason` on the public error surface.
    const error = new DogpileError({
      code: "aborted",
      message: "The operation was aborted.",
      retryable: false,
      providerId: "budget-01-detail-reason-lock",
      detail: {
        reason: "parent-aborted"
      }
    });
    expect(error.code).toBe("aborted");
    expect(error.detail).toEqual({ reason: "parent-aborted" });
    expect(error.toJSON()).toEqual({
      name: "DogpileError",
      code: "aborted",
      message: "The operation was aborted.",
      retryable: false,
      providerId: "budget-01-detail-reason-lock",
      detail: {
        reason: "parent-aborted"
      }
    });
  });

  it("locks the BUDGET-02 detail.reason vocabulary on code: aborted errors (timeout)", () => {
    // BUDGET-02 / D-12: parent timeouts surface on the child as
    // `code: "aborted"` with `detail.reason: "timeout"`. This pairs with the
    // BUDGET-01 `parent-aborted` lock above to fully cover the documented
    // vocabulary on aborted errors.
    const error = new DogpileError({
      code: "aborted",
      message: "Parent deadline elapsed before sub-run dispatch.",
      retryable: false,
      providerId: "budget-02-detail-reason-lock",
      detail: {
        reason: "timeout"
      }
    });
    expect(error.code).toBe("aborted");
    expect(error.detail).toEqual({ reason: "timeout" });
    expect(error.toJSON()).toEqual({
      name: "DogpileError",
      code: "aborted",
      message: "Parent deadline elapsed before sub-run dispatch.",
      retryable: false,
      providerId: "budget-02-detail-reason-lock",
      detail: {
        reason: "timeout"
      }
    });
  });

  it("guards cross-realm error-shaped values with the stable code set", () => {
    expect(
      DogpileError.isInstance({
        name: "DogpileError",
        code: "timeout",
        message: "Timed out."
      })
    ).toBe(true);

    expect(
      DogpileError.isInstance({
        name: "DogpileError",
        code: "provider-overloaded",
        message: "Not part of the v1 code contract."
      })
    ).toBe(false);
  });
});

function classifyDogpileError(error: DogpileErrorUnion): "caller-cancelled" | "retryable-provider" | "other" {
  switch (error.code) {
    case "invalid-configuration":
      return "other";
    case "aborted":
      return "caller-cancelled";
    case "provider-rate-limited":
    case "provider-timeout":
    case "provider-unavailable":
      return "retryable-provider";
    case "timeout":
    case "provider-authentication":
    case "provider-invalid-request":
    case "provider-invalid-response":
    case "provider-not-found":
    case "provider-unsupported":
    case "provider-error":
    case "unknown":
      return "other";
  }

  const exhaustive: never = error;
  return exhaustive;
}

function expectNoUndocumentedDogpileErrorCodes(value: UndocumentedDogpileErrorCode extends never ? true : never): void {
  expect(value).toBe(true);
}
