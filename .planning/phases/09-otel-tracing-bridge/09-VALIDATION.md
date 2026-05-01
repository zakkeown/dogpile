---
phase: 9
slug: otel-tracing-bridge
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-01
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm vitest run src/runtime/tracing` |
| **Full suite command** | `pnpm run test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run src/runtime/tracing`
- **After every plan wave:** Run `pnpm run test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | OTEL-01 | — | N/A | unit | `pnpm vitest run src/runtime/tracing` | ✅ | ⬜ pending |
| 09-01-02 | 01 | 1 | OTEL-01 | — | N/A | unit | `pnpm run typecheck` | ✅ | ⬜ pending |
| 09-02-01 | 02 | 2 | OTEL-01, OTEL-02 | — | N/A | unit | `pnpm vitest run src/runtime/engine.test` | ✅ | ⬜ pending |
| 09-02-02 | 02 | 2 | OTEL-02 | — | N/A | unit | `pnpm vitest run src/tests/` | ✅ | ⬜ pending |
| 09-03-01 | 03 | 3 | OTEL-01, OTEL-02, OTEL-03 | — | N/A | unit | `pnpm run test` | ✅ | ⬜ pending |
| 09-04-01 | 04 | 4 | OTEL-01 | — | N/A | unit | `pnpm run verify` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/runtime/tracing.ts` — stub with `DogpileTracer`, `DogpileSpan`, `DogpileSpanOptions`, `DOGPILE_SPAN_NAMES`
- [ ] `src/runtime/tracing.test.ts` — stubs for OTEL-01, OTEL-02, OTEL-03 test cases
- [ ] `devDependencies` — add `@opentelemetry/api` and `@opentelemetry/sdk-trace-base`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| InMemorySpanExporter receives spans for a real run | OTEL-01 | Integration test with real tracer bridge | Wire an `InMemorySpanExporter`, run `Dogpile.pile(...)`, inspect exported spans for `dogpile.run`, `dogpile.agent-turn`, `dogpile.model-call` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
