---
gsd_state_version: 1.0
milestone: v0.5.0
milestone_name: milestone
status: executing
last_updated: "2026-05-02T01:01:52Z"
last_activity: 2026-05-02 -- Phase 10 Plan 01 metrics contract surface completed
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 23
  completed_plans: 20
  percent: 87
---

# State

## Project Reference

**Core value:** Coordinated, observable, replayable multi-agent runs with a strict boundary — Dogpile owns the coordination loop; the application owns credentials, pricing, storage, queues, UI, and tool side effects.

**Current focus:** Phase 10 — Metrics / Counters

## Current Position

Phase: 10
Plan: Wave 2 / 10-02
Status: Executing Phase 10 plans
Last activity: 2026-05-02 -- Phase 10 Plan 01 metrics contract surface completed

```
Progress [█████████░] 87% (20/23 milestone plans)
```

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases complete | 4 / 5 |
| Requirements complete | 11 / 13 |
| Plans complete | 20 / 23 |
| Phase 08 P01 | 5 min | 2 tasks | 2 files |
| Phase 08 P02 | 4 min | 2 tasks | 3 files |
| Phase 08 P03 | 4 min | 2 tasks | 4 files |
| Phase 09 P00 | 4 min | 1 task | 2 files |
| Phase 09 P01 | 6 min | 2 tasks | 8 files |
| Phase 09 P02 | 14 min | 3 tasks | 2 files |
| Phase 09 P03 | 8 min | 3 tasks | 4 files |
| Phase 09 P04 | 6 min | 2 tasks | 3 files |
| Phase 10 P01 | 4 min | 2 tasks | 3 files |

## Accumulated Context

### Decisions

- **OTEL bridge uses tracer injection.** Caller passes an optional `tracer` object duck-typed against the OTEL Tracer interface. SDK emits spans when present, no-ops when absent. Zero new dependencies added to the runtime.
- **Public-surface invariants must move together.** Every event/result/exports change updates `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, `src/tests/package-exports.test.ts`, `package.json` `exports`/`files`, and `CHANGELOG.md`.
- **Phase 6 (Provenance) is the only event-shape change.** All other phases are pure additions or engine-option injections. Phase 6 must complete before OTEL (Phase 9) which depends on stable provenance fields.
- **Audit record is an independent type.** `AuditRecord` is not derived from `RunEvent` via Pick/Omit; it has its own `auditSchemaVersion: "1"` and is protected by a frozen fixture test.
- **No `@opentelemetry/*` imports in src/runtime/, src/browser/, src/providers/.** OTEL integration is duck-typed only; a grep-based test will enforce this boundary.
- **Tracing contract is locked before engine wiring.** `DogpileTracer`, `DogpileSpan`, `DogpileSpanOptions`, and `DOGPILE_SPAN_NAMES` are defined in `src/runtime/tracing.ts`; `tracer?: DogpileTracer` is present on `DogpileOptions` and `EngineOptions`; root exports are available while `/runtime/tracing` subpath wiring remains deferred to Phase 9 Plan 03.
- **Phase 7 contracts ship before behavior.** `queryEvents` and `computeHealth` are stubbed contract surfaces in 07-01; 07-02 and 07-03 implement behavior against those signatures.
- **queryEvents filter semantics are locked.** Filters compose with AND semantics; `turnRange` uses global 1-based `agent-turn` positions and excludes non-turn events, while `costRange` only includes `agent-turn` and `broadcast` events.
- **computeHealth provider recovery is deferred.** `provider-error-recovered` remains in the anomaly union and fixture but is never emitted until a future event-shape change provides a trace signal.
- **RunResult.health is required.** All public and embedded RunResult construction paths now compute health from trace data before returning or embedding results.
- **Protocol-level health is part of the result contract.** Sequential, broadcast, shared, and coordinator constructors compute health so stream results and delegated child subResults satisfy the same required contract as top-level run and replay results.
- **Phase 7 public surface is locked.** `AnomalyCode`, `HealthAnomaly`, and `RunHealthSummary` are root-exported; `@dogpile/sdk/runtime/health` and `@dogpile/sdk/runtime/introspection` are package subpaths with package export tests, source-map packaging coverage, changelog, and CLAUDE.md invariants.
- **Phase 9 live sub-run fixture is available.** `createDelegatingDeterministicProvider` emits a real delegate decision and paired sub-run lifecycle events for OTEL-02 contract tests without synthetic event injection.
- **Phase 9 engine tracing uses internal runProtocol wrapping.** `openRunTracing`, `handleTracingEvent`, and `closeRunTracing` wrap internal `runProtocol` so both top-level and delegated child runs emit `dogpile.run` spans. A narrow coordinator callback-shape change passes the planned `childRunId` through as internal `runId` for deterministic `subRunSpansByChildId` lookup.
- **Phase 9 tracing public surface is locked.** `@dogpile/sdk/runtime/tracing` is package-exported, package-exports tests assert the subpath and type surface, no-otel-imports guards runtime/browser/provider roots, and the live OTEL contract test verifies run/sub-run/child-run parentage through `createDelegatingDeterministicProvider`.
- **Phase 9 docs lockstep is complete.** CHANGELOG.md, CLAUDE.md, and docs/developer-usage.md document the OTEL tracing bridge, WeakMap bridge pattern, span hierarchy, attribute surface, zero-overhead absent tracer behavior, and tracing-free replay contract. `pnpm run verify` passed.
- **Phase 9 code review findings were fixed before verification.** `dogpile.agent-turn` spans now use per-turn model-call accounting, and failed `dogpile.run` spans retain best-effort run id/count/cost attributes. Regression coverage lives in `src/tests/otel-tracing-contract.test.ts`.

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

**Next action:** Execute Phase 10 Plan 02 — Engine integration for metrics lifecycle.

---

*Last updated: 2026-05-02 — Phase 10 Plan 01 completed.*
