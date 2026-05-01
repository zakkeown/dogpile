# Technology Stack

**Project:** @dogpile/sdk — v0.5.0 Observability and Auditability
**Researched:** 2026-05-01
**Confidence:** HIGH (OTEL interfaces from source), MEDIUM (semantic conventions from official docs), HIGH (test deps from npm registry)

---

## Context

This is an **additive milestone** on an existing, locked stack. The base stack (Node 22/24, Bun, browser ESM, TypeScript 6, Vitest 4, Vite 8, pnpm 10.33.0) is already validated and not in scope.

The question is: what new types, interfaces, and test-only packages are needed for the six observability features?

---

## Recommended Stack — New Additions Only

### Runtime Additions (zero new runtime deps — all pure TS types)

| What | Where it lives | Why |
|------|---------------|-----|
| `DogpileTracer` duck-type interface | `src/runtime/tracing.ts` (new) | Caller-injected tracer; duck-typed against OTEL `Tracer` so callers can pass `@opentelemetry/api`'s `Tracer` without Dogpile importing it |
| `DogpileSpan` duck-type interface | same file | Minimal subset of OTEL `Span` needed by the SDK's span lifecycle — avoids importing any OTEL package |
| `MetricsHook` type | `src/runtime/metrics.ts` (new) | Caller-supplied `(metric: string, value: number, tags: Record<string, string>) => void` — typed hook, zero dep |
| `RunHealth` / `HealthDiagnostics` types | `src/runtime/health.ts` (new) | Return types for per-run health summary API |
| `AuditRecord` / `AuditEvent` types | `src/runtime/audit.ts` (new) | Stable versioned audit record shape; schema version field `"1.0"` embedded in type |
| `ProvenanceAnnotation` type | `src/types/events.ts` (extension) | Added as optional field to existing event types; `modelId`, `providerId`, `startedAt`, `completedAt` |

All of the above are **pure TypeScript type/interface additions**. No new runtime dependency is required.

---

## OTEL Duck-Type Interface — Exact Shapes

The SDK must be compatible with `@opentelemetry/api@1.9.x` without importing it. The following interfaces are the minimum subset needed. They are structurally compatible with the real OTEL API types — any object implementing `Tracer` from `@opentelemetry/api` satisfies `DogpileTracer`.

### `DogpileSpan` (duck-type for OTEL `Span`)

```typescript
// src/runtime/tracing.ts
export interface DogpileSpanStatus {
  readonly code: 0 | 1 | 2; // UNSET=0, OK=1, ERROR=2
  readonly message?: string;
}

export interface DogpileSpan {
  setAttribute(key: string, value: string | number | boolean | string[] | number[] | boolean[]): this;
  setStatus(status: DogpileSpanStatus): this;
  end(endTime?: number): void;
  recordException(exception: { readonly message?: string; readonly name?: string; readonly stack?: string }): void;
  isRecording(): boolean;
}
```

**Why this subset:** Dogpile only needs to: attach attributes (model id, agent id, run id, token counts), set status (ok/error), end the span, and record exceptions. `startActiveSpan`, `addEvent`, `addLink`, `spanContext`, and `updateName` are not needed by the SDK's coordination loop. Keeping the subset minimal means callers can pass a no-op object trivially, and real OTEL spans satisfy it structurally.

### `DogpileTracer` (duck-type for OTEL `Tracer`)

```typescript
// src/runtime/tracing.ts
export interface DogpileTracer {
  startSpan(name: string, options?: DogpileSpanOptions): DogpileSpan;
}

export interface DogpileSpanOptions {
  readonly kind?: 0 | 1 | 2 | 3 | 4; // SpanKind: INTERNAL=0, SERVER=1, CLIENT=2, PRODUCER=3, CONSUMER=4
  readonly attributes?: Record<string, string | number | boolean>;
  readonly startTime?: number; // epoch millis
}
```

**No-op fallback:**

```typescript
// src/runtime/tracing.ts
const NOOP_SPAN: DogpileSpan = {
  setAttribute() { return this; },
  setStatus() { return this; },
  end() {},
  recordException() {},
  isRecording() { return false; },
};

export const noopTracer: DogpileTracer = {
  startSpan() { return NOOP_SPAN; },
};
```

**Why `startSpan` only (not `startActiveSpan`):** Dogpile's coordination loop is not context-propagation-based; spans are manually tracked by run/sub-run id. `startActiveSpan` carries context-manager semantics that require a platform context stack — not compatible with the browser ESM constraint. `startSpan` + manual parent/child linkage via `attributes["dogpile.run_id"]` and `attributes["dogpile.parent_run_id"]` is sufficient.

### Structural compatibility guarantee

Any value satisfying `@opentelemetry/api`'s `Tracer` interface (which has `startSpan` and `startActiveSpan`) structurally satisfies `DogpileTracer` (which requires only `startSpan`). TypeScript's structural typing ensures this without a shared import.

---

## OpenTelemetry Semantic Conventions — Attribute Names to Use

The SDK should emit standard attribute keys where they map cleanly. Based on the OTEL GenAI semantic conventions (development-stage, `opentelemetry-specification` OTEL semconv):

| Dogpile concept | OTEL attribute key | Notes |
|----------------|-------------------|-------|
| Model provider id | `gen_ai.provider.name` | Use `ConfiguredModelProvider.id` |
| Request model | `gen_ai.request.model` | From agent spec or provider id |
| Input tokens | `gen_ai.usage.input_tokens` | From `ModelResponse.usage.inputTokens` |
| Output tokens | `gen_ai.usage.output_tokens` | From `ModelResponse.usage.outputTokens` |
| Operation | `gen_ai.operation.name` | `"chat"` for all agent turns |
| Run id | `dogpile.run_id` | Custom namespace; no semconv equivalent |
| Agent id | `dogpile.agent_id` | Custom namespace |
| Protocol | `dogpile.protocol` | Custom namespace |
| Turn number | `dogpile.turn` | Custom namespace |
| Cost USD | `dogpile.cost_usd` | Custom namespace |

**GenAI semconv status:** The `gen_ai.*` keys are in "development" stability as of early 2026 — they may change. Use them for the standard attributes but document them as subject to semconv versioning. Custom `dogpile.*` attributes are stable-by-definition since Dogpile owns them.

---

## Metrics Hook Design (no new dep)

```typescript
// src/runtime/metrics.ts
export type MetricName =
  | "dogpile.tokens.input"
  | "dogpile.tokens.output"
  | "dogpile.cost_usd"
  | "dogpile.turns"
  | "dogpile.duration_ms"
  | "dogpile.sub_runs";

export type MetricTags = Readonly<Record<string, string>>;

export interface MetricsHook {
  (name: MetricName, value: number, tags: MetricTags): void;
}
```

Caller can bridge this to any metrics system (Datadog StatsD, Prometheus, OTEL Metrics SDK) without Dogpile importing any of them.

---

## Audit Event Schema Design

The audit schema is a **versioned, JSON-serializable record** — not a streaming event type. It is derived from the completed trace but carries compliance-oriented fields explicitly. Key design points:

- **Schema version field** (`"schema": "dogpile-audit/1.0"`) embedded in the type so consumers can handle migrations
- **W3C Trace Context** headers (`traceparent`, `tracestate`) as optional fields if the caller provides a span context — not required, not generated internally
- The SDK provides a `toAuditRecord(result: RunResult, options?: AuditOptions): AuditRecord` function in a new `src/runtime/audit.ts` module

```typescript
// src/runtime/audit.ts (shape, not implementation)
export interface AuditRecord {
  readonly schema: "dogpile-audit/1.0";
  readonly runId: string;
  readonly parentRunIds?: readonly string[];
  readonly startedAt: string;        // ISO-8601, from first event
  readonly completedAt: string;      // ISO-8601, from final/error event
  readonly protocol: string;
  readonly outcome: "completed" | "budget-stop" | "aborted" | "error";
  readonly agentCount: number;
  readonly turnCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly modelIds: readonly string[];       // deduplicated provider ids
  readonly provenance: readonly ProvenanceAnnotation[];
  readonly traceContext?: {                   // caller-supplied W3C context
    readonly traceparent?: string;
    readonly tracestate?: string;
  };
}
```

---

## Test-Only devDependencies (NEW)

| Package | Version | Purpose | Why needed |
|---------|---------|---------|-----------|
| `@opentelemetry/api` | `^1.9.1` | Type source for duck-type verification tests | `devDependency` only — confirms `DogpileTracer` is structurally assignable from a real OTEL `Tracer`; never imported at runtime |
| `@opentelemetry/sdk-trace-base` | `^2.7.1` | `InMemorySpanExporter`, `SimpleSpanProcessor` for test assertions | `devDependency` only — lets tests verify span names, attributes, and parent/child linkage without a full backend |

**Why `sdk-trace-base` not `sdk-trace-node`:** `sdk-trace-base` provides the test exporter and is platform-neutral. `sdk-trace-node` adds Node-specific context managers and async hooks — unnecessary for Vitest tests that use manual span assertions. `sdk-trace-base@2.7.1` matches `api@1.9.1`.

**Installation:**
```bash
pnpm add -D @opentelemetry/api@^1.9.1 @opentelemetry/sdk-trace-base@^2.7.1
```

---

## What NOT to Add

| Package | Why excluded |
|---------|-------------|
| `@opentelemetry/api` as a runtime dep or peerDep | Breaks provider neutrality; callers may not use OTEL at all. Duck-typing covers the use case without a required dep. |
| `@opentelemetry/sdk-trace-node` | Node-only (async hooks, `AsyncLocalStorage`); violates the browser ESM constraint on `src/runtime/` |
| `@opentelemetry/sdk-trace-web` | Browser-only; violates isomorphic constraint; also unnecessary since Dogpile duck-types the interface |
| Any metrics SDK (`prom-client`, `dd-trace`, StatsD clients) | Callers own their metrics backend; `MetricsHook` is the right abstraction |
| Any structured logging library (`pino`, `winston`) | Already solved via the `Logger` interface in v0.3.1; no new dep needed |
| `uuid` or `nanoid` for audit record ids | Dogpile already generates run ids via `src/runtime/ids.ts`; reuse that |
| `zod` or schema validators | Audit records are TypeScript types + JSON-serializable; validation belongs to the caller |

---

## Subpath Export Changes

The new modules will require new subpath exports. Based on the existing pattern in `package.json`:

| New subpath | Source file | What it exports |
|-------------|------------|----------------|
| `@dogpile/sdk/runtime/tracing` | `src/runtime/tracing.ts` | `DogpileTracer`, `DogpileSpan`, `DogpileSpanOptions`, `DogpileSpanStatus`, `noopTracer` |
| `@dogpile/sdk/runtime/metrics` | `src/runtime/metrics.ts` | `MetricsHook`, `MetricName`, `MetricTags` |
| `@dogpile/sdk/runtime/health` | `src/runtime/health.ts` | `RunHealth`, `HealthWarning`, `HealthAnomaly` |
| `@dogpile/sdk/runtime/audit` | `src/runtime/audit.ts` | `AuditRecord`, `ProvenanceAnnotation`, `toAuditRecord` |

Each addition requires updating: `package.json` exports + files allowlist, `src/tests/package-exports.test.ts`, `scripts/check-package-artifacts.mjs`.

---

## Sources

- OpenTelemetry JS API `Tracer` interface: [opentelemetry-js/api/src/trace/tracer.ts](https://github.com/open-telemetry/opentelemetry-js/blob/main/api/src/trace/tracer.ts) — HIGH confidence
- OpenTelemetry JS `Span` interface: [opentelemetry-js/api/src/trace/span.ts](https://github.com/open-telemetry/opentelemetry-js/blob/main/api/src/trace/span.ts) — HIGH confidence
- `@opentelemetry/api` npm version: 1.9.1 (verified via `npm info`) — HIGH confidence
- `@opentelemetry/sdk-trace-base` npm version: 2.7.1 (verified via `npm info`) — HIGH confidence
- OpenTelemetry GenAI semantic conventions: [opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) — MEDIUM confidence (development-stage spec, may evolve)
- W3C Trace Context: [w3.org/TR/trace-context/](https://www.w3.org/TR/trace-context/) — HIGH confidence (stable W3C recommendation)
