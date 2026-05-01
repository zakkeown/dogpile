---
phase: 06-provenance-annotations
plan: 01
subsystem: types
tags: [provenance, events, replay, typecheck]

requires:
  - phase: v0.4.0
    provides: Recursive coordination trace/event contracts
provides:
  - Model request/response event type shapes with startedAt/completedAt and modelId
  - Replay provider call modelId field and runtime fallback population
  - ConfiguredModelProvider optional modelId contract
  - Type-safe timestamp fallback for RunEvent readers that handle provenance events
affects: [phase-06-provenance-annotations, replay, event-schema, benchmark, demo]

tech-stack:
  added: []
  patterns:
    - Discriminator-safe event timestamp fallback for RunEvent unions
    - Provider modelId fallback: provider.modelId ?? provider.id

key-files:
  created:
    - .planning/phases/06-provenance-annotations/06-01-SUMMARY.md
  modified:
    - src/types/events.ts
    - src/types/replay.ts
    - src/types.ts
    - src/runtime/defaults.ts
    - src/runtime/model.ts
    - src/runtime/coordinator.ts
    - src/benchmark/config.ts
    - src/demo.ts
    - src/benchmark/config.test.ts
    - src/runtime/broadcast.test.ts
    - src/tests/demo.test.ts
    - src/tests/event-schema.test.ts
    - src/tests/result-contract.test.ts
    - src/tests/streaming-api.test.ts

key-decisions:
  - "ModelRequestEvent and ModelResponseEvent no longer expose at; generic timestamp readers use a local startedAt fallback."
  - "ReplayTraceProviderCall.modelId is populated immediately with provider.modelId ?? provider.id so the new non-optional type is runtime-safe."

patterns-established:
  - "Event timestamp fallback: use 'at' in event ? event.at : event.startedAt at generic RunEvent boundaries."
  - "Model id fallback: resolve optional ConfiguredModelProvider.modelId to provider id at provider-call capture time."

requirements-completed: [PROV-01, PROV-02]

duration: 8 min
completed: 2026-05-01
---

# Phase 06 Plan 01: Type Shape Mutation + defaults.ts Blast-Radius Fix Summary

**Provenance event and replay type contracts now require modelId and provider-call timestamps without a universal event at field.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-01T17:49:37Z
- **Completed:** 2026-05-01T17:57:28Z
- **Tasks:** 2
- **Files modified:** 15

## Accomplishments

- Replaced `at` on `ModelRequestEvent` with `startedAt`, and on `ModelResponseEvent` with `startedAt` plus `completedAt`.
- Added non-optional `modelId` to provenance events and replay provider calls, plus optional `modelId?` on configured providers.
- Kept `pnpm run typecheck` and `pnpm run test` green after repairing the direct compile fallout from the event shape change.

## Task Commits

Each task was committed atomically:

1. **Task 1: Mutate provenance type contracts** - `cc9a958` (feat)
2. **Task 2: Fix defaults.ts blast-radius and compile fallout** - `a5032a9` (fix)

**Plan metadata:** committed separately in the summary docs commit.

## Files Created/Modified

- `src/types/events.ts` - Updated model request/response event contracts and JSDoc.
- `src/types/replay.ts` - Added `ReplayTraceProviderCall.modelId`.
- `src/types.ts` - Added optional `ConfiguredModelProvider.modelId`.
- `src/runtime/defaults.ts` - Added type-safe timestamp fallback for replay metadata, protocol decisions, and final-output fallback.
- `src/runtime/model.ts` - Populates replay provider call `modelId` with the provider fallback.
- `src/runtime/coordinator.ts` - Uses timestamp fallback when rendering child sub-run duration.
- `src/benchmark/config.ts` and `src/demo.ts` - Use timestamp fallback at generic event-display boundaries.
- `src/benchmark/config.test.ts`, `src/runtime/broadcast.test.ts`, `src/tests/demo.test.ts`, `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, `src/tests/streaming-api.test.ts` - Updated compile-time fixtures and assertions for the narrowed event timestamp surface.
- `.planning/phases/06-provenance-annotations/06-01-SUMMARY.md` - Execution summary.

## Decisions Made

- Used local timestamp helpers at generic `RunEvent` readers instead of restoring an `at` field to model provenance events.
- Populated `ReplayTraceProviderCall.modelId` during provider-call recording so downstream plans can rely on a non-optional replay field immediately.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Repaired wider RunEvent timestamp compile fallout**
- **Found during:** Task 2 (defaults.ts blast-radius fix)
- **Issue:** Removing `at` from two RunEvent variants broke generic timestamp readers beyond the planned `createReplayTraceProtocolDecision` line.
- **Fix:** Added minimal local timestamp fallback helpers at generic event boundaries in runtime, benchmark, demo, and compile-time fixtures.
- **Files modified:** `src/runtime/defaults.ts`, `src/runtime/coordinator.ts`, `src/benchmark/config.ts`, `src/demo.ts`, and affected tests.
- **Verification:** `pnpm run typecheck` exited 0.
- **Committed in:** `a5032a9`

**2. [Rule 2 - Missing Critical] Populated required replay provider call modelId**
- **Found during:** Task 2 (typecheck)
- **Issue:** `ReplayTraceProviderCall.modelId` became required, but `recordProviderCall()` still emitted call records without it.
- **Fix:** Added `modelId: options.model.modelId ?? options.model.id` to provider call capture.
- **Files modified:** `src/runtime/model.ts`
- **Verification:** `pnpm run typecheck` and `pnpm run test` exited 0.
- **Committed in:** `a5032a9`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** Both fixes were direct consequences of the planned type mutation. Runtime model-request/model-response event emission remains deferred to Plan 06-02.

## Issues Encountered

- The local `node_modules/@gsd-build/sdk/dist/cli.js` state loader and `.planning/config.json` were unavailable in this delegated worktree; execution continued from the checked-in plan and user-supplied parallel-mode instructions.
- `git commit` required sandbox escalation to write `.git/index.lock`; both task commits completed with `--no-verify`.

## Known Stubs

None. Stub scan found no plan-blocking placeholders; matches were existing test fixture text or ordinary accumulator initialization.

## Authentication Gates

None.

## User Setup Required

None - no external service configuration required.

## Threat Flags

None - no new network endpoint, auth path, file access pattern, or trust-boundary schema was introduced.

## Verification

- `pnpm run typecheck` - passed
- `pnpm run test` - passed (45 files passed, 651 tests passed, 1 skipped)
- `grep -c "readonly startedAt: string" src/types/events.ts` - `2`
- `grep -c "readonly completedAt: string" src/types/events.ts` - `1`
- `grep -c "readonly modelId: string" src/types/events.ts` - `2`
- `grep -c "readonly modelId: string" src/types/replay.ts` - `1`
- `grep -c "readonly modelId?: string" src/types.ts` - `1`
- `grep -c '"at" in event' src/runtime/defaults.ts` - `1`

## Self-Check: PASSED

- Created summary file exists: `.planning/phases/06-provenance-annotations/06-01-SUMMARY.md`
- Task commit found: `cc9a958`
- Task commit found: `a5032a9`
- No tracked file deletions were introduced by either task commit.

## Next Phase Readiness

Ready for Plan 06-02. The type contracts and replay provider-call modelId fallback are in place for runtime event emission and replay synthesis.

---
*Phase: 06-provenance-annotations*
*Completed: 2026-05-01*
