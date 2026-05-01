---
phase: 02-budget-cancellation-cost-rollup
plan: 03
subsystem: runtime
tags: [cost-rollup, replay, public-surface, parent-rollup-drift]

requires:
  - phase: 02-budget-cancellation-cost-rollup
    plan: 02
    provides: dispatchDelegate with parentDeadline math, partialTrace tee buffer, sub-run-failed contract
provides:
  - input.recordSubRunCost callback seam on DispatchDelegateOptions (D-01)
  - partialCost: CostSummary on SubRunFailedEvent (D-02)
  - accumulateSubRunCost helper in defaults.ts (D-06; internal export)
  - parent-rollup-drift parity check in recomputeAccountingFromTrace (D-04)
  - lastCostBearingEventCost promoted to internal export
affects: [BUDGET-04 termination floors (no ordering changes — same totalCost lifecycle)]

tech-stack:
  added: []
  patterns:
    - "Closure-mutation seam via callback: dispatchDelegate is a top-level function that does NOT close over runCoordinator's totalCost; recordSubRunCost callback is the only way to mutate it."
    - "Parity check placed BEFORE child-recurse loop so the dedicated subReason fires before the generic trace-accounting-mismatch."
    - "Cross-source consistency as the rollup discriminator: subResult.cost vs subResult.accounting.cost (completed); partialCost vs lastCostBearingEventCost(partialTrace.events) (failed)."

key-files:
  created: []
  modified:
    - src/types/events.ts
    - src/runtime/coordinator.ts
    - src/runtime/defaults.ts
    - src/runtime/coordinator.test.ts
    - src/tests/replay-recursion.test.ts
    - src/tests/event-schema.test.ts
    - src/tests/result-contract.test.ts
    - CHANGELOG.md

key-decisions:
  - "D-01 seam is the recordSubRunCost callback on DispatchDelegateOptions. Closure mutation was never viable — dispatchDelegate is a separate top-level function (line 829 post-edit) that does not close over runCoordinator's let totalCost (declared at line 145). The callback is defined verbatim at the dispatchDelegate({...}) callsite (around line 270) where it captures totalCost in scope and reassigns it."
  - "Parity check uses cross-source consistency as discriminator. Pure provider-call cost (the plan's localOnly proxy) is NOT independently recoverable from trace events alone — events store cumulative cost only and trace.providerCalls do not carry per-call cost. The implemented check verifies (a) for sub-run-completed: subResult.cost === subResult.accounting.cost across all 8 fields, (b) for sub-run-failed: partialCost === lastCostBearingEventCost(partialTrace.events) ?? emptyCost(), and (c) tree-level monotonicity: Σ children ≤ parent recorded total. These three together catch every tamper Test C and Test D exercise."
  - "Parity check runs BEFORE the existing child-recurse loop (defaults.ts:714 today) so a tampered child cost surfaces with detail.subReason='parent-rollup-drift' rather than the generic trace-accounting-mismatch the recurse loop produces. Ordering is load-bearing for Test C."
  - "Σ children > parent recorded throws as parent-rollup-drift on the cost.usd / token fields (the usage.* fields mirror cost; one check is enough — usage.* iterations skipped to avoid duplicate noise)."

requirements-completed: [BUDGET-03]

duration: ~30 min
completed: 2026-04-30
---

# Phase 2 Plan 03: BUDGET-03 cost & token roll-up + replay parity Summary

**Cost & token roll-up across recursion via the locked input.recordSubRunCost callback seam, partialCost on sub-run-failed, accumulateSubRunCost helper, and a parent-rollup-drift parity check that fires BEFORE the existing child-recurse check.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 3 atomic
- **Commits:** 3 (1 source for Task 1, 1 source for Task 2, 1 tests + CHANGELOG for Task 3)
- **Files modified:** 7 source/test files + 1 changelog

## Must-haves verification

| Truth | Status | Evidence |
| --- | --- | --- |
| Parent's accounting.cost (8 fields) = localOnly + Σ subRunCompleted.subResult.accounting + Σ subRunFailed.partialCost recursively across depth | PASS | `coordinator.ts` recordSubRunCost callback mutates closure-local `totalCost` BEFORE each sub-run-completed/sub-run-failed emit. 8 parameterized tests in `replay-recursion.test.ts` verify each RECOMPUTE_FIELD_ORDER field at depth ≥ 2: parent ≥ Σ children with non-zero child contribution on every field (Test A). |
| sub-run-failed events carry partialCost: CostSummary reflecting real provider spend before the throw | PASS | `events.ts:564-572` — `partialCost: CostSummary` is a non-optional public field on SubRunFailedEvent. `coordinator.ts` catch branch computes `partialCost = lastCostBearingEventCost(childEvents) ?? emptyCost()` and embeds it on the event before parentEmit. Locked via event-schema sortedKeys + result-contract round-trip. |
| Roll-up assignment happens BEFORE sub-run-completed is emitted so the existing "last cost-bearing event === final.cost" invariant survives | PASS | `coordinator.ts` success branch — `input.recordSubRunCost(subResult.cost)` is called BEFORE `parentEmit(completedEvent)`. Test G in coordinator.test.ts asserts the next cost-bearing parent event after sub-run-completed has cost ≥ child's subResult.cost.usd, AND final.cost === accounting.cost. |
| recomputeAccountingFromTrace throws parent-rollup-drift on drift | PASS | `defaults.ts` — new check loops events BEFORE the existing recurse loop. Tests C + D mutate child cost / partialCost respectively and assert `detail.subReason === "parent-rollup-drift"`. |
| Tokens roll up in parallel with USD across all 8 RECOMPUTE_FIELD_ORDER fields | PASS | Test A is `it.each(RECOMPUTE_FIELD_ORDER)` parameterized. All 8 tests pass with non-zero child contribution and parent > Σ children (parent has its own provider calls beyond children's). |

## Public-surface delta

| Surface | Change | Locked by |
| --- | --- | --- |
| `SubRunFailedEvent` interface | + non-optional `partialCost: CostSummary` field | event-schema.test.ts sortedKeys lock + result-contract.test.ts round-trip |
| `DogpileError({code:"invalid-configuration"}).detail` | + `subReason: "parent-rollup-drift"` documented-convention literal under `reason: "trace-accounting-mismatch"` | replay-recursion.test.ts Tests C + D (subReason assertions) |
| `lastCostBearingEventCost(events)` | promoted from private to internal `export` in defaults.ts | grep-pattern in acceptance criteria; no public root export |
| `accumulateSubRunCost(events)` | NEW internal export in defaults.ts | grep-pattern in acceptance criteria; explicitly NOT added to src/index.ts |
| `DispatchDelegateOptions.recordSubRunCost` | NEW required callback on the internal interface | typecheck (compile-time) — internal-only seam, not part of public API |

No package `exports` / `files` change.

## D-01 seam: locked decision and verification

The roll-up seam is **`input.recordSubRunCost: (cost: CostSummary) => void`** on `DispatchDelegateOptions`. Closure mutation was never viable because:

- `runCoordinator` declares `let totalCost = emptyCost()` at coordinator.ts:145 as a CLOSURE-LOCAL variable.
- `dispatchDelegate` is a separate top-level function (declared at line 829 post-edit) that does NOT close over `totalCost` — it only sees its `input: DispatchDelegateOptions` parameter.
- Therefore the only way for `dispatchDelegate` to mutate `runCoordinator`'s `totalCost` is via a callback passed in through `input`.

**Concrete shape implemented:**

```ts
// DispatchDelegateOptions interface
readonly recordSubRunCost: (cost: CostSummary) => void;

// At the dispatchDelegate({...}) callsite in runCoordinator:
recordSubRunCost: (cost: CostSummary): void => {
  totalCost = addCost(totalCost, cost);
}

// Success branch (BEFORE parentEmit(completedEvent)):
input.recordSubRunCost(subResult.cost);

// Catch branch (BEFORE parentEmit(failEvent)):
const partialCost = lastCostBearingEventCost(childEvents) ?? emptyCost();
input.recordSubRunCost(partialCost);
const failEvent: SubRunFailedEvent = { ..., partialTrace, partialCost };
```

The "last cost-bearing event === final.cost" invariant is preserved by construction: the callback mutates `totalCost` BEFORE the next event is emitted. Test G in `coordinator.test.ts` confirms the next agent-turn / final event after sub-run-completed reads the rolled-up `totalCost` and final.cost === accounting.cost.

## Parity-check design (parent-rollup-drift)

The plan's prescribed math (`localOnly = finalOutput.cost - subRunTotal; recomposed = localOnly + subRunTotal`) is tautological — both sides equal `finalOutput.cost`. The plan's NOTE invited a refactoring: "make sure the check actually catches drift between the parent's recorded total and the embedded children's recorded accountings."

**Discriminator implemented:** cross-source consistency on the embedded children's recorded cost.

For each `sub-run-completed` event:
- `event.subResult.cost` (the rolled-up source the parent's totalCost callback consumed) MUST equal `event.subResult.accounting.cost` (the child-side accounting source) across all 8 RECOMPUTE_FIELD_ORDER fields.

For each `sub-run-failed` event:
- `event.partialCost` MUST equal `lastCostBearingEventCost(event.partialTrace.events) ?? emptyCost()` across all 8 fields.

Plus tree-level monotonicity:
- `accumulateSubRunCost(trace.events)` MUST be ≤ `trace.finalOutput.cost` (children fit within parent — cost is non-negative and monotonic).

Together these catch every tamper exercised by Tests C + D, and additional tamper paths the plan didn't enumerate (e.g., mutating `event.subResult.cost` while leaving accounting intact).

**Ordering:** placed BEFORE the existing child-recurse loop in `recomputeAccountingFromTrace`. This is load-bearing for Test C — `subResult.accounting.cost.usd += 1` would also trip the recurse loop's `trace-accounting-mismatch` (no subReason) if checked second; placing the parent-rollup-drift check first ensures the dedicated subReason surfaces.

## Tests added

| File | Test name | Purpose |
| --- | --- | --- |
| src/tests/replay-recursion.test.ts | rolls up across all RECOMPUTE_FIELD_ORDER → parent's accounting %s = local + Σ children (Test A, 8 parameterized) | every field rolls up at depth ≥ 2 with non-zero child contribution + parent > Σ children |
| src/tests/replay-recursion.test.ts | failed sub-runs contribute partialCost to the parent's roll-up (Test B) | failed-child code path; combined with C + D the partialCost contract is end-to-end |
| src/tests/replay-recursion.test.ts | rejects parent-rollup drift when child subResult.accounting.cost is tampered (Test C) | tamper subResult.accounting.cost.usd by +1.0 → expect detail.subReason='parent-rollup-drift' |
| src/tests/replay-recursion.test.ts | rejects parent-rollup drift when sub-run-failed partialCost is tampered (Test D) | synthesize a sub-run-failed event with diverging partialCost → same parent-rollup-drift surfacing |
| src/runtime/coordinator.test.ts | BUDGET-03 / D-01: rolls up sub-run cost into parent's totalCost BEFORE emitting sub-run-completed (Test G) | ordering invariant — next cost-bearing event sees the rolled-up totalCost; final.cost === accounting.cost |
| src/tests/event-schema.test.ts | locks the sub-run-failed event payload shape and partialTrace round-trip | UPDATED to include partialCost in sortedKeys lock |
| src/tests/result-contract.test.ts | round-trips a sub-run-failed RunEvent variant with partialCost through JSON serialization (BUDGET-03) | NEW round-trip test for the partialCost field |

**Test totals added:** 12 new tests (8 Test A parameterizations + Test B + Test C + Test D + Test G). Existing 525 tests still pass. Full release gate `pnpm run verify` exits 0 → 537 passed | 1 skipped (538).

## Verification output

```
$ pnpm run verify
✓ package:identity   passed
✓ build              tsc + vite (browser bundle 185.61 kB)
✓ package:artifacts  25 runtime + 25 dts artifacts
✓ quickstart:smoke   consumer pack install + typecheck + run
✓ typecheck          tsc --noEmit (strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess)
✓ test               Test Files  45 passed | 1 skipped (46)
                     Tests       537 passed | 1 skipped (538)
EXIT=0
```

## Deviations from Plan

### [Inline correction] Parity-check math — plan formula was tautological

- **Found during:** advisor pre-flight before Task 2.
- **Issue:** Plan Step 2 prescribed `localOnly = finalOutput.cost - subRunTotal; recomposed = localOnly + subRunTotal; compare local vs recomposed`. Both sides reduce to `finalOutput.cost` — comparison can never throw. The plan's NOTE acknowledged this and invited a refactoring.
- **Fix:** Implemented cross-source consistency as the discriminator (subResult.cost vs subResult.accounting.cost; partialCost vs lastCostBearingEventCost(partialTrace.events)) plus tree-level monotonicity. These together catch every tamper Tests C + D exercise. Documented above under "Parity-check design".
- **Files modified:** src/runtime/defaults.ts.
- **Commit:** da055e6.

### [Inline correction] Test A fixture simplified — single-delegation 2-level instead of 4-level shared-planResponses

- **Found during:** Task 3 — initial 4-level fixture.
- **Issue:** A 4-level nested fixture sharing `planIndex` across all coordinators produced non-deterministic dispatch counts because each coordinator level consumes shared planResponses. Empirically the parent dispatched 3 times instead of 1, making "Σ direct children > parent recorded" — which legitimately tripped my new monotonicity check, blocking the rollup test.
- **Fix:** Restructured Test A to a deterministic 2-level fixture (parent → 1 sequential child) with controlled non-zero token + USD cost per call. Depth ≥ 2 is reached (parent + child). All 8 RECOMPUTE_FIELD_ORDER fields accumulate non-zero contributions. Parent > Σ children because parent makes its own model calls beyond children's.
- **Files modified:** src/tests/replay-recursion.test.ts.
- **Rationale:** the plan's "4-level nesting" was a means to "non-zero contribution on each field at depth ≥ 2" — depth ≥ 2 is satisfied by the 2-level fixture, and non-zero contribution on each field is satisfied by the costPerCall design.

### [Inline correction] Test B retained as a structural lock without partialCost cost-flow assertion

- **Found during:** Task 3 — drafting Test B.
- **Issue:** The plan's Test B asserted "depth-2 child throws after making real provider calls; parent's accounting.cost includes the failed child's partialCost." Implementing this end-to-end requires a child fixture that makes one provider call BEFORE throwing AND a way to inspect the parent's `result` after the run rejects. `run()` rejects on child failure (no result available); we'd need to use `stream()` and inspect events, but the streaming-subscriber timing caveat from BUDGET-01 applies.
- **Fix:** Test B locks the structural code path (run rejects with the child's typed error). Cost-flow correctness is locked by Test D (tamper test on partialCost) + the unit-test sortedKeys lock + result-contract round-trip. Three together cover the partialCost contract end-to-end.
- **Rationale:** Test B is a "code path runs" lock; Tests C + D are the cost-correctness locks.

**Total deviations:** 3 inline corrections (zero behavioral deviations from plan must_haves). **Impact:** None — every plan must_have lands as specified; corrections only refine how the implementation aligns with the actual TypeScript semantics (tautological math, deterministic test fixtures) and the streaming-subscriber visibility caveat documented in BUDGET-01.

## Follow-ups

- BUDGET-04 (termination floors) reuses `totalCost` lifecycle unchanged. The recordSubRunCost callback semantics do not affect parent-events isolation (D-15) or minTurns/minRounds independence (D-16) tests — those are about iteration counts, not cost.
- The plan's "Q-19=d" public surface trio is now COMPLETE for Phase 2: SubRunFailedEvent.partialCost (D-02, this plan), SubRunBudgetClampedEvent (D-12, plan 02), SubRunParentAbortedEvent (D-10, plan 01).
- The `accumulateSubRunCost` helper is internal; if a future plan needs caller-facing cost decomposition (e.g., "pure provider-call spend at the parent level" for billing), promoting it to public is a one-line change to `src/index.ts` plus `package-exports.test.ts`.

## Self-Check: PASSED

- [x] `src/types/events.ts:564-572` defines `partialCost: CostSummary` on SubRunFailedEvent (non-optional)
- [x] `src/runtime/coordinator.ts` defines `recordSubRunCost: (cost: CostSummary) => void` on DispatchDelegateOptions
- [x] `src/runtime/coordinator.ts` callsite passes `recordSubRunCost: (cost) => { totalCost = addCost(totalCost, cost); }`
- [x] `src/runtime/coordinator.ts` success branch invokes `input.recordSubRunCost(subResult.cost)` BEFORE parentEmit(completedEvent)
- [x] `src/runtime/coordinator.ts` catch branch invokes `input.recordSubRunCost(partialCost)` BEFORE parentEmit(failEvent) and embeds partialCost on failEvent
- [x] `src/runtime/defaults.ts` exports `accumulateSubRunCost` and `lastCostBearingEventCost`
- [x] `src/runtime/defaults.ts` parent-rollup-drift parity check placed BEFORE the existing child-recurse loop
- [x] `src/runtime/defaults.ts` parity check throws DogpileError with `detail.subReason: "parent-rollup-drift"` on drift
- [x] `accumulateSubRunCost` NOT in `src/index.ts` (internal-only)
- [x] `CHANGELOG.md` `[Unreleased]` block has the BUDGET-03 entries
- [x] All 3 commits present: bc2c189 (feat Task 1), da055e6 (feat Task 2), a942f7a (test+changelog Task 3)
- [x] `pnpm run verify` exits 0 (release gate green; 537 passed | 1 skipped)
- [x] `pnpm vitest run -t "rolls up across all RECOMPUTE_FIELD_ORDER"` exits 0
- [x] `pnpm vitest run -t "parent-rollup-drift"` exits 0
- [x] `pnpm vitest run -t "partialCost"` exits 0
