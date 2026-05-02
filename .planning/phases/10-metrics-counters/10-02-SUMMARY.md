---
phase: 10-metrics-counters
plan: 02
subsystem: runtime
tags: [metrics, counters, hooks, engine, tdd]

requires:
  - phase: 10-metrics-counters
    provides: MetricsHook and RunMetricsSnapshot contract surface from Plan 10-01
provides:
  - MetricsState lifecycle integration in engine.ts
  - Root-only onRunComplete firing for completed, budget-stopped, and aborted runs
  - Parent-scoped onSubRunComplete firing for coordinator child completions
  - Hook error isolation through logger.error or console.error fallback
affects: [runtime, metrics, public-api, observability]

tech-stack:
  added: []
  patterns:
    - Metrics lifecycle mirrors tracing lifecycle but suppresses child onRunComplete double-fire
    - Fire-and-forget hook invocation with synchronous and async error routing

key-files:
  created:
    - src/tests/metrics-engine-contract.test.ts
  modified:
    - src/runtime/engine.ts

key-decisions:
  - "OQ-1 resolved as Option B: metricsHook is not threaded into child runProtocol calls; child completions use onSubRunComplete only."
  - "OQ-3 requires no cancelRun special case: stream cancellation aborts runProtocol and the root catch path fires an aborted snapshot."
  - "Replay and replayStream remain metrics-free, matching the existing tracing-free replay contract."

patterns-established:
  - "Metrics helpers live beside tracing helpers in engine.ts and return undefined when no hook is supplied."
  - "Run snapshots derive own counters by subtracting direct nested sub-run costs from rolled-up totals."
  - "Hook callbacks are invoked without awaiting; returned Promises get a catch handler routed to logger.error."

requirements-completed: [METR-01, METR-02]

duration: 6 min
completed: 2026-05-02
---

# Phase 10 Plan 02: Metrics Engine Integration Summary

**MetricsHook lifecycle firing in the engine with root completion, sub-run completion, cancellation, and hook error isolation**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-02T01:05:27Z
- **Completed:** 2026-05-02T01:11:09Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `MetricsState`, `openRunMetrics`, `handleMetricsEvent`, `closeRunMetrics`, `fireHook`, and snapshot builders to `src/runtime/engine.ts`.
- Wired `metricsHook` and `logger` through `createEngine.run()`, `createEngine.stream()`, and root `runProtocol` completion paths.
- Fired `onSubRunComplete` once from the parent emit closure for coordinator-dispatched child runs.
- Kept `onRunComplete` root-only with `currentDepth === 0 || undefined`, avoiding sub-run double-counting.
- Added a focused engine lifecycle contract test covering completed, budget-stopped, aborted, cancelled streaming, sub-run, sync hook error, and async hook error behavior.

## TDD Record

- **RED:** `bb82086` added `src/tests/metrics-engine-contract.test.ts`; `pnpm vitest run src/tests/metrics-engine-contract.test.ts` failed with 6 failing tests because the engine did not call metrics hooks yet.
- **GREEN:** `9c1247c` added the helper layer and passed `pnpm run typecheck`; `983e328` wired runtime paths and passed the focused metrics contract test.
- **REFACTOR:** No separate refactor commit was needed.

## Task Commits

1. **Task 1 RED: Add failing metrics engine lifecycle test** - `bb82086` (test)
2. **Task 1 GREEN: Add MetricsState helpers + RunProtocolOptions fields** - `9c1247c` (feat)
3. **Task 2: Wire metrics into runProtocol and createEngine threading** - `983e328` (feat)

## Files Created/Modified

- `src/runtime/engine.ts` - Adds metrics lifecycle helpers, root/sub-run hook firing, hook error routing, runtime option threading, and replay metrics-free comments.
- `src/tests/metrics-engine-contract.test.ts` - Verifies engine-level metrics hook behavior before Plan 03 public subpath and fixture coverage.

## Decisions Made

- Chose OQ-1 Option B: do not thread `metricsHook` into coordinator child `runProtocol` calls; parent `handleMetricsEvent` emits the child snapshot through `onSubRunComplete`.
- Threaded `logger` into child dispatch without `metricsHook`, preserving error-routing availability if future internal paths need it while avoiding double-fire.
- Kept aborted run snapshots at zero counters because no assembled `RunResult` is available at the throw site.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added a focused RED contract test for the TDD-marked engine task**
- **Found during:** Task 1 (MetricsState helpers)
- **Issue:** The plan marked Task 1 as `tdd="true"` but listed only `engine.ts` as a planned changed file. Without a test, hook firing and error isolation would not be mechanically verified until a later plan.
- **Fix:** Added `src/tests/metrics-engine-contract.test.ts` as a narrow engine lifecycle test while leaving Plan 03 public subpath, package export, and frozen fixture coverage untouched.
- **Files modified:** `src/tests/metrics-engine-contract.test.ts`
- **Verification:** Focused test failed in RED, then passed after engine wiring; full `pnpm run test` passed.
- **Committed in:** `bb82086`

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** The deviation adds verification only; runtime implementation scope remains the planned engine metrics lifecycle.

## Issues Encountered

- The GSD `query` interface was unavailable as noted in the prompt, so state and roadmap updates were made manually.
- Existing uncommitted plan corrections in `10-02-PLAN.md`, `10-03-PLAN.md`, and untracked `10-PATTERNS.md` were preserved and not committed.

## Verification

- `pnpm vitest run src/tests/metrics-engine-contract.test.ts` - RED failed before implementation with 6 failing tests; passed after Task 2 with 6 tests.
- `pnpm run typecheck` - passed.
- `pnpm run test` - passed: 58 passed, 1 skipped; 750 passed, 1 skipped.
- `grep -c 'openRunMetrics' src/runtime/engine.ts` - `2`.
- `grep -c 'handleMetricsEvent' src/runtime/engine.ts` - `2`.
- `grep -c 'closeRunMetrics' src/runtime/engine.ts` - `3`.
- `grep -c 'fireHook' src/runtime/engine.ts` - `4`.
- `grep 'metricsHook' src/runtime/engine.ts | grep 'runProtocol(' | grep -v 'options.metricsHook'` - no matches.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 03 can wire the `/runtime/metrics` package subpath, package export tests, frozen `metrics-snapshot-v1` fixture, and broader public-surface contract tests on top of working engine behavior.

## Self-Check: PASSED

- Found `src/runtime/engine.ts`.
- Found `src/tests/metrics-engine-contract.test.ts`.
- Found `.planning/phases/10-metrics-counters/10-02-SUMMARY.md`.
- Found commits `bb82086`, `9c1247c`, and `983e328`.
- Plan-level verification passed.

---
*Phase: 10-metrics-counters*
*Completed: 2026-05-02*
