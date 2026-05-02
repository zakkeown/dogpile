---
phase: 10-metrics-counters
fixed_at: 2026-05-02T01:52:05Z
review_path: .planning/phases/10-metrics-counters/10-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-05-02T01:52:05Z
**Source review:** `.planning/phases/10-metrics-counters/10-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 3
- Fixed: 3
- Skipped: 0

## Fixed Issues

### CR-01: BLOCKER - Failed Sub-Run Partial Cost Is Counted As Parent Own Cost

**Files modified:** `src/runtime/engine.ts`, `src/tests/metrics-engine-contract.test.ts`
**Commit:** f52dd87
**Applied fix:** `nestedSubRunCosts()` now subtracts `sub-run-failed.partialCost` from parent own counters while retaining it in total counters, with a coordinator continuation regression test.

### CR-02: BLOCKER - Aborted Snapshots Drop Real Partial Usage

**Files modified:** `src/runtime/engine.ts`, `src/tests/metrics-engine-contract.test.ts`
**Commit:** 27974c4
**Applied fix:** `MetricsState` now tracks observed root turns, total cost, and nested sub-run cost as events arrive, and aborted snapshots report the observed own and total counters. Added regressions for direct partial aborts and failed-child partial spend before parent abort.

### WR-01: WARNING - Async Hook Rejections Are Only Caught For Native Same-Realm Promises

**Files modified:** `src/runtime/engine.ts`, `src/tests/metrics-engine-contract.test.ts`
**Commit:** 61d483a
**Applied fix:** `fireHook()` now attaches rejection handling to any returned value with a `.catch()` method, with a Promise-like hook regression test.

---

_Fixed: 2026-05-02T01:52:05Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
