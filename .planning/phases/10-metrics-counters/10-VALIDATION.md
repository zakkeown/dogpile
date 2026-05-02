---
phase: 10
slug: metrics-counters
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-01
audited: 2026-05-01
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vite.config.ts` (inferred root) |
| **Quick run command** | `pnpm exec vitest run src/runtime/metrics.test.ts src/tests/metrics-engine-contract.test.ts src/tests/metrics-contract.test.ts src/tests/package-exports.test.ts` |
| **Full suite command** | `pnpm run test` |
| **Estimated runtime** | ~3 seconds (quick) / ~15 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run quick run command above
- **After every plan wave:** Run `pnpm run test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | METR-01 | T-10-01 | MetricsHook/RunMetricsSnapshot are pure interfaces with no runtime side effects | unit | `pnpm exec vitest run src/runtime/metrics.test.ts` | ✅ | ✅ green |
| 10-01-02 | 01 | 1 | METR-01 | T-10-01 | metricsHook?/logger? on both EngineOptions and DogpileOptions; zero root exports | typecheck | `pnpm run typecheck` | ✅ | ✅ green |
| 10-02-01 | 02 | 2 | METR-01 | T-10-03, T-10-04 | onRunComplete fires for completed, budget-stopped, aborted, and cancelled runs; no double-fire | integration | `pnpm exec vitest run src/tests/metrics-engine-contract.test.ts` | ✅ | ✅ green |
| 10-02-02 | 02 | 2 | METR-01 | T-10-05 | onSubRunComplete fires once per coordinator child; metricsHook not threaded into child dispatch (no double-fire) | integration | `pnpm exec vitest run src/tests/metrics-engine-contract.test.ts` | ✅ | ✅ green |
| 10-02-03 | 02 | 2 | METR-02 | T-10-03, T-10-04 | Sync and async hook errors are caught and routed to logger.error; never propagate into run result | integration | `pnpm exec vitest run src/tests/metrics-engine-contract.test.ts` | ✅ | ✅ green |
| 10-02-04 | 02 | 2 | METR-02 | T-10-04 | Aborted runs preserve partial observed usage and turns in snapshot | integration | `pnpm exec vitest run src/tests/metrics-engine-contract.test.ts` | ✅ | ✅ green |
| 10-03-01 | 03 | 3 | METR-01 | T-10-08 | /runtime/metrics subpath resolves to correct dist files; package-exports assertion covers MetricsHook and RunMetricsSnapshot | packaging | `pnpm run build && pnpm exec vitest run src/tests/package-exports.test.ts` | ✅ | ✅ green |
| 10-03-02 | 03 | 3 | METR-01 | T-10-07 | metrics-snapshot-v1.json frozen fixture has all 9 required fields; type-check file compiles with satisfies | fixture | `pnpm run typecheck && pnpm exec vitest run src/tests/metrics-contract.test.ts` | ✅ | ✅ green |
| 10-03-03 | 03 | 3 | METR-01, METR-02 | T-10-03, T-10-05, T-10-06 | Public contract: completed/budget-stopped/aborted/cancelled outcomes, sub-run, result-shape parity, sync+async hook error isolation | contract | `pnpm exec vitest run src/tests/metrics-contract.test.ts` | ✅ | ✅ green |
| 10-04-01 | 04 | 4 | METR-01, METR-02 | — | N/A — documentation only | docs | `grep -c "MetricsHook" CHANGELOG.md && grep -c "metricsHook" CLAUDE.md && grep -c "metricsHook" docs/developer-usage.md` | ✅ | ✅ green |
| 10-04-02 | 04 | 4 | METR-01, METR-02 | — | Full release gate green (identity → build → artifact check → packed quickstart smoke → typecheck → test) | release-gate | `pnpm run verify` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Vitest was already installed and configured. No new test frameworks or fixture scaffolding required before execution.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Threat Coverage

| Threat ID | Category | Mitigation | Test Coverage |
|-----------|----------|------------|---------------|
| T-10-01 | Information disclosure (interface type leak) | Pure interface, no PII | `src/runtime/metrics.test.ts` |
| T-10-02 | DoS (cancel path hook never fires) | runProtocol catch fires closeRunMetrics | `metrics-engine-contract.test.ts` (streaming cancel) |
| T-10-03 | DoS (hook blocks run via awaiting) | Fire-and-forget: .catch attached, never awaited | `metrics-engine-contract.test.ts` + `metrics-contract.test.ts` |
| T-10-04 | Tampering (throwing hook corrupts run result) | try/catch in fireHook; closeRunMetrics before return | `metrics-engine-contract.test.ts` (sync/async/Promise-like) |
| T-10-05 | DoS (double-fire causes metric over-count) | metricsHook NOT in child dispatch; OQ-1 root-only guard | `metrics-engine-contract.test.ts` (sub-run test) |
| T-10-06 | DoS (cancelled stream hook never fires) | runProtocol catch fires close; cancelRun abort triggers catch | `metrics-contract.test.ts` (cancelled streaming run) |
| T-10-07 | Tampering (fixture drift) | metrics-snapshot-v1.type-check.ts satisfies guard | `metrics-contract.test.ts` (fixture shape test) |
| T-10-08 | Information disclosure (subpath leaks internals) | metrics.ts has zero imports, interfaces only | `package-exports.test.ts` |

---

## Validation Audit 2026-05-01

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 11 tasks in plans 01–04 had automated verification commands. 58 tests covering the phase ran green at audit time. Release gate (`pnpm run verify`) confirmed clean at 762 tests passed, 1 skipped.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-01
