---
phase: 04-streaming-child-error-escalation
plan: 01
subsystem: streaming
tags: [streaming, events, replay, recursive-coordination]

requires:
  - phase: 01-delegate-decision-sub-run-traces
    provides: delegate sub-run traces and embedded child results
  - phase: 02-budget-cancellation-cost-rollup
    provides: parent-events isolation invariants
  - phase: 03-provider-locality-bounded-concurrency
    provides: parallel delegate dispatch and sub-run lifecycle events
provides:
  - parentRunIds ancestry chain on stream lifecycle and output event types
  - live child-event bubbling with root-first ancestry chains
  - replayStream ancestry reconstruction for embedded child traces
  - STREAM-01 and STREAM-02 contract tests
affects: [04-streaming-child-error-escalation, 05-documentation-changelog]

tech-stack:
  added: []
  patterns:
    - stream-only child-event wrapping via internal streamEvents flag
    - replay stream expansion from embedded subResult traces

key-files:
  created:
    - .planning/phases/04-streaming-child-error-escalation/04-01-SUMMARY.md
  modified:
    - src/types/events.ts
    - src/runtime/coordinator.ts
    - src/runtime/engine.ts
    - src/tests/event-schema.test.ts
    - src/tests/result-contract.test.ts
    - src/tests/streaming-api.test.ts
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "parentRunIds is the only ancestry shape; no flat parentRunId field was added."
  - "Child event ancestry is live-stream-only; persisted parent and child traces stay chain-free."
  - "replayStream reconstructs child ancestry from embedded subResult traces instead of persisting chains."

patterns-established:
  - "Internal streamEvents flag gates stream-only behavior that must not alter non-streaming RunResult traces."
  - "Replay stream expansion emits embedded child events at sub-run-completed boundaries with reconstructed parentRunIds."

requirements-completed: [STREAM-01, STREAM-02]

duration: 12min
completed: 2026-05-01
---

# Phase 04 Plan 01: Stream Wrapping Summary

**Live child stream events now carry root-first parentRunIds ancestry while persisted traces remain chain-free**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-01T13:45:57Z
- **Completed:** 2026-05-01T13:57:51Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Added optional `readonly parentRunIds?: readonly string[]` to every `StreamLifecycleEvent` and `StreamOutputEvent` variant.
- Wrapped bubbled child events in live streams with root-first ancestry, including grandchild chains.
- Kept parent `RunResult.events` and embedded child `subResult.trace.events` free of `parentRunIds`.
- Expanded `replayStream()` so replayed delegated streams reconstruct the same ancestry chain as live runs.

## Task Commits

1. **Task 1 RED: parentRunIds public surface tests** - `9c388ca` (test)
2. **Task 1 GREEN: parentRunIds event surface** - `174f8f8` (feat)
3. **Task 2 RED: stream ancestry contract tests** - `68a63b9` (test)
4. **Task 2 GREEN: live and replay stream wrapping** - `60e52cc` (feat)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `src/types/events.ts` - Added optional ancestry field to stream lifecycle/output interfaces.
- `src/runtime/coordinator.ts` - Wrapped child events only for live stream bubbling while preserving original child trace buffers.
- `src/runtime/engine.ts` - Added internal stream-only flag and replayStream ancestry expansion.
- `src/tests/event-schema.test.ts` - Locked optional `parentRunIds` coverage and parent-emitted sub-run absence.
- `src/tests/result-contract.test.ts` - Locked D-04 persisted trace isolation for delegated runs.
- `src/tests/streaming-api.test.ts` - Locked STREAM-01 depth 1/depth 2 wrapping, STREAM-02 per-child order, D-04 isolation, and replay reconstruction.

## Decisions Made

- Used root-first ancestry ordering: `[rootRunId, ..., immediateParentRunId]`.
- Treated the plan's `src/runtime/replay.ts` reference as stale; replay lives in `src/runtime/engine.ts`.
- Added an internal `streamEvents` flag because child bubbling is live-stream-only and must not leak into non-streaming trace collection.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prevented parentRunIds from leaking into non-streaming traces**
- **Found during:** Task 2 verification
- **Issue:** Once child events were wrapped, non-streaming `run()` collected bubbled child events via the same internal emit callback, violating D-04 isolation.
- **Fix:** Added an internal `streamEvents` flag so child bubbling is enabled for `stream()` but disabled for non-streaming trace collection.
- **Files modified:** `src/runtime/coordinator.ts`, `src/runtime/engine.ts`
- **Verification:** `pnpm vitest run src/tests/result-contract.test.ts -t "parent events isolation"` and full plan verification passed.
- **Committed in:** `60e52cc`

**2. [Rule 3 - Blocking] Implemented replay mirror in the actual engine file**
- **Found during:** Task 2 read-first gate
- **Issue:** The plan referenced `src/runtime/replay.ts`, but replay/replayStream are implemented in `src/runtime/engine.ts`.
- **Fix:** Added replayStream ancestry expansion in `src/runtime/engine.ts`.
- **Files modified:** `src/runtime/engine.ts`
- **Verification:** `pnpm vitest run src/tests/streaming-api.test.ts -t "replayStream reconstructs"` passed.
- **Committed in:** `60e52cc`

---

**Total deviations:** 2 auto-fixed (Rule 1: 1, Rule 3: 1)  
**Impact on plan:** Both changes preserve the planned public contract and avoid trace-shape drift.

## Issues Encountered

None beyond the auto-fixed items above.

## Known Stubs

None.

## Threat Flags

None - no new network endpoints, auth paths, file access patterns, or trust-boundary schema changes were introduced.

## Verification

- `pnpm run typecheck`
- `pnpm vitest run src/tests/streaming-api.test.ts src/tests/event-schema.test.ts src/tests/result-contract.test.ts`
- `pnpm vitest run src/tests/event-schema.test.ts -t "parentRunIds"`
- `pnpm vitest run src/tests/result-contract.test.ts -t "parent events isolation"`
- `pnpm vitest run src/tests/streaming-api.test.ts -t "STREAM-01"`
- `pnpm vitest run src/tests/streaming-api.test.ts -t "STREAM-02"`
- `pnpm vitest run src/tests/streaming-api.test.ts -t "D-04 isolation"`
- `pnpm vitest run src/tests/streaming-api.test.ts -t "replayStream reconstructs"`

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 04-02 cancel propagation. STREAM-01 and STREAM-02 are now locked, and STREAM-03 can build on the live child bubbling boundary without altering persisted trace isolation.

## Self-Check: PASSED

- Summary file exists.
- Task commits exist: `9c388ca`, `174f8f8`, `68a63b9`, `60e52cc`.
- Plan verification passed.

---
*Phase: 04-streaming-child-error-escalation*
*Completed: 2026-05-01*
