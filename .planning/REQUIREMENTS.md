# Requirements — v0.5.0 Observability and Auditability

**Milestone:** v0.5.0 Observability and Auditability
**Status:** Active
**Created:** 2026-05-01

---

## v1 Requirements

### Provenance Annotations

- [ ] **PROV-01**: Caller can read provenance metadata (model id, provider id, call id, ISO-8601 start/end timestamps) on model-request and model-response events in a completed trace
- [ ] **PROV-02**: Provenance fields are JSON-serializable and survive a round-trip through `replay()`

### Structured Event Introspection

- [ ] **INTR-01**: Caller can filter completed trace events by type, agent id, turn number, or cost range using a typed query function
- [ ] **INTR-02**: Introspection query returns typed subsets of `RunEvent[]` with no new types introduced (callers narrow, not cast)

### Health Diagnostics

- [ ] **HLTH-01**: Caller can read a structured health summary on `RunResult` with machine-readable anomaly codes (`runaway-turns`, `budget-near-miss`, `empty-contribution`, `provider-error-recovered`) and configurable thresholds
- [ ] **HLTH-02**: Health summary is computed at result time, available on `replay()`, and re-computed identically from the same trace on any runtime

### Audit Event Schema

- [ ] **AUDT-01**: Caller can produce a versioned (`auditSchemaVersion: "1"`) audit record from a completed trace using a pure function — not auto-attached to `RunResult`
- [ ] **AUDT-02**: `AuditRecord` type is independent of `RunEvent` schema and is validated by a frozen JSON fixture test that must be explicitly updated when the schema changes

### OTEL Tracing Bridge

- [ ] **OTEL-01**: Caller can inject a duck-typed OTEL-compatible tracer on `EngineOptions` (no `@opentelemetry/*` import required) and receive spans for run start/end, sub-run start/end, and agent turn start/end
- [ ] **OTEL-02**: Sub-run spans are nested under parent run spans reflecting the `parentRunIds` ancestry chain — delegate child runs do not appear as disconnected root traces in OTEL backends
- [ ] **OTEL-03**: Tracer injection is optional; runs complete with no span overhead and no observable behavior change when no tracer is provided

### Metrics / Counters

- [ ] **METR-01**: Caller can supply a metrics hook on `EngineOptions` and receive named counters (token usage, cost, turn count, duration) at run completion and sub-run completion
- [ ] **METR-02**: Metrics hook is optional; runs complete with no overhead when no hook is provided

---

## Future Requirements

<!-- Features deferred from this milestone for consideration in v0.6.0+ -->

- Per-turn health streaming (health diagnostics emitted as events during a run, not only at completion)
- Caller-defined-tree API: `Dogpile.nest({ children: [...] })` (from v0.4.0 deferred list)
- Cross-protocol shared transcript across parent/child boundary
- Per-child retry policy on `delegate` decisions
- `compactProvenance` deduplication mode (if trace size becomes a measured problem)
- Built-in OTLP HTTP exporter (caller owns exporters; defer indefinitely)

---

## Out of Scope

<!-- Explicit exclusions with reasoning -->

- **`@opentelemetry/*` as runtime or peer dependency** — pure-TS runtime constraint; all OTEL integration is via duck-typed injection
- **File/disk audit log writer** — caller owns persistence; SDK produces the record, not the sink
- **PII redaction** — caller policy; SDK does not inspect output text
- **Bundled metric exporters** (Datadog, StatsD, OTLP HTTP) — caller bridges any backend via the `MetricsHook` interface
- **`perf_hooks` or `process.hrtime`** — Node-only; timestamps use `Date.now()` / Web Performance API for cross-runtime compatibility
- **Singleton global tracer registration** — no module-level state; tracer is always caller-supplied per engine instance
- **Provenance on `model-output-chunk` events** — hot-path exclusion to prevent trace bloat and streaming performance regression

---

## Traceability

<!-- Filled by roadmapper — maps each REQ-ID to the phase that implements it -->

| REQ-ID | Phase | Phase Name |
|--------|-------|------------|
| PROV-01 | — | — |
| PROV-02 | — | — |
| INTR-01 | — | — |
| INTR-02 | — | — |
| HLTH-01 | — | — |
| HLTH-02 | — | — |
| AUDT-01 | — | — |
| AUDT-02 | — | — |
| OTEL-01 | — | — |
| OTEL-02 | — | — |
| OTEL-03 | — | — |
| METR-01 | — | — |
| METR-02 | — | — |
