# Architecture Patterns: v0.5.0 Observability and Auditability

**Domain:** TypeScript SDK — adding observability to an existing multi-agent coordination runtime
**Researched:** 2026-05-01
**Overall confidence:** HIGH (based on full source read + existing codebase docs)

---

## System Overview (Current, v0.4.0)

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Public surface (src/index.ts)                     │
│  Dogpile.pile / run / stream / createEngine / replay / replayStream  │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Engine / orchestrator                            │
│                  src/runtime/engine.ts                               │
│   normalizes options · abort lifecycle · replay/replayStream        │
└──────┬──────────────────┬──────────────────┬──────────────────┬─────┘
       │                  │                  │                  │
       ▼                  ▼                  ▼                  ▼
  sequential          broadcast          coordinator          shared
       │                  │                  │                  │
       └────────────┬─────┴───────────────────┴──────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│         Per-turn / cross-cutting helpers                             │
│  model.ts · decisions.ts · termination.ts · tools.ts                │
│  wrap-up.ts · cancellation.ts · defaults.ts · validation.ts         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## System Overview (Target, v0.5.0)

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Public surface (src/index.ts)                     │
│  + HealthSummary, computeHealth, queryEvents                         │
│  + toAuditRecord, AuditRecord                                        │
│  + Tracer (duck-typed), MetricsHook                                  │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Engine (src/runtime/engine.ts)                   │
│  + tracer?: Tracer on EngineOptions                                  │
│  + metricsHook?: MetricsHook on EngineOptions                        │
│  + health: HealthSummary on RunResult (computed via computeHealth)   │
│  + span wrapping in runNonStreamingProtocol / stream execute()       │
└──────┬──────────────────┬──────────────────┬──────────────────┬─────┘
       │                  │                  │                  │
       ▼                  ▼                  ▼                  ▼
  sequential          broadcast          coordinator          shared
                                              │
                                    + child span wrapping in
                                      delegate dispatch loop
                    │
                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│         Per-turn / cross-cutting helpers                             │
│  model.ts: + provider-call span wrapping (startedAt already exists)  │
│  events.ts: + optional provenance fields on RunEvent variants        │
│  NEW: src/runtime/tracing.ts   — Tracer duck-type, noop impl        │
│  NEW: src/runtime/metrics.ts   — MetricsHook, noop impl             │
│  NEW: src/runtime/introspection.ts — queryEvents, computeHealth      │
│  NEW: src/runtime/audit.ts     — AuditRecord schema, toAuditRecord   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

### New Files (pure additions — no modification to existing modules)

| File | Responsibility | Depends On |
|------|---------------|------------|
| `src/runtime/tracing.ts` | Duck-typed `Tracer` + `Span` interfaces; `noopTracer`; `tracerFromEvents` helper | `src/types.ts` only |
| `src/runtime/metrics.ts` | `MetricsHook` interface; `noopMetricsHook`; `metricsFromEvents` helper | `src/types.ts` only |
| `src/runtime/introspection.ts` | `queryEvents(events, filter)` pure function; `computeHealth(trace)` → `HealthSummary` | `src/types.ts` only |
| `src/runtime/audit.ts` | `AuditRecord` versioned type; `toAuditRecord(trace)` pure function | `src/types.ts` only |

All four must remain pure TS (no `node:*` imports, no `fs`, no env). They operate on already-serialized `RunEvent[]` and `Trace` — no side effects.

### Modified Files

| File | What Changes | Risk |
|------|-------------|------|
| `src/types/events.ts` | Add optional `provenance?: ProvenanceAnnotation` to model-activity events: `ModelRequestEvent`, `ModelResponseEvent`, `ModelOutputChunkEvent`, `ToolCallEvent`, `ToolResultEvent`, `FinalEvent` | PUBLIC SURFACE — triggers `event-schema.test.ts` + `result-contract.test.ts` + CHANGELOG |
| `src/types.ts` (aggregator) | Re-export `HealthSummary`, `AuditRecord`, `ProvenanceAnnotation`, `Tracer`, `Span`, `MetricsHook`, `MetricSnapshot` | PUBLIC SURFACE |
| `src/runtime/engine.ts` | Add `tracer?` + `metricsHook?` to `EngineOptions`; span wrapping in `runNonStreamingProtocol` and `stream execute()`; compute `health` field on `RunResult` after `canonicalizeRunResult` via `computeHealth` | CORE — must not change `RunResult` shape for callers that don't pass `tracer` |
| `src/runtime/model.ts` | Wrap `model.generate` / `model.stream` in a provider-call span when `tracer` is present; thread `tracer` down through `generateModelTurn` options | Low risk — localized to `generateModelTurn` |
| `src/runtime/coordinator.ts` | Wrap `delegate` child dispatch in a child-run span; pass `tracer` into recursive `runProtocol` calls | Medium risk — must not affect `sub-run-*` event shapes |
| `src/runtime/defaults.ts` | Plumb `health` field into `RunResult` construction; emit named metric snapshots via `metricsHook` in `createRunAccounting` | Low risk — additive field |
| `src/index.ts` | Export new types and functions from the four new modules | PUBLIC SURFACE |
| `package.json` | Add 4 new subpath exports | PUBLIC SURFACE — three-file gate (package.json + package-exports.test.ts + check-package-artifacts.mjs) |

---

## Integration Points

### 1. Provenance Annotations → `src/types/events.ts`

Provenance follows the existing inline convention (like `parentRunIds`, `providerId`). It does NOT use a sub-object indirection.

Each model-activity event gets optional fields:

```typescript
interface ProvenanceAnnotation {
  readonly modelProviderId: string;
  readonly modelId?: string;         // from ConfiguredModelProvider.id
  readonly startedAt: string;        // ISO-8601, already exists on provider calls
  readonly completedAt?: string;     // ISO-8601, from ReplayTraceProviderCall
}
```

These fields are already captured in `ReplayTraceProviderCall` (see `model.ts:recordProviderCall`). Provenance simply promotes them onto the event itself so they are queryable without joining against `trace.providerCalls`.

`model.ts` is where `generateModelTurn` already receives `model.id` and emits model events. Provenance population is entirely localized to that file.

Constraint: every new field must be JSON-primitive-or-array only (`string | number | boolean | readonly string[]`). No `Date`, no `undefined` in required positions. Use `readonly` on all fields.

### 2. OTEL Tracing Bridge → `src/runtime/tracing.ts` + `engine.ts` + `coordinator.ts` + `model.ts`

**Design decision:** `tracer` is a first-class option on `EngineOptions`, NOT a stream subscriber.

Rationale: PROJECT.md requires spans for "runs, sub-runs, and agent turns." OTEL spans need lifecycle (start before async operation, end after) to propagate parent context correctly. A subscriber-only approach reconstructs spans post-hoc from saved timestamps but cannot propagate ambient OTEL context across async calls.

The `Tracer` interface in `tracing.ts` is duck-typed against OTEL's tracer — no `@opentelemetry/api` peer dependency:

```typescript
// src/runtime/tracing.ts
export interface Span {
  setAttribute(key: string, value: string | number | boolean): this;
  setStatus(status: "ok" | "error", message?: string): this;
  end(): void;
}

export interface Tracer {
  startSpan(name: string, options?: { readonly parentSpan?: Span }): Span;
}
```

Span emission sites:
- `engine.ts:runNonStreamingProtocol` — root run span (`dogpile.run`)
- `engine.ts:stream execute()` — root run span for streaming path
- `coordinator.ts` delegate loop — child run span per `sub-run-started` event (`dogpile.sub-run`)
- `model.ts:generateModelTurn` — provider call span per turn (`dogpile.provider-call`)

When `tracer` is absent, a `noopTracer` (always returns a `noopSpan`) is used in all sites — zero cost.

**Replay path:** `tracerFromEvents(events, tracer)` in `tracing.ts` reconstructs spans from saved event timestamps. This is the post-hoc equivalent for persisted traces. Explicitly not equivalent to live context propagation — document this asymmetry.

### 3. Metrics / Counters → `src/runtime/metrics.ts` + `engine.ts` + `defaults.ts`

```typescript
// src/runtime/metrics.ts
export interface MetricSnapshot {
  readonly name: string;
  readonly value: number;
  readonly unit: "tokens" | "usd" | "count" | "ms";
  readonly labels?: Readonly<Record<string, string>>;
}

export interface MetricsHook {
  emit(metric: MetricSnapshot): void;
}
```

`metricsHook` on `EngineOptions`. Emission sites:
- End of `createRunAccounting` in `defaults.ts` — named metrics: `dogpile.tokens.input`, `dogpile.tokens.output`, `dogpile.cost.usd`, `dogpile.turns.count`, `dogpile.run.duration_ms`
- Per sub-run completion in `coordinator.ts` — child-level metric rollups

When `metricsHook` is absent, no call sites execute (guard: `options.metricsHook?.emit(...)`).

`metricsFromEvents(events, hook)` in `metrics.ts` provides a post-hoc emitter for replay scenarios. Pattern mirrors `loggerFromEvents`.

### 4. Structured Event Introspection → `src/runtime/introspection.ts`

Pure functions — no class, no state. Matches the function-first convention of `replay`, `recomputeAccountingFromTrace`, `evaluateTermination`.

```typescript
// src/runtime/introspection.ts
export interface EventQuery {
  readonly type?: RunEvent["type"] | ReadonlyArray<RunEvent["type"]>;
  readonly agentId?: string;
  readonly runId?: string;
  readonly turnRange?: { readonly from?: number; readonly to?: number };
}

export function queryEvents(events: readonly RunEvent[], query: EventQuery): readonly RunEvent[];
```

If chaining is desired in the future, return a typed query result object rather than a class. The surface stays small for v0.5.0.

No engine modification required. Operates entirely on `trace.events` post-run.

### 5. Health / Diagnostics → `src/runtime/introspection.ts` (bundled with introspection)

Health diagnostics live in `introspection.ts` rather than a separate file. Both are pure read-only views over a completed trace.

```typescript
export interface HealthWarning {
  readonly code: "runaway-turns" | "budget-near-miss" | "provider-error-rate" | "no-contribution";
  readonly message: string;
  readonly detail?: Readonly<Record<string, string | number>>;
}

export interface HealthSummary {
  readonly status: "healthy" | "degraded" | "critical";
  readonly warnings: readonly HealthWarning[];
}

export function computeHealth(trace: Trace): HealthSummary;
```

**Placement on RunResult:** `health: HealthSummary` is added as a required field on `RunResult`. Computed inside `runNonStreamingProtocol` after the result is finalized, via `computeHealth(result.trace)`. The `replay()` function also calls `computeHealth(trace)` on the saved trace, keeping replay and live results symmetric.

This mirrors the `accounting` field precedent exactly: `accounting` is a pure function of the trace (`recomputeAccountingFromTrace`), not stored in `Trace` itself, and recomputed identically by `replay()`.

### 6. Audit Event Schema → `src/runtime/audit.ts`

```typescript
// src/runtime/audit.ts
export const AUDIT_SCHEMA_VERSION = "1.0" as const;
export type AuditSchemaVersion = typeof AUDIT_SCHEMA_VERSION;

export interface AuditRecord {
  readonly schemaVersion: AuditSchemaVersion;
  readonly runId: string;
  readonly protocol: string;
  readonly modelProviderId: string;
  readonly startedAt: string;    // from first event's at
  readonly completedAt: string;  // from final event's at
  readonly agentsUsed: readonly string[];
  readonly totalTokens: number;
  readonly totalCostUsd?: number;
  readonly turnCount: number;
  readonly terminationReason?: string;
  readonly health: HealthSummary;
  readonly events: readonly AuditEventRecord[];
}

export function toAuditRecord(trace: Trace): AuditRecord;
```

Pure function of `Trace`. Depends on `computeHealth` from `introspection.ts`. No engine modification.

---

## Data Flow: Provenance Through the Trace Contract

Provenance is the only feature that modifies existing event shapes. The flow is:

```
model.ts:generateModelTurn
  → receives: model.id, startedAt (already computed), callId
  → emits: model-request event (+ provenance.modelProviderId, provenance.startedAt)
  → collects response
  → emits: model-response event (+ provenance.completedAt)
  → records: ReplayTraceProviderCall (already has startedAt, completedAt)
```

Because `ReplayTraceProviderCall` already captures this data, provenance on events is a promotion — not a new data collection. No new provider calls, no new timestamps.

All provenance fields are optional (`provenance?:`) to allow backward-compatible deserialization of v0.4.x traces through v0.5.0's `replay()`.

---

## New Subpath Exports

Four new subpaths, each with a single concern. Follows the `/runtime/logger`, `/runtime/retry` grain.

| Subpath | Entry File | Exports |
|---------|-----------|---------|
| `@dogpile/sdk/runtime/tracing` | `src/runtime/tracing.ts` | `Tracer`, `Span`, `noopTracer`, `tracerFromEvents` |
| `@dogpile/sdk/runtime/metrics` | `src/runtime/metrics.ts` | `MetricsHook`, `MetricSnapshot`, `noopMetricsHook`, `metricsFromEvents` |
| `@dogpile/sdk/runtime/introspection` | `src/runtime/introspection.ts` | `queryEvents`, `computeHealth`, `HealthSummary`, `HealthWarning`, `EventQuery` |
| `@dogpile/sdk/runtime/audit` | `src/runtime/audit.ts` | `toAuditRecord`, `AuditRecord`, `AUDIT_SCHEMA_VERSION`, `AuditSchemaVersion` |

Each new subpath requires atomic update of three files: `package.json#exports` + `package.json#files` (covered by `dist/runtime/*.js` glob, no change needed) + `src/tests/package-exports.test.ts` + `scripts/check-package-artifacts.mjs`.

---

## Build Order and Cross-Feature Dependencies

Feature dependency graph:

```
provenance (event-shape)
    │
    ├── tracing (consumes provenance fields for span attribution)
    ├── audit   (consumes provenance in AuditEventRecord)
    └── introspection (can filter by provenance fields)

introspection/health
    │
    └── audit (toAuditRecord calls computeHealth)

metrics — independent of all above (consumes accounting only)
```

### Recommended Phase Sequence

**Phase 1 — Provenance Annotations**
- Modify `src/types/events.ts` to add optional `provenance?` fields
- Populate in `src/runtime/model.ts:generateModelTurn`
- Update `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, CHANGELOG
- Risk: highest (public event shape change); isolate here so subsequent phases build on a stable shape
- New files: none; modified files: `events.ts`, `model.ts`, two test files

**Phase 2 — Structured Event Introspection + Health Diagnostics**
- Create `src/runtime/introspection.ts` with `queryEvents` + `computeHealth`
- Add `health: HealthSummary` to `RunResult` — wire into `engine.ts` (non-streaming and streaming) and `replay()`
- Add subpath `@dogpile/sdk/runtime/introspection`
- Risk: medium (RunResult shape change); must update `result-contract.test.ts`
- New files: `introspection.ts`; modified files: `engine.ts`, `defaults.ts`, `types.ts`, `index.ts`, `package.json`, 3 gate files

**Phase 3 — Audit Event Schema**
- Create `src/runtime/audit.ts` with `toAuditRecord`
- Depends on Phase 1 (provenance) and Phase 2 (`computeHealth`)
- Add subpath `@dogpile/sdk/runtime/audit`
- Risk: low (new file, pure function, no engine change)
- New files: `audit.ts`; modified files: `index.ts`, `package.json`, 2 gate files

**Phase 4 — OTEL Tracing Bridge**
- Create `src/runtime/tracing.ts` with duck-typed `Tracer` interface + `noopTracer` + `tracerFromEvents`
- Add `tracer?: Tracer` to `EngineOptions`; wire into `engine.ts`, `coordinator.ts`, `model.ts`
- Add subpath `@dogpile/sdk/runtime/tracing`
- Risk: high (engine + coordinator + model.ts all touched); place after provenance so span attributes can reference provenance fields
- New files: `tracing.ts`; modified files: `engine.ts`, `coordinator.ts`, `model.ts`, `validation.ts`, `index.ts`, `package.json`, 2 gate files

**Phase 5 — Metrics / Counters**
- Create `src/runtime/metrics.ts` with `MetricsHook` interface + `noopMetricsHook` + `metricsFromEvents`
- Add `metricsHook?: MetricsHook` to `EngineOptions`; wire emit sites into `defaults.ts` and `coordinator.ts`
- Add subpath `@dogpile/sdk/runtime/metrics`
- Risk: low (engine option is additive; all guarded by optional chaining)
- New files: `metrics.ts`; modified files: `engine.ts`, `defaults.ts`, `coordinator.ts`, `index.ts`, `package.json`, 2 gate files

---

## Architectural Constraints That Apply to Every Phase

**Pure-TS runtime invariant:** All four new files (`tracing.ts`, `metrics.ts`, `introspection.ts`, `audit.ts`) must contain zero `node:*` imports. They must pass the browser bundle smoke test. The `Tracer` and `MetricsHook` interfaces are duck-typed in the SDK's own type namespace — no `@opentelemetry/api`, no `prom-client`, no peer deps.

**Replayable trace contract:** `health` on `RunResult` must be reconstructable by `replay()` from the same `Trace`. The contract is: `computeHealth(trace)` deterministically produces the same `HealthSummary` given the same events. No mutable state, no timestamps outside the trace.

**Optional provenance backward compatibility:** All `provenance?` fields are optional. Old traces without provenance replay cleanly through v0.5.0's `replay()`. `computeHealth` and `toAuditRecord` handle absent provenance gracefully with explicit `undefined` guards.

**No new required deps:** `devDependencies` may gain test utilities; `dependencies` must remain empty. Zero new items in `dependencies`.

**Event-shape gate is the hardest constraint.** Provenance changes to `events.ts` will break `src/tests/event-schema.test.ts` and `src/tests/result-contract.test.ts`. These tests are intentionally fragile — they protect the published contract. Every event-shape change must update them, not silence them.

---

## Anti-Patterns to Avoid

### Tracer as subscriber-only

A `tracerFromEvents` subscriber reconstructs spans post-hoc and cannot propagate OTEL ambient context across async calls. Callers who need real distributed tracing (parent-span propagation into the model provider's fetch calls) cannot use subscriber-only tracing. The `tracer` option on `EngineOptions` is the primary surface; `tracerFromEvents` is a convenience for replay and logging-style span reconstruction only.

### Health data in Trace

`HealthSummary` must NOT be stored inside `Trace`. It is computed from `Trace` deterministically, exactly like `accounting`. Storing it in `Trace` would duplicate information and create divergence risk between stored and recomputed values across SDK versions.

### Audit record in RunResult

`AuditRecord` is a formatted output artifact, not a result field. Callers who want audit records call `toAuditRecord(result.trace)` — it is not auto-attached to `RunResult`. This keeps `RunResult` from accumulating every reporting format.

### Engine accumulating new observable state per-run

`engine.ts` must remain stateless between `run()`/`stream()` calls on the same `Engine` instance. Tracing and metrics state is scoped to a single invocation — spans and metric snapshots are fire-and-forget; no state survives to the next call.

---

## Scalability Considerations

| Concern | v0.5.0 scope | Notes |
|---------|-------------|-------|
| Span volume | One span per run, sub-run, and provider call | O(turns × sub-runs); acceptable at any dogpile budget |
| Metric emission | One batch per run completion | No per-event overhead; sub-run metrics at delegate resolution |
| Health computation | O(events) linear scan | Bounded by `budget.maxIterations`; no concern |
| Introspection query | O(events) linear scan | Not hot-path; post-run analysis only |
| Audit record size | O(events) | Callers store; SDK doesn't persist |

---

## Sources

- `/Users/zakkeown/Code/dogpile/src/runtime/engine.ts` — full read; canonical span emission sites identified
- `/Users/zakkeown/Code/dogpile/src/runtime/model.ts` — `generateModelTurn` and `recordProviderCall`; provenance source of truth
- `/Users/zakkeown/Code/dogpile/src/runtime/logger.ts` — precedent for duck-typed hook interfaces and noop implementations
- `/Users/zakkeown/Code/dogpile/src/index.ts` — existing public surface; re-export pattern
- `/Users/zakkeown/Code/dogpile/package.json` — subpath export structure, files allowlist, zero `dependencies`
- `/Users/zakkeown/Code/dogpile/.planning/codebase/ARCHITECTURE.md` — existing component map, data flow, anti-patterns
- `/Users/zakkeown/Code/dogpile/.planning/codebase/CONCERNS.md` — three-file gate fragility, event-shape fragility, pure-runtime invariant
- `/Users/zakkeown/Code/dogpile/.planning/PROJECT.md` — v0.5.0 feature specifications
