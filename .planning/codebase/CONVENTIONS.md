# Coding Conventions

**Analysis Date:** 2026-04-29

## Naming Patterns

**Files:**
- `kebab-case.ts` for all source files. Examples: `openai-compatible.ts`, `wrap-up.ts`, `deterministic-provider.ts`.
- Test files mirror their subject: `sequential.ts` → `sequential.test.ts` (co-located) or contract suites under `src/tests/<topic>.test.ts`.
- Repo-internal scripts use `.mjs` (e.g. `scripts/check-package-artifacts.mjs`), source is always `.ts`.

**Functions:**
- `camelCase` verbs. Public factories and entrypoints: `run`, `stream`, `createEngine`, `replay`, `createOpenAICompatibleProvider`, `createDeterministicModelProvider`.
- Termination factories use lowercase nouns matching the discriminant: `budget()`, `convergence()`, `judge()`, `firstOf()` (`src/runtime/termination.ts:32`).
- Internal helpers: `runSequential`, `evaluateTerminationStop`, `throwIfAborted`, `createAbortError`.
- Boolean predicates: `isParticipatingDecision`, `DogpileError.isInstance`.

**Variables:**
- `camelCase`. `readonly` arrays/objects on option types (`SequentialRunOptions`, `CoordinatorRunOptions`).
- Constants assembled from string literal tuples use `as const`: `const protocolNames = ["coordinator", "sequential", ...] as const;` (`src/runtime/validation.ts:18`).

**Types:**
- `PascalCase` for every exported type/interface: `DogpileOptions`, `RunResult`, `ConfiguredModelProvider`, `TerminationCondition`, `ReplayTraceProtocolDecision`.
- Discriminated unions discriminate on a string `kind` field (e.g. `BudgetTerminationCondition.kind === "budget"` — `src/runtime/termination.ts:32-36`).
- Stable string codes for cross-language consumers: `DogpileErrorCode` is a string-literal union (`src/types.ts:22-45`), not an enum.
- Type-only re-exports go through `export type { ... }` blocks in `src/index.ts`.

## Code Style

**Formatting:**
- No Prettier or Biome config in repo. Style is enforced by convention and `tsc`.
- Two-space indentation, double quotes, semicolons required (per `AGENTS.md` and `CLAUDE.md`).
- Trailing commas: not used in object literals or call sites (see `src/runtime/sequential.ts`, `src/runtime/termination.ts`).

**Linting:**
- No ESLint. `pnpm run lint` is an alias for `pnpm run typecheck` → `tsc -p tsconfig.json --noEmit`.
- `tsconfig.json` (`/Users/zakkeown/Code/dogpile/tsconfig.json`) enables `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. These are the de-facto lint rules.

## Import Organization

**Module syntax:**
- ESM only (`"type": "module"`). Every relative import uses an explicit `.js` extension even though source is `.ts`. Examples in `src/runtime/sequential.ts:20-42`:
  ```ts
  import type { ... } from "../types.js";
  import { addCost, ... } from "./defaults.js";
  import { throwIfAborted } from "./cancellation.js";
  ```
- `verbatimModuleSyntax` is on, so type-only imports MUST use `import type { ... }` (or inline `type` markers). Mixing values and types in one statement is not allowed.

**Order (observed):**
1. External packages (rare in `src/runtime/`; appears in tests as `import { describe, expect, it } from "vitest";`).
2. Type-only imports from `../types.js` grouped first.
3. Value imports from `./` (sibling modules in dependency order: defaults → cancellation → decisions → model → termination → tools → wrap-up).

**Path aliases:** None. All imports are relative.

**Public surface:**
- Single root export: `src/index.ts`. Subpath exports (`@dogpile/sdk/runtime/*`, `/types`, `/browser`, `/providers/openai-compatible`) are declared in `package.json` `exports` and validated by `src/tests/package-exports.test.ts` and `scripts/check-package-artifacts.mjs`.
- Repo-internal-only re-exports live in `src/internal.ts` (demo, benchmark, deterministic provider). Never list `internal.ts` in `package.json` files.

## Error Handling

**Single error class:**
- All public failures throw `DogpileError` (`src/types.ts:103-116`, constructor in `src/runtime/`). It is a discriminated union over a stable `code` string.
- Stable codes (part of the v1 contract): `invalid-configuration`, `aborted`, `timeout`, `provider-authentication`, `provider-invalid-request`, `provider-invalid-response`, `provider-not-found`, `provider-rate-limited`, `provider-timeout`, `provider-unavailable`, `provider-unsupported`, `provider-error`, `unknown`.

**Construction pattern (`src/runtime/cancellation.ts:11-20`):**
```ts
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
```
- Always include `code`, `message`, `retryable`, and `providerId` when known.
- Spread optional fields conditionally — required by `exactOptionalPropertyTypes`. Never assign `undefined` directly to an optional property.
- `detail` must be `JsonObject` (serializable for replay/logging).

**Detection:**
- Use `DogpileError.isInstance(value)` — never `instanceof` (`src/runtime/cancellation.ts:23`, `src/runtime/engine.ts:458, 853`).

**Validation:**
- Caller input is validated up front in `src/runtime/validation.ts` before any provider call. `validateDogpileOptions(options)` and `validateEngineOptions(options)` throw `DogpileError({ code: "invalid-configuration" })`.
- New caller-facing options must be validated here; tests live in `src/tests/config-validation.test.ts` and `src/tests/run-bad-input.test.ts`.

**Cancellation:**
- Every async path threads `AbortSignal`. Call `throwIfAborted(signal, providerId)` (`src/runtime/cancellation.ts:3`) at protocol-loop boundaries and before model calls.
- Aborts surface as `DogpileError({ code: "aborted" })`. If the signal already carries a `DogpileError` reason, reuse it.

## Logging

**Framework:** None. The runtime stays storage-free and dependency-free.

**Patterns:**
- Only `console.warn` is used, and only for protocol/termination misconfiguration (`src/runtime/termination.ts:185`). Even that is injectable: `warn: (message: string) => void = console.warn` so callers and tests can capture it.
- No `console.log`, no logger, no env reads. Observability is delivered through the `RunEvent` stream and the replayable trace.

## Comments

**JSDoc/TSDoc:**
- Every exported function, type, and class on the public surface gets a TSDoc block. See termination factories (`src/runtime/termination.ts:26-63`), error types (`src/types.ts:38-80`).
- Use `@remarks` for contract-level notes that affect callers (`src/types.ts:42-44`).
- Internal helpers may omit TSDoc when names are self-describing.

**When to comment:**
- Document public-API contracts (this drives `.d.ts` doc generation for consumers).
- Internal comments are sparse; prefer expressive names and small functions.

## Function Design

**Size:**
- Protocol orchestrators (`runSequential`, `runCoordinator`, `runShared`, `runBroadcast`) are long (300-700 lines) but linear and event-driven. They are the documented exception — keep helpers extracted (`recordProtocolDecision`, `emit`).
- Helpers in `src/runtime/defaults.ts`, `decisions.ts`, `cancellation.ts` are small and single-purpose.

**Parameters:**
- Public APIs take a single options object with `readonly` fields (`DogpileOptions`, `EngineOptions`, `SequentialRunOptions`).
- Never use positional booleans. Use named option fields with discriminated unions (`ProtocolSelection`, `TerminationCondition`).

**Return Values:**
- Public APIs return JSON-serializable result/event shapes. `RunResult` includes `output`, `transcript`, `cost`, `trace`. The trace must round-trip through `JSON.parse(JSON.stringify(...))` (asserted in `src/tests/result-contract.test.ts` and `src/runtime/sequential.test.ts:41`).
- No tuples or unnamed results in public APIs.

## Module Design

**Exports:**
- `src/index.ts` is the only root export. Adding/removing a name there is a public-surface change — update `CHANGELOG.md` and `src/tests/package-exports.test.ts`.
- Subpath exports in `package.json` `exports` mirror `src/runtime/*` files; the `files` allowlist controls what ships.
- `export type { ... }` blocks are kept alphabetically sorted (`src/index.ts:73-197`).

**Barrel files:**
- Public barrel: `src/index.ts` only. Repo-internal barrel: `src/internal.ts` (not exported via `package.json`).
- Do not add new barrel files inside `src/runtime/`.

## Strict-TS Idioms

- `exactOptionalPropertyTypes` requires conditional spreads for optional fields:
  ```ts
  ...(options.signal !== undefined ? { abortSignal: options.signal } : {})
  ```
  See `src/runtime/sequential.ts:106`.
- `noUncheckedIndexedAccess` means array indexing yields `T | undefined`. Always narrow:
  ```ts
  if (turnEvents[1]?.type !== "agent-turn") { throw new Error("expected second turn event"); }
  ```
  (`src/runtime/sequential.test.ts:123`).
- Prefer `readonly` arrays and `as const` literals on every public input type (see `SequentialRunOptions`, `src/runtime/sequential.ts:44-58`).

## Provider/Adapter Conventions

- A configured provider is `{ id: string, generate(request): Promise<ModelResponse> }`. Nothing else is required or assumed.
- Provider adapters live under `src/providers/` and must read no env vars. Configuration (apiKey, baseURL, fetch, costEstimator) is passed by the caller (see `createOpenAICompatibleProvider` in `src/providers/openai-compatible.ts`).
- Provider failures must be normalized to `DogpileError` with the matching `provider-*` code.

---

*Convention analysis: 2026-04-29*
