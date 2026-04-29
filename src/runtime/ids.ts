import { DogpileError } from "../types.js";

/**
 * Repo-internal id and timing helpers used across all four protocols.
 *
 * Centralized here so a change to id format or fallback semantics happens in
 * exactly one place — switching `protocol` must not change the run-id contract.
 */

/**
 * Generates a fresh run id using `globalThis.crypto.randomUUID`.
 *
 * Throws a `DogpileError` when no UUID source is available rather than falling
 * back to a millisecond-based id (which collides under back-to-back runs in
 * the same tick). Node 22+, Bun latest, and modern browsers all expose
 * `crypto.randomUUID`; environments without it are unsupported by Dogpile.
 */
export function createRunId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (typeof random === "string" && random.length > 0) {
    return random;
  }
  throw new DogpileError({
    code: "invalid-configuration",
    message:
      "Dogpile requires globalThis.crypto.randomUUID to mint a run id. " +
      "Run on Node 22+, Bun latest, or a modern browser ESM environment."
  });
}

export function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export function elapsedMs(startedAtMs: number): number {
  return Math.max(0, nowMs() - startedAtMs);
}

export function providerCallIdFor(runId: string, oneBasedIndex: number): string {
  return `${runId}:provider-call:${oneBasedIndex}`;
}
