---
phase: 07-structured-event-introspection-health-diagnostics
reviewed: 2026-05-01T21:34:04Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - CHANGELOG.md
  - CLAUDE.md
  - package.json
  - src/index.ts
  - src/runtime/broadcast.ts
  - src/runtime/coordinator.ts
  - src/runtime/defaults.ts
  - src/runtime/engine.ts
  - src/runtime/health.test.ts
  - src/runtime/health.ts
  - src/runtime/introspection.test.ts
  - src/runtime/introspection.ts
  - src/runtime/sequential.ts
  - src/runtime/shared.ts
  - src/tests/event-schema.test.ts
  - src/tests/fixtures/anomaly-record-v1.json
  - src/tests/health-shape.test.ts
  - src/tests/package-exports.test.ts
  - src/tests/result-contract.test.ts
  - src/types.ts
findings:
  critical: 1
  warning: 0
  info: 0
  total: 1
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-05-01T21:34:04Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

Reviewed the Phase 7 public-surface changes for `RunResult.health`, `queryEvents`, `computeHealth`, root health exports, and the new `./runtime/health` and `./runtime/introspection` package subpaths. The implementation is broadly wired through runtime results, replay, exports, package files, and shape tests.

**Orchestrator disposition after review:** the two health robustness warnings were fixed in commit `2e291e3` and validated with `pnpm vitest run src/runtime/health.test.ts` plus `pnpm run typecheck`. The package identity finding remains open but is deferred to release-identity work: `scripts/release-identity.json` and `docs/release.md` still intentionally pin the current published package identity to `@dogpile/sdk@0.4.0` while the v0.5.0 milestone is in progress.

## Critical Issues

### CR-01: BLOCKER - Published package identity still reports 0.4.0 while the changelog records 0.5.0 public API changes

**File:** `package.json:3`

**Issue:** Phase 7 adds required public surface (`RunResult.health`, root health exports, and two new package subpaths), and `CHANGELOG.md:3` records those changes under `0.5.0`. The publishable package identity still reports `"version": "0.4.0"`, so a release from this tree would ship the new required API under the previous version. That is a package/API regression risk for consumers, and the current package export tests do not catch it because they only validate the export map and package contents, not changelog-to-package identity consistency.

**Fix:**

```json
{
  "version": "0.5.0"
}
```

Update the release identity files in the same change, or change the changelog entry to an unreleased heading until the package identity is intentionally bumped.

## Warnings

Resolved during execution in `2e291e3`.

### WR-01: WARNING - Zero-dollar budget caps report 0% utilization even after nonzero spend

**File:** `src/runtime/health.ts:65`

**Status:** Resolved in `2e291e3`. Zero-dollar caps with nonzero final spend now report 100% utilization and can trigger `budget-near-miss`; zero spend still reports 0%.

**Issue:** `computeHealth` sets `budgetUtilizationPct` to `0` whenever `trace.budget.maxUsd === 0`, regardless of `trace.finalOutput.cost.usd`. A trace with a zero-dollar cap and nonzero final cost is therefore reported as 0% utilized and cannot trigger the `budget-near-miss` anomaly. Zero is a valid budget boundary in the runtime configuration model, so this edge case produces misleading health output for the new public diagnostics API.

**Fix:**

```ts
const budgetUtilizationPct =
  maxUsd === undefined
    ? null
    : maxUsd === 0
      ? finalCost === 0 ? 0 : 100
      : (finalCost / maxUsd) * 100;
```

Add a test that calls `computeHealth` with `budget.maxUsd: 0` and a positive `finalOutput.cost.usd`, and assert that budget health cannot be reported as clean/0%.

### WR-02: WARNING - Public health threshold inputs are not validated

**File:** `src/runtime/health.ts:72`

**Status:** Resolved in `2e291e3`. `computeHealth` now rejects negative, `NaN`, and infinite threshold values, and constrains `budgetNearMissPct` to the documented 0-100 percentage range.

**Issue:** `computeHealth` accepts caller-provided `HealthThresholds` without validating that the values are finite and in range. Passing `NaN` for `budgetNearMissPct` suppresses budget anomalies, negative values make anomalies fire for every run/agent, and non-finite values can make public diagnostics inconsistent with the documented threshold semantics. Since `computeHealth` is now exported at the root and through `./runtime/health`, malformed public input should fail predictably instead of silently changing diagnostics behavior.

**Fix:**

```ts
function assertFiniteNonNegative(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
}

assertFiniteNonNegative(thresholds.runawayTurns, "runawayTurns");
assertFiniteNonNegative(thresholds.budgetNearMissPct, "budgetNearMissPct");
```

For `budgetNearMissPct`, also enforce the documented 0-100 range or document that values above 100 are intentionally allowed. Add tests for `NaN`, negative, and over-range threshold values.

---

_Reviewed: 2026-05-01T21:34:04Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
