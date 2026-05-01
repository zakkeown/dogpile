---
phase: 04-streaming-child-error-escalation
plan: 04
subsystem: runtime
tags: [errors, timeout, replay, changelog]

requires:
  - phase: 04-streaming-child-error-escalation
    provides: parentRunIds stream wrapping, cancel drain, coordinator failure context, onChildFailure abort snapshot
provides:
  - terminal child failure throw matrix with runtime instance preservation
  - replay reconstruction of terminal child failures as DogpileError
  - provider-timeout detail.source discrimination for provider vs engine timeouts
  - v0.4.0 Phase 1-4 public-surface CHANGELOG inventory
affects: [05-documentation-changelog, public-error-api, cancellation-contracts]

tech-stack:
  added: []
  patterns:
    - per-run failureInstancesByChildRunId Map for runtime-only DogpileError identity
    - serialized replay failure reconstruction from sub-run-failed payloads
    - classifyChildTimeoutSource helper shared by engine and coordinator paths

key-files:
  created:
    - .planning/phases/04-streaming-child-error-escalation/04-04-SUMMARY.md
  modified:
    - src/runtime/coordinator.ts
    - src/runtime/engine.ts
    - src/runtime/cancellation.ts
    - src/types.ts
    - src/providers/openai-compatible.ts
    - src/tests/public-error-api.test.ts
    - src/tests/cancellation-contract.test.ts
    - src/tests/event-schema.test.ts
    - src/runtime/coordinator.test.ts
    - CHANGELOG.md

key-decisions:
  - "Replay implementation lives in src/runtime/engine.ts in this codebase; no src/runtime/replay.ts file was created."
  - "Runtime terminal throw selection is evaluated in engine result handling because coordinator traces always end with a final event, including fallback final events after budget stops."
  - "Child engine deadlines are enforced at the per-child AbortController in coordinator dispatch."

patterns-established:
  - "Synthetic sub-run-failed entries are excluded by map membership at runtime and by detail.reason during replay."
  - "Provider-timeout detail.source is additive; absence remains provider-compatible."

requirements-completed: [ERROR-02, ERROR-03]

duration: 13min
completed: 2026-05-01
---

# Phase 04 Plan 04: Throw And Timeout Discrimination Summary

**Terminal child failures now re-throw deterministically with runtime identity, replay reconstruction, and provider-vs-engine timeout source discrimination**

## Performance

- **Duration:** 13 min
- **Started:** 2026-05-01T14:25:29Z
- **Completed:** 2026-05-01T14:38:39Z
- **Tasks:** 4
- **Files modified:** 13

## Accomplishments

- Added per-run `failureInstancesByChildRunId: Map<string, DogpileError>` and populated it before `errorPayloadFromUnknown()` serializes real child failures.
- Implemented terminal throw selection in `src/runtime/engine.ts`: cancel/depth errors stay verbatim, `onChildFailure: "abort"` throws the snapshotted triggering child failure, and budget terminal paths throw the last real child failure by event order.
- Added replay reconstruction of terminal child failures from serialized `sub-run-failed.error` payloads; replay throws a fresh `DogpileError` with matching code, providerId, message, and detail.
- Added `classifyChildTimeoutSource()` plus child-engine deadline enforcement and `detail.source` stamping for provider and engine timeout cases.
- Updated the v0.4.0 CHANGELOG with the full Phase 1-4 public-surface inventory and the "original DogpileError unwrapped" clarification.

## Task Commits

1. **Task 1: Capture child failure instances** - `4021d64` (feat)
2. **Task 2: Terminal child failure throw matrix** - `4e4e0ce` (feat)
3. **Task 3: Timeout source discrimination** - `ac765d0` (feat)
4. **Task 4: v0.4.0 public surface changelog** - `d009d7d` (docs)
5. **Verification fix: align abort-mode coordinator tests** - `f3218e8` (fix)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `src/runtime/coordinator.ts` - Populates `failureInstancesByChildRunId`, enforces child engine deadlines on the per-child controller, preserves provider-timeout source, and filters synthetic failures.
- `src/runtime/engine.ts` - Reads `failureInstancesByChildRunId`, resolves runtime terminal throws, reconstructs replay terminal throws, and clears per-run maps on completion.
- `src/runtime/cancellation.ts` - Adds `classifyChildTimeoutSource()` and engine-deadline timeout construction.
- `src/types.ts` - Documents the optional provider-timeout `detail.source` discriminator.
- `src/providers/openai-compatible.ts` - Adds `detail.source: "provider"` to HTTP 408/504 provider-timeout errors.
- `src/tests/public-error-api.test.ts` - Locks success, last-real, cancel-wins, depth-overflow, abort-mode, replay, and degenerate terminal behavior.
- `src/tests/cancellation-contract.test.ts` - Locks provider, engine, parent-budget, backwards-compatible, and helper timeout-source behavior.
- `src/tests/event-schema.test.ts` - Locks provider-timeout source literals.
- `src/runtime/coordinator.test.ts` - Aligns abort-mode expectations with 04-04 re-throw behavior.
- `CHANGELOG.md` - Adds Phase 4 streaming and child error escalation inventory.

## Termination Matrix

| Termination path | Implemented throw behavior |
| --- | --- |
| Coordinator completes with synthesized final and no terminal stop | No re-throw |
| Budget/maxIterations/maxRounds/maxCost terminal stop with real child failures | Re-throw last real child `DogpileError` instance from `failureInstancesByChildRunId` |
| `onChildFailure: "abort"` | Re-throw snapshotted triggering child failure from `trace.triggeringFailureForAbortMode` via map lookup |
| Replay of terminal child failure | Reconstruct fresh `DogpileError` from serialized payload |
| Explicit stream/caller cancel | Existing cancel error wins verbatim |
| Depth overflow | Existing depth-overflow `invalid-configuration` error wins verbatim |
| Synthetic `sibling-failed` / `parent-aborted` failures | Excluded from real-failure candidate set |

## Timeout Source Spec

`classifyChildTimeoutSource(error, { decisionTimeoutMs?, engineDefaultTimeoutMs?, isProviderError })` returns:

- `"provider"` when `isProviderError` is true.
- `"engine"` when the timeout was produced by a child engine deadline from a decision/default sub-run timeout.
- `"provider"` as the backwards-compatible fallback when no source can be proven.

Observable cases:

- Provider HTTP timeout: `code: "provider-timeout"`, `detail.source: "provider"`.
- Child engine deadline: `code: "provider-timeout"`, `detail.source: "engine"`.
- Parent budget propagation: `code: "aborted"`, `detail.reason: "timeout"`.

## Decisions Made

- Kept replay changes in `src/runtime/engine.ts` because this repository implements `replay()` there; the plan's `src/runtime/replay.ts` path is stale.
- Used engine result handling for terminal throw selection because coordinator traces still append a `final` event for fallback terminal states.
- Added actual child-deadline enforcement to the per-child controller in `dispatchDelegate`; this was required for ERROR-03 to be observable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Implemented replay reconstruction in the live engine file**
- **Found during:** Task 2 read-first gate
- **Issue:** The plan referenced `src/runtime/replay.ts`, but replay/replayStream are implemented in `src/runtime/engine.ts`.
- **Fix:** Added `resolveReplayTerminalThrow()` and `reconstructLastRealFailure()` in `src/runtime/engine.ts`.
- **Files modified:** `src/runtime/engine.ts`
- **Verification:** `pnpm vitest run src/tests/public-error-api.test.ts -t "replay.*instanceof|replay.*payload"`
- **Committed in:** `4e4e0ce`

**2. [Rule 2 - Missing Critical] Enforced child engine deadlines at the coordinator's per-child controller**
- **Found during:** Task 3 timeout-source tests
- **Issue:** Recursive child protocol calls did not go through the top-level engine timeout wrapper, so `defaultSubRunTimeoutMs` was metadata without an aborting deadline.
- **Fix:** Added a child deadline timer in `dispatchDelegate` that aborts the child controller with `provider-timeout` / `detail.source: "engine"` when the timeout is child-owned.
- **Files modified:** `src/runtime/coordinator.ts`
- **Verification:** `pnpm vitest run src/tests/cancellation-contract.test.ts -t "provider.*timeout.*source"`
- **Committed in:** `ac765d0`

**3. [Rule 1 - Bug] Aligned 04-03 abort-mode tests with 04-04 throw semantics**
- **Found during:** Plan-level focused verification
- **Issue:** Older coordinator tests still expected `onChildFailure: "abort"` to return a trace instead of throwing the triggering child failure.
- **Fix:** Updated those assertions to expect the F1 `provider-timeout` re-throw while preserving the no-follow-up-plan-turn check.
- **Files modified:** `src/runtime/coordinator.test.ts`
- **Verification:** Focused Phase 4 suite passed.
- **Committed in:** `f3218e8`

---

**Total deviations:** 3 auto-fixed (Rule 1: 1, Rule 2: 1, Rule 3: 1)  
**Impact on plan:** All deviations were required to land the specified public behavior in the current codebase shape.

## Issues Encountered

- The literal "terminate without final event" wording did not match the current coordinator implementation, which always appends a final event. The implementation treats terminal fallback finals with termination metadata as eligible for child failure escalation.

## Known Stubs

None.

## Threat Flags

None - no new network endpoints, auth paths, file access patterns, or trust-boundary schema changes were introduced.

## Verification

- `pnpm vitest run src/tests/public-error-api.test.ts`
- `pnpm vitest run src/tests/cancellation-contract.test.ts src/tests/event-schema.test.ts`
- `pnpm vitest run src/tests/public-error-api.test.ts src/tests/cancellation-contract.test.ts src/tests/event-schema.test.ts src/tests/result-contract.test.ts src/tests/streaming-api.test.ts src/tests/config-validation.test.ts src/runtime/coordinator.test.ts`
- `pnpm run typecheck`
- `pnpm run verify`

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for Phase 5 documentation and examples. Phase 4 STREAM-01/02/03 and ERROR-01/02/03 are implemented and release-gate verified.

## Self-Check: PASSED

- Summary file exists.
- Task commits exist: `4021d64`, `4e4e0ce`, `ac765d0`, `d009d7d`, `f3218e8`.
- Plan verification passed: focused Phase 4 suite and `pnpm run verify`.

---
*Phase: 04-streaming-child-error-escalation*
*Completed: 2026-05-01*
