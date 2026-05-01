---
phase: 09-otel-tracing-bridge
plan: 00
subsystem: testing
tags: [otel, coordinator, recursion, deterministic-provider, vitest]

requires:
  - phase: 01-delegate-decision-sub-run-traces
    provides: Live coordinator delegate dispatch with sub-run lifecycle events
  - phase: 06-provenance-annotations
    provides: Stable model request/response event provenance used by Phase 9 contracts
provides:
  - createDelegatingDeterministicProvider deterministic test helper
  - Live coordinator sub-run dispatch fixture for OTEL-02 contract tests
  - Co-located coverage for sub-run-started/sub-run-completed pairing
affects: [otel, testing, coordinator, recursive-coordination]

tech-stack:
  added: []
  patterns:
    - TDD RED/GREEN for a published deterministic test helper
    - Delegate-block text fixture that exercises real coordinator dispatch

key-files:
  created:
    - src/testing/deterministic-provider.test.ts
  modified:
    - src/testing/deterministic-provider.ts

key-decisions:
  - "createDelegatingDeterministicProvider emits one delegate block, then a participate block, so coordinator dispatch terminates deterministically."
  - "The helper reuses the same provider instance for parent and child runs and answers child calls with non-delegating deterministic text."

patterns-established:
  - "Live recursive-dispatch tests should assert real sub-run-started/sub-run-completed lifecycle events instead of injecting synthetic events."

requirements-completed: [OTEL-02]

duration: 4 min
completed: 2026-05-01
---

# Phase 09 Plan 00: Delegating Deterministic Provider Summary

**Deterministic coordinator fixture that emits a real delegate decision and proves paired sub-run lifecycle events**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-01T22:53:18Z
- **Completed:** 2026-05-01T22:57:05Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Added `createDelegatingDeterministicProvider` and `DelegatingProviderOptions` to `src/testing/deterministic-provider.ts`.
- Added a co-located Vitest suite proving the helper emits delegate/participate plan responses, deterministic worker/final text, option-controlled child protocol/intent, and real coordinator sub-run lifecycle events.
- Verified the live `run({ protocol: { kind: "coordinator" } })` path emits matching `sub-run-started` and `sub-run-completed` events by `childRunId`.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add failing delegating provider tests** - `fa47970` (test)
2. **Task 1 GREEN: Implement delegating deterministic provider** - `862b045` (feat)

## Files Created/Modified

- `src/testing/deterministic-provider.ts` - Added `DelegatingProviderOptions` and `createDelegatingDeterministicProvider`.
- `src/testing/deterministic-provider.test.ts` - Added behavior and live coordinator dispatch coverage for the helper.

## Decisions Made

- The delegate fixture emits exactly one `delegate:` JSON block, then falls back to the coordinator participate shape used by replay-recursion tests.
- Child protocol defaults to `"sequential"` and child intent defaults to `"delegated child run"`, with both configurable through `DelegatingProviderOptions`.
- Child and subsequent coordinator calls return safe deterministic text, avoiding accidental recursive delegation loops.

## TDD Gate Compliance

- **RED:** `fa47970` added tests that failed because `createDelegatingDeterministicProvider` was not implemented.
- **GREEN:** `862b045` added the helper and made the focused Vitest suite and typecheck pass.
- **REFACTOR:** Not needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added required temperature to direct ModelRequest test helper**
- **Found during:** Task 1 (Add createDelegatingDeterministicProvider helper + co-located test)
- **Issue:** The direct provider-call test helper built a `ModelRequest` without the required `temperature` field, causing `pnpm run typecheck` to fail.
- **Fix:** Added `temperature: 0` to the test helper request object.
- **Files modified:** `src/testing/deterministic-provider.test.ts`
- **Verification:** `pnpm run typecheck` passed.
- **Committed in:** `862b045`

---

**Total deviations:** 1 auto-fixed (Rule 1).
**Impact on plan:** No scope change; the fix was required for the planned test to satisfy the strict `ModelRequest` contract.

## Issues Encountered

- Initial GREEN typecheck failed on the missing `temperature` field in the test helper. Fixed in the GREEN commit and reran the focused test plus typecheck successfully.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm vitest run src/testing/deterministic-provider.test.ts` - passed, 4 tests.
- `pnpm run typecheck` - passed.
- Acceptance grep/file checks all passed:
  - `export function createDelegatingDeterministicProvider` count: 1
  - `export interface DelegatingProviderOptions` count: 1
  - `"delegate:"` in provider source: 1
  - `participation: contribute` in provider source: 1
  - `src/testing/deterministic-provider.test.ts` exists
  - `sub-run-started` in test source: 1
  - `sub-run-completed` in test source: 1
  - `createDelegatingDeterministicProvider` in test source: 6
  - `createDelegatingDeterministicProvider` in provider source: 1

## Known Stubs

None.

## Next Phase Readiness

Ready for 09-01. Phase 9 plans can now use `createDelegatingDeterministicProvider` for live coordinator-dispatch contract assertions without synthetic sub-run events.

## Self-Check: PASSED

- Found `src/testing/deterministic-provider.ts`.
- Found `src/testing/deterministic-provider.test.ts`.
- Found `.planning/phases/09-otel-tracing-bridge/09-00-SUMMARY.md`.
- Found RED commit `fa47970`.
- Found GREEN commit `862b045`.

---
*Phase: 09-otel-tracing-bridge*
*Completed: 2026-05-01*
