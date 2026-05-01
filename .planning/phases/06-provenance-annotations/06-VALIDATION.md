---
phase: 6
slug: provenance-annotations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-01
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run src/runtime/model.test.ts` |
| **Full suite command** | `pnpm run test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run src/runtime/model.test.ts`
- **After every plan wave:** Run `pnpm run test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 1 | PROV-01 | — | N/A | unit | `pnpm vitest run src/runtime/model.test.ts` | ❌ W0 | ⬜ pending |
| 6-01-02 | 01 | 1 | PROV-01 | — | N/A | unit | `pnpm vitest run src/types` | ✅ | ⬜ pending |
| 6-02-01 | 02 | 2 | PROV-02 | — | N/A | unit | `pnpm vitest run src/tests/event-schema.test.ts` | ✅ | ⬜ pending |
| 6-02-02 | 02 | 2 | PROV-02 | — | N/A | unit | `pnpm vitest run src/tests/result-contract.test.ts` | ✅ | ⬜ pending |
| 6-03-01 | 03 | 3 | PROV-01, PROV-02 | — | N/A | unit | `pnpm vitest run src/tests/package-exports.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/runtime/model.test.ts` — unit tests for `ModelRequestEvent`/`ModelResponseEvent` emission and provenance fields (PROV-01)
- [ ] `src/tests/fixtures/provenance-event-v1.json` — frozen fixture protecting event shape

*Existing test infrastructure (Vitest) covers the framework; only new test files needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| All four protocols emit model-request/response in correct sequence | PROV-01 | Integration across protocol files | Run benchmark or integration test; inspect trace.events ordering |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
