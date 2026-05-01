---
phase: 06-provenance-annotations
plan: 05
subsystem: testing
tags: [provenance, event-schema, replay, fixtures, contract-tests]

requires:
  - phase: 06-provenance-annotations
    provides: Plans 06-01 through 06-04 provenance event types, runtime emission, replay synthesis, and public helper
provides:
  - Updated event-schema contract assertions for emitted model-request/model-response events
  - Provider-call modelId and replay provenance round-trip assertions
  - Frozen provenance-event-v1 fixture and bootstrap test
  - Full-suite test expectation alignment for emitted provenance events
affects: [phase-06-provenance-annotations, event-log, replay, browser-smoke, demo, benchmark]

tech-stack:
  added: []
  patterns:
    - Frozen fixture bootstrap with first-run write and later shape comparison
    - Replay compatibility fallback for pre-modelId provider-call artifacts

key-files:
  created:
    - src/tests/provenance-shape.test.ts
    - src/tests/fixtures/provenance-event-v1.json
    - .planning/phases/06-provenance-annotations/06-05-SUMMARY.md
  modified:
    - src/tests/event-schema.test.ts
    - src/tests/result-contract.test.ts
    - src/runtime/engine.ts
    - src/benchmark/config.test.ts
    - src/runtime/broadcast.test.ts
    - src/runtime/coordinator.test.ts
    - src/runtime/shared.test.ts
    - src/tests/browser-bundle-smoke.test.ts
    - src/tests/cancellation-contract.test.ts
    - src/tests/demo.test.ts
    - src/tests/performance-baseline.test.ts
    - src/tests/replay-version-skew.test.ts
    - src/tests/streaming-api.test.ts
    - src/tests/temperature-zero-ordering.test.ts
    - src/tests/termination-types.test.ts
    - src/tests/v1-release-focused.test.ts

key-decisions:
  - "Replay synthesis falls back to providerId when older provider-call artifacts do not contain modelId."
  - "Neighboring event-order tests now assert emitted model-request/model-response events instead of filtering them away."

patterns-established:
  - "Provenance shape fixtures compare field names and value types, not timestamp/runId values."
  - "Replay tests distinguish saved trace event order from replayed result event-log synthesis."

requirements-completed: [PROV-01, PROV-02]

duration: 13 min
completed: 2026-05-01
---

# Phase 06 Plan 05: Contract Tests and Frozen Provenance Fixture Summary

**Provenance contract tests now assert live, replayed, and frozen model-request/model-response shapes across the full suite.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-05-01T18:29:47Z
- **Completed:** 2026-05-01T18:42:03Z
- **Tasks:** 2
- **Files modified:** 19

## Accomplishments

- Updated `event-schema.test.ts` to assert live model provenance event sequences and payload shapes.
- Added provider-call `modelId` assertions and replay provenance round-trip checks in `result-contract.test.ts`.
- Added `provenance-shape.test.ts` plus the frozen `provenance-event-v1.json` fixture.
- Reconciled directly related neighboring tests so the full suite now expects emitted provenance events.

## Task Commits

Each task was committed atomically:

1. **Task 1: Update event-schema test contracts** - `a647e6f` (test)
2. **Task 2: Lock replay and frozen provenance contracts** - `94a832d` (test)

**Plan metadata:** committed separately in the summary docs commit.

## Files Created/Modified

- `src/tests/event-schema.test.ts` - Asserts live model-request/model-response ordering and payload shape.
- `src/tests/result-contract.test.ts` - Asserts `providerCalls[*].modelId` and replayed provenance fields.
- `src/tests/provenance-shape.test.ts` - Bootstraps or verifies the frozen provenance event shape fixture.
- `src/tests/fixtures/provenance-event-v1.json` - Frozen two-event provenance shape fixture.
- `src/runtime/engine.ts` - Falls back to `providerId` for old replay artifacts missing provider-call `modelId`.
- Neighboring protocol, streaming, demo, benchmark, browser, cancellation, termination, replay-skew, and release-focused tests - Updated stale event-order expectations for emitted provenance events.

## Decisions Made

- Used a shape/type comparison in the frozen fixture test so timestamps and run IDs can vary while field contracts remain locked.
- Kept replay trace identity separate from replay event-log synthesis in tests: saved traces stay untouched, replayed event logs include provider-call-derived provenance events.
- Applied a minimal runtime fallback for version-skew replay artifacts that predate `ReplayTraceProviderCall.modelId`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replayed old traces used undefined modelId**
- **Found during:** Full-suite verification after Task 2
- **Issue:** The frozen v0.3 replay fixture predates `ReplayTraceProviderCall.modelId`, so replay synthesis produced `modelId: undefined`.
- **Fix:** Added a narrow `call.modelId` to `call.providerId` fallback in `synthesizeProviderEvents()`.
- **Files modified:** `src/runtime/engine.ts`, `src/tests/replay-version-skew.test.ts`
- **Verification:** `pnpm vitest run src/tests/replay-version-skew.test.ts` passed as part of the formerly failing batch; `pnpm run test` passed.
- **Committed in:** `94a832d`

**2. [Rule 3 - Blocking] Updated directly related neighboring event-order assertions**
- **Found during:** Full-suite verification after planned contract test updates
- **Issue:** Broad protocol, streaming, demo, benchmark, cancellation, browser, termination, and release-focused tests still asserted pre-provenance event streams.
- **Fix:** Updated only directly related test expectations to include model-request/model-response events and replay synthesis ordering.
- **Files modified:** `src/benchmark/config.test.ts`, `src/runtime/broadcast.test.ts`, `src/runtime/coordinator.test.ts`, `src/runtime/shared.test.ts`, `src/tests/browser-bundle-smoke.test.ts`, `src/tests/cancellation-contract.test.ts`, `src/tests/demo.test.ts`, `src/tests/performance-baseline.test.ts`, `src/tests/replay-version-skew.test.ts`, `src/tests/streaming-api.test.ts`, `src/tests/temperature-zero-ordering.test.ts`, `src/tests/termination-types.test.ts`, `src/tests/v1-release-focused.test.ts`
- **Verification:** Formerly failing batch passed (13 files, 160 tests), then `pnpm run test` passed.
- **Committed in:** `94a832d`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both were required to make PROV-01/PROV-02 the actual public contract across the suite. No unrelated production behavior was changed.

## Issues Encountered

- `node_modules/@gsd-build/sdk/dist/cli.js` and `.planning/config.json` were unavailable, so execution continued from checked-in plan/context files.
- The full suite initially failed with stale pre-provenance event-order assertions; those were directly related to this plan and were updated.

## Known Stubs

None. Stub scan hits were existing benchmark TODO text and normal test/runtime array or object initializers, not plan-blocking placeholders or unwired data.

## Authentication Gates

None.

## User Setup Required

None - no external service configuration required.

## Threat Flags

None - no new network endpoint, auth path, file access pattern, or trust-boundary schema was introduced. The planned frozen fixture mitigation for T-06-05 is in place.

## Verification

- `pnpm vitest run src/tests/event-schema.test.ts` - passed (20 tests)
- `pnpm vitest run src/tests/provenance-shape.test.ts` - passed and bootstrapped the fixture
- `pnpm vitest run src/tests/result-contract.test.ts` - passed (22 tests)
- Formerly failing batch - passed (13 files, 160 tests)
- `pnpm run typecheck` - passed
- `pnpm run test` - passed (47 files passed, 659 tests passed, 1 skipped)
- `grep -c "call.modelId" src/tests/result-contract.test.ts` - `6`
- `grep -c "model-request" src/tests/provenance-shape.test.ts` - `5`
- `grep -c '"model-request"' src/tests/fixtures/provenance-event-v1.json` - `1`
- `grep -c '"model-response"' src/tests/fixtures/provenance-event-v1.json` - `1`
- `grep -c '"startedAt"' src/tests/fixtures/provenance-event-v1.json` - `2`
- `grep -c '"modelId"' src/tests/fixtures/provenance-event-v1.json` - `2`

## Self-Check: PASSED

- Created summary file exists: `.planning/phases/06-provenance-annotations/06-05-SUMMARY.md`
- Created fixture test exists: `src/tests/provenance-shape.test.ts`
- Created frozen fixture exists: `src/tests/fixtures/provenance-event-v1.json`
- Task commit found: `a647e6f`
- Task commit found: `94a832d`
- No tracked file deletions were introduced by either task commit.
- `.planning/STATE.md` and `.planning/ROADMAP.md` have no diff from this executor.

## Next Phase Readiness

Ready for remaining v0.5.0 observability plans. Provenance event emission, replay synthesis, helper surface, contract tests, and frozen shape fixture are now aligned and full-suite green.

---
*Phase: 06-provenance-annotations*
*Completed: 2026-05-01*
