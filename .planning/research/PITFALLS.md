# Domain Pitfalls: Observability and Auditability for @dogpile/sdk

**Domain:** Adding OTEL tracing, metrics, event introspection, health diagnostics, audit records, and provenance to a pure-TS, provider-neutral SDK with a JSON-serializable replayable trace contract.
**Researched:** 2026-05-01
**Confidence:** HIGH — derived directly from the codebase (ARCHITECTURE.md, CONCERNS.md, engine.ts, PROJECT.md) and verified against OTel official documentation.

---

## Critical Pitfalls

### Pitfall 1: Non-JSON Values Leaking Into the Trace

**What goes wrong:** Provenance annotations, audit records, or OTEL span context objects are attached to `RunEvent` or `Trace` fields using types that are not JSON-serializable — `Date` objects, `Error` instances, `Map`, `Set`, `bigint`, `undefined` in arrays, `SpanContext` objects with method properties, or circular references. The trace passes TypeScript type-check but silently breaks `replay()`.

**Why it happens:** TypeScript's type system does not enforce JSON-serializability. Developers add `provenance: { timestamp: new Date(), span: spanContext }` and it typechecks fine. The `canonicalizeRunResult` path in `src/runtime/defaults.ts:500–525` already has this problem with arbitrary metadata; provenance adds more surface. `JSON.stringify(Date)` produces a string, but `JSON.parse` then gives back a string, not a `Date` — replay sees a different type than the original run.

**Consequences:** `replay()` and `replayStream()` are documented contracts. A non-JSON-serializable field silently corrupts the replay contract. `src/tests/result-contract.test.ts` and `src/tests/event-schema.test.ts` are the gates — they will catch obvious shape drift but will not catch a `Date` object that stringifies and then parses differently unless tests explicitly round-trip through `JSON.stringify → JSON.parse`.

**Prevention:**
- All provenance timestamps must be ISO-8601 strings (same pattern as existing `RunEvent.at`), never `Date` objects.
- Audit record fields must be `JsonValue` or a union of JSON-primitive types — import the existing `JsonObject` / `JsonValue` types from `src/types.ts` and use them as constraints.
- OTEL `SpanContext` must never appear on any trace field; the bridge holds span context in closure scope and discards it after the span ends.
- Add an explicit `JSON.stringify → JSON.parse` round-trip assertion to `src/tests/result-contract.test.ts` for any new field class introduced by this milestone.
- Run `canonicalizeSerializable` on provenance/audit fields before they are assigned to events, using the existing helper rather than building a parallel one.

**Warning signs:** `typeof field === "object" && !(field instanceof null) && Object.keys(field).some(k => typeof (field as any)[k] === "function")` inside any new event field type.

**Phase to address:** OTel tracing bridge (span context in closure only) and provenance annotations (ISO timestamps, `JsonObject` constraints).

---

### Pitfall 2: `@opentelemetry/*` Imported Into `src/runtime/`

**What goes wrong:** A developer adds `import type { Tracer, Span } from "@opentelemetry/api"` or `import { trace } from "@opentelemetry/api"` to any file under `src/runtime/`, `src/browser/`, or `src/providers/`. The package becomes a peer dependency or a hidden runtime dep. The browser bundle smoke test fails because Vite cannot resolve `@opentelemetry/api` in the browser ESM build. Provider neutrality breaks because callers must now install an OTel SDK.

**Why it happens:** The canonical OTel approach for library authors is to depend on `@opentelemetry/api` only (which provides no-op implementations when no SDK is registered). This is a reasonable pattern for most libraries, but Dogpile's constraint is stricter: zero required dependencies in the runtime, and the same code must run on Node, Bun, and browser ESM without any peer SDK. The `@opentelemetry/api` package itself, despite being lightweight, is still a required install and a Node/browser compatibility surface that is not guaranteed.

**Consequences:** Breaking the browser bundle smoke (`src/tests/browser-bundle-smoke.test.ts`). Adding an unintended peer dependency that appears in consumer `package.json`. Violating the "no Node-only deps in `src/runtime/`" invariant documented in ARCHITECTURE.md.

**Prevention:**
- The tracer bridge must be a **duck-typed interface** defined inside `src/types.ts` or a new `src/runtime/otel-bridge.ts` — a structural type that matches the OTel `Tracer` and `Span` interfaces without importing from `@opentelemetry/api`. Example: `interface DuckTracer { startSpan(name: string, options?: {...}): DuckSpan }`.
- The SDK receives the duck-typed tracer via a caller-supplied option field (e.g., `tracer?: DuckTracer`) and calls `tracer?.startSpan(...)` only — never `trace.getTracer(...)`.
- Mirror the pattern already established by `withRetry` (`src/runtime/retry.ts`) and `loggerFromEvents` (`src/runtime/logger.ts`): caller injects; SDK defines the interface; no SDK import.
- The `devDependencies` list may include `@opentelemetry/api` for testing the bridge, but it must never appear in `dependencies` or `peerDependencies`.
- Add a grep-based test (alongside the existing node-import scan proposal in CONCERNS.md) that asserts no file under `src/runtime/`, `src/browser/`, or `src/providers/` contains `from "@opentelemetry`.

**Warning signs:** Any `npm install @opentelemetry/api` instruction in migration docs that targets runtime code.

**Phase to address:** OTEL tracing bridge — this is the foundational constraint for that feature.

---

### Pitfall 3: Caller Hooks Throwing and Crashing the Run

**What goes wrong:** A metrics counter hook, OTEL span operation, health diagnostic emitter, or audit sink throws an exception. Because these are called inline during a protocol turn, the unhandled throw propagates up through the protocol loop and terminates the run with an untyped error — or worse, it is caught by the AbortController logic and translated into a misleading `DogpileError("aborted")`.

**Why it happens:** Protocol loops in `sequential.ts`, `broadcast.ts`, `coordinator.ts`, and `shared.ts` are not hardened against exceptions from optional observation hooks — only against provider failures and cancellation signals. A new observability call site added inline to the turn loop will not be guarded unless the implementer explicitly wraps it.

**Consequences:** An observability misconfiguration takes down the run. This violates the principle that observability should be additive and non-destructive. Existing trace events are lost. `DogpileError.isInstance` checks in the engine may misclassify the failure.

**Prevention:**
- Every observability call site must be wrapped in a `try { hook(...) } catch (err) { logger.error?.("observability-hook-threw", err) }` guard, using the existing `Logger` interface from `src/runtime/logger.ts` as the error channel. This mirrors the pattern used by `loggerFromEvents` which already routes logger-level throws to the logger's own error method.
- Tracer `.startSpan`, `.setAttribute`, `.end`, and metrics hook calls must all be fire-and-forget with guarded invocations.
- Audit record serialization must not throw into the run — catch and emit a degraded record rather than terminating.
- Add a test: inject a tracer whose `startSpan` throws; assert the run completes successfully and the error appears in logger output, not in run failure.

**Warning signs:** Any unguarded `tracer.startSpan(...)` or `metricsHook(...)` call without a surrounding `try/catch` in protocol turn code.

**Phase to address:** All six features — this is a cross-cutting invariant for every observability hook added.

---

### Pitfall 4: Per-Chunk Provenance / Spans on Hot-Path Events

**What goes wrong:** Provenance annotations, OTEL span attribute writes, or metrics emissions are added to `model-output-chunk` events — the highest-frequency event type in the streaming path. A long streaming provider response may emit hundreds of chunks. Each chunk now pays the cost of timestamp formatting, attribute serialization, span-context lookup, and hook invocation.

**Why it happens:** It is natural to annotate "every event" with provenance. The event schema has an `at` field and a `type` field; adding `provenance: { modelId, providerId, ... }` to the `RunEvent` type makes it look like a per-event concern. But CONCERNS.md already flags that `new Date().toISOString()` per chunk is a known performance concern — adding provenance metadata on top multiplies the cost.

**Consequences:** Measurable latency increase in streaming runs. In recursive coordination runs with many child missions (v0.4.0), the fan-out multiplies the impact. Trace size bloat from provenance on every chunk event across embedded child traces.

**Prevention:**
- Provenance is a **per-provider-call concern**, not a per-chunk concern. Emit provenance once on the `model-request` and `model-response` events, not on each `model-output-chunk`. The existing `ReplayTraceProviderCall` structure in the trace is the right attachment point.
- OTEL spans should wrap **provider calls** and **protocol turns**, not individual chunk events. Span attributes are set at turn or call granularity.
- Metrics counters (tokens, cost, duration) are accumulated and emitted at turn completion, not per chunk.
- Document this in the observability API surface: provenance on chunk events is explicitly excluded.
- Benchmark: add a `pnpm run benchmark:baseline` scenario that counts per-event overhead before and after the milestone.

**Warning signs:** Any code adding provenance or calling `metricsHook` inside a `model-output-chunk` event handler or the chunk fan-out loop in `src/runtime/model.ts`.

**Phase to address:** Provenance annotations, OTEL tracing bridge.

---

### Pitfall 5: Audit Schema Coupled to `RunEvent` Schema

**What goes wrong:** The audit record format is defined as a subset or transformation of `RunEvent` without its own version field. When `RunEvent` evolves (adding a new event type, renaming a field), the audit record silently changes shape. Consumers storing audit records for compliance have no way to detect the change.

**Why it happens:** It is tempting to define `AuditRecord` as `Pick<RunEvent, "type" | "at" | ...>` or to serialize `trace.events` directly as the audit output. This avoids duplication but ties the compliance artifact to the SDK's internal schema version.

**Consequences:** A `RunEvent` shape change (which is a public-API change requiring CHANGELOG.md update) becomes an unannounced breaking change to compliance consumers. Audit records from v0.5.0 and v0.6.0 may look different to a downstream SIEM or audit log store with no migration path.

**Prevention:**
- Audit records must have their own `auditSchemaVersion: string` field (e.g., `"1.0"`), distinct from any SDK version or event schema version.
- The audit schema must be defined as an **independent type** (not derived from `RunEvent` via `Pick` or `Omit`) with a stable documented structure.
- The audit schema version must be bumped explicitly and independently of event schema changes — it only changes when the audit record shape changes.
- Add a `src/tests/fixtures/audit-record-v1.json` frozen fixture test (analogous to the recommended trace-version-skew test in CONCERNS.md) that round-trips through the audit formatter.
- Document the audit schema stability policy separately from the general `CHANGELOG.md` trace-contract policy.

**Warning signs:** `type AuditRecord = Pick<RunEvent, ...>` or audit record types that reference `RunEvent` union variants directly.

**Phase to address:** Audit event schema.

---

### Pitfall 6: OTEL Span Context Not Threaded Through `delegate` Child Runs

**What goes wrong:** The OTEL tracing bridge creates a root span for each `run()` call. When a coordinator agent issues a `delegate` decision (v0.4.0), the child run is dispatched as an independent call without a parent span context. In the OTEL backend, child spans appear as disconnected traces instead of as children of the coordinator span.

**Why it happens:** The `delegate` dispatch path in `src/runtime/coordinator.ts` creates child runs via the same engine entry points (`run`/`stream`). If the parent span context is not passed through this path, each child gets a fresh root span. The existing `parentRunIds` mechanism carries stream ancestry, but OTEL parent context is a separate concern not yet modeled.

**Consequences:** Distributed traces in Jaeger, Honeycomb, or any OTEL backend show child runs as unrelated traces. The observability value of the bridge is severely degraded for coordinator-based workloads, which are the main use case for recursive coordination.

**Prevention:**
- The `RunCallOptions` (the options accepted by the engine when spawning child runs) must accept an optional `parentSpanContext?: DuckSpanContext` field alongside the existing `parentRunIds`.
- The engine must thread `parentSpanContext` into the child span's `startSpan` options, using the duck-typed interface to pass it as a parent reference.
- This is a public-surface change: `RunCallOptions` is documented surface (CLAUDE.md: "The `delegate` decision variant, `sub-run-*` event family, `RunCallOptions`, `parentRunIds` stream chain..."). Changelog entry required.
- Test: coordinator run with OTEL bridge injected; assert child spans have the coordinator span's context as their parent.

**Warning signs:** OTEL bridge implementation that does not reference `RunCallOptions` or `parentRunIds` anywhere.

**Phase to address:** OTEL tracing bridge (after recursive coordination surface is understood).

---

### Pitfall 7: Trace Bloat From Provenance on All Events × Embedded Child Traces

**What goes wrong:** Provenance annotations are added as a new field on every `RunEvent`. A coordinator run with 3 child missions, each with 10 turns and 20 events, already produces ~600+ events. Adding even 100 bytes of provenance per event grows the serialized trace by 60KB+. Embedded child traces (v0.4.0) multiply this further because each child's events are inlined into the parent trace.

**Why it happens:** CONCERNS.md already flags "no caps on event log size." Provenance is additive by design. The combination of unbounded event log + embedded child traces + per-event provenance creates a multiplicative bloat problem that is not visible in unit tests using synthetic providers with 2–3 turn conversations.

**Consequences:** Memory pressure during long runs. Serialization cost at result time. Storage costs for callers persisting traces. Replay performance degradation. Potential payload-size issues for callers posting traces to APIs.

**Prevention:**
- Provenance must be opt-in, not default. Callers who don't enable provenance annotations get no size impact.
- Provenance on `model-output-chunk` events is explicitly excluded (see Pitfall 4). Only `model-request` and `model-response` events carry provenance.
- Consider a `compactProvenance` mode where repeated provenance fields (same `modelId`, same `providerId`) are deduplicated and referenced by key rather than inlined per-event.
- The benchmark suite should include a trace-size measurement as part of the milestone's verification gate.
- Document expected overhead clearly: "enabling provenance adds approximately X bytes per provider call."

**Warning signs:** Provenance field typed as part of the base `RunEvent` interface (rather than a distinct optional type applied only to specific event variants).

**Phase to address:** Provenance annotations.

---

## Moderate Pitfalls

### Pitfall 8: Health Diagnostic Thresholds Baked Into the SDK

**What goes wrong:** The health diagnostics API ships with hard-coded thresholds: "runaway turns" triggers at 20 turns, "budget near-miss" triggers at 90% of `maxUsd`, "provider errors" trigger a warning after 3 failures. A caller running a local-tier model (which may use many short turns by design) gets false-positive warnings on every run.

**Why it happens:** Hard-coded thresholds feel reasonable for a default implementation. But provider-neutrality means the SDK cannot know what is "normal" for a given caller's workload — a remote GPT-4 call at 20 turns is expensive; a local Llama3 call at 20 turns is fine.

**Prevention:**
- Health diagnostic thresholds must be caller-configurable, either via `HealthDiagnosticsOptions` passed at the `createEngine` or `run` level, or as a pure function `computeHealth(result, thresholds)` where callers supply thresholds.
- Provide reasonable defaults that can be overridden, but document them explicitly so callers know what they're getting.
- "Anomalies" must be computed from the run's own budget context (e.g., "used 90% of the budget configured for this run") rather than absolute numbers.

**Warning signs:** Any integer literal like `20` or `0.9` hard-coded in health diagnostic logic without a corresponding options type.

**Phase to address:** Health / diagnostics API.

---

### Pitfall 9: `withRetry` Provider Wrapper Double-Counting Metrics

**What goes wrong:** Metrics hooks count "provider calls" by instrumenting the engine's `model.generate` call site. `withRetry` wraps the provider and retries internally, so the engine sees one call but the actual network round-trips are 3. Alternatively, if metrics are instrumented at the `ConfiguredModelProvider.generate` level, every retry attempt counts as a separate call, inflating "provider call count" metrics.

**Why it happens:** `withRetry` (v0.3.1) wraps the provider object before it is passed to the engine. The engine only sees the outer provider. Unless the metrics layer explicitly accounts for retry wrapping, the counts will not match actual network behavior.

**Prevention:**
- Document clearly which layer metrics are instrumented at: engine boundary (logical calls, not retry attempts) or provider boundary (physical network requests including retries).
- Do not instrument both layers simultaneously without labeling the distinction (e.g., `provider_calls_logical` vs. `provider_calls_physical`).
- If `withRetry` emits its own retry-count metric through the metrics hook, ensure the hook distinguishes attempt events from completion events.

**Warning signs:** A metrics hook that counts calls at both `model.generate` invocation and within `withRetry` internals without namespace distinction.

**Phase to address:** Metrics / counters.

---

### Pitfall 10: Event Introspection API Diverging From `RunEvent` Schema

**What goes wrong:** The structured event introspection query API returns transformed or reshaped objects rather than filtering the existing `RunEvent` union. Now there are two type contracts to maintain: the event schema and the introspection result schema. A `RunEvent` field rename breaks both separately.

**Why it happens:** It is tempting to build a more ergonomic query API that returns `{ agent: string, tokens: number, cost: number }` flat objects rather than raw `RunEvent` variants. This is more convenient but creates a separate schema.

**Prevention:**
- The introspection API must be a **typed filter/reduce over the existing `RunEvent` union**, not a parallel schema. Return `RunEvent[]` subsets, not new types.
- Aggregation helpers (e.g., "total tokens by agent") may compute derived values, but the underlying events returned must be the original `RunEvent` objects.
- This keeps the introspection API automatically in sync with any event schema changes.

**Warning signs:** A new exported type `IntrospectionResult` that does not directly reference `RunEvent` variant types.

**Phase to address:** Structured event introspection.

---

### Pitfall 11: `exactOptionalPropertyTypes` Traps on New Optional Fields

**What goes wrong:** A new optional provenance or audit field is typed as `provenance?: ProvenanceRecord` on an existing `RunEvent` variant. Under `exactOptionalPropertyTypes`, assigning `provenance: undefined` is a type error. Existing code that spreads or constructs event objects without the new field compiles, but code that passes `{ ...event, provenance: undefined }` does not.

**Why it happens:** Dogpile's strict TypeScript config (`tsconfig.json`: `exactOptionalPropertyTypes: true`) makes `?: T` and `: T | undefined` behave differently. New contributors adding optional fields to event types without knowing this constraint write code that fails to compile with confusing errors.

**Prevention:**
- Use `?: ProvenanceRecord` (true optional, not present vs. present-but-undefined) for all new optional observability fields.
- Never write `{ ..., provenance: undefined }` — omit the field entirely when not applicable.
- Add a TS compilation check to `pnpm run typecheck` by including the new types in the existing `src/tests/consumer-type-resolution-smoke.test.ts`.

**Warning signs:** `exactOptionalPropertyTypes` errors appearing on new event construction sites after adding an optional field.

**Phase to address:** Provenance annotations, audit event schema.

---

### Pitfall 12: Browser Bundle Pulls Node-Only APIs for Duration Metrics

**What goes wrong:** Duration metrics or health diagnostics use `process.hrtime.bigint()`, `performance.timeOrigin` via `perf_hooks`, or `Date.now()` with Node-specific precision guarantees. `perf_hooks` is a Node-only module. Vite's browser bundle build fails with a module resolution error, breaking the browser smoke test.

**Why it happens:** High-resolution timing is often implemented via `perf_hooks` in Node because it provides nanosecond precision. `performance.now()` is available cross-environment, but developers who reach for `process.hrtime` or `import { performance } from "perf_hooks"` break the pure-runtime invariant.

**Prevention:**
- Use only `Date.now()` or `globalThis.performance?.now()` for duration measurements in runtime code. Both are available in Node 22, Bun, and browser ESM.
- Add the existing planned grep-based test (CONCERNS.md: "No static check that runtime/browser/providers stay free of `node:*` imports") and extend it to cover `perf_hooks` specifically.
- Test: run `pnpm run browser:smoke` after each new observability module is added, not just at release.

**Warning signs:** `import ... from "perf_hooks"` or `import ... from "node:perf_hooks"` in any file under `src/runtime/`, `src/browser/`, or `src/providers/`.

**Phase to address:** Health / diagnostics API, metrics / counters.

---

### Pitfall 13: Subpath Export Drift When Adding Observability Modules

**What goes wrong:** A new observability module (e.g., `src/runtime/otel-bridge.ts` or `src/runtime/audit.ts`) is added and exposed as a new subpath export (`@dogpile/sdk/runtime/otel-bridge`) in `package.json` `exports` but the corresponding entry is missing from one or more of: `package.json` `files`, `src/tests/package-exports.test.ts`, or `scripts/check-package-artifacts.mjs`. Consumer imports fail at install time, or the packed tarball omits the file.

**Why it happens:** CONCERNS.md and ARCHITECTURE.md both flag this as a known fragile area: "Public subpath exports are gated by three independent files that must agree." A contributor adding a new module under time pressure skips one of the three locations.

**Prevention:**
- Treat any new subpath export as requiring simultaneous changes to all three gating files in one PR.
- Run `pnpm run pack:check` before merging any PR that adds a runtime module.
- Consider whether new observability modules need to be separate subpath exports at all — if callers only access them via the top-level `Dogpile` API options, no subpath export is needed, and the drift problem is avoided.

**Warning signs:** A new file in `src/runtime/` with a public-looking API that is not referenced in `src/tests/package-exports.test.ts`.

**Phase to address:** Any phase that introduces a new published subpath (likely OTEL bridge, audit schema).

---

### Pitfall 14: Replay Nondeterminism From Provenance Metadata

**What goes wrong:** Provenance annotations include fields that differ between runs: process PID, hostname, wall-clock skew relative to a reference, or any field derived from the execution environment rather than from run inputs. When `canonicalizeRunResult` is applied to a trace containing such provenance, the round-trip through `result-contract.test.ts` fails because the re-serialized trace does not match the original.

**Why it happens:** Provenance is intended to record "where did this come from," which naturally includes environment-level data. But the existing trace contract requires deterministic round-trips through `replay()`. Anything that is environment-dependent breaks this.

**Prevention:**
- Provenance fields must be derived only from run inputs and model responses: `modelId`, `providerId`, `runId`, `turnIndex`, `agentId`. Never from `process.pid`, `os.hostname()`, or any environment-global.
- If environment metadata is genuinely needed (e.g., for infrastructure audit), it belongs in a separate audit record that is explicitly NOT part of the replayable trace, not on `RunEvent` fields.
- Separate "replay-deterministic provenance" (goes on events, survives `replay()`) from "environment provenance" (goes in a separate audit sink, not in the trace).

**Warning signs:** Any `os.hostname()`, `process.pid`, or `Intl.DateTimeFormat().resolvedOptions().timeZone` call in provenance construction code inside `src/runtime/`.

**Phase to address:** Provenance annotations.

---

## Minor Pitfalls

### Pitfall 15: Observability Not Opt-Out by Default

**What goes wrong:** OTEL span creation, metrics hooks, and provenance annotation run on every call even when no tracer, hook, or provenance option is configured. The code guard is `if (tracer !== undefined)` but the tracer default is an always-present no-op object. Any overhead from the no-op path (duck-typed method calls, object allocations) accumulates across the hot loop.

**Prevention:**
- Default for all observability options is `undefined` — no no-op object injected by the SDK.
- All call sites guard with `if (options.tracer != null)` — absent the option, zero code executes.
- Add an explicit test asserting that a run with no observability options set produces exactly the same `RunResult` shape and `trace` as a run on v0.4.0 (use the existing `result-contract.test.ts` baseline).

**Phase to address:** All six features — verified in the integration test gate for the milestone.

---

### Pitfall 16: Metrics Re-Emitting Data Already in `trace.accounting`

**What goes wrong:** The metrics hook emits `{ name: "tokens_total", value: 1234 }` and `{ name: "cost_usd", value: 0.04 }` at run completion. Callers who also walk `trace.accounting` have the same numbers in two places. Dashboards double-count or show conflicting values if the hook fires before accounting is finalized.

**Prevention:**
- Document clearly that metrics hook values are derived from `RunAccounting` after the run completes — they are not independent measurements.
- Fire the metrics hook only after `canonicalizeRunResult` produces the final accounting, so values are guaranteed consistent with the trace.
- Name the metrics to be obviously trace-derived (e.g., `dogpile.run.tokens_total`) rather than generic names that callers might also use for their own counters.

**Phase to address:** Metrics / counters.

---

## Phase-Specific Warning Table

| v0.5.0 Feature | Likely Pitfall(s) | Mitigation |
|---|---|---|
| OTEL tracing bridge | Pitfall 2 (accidental dep import), Pitfall 3 (hook throws), Pitfall 6 (delegate span context), Pitfall 13 (subpath drift) | Duck-typed interface only; try/catch all hook calls; thread parent span context through RunCallOptions; update all three export gates |
| Metrics / counters | Pitfall 3 (hook throws), Pitfall 9 (retry double-counting), Pitfall 12 (Node-only APIs), Pitfall 16 (accounting duplication) | try/catch; document which layer is instrumented; use globalThis.performance.now() only |
| Structured event introspection | Pitfall 10 (schema divergence) | Return RunEvent[] subsets; no new types |
| Health / diagnostics | Pitfall 3 (hook throws), Pitfall 8 (baked-in thresholds), Pitfall 12 (Node-only APIs) | Caller-configurable thresholds; cross-platform timing only |
| Audit event schema | Pitfall 1 (non-JSON values), Pitfall 5 (schema coupled to RunEvent), Pitfall 11 (exactOptionalPropertyTypes), Pitfall 13 (subpath drift) | Independent auditSchemaVersion; JsonObject constraints; frozen fixture test |
| Provenance annotations | Pitfall 1 (non-JSON values), Pitfall 4 (per-chunk hot path), Pitfall 7 (trace bloat), Pitfall 11 (exactOptionalPropertyTypes), Pitfall 14 (replay nondeterminism) | ISO strings only; per-call not per-chunk; opt-in only; run-input-derived fields only |

---

## Sources

- ARCHITECTURE.md (`/Users/zakkeown/Code/dogpile/.planning/codebase/ARCHITECTURE.md`) — anti-patterns, constraints, trace contract — HIGH confidence
- CONCERNS.md (`/Users/zakkeown/Code/dogpile/.planning/codebase/CONCERNS.md`) — performance bottlenecks, fragile areas, known bugs — HIGH confidence
- PROJECT.md (`/Users/zakkeown/Code/dogpile/.planning/PROJECT.md`) — v0.5.0 feature list, out-of-scope constraints — HIGH confidence
- `src/runtime/engine.ts` — streaming path, canonicalization, replay — HIGH confidence
- OpenTelemetry documentation: [Library instrumentation guidance](https://opentelemetry.io/docs/languages/js/instrumentation/) — library authors should depend on `@opentelemetry/api` only; Dogpile's constraint is stricter (zero runtime dep) — MEDIUM confidence (official docs, but Dogpile's stricter constraint means duck-typing over API dep)
- Audit schema versioning: established pattern (canary rollouts, `eventTypeVersion` fields, backward-compatible evolution) — MEDIUM confidence (general principle verified via OCI SDK docs pattern)
