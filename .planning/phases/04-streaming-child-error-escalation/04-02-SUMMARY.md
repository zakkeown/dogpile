---
phase: 04-streaming-child-error-escalation
plan: 02
subsystem: streaming
tags: [streaming, cancellation, aborted-event, child-drain]

requires:
  - phase: 04-streaming-child-error-escalation
    provides: parentRunIds stream wrapping and live-only child bubbling
provides:
  - AbortedEvent stream lifecycle variant
  - synthetic parent-aborted sub-run-failed drain for in-flight children
  - per-child closed flag suppressing late forwarded child events
  - cancelled stream status and timeout reason contract coverage
affects: [04-streaming-child-error-escalation, 05-documentation-changelog]

tech-stack:
  added: []
  patterns:
    - internal coordinator abort-drain callback registered with stream engine
    - stream-only aborted lifecycle event before terminal error

key-files:
  created:
    - .planning/phases/04-streaming-child-error-escalation/04-02-SUMMARY.md
  modified:
    - src/runtime/coordinator.ts
    - src/runtime/engine.ts
    - src/types/events.ts
    - src/types.ts
    - src/index.ts
    - src/tests/event-schema.test.ts
    - src/tests/result-contract.test.ts
    - src/tests/streaming-api.test.ts
    - src/tests/cancellation-contract.test.ts
    - src/tests/budget-first-stop.test.ts
    - src/tests/run-bad-input.test.ts

key-decisions:
  - "The aborted lifecycle event is stream-only and is emitted before terminal error events on abort paths."
  - "Parent-aborted-after-completion keeps the terminal error pairing used by current stream cancellation semantics."
  - "Queued children are drained with existing sibling-failed vocabulary while started children use parent-aborted."

patterns-established:
  - "DispatchedChild.closed gates teed live forwarding while preserving the childEvents buffer."
  - "Engine stream cancellation calls the active coordinator abort-drain hook before publishing aborted/error."

requirements-completed: [STREAM-03]

duration: 11min
completed: 2026-05-01
---

# Phase 04 Plan 02: Cancel Propagation Summary

**Stream cancel now drains in-flight delegated children, emits an aborted lifecycle marker, and then terminates with the existing error event**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-01T14:00:25Z
- **Completed:** 2026-05-01T14:11:47Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Added `AbortedEvent` as a public `StreamLifecycleEvent` variant with shape `{ type: "aborted", runId, at, reason, detail?, parentRunIds? }`.
- Added a coordinator `drainOnParentAbort` hook that walks `DispatchedChild` records once: started children emit synthetic `sub-run-failed` with `detail.reason: "parent-aborted"`; queued children keep the existing `sibling-failed` vocabulary.
- Added `DispatchedChild.closed`; `teedEmit` still buffers child events for partial traces but suppresses live forwarding after a synthetic drain.
- Updated stream cancellation ordering to: drain children -> `aborted` lifecycle event -> terminal `error`.
- Locked parent-aborted-after-completion and timeout-reason behavior in cancellation/streaming tests.

## Task Commits

1. **Task 1 RED: aborted event surface tests** - `d540c36` (test)
2. **Task 1 GREEN: public AbortedEvent surface** - `b426eed` (feat)
3. **Task 2 RED: cancel child drain tests** - `fd48b51` (test)
4. **Task 2 GREEN: coordinator drain + engine aborted lifecycle** - `d4d4275` (feat)
5. **Task 3: aborted terminal path tests** - `c6a959f` (test)
6. **Rule 1 verification fix: align broader tests** - `64d5cae` (fix)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `src/types/events.ts` - Added `AbortedEvent` and included it in `StreamLifecycleEvent`.
- `src/types.ts`, `src/index.ts` - Re-exported `AbortedEvent` through the public SDK type surface.
- `src/runtime/coordinator.ts` - Added `DispatchedChild.closed`, child event buffering on the record, and `drainOnParentAbort`.
- `src/runtime/engine.ts` - Registered the coordinator drain hook and emits `aborted` before terminal stream errors.
- `src/tests/event-schema.test.ts` - Locked the `AbortedEvent` shape and parentRunIds serialization.
- `src/tests/result-contract.test.ts` - Locked that normal completed traces contain zero aborted lifecycle events.
- `src/tests/streaming-api.test.ts` - Locked STREAM-03 ordering and cancelled status.
- `src/tests/cancellation-contract.test.ts` - Locked parent-aborted vocabulary, after-completion behavior, and timeout reason mirroring.
- `src/tests/budget-first-stop.test.ts`, `src/tests/run-bad-input.test.ts` - Aligned broader tests with stream-only bubbling and aborted-before-error ordering.

## Decisions Made

- `aborted` is emitted on abort paths before the terminal `error`; the current stream semantics still reject `handle.result` with the abort/timeout error.
- Parent-aborted-after-completion emits `aborted` and then the terminal error, with zero synthetic `sub-run-failed` events because all children are already closed.
- The `reason: "timeout"` arm is selected when the underlying abort error is timeout-classed; otherwise abort lifecycle events use `parent-aborted`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Re-exported AbortedEvent from the root SDK surface**
- **Found during:** Task 1 typecheck
- **Issue:** The plan named `src/types.ts`, but tests import public event types from `src/index.ts`; without the root re-export, the new public type was not available to consumers.
- **Fix:** Added `AbortedEvent` to `src/index.ts` type exports.
- **Files modified:** `src/index.ts`
- **Verification:** `pnpm run typecheck`, `pnpm vitest run src/tests/event-schema.test.ts -t AbortedEvent`
- **Committed in:** `b426eed`

**2. [Rule 1 - Bug] Updated broader tests for the new aborted-before-error terminal sequence**
- **Found during:** Plan-level `pnpm run verify`
- **Issue:** Existing stream error tests expected the terminal `error` to be the first event after cancellation, and one budget test still expected child events in non-streaming parent traces.
- **Fix:** Adjusted the bad-input stream helper to consume `aborted` before `error`, and realigned the budget isolation test with 04-01's stream-only child bubbling rule.
- **Files modified:** `src/tests/run-bad-input.test.ts`, `src/tests/budget-first-stop.test.ts`
- **Verification:** `pnpm vitest run src/tests/budget-first-stop.test.ts src/tests/run-bad-input.test.ts`, final `pnpm run verify`
- **Committed in:** `64d5cae`

---

**Total deviations:** 2 auto-fixed (Rule 1: 1, Rule 2: 1)  
**Impact on plan:** Both changes preserve the planned STREAM-03 public contract and keep existing tests aligned with Phase 4 semantics.

## Issues Encountered

- Task 3 tests passed immediately because Task 2's engine hook already implemented the after-completion and timeout-reason behavior. The tests were still added to lock those paths by name.

## Known Stubs

None.

## Threat Flags

None - no new network endpoints, auth paths, file access patterns, or trust-boundary schema changes were introduced.

## Verification

- `pnpm run typecheck`
- `pnpm vitest run src/tests/event-schema.test.ts src/tests/result-contract.test.ts`
- `pnpm vitest run src/tests/streaming-api.test.ts src/tests/cancellation-contract.test.ts src/tests/event-schema.test.ts src/runtime/coordinator.test.ts`
- `pnpm vitest run src/tests/cancellation-contract.test.ts src/tests/streaming-api.test.ts`
- `pnpm vitest run src/tests/budget-first-stop.test.ts src/tests/run-bad-input.test.ts`
- `pnpm vitest run src/tests/event-schema.test.ts -t AbortedEvent`
- `pnpm vitest run src/tests/streaming-api.test.ts -t "STREAM-03"`
- `pnpm vitest run src/tests/streaming-api.test.ts -t "late-event suppression"`
- `pnpm vitest run src/tests/cancellation-contract.test.ts -t "parent-aborted"`
- `pnpm vitest run src/tests/cancellation-contract.test.ts -t "parent-aborted-after-completion|aborted.*reason.*timeout"`
- `pnpm vitest run src/tests/streaming-api.test.ts -t "status.*cancelled"`
- `pnpm run verify`

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 04-03 coordinator failure context. STREAM-03 is now locked, and 04-03 can build on the `sub-run-failed` synthetic vocabulary and child failure surfaces without changing cancel ordering.

## Self-Check: PASSED

- Summary file exists.
- Task commits exist: `d540c36`, `b426eed`, `fd48b51`, `d4d4275`, `c6a959f`, `64d5cae`.
- Plan verification passed: `pnpm run verify`.

---
*Phase: 04-streaming-child-error-escalation*
*Completed: 2026-05-01*
