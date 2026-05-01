# Retrospective

## Milestone: v0.4.0 — Recursive Coordination

**Shipped:** 2026-05-01
**Phases:** 5 | **Plans:** 22 | **Requirements:** 27/27

### What Was Built

Dogpile now supports recursive coordination through a `delegate` decision on the existing `coordinator` protocol. Child runs are real Dogpile runs with embedded traces, replay support, budget/cancel/cost propagation, bounded child concurrency, local-provider clamping, stream ancestry, child failure context, docs, examples, and published release artifacts.

### What Worked

- Dependency ordering held: decision shape and trace events landed first, propagation and concurrency built on that, streaming/error semantics followed, and documentation shipped last.
- Contract tests protected public event/result/package surfaces as recursive coordination widened the SDK API.
- Release closure captured npm/GitHub artifacts in the final phase summary, making archive reconstruction straightforward.

### What Was Inefficient

- The milestone archive workflow expected `gsd-sdk query` commands that are not available in the installed CLI, so completion required manual file analysis and archive creation.
- No separate `.planning/v0.4.0-MILESTONE-AUDIT.md` was present at archive time, leaving the archive to rely on requirements traceability, phase summaries, release verification, and published artifacts.
- The active `PROJECT.md` lagged the Phase 5 release until milestone completion.

### Patterns Established

- Recursive public-surface changes must update event schema tests, result contracts, package exports, changelog, docs, and examples together.
- Stream ancestry uses `parentRunIds` rather than a flat parent id.
- Local-provider safety is automatic via locality clamp rather than caller discipline.
- Runnable examples can default to deterministic providers while offering env-gated OpenAI-compatible live mode.

### Key Lessons

- Keep milestone-level archives as a final release step, separate from release tagging and npm publication.
- Ensure GSD workflow docs and installed CLI capabilities stay in sync before relying on `gsd-sdk query` automation.
- For public SDK work, archive requirements immediately after release so the next milestone starts from a clean requirements file.

### Cost Observations

- Model mix and session cost were not recorded in planning artifacts.
- Verification evidence came from phase summaries, `pnpm run verify`, release validation, GitHub Actions, and npm package checks.

## Cross-Milestone Trends

| Trend | Observation |
|-------|-------------|
| Public-surface discipline | Event/result/export changes consistently require tests, docs, changelog, and package allowlist updates. |
| Provider neutrality | New features continue to avoid SDK-owned credentials, pricing, persistence, queues, UI, or tool side effects. |
| Release readiness | Release identity checks and packed/import smoke tests remain core gates for package confidence. |
