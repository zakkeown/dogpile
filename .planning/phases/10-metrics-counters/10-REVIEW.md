---
phase: 10-metrics-counters
reviewed: 2026-05-02T01:37:07Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - src/runtime/metrics.ts
  - src/runtime/metrics.test.ts
  - src/types.ts
  - src/runtime/engine.ts
  - src/tests/metrics-engine-contract.test.ts
  - package.json
  - src/tests/package-exports.test.ts
  - src/tests/metrics-contract.test.ts
  - src/tests/fixtures/metrics-snapshot-v1.json
  - src/tests/fixtures/metrics-snapshot-v1.type-check.ts
  - CHANGELOG.md
  - CLAUDE.md
  - docs/developer-usage.md
findings:
  critical: 2
  warning: 1
  info: 0
  total: 3
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-05-02T01:37:07Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Reviewed the Phase 10 metrics hook implementation, public types, package export wiring, tests, frozen fixture, changelog, CLAUDE invariant, and developer docs. The package subpath and type surface are wired, but the runtime counter logic has correctness gaps for partial/failed execution paths, and async hook error isolation is narrower than the documented Promise contract.

## Critical Issues

### CR-01: BLOCKER - Failed Sub-Run Partial Cost Is Counted As Parent Own Cost

**File:** `src/runtime/engine.ts:897`

**Issue:** `nestedSubRunCosts()` only subtracts `sub-run-completed` child costs. Phase 2 explicitly rolls `sub-run-failed.partialCost` into the parent total before emitting `sub-run-failed`, but the metrics own-counter calculation ignores those failed-child partial costs. A coordinator parent that continues after a failed child will report `inputTokens`, `outputTokens`, and `costUsd` as if the failed child's spend belonged to the parent run. This violates the public docs at `docs/developer-usage.md:646`, which promise own counters exclude nested sub-runs.

**Fix:**
```ts
function nestedSubRunCosts(result: RunResult): CostSummary[] {
  return result.trace.events.flatMap((event) => {
    if (event.type === "sub-run-completed") {
      return [event.subResult.cost];
    }
    if (event.type === "sub-run-failed") {
      return [event.partialCost];
    }
    return [];
  });
}
```

Add a metrics contract test where a coordinator continues after a delegated child fails after recording some partial spend, then assert `costUsd` excludes `sub-run-failed.partialCost` while `totalCostUsd` includes it.

### CR-02: BLOCKER - Aborted Snapshots Drop Real Partial Usage

**File:** `src/runtime/engine.ts:930`

**Issue:** The catch path calls `closeRunMetrics(metrics, undefined)`, and `closeRunMetrics()` emits an aborted snapshot with every usage counter and `turns` forced to zero. This is only correct when the run aborts before any model turn completes. If a sequential/coordinator run completes one or more agent turns and then a later provider call throws, the SDK has already emitted cost-bearing events, but the metrics hook reports zero spend and zero turns. Existing tests only cover a provider throwing before any spend (`src/tests/metrics-engine-contract.test.ts:71`), so this regression is not locked.

**Fix:** Track partial metrics in `MetricsState` as events flow through `handleMetricsEvent`, similar to `TracingState.lastCost` and `turnCount`, and build the aborted snapshot from the last known direct/total cost plus observed turns instead of zeroing everything.

```ts
interface MetricsState {
  readonly metricsHook: MetricsHook;
  readonly logger: Logger | undefined;
  readonly startedAtMs: number;
  readonly subRunStartTimes: Map<string, number>;
  readonly events: RunEvent[];
}

function handleMetricsEvent(state: MetricsState, event: RunEvent): void {
  state.events.push(event);
  // existing sub-run completion handling...
}

function closeRunMetrics(state: MetricsState, result: RunResult | undefined): void {
  if (result) {
    fireHook(state.metricsHook.onRunComplete, buildRunSnapshot(result, state.startedAtMs), state.logger);
    return;
  }
  fireHook(state.metricsHook.onRunComplete, buildAbortedSnapshotFromEvents(state), state.logger);
}
```

Add tests for "first turn succeeds, second turn throws" and for a coordinator child failure after partial child spend.

## Warnings

### WR-01: WARNING - Async Hook Rejections Are Only Caught For Native Same-Realm Promises

**File:** `src/runtime/engine.ts:825`

**Issue:** `fireHook()` attaches a rejection handler only when `result instanceof Promise`. That misses cross-realm Promises and Promise-like objects with a `.catch()` method, which are both structurally compatible with TypeScript's Promise contract in practice. In those cases, a rejecting async metrics hook can surface as an unhandled rejection instead of being routed to `logger.error`, contradicting the docs at `docs/developer-usage.md:650`.

**Fix:**
```ts
const result = callback(snapshot);
if (result && typeof (result as Promise<void>).catch === "function") {
  (result as Promise<void>).catch((err: unknown) => {
    routeMetricsError(err, logger);
  });
}
```

Add a small unit test using a Promise-like object with `catch()` to verify the logger path.

---

_Reviewed: 2026-05-02T01:37:07Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
