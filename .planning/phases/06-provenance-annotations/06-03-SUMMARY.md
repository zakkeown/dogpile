---
phase: 06-provenance-annotations
plan: 03
subsystem: providers
tags: [provenance, model-id, provider-adapters, typecheck]

requires:
  - phase: 06-provenance-annotations
    provides: Plan 06-01 ConfiguredModelProvider.modelId contract and Plan 06-02 runtime provenance fallback
provides:
  - OpenAI-compatible adapter modelId population from the configured model string
  - Internal Vercel AI adapter modelId population from string or LanguageModel inputs
  - Adapter-level provenance identifiers for live model-request/model-response events
affects: [phase-06-provenance-annotations, provider-adapters, provenance-events]

tech-stack:
  added: []
  patterns:
    - Adapter modelId mirrors the caller-supplied model identifier
    - Vercel AI object models read the typed LanguageModel.modelId property directly

key-files:
  created:
    - .planning/phases/06-provenance-annotations/06-03-SUMMARY.md
  modified:
    - src/providers/openai-compatible.ts
    - src/internal/vercel-ai.ts

key-decisions:
  - "OpenAI-compatible providers expose options.model as ConfiguredModelProvider.modelId."
  - "Vercel AI providers expose string model inputs directly and object model inputs via LanguageModel.modelId."

patterns-established:
  - "Provider adapters should populate ConfiguredModelProvider.modelId when their construction options identify a concrete model."

requirements-completed: [PROV-01]

duration: 3 min
completed: 2026-05-01
---

# Phase 06 Plan 03: Provider Adapter modelId Population Summary

**OpenAI-compatible and Vercel AI provider adapters now carry concrete model identifiers into Dogpile provenance events.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-01T18:14:09Z
- **Completed:** 2026-05-01T18:16:43Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `modelId: options.model` to `createOpenAICompatibleProvider()` so the public adapter reports the configured model string.
- Added `modelId` to `createVercelAIProvider()` so string inputs and Vercel `LanguageModel` objects report concrete model names.
- Verified both adapter edits with `pnpm run typecheck`; adapter-focused Vercel tests also pass.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add modelId to createOpenAICompatibleProvider return object** - `9e91050` (feat)
2. **Task 2: Add modelId to createVercelAIProvider return object** - `a3c1260` (feat)

**Plan metadata:** committed separately in the summary docs commit.

## Files Created/Modified

- `src/providers/openai-compatible.ts` - Populates `ConfiguredModelProvider.modelId` from `options.model`.
- `src/internal/vercel-ai.ts` - Populates `ConfiguredModelProvider.modelId` from a string model input or `LanguageModel.modelId`.
- `.planning/phases/06-provenance-annotations/06-03-SUMMARY.md` - Execution summary.

## Decisions Made

- Used the typed `LanguageModel.modelId` property directly for Vercel object models rather than an optional record cast. This keeps the returned provider object compatible with `exactOptionalPropertyTypes`.
- Kept changes limited to the two adapter return objects; no public exports, package files, or runtime event logic changed in this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Avoided optional undefined modelId on Vercel provider**
- **Found during:** Task 2 (Vercel AI adapter implementation)
- **Issue:** The plan's suggested optional record cast could produce `string | undefined`, which is not a clean fit for `ConfiguredModelProvider.modelId?: string` under `exactOptionalPropertyTypes` when the property is present.
- **Fix:** Read `options.model.modelId` directly after the string guard; the AI SDK `LanguageModel` object type exposes `modelId: string`.
- **Files modified:** `src/internal/vercel-ai.ts`
- **Verification:** `pnpm run typecheck` exited 0.
- **Committed in:** `a3c1260`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Behavior matches the plan. The adjustment only tightened the TypeScript expression used to source the Vercel object-model id.

## Issues Encountered

- `pnpm run test` failed in the current wave worktree with 47 failures. The failures expect the pre-provenance event order and receive the `model-request` / `model-response` events introduced by Plan 06-02; no failures pointed to the adapter `modelId` fields changed here.
- Adapter-focused verification passed with `pnpm vitest run src/internal/vercel-ai-provider.test.ts src/tests/config-validation.test.ts` (134 tests).

## Deferred Issues

- Full-suite event-order expectation updates remain outside Plan 06-03 scope. This executor did not modify broad runtime/test contracts that belong to Plan 06-02 or later wave reconciliation.

## Known Stubs

None. Stub scan only found ordinary empty-object accumulators and null checks in existing adapter helper code.

## Authentication Gates

None.

## User Setup Required

None - no external service configuration required.

## Threat Flags

None - no new network endpoint, auth path, file access pattern, or trust-boundary schema was introduced.

## Verification

- `git merge-base --is-ancestor 9f12116adf16cf1afb10b42663999cb836bd6bbe HEAD` - passed before edits.
- `grep -c "modelId: options.model" src/providers/openai-compatible.ts` - `1`
- `grep -c "modelId:" src/internal/vercel-ai.ts` - `2`
- `pnpm run typecheck` - passed after each task and after both commits.
- `pnpm vitest run src/internal/vercel-ai-provider.test.ts src/tests/config-validation.test.ts` - passed (134 tests).
- `pnpm run test` - failed with the existing broad provenance event-order baseline mismatch described above.

## Self-Check: PASSED

- Created summary file exists: `.planning/phases/06-provenance-annotations/06-03-SUMMARY.md`
- Task commit found: `9e91050`
- Task commit found: `a3c1260`
- No tracked file deletions were introduced by task commits.
- `.planning/STATE.md` and `.planning/ROADMAP.md` have no diff from this executor.

## Next Phase Readiness

Ready for Plan 06-04 from an adapter standpoint. Both configured adapters now provide `modelId`, so runtime provenance events can report concrete model identifiers instead of falling back to provider ids.

---
*Phase: 06-provenance-annotations*
*Completed: 2026-05-01*
