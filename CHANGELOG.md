# Changelog

## [0.5.0] — 2026-05-01

v0.5.0 Observability and Auditability starts with provenance annotations: model provider calls now produce real request/response events, replay can synthesize those events from provider-call anchors, and callers get a small runtime helper for normalized provenance fields.

Prepared the release identity for `@dogpile/sdk@0.5.0` and `dogpile-sdk-0.5.0.tgz`.

### Breaking

- **`ModelRequestEvent` shape changed.** The `at` field is removed. The event now carries `startedAt: string` (ISO-8601 timestamp immediately before the provider call) and `modelId: string` (resolved model identifier). Update any code that reads `event.at` on a `ModelRequestEvent`.
- **`ModelResponseEvent` shape changed.** The `at` field is removed. The event now carries `startedAt: string`, `completedAt: string` (ISO-8601 timestamp after the provider call), and `modelId: string`. Callers can compute call duration from a single event. Update any code that reads `event.at` on a `ModelResponseEvent`.
- **`model-request` and `model-response` events are now emitted.** These event types were previously typed but never produced at runtime. They are now emitted on every provider call across all four protocols (`sequential`, `broadcast`, `coordinator`, `shared`). Callers with exhaustive switches over `RunEvent["type"]` that lack a `default` branch may encounter unhandled cases — add `case "model-request":` and `case "model-response":` branches or a fallback `default`.

### Added — Provenance annotations (Phase 6)

- **`ConfiguredModelProvider.modelId?` optional field.** Provider adapters can now declare the specific model identifier, such as `"gpt-4o"`. When absent, the SDK uses `provider.id` as the fallback. `createOpenAICompatibleProvider` and the internal Vercel AI provider populate this field automatically from the configured model.
- **`ReplayTraceProviderCall.modelId` required field.** The model identifier is now recorded in every provider call entry in `trace.providerCalls`. This is a shape change on the replay type — if you have hand-crafted `ReplayTraceProviderCall` objects, such as in tests, add the `modelId` field.
- **New subpath: `@dogpile/sdk/runtime/provenance`.** Exports `getProvenance(event)`, `ProvenanceRecord`, and `PartialProvenanceRecord`. `getProvenance()` extracts normalized provenance fields from any `ModelRequestEvent` or `ModelResponseEvent`; the overloaded signature returns `ProvenanceRecord` with `completedAt` for response events and `PartialProvenanceRecord` without `completedAt` for request events.

### Added — Structured event introspection + health diagnostics (Phase 7)

- **New subpath: `@dogpile/sdk/runtime/introspection`.** Exports `queryEvents(events, filter)` and `EventQueryFilter`. `queryEvents()` filters a `readonly RunEvent[]` by event type, agent id, global turn range, and/or cost range with AND semantics, returning a narrowed subtype such as `TurnEvent[]` when `filter.type === "agent-turn"` without caller casts.
- **New subpath: `@dogpile/sdk/runtime/health`.** Exports `computeHealth(trace, thresholds?)`, `HealthThresholds`, `DEFAULT_HEALTH_THRESHOLDS`, `RunHealthSummary`, and `HealthAnomaly`. `computeHealth()` derives anomaly records and stats from a trace without I/O or runtime state.
- **`result.health: RunHealthSummary` required field.** Every `RunResult` now includes an always-present machine-readable health summary computed from trace events at result time and recomputed identically by `replay()`. The summary exposes `health.anomalies: readonly HealthAnomaly[]` and `health.stats.totalTurns`, `health.stats.agentCount`, and `health.stats.budgetUtilizationPct`.
- **New root-exported health types.** `AnomalyCode`, `HealthAnomaly`, and `RunHealthSummary` are exported from `@dogpile/sdk`.
- **Frozen health anomaly fixture.** `src/tests/fixtures/anomaly-record-v1.json` records one sample `HealthAnomaly` per anomaly code. `provider-error-recovered` is present in the `AnomalyCode` union and fixture but is not emitted by `computeHealth()` in Phase 7 because current traces have no provider-recovery signal without an event-shape change.

### Added — Audit Event Schema (Phase 8)

- **New subpath: `@dogpile/sdk/runtime/audit`.** Exports `createAuditRecord(trace)`, `AuditRecord`, `AuditOutcome`, `AuditCost`, `AuditAgentRecord`, and `AuditOutcomeStatus`.
- **`createAuditRecord(trace: Trace): AuditRecord`.** Pure function that derives a versioned, schema-stable audit record from any completed trace. It works on live `RunResult.trace` values and stored/replayed traces without I/O, storage, or provider access.
- **`AuditRecord` standalone type.** The audit schema is independent of `RunEvent` variants and contains `auditSchemaVersion`, `runId`, `intent`, `startedAt`, `completedAt`, `protocol`, `tier`, `modelProviderId`, `agentCount`, `turnCount`, `outcome`, `cost`, `agents`, and optional `childRunIds`.
- **Budget-stop audit outcome.** `AuditOutcome` uses `{ status: "completed" | "budget-stopped" | "aborted"; terminationCode?: string }`; `terminationCode` carries the normalized budget stop reason (`"cost"`, `"tokens"`, `"iterations"`, or `"timeout"`) for budget-stopped runs.
- **Frozen audit record fixture.** `src/tests/fixtures/audit-record-v1.json` records the canonical AuditRecord v1 field order and shallow type shape. Intentional AuditRecord schema changes must update the JSON fixture, companion `audit-record-v1.type-check.ts`, and shape test together.

**Note:** Audit records are not auto-attached to `RunResult`. Callers explicitly invoke `createAuditRecord(result.trace)`.

### Added — OTEL tracing bridge (Phase 9)

- **New subpath: `@dogpile/sdk/runtime/tracing`.** Exports `DogpileTracer`, `DogpileSpan`, `DogpileSpanOptions`, and `DOGPILE_SPAN_NAMES`. Pure-TS, zero runtime dependencies; `@opentelemetry/*` is not imported anywhere in `src/runtime/`, `src/browser/`, or `src/providers/`. The `src/tests/no-otel-imports.test.ts` grep test enforces this boundary.
- **`tracer?: DogpileTracer` on `EngineOptions` and `DogpileOptions`.** When a duck-typed tracer is provided, the SDK emits spans on every run; when absent the run completes with zero span overhead.
- **Four span names emitted under the `dogpile.*` namespace:** `dogpile.run`, `dogpile.sub-run`, `dogpile.agent-turn`, `dogpile.model-call`. Hierarchy: `dogpile.run` → `dogpile.sub-run` → `dogpile.agent-turn` → `dogpile.model-call`.
- **`dogpile.run` span attributes:** `dogpile.run.id`, `dogpile.run.protocol`, `dogpile.run.tier`, `dogpile.run.intent` (truncated to 200 chars), `dogpile.run.outcome` (`completed` / `budget-stopped` / `aborted`), `dogpile.run.cost_usd`, `dogpile.run.turn_count`, `dogpile.run.input_tokens`, `dogpile.run.output_tokens`, and `dogpile.run.termination_reason` for budget-stopped runs.
- **`dogpile.agent-turn` span attributes:** `dogpile.agent.id`, `dogpile.turn.number`, `dogpile.agent.role`, `dogpile.model.id`, `dogpile.turn.cost_usd`, `dogpile.turn.input_tokens`, `dogpile.turn.output_tokens`. `dogpile.turn.number` is derived from a per-agentId counter inside the engine because `TurnEvent` itself has no `turnNumber` field.
- **`dogpile.model-call` span attributes:** `dogpile.model.id`, `dogpile.call.id`, `dogpile.provider.id`, `dogpile.model.input_tokens`, `dogpile.model.output_tokens`, and `dogpile.model.cost_usd` when the provider reports it.
- **Sub-run spans are correctly nested.** Children dispatched by the coordinator protocol appear as descendants of the parent run span via internal `parentSpan` threading on `RunProtocolOptions`; they do not appear as disconnected root traces in OTEL backends.
- **Span status semantics.** `dogpile.run` spans get `setStatus("ok")` for completed runs, including budget-stopped runs with the termination reason captured as an attribute, and `setStatus("error", message)` for aborted or thrown runs. `dogpile.sub-run` spans on `sub-run-failed` events get `setStatus("error", event.error.message)`.
- **Streaming parity.** `stream()` produces the same four span types with the same nesting and attributes as `run()`.
- **Root re-exports.** `DogpileTracer`, `DogpileSpan`, `DogpileSpanOptions` are re-exported as types from `@dogpile/sdk`; `DOGPILE_SPAN_NAMES` is a value-level root re-export.
- **`replay()` and `replayStream()` are tracing-free.** Even when an engine has been configured with a `tracer`, calling `replay()` or `replayStream()` emits no spans; historical timestamps would confuse OTEL backends. See `docs/developer-usage.md` for the recommended user-side bridge pattern.
- **No runtime dependency added.** `@opentelemetry/api` and `@opentelemetry/sdk-trace-base` are devDependencies used only by `src/tests/otel-tracing-contract.test.ts`.

### Added — Metrics / Counters hook (Phase 10)

- **New subpath: `@dogpile/sdk/runtime/metrics`.** Exports `MetricsHook` and `RunMetricsSnapshot`. Pure-TS, zero runtime dependencies. No root re-exports.
- **`metricsHook?: MetricsHook` on `EngineOptions` and `DogpileOptions`.** When provided, `onRunComplete` fires at every terminal state (completed, budget-stopped, aborted) with a `RunMetricsSnapshot`; `onSubRunComplete` fires for each coordinator-dispatched child run. When absent, zero overhead — no allocations.
- **`RunMetricsSnapshot` fields:** `outcome`, `inputTokens`, `outputTokens`, `costUsd`, `totalInputTokens`, `totalOutputTokens`, `totalCostUsd`, `turns`, `durationMs`. Own-only counters exclude nested sub-run tokens; total counters include the full subtree.
- **`logger?: Logger` on `EngineOptions` and `DogpileOptions`.** Routes hook errors to a caller-supplied structured logger; falls back to `console.error` when absent. Uses the existing `Logger` interface from `@dogpile/sdk/runtime/logger`. Enables future engine-level diagnostic logging without another surface change.
- **Async fire-and-forget.** Hook callbacks are `(snapshot) => void | Promise<void>`. Async returns attach `.catch(err => logger.error(...))`. Hook latency never delays run completion.
- **`replay()` and `replayStream()` ignore `metricsHook` entirely.** Consistent with the Phase 9 replay-is-tracing-free invariant.
- **Frozen fixture.** `src/tests/fixtures/metrics-snapshot-v1.json` records the canonical `RunMetricsSnapshot` v1 field order. Companion `metrics-snapshot-v1.type-check.ts` enforces compile-time type fidelity.

### Replay

- **`replay()` synthesizes `model-request` / `model-response` events from `trace.providerCalls`.** The augmented event log returned by `replay()` includes provenance events derived from the canonical `providerCalls` anchor. This ensures provenance fields in replayed results are identical to those in live runs (PROV-02). Older traces without these events in `trace.events` gain them on replay.

## [0.4.0] — 2026-05-01

Recursive coordination — coordinators can now dispatch whole sub-missions via a `delegate` decision, with embedded child traces, propagated budgets/aborts/costs, bounded concurrency with locality clamping, live child-event bubbling on streams, and structured child-failure escalation. See [`docs/recursive-coordination.md`](docs/recursive-coordination.md) for the full surface and a worked example.

### Breaking

- `AgentDecision` is now a discriminated union with required `type: "participate" | "delegate"`. Existing paper-style fields (`selectedRole`, `participation`, `rationale`, `contribution`) are preserved under the `participate` branch. Consumers must narrow on `decision.type === "participate"` before reading paper-style fields. (Phase 1)

### Migration — AgentDecision narrowing (v0.3.x → v0.4.0)

```ts
// v0.3.x
const decision: AgentDecision = await coordinator.run(...);
console.log(decision.selectedRole, decision.contribution);

// v0.4.0
const decision = await coordinator.run(...);
if (decision.type === "participate") {
  console.log(decision.selectedRole, decision.contribution);
} else if (decision.type === "delegate") {
  // new: handle delegated sub-mission
}
```

See [`docs/recursive-coordination.md#agentdecision-narrowing`](docs/recursive-coordination.md#agentdecision-narrowing) for the full discriminator and `delegate`-branch shape.

### Added — `delegate` decision and sub-run traces (Phase 1)

- Coordinator agents may emit `{ type: "delegate", protocol, intent, model?, budget? }` to dispatch a sub-mission as part of the plan turn. Phase 1 of v0.4.0 enables delegation from the coordinator's plan turn only; worker delegation and final-synthesis-turn delegation are rejected with `invalid-configuration`. (Phase 1)
- New `RunEvent` variants: `sub-run-started`, `sub-run-completed`, `sub-run-failed`. `sub-run-completed` carries the full child `RunResult` (including embedded `Trace`); `sub-run-failed` carries `error` and `partialTrace`. `sub-run-started` carries `{ childRunId, parentRunId, parentDecisionId, protocol, intent, depth }` plus `recursive: true` when the dispatching protocol and the delegated protocol are both `coordinator`. (Phase 1)
- Synthetic transcript entries record sub-run results with `agentId: "sub-run:<childRunId>"` and `role: "delegate-result"`. The next coordinator plan prompt receives a tagged `[sub-run <childRunId>]: <output>\n[sub-run <childRunId> stats]: turns=<N> costUsd=<X> durationMs=<Y>` block (D-17). (Phase 1)
- `maxDepth` option on `DogpileOptions` and `EngineOptions` (default `4`); `Engine.run` and `Engine.stream` accept an optional second-argument `RunCallOptions` that can only LOWER the engine ceiling — `effectiveMaxDepth = Math.min(engineMaxDepth, runOptions.maxDepth ?? Infinity)`. Depth overflow is enforced at both the parser (`parseDelegateDecision`) and the dispatcher (`dispatchDelegate`); both throw `invalid-configuration` with `detail.reason: "depth-overflow"` and `detail.path: "decision.protocol"`. (Phase 1)
- New public type `RunCallOptions` is re-exported through `@dogpile/sdk` and `@dogpile/sdk/types`. (Phase 1)
- Fenced-JSON delegate parsing convention added to `parseAgentDecision` (no new tool surface — delegate is a parser-level concern). Coordinator runs accept a `delegate:` prefix followed by a fenced ```json block. (Phase 1)
- `Dogpile.replay()` rehydrates embedded sub-run traces without provider invocation; the new `recomputeAccountingFromTrace` helper verifies recorded child `RunAccounting` against a per-child recompute and throws `invalid-configuration` with `detail.reason: "trace-accounting-mismatch"` and `detail.field` identifying the offending numeric field on tamper. The eight enumerated comparable numeric fields are `cost.usd`, `cost.inputTokens`, `cost.outputTokens`, `cost.totalTokens`, `usage.usd`, `usage.inputTokens`, `usage.outputTokens`, `usage.totalTokens`. Top-level parent drift is reported with `eventIndex: -1`; child drift is reported with the offending event's index plus `childRunId`. (Phase 1)
- New `ReplayTraceProtocolDecisionType` literals: `start-sub-run`, `complete-sub-run`, `fail-sub-run`. (Phase 1)

### Added — Budget, cancellation, cost roll-up (Phase 2)

The four BUDGET-* requirements ship together as a single coherent surface for safely
running recursive coordinator delegations under shared deadlines, abortable cancellation,
and reconciled cost accounting.

#### Cancellation propagation (BUDGET-01)

- Parent abort propagates to all in-flight sub-runs via a per-child derived `AbortController`. Aborted children carry `detail.reason: "parent-aborted"` on `code: "aborted"` errors.
- New trace event `sub-run-parent-aborted` (exported as TS type `SubRunParentAbortedEvent`) marks parent aborts that land after a sub-run completes; observable on `Dogpile.stream()` subscribers when stream teardown timing permits. New `ReplayTraceProtocolDecisionType` literal `mark-sub-run-parent-aborted`.

#### Timeout / deadline propagation (BUDGET-02)

- Parent `budget.timeoutMs` is now a true tree-wide deadline. Children inherit `parentDeadline − now` as their default timeout.
- Per-decision `budget.timeoutMs` exceeding the parent's remaining is **clamped** (no longer throws), and the parent trace gains a `sub-run-budget-clamped` event (exported as TS type `SubRunBudgetClampedEvent`) recording the requested vs clamped values. Parent timeouts surface on the child as `code: "aborted"` with `detail.reason: "timeout"`. New `ReplayTraceProtocolDecisionType` literal `mark-sub-run-budget-clamped`.
- New `defaultSubRunTimeoutMs` engine option on `createEngine`, `Dogpile.pile`, `run`, and `stream` — fallback ceiling applied only when neither parent nor decision specifies a timeout. Precedence: `decision.budget.timeoutMs` > parent's remaining deadline > `defaultSubRunTimeoutMs` > undefined.

#### Cost & token roll-up + replay parity (BUDGET-03)

- `sub-run-failed` events carry `partialCost: CostSummary` reflecting real provider spend before the failure. The parent's `accounting.cost` and token totals include failed-child partial costs recursively.
- Parent rolls up child cost (`subResult.cost` for completed, `partialCost` for failed) into its own totals **before** the corresponding `sub-run-completed` / `sub-run-failed` event is emitted, preserving the existing "last cost-bearing event === final.cost" invariant.
- `Dogpile.replay()` now detects parent-rollup drift — if a saved trace's child `subResult.cost` disagrees with `subResult.accounting.cost`, or a `sub-run-failed.partialCost` disagrees with the cost implied by its `partialTrace`, or Σ children exceeds the parent's recorded total, replay throws `DogpileError({ code: "invalid-configuration", detail: { reason: "trace-accounting-mismatch", subReason: "parent-rollup-drift" } })` with `detail.field` identifying the offending numeric field.

#### Termination floors (BUDGET-04)

- Internal contract guarantee (no public-surface delta): parent termination policies (`budget`, `convergence`, `judge`, `firstOf`) operate over parent-level events / iterations only — child agent-turn events bubbled into the parent stream do not count toward parent iteration limits, and `minTurns`/`minRounds` floors are per-protocol-instance (parent and child read their own protocol config independently). One `sub-run-completed` counts as exactly one parent iteration via the synthetic `delegate-result` transcript entry. Locked by contract tests in `src/tests/budget-first-stop.test.ts` and `src/runtime/coordinator.test.ts`.

### Added — Provider locality and bounded concurrency (Phase 3)

The PROVIDER-* and CONCURRENCY-* requirements ship together so recursive
coordinator runs can safely fan out work while protecting local model providers
from accidental self-inflicted overload.

#### Provider locality (PROVIDER-01..03)

- `ConfiguredModelProvider.metadata?.locality?: "local" | "remote"` is an optional readonly hint used by coordinator concurrency clamping. Omitted metadata is treated as remote for clamping.
- `createOpenAICompatibleProvider` auto-detects `metadata.locality` from `baseURL`: loopback (`localhost`, `127/8`, `::1`), RFC1918 (`10/8`, `172.16/12`, `192.168/16`), IPv4 link-local (`169.254/16`), IPv6 ULA (`fc00::/7`), IPv6 link-local (`fe80::/10`), and `*.local` mDNS hostnames classify as `"local"`.
- Caller `locality: "local"` always wins. Caller `locality: "remote"` on a detected-local OpenAI-compatible host now throws `DogpileError({ code: "invalid-configuration", detail: { reason: "remote-override-on-local-host" } })` so a localhost Ollama-style endpoint cannot silently bypass the local clamp.
- `classifyHostLocality(host)` is exported from the OpenAI-compatible provider module for advanced callers and tests.
- Provider locality is validated at adapter construction time and at engine run start, including custom provider objects that bypass TypeScript.

#### Bounded child concurrency (CONCURRENCY-01)

- `maxConcurrentChildren` config is available on `createEngine`, `Dogpile.pile` / `run` / `stream`, and per coordinator `delegate` decision. Default is `4`; effective concurrency is `min(engine, run ?? Infinity, decision ?? Infinity)`, so per-run and per-decision values can only lower the engine ceiling. Values must be positive integers.
- Coordinator agents can fan out up to 8 delegates in one plan turn by returning a fenced JSON array of delegate decisions. Mixed `participate` plus `delegate` remains invalid.
- New `RunEvent` variant `sub-run-queued` records delegates that waited for a concurrency slot. No-pressure runs do not emit queued events; pressure runs follow `sub-run-queued` → `sub-run-started` → `sub-run-completed` / `sub-run-failed`.
- `parentDecisionArrayIndex: number` was added to `sub-run-queued`, `sub-run-started`, `sub-run-completed`, and `sub-run-failed` so a delegate is uniquely identified by `parentDecisionId` plus its array index without changing the existing `parentDecisionId` format.
- When one fan-out delegate fails, in-flight siblings continue and queued siblings are drained with synthetic `sub-run-failed` events using `error.code: "aborted"`, `error.detail.reason: "sibling-failed"`, and zero `partialCost`.
- Delegate result transcript entries are appended in completion order under fan-out; replay determinism is preserved by stable `parentDecisionId` plus `parentDecisionArrayIndex`.
- New `ReplayTraceProtocolDecisionType` literal `queue-sub-run` pairs with `sub-run-queued` events.

#### Local-provider clamp (CONCURRENCY-02)

- New `RunEvent` variant `sub-run-concurrency-clamped` is emitted once per coordinator run when any active provider declares `metadata.locality === "local"`. Payload is `{ requestedMax, effectiveMax: 1, reason: "local-provider-detected", providerId }`.
- Local-provider detection walks the active tree at each delegate fan-out: the parent `options.model` first, then future-compatible `agent.model` entries if present. The first local provider id is recorded on the clamp event.
- Effective child concurrency is silently clamped to 1 for local providers regardless of caller config, including explicit `maxConcurrentChildren: 8`. The clamp does not throw and does not write to console; the event is the warning surface.
- The clamp-emitted flag is scoped to the individual run, so concurrent runs do not suppress each other's `sub-run-concurrency-clamped` event.
- New `ReplayTraceProtocolDecisionType` literal `mark-sub-run-concurrency-clamped` pairs with `sub-run-concurrency-clamped` events.

#### Public-surface tests

- `src/tests/event-schema.test.ts` now locks 17 run event variants, including `sub-run-queued` and `sub-run-concurrency-clamped`.
- `src/tests/result-contract.test.ts` verifies the new public event types are reachable from the root `@dogpile/sdk` type re-exports.
- `src/tests/config-validation.test.ts` locks invalid locality and `maxConcurrentChildren` validation.
- `src/tests/cancellation-contract.test.ts` locks public detail/reason strings including `sibling-failed`, `local-provider-detected`, and `remote-override-on-local-host`.
- `src/runtime/coordinator.test.ts` covers fan-out queuing, completion-order transcript behavior, sibling-failed queue drain, local-provider clamp-once behavior, remote-only no-op behavior, explicit override clamping, and per-run clamp isolation.

### Added — Streaming and child error escalation (Phase 4)

The STREAM-* and ERROR-* requirements ship together so live consumers can demux
child activity, parent cancellation closes delegated work, and terminal child
failures surface as stable public `DogpileError` instances.

- **`parentRunIds: readonly string[]` on stream events.** Every `StreamLifecycleEvent` and `StreamOutputEvent` variant accepts an optional root-to-immediate-parent ancestry chain for live bubbled child events. The chain is not persisted into parent `RunResult.events`; `replayStream()` reconstructs it from embedded child traces.
- **New aborted lifecycle event.** Parent streams emit `{ type: "aborted", runId, at, reason: "parent-aborted" | "timeout", detail? }` before terminal `error` events on abort paths, including parent-aborted-after-completion cases with no synthetic child failure to drain.
- **`onChildFailure?: "continue" | "abort"` config option.** Engine-level and per-run surfaces accept the option; default `"continue"` preserves coordinator retry/redirect behavior. `"abort"` skips the follow-up plan turn after the first real child failure and re-throws the snapshotted triggering failure.
- **Optional `detail.source?: "provider" | "engine"` on `provider-timeout` errors.** OpenAI-compatible HTTP timeout responses set `"provider"`; child engine deadlines set `"engine"`. Backwards-compat: absent `detail.source` means `"provider"`. Parent-budget propagation remains `code: "aborted"` with `detail.reason: "timeout"`.
- **Coordinator prompt structured failure roster.** The next coordinator plan prompt includes `## Sub-run failures since last decision` with a JSON array of real child failures from the latest dispatch wave: `{ childRunId, intent, error: { code, message, detail.reason? }, partialCost: { usd } }`. Synthetic `sibling-failed` / `parent-aborted` bookkeeping failures and `partialTrace` are intentionally excluded.
- **Cancel-during-fan-out drain.** `StreamHandle.cancel()` drains active children before terminal stream error: in-flight children emit synthetic `sub-run-failed` with `error.detail.reason: "parent-aborted"` and queued children retain `sibling-failed`; late events from drained children are suppressed at the parent stream boundary.
- **Terminate-without-final throw rule clarified.** "Original DogpileError unwrapped" means the child's own thrown `DogpileError`, not a wrapper, and not the first failure chronologically. Budget and abort-mode terminal paths re-throw the last real child failure by event order, excluding synthetic sibling-failed and parent-aborted entries. Explicit cancel/abort wins and throws the cancel error verbatim.

### Added — Documentation and runnable example (Phase 5)

- **`docs/recursive-coordination.md`** — new dedicated docs page: concepts, propagation rules, `parentRunIds` chain, structured failures, replay parity, "Not in v0.4.0" deferrals, canonical worked example. (Phase 5)
- **`docs/recursive-coordination-reference.md`** — new exhaustive reference page: every `sub-run-*` event payload, every `detail.reason` value, every `RunCallOptions` field, every `DogpileError` `code`/`detail.reason` combo from v0.4.0, replay-drift error matrix, provider locality classification table. (Phase 5)
- **`docs/developer-usage.md`** — new "Recursive coordination" section with maintenance comment cross-linking the dedicated pages. (Phase 5)
- **`docs/reference.md`** — augmented with v0.4.0 exports (`RunCallOptions`, the seven `SubRun*Event` types, `classifyHostLocality`, `recomputeAccountingFromTrace`, new `ReplayTraceProtocolDecisionType` literals) and cross-links to the dedicated reference page. (Phase 5)
- **`README.md` "Choose Your Path"** — new row pointing at `delegate` and `docs/recursive-coordination.md`. (Phase 5)
- **`examples/recursive-coordination/`** — new runnable example using the deterministic provider by default and `createOpenAICompatibleProvider` in live mode. Reuses the Hugging Face upload GUI mission verbatim and wraps it in a coordinator-with-delegate. Demonstrates all v0.4.0 surfaces: parentRunIds chain, intentionally-failing child with `partialCost`, structured failures in the next coordinator turn, locality-driven concurrency clamp. (Phase 5)
- **`examples/README.md`** — index entry mirroring the huggingface-upload-gui section format. (Phase 5)
- **`AGENTS.md` + `CLAUDE.md`** — cross-cutting-invariants list mirrors a recursive-coordination public-surface entry. (Phase 5)
- Prepared the release identity for `@dogpile/sdk@0.4.0` and `dogpile-sdk-0.4.0.tgz`. (Phase 5)

### Notes

- No package `exports` / `files` change. All new public types ship through the existing `@dogpile/sdk` root entry. `recomputeAccountingFromTrace` and the depth-gate helpers (`assertDepthWithinLimit`, `depthOverflowError`) remain runtime-internal.
- Phase 1 does not propagate cost caps, parent timeouts to children with no caller-set timeout, child-event bubbling into the parent stream, or worker-side delegation — those land in v0.4.0 Phases 2–4. Phase 1 leaves event ordering schema-stable for the future Phase 4 child-event-bubbling addition.
- Documentation pages (`docs/recursive-coordination*.md`) and example artifacts (`examples/recursive-coordination/`) are repository-only — neither is added to `package.json` `files`. Released tarball payload is unchanged. (Phase 5)

## 0.3.1

- Prepared the patch release identity for `@dogpile/sdk@0.3.1` and `dogpile-sdk-0.3.1.tgz`.
- Added a structured logging seam at `@dogpile/sdk/runtime/logger` (also re-exported from the package root). Exports `Logger` interface, `noopLogger`, `consoleLogger`, and `loggerFromEvents` adapter. Bridges any logger (pino/winston/console) to an existing stream handle via `handle.subscribe(loggerFromEvents(logger))` — no engine changes, no new event variants. Logger throws are caught and re-routed to the logger's own `error` channel so a misbehaving logger cannot crash a run.
- Added `withRetry(provider, policy)` and the `@dogpile/sdk/runtime/retry` subpath. Wraps any `ConfiguredModelProvider` with a transient-failure retry policy — preserves provider neutrality (opt-in, no peer deps), retries `provider-rate-limited` / `provider-timeout` / `provider-unavailable` by default, honors `error.detail.retryAfterMs`, and short-circuits on `AbortSignal`. Streaming calls are forwarded unchanged.
- Internalized the Vercel AI provider adapter. `src/providers/vercel-ai.ts` moved to `src/internal/vercel-ai.ts`; it was never listed in `package.json#exports` or `package.json#files` and remains repo-internal so `ai` does not become a peer dependency. No behavior change for consumers.
- `createRunId` no longer falls back to a `Date.now`-based id when `globalThis.crypto.randomUUID` is unavailable; it now throws `DogpileError({ code: "invalid-configuration" })`. Node 22+, Bun latest, and modern browser ESM environments all expose `crypto.randomUUID`.
- Three previously plain `Error` throws in `src/runtime/tools.ts` now throw `DogpileError` with stable codes (`invalid-configuration` / `provider-invalid-response`), so `DogpileError.isInstance` catches them as the typed-error contract requires.

## 0.3.0

- Prepared the minor release identity for `@dogpile/sdk@0.3.0` and `dogpile-sdk-0.3.0.tgz`.
- Added one-shot `wrapUpHint` support so the next model turn can package work before hard iteration or timeout caps terminate the run.
- Added protocol-level `minTurns` / `minRounds` floors so convergence and judge termination cannot fire before the configured minimum progress.

## 0.2.2

- Prepared the documentation refresh release identity for `@dogpile/sdk@0.2.2` and `dogpile-sdk-0.2.2.tgz`.
- Reworked the README around the product value proposition, quickstart, and documentation map.
- Split dense API, trace, and release details into dedicated docs pages.

## 0.2.1

- Prepared the security patch release identity for `@dogpile/sdk@0.2.1` and `dogpile-sdk-0.2.1.tgz`.
- Added explicit read-only GitHub Actions workflow permissions for release validation jobs.
- Reworked package identity command scanning to avoid ReDoS-prone install command regexes.
- Hardened the Hugging Face upload GUI example's markdown table escaping.

## 0.2.0

- Prepared the Snow Leopard hardening release identity for `@dogpile/sdk@0.2.0` and `dogpile-sdk-0.2.0.tgz`.
- Centralized release identity checks so manifest, README, changelog, package guard, package export tests, and pack metadata assertions drift together.
- Normalized OpenAI-compatible fetch/network failures into stable `DogpileError` provider codes.
- Tightened the publishable source allowlist so runtime test files stay out of the npm tarball.
- Added a deterministic `pnpm run benchmark:baseline` timing harness for protocol-loop baseline comparisons without making a performance claim.
- Corrected benchmark reproduction documentation paths and commands to point at the live `src/benchmark/config.test.ts` suite.

## 0.1.2

- Cleaned up the README release verification section so the npm package page has readable gate descriptions instead of a single dense paragraph.
- Prepared the patch release identity for `@dogpile/sdk@0.1.2` and `dogpile-sdk-0.1.2.tgz`.

## 0.1.1

- Updated npm package metadata after the GitHub repository transfer from `zakkeown/dogpile` to `bubstack/dogpile`.
- Updated package identity guards and publish documentation for `@dogpile/sdk@0.1.1` and `dogpile-sdk-0.1.1.tgz`.
- Updated npm Trusted Publisher documentation to use the GitHub organization `bubstack`.

## 0.1.0

### Production-Readiness Gaps Closed

- Gap 1 - Cost accounting proof: `costUsd` is computed from caller-supplied `costEstimator` pricing, including the packed quickstart smoke, and Dogpile does not bundle a model pricing table.
- Gap 2 - End-to-end cancellation: caller `AbortSignal`, `StreamHandle.cancel()`, and `budget.timeoutMs` abort active provider requests and surface stable `DogpileError` cancellation/timeout codes.
- Gap 3 - Runtime support proof: Node.js LTS 22 / 24, Bun latest, and browser ESM each have documented validation, and no other runtime targets are claimed for this release.
- Gap 4 - Intentional public surface: `@dogpile/sdk` exports only the documented root, browser, runtime, type, and OpenAI-compatible provider entrypoints, with demo, benchmark, deterministic testing, and internal helpers kept repository-only.
- Gap 5 - Stable typed errors: public validation, registration, provider, abort, timeout, and unknown-failure paths normalize to documented `DogpileError` string codes.
- Gap 6 - Reproducible release: local and CI gates build, pack, install the tarball, import every public subpath, verify downstream TypeScript type resolution, reject local `workspace:` / `link:` installs, and publish source maps plus original TypeScript sources.
- Gap 7 - Scope discipline: the SDK ships a dependency-free provider interface plus direct OpenAI-compatible HTTP adapter, avoids bundled pricing data, and keeps protocol hot loops trusting.

- Published the initial SDK under the scoped npm package name `@dogpile/sdk`; there is no bare `dogpile` package alias.
- Documented the scoped release identity as `@dogpile/sdk@0.1.0` and the local pack tarball name as `dogpile-sdk-0.1.0.tgz`.
- Added local and CI package identity validation that rejects stale unscoped package install/import references before release.
- Added a browser ESM bundle at `@dogpile/sdk/browser` and wired the package root `browser` condition to the same `dist/browser/index.js` artifact.
- Removed demo, benchmark, deterministic testing, and internal helper files from the publishable tarball and from the package export map; use the documented root, browser, runtime, type, and OpenAI-compatible provider entrypoints as the supported public surface. Repository-only helper docs now point to the source-only `../src/internal.js` import path.
- Added the required `Release Validation / Required browser bundle smoke` CI check for the browser bundle build and focused smoke test.
- Added the required `Release Validation / Required packed-tarball quickstart smoke` CI check for the fresh consumer project import and documented quickstart smoke script on pull requests, `main`, and `release/**` branches.
- Added the packed-tarball quickstart smoke to `pnpm run verify` and `pnpm run pack:check` through the explicit `pnpm run quickstart:smoke` command so local verification and Node.js CI full-suite jobs install and execute the packed SDK before publish.
- Hardened the fresh consumer tarball smoke to reject `workspace:` / `link:` SDK installs and installed package entrypoints or `dist` imports that resolve through local source files.
- Extended the fresh consumer tarball smoke to import every public package subpath and run downstream TypeScript type resolution against the installed package root and public subpaths.
- Added a consumer tarball check that verifies private helper files are absent from the installed package and that private helper subpaths remain blocked by package exports.
- Added JavaScript source maps, declaration maps, and original TypeScript sources to the publishable tarball payload.
- Added a package artifact guard that fails release checks when package metadata references runtime JavaScript or TypeScript declaration files that the build did not emit before pack or publish dry runs.
- Strengthened `pack:check` so the packaged source-map guard extracts the tarball, resolves packaged JavaScript and declaration `sourceMappingURL` references to map files in the tarball, and verifies package-owned sources referenced by JavaScript source maps and declaration maps are present in the package payload.
- Added a dependency-free OpenAI-compatible provider adapter that maps chat-completion response metadata into `ModelResponse.metadata.openAICompatible` and normalizes provider failures into stable `DogpileError` codes.
- Added front-door caller configuration validation for `run()`, `stream()`, `createEngine()`, and `createOpenAICompatibleProvider()` with stable `DogpileError` code `invalid-configuration` and `detail.path` diagnostics.
- Added registration-time validation for configured model providers and direct provider adapter options, including stable `DogpileError` diagnostics for malformed provider ids, missing generation functions, and invalid OpenAI-compatible adapter fields.
- Added `StreamHandle.cancel()` and `StreamHandle.status` so live streams abort provider-facing requests, close consumers, and record cancelled runs with stable `DogpileError` code `aborted`.
- Added SDK-enforced `budget.timeoutMs` lifecycle handling for `run()` and `stream()`, including provider-facing request aborts, `DogpileError` code `timeout`, and timer cleanup after completion.
- Documented optional runtime tool `validateInput` behavior, including registration validation, per-call timing before `execute()`, invalid-input result semantics, and expected side-effect-free tool author usage.
- Documented required `Release Validation` status checks for Node.js 22, Node.js 24, Bun latest, browser bundle smoke, packed-tarball quickstart smoke, and the `pack:check` package artifact job before publish.
- Added Dependabot version-update configuration for npm dependencies and GitHub Actions.
- Added a GitHub Actions npm publish workflow for `@dogpile/sdk` using npm Trusted Publishing/OIDC, release-triggered publishing, manual dry runs, and the existing `publish:check` package gate before publish.
