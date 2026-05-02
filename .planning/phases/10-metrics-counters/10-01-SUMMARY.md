---
phase: 10-metrics-counters
plan: 01
subsystem: runtime
tags: [metrics, counters, public-api, types, tdd]

requires:
  - phase: 09-otel-tracing-bridge
    provides: Tracer mirroring pattern for EngineOptions and DogpileOptions
provides:
  - MetricsHook and RunMetricsSnapshot contract surface
  - metricsHook and logger fields on DogpileOptions
  - metricsHook and logger fields on EngineOptions
  - Co-located structural tests for the metrics contract
affects: [runtime, public-api, metrics, engine-integration]

tech-stack:
  added: []
  patterns:
    - Pure runtime type module with no imports or side effects
    - Type-only imports from runtime subpath modules into src/types.ts
    - TDD contract test before public surface implementation

key-files:
  created:
    - src/runtime/metrics.ts
    - src/runtime/metrics.test.ts
  modified:
    - src/types.ts

key-decisions:
  - "MetricsHook and RunMetricsSnapshot are defined in a self-contained runtime module; package subpath wiring remains deferred to Plan 03."
  - "metricsHook and logger mirror the existing tracer field on both DogpileOptions and EngineOptions."
  - "No root export was added for metrics types, preserving the Phase 10 D-12 subpath-only decision."

patterns-established:
  - "Metrics contract tests can import types from ./metrics.js before engine behavior exists."
  - "Public option fields for observability surfaces are mirrored on DogpileOptions and EngineOptions immediately after tracer."

requirements-completed: [METR-01, METR-02]

duration: 4 min
completed: 2026-05-02
---

# Phase 10 Plan 01: Metrics Contract Surface Summary

**MetricsHook and RunMetricsSnapshot type contracts with mirrored engine/public options for Plan 02 integration**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-02T00:57:58Z
- **Completed:** 2026-05-02T01:01:52Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `src/runtime/metrics.ts` with the locked 9-field `RunMetricsSnapshot` shape and optional `MetricsHook` callbacks.
- Added co-located Vitest structural tests for snapshots, terminal outcomes, and optional hook callbacks.
- Added type-only `Logger` and `MetricsHook` imports to `src/types.ts`.
- Mirrored `metricsHook?: MetricsHook` and `logger?: Logger` on both `DogpileOptions` and `EngineOptions`.
- Preserved the Phase 10 decision to avoid root exports and defer package subpath wiring to Plan 03.

## TDD Record

- **RED:** `7ede4cd` added `src/runtime/metrics.test.ts`; `pnpm vitest run src/runtime/metrics.test.ts` failed as expected because `./metrics.js` did not exist.
- **GREEN:** `7b7cac9` added `src/runtime/metrics.ts`; the focused Vitest command passed with 5 tests.
- **REFACTOR:** No refactor commit was needed.

## Task Commits

1. **Task 1 RED: Create co-located metrics contract test** - `7ede4cd` (test)
2. **Task 1 GREEN: Create metrics contract module** - `7b7cac9` (feat)
3. **Task 2: Wire metricsHook and logger options** - `2d72204` (feat)

## Files Created/Modified

- `src/runtime/metrics.ts` - Defines `RunMetricsSnapshot` and `MetricsHook` with readonly fields and zero imports.
- `src/runtime/metrics.test.ts` - Verifies structural type compatibility for snapshots and hooks.
- `src/types.ts` - Adds type-only imports and mirrored `metricsHook?` / `logger?` fields on public option interfaces.

## Decisions Made

- Followed the existing tracer pattern for importing public runtime types into `src/types.ts`.
- Kept metrics root exports out of `src/index.ts`; `/runtime/metrics` package wiring is still Plan 03 work.
- Did not add runtime hook firing logic; Plan 02 owns engine lifecycle integration.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The GSD `query` interface was unavailable as noted in the prompt, so plan execution used direct file edits and normal git commands.

## Verification

- `pnpm vitest run src/runtime/metrics.test.ts` - passed, 5 tests.
- `pnpm run typecheck` - passed.
- `rg -c "metricsHook\\?: MetricsHook" src/types.ts` - `2`.
- `rg -c "logger\\?: Logger" src/types.ts` - `2`.
- `rg -n "from.*runtime/metrics" src/index.ts` - no matches.
- `rg -n "^import" src/runtime/metrics.ts` - no matches.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can now wire `MetricsHook` into the engine metrics state lifecycle using the newly available public types and option fields.

## Self-Check: PASSED

- Found `src/runtime/metrics.ts`.
- Found `src/runtime/metrics.test.ts`.
- Found `.planning/phases/10-metrics-counters/10-01-SUMMARY.md`.
- Found commits `7ede4cd`, `7b7cac9`, and `2d72204`.
- Plan-level verification passed.

---
*Phase: 10-metrics-counters*
*Completed: 2026-05-02*
