---
phase: 8
slug: audit-event-schema
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-01
audited: 2026-05-01
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run src/runtime/audit.test.ts` |
| **Full suite command** | `pnpm run test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run src/runtime/audit.test.ts`
- **After every plan wave:** Run `pnpm run test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 8-01-T1 | 01 | 1 | AUDT-01, AUDT-02 | — | N/A | unit | `pnpm vitest run src/runtime/audit.test.ts` | ✅ | ✅ green |
| 8-01-T2 | 01 | 1 | AUDT-02 | — | N/A | compile | `pnpm run typecheck` | ✅ | ✅ green |
| 8-02-T1 | 02 | 2 | AUDT-02 | — | N/A | compile | `pnpm run typecheck` | ✅ | ✅ green |
| 8-02-T2 | 02 | 2 | AUDT-02 | — | N/A | contract | `pnpm vitest run src/tests/audit-record-shape.test.ts` | ✅ | ✅ green |
| 8-03-T1 | 03 | 3 | AUDT-01, AUDT-02 | — | N/A | package | `pnpm vitest run src/tests/package-exports.test.ts` | ✅ | ✅ green |
| 8-03-T2 | 03 | 3 | AUDT-01, AUDT-02 | — | N/A | compile | `pnpm run typecheck` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/runtime/audit.ts` — implementation (createAuditRecord + exported types)
- [x] `src/runtime/audit.test.ts` — unit test stubs for createAuditRecord
- [x] `src/tests/audit-record-shape.test.ts` — frozen fixture deepEqual test
- [x] `src/tests/fixtures/audit-record-v1.json` — frozen fixture file
- [x] `src/tests/fixtures/audit-record-v1.type-check.ts` — `satisfies AuditRecord` compile-time check

*Existing vitest infrastructure covers the test runner requirement.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | — | — | — |

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-05-01

---

## Validation Audit 2026-05-01

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 6 tasks covered by automated tests. 54 tests green across 3 test files. Typecheck clean.
