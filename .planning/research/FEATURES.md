# Feature Landscape: Observability and Auditability

**Domain:** TypeScript application SDK — multi-agent coordination observability
**Researched:** 2026-05-01
**Milestone:** v0.5.0

---

## Dependency Map (Read First)

The six features are not independent. Build order matters.

```
Provenance annotations (#6)
  └── prerequisite for: Audit event schema (#5)
  └── prerequisite for: OTEL span attributes (#1) — model/provider id on spans

Event introspection (#3)
  └── prerequisite for: Health / diagnostics (#4) — anomaly queries run over filtered events
  └── enables better: Metrics (#2) — turn/token queries become simpler

OTEL tracing bridge (#1)  →  independent (but shares provenance data)
Metrics / counters (#2)   →  independent (but shares provenance data)
```

**Bottom line:** provenance and event introspection come first. OTEL and metrics can be built in parallel with those. Audit schema is last because it depends on the stable provenance shape.

---

## Complexity Summary

| Feature | Complexity | Risk | Public-API Change? |
|---------|-----------|------|-------------------|
| #6 Provenance annotations | LOW-MEDIUM | MEDIUM (event shape change) | YES — `RunEvent` variants |
| #3 Event introspection | LOW | LOW | Additive only |
| #2 Metrics / counters | LOW | LOW | Additive only |
| #1 OTEL tracing bridge | MEDIUM-HIGH | MEDIUM (async context, sub-run spans) | Additive only |
| #4 Health / diagnostics | MEDIUM | LOW | Additive only |
| #5 Audit event schema | HIGH | HIGH (stable contract, regulatory) | YES — new top-level shape |

---

## Table Stakes

Features callers expect. Missing means the SDK's observability story is broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Caller-injected tracer (OTEL bridge) | Every production LLM SDK supports OTEL; Vercel AI SDK ships `experimental_telemetry`; callers will have existing trace pipelines they want Dogpile runs to appear in | MEDIUM-HIGH | Must be duck-typed — no `@opentelemetry/api` dep. Must be a no-op when absent. Must propagate sub-run spans as children. |
| Named numeric metrics via callback hook | Callers need token/cost/duration emitted into their existing metrics pipeline (StatsD, Prometheus, OTLP) without coupling to a specific library | LOW | Single `onMetric(name, value, labels)` callback. Mirrors `loggerFromEvents` pattern. |
| Typed filter/query over trace events | After a run, callers want to ask "all agent-turn events for agent X" or "cost-bearing events" without writing their own reduce. This is the ergonomic complement to the raw `RunEvent[]` array | LOW | Pure functions operating on `readonly RunEvent[]`. No new runtime state. Zero deps. |
| ISO-8601 timestamps on every event | Already present on all `RunEvent` variants (`at` field). What is missing is consistent presence of `modelId` and `providerId` on events where they are meaningful | LOW | Currently `model-request` and `model-response` have `providerId`. Provenance extends this to `agent-turn`. |

---

## Differentiators

Features that set the SDK apart. Not universally expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Sub-run span tree in OTEL | Most LLM observability tools show flat per-call spans. Dogpile's recursive coordination produces a real span tree: parent run → child run → agent turn → tool call. This is high-value for coordinator/delegate workflows and not commonly seen. | HIGH (async context propagation across sub-run boundaries) | `parentRunIds` already encodes the ancestry. OTEL bridge must walk it to set parent context. Span naming: `dogpile.run`, `dogpile.agent-turn`, `dogpile.tool-call`. |
| Per-run health summary with anomaly flags | Result-time diagnostics: runaway turn count, budget near-miss (>80% cap used), provider errors, stalled sub-runs, empty contributions. Callers can surface warnings without parsing raw events. | MEDIUM | Anomaly thresholds are judgment calls — expose them as configurable options. |
| Stable versioned audit record | `auditSchemaVersion` + stable JSON envelope that round-trips through storage and satisfies compliance needs (SOC2 evidence, EU AI Act audit logs). Follows CloudEvents 1.0 envelope convention: `specVersion`, `id`, `source`, `type`, `time`, `subject`, plus Dogpile-specific `data`. | HIGH | PII handling is caller policy — SDK never redacts or omits model content. Version must be declared and bumped on field changes. |
| Per-event provenance (model + provider + timestamp) | Every `agent-turn` and `model-response` event carries the exact `modelId` and `providerId` that produced it. Enables per-agent cost tracing in multi-provider setups (future) and satisfies audit "who said what" requirements. | LOW-MEDIUM | Breaking change to `RunEvent` shape: field is optional so existing serialized traces remain valid. Must be absent on events where no model call occurred (e.g., `role-assignment`, `sub-run-queued`). |

---

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Bundling `@opentelemetry/api` or `@opentelemetry/sdk-*` | Violates zero-deps contract; breaks provider neutrality; forces version pinning on callers | Duck-type a minimal structural subset of `Tracer` and `Span` inside Dogpile |
| Built-in exporters (Datadog, New Relic, OTLP HTTP) | SDK must remain pure TS with no runtime side-effects | Caller wires their `TracerProvider` to any exporter they choose |
| PII redaction / content masking in audit records | SDK never sees the semantic value of model outputs; redaction policy belongs to the application layer | Document that model text appears verbatim; callers should strip PII before persisting traces |
| File/disk audit log writer | Violates "caller owns persistence" constraint | Emit a structured `AuditRecord` type; caller writes it wherever work already lives |
| High-resolution timer via `perf_hooks` | `perf_hooks` is Node-only; breaks browser ESM contract | Use `Date.now()` or `performance.now()` from Web Performance API (available browser + Node ≥ 16) |
| Vendor-specific span attribute schemas (Datadog `_dd.*`, etc.) | Creates privileged paths | Emit only OTEL GenAI semantic conventions; caller can annotate further |
| Singleton global tracer registration | Breaks multi-tenant apps and test isolation | Tracer is always passed per-run, not registered globally |
| Built-in anomaly ML or scoring | Overkill; coupling to computation cost | Threshold-based flags with configurable thresholds |

---

## Feature Deep-Dives

### Feature #1: OTEL Tracing Bridge

**What callers need:**
- Pass a tracer at `DogpileOptions` / `EngineOptions` level (not per-turn).
- Get one span per run, one child span per agent turn, one child span per tool call, and nested child spans for sub-runs (coordinator/delegate).
- Spans must carry OTEL GenAI semantic convention attributes where meaningful.
- Bridge must be a no-op when no tracer is passed.

**OTEL interface to duck-type (structural subset — do not import the package):**
```typescript
interface DogpileTracer {
  startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean> }): DogpileSpan;
}
interface DogpileSpan {
  setAttribute(key: string, value: string | number | boolean): this;
  recordException(error: unknown): void;
  setStatus(status: { code: 0 | 1 | 2; message?: string }): void; // UNSET=0, OK=1, ERROR=2
  end(): void;
}
```

**Span tree for a coordinator/delegate run:**
```
dogpile.run (runId=A)
  dogpile.agent-turn (agentId=coordinator, turn=1)
  dogpile.run (runId=B, parentRunIds=[A])           ← sub-run
    dogpile.agent-turn (agentId=agent-1, turn=1)
    dogpile.tool-call (toolId=web-search)
    dogpile.agent-turn (agentId=agent-2, turn=2)
  dogpile.agent-turn (agentId=coordinator, turn=2)  ← synthesis
```

**Recommended GenAI semantic convention attributes (HIGH confidence — official OTEL spec):**
- `gen_ai.operation.name`: `"invoke_agent"` for runs, `"chat"` for agent turns
- `gen_ai.provider.name`: from `ConfiguredModelProvider.id` prefix (e.g., `"openai"`, `"anthropic"`)
- `gen_ai.request.model`: model id from provider
- `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`: from `CostSummary`
- `gen_ai.agent.id`: `agentId`
- `dogpile.run_id`: stable run id (custom attribute, SDK-namespaced)
- `dogpile.protocol`: protocol name
- `dogpile.depth`: recursion depth for sub-run spans

**Complexity note:** The hard part is propagating OTEL span context across the async sub-run boundary. Each child run must receive a `parentSpanContext` from the coordinator's active span. The `parentRunIds` chain already encodes the logical ancestry — the OTEL bridge needs to maintain a `Map<runId, DogpileSpan>` during execution to look up parent spans when a `sub-run-started` event fires.

**Architectural fit:** Follow the `loggerFromEvents` pattern. A `tracerFromEvents(tracer)` subscriber function consumes the existing `StreamHandle.subscribe` event feed. No engine changes needed for the happy path; sub-run context threading may need a small engine hook.

---

### Feature #2: Metrics / Counters

**What callers need:**
- Named numeric emissions that map to their existing metrics pipeline.
- Emitted after each meaningful unit: per-turn (tokens, cost), per-run (total duration, total cost, turn count), per-tool-call (latency).
- No metric accumulation inside the SDK — stateless emission only.

**Recommended hook shape:**
```typescript
interface MetricRecord {
  name: string;            // e.g., "dogpile.tokens.input"
  value: number;
  unit?: string;           // e.g., "token", "s", "USD"
  labels: Record<string, string>;  // e.g., { runId, agentId, protocol }
}
type OnMetric = (record: MetricRecord) => void;
```

**Standard metrics to emit (OTEL GenAI names where applicable):**

| Metric Name | Unit | When Emitted | Labels |
|-------------|------|-------------|--------|
| `gen_ai.client.token.usage` | `{token}` | Per agent turn | `runId`, `agentId`, `type: input\|output` |
| `gen_ai.client.operation.duration` | `s` | Per agent turn, per run | `runId`, `protocol`, `tier` |
| `dogpile.run.cost_usd` | `USD` | Per run completion | `runId`, `protocol`, `tier` |
| `dogpile.run.turns` | `{turn}` | Per run completion | `runId`, `protocol` |
| `dogpile.tool_call.duration` | `s` | Per tool call | `runId`, `toolId` |
| `dogpile.subrun.count` | `{run}` | Per coordinator run | `runId`, `depth` |

**Complexity:** LOW. This is a pure callback — no accumulation, no state, no deps. Can be implemented as an event subscriber over the existing stream.

---

### Feature #3: Structured Event Introspection

**What callers need:**
- After `result = await run(...)`, query `result.trace.events` with typed predicates rather than raw `Array.filter`.
- Get typed subsets: all `agent-turn` events, all events for a given `agentId`, cost-bearing events, events in a time range, sub-run events for a given child run id.

**Recommended API surface (pure functions, no class required):**
```typescript
// All proposed as named exports from @dogpile/sdk/runtime/events or similar
function filterEvents<T extends RunEvent>(events: readonly RunEvent[], type: T["type"]): T[];
function eventsByAgent(events: readonly RunEvent[], agentId: string): RunEvent[];
function costBearingEvents(events: readonly RunEvent[]): (TurnEvent | BroadcastEvent)[];
function eventsInRange(events: readonly RunEvent[], from: string, to: string): RunEvent[];
function subRunEvents(events: readonly RunEvent[], childRunId: string): RunEvent[];
function eventSummary(events: readonly RunEvent[]): EventSummary;

interface EventSummary {
  readonly totalTurns: number;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly agentsActive: readonly string[];
  readonly protocolDecisions: readonly string[];
  readonly durationMs: number;
}
```

**Complexity:** LOW. These are pure TS utility functions with no side effects. Full type safety comes from the existing `RunEvent` discriminated union. Primary implementation risk is exhaustively handling new event variants added in future milestones.

**Note:** These functions should work on both `result.trace.events` (full trace) and the events from a partial trace (child run events). The sub-run case means they must handle `parentRunIds` correctly.

---

### Feature #4: Health / Diagnostics API

**What callers need:**
- At result time: a structured summary of warnings and anomalies detected in the run.
- Machine-readable anomaly codes (not just human text) so callers can branch on them.
- Zero false positives in the default configuration; configurable thresholds.

**Recommended shape:**
```typescript
interface RunHealth {
  readonly healthy: boolean;
  readonly warnings: readonly HealthWarning[];
  readonly anomalies: readonly HealthAnomaly[];
}

interface HealthWarning {
  readonly code: HealthWarningCode;
  readonly message: string;
  readonly detail?: JsonObject;
}

type HealthWarningCode =
  | "budget-near-miss"       // used >80% of any cap
  | "empty-contribution"     // one or more agents produced zero-length output
  | "provider-error-recovered" // a provider error was caught and retried
  | "sub-run-budget-clamped"; // a sub-run's timeout was clamped by parent budget

interface HealthAnomaly {
  readonly code: HealthAnomalyCode;
  readonly message: string;
  readonly detail?: JsonObject;
}

type HealthAnomalyCode =
  | "runaway-turns"          // turns reached maxTurns cap without convergence
  | "zero-cost-run"          // run completed with no token usage recorded (provider missing usage)
  | "all-agents-abstained"   // broadcast round where every agent abstained
  | "sub-run-failure-rate";  // >50% of delegated sub-runs failed
```

**When to compute:** Post-run, over the completed `RunEvent[]` array. Pure function — no SDK-internal state. Expose as `analyzeHealth(events, accounting, options?)` where options holds threshold overrides.

**Complexity:** MEDIUM. The logic itself is straightforward filter/aggregate over events. The complexity is agreeing on what the thresholds should be and which codes to stabilize as public API (they become part of the contract). Start with a narrow set, expand over releases.

---

### Feature #5: Audit Event Schema

**What callers need:**
- A stable, versioned JSON record that captures: who ran a mission, what model was used, what protocol, when it started/completed, what it cost, and whether it succeeded.
- Forward-compatible: new fields must not break consumers of old records.
- Follows an established envelope convention (CloudEvents 1.0 is the most appropriate prior art for SDK-emitted records).

**Recommended shape (inspired by CloudEvents 1.0 envelope):**
```typescript
interface AuditRecord {
  readonly auditSchemaVersion: "1";   // bump on breaking field changes
  readonly id: string;                // stable record id (distinct from runId)
  readonly runId: string;
  readonly parentRunIds?: readonly string[];  // for sub-run audits
  readonly source: string;            // caller-supplied app identifier
  readonly type: "dogpile.run.completed" | "dogpile.run.failed" | "dogpile.run.aborted";
  readonly time: string;              // ISO-8601 run completion time
  readonly subject: string;           // intent (mission text)
  readonly actor: AuditActor;
  readonly outcome: AuditOutcome;
  readonly resource: AuditResource;
  readonly data: AuditData;
}

interface AuditActor {
  readonly modelProviderId: string;
  readonly agentIds: readonly string[];
  readonly protocol: string;
}

interface AuditOutcome {
  readonly status: "completed" | "failed" | "aborted" | "budget-stopped";
  readonly errorCode?: string;        // DogpileErrorCode when failed
  readonly terminationReason?: string; // NormalizedStopReason when budget-stopped
}

interface AuditResource {
  readonly tier: string;
  readonly budgetCaps?: JsonObject;
}

interface AuditData {
  readonly usage: RunUsage;
  readonly durationMs: number;
  readonly turnCount: number;
  readonly subRunCount: number;
}
```

**What callers provide:** A `source` string (their app identifier). The SDK fills everything else from `RunResult`.

**Complexity:** HIGH — not because the code is hard, but because the schema must be declared stable. Every field name is a contract. Recommend shipping as `auditSchemaVersion: "1"` with explicit docs that any field rename is a major version bump. PII: model output text is intentionally excluded from the default `AuditData`. Callers who need it can append to `data`.

**Prior art consulted:**
- CloudEvents 1.0 envelope: `specversion`, `id`, `source`, `type`, `time`, `subject`, `data`
- OCSF (Open Cybersecurity Schema Framework): category/action/outcome pattern
- AWS CloudTrail: `eventTime`, `eventSource`, `eventName`, `userIdentity`, `responseElements`

---

### Feature #6: Provenance Annotations

**What callers need:**
- Know exactly which model + provider produced each agent turn's output.
- Know the wall-clock timestamp range for each provider call.
- Present on the event, not just in `providerCalls` array of the trace (which requires cross-referencing by `callId`).

**What already exists:** `model-request` and `model-response` events already carry `providerId`. `ReplayTraceProviderCall` carries `startedAt`, `completedAt`, `providerId`, `agentId`.

**What is missing:** `agent-turn` events (`TurnEvent`) do not carry `modelId` or `providerId` directly. Callers must join `TurnEvent` → `ReplayTraceProviderCall` via matching `agentId` and turn order, which is fragile.

**Recommended addition:**
```typescript
// Add to TurnEvent:
readonly provenance?: {
  readonly modelId: string;      // ConfiguredModelProvider.id
  readonly providerId: string;   // same value, kept for symmetry
  readonly callId: string;       // cross-reference to providerCalls[callId]
  readonly startedAt: string;    // ISO-8601 when provider call began
  readonly completedAt: string;  // ISO-8601 when provider returned
};
```

Field is **optional** — this is a public-API change to `RunEvent` shape, so existing serialized traces must remain valid. Events where no model call occurs (`role-assignment`, `sub-run-queued`, `sub-run-budget-clamped`, `aborted`) MUST NOT have a `provenance` field.

**Complexity:** LOW-MEDIUM. The data is already collected in `model.ts` (`generateModelTurn` records `startedAt`/`completedAt`). The work is threading the data to the `TurnEvent` emit site and updating the event schema tests.

**Public-API change surface (per CLAUDE.md invariants):**
- `src/tests/event-schema.test.ts` — add provenance field tests
- `src/tests/result-contract.test.ts` — verify optional field round-trips
- `CHANGELOG.md` — document the field addition
- Schema version bump if provenance is required on future events

---

## Feature Dependencies (Consolidated)

```
Build order recommendation:

Phase 1 (unblock everything):
  #6 Provenance annotations  ← optional field on TurnEvent; enables #5 and enriches #1

Phase 2 (independent, parallelize):
  #3 Event introspection     ← pure utility functions; no deps
  #2 Metrics / counters      ← callback hook; no deps

Phase 3 (depend on Phase 1 + 2):
  #1 OTEL tracing bridge     ← uses provenance for span attributes
  #4 Health / diagnostics    ← uses event introspection for anomaly queries

Phase 4 (depends on all prior):
  #5 Audit event schema      ← needs provenance, stable outcome shape, and validated field set
```

---

## SDK-Specific Considerations

### The bridge-from-events pattern is the architectural template
v0.3.1 shipped `loggerFromEvents(logger)` — a subscriber that converts the existing `StreamHandle` event stream into structured log calls. The OTEL bridge and metrics hook should follow the exact same pattern: a subscriber function that consumes `RunEvent` values and calls into a caller-supplied interface. This means zero changes to the engine's hot path for the no-op case.

### Sub-run events already encode ancestry
`parentRunIds` on every `RunEvent` variant encodes the full root-first ancestry chain. The OTEL bridge can use this to set parent span context. The health diagnostics API can use it to walk only top-level events vs. all nested events. Event introspection needs to offer both scoped (one run) and tree-wide (all runs) query variants.

### Event shape changes require test + changelog co-ordination
Per `CLAUDE.md`: any change to `RunEvent` field shape requires updating `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, and `CHANGELOG.md`. Provenance (#6) is the only feature in this batch that makes a breaking-additive change to `RunEvent`. All others are purely additive (new functions, new top-level types, new options fields).

### Browser ESM constraint limits timer resolution
`perf_hooks` is Node-only. Use `Date.now()` for timestamps in provenance and health duration calculations. `performance.now()` is available in browser and Node ≥ 16 but produces process-relative values, not wall-clock ISO-8601 — use it only for duration arithmetic, not for the `at` timestamps that are already ISO-8601 strings.

### Duck-typing the OTEL interfaces is non-negotiable
The SDK cannot add `@opentelemetry/api` as a dependency. The structural interface subset to shadow is small:
- `Tracer.startSpan(name, options?)` returning a `Span`
- `Span.setAttribute`, `Span.recordException`, `Span.setStatus`, `Span.end`
- No `Context`, no `ContextManager`, no propagator — keep it minimal

---

## MVP Recommendation

If the milestone must ship a subset, prioritize in this order:

1. **#6 Provenance** — unblocks audit and enriches OTEL. Low implementation cost.
2. **#3 Event introspection** — highest ergonomic value; pure utility functions; zero risk.
3. **#2 Metrics hook** — one callback; immediately useful to most production callers.
4. **#1 OTEL bridge** — highest value for enterprise callers; harder but most visible.
5. **#4 Health diagnostics** — nice to have; implementable late in the milestone.
6. **#5 Audit schema** — defer if milestone is constrained; schema stability needs careful review.

---

## Sources

- [OTEL GenAI Span Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) — HIGH confidence, official OTEL spec
- [OTEL GenAI Agent Span Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/) — HIGH confidence, official OTEL spec
- [OTEL GenAI Metrics Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/) — HIGH confidence, official OTEL spec
- [Vercel AI SDK Telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry) — HIGH confidence, official Vercel AI docs; closest ecosystem peer
- CloudEvents 1.0 envelope spec — MEDIUM confidence (training data); used for audit schema envelope pattern
- Dogpile codebase `src/types/events.ts`, `src/types.ts`, `src/runtime/model.ts` — HIGH confidence, primary source
