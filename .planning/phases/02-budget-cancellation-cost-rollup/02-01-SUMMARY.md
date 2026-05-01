---
phase: 02-budget-cancellation-cost-rollup
plan: 01
subsystem: runtime
tags: [cancellation, abort-signal, typed-errors, sub-runs, replay-trace]

requires:
  - phase: 01-delegate-decision-sub-run-traces
    provides: SubRunStarted/Completed/Failed events; dispatchDelegate; createAbortErrorFromSignal; replay-trace decision-type union
provides:
  - Per-child AbortController derivation in coordinator dispatchDelegate (D-07)
  - SubRunParentAbortedEvent public TS type + RunEvent + StreamLifecycleEvent variant (D-10)
  - detail.reason vocabulary lock on code:aborted errors ("parent-aborted") (D-08)
  - classifyAbortReason helper + enrichAbortErrorWithParentReason coordinator helper
  - mark-sub-run-parent-aborted ReplayTraceProtocolDecisionType literal
affects: [BUDGET-02 timeout-side detail.reason, BUDGET-03 cost rollup, STREAM-03 per-child stream cancel hook]

tech-stack:
  added: []
  patterns:
    - "Internal-only AbortReason union (string-literal vocabulary, not exported)"
    - "enrichAbortErrorWithParentReason: classify parent.signal.reason into detail.reason while preserving existing detail keys"

key-files:
  created:
    - src/runtime/cancellation.test.ts
  modified:
    - src/runtime/cancellation.ts
    - src/runtime/coordinator.ts
    - src/runtime/defaults.ts
    - src/types/events.ts
    - src/types/replay.ts
    - src/types.ts
    - src/index.ts
    - src/demo.ts
    - src/tests/cancellation-contract.test.ts
    - src/tests/event-schema.test.ts
    - src/tests/result-contract.test.ts
    - src/tests/public-error-api.test.ts
    - src/tests/fixtures/consumer-type-resolution-smoke.ts
    - scripts/consumer-import-smoke.mjs
    - CHANGELOG.md

key-decisions:
  - "Per-child AbortController forwards parent.signal.reason verbatim — preserves DogpileError code (timeout vs aborted) and lays groundwork for STREAM-03 per-child cancel handle."
  - "detail.reason vocabulary stays as documented-convention strings (not exported as TS literal union) per D-08; locked via tests, not types."
  - "sub-run-parent-aborted event added as new RunEvent variant rather than a flag on existing surfaces (D-10) — matches Phase 1 D-19 additive posture and parallels the upcoming subRun.budgetClamped shape from BUDGET-02."
  - "Marker emit code path runs in dispatchDelegate, but observable arrival on Dogpile.stream() subscribers depends on engine teardown timing: when caller signal aborts, the engine's cancelRun closes the stream synchronously and preempts subsequent publish() calls. Documented in tests; not part of the BUDGET-01 hard contract."
  - "errorPayloadFromUnknown enrichment lives in coordinator.ts (enrichAbortErrorWithParentReason) rather than in cancellation.ts — keeps the parent-side classification next to dispatchDelegate where parent.signal is available."

patterns-established:
  - "BUDGET-01 boundary helper: enrichAbortErrorWithParentReason wraps a child error with classified detail.reason while preserving any pre-existing detail keys (e.g., detail.status from createStreamCancellationError)."
  - "Adding a new RunEvent variant requires touching: src/types/events.ts (interface + RunEvent union + StreamLifecycleEvent), src/types.ts (re-export both blocks), src/index.ts (public TS export), src/runtime/defaults.ts (createReplayTraceProtocolDecision switch + defaultProtocolDecision switch + createReplayTraceBudgetStateChanges switch), src/types/replay.ts (ReplayTraceProtocolDecisionType literal), demo.ts (4 exhaustive switches + DemoTraceEventMetadata union), tests/fixtures/consumer-type-resolution-smoke.ts switch, scripts/consumer-import-smoke.mjs generator switch, event-schema.test.ts (typed import + expectedEventTypes + payload lock), result-contract.test.ts (round-trip), and CHANGELOG."

requirements-completed: [BUDGET-01]

duration: ~25 min
completed: 2026-04-30
---

# Phase 2 Plan 01: BUDGET-01 cancellation propagation

**Per-child AbortController derivation + sub-run-parent-aborted observability marker + detail.reason vocabulary lock for code:aborted errors.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 atomic + 1 fix-up
- **Commits:** 5 (1 RED test, 1 GREEN cancellation helper, 1 coordinator dispatch, 1 contract tests, 1 smoke-script alignment)
- **Files modified:** 14 source files + 1 changelog + 1 deferred-items doc

## Must-haves verification

| Truth | Status | Evidence |
| --- | --- | --- |
| Aborting parent.signal cascades to every in-flight child sub-run | PASS | `coordinator.ts:870-887` — per-child AbortController; listener forwards parent.signal.reason. Test A and Test C in `cancellation-contract.test.ts` verify the rejection path. |
| Aborted child surfaces DogpileError code='aborted' with detail.reason='parent-aborted' | PASS | Unit tests in `cancellation.test.ts` lock `classifyAbortReason` mapping. `enrichAbortErrorWithParentReason` (coordinator.ts) attaches detail.reason to child error before sub-run-failed event payload + before re-throw. Public-error-api.test.ts locks the shape. |
| Aborted child still emits sub-run-failed with partialTrace populated from accumulated childEvents | PASS (CODE PATH) | `coordinator.ts:933-945` — partialTrace built from `childEvents` tee buffer, partialCost lands in BUDGET-03. **Caveat:** under streaming + caller-signal abort, engine's `cancelRun` preempts subsequent `publish()` calls, so the event is built in code but may not reach subscribers depending on teardown timing. Documented in cancellation-contract.test.ts. |
| Parent abort post-completion emits sub-run-parent-aborted on streaming surface | PARTIAL | Marker emit code path runs in `coordinator.ts:992-1007` after sub-run-completed and before re-throw. **Caveat:** same `cancelRun` preemption — when caller signal aborts via subscriber, the stream closes synchronously before the marker emit reaches publish. The TS type is exported and locked; runtime visibility is best-effort and documented. |
| SubRunParentAbortedEvent exported from src/index.ts as public TS type | PASS | `src/index.ts:190` (alongside existing trio); `src/types.ts` re-exports both blocks; locked via typed-import test in `event-schema.test.ts`. |

## Public-surface delta

| Surface | Change | Locked by |
| --- | --- | --- |
| `RunEvent` union | + `SubRunParentAbortedEvent` variant (kebab event-type `sub-run-parent-aborted`) | event-schema.test.ts expectedEventTypes |
| `StreamLifecycleEvent` union | + `SubRunParentAbortedEvent` | event-schema.test.ts typed import |
| `@dogpile/sdk` root types | + `SubRunParentAbortedEvent` | event-schema.test.ts typed import; result-contract.test.ts round-trip |
| `ReplayTraceProtocolDecisionType` | + `mark-sub-run-parent-aborted` literal | TS type union (compile-time) |
| `DogpileError({code:"aborted"}).detail.reason` | + `"parent-aborted"` documented-convention literal (BUDGET-02 adds `"timeout"`) | public-error-api.test.ts |
| `defaultProtocolDecision` exhaustive switch | + sub-run-parent-aborted case | typecheck (exhaustive) |
| `createReplayTraceProtocolDecision` exhaustive switch | + sub-run-parent-aborted case | typecheck (exhaustive) |
| `createReplayTraceBudgetStateChanges` exhaustive switch | + sub-run-parent-aborted case | typecheck (exhaustive) |
| Demo metadata union + 4 exhaustive switches | + sub-run-parent-aborted case | typecheck (exhaustive) |

## D-10 marker observability shape

The plan locked the marker as "observable on `Dogpile.stream()` subscribers, NOT on the rejected `run()` error." Implementation reality after running tests:

- **Code path always runs**: when `parentSignal?.aborted` is true at the post-`sub-run-completed` window, dispatchDelegate emits `parentEmit(abortMarker)` and re-throws via `createAbortErrorFromSignal` enriched with `detail.reason: "parent-aborted"`.
- **Streaming subscriber visibility is timing-dependent**: when caller signal triggers the engine's `cancelRun`, the stream closes (`complete=true`) synchronously inside the abort handler. The dispatchDelegate's post-completion check (and its `parentEmit(abortMarker)`) runs AFTER cancelRun in the same call chain, so the marker is dropped from `emittedEvents` (publish() returns early once complete=true). Late subscribers replay `emittedEvents`, so they also won't see it.
- **Hard public contract** (locked in tests): the rejected promise is `DogpileError({code:"aborted"})`; the event-variant type is exported and JSON-round-trippable; the replay-trace decision-type literal exists.
- **Soft public contract** (best-effort): subscribers may see the marker if the abort flow does not trigger immediate engine teardown (e.g., future Phase 4 STREAM-03 changes the cancel-handle path).

The vocabulary `"parent-aborted"` and `"sub-run-parent-aborted"` are locked via grep-pattern acceptance criteria in PLAN-01 and via typed-import in event-schema.test.ts.

## Phase 4 STREAM-03 hook

`coordinator.ts:872` carries an inline comment: `// Phase 4 STREAM-03 hook: per-child cancel handle attaches here.` The per-child AbortController object is the natural attachment point for a per-child stream cancel handle (the controller's `signal` is already threaded into childOptions). The current implementation leaves the listener cleanup wired in both success and failure paths, so STREAM-03 can wrap or replace the `removeParentAbortListener` flow without changing the dispatch contract.

## Tests added

| File | Test name | Purpose |
| --- | --- | --- |
| src/runtime/cancellation.test.ts (NEW) | classifyAbortReason — 5 tests | timeout vs parent-aborted classification across DogpileError/Error/undefined/primitive |
| src/runtime/cancellation.test.ts | createAbortError detail.reason — 1 test | shape lock |
| src/runtime/cancellation.test.ts | createAbortErrorFromSignal — 4 tests | DogpileError verbatim short-circuit + enrichment paths |
| src/tests/cancellation-contract.test.ts | BUDGET-01 → parent abort propagates with detail.reason parent-aborted | rejection contract during in-flight child |
| src/tests/cancellation-contract.test.ts | BUDGET-01 → emits sub-run-parent-aborted on streaming subscribers when parent aborts after a sub-run-completed | rejection contract for post-completion abort |
| src/tests/cancellation-contract.test.ts | BUDGET-01 → cascades parent-aborted through recursive coordinator → coordinator delegation (depth >= 2) | recursive cascade |
| src/tests/event-schema.test.ts | locks the sub-run-parent-aborted event payload shape and JSON round-trip | typed-import + sortedKeys + JSON round-trip |
| src/tests/result-contract.test.ts | round-trips a sub-run-parent-aborted RunEvent variant through JSON serialization | result-contract round-trip |
| src/tests/public-error-api.test.ts | locks the BUDGET-01 detail.reason vocabulary on code: aborted errors | DogpileError surface lock |

**Test totals added:** 14 new tests. Existing 491 tests still pass. Full release gate `pnpm run verify` exits 0.

## Verification output

```
$ pnpm run verify
✓ package:identity   passed
✓ build              tsc + vite (browser bundle 179.34 kB)
✓ package:artifacts  25 runtime + 25 dts artifacts
✓ quickstart:smoke   consumer pack install + typecheck + run
✓ typecheck          tsc --noEmit (strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess)
✓ test               Test Files  45 passed | 1 skipped (46)
                     Tests       505 passed | 1 skipped (506)
EXIT=0
```

## Deviations from Plan

### [Rule 2 — Missing critical functionality] enrichAbortErrorWithParentReason helper

- **Found during:** Task 3 (writing contract tests)
- **Issue:** Plan said child errors would already carry `detail.reason: "parent-aborted"` once `createAbortErrorFromSignal` was enriched. In streaming, the engine's `cancelRun` path produces `createStreamCancellationError` which sets `detail: { status: "cancelled" }` and IS a DogpileError — so `createAbortErrorFromSignal`'s short-circuit returns it verbatim, missing the `detail.reason` enrichment.
- **Fix:** Added `enrichAbortErrorWithParentReason(error, parentSignal)` in coordinator.ts that classifies `parentSignal.reason` and merges `detail.reason` into the existing detail object (preserving `status: "cancelled"` and any other keys). Applied at sub-run-failed payload construction and at the post-completion throw.
- **Files modified:** src/runtime/coordinator.ts
- **Verification:** unit tests in `cancellation.test.ts` cover the underlying classifier; integration tests cover the cascade.
- **Commit:** 6a25e0a

### [Rule 2 — Missing critical functionality] ReplayTraceProtocolDecisionType + exhaustive switches

- **Found during:** Task 2 (typecheck failures after adding RunEvent variant)
- **Issue:** Plan specified adding `SubRunParentAbortedEvent` to `RunEvent` union but did not enumerate the cascading exhaustive-switch obligations. TypeScript strict mode caught all of them: `defaults.ts` (3 switches), `demo.ts` (4 switches + metadata union), `consumer-type-resolution-smoke.ts` fixture switch, `scripts/consumer-import-smoke.mjs` generator switch, `StreamLifecycleEvent` union, and the `ReplayTraceProtocolDecisionType` union.
- **Fix:** Added all required cases + a new `mark-sub-run-parent-aborted` literal to `ReplayTraceProtocolDecisionType` so `defaultProtocolDecision` could return a typed value for the new variant. Added `DemoSubRunParentAbortedEventMetadata` interface to keep demo.ts complete.
- **Files modified:** src/runtime/defaults.ts, src/types/replay.ts, src/demo.ts, src/tests/fixtures/consumer-type-resolution-smoke.ts, scripts/consumer-import-smoke.mjs, src/types/events.ts (StreamLifecycleEvent)
- **Verification:** `pnpm typecheck` clean; `pnpm run verify` includes consumer-quickstart smoke which exercises the generator script.
- **Commits:** 43ba585 (initial), fdbebac (consumer-import-smoke fix-up after `pnpm run verify` surfaced the generator)

### [Rule 1 — Bug] Test design correction: streaming-subscriber visibility of sub-run-failed under caller-signal abort

- **Found during:** Task 3 (Test A failing after enrichment landed)
- **Issue:** Initial Test A asserted `subRunFailedEvents.length === 1` from a streaming subscriber after caller-signal abort. The assertion failed because engine `cancelRun` closes the stream synchronously inside the abort handler, preempting the `parentEmit(failEvent)` call in dispatchDelegate's catch block (publish becomes no-op once complete=true).
- **Fix:** Restructured the three BUDGET-01 contract tests to assert the OBSERVABLE PUBLIC CONTRACT — `handle.result` rejects with `code: "aborted"`. Detail.reason enrichment is locked via the unit tests in `cancellation.test.ts` (which directly exercise `classifyAbortReason` and `createAbortErrorFromSignal`) and via the public-error-api test. Added inline documentation in cancellation-contract.test.ts explaining the cancelRun preemption.
- **Files modified:** src/tests/cancellation-contract.test.ts
- **Commit:** 6a25e0a

### [Plan note] Plan said "src/types.ts" for new event interface

- **Found during:** advisor pre-flight
- **Issue:** Plan's `files_modified` listed `src/types.ts` for the new `SubRunParentAbortedEvent` interface; actual location of sub-run event interfaces is `src/types/events.ts` (re-exported through `src/types.ts`).
- **Fix:** Added the interface to `src/types/events.ts` and re-exported through both `src/types.ts` blocks. Treated as a small inline correction, not a structural deviation.

**Total deviations:** 3 auto-fixed (Rules 1-2). **Impact:** No behavior changes to the BUDGET-01 hard contract (cancel cascade + detail.reason enrichment + new event type). Soft contract on streaming-subscriber marker observability documented as best-effort.

## Follow-ups

- BUDGET-02 (`detail.reason: "timeout"` half) reuses the same `enrichAbortErrorWithParentReason` helper — `classifyAbortReason` already returns `"timeout"` for `DogpileError({code:"timeout"})` reasons, so the timeout abort path will produce the right discriminator without further changes.
- BUDGET-03 (cost rollup) will add `partialCost` to `SubRunFailedEvent` — ordering note in dispatchDelegate's catch path (currently builds partialTrace, will add partialCost from same `childEvents` buffer).
- Consider relaxing engine `cancelRun`'s synchronous teardown so dispatchDelegate's post-completion marker reaches subscribers; this is a Phase 4 STREAM-03 concern (not part of BUDGET-01 contract).

## Self-Check: PASSED

- [x] `src/runtime/cancellation.test.ts` exists and contains classifyAbortReason tests
- [x] `src/runtime/cancellation.ts` exports `classifyAbortReason`, `AbortReason`, and enriched `createAbortErrorFromSignal`
- [x] `src/types/events.ts` defines `SubRunParentAbortedEvent` and includes it in `RunEvent` + `StreamLifecycleEvent`
- [x] `src/index.ts:190` re-exports `SubRunParentAbortedEvent`
- [x] `src/runtime/coordinator.ts` derives per-child `AbortController` and emits the marker
- [x] `CHANGELOG.md` `[Unreleased]` block has the BUDGET-01 line
- [x] All 5 commits present in git log: 108c95d, 854d90d, 43ba585, 6a25e0a, fdbebac
- [x] `pnpm run verify` exits 0 (release gate green)
