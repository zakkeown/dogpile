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
