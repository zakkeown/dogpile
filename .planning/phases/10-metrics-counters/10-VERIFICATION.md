---
phase: 10-metrics-counters
status: passed
verified_at: 2026-05-02T02:00:38Z
requirements: [METR-01, METR-02]
automated_checks:
  focused_metrics_and_exports:
    command: "pnpm exec vitest run src/tests/metrics-engine-contract.test.ts src/tests/metrics-contract.test.ts src/tests/package-exports.test.ts"
    status: passed
    result: "3 test files passed, 53 tests passed"
  typecheck:
    command: "pnpm run typecheck"
    status: passed
    result: "tsc -p tsconfig.json --noEmit exited 0"
  full_verify:
    command: "pnpm run verify"
    status: passed
    result: "orchestrator reported post-fix pass: 762 passed, 1 skipped"
gaps: 0
---

# Phase 10 Verification

## Verdict

Status: **passed**.

Phase goal is achieved in the codebase. The metrics public surface exists, the engine emits root and sub-run completion snapshots, absent hooks avoid metrics state/snapshot/hook work, hook failures are isolated, the `/runtime/metrics` package subpath is wired, fixtures/tests lock the snapshot shape, and documentation is in lockstep.

This verification used the phase goal, roadmap success criteria, plan must-haves, source inspection, focused test execution, typecheck, package artifacts, and the clean post-fix code review artifact. SUMMARY files were treated as claims only.

## Requirement Coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| METR-01: caller can supply a metrics hook and receive named counters at run and sub-run completion | Satisfied | `MetricsHook` and `RunMetricsSnapshot` are defined in `src/runtime/metrics.ts:12-45`; `metricsHook` is threaded into root run/stream execution in `src/runtime/engine.ts:129-145` and `src/runtime/engine.ts:254-276`; root and sub-run hooks are fired in `src/runtime/engine.ts:946-986`. Contract tests cover completed, budget-stopped, aborted/cancelled, and sub-run completion paths in `src/tests/metrics-engine-contract.test.ts` and `src/tests/metrics-contract.test.ts`. |
| METR-02: metrics hook is optional and runs complete with no metrics side effects when no hook is provided | Satisfied | `openRunMetrics` returns `undefined` when no hook is supplied and does not create `MetricsState`/maps/snapshots in `src/runtime/engine.ts:788-805`. Result shape parity is asserted in `src/tests/metrics-contract.test.ts:91-111`. Hook errors are isolated through `routeMetricsError`/`fireHook` in `src/runtime/engine.ts:807-839` and tested in `src/tests/metrics-engine-contract.test.ts:302-371`. |

## Must-Have Verification

| Must-have | Status | Evidence |
| --- | --- | --- |
| `MetricsHook` and `RunMetricsSnapshot` exist with the locked 9-field shape | Passed | `RunMetricsSnapshot` has exactly `outcome`, `inputTokens`, `outputTokens`, `costUsd`, `totalInputTokens`, `totalOutputTokens`, `totalCostUsd`, `turns`, `durationMs` in `src/runtime/metrics.ts:12-30`; callbacks are optional in `src/runtime/metrics.ts:32-45`; structural tests exist in `src/runtime/metrics.test.ts:7-58`; frozen fixture exists in `src/tests/fixtures/metrics-snapshot-v1.json:1-11`. |
| `metricsHook?: MetricsHook` and `logger?: Logger` are present on `DogpileOptions` and `EngineOptions` | Passed | Type-only imports are in `src/types.ts:1-3`; `DogpileOptions` fields are in `src/types.ts:1897-1914`; `EngineOptions` fields are in `src/types.ts:2027-2044`. |
| `onRunComplete` fires for completed, budget-stopped, and aborted root runs | Passed | Root-only close is guarded in `src/runtime/engine.ts:1311-1326`; completed/budget snapshot construction is in `src/runtime/engine.ts:841-870`; aborted snapshot construction is in `src/runtime/engine.ts:967-986`; tests cover completed, budget-stopped, provider-aborted, partial-aborted, and streaming-cancelled runs in `src/tests/metrics-engine-contract.test.ts:12-185`. |
| `onSubRunComplete` fires once per coordinator child completion | Passed | Parent emit handling records `sub-run-started` and fires `onSubRunComplete` on `sub-run-completed` in `src/runtime/engine.ts:942-954`; child `runProtocol` dispatch intentionally does not thread `metricsHook` in `src/runtime/engine.ts:1396-1405`, preventing child root double-fire; tests assert one root snapshot and one sub-run snapshot for the deterministic delegation case in `src/tests/metrics-engine-contract.test.ts:187-221`. |
| Own counters exclude completed child cost and failed child partial cost; totals include subtree spend | Passed | `nestedSubRunCosts` includes both `sub-run-completed.subResult.cost` and `sub-run-failed.partialCost` in `src/runtime/engine.ts:903-912`; root/sub-run own counters subtract nested cost in `src/runtime/engine.ts:841-899`; failed-child regressions assert own counters exclude `partialCost` while totals retain it in `src/tests/metrics-engine-contract.test.ts:223-300`. |
| Aborted snapshots preserve observed partial usage and turns | Passed | `MetricsState` stores observed `totalCost`, `nestedCost`, and `turns` in `src/runtime/engine.ts:778-786`; `handleMetricsEvent` updates them as events arrive in `src/runtime/engine.ts:930-959`; aborted close uses observed counters in `src/runtime/engine.ts:974-986`; regressions cover direct partial aborts and failed-child partial spend before abort in `src/tests/metrics-engine-contract.test.ts:108-140` and `src/tests/metrics-engine-contract.test.ts:265-300`. |
| Hook errors, including Promise-like rejections, do not propagate and route to logger/console | Passed | `routeMetricsError` calls `logger.error` or `console.error` and swallows logger failures in `src/runtime/engine.ts:807-817`; `fireHook` catches synchronous throws and attaches `.catch` structurally to any catchable return in `src/runtime/engine.ts:820-839`; tests cover sync, async, and Promise-like rejection routing in `src/tests/metrics-engine-contract.test.ts:302-371`. |
| Metrics path does not change `replay()` / `replayStream()` behavior | Passed | `replay(trace)` and `replayStream(trace)` accept traces only and are documented/code-commented as metrics-free in `src/runtime/engine.ts:1476-1483` and `src/runtime/engine.ts:1691-1698`; no `metricsHook` invocation exists on replay paths. |
| Absent `metricsHook` leaves result shape identical and causes no hook side effects | Passed | No hook means `MetricsState` is `undefined` in `src/runtime/engine.ts:788-805`; result shape parity is asserted in `src/tests/metrics-contract.test.ts:91-111`. Verification interprets "zero overhead" as no metrics state, map, snapshot, or hook work when omitted. |
| `@dogpile/sdk/runtime/metrics` resolves to dist runtime JS/DTS and is tested | Passed | `package.json:98-102` maps `./runtime/metrics` to `./dist/runtime/metrics.d.ts` and `./dist/runtime/metrics.js`; `package.json:186` includes `src/runtime/metrics.ts` in package files; `src/tests/package-exports.test.ts:38`, `src/tests/package-exports.test.ts:1338-1342`, and `src/tests/package-exports.test.ts:1557-1612` assert the public subpath/types. Existing `dist/runtime/metrics.js` and `dist/runtime/metrics.d.ts` were present during verification. |
| Frozen `metrics-snapshot-v1` fixture and type-check exist | Passed | `src/tests/fixtures/metrics-snapshot-v1.json:1-11` has the canonical 9-field order; `src/tests/fixtures/metrics-snapshot-v1.type-check.ts:1-18` mirrors it with `satisfies RunMetricsSnapshot`; fixture shape test is in `src/tests/metrics-contract.test.ts:254-265`. |
| Docs lockstep is complete | Passed | `CHANGELOG.md:52-60` documents Phase 10 public surface and behavior; `CLAUDE.md:51` records the invariant chain; `docs/developer-usage.md:602-684` documents `metricsHook`, counters, error isolation, replay behavior, and `logger`. |

## Automated Checks

| Check | Result |
| --- | --- |
| `pnpm exec vitest run src/tests/metrics-engine-contract.test.ts src/tests/metrics-contract.test.ts src/tests/package-exports.test.ts` | Passed locally: 3 files, 53 tests. |
| `pnpm run typecheck` | Passed locally: `tsc -p tsconfig.json --noEmit` exited 0. |
| `ls dist/runtime/metrics.js dist/runtime/metrics.d.ts` | Passed locally: both dist artifacts exist. |
| `rg -n "from.*runtime/metrics|MetricsHook|RunMetricsSnapshot" src/index.ts src/browser/index.ts` | Passed locally: no root/browser re-export of metrics types. |
| Anti-pattern scan over metrics source/tests/docs | No blocker found. Hits were documentation examples, no-op test helpers, and unrelated existing helper returns. |
| Full release gate | Passed per orchestrator after review fixes: `pnpm run verify` with 762 passed, 1 skipped. Not rerun in this verification turn because focused checks and typecheck already exercised the Phase 10 surface. |

## Code Review Follow-up

The three required code review fixes are present and covered:

| Finding | Status | Evidence |
| --- | --- | --- |
| CR-01: failed child partial metrics excluded from parent own counters | Fixed | Commit `f52dd87`; implementation in `nestedSubRunCosts` at `src/runtime/engine.ts:903-912`; regression in `src/tests/metrics-engine-contract.test.ts:223-263`. |
| CR-02: partial aborted metrics preserved | Fixed | Commit `27974c4`; state tracking and aborted close in `src/runtime/engine.ts:778-986`; regressions in `src/tests/metrics-engine-contract.test.ts:108-140` and `src/tests/metrics-engine-contract.test.ts:265-300`. |
| WR-01: Promise-like hook rejections caught | Fixed | Commit `61d483a`; structural catch handling in `src/runtime/engine.ts:829-835`; regression in `src/tests/metrics-engine-contract.test.ts:352-370`. |

Post-fix `10-REVIEW.md` is clean and records the focused review command as passing with 18 tests.

## Residual Risks

- "Zero overhead" is verified as no metrics state/map/snapshot/hook work when the hook is absent. The runtime still performs a cheap guard call to determine absence.
- No external metrics backend integration was tested, by design. The SDK exposes a hook interface and intentionally does not own exporters.
- Hook delivery is fire-and-forget. This is documented behavior; callers that need guaranteed persistence must implement it inside their hook.

## Human Verification

None required. The Phase 10 deliverables are API, runtime behavior, packaging, fixtures, and documentation changes that are covered by static inspection and automated tests.
