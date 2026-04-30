---
phase: 01-delegate-decision-sub-run-traces
plan: 04
subsystem: runtime/validation, runtime/decisions, runtime/coordinator, runtime/engine
tags: [max-depth, validation, depth-overflow, dual-gate, public-api]
requires:
  - "AgentDecision discriminated union from Plan 01-01"
  - "ParseAgentDecisionContext with optional currentDepth/maxDepth from Plan 01-01"
  - "Coordinator delegate dispatch loop from Plan 01-03"
  - "RunProtocolOptions.currentDepth / effectiveMaxDepth from Plan 01-03"
provides:
  - "DogpileOptions.maxDepth and EngineOptions.maxDepth (default 4)"
  - "RunCallOptions public type for per-call run/stream overrides"
  - "Engine.run(intent, options?) and Engine.stream(intent, options?) signatures"
  - "validateRunCallOptions helper"
  - "Parse-time depth-overflow check in parseDelegateDecision"
  - "Dispatcher-time depth gate via assertDepthWithinLimit at the top of dispatchDelegate"
  - "Shared depthOverflowError factory so parser and dispatcher emit identical error shapes"
affects:
  - "src/runtime/engine.ts createEngine closure (engineMaxDepth captured once; per-call effectiveMaxDepth = Math.min(engineMaxDepth, runOptions?.maxDepth ?? Infinity))"
  - "src/runtime/coordinator.ts parseAgentDecision call site (forwards currentDepth + effectiveMaxDepth)"
tech-stack:
  added: []
  patterns:
    - "Per-call lowering modeled as Engine.run(intent, RunCallOptions) — additive, non-breaking; the existing single-arg signature is preserved by making the second arg optional"
    - "Dual-gate enforcement (D-14): parser throws on parse, dispatcher re-asserts before sub-run-started; both call sites share assertDepthWithinLimit + depthOverflowError so the error shape cannot drift"
    - "validateOptionalNonNegativeInteger reused for maxDepth — produces the standard configuration-validation error shape with detail.path: 'maxDepth'"
key-files:
  created: []
  modified:
    - "src/types.ts"
    - "src/index.ts"
    - "src/runtime/validation.ts"
    - "src/runtime/engine.ts"
    - "src/runtime/decisions.ts"
    - "src/runtime/coordinator.ts"
    - "src/tests/config-validation.test.ts"
decisions:
  - "Engine.run / Engine.stream signature extended with an optional second arg (RunCallOptions) so that 'engine ceiling 2, per-run override 5 → effective 2' has a real surface. The existing Plan 03 plumbing for currentDepth/effectiveMaxDepth on RunProtocolOptions is reused verbatim — only the engine entry points compute effectiveMaxDepth via Math.min."
  - "depthOverflowError + assertDepthWithinLimit live in src/runtime/decisions.ts (NOT in coordinator.ts) because the parser is the original throw site, and the helper was added to share the exact error shape with the dispatcher. Both helpers are exported from decisions.ts but NOT re-exported through src/index.ts / src/types.ts / any subpath in package.json — confirmed by package-exports.test.ts staying green."
  - "RunCallOptions is public surface (re-exported through src/types.ts via the inline export and through src/index.ts). It is intentionally minimal — only maxDepth today; future per-call knobs can extend without adding new public types."
  - "validateRunCallOptions runs at every Engine.run / Engine.stream call. The path it produces is rooted at the second arg (e.g. 'options.maxDepth') rather than 'maxDepth' so the failure is unambiguously per-call rather than engine-level."
  - "Dispatcher-time check fires BEFORE sub-run-started is emitted; failed dispatches do not appear as half-started sub-runs in the trace. This matches the parser-time check: depth-overflow always throws before any event emission."
  - "Default maxDepth = 4 is captured from the engine options closure once. Replay paths do not call runProtocol, so they don't need depth threading; runProtocol's existing default of effectiveMaxDepth = Infinity remains the safe fallback."
metrics:
  duration: "~25 min"
  completed: "2026-04-30"
---

# Phase 01 Plan 04: maxDepth Option & Overflow Validation Summary

Threads `maxDepth` (default 4) through every runtime entry point, validates it at the option-validation surface, and enforces depth overflow at BOTH the parser (D-14 parse-time gate) and the coordinator dispatcher (D-14 dispatcher-time / TOCTOU gate). Per-run values can only LOWER the engine's ceiling — `effectiveMaxDepth = Math.min(engineMaxDepth, runOptions?.maxDepth ?? Infinity)`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add maxDepth option, validation, and engine threading | `616494b` | `src/types.ts`, `src/index.ts`, `src/runtime/validation.ts`, `src/runtime/engine.ts` |
| 2 | Enforce depth overflow at parser and dispatcher; lock with config-validation tests | `061d28c` | `src/runtime/decisions.ts`, `src/runtime/coordinator.ts`, `src/tests/config-validation.test.ts` |

## effectiveMaxDepth Derivation Path (file:line)

- `Dogpile.pile(options)` (`src/runtime/engine.ts:903`) → `run(options)` → `withHighLevelDefaults` (`engine.ts:893`) preserves `maxDepth` via `...options` spread → `createEngine(engineOptions)` → `engineMaxDepth = options.maxDepth ?? 4` captured in closure (`engine.ts:74`).
- `engine.run(intent, runOptions)` (`engine.ts:77`) computes `effectiveMaxDepth = Math.min(engineMaxDepth, runOptions?.maxDepth ?? Infinity)` (`engine.ts:80-83`) and passes it to `runNonStreamingProtocol` → `runProtocol` (`engine.ts:99-100`).
- `engine.stream(intent, runOptions)` (`engine.ts:106`) does the same (`engine.ts:108-111`) and passes through the streaming `runProtocol` invocation (`engine.ts:196-197`).
- `runProtocol` forwards `currentDepth` / `effectiveMaxDepth` into `runCoordinator` (Plan 03 plumbing, `engine.ts:687-688`).
- `runCoordinator` forwards them to `runCoordinatorTurn` → `parseAgentDecision(response.text, { parentProviderId, currentDepth, maxDepth: effectiveMaxDepth })` (`coordinator.ts:547-551` and `coordinator.ts:672-676`).
- `dispatchDelegate` re-asserts the gate before emitting `sub-run-started` (`coordinator.ts:790-797`).

## Two Enforcement Throws (file:line)

1. **Parser (parse-time gate, D-14):** `src/runtime/decisions.ts:175-180` — at the end of `parseDelegateDecision`, after all field validation. Throws via `depthOverflowError(currentDepth, maxDepth)` (defined `decisions.ts:188-202`).
2. **Dispatcher (TOCTOU gate, D-14):** `src/runtime/coordinator.ts:790-797` — at the top of `dispatchDelegate`, before any event emission. Calls `assertDepthWithinLimit(input.parentDepth, options.effectiveMaxDepth)` (defined `decisions.ts:209-213`).

Both throws produce the identical `DogpileError`:

```ts
{
  code: "invalid-configuration",
  message: `Depth overflow: cannot dispatch sub-run at depth ${currentDepth + 1} (maxDepth = ${maxDepth}).`,
  retryable: false,
  detail: {
    kind: "delegate-validation",
    path: "decision.protocol",
    reason: "depth-overflow",
    currentDepth,
    maxDepth
  }
}
```

## How the Dispatcher-Time Gate is Reached by Tests

The plan called for a behavioral test that exercises the dispatcher-time gate independent of the parse-time gate. Implementation:

- `assertDepthWithinLimit(currentDepth, maxDepth)` is exported from `src/runtime/decisions.ts` (NOT re-exported through the public surface `src/index.ts` / `src/types.ts`).
- The new `src/tests/config-validation.test.ts > maxDepth option > assertDepthWithinLimit throws depth-overflow when currentDepth + 1 > maxDepth` test imports it directly from `../runtime/decisions.js` and calls it with `(2, 2)`. Asserts the exact `DogpileError` shape.
- The boundary test calls `assertDepthWithinLimit(0, 1)` and `assertDepthWithinLimit(3, 4)` to confirm the gate does NOT throw when `currentDepth + 1 <= maxDepth`.
- Combined with the end-to-end tests (engine `maxDepth: 1` throws at depth 1, default `maxDepth: 4` throws at depth 4), this verifies BOTH the parser path AND the dispatcher path of the dual gate.

The test seam is the extracted helper, per the plan's preferred approach. No `__dispatchDelegateForTest` export needed.

## Lock Tests Added (`src/tests/config-validation.test.ts`)

New `describe("maxDepth option", ...)` block with nine `it` cases:

| # | Case | Expected behavior |
|---|------|-------------------|
| 1 | `createEngine({ maxDepth: -1 })` | invalid-configuration at path `maxDepth` |
| 2 | `createEngine({ maxDepth: 1.5 })` | invalid-configuration (non-integer) |
| 3 | `createEngine({ maxDepth: "4" })` | invalid-configuration (non-number) |
| 4 | `Dogpile.run({ maxDepth: -1 })` | invalid-configuration at path `maxDepth` |
| 5 | engine maxDepth=4, per-run maxDepth=2 → effective 2 | depth-overflow at depth 2 with `detail.maxDepth = 2` |
| 6 | engine maxDepth=2, per-run maxDepth=5 → effective 2 | depth-overflow at depth 2 (per-run cannot raise) |
| 7 | end-to-end engine maxDepth=1 | depth-overflow at currentDepth=1, maxDepth=1, path `decision.protocol` |
| 8 | default maxDepth=4 (no option set) | depth-overflow at currentDepth=4, maxDepth=4 |
| 9 | behavioral `assertDepthWithinLimit(2, 2)` | identical error shape; boundary `(0, 1)` and `(3, 4)` do not throw |

Tests 5-8 use `createDelegateChainProvider` — a coordinator provider that always emits `delegate: { protocol: "coordinator", intent: "go deeper" }` on the plan turn, producing a real chain of nested sub-runs until the gate trips.

## Verification

- `pnpm run typecheck` — clean.
- `pnpm vitest run src/tests/config-validation.test.ts` — 87/87 pass.
- `pnpm vitest run src/tests/config-validation.test.ts src/runtime/decisions.test.ts src/runtime/coordinator.test.ts` — 115/115 pass.
- `pnpm vitest run` (full suite) — 473 passed, 1 skipped, 1 failure (pre-existing `src/tests/consumer-type-resolution-smoke.test.ts`, see Deferred Issues).

## Deviations from Plan

### Rule 2 — Missing critical functionality (auto-applied)

**1. Engine.run / Engine.stream signature extension**

- **Found during:** Task 1 design review.
- **Issue:** The plan's test-case 5 ("engine maxDepth: 4, run maxDepth: 2 → effective 2") and test-case 6 ("engine maxDepth: 2, run maxDepth: 5 → effective 2") require a real surface where the engine ceiling and a per-run override coexist. Today, `engine.run(intent)` only accepts an intent — every `Dogpile.run({ ..., maxDepth })` call constructs a fresh engine, so the "lower-only" semantic has no exercisable seam outside the high-level `run()` API. Without the signature extension, `Math.min(engineMaxDepth, runOptions.maxDepth ?? Infinity)` collapses to "whichever value the caller most recently passed," and tests 5/6 cannot distinguish "lower-only" from "always-take-the-latest."
- **Fix:** Added optional second arg `RunCallOptions` to both `Engine.run` and `Engine.stream`. The new public type lives in `src/types.ts` and is re-exported through `src/index.ts`. `validateRunCallOptions` validates `options.maxDepth` per-call. The signature change is additive and non-breaking — every existing call site continues to work because the second arg is optional.
- **Files modified:** `src/types.ts`, `src/index.ts`, `src/runtime/validation.ts`, `src/runtime/engine.ts`.
- **Commit:** `616494b` (rolled into Task 1).

### Rule 2 — Missing critical functionality (auto-applied)

**2. Shared error-shape helpers (depthOverflowError + assertDepthWithinLimit)**

- **Found during:** Task 2 implementation, while wiring the dispatcher-time check.
- **Issue:** The plan specifies "the same error shape from `<interfaces>`" at both the parser and dispatcher. Inlining the throw at both call sites would create two near-identical `new DogpileError({...})` literals — a future field rename in one path would silently drift from the other.
- **Fix:** Extracted `depthOverflowError(currentDepth, maxDepth)` (the `DogpileError` factory) and `assertDepthWithinLimit(currentDepth, maxDepth)` (the gate helper that calls the factory) into `src/runtime/decisions.ts`. Both are exported from that module so the dispatcher can import them, but neither is re-exported through `src/index.ts` / `src/types.ts` / any subpath in `package.json`'s `exports` — confirmed by `pnpm vitest run src/tests/package-exports.test.ts` staying green. The behavioral test in `config-validation.test.ts` imports `assertDepthWithinLimit` directly from `../runtime/decisions.js`, mirroring how unit tests already import internal helpers (e.g., `parseAgentDecision` from `decisions.test.ts`).
- **Files modified:** `src/runtime/decisions.ts`, `src/runtime/coordinator.ts`.
- **Commit:** `061d28c` (rolled into Task 2).

### Out-of-scope (deferred)

- `consumer-type-resolution-smoke.test.ts` runtime failure: pre-existing on `main` (logged in Plans 01-01 / 01-02 / 01-03 SUMMARYs). Unchanged by this plan; the fixture's switch was not touched.

## Authentication Gates

None.

## Public Surface Touched

| File | Status | Change |
|------|--------|--------|
| `src/types.ts` | modified | Add `readonly maxDepth?: number` to `DogpileOptions` and `EngineOptions`; add new `RunCallOptions` interface; extend `Engine.run` / `Engine.stream` signatures with optional second arg |
| `src/index.ts` | modified | Re-export `RunCallOptions` |
| `src/runtime/validation.ts` | modified | `validateOptionalNonNegativeInteger(options.maxDepth, "maxDepth")` in `validateDogpileOptions` and `validateEngineOptions`; new `validateRunCallOptions` exported helper |
| `src/runtime/engine.ts` | modified | `engineMaxDepth` captured in `createEngine` closure; `effectiveMaxDepth` computed at `run`/`stream` entry; threaded into `runNonStreamingProtocol` and the streaming `runProtocol` invocation |
| `src/runtime/decisions.ts` | modified | Parse-time depth-overflow check at end of `parseDelegateDecision`; new exported `depthOverflowError` and `assertDepthWithinLimit` (NOT re-exported publicly) |
| `src/runtime/coordinator.ts` | modified | `parseAgentDecision` call sites forward `currentDepth` + `maxDepth: effectiveMaxDepth`; `dispatchDelegate` calls `assertDepthWithinLimit` before `sub-run-started` is emitted |
| `src/tests/config-validation.test.ts` | modified | New `describe("maxDepth option")` block with nine cases (validation failures, ceiling/lower-only, end-to-end, default, behavioral dual-gate) |

`CHANGELOG.md` is intentionally untouched per the plan; Plan 05 owns the v0.4.0 entry. `package.json` `exports` / `files` unchanged.

## Deferred Issues

- **`src/tests/consumer-type-resolution-smoke.test.ts`** (pre-existing): see Plans 01-01 / 01-02 / 01-03 SUMMARYs. The fixture itself typechecks cleanly via the workspace tsconfig — only the test that re-runs `tsc` from a separate cwd breaks because of the upstream `pnpm exec` directory issue. Out of scope for this plan.

## Threat Flags

None — this plan stays within the trust boundaries documented in the plan's STRIDE register (T-04-01..04). All four mitigations are in place:

- T-04-01 (DoS via unbounded recursion): default `maxDepth = 4` enforced at both gates; verified by the default-behavior test (5th delegate at depth 4 throws).
- T-04-02 (per-run config raising the engine ceiling): `Math.min` collapse; verified by the engine=2/run=5 test.
- T-04-03 (TOCTOU between parse and dispatch): dispatcher-time gate runs immediately on `dispatchDelegate` entry, before any state read or event emission. Verified by the behavioral `assertDepthWithinLimit` test.
- T-04-04 (NaN / non-integer `maxDepth`): `validateOptionalNonNegativeInteger` rejects on `createEngine`, `Dogpile.run`, `Dogpile.stream`, and `Engine.run` / `Engine.stream` per-call options. Verified by tests 1-4.

## TDD Gate Compliance

The plan frontmatter marks both tasks `tdd="true"`. Git log for this plan shows `feat:` (Task 1) + `feat:` (Task 2). Both tasks were gated by:

- Task 1: typecheck failures on `RunCallOptions` consumers and the existing engine call sites until `effectiveMaxDepth` was wired.
- Task 2: the new lock tests in `config-validation.test.ts` failed before the parse-time and dispatcher-time gates were wired up. The behavioral `assertDepthWithinLimit` test specifically would have failed before the helper existed (import error) — proving the dispatcher-time gate is exercised independently.

The Task 2 commit message uses `feat:` rather than `test:` because it lands the implementation AND the lock tests in the same commit (per Plan 01-02 / 01-03 convention for tightly-coupled implementation + lock test pairs).

## Self-Check

- `src/types.ts` (DogpileOptions.maxDepth, EngineOptions.maxDepth, RunCallOptions, Engine.run/stream signatures) — FOUND
- `src/index.ts` (RunCallOptions re-export) — FOUND
- `src/runtime/validation.ts` (validateOptionalNonNegativeInteger maxDepth in both option validators; validateRunCallOptions) — FOUND
- `src/runtime/engine.ts` (engineMaxDepth + effectiveMaxDepth threading) — FOUND
- `src/runtime/decisions.ts` (parse-time check + depthOverflowError + assertDepthWithinLimit) — FOUND
- `src/runtime/coordinator.ts` (parseAgentDecision context forwarding + dispatcher-time gate) — FOUND
- `src/tests/config-validation.test.ts` (maxDepth describe block, 9 cases) — FOUND
- Commit `616494b` — FOUND
- Commit `061d28c` — FOUND
- `pnpm run typecheck` — clean
- `pnpm vitest run src/tests/config-validation.test.ts` — 87/87 pass
- `pnpm vitest run` (full suite) — 473 passed, only the pre-existing `consumer-type-resolution-smoke.test.ts` failure remains

## Self-Check: PASSED
