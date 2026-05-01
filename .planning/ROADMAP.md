---
milestone: v0.5.0
status: executing
last_completed: v0.4.0
---

# Roadmap — Dogpile

## Milestones

- [x] **v0.4.0 Recursive Coordination** — Phases 1-5, 22 plans, 27/27 requirements; shipped 2026-05-01. Archive: [v0.4.0-ROADMAP.md](milestones/v0.4.0-ROADMAP.md)
- [ ] **v0.5.0 Observability and Auditability** — Phases 6-10, 13 requirements; in progress.

---

# v0.5.0 Observability and Auditability

**Milestone:** v0.5.0
**Phases:** 5 (Phases 6–10)
**Requirements:** 13
**Coverage:** 100%

## Phases

- [x] **Phase 6: Provenance Annotations** — Event-shape foundation: structured metadata on model request/response events (completed 2026-05-01)
- [x] **Phase 7: Structured Event Introspection + Health Diagnostics** — Typed query API over trace events and per-run health summaries (completed 2026-05-01)
- [ ] **Phase 8: Audit Event Schema** — Stable, versioned, independent audit record format for compliance
- [ ] **Phase 9: OTEL Tracing Bridge** — Duck-typed tracer injection with span ancestry matching parentRunIds
- [ ] **Phase 10: Metrics / Counters** — Named counter hook for token usage, cost, turn count, and duration

## Phase Table

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 6 | Provenance Annotations | Every model request and response event in a completed trace carries provenance metadata that survives replay | PROV-01, PROV-02 | 3 |
| 7 | Structured Event Introspection + Health Diagnostics | Callers can query trace events with a typed filter API and read a machine-readable health summary on every RunResult | INTR-01, INTR-02, HLTH-01, HLTH-02 | 4 |
| 8 | Audit Event Schema | Callers can produce a versioned, schema-stable audit record from any completed trace using a pure function | AUDT-01, AUDT-02 | 3 |
| 9 | OTEL Tracing Bridge | Callers can inject an optional duck-typed tracer and receive nested spans for runs, sub-runs, and agent turns with no overhead when absent | OTEL-01, OTEL-02, OTEL-03 | 4 |
| 10 | Metrics / Counters | Callers can supply an optional metrics hook and receive named counters at run and sub-run completion with no overhead when absent | METR-01, METR-02 | 3 |

## Phase Details

### Phase 6: Provenance Annotations
**Goal:** Every model request and response event in a completed trace carries structured provenance metadata (model id, provider id, call id, ISO-8601 timestamps), and that metadata is JSON-serializable and replay-stable.
**Depends on:** Nothing (first phase of this milestone)
**Requirements:** PROV-01, PROV-02
**Success criteria:**
1. A completed `RunResult` trace has provenance fields (`modelId`, `providerId`, `callId`, `startedAt`, `completedAt`) present on every `model-request` and `model-response` event.
2. Provenance timestamps are ISO-8601 strings — not `Date` objects — and pass a `JSON.stringify → JSON.parse` round-trip assertion without data loss.
3. A trace produced by `run()` and passed through `replay()` returns provenance fields identical to the originals, confirming event-shape stability.
**Plans:** 6 plans
Plans:
- [x] 06-01-PLAN.md — Type shape mutation + defaults.ts blast-radius fix
- [x] 06-02-PLAN.md — Runtime emission in model.ts + replay synthesis in engine.ts
- [x] 06-03-PLAN.md — Provider adapter modelId population (openai-compatible + vercel-ai)
- [x] 06-04-PLAN.md — /runtime/provenance subpath module + package.json wiring
- [x] 06-05-PLAN.md — Contract tests + frozen provenance-event-v1.json fixture
- [x] 06-06-PLAN.md — CHANGELOG v0.5.0 entry + CLAUDE.md invariant update

### Phase 7: Structured Event Introspection + Health Diagnostics
**Goal:** Callers can filter completed trace events through a typed query function and read a machine-readable health summary on `RunResult` that is deterministically re-computed from the same trace on any runtime.
**Depends on:** Phase 6
**Requirements:** INTR-01, INTR-02, HLTH-01, HLTH-02
**Success criteria:**
1. Caller passes filter criteria (event type, agent id, turn number, cost range) to a query function and receives a narrowed `RunEvent[]` — no type assertions required at the call site.
2. Introspection query composes filters; an empty filter set returns all events; an unmatched filter set returns an empty array.
3. `result.health` is present on every `RunResult` and contains an `anomalies` array with machine-readable codes (`runaway-turns`, `budget-near-miss`, `empty-contribution`, `provider-error-recovered`) and configurable thresholds.
4. Calling `replay(trace)` produces a `RunResult` whose `health` summary is byte-for-byte identical to the original run's health summary, confirming deterministic re-computation.
**Plans:** 5 plans
Plans:
- [x] 07-01-PLAN.md — Types + contracts: RunHealthSummary/HealthAnomaly/AnomalyCode in types.ts, skeleton modules, frozen fixture
- [x] 07-02-PLAN.md — queryEvents implementation + unit tests (introspection)
- [x] 07-03-PLAN.md — computeHealth implementation + unit tests (health diagnostics)
- [x] 07-04-PLAN.md — Engine attach: result.health on run/replay paths + canonicalizeRunResult + contract tests
- [x] 07-05-PLAN.md — Public-surface lockstep: package.json subpaths + package-exports.test.ts + CHANGELOG + CLAUDE.md

### Phase 8: Audit Event Schema
**Goal:** Callers can produce a stable, versioned audit record from any completed trace using a pure function; the record type is independent of `RunEvent` schema and its shape is protected by a frozen fixture test.
**Depends on:** Phase 7
**Requirements:** AUDT-01, AUDT-02
**Success criteria:**
1. Calling the audit function on a completed trace returns an object with `auditSchemaVersion: "1"` plus run-level fields (run id, intent, timestamps, agent count, outcome, cost).
2. `AuditRecord` is a standalone exported type — callers can import and reference it without importing any `RunEvent` variant.
3. A frozen JSON fixture (`src/tests/fixtures/audit-record-v1.json`) exists and the test suite rejects any schema change that is not accompanied by an explicit fixture update.
**Plans:** 3 plans
Plans:
**Wave 1**
- [x] 08-01-PLAN.md — AuditRecord types + createAuditRecord implementation + co-located unit tests

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 08-02-PLAN.md — Frozen fixture (audit-record-v1.json) + type-check.ts + shape test

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 08-03-PLAN.md — Public-surface lockstep: /runtime/audit subpath + package-exports.test.ts + CHANGELOG + CLAUDE.md

**Cross-cutting constraints:**
- `AuditRecord` type has zero imports from RunEvent variants in its declaration block
- `childRunIds?` uses `exactOptionalPropertyTypes` conditional spread (absent when no sub-runs)
- All `readonly` fields on AuditRecord, AuditOutcome, AuditCost, AuditAgentRecord

### Phase 9: OTEL Tracing Bridge
**Goal:** Callers can inject an optional duck-typed OTEL-compatible tracer on `EngineOptions`; when present the SDK emits spans for run start/end, sub-run start/end, and agent turn start/end with correct parent-child ancestry; when absent runs complete with zero span overhead.
**Depends on:** Phase 6
**Requirements:** OTEL-01, OTEL-02, OTEL-03
**Success criteria:**
1. A caller passes an `@opentelemetry/sdk-trace-base` `InMemorySpanExporter`-backed tracer as `options.tracer` and records spans named `dogpile.run`, `dogpile.sub-run`, and `dogpile.agent-turn` after a completed run — no `@opentelemetry/*` import is present in SDK source files under `src/runtime/`.
2. Spans produced for delegate child runs appear as children of the parent run span, not as disconnected root spans, matching the `parentRunIds` ancestry chain.
3. A run configured without `options.tracer` completes with identical result shape, no thrown exceptions, and no detectable span allocation overhead.
4. The duck-typed `DogpileTracer` interface is exported from `/runtime/tracing` and structurally satisfies any real `@opentelemetry/api@1.9.x` `Tracer` without a shared import.
**Plans:** TBD

### Phase 10: Metrics / Counters
**Goal:** Callers can supply an optional metrics hook on `EngineOptions` and receive named counters (token usage, cost, turn count, duration) at run and sub-run completion; omitting the hook adds zero overhead.
**Depends on:** Phase 9
**Requirements:** METR-01, METR-02
**Success criteria:**
1. A caller provides a `metricsHook` function on `EngineOptions` and receives a call with named counters (`inputTokens`, `outputTokens`, `costUsd`, `turns`, `durationMs`) once per completed run and once per completed sub-run.
2. A run configured without `metricsHook` completes with identical result shape, no thrown exceptions, and no counter-allocation overhead.
3. A throwing `metricsHook` does not propagate the error into the run result — the error is routed to the logger's `error` channel and the run completes normally.
**Plans:** TBD

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 6. Provenance Annotations | 6/6 | Complete | 2026-05-01 |
| 7. Structured Event Introspection + Health Diagnostics | 5/5 | Complete | 2026-05-01 |
| 8. Audit Event Schema | 0/3 | Not started | — |
| 9. OTEL Tracing Bridge | 0/? | Not started | — |
| 10. Metrics / Counters | 0/? | Not started | — |

---

<details>
<summary>v0.4.0 Recursive Coordination (Phases 1-5) — SHIPPED 2026-05-01</summary>

- [x] Phase 1: Delegate Decision & Sub-Run Traces (5/5 plans) — completed 2026-04-30
- [x] Phase 2: Budget, Cancellation, Cost Roll-Up (4/4 plans) — completed 2026-04-30
- [x] Phase 3: Provider Locality & Bounded Concurrency (3/3 plans) — completed 2026-05-01
- [x] Phase 4: Streaming & Child Error Escalation (4/4 plans) — completed 2026-05-01
- [x] Phase 5: Documentation & Changelog (6/6 plans) — completed 2026-05-01

</details>

---

*Last updated: 2026-05-01 — Phase 7 Plan 05 complete; public-surface lockstep verified.*
