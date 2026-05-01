---
gsd_state_version: 1.0
milestone: v0.5.0
milestone_name: Observability and Auditability
status: executing
last_updated: "2026-05-01T20:55:49Z"
last_activity: 2026-05-01 -- Completed 07-02 queryEvents implementation + unit tests
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 11
  completed_plans: 8
  percent: 73
---

# State

## Project Reference

**Core value:** Coordinated, observable, replayable multi-agent runs with a strict boundary — Dogpile owns the coordination loop; the application owns credentials, pricing, storage, queues, UI, and tool side effects.

**Current focus:** Phase 07 — Structured Event Introspection + Health Diagnostics

## Current Position

Phase: 07 (structured-event-introspection-health-diagnostics) — EXECUTING
Plan: 3 of 5
Status: Executing Phase 07
Last activity: 2026-05-01 -- Completed 07-02 queryEvents implementation + unit tests

```
Progress [███████---] 73% (8/11 milestone plans)
```

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases complete | 1 / 5 |
| Requirements complete | 6 / 13 |
| Plans complete | 8 / 11 |

## Accumulated Context

### Decisions

- **OTEL bridge uses tracer injection.** Caller passes an optional `tracer` object duck-typed against the OTEL Tracer interface. SDK emits spans when present, no-ops when absent. Zero new dependencies added to the runtime.
- **Public-surface invariants must move together.** Every event/result/exports change updates `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, `src/tests/package-exports.test.ts`, `package.json` `exports`/`files`, and `CHANGELOG.md`.
- **Phase 6 (Provenance) is the only event-shape change.** All other phases are pure additions or engine-option injections. Phase 6 must complete before OTEL (Phase 9) which depends on stable provenance fields.
- **Audit record is an independent type.** `AuditRecord` is not derived from `RunEvent` via Pick/Omit; it has its own `auditSchemaVersion: "1"` and is protected by a frozen fixture test.
- **No `@opentelemetry/*` imports in src/runtime/, src/browser/, src/providers/.** OTEL integration is duck-typed only; a grep-based test will enforce this boundary.
- **Phase 7 contracts ship before behavior.** `queryEvents` and `computeHealth` are stubbed contract surfaces in 07-01; 07-02 and 07-03 implement behavior against those signatures.
- **queryEvents filter semantics are locked.** Filters compose with AND semantics; `turnRange` uses global 1-based `agent-turn` positions and excludes non-turn events, while `costRange` only includes `agent-turn` and `broadcast` events.

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

**Next action:** Continue Phase 7 with 07-03 computeHealth implementation + unit tests.

---

*Last updated: 2026-05-01 — v0.5.0 Observability and Auditability roadmap created.*
