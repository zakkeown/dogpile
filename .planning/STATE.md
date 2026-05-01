---
gsd_state_version: 1.0
milestone: v0.5.0
milestone_name: Observability and Auditability
status: planning
last_updated: "2026-05-01T00:00:00Z"
last_activity: 2026-05-01 -- Phase 6 planned (6 plans, 3 waves); ready to execute
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 6
  completed_plans: 0
  percent: 0
---

# State

## Project Reference

**Core value:** Coordinated, observable, replayable multi-agent runs with a strict boundary — Dogpile owns the coordination loop; the application owns credentials, pricing, storage, queues, UI, and tool side effects.

**Current focus:** v0.5.0 Observability and Auditability.

## Current Position

Phase: 6 — Provenance Annotations
Plan: —
Status: Ready to execute (6 plans planned)
Last activity: 2026-05-01 — Phase 6 planned (6 plans across 3 waves; verification passed)

```
Progress [----------] 0% (0/5 phases)
```

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases complete | 0 / 5 |
| Requirements complete | 0 / 13 |
| Plans complete | 0 / 6 |

## Accumulated Context

### Decisions

- **OTEL bridge uses tracer injection.** Caller passes an optional `tracer` object duck-typed against the OTEL Tracer interface. SDK emits spans when present, no-ops when absent. Zero new dependencies added to the runtime.
- **Public-surface invariants must move together.** Every event/result/exports change updates `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, `src/tests/package-exports.test.ts`, `package.json` `exports`/`files`, and `CHANGELOG.md`.
- **Phase 6 (Provenance) is the only event-shape change.** All other phases are pure additions or engine-option injections. Phase 6 must complete before OTEL (Phase 9) which depends on stable provenance fields.
- **Audit record is an independent type.** `AuditRecord` is not derived from `RunEvent` via Pick/Omit; it has its own `auditSchemaVersion: "1"` and is protected by a frozen fixture test.
- **No `@opentelemetry/*` imports in src/runtime/, src/browser/, src/providers/.** OTEL integration is duck-typed only; a grep-based test will enforce this boundary.

### Todos

(none)

### Blockers

(none)

## Deferred Items

- Per-turn health streaming (health diagnostics emitted as events during a run, not only at completion)
- Caller-defined-tree API: `Dogpile.nest({ children: [...] })`
- Cross-protocol shared transcript across parent/child boundary
- Per-child retry policy on `delegate` decisions
- `compactProvenance` deduplication mode
- Built-in OTLP HTTP exporter

## Session Continuity

**Next action:** Phase 6 planned. Run `/gsd-execute-phase 6` to execute Phase 6: Provenance Annotations.

---

*Last updated: 2026-05-01 — v0.5.0 Observability and Auditability roadmap created.*
