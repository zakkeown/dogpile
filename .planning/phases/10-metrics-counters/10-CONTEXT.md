# Phase 10: Metrics / Counters - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship an optional `metricsHook?: MetricsHook` field on `EngineOptions` and `DogpileOptions`. `MetricsHook` is a callback object with optional `onRunComplete` and `onSubRunComplete` callbacks; both receive a `RunMetricsSnapshot` carrying named counters (token usage, cost, turn count, duration, outcome) at every terminal state for the top-level run and every completed sub-run. Omitting the hook adds zero overhead. A throwing or async hook never propagates into the run result.

This phase also adds `logger?: Logger` to `EngineOptions` and `DogpileOptions` as a new public-surface field for hook error routing.

This phase does NOT modify event shapes, replay behavior, or the trace contract.

</domain>

<decisions>
## Implementation Decisions

### MetricsHook Interface Design (Q-01, Q-02, Q-03, Q-04)

- **D-01: `MetricsHook` is a callback object with two optional callbacks.**
  ```ts
  interface MetricsHook {
    onRunComplete?: (snapshot: RunMetricsSnapshot) => void | Promise<void>;
    onSubRunComplete?: (snapshot: RunMetricsSnapshot) => void | Promise<void>;
  }
  ```
  Callers opt into run-level metrics, sub-run-level metrics, or both independently. The hook field on EngineOptions/DogpileOptions is `metricsHook?: MetricsHook`. This is the field name — not `metrics` or `onMetrics`.

- **D-02: `RunMetricsSnapshot` carries the 5 mandated counters plus an `outcome` field.**
  ```ts
  interface RunMetricsSnapshot {
    readonly outcome: "completed" | "budget-stopped" | "aborted";
    readonly inputTokens: number;      // direct tokens (own-only, excluding nested sub-runs)
    readonly outputTokens: number;     // direct tokens (own-only)
    readonly costUsd: number;          // direct cost (own-only)
    readonly totalInputTokens: number; // full subtree including nested sub-runs
    readonly totalOutputTokens: number;
    readonly totalCostUsd: number;
    readonly turns: number;            // count of agent-turn events (own-only)
    readonly durationMs: number;       // wall-clock duration
  }
  ```
  `outcome` is required (per Q-10: hook fires for all terminal states including aborted — callers need outcome to filter). Own vs. total split (per Q-07c) allows callers to sum hook calls without double-counting at the cost of a wider type. Researcher/planner should confirm whether `turns` is own-only or total; default assumption: own-only (direct agent-turn events in this run, excluding child sub-run turns).

- **D-03: Async fire-and-forget.** Hook callbacks are typed `(snapshot) => void | Promise<void>`. The SDK checks if the return value is a Promise; if so, attaches `.catch(err => routeError(err))` and does NOT await it. Run completion is not delayed by hook latency. Callers who need guaranteed delivery (e.g., flushing to a database before the run resolves) must handle it in their hook.

- **D-04: Hook errors routed to `logger.error` — add `logger?: Logger` to `EngineOptions` and `DogpileOptions`.** New public-surface field using the existing `Logger` interface from `@dogpile/sdk/runtime/logger`. Error routing: `logger.error("dogpile:metricsHook threw", { error: err.message })`. When no `logger` is provided, falls back to `console.error`. This is a deliberate expansion — adding `logger` now enables future engine-level debug/info logging without another public-surface change. Requires CHANGELOG + CLAUDE.md update in lockstep.
  **Researcher note:** `Logger` is currently declared in `src/runtime/logger.ts`, not in `src/types.ts`. The planner must determine whether to re-import `Logger` into types.ts, duplicate the type, or re-export it from a shared location. The existing subpath `@dogpile/sdk/runtime/logger` already exports `Logger` — callers referencing the new `logger?` field on EngineOptions will need to import it from there.

### Counter Fields and Semantics (Q-05, Q-06, Q-07)

- **D-05: `turns` = count of `agent-turn` events in `trace.events` (TurnEvents only).** For broadcast protocol: each parallel agent gets its own TurnEvent, so a 3-agent broadcast round counts as 3 turns. Consistent with health diagnostics. `turns` reflects only the direct (own) turns of this run, not nested child sub-run turns.

- **D-06: `durationMs` from `Date.now()` wall-clock.** Record `startedAtMs = Date.now()` at the beginning of the integration point (top of `runNonStreamingProtocol` or at run start in runProtocol). Compute `durationMs = Date.now() - startedAtMs` at hook call time. Mirrors the existing `startedAtMs` already used in `engine.ts` for timeout tracking. Cross-runtime (no Node-only deps).
  **Sub-run `durationMs` challenge:** For `onSubRunComplete`, the hook fires from the emit callback on `sub-run-completed`. The sub-run start time must be tracked: when a `sub-run-started` event fires in the emit closure, record its timestamp in a `Map<childRunId, startMs>`. When `sub-run-completed` fires, compute `durationMs = Date.now() - startMap.get(childRunId)`. Researcher should verify if `SubRunCompletedEvent.subResult.trace` carries start/end timestamps that make this simpler.

- **D-07: Own and total counter split.** `RunMetricsSnapshot` carries both `own*` and `total*` token/cost fields (see D-02 type sketch). `totalInputTokens`/`totalOutputTokens`/`totalCostUsd` come directly from `subResult.cost` (already rolled up by Phase 2). `ownInputTokens`/`ownOutputTokens`/`ownCostUsd` require subtracting nested child sub-run costs: `ownCostUsd = subResult.cost.usd - sum(childSubRunCosts)`. Researcher should confirm whether the child sub-run costs are easily derivable from `subResult.trace.events` (via `sub-run-completed` events in the child trace) or whether there is an existing aggregate field that provides this.

### Integration Architecture (Q-08, Q-09)

- **D-08: Integration inside `runProtocol` via emit callback (uniform event-driven approach).** Both top-level runs and sub-runs fire the hook from within the emit closure:
  - **Sub-runs:** Intercept `sub-run-completed` in the existing emit closure. Call `metricsHook.onSubRunComplete?.(buildSubRunSnapshot(event.subResult, durationMs))`.
  - **Top-level run:** A hook call site is needed at the end of `runProtocol` (after result assembly). This requires threading `metricsHook` through `RunProtocolOptions` (the internal type) alongside `emit`, `signal`, etc. After `runProtocol` resolves with the final `RunResult`, call `metricsHook.onRunComplete?.(buildRunSnapshot(result, durationMs))`.
  **Researcher/planner note:** The "uniform emit approach" for top-level runs may require either (a) adding a hook call after `runProtocol` resolves in `runNonStreamingProtocol` (the Phase 9 integration point for OTEL), or (b) threading `metricsHook` into `RunProtocolOptions` and firing at the end of `runProtocol` itself. Both achieve the same observable behavior. Planner should pick the simpler implementation consistent with how Phase 9 wires the `tracer`.
  **Streaming path:** `onRunComplete` fires when the streaming path resolves its final `RunResult` (consistent with Phase 9 tracing parity for `stream()`). `onSubRunComplete` fires from the streaming emit closure when `sub-run-completed` events arrive.

- **D-09: `metricsHook?: MetricsHook` mirrored on both `EngineOptions` AND `DogpileOptions`.** Consistent with the `tracer` pattern from Phase 9 CONTEXT.md D-05. Same applies to `logger?: Logger` (D-04) — mirror on both. Requires two type definitions updated + validation + CHANGELOG + CLAUDE.md.

### Terminal State Coverage (Q-10)

- **D-10: Hook fires for ALL terminal states — completed, budget-stopped, and aborted.** The `outcome` field in `RunMetricsSnapshot` tells callers how the run ended. For aborted runs, counters reflect partial work accumulated up to the abort point. This means the hook must fire in error paths (`catch` or `finally` blocks in `runNonStreamingProtocol`), not only in the happy-path result assembly.
  **Error path challenge:** For aborted/budget-stopped runs, `RunResult` may not be fully assembled. The hook call must occur after whatever partial result data is available. Researcher should identify which data is reliably present at each terminal path and what `durationMs` / `turns` / `costUsd` look like for an aborted run.

### Public Surface (Q-12, Q-13, Q-14)

- **D-11: `/runtime/metrics` subpath — follow the established pattern.** `src/runtime/metrics.ts` exports `MetricsHook` and `RunMetricsSnapshot`. New subpath `@dogpile/sdk/runtime/metrics` added to `package.json` exports and `files`, `src/tests/package-exports.test.ts`, `CHANGELOG.md`, `CLAUDE.md` invariant chain. Consistent with the family: `/runtime/provenance`, `/runtime/introspection`, `/runtime/health`, `/runtime/audit`, `/runtime/tracing`.

- **D-12: No root exports for Phase 10 types.** `MetricsHook` and `RunMetricsSnapshot` are NOT added to `src/index.ts`. Callers import from `@dogpile/sdk/runtime/metrics` when they need type annotations. Callers using `Dogpile.pile()` with inline arrow functions need no explicit import.
  **Conflict note:** Q-12 picked option c ("both root export AND subpath"), but Q-13 picked option c ("subpath-only, no root exports"). These are contradictory. **Resolution: Q-13 takes precedence** — it is the more specific question about root exports. `/runtime/metrics` subpath exists; no root re-export.

- **D-13: Freeze a `metrics-snapshot-v1.json` fixture.** Since `RunMetricsSnapshot` has non-trivial fields (own/total split, outcome, 9+ fields total), a frozen fixture provides regression protection consistent with the milestone pattern (provenance-event-v1.json, health-anomaly-v1.json, audit-record-v1.json). Companion `metrics-snapshot-v1.type-check.ts` with `satisfies RunMetricsSnapshot` compile-time assertion.

### Deferred Decision (Q-11 — unanswered)

- **Q-11: Hook fires for `sub-run-failed` events?** Not answered during discussion. Planner should make a call:
  - Default recommendation: **No** — skip hook for `sub-run-failed`. Partial counter data from a failed sub-run's incomplete trace is unreliable. Callers who need failed-sub-run cost visibility can inspect the partial trace from `DogpileError`. Consistent with "counters at run and sub-run *completion*" language in METR-01 (failure ≠ completion).
  - If planner deems it necessary: the `sub-run-failed` event carries a partial `Trace`; the hook could fire with `outcome: "aborted"` and zero/partial counters.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and Roadmap
- `.planning/ROADMAP.md` — Phase 10 goal, success criteria, METR-01/METR-02 requirement refs
- `.planning/REQUIREMENTS.md` — Full METR-01, METR-02 requirement text; out-of-scope list (no bundled metric exporters, no perf_hooks/process.hrtime)
- `.planning/PROJECT.md` — Core value statement, milestone goal, public-surface invariants
- `.planning/STATE.md` — Accumulated milestone decisions ("public-surface invariants must move together", "no @opentelemetry/* in src/runtime/")

### Prior Phase Context (MUST read — decisions carry forward)
- `.planning/phases/09-otel-tracing-bridge/09-CONTEXT.md` — D-05 (tracer on both EngineOptions + DogpileOptions, mirrored-surface pattern); D-04 (RunProtocolOptions as the internal threading type); integration point patterns; streaming parity requirement. `metricsHook` follows the same mirroring pattern as `tracer`.
- `.planning/phases/07-structured-event-introspection-health-diagnostics/07-CONTEXT.md` — Subpath wiring steps (identical for `/runtime/metrics`); `computeHealth(trace)` as reference for pure function working from Trace events.
- `.planning/phases/08-audit-event-schema/08-CONTEXT.md` — AuditRecord own/total pattern for sub-run costs; `SubRunCompletedEvent.subResult.cost` rollup semantics; `exactOptionalPropertyTypes` conditional spread pattern.

### Critical Type Definitions (MUST read before implementing)
- `src/types.ts` — `EngineOptions` interface (add `metricsHook?: MetricsHook` and `logger?: Logger`); `DogpileOptions` interface (mirror both fields); `RunProtocolOptions` (add `metricsHook?` for internal threading per D-08)
- `src/types/events.ts:547–580` — `SubRunCompletedEvent` (`subResult: RunResult` — source of total counters for `onSubRunComplete`; `childRunId` for sub-run start-time tracking)
- `src/types/events.ts` — `SubRunFailedEvent` (relevant only if Q-11 is resolved as "yes — fire for failed sub-runs")
- `src/runtime/logger.ts` — `Logger` interface, `noopLogger` (D-04 reuses this type; the planner must resolve whether `Logger` is imported into `types.ts` or declared inline)
- `src/runtime/engine.ts:646–710` — `RunProtocolOptions` definition and `runNonStreamingProtocol` — D-08 integration point; Phase 9 OTEL integration is the direct template for where `metricsHook` wiring goes

### Engine Integration Points (MUST read before implementing)
- `src/runtime/engine.ts:691–760` — `runNonStreamingProtocol` — Phase 9 wired `tracer` here; `metricsHook` follows the same pattern for top-level run hook call and streaming path
- `src/runtime/engine.ts:787–870` — `runProtocol` and `RunProtocolOptions` — D-08: add `metricsHook?: MetricsHook` to this internal type; coordinator uses it to pass hook into child sub-run dispatches
- `src/runtime/engine.ts` streaming path — `stream()` needs parallel hook wiring for `onRunComplete` (streaming parity, consistent with Phase 9 D-13)
- `src/runtime/defaults.ts` — exported constants convention; if `MetricsHook` needs default helpers, follow this pattern

### Public Surface Gates (MUST update in lockstep)
- `src/tests/package-exports.test.ts` — add `/runtime/metrics` subpath assertion
- `src/tests/fixtures/metrics-snapshot-v1.json` — new frozen fixture (D-13)
- `src/tests/fixtures/metrics-snapshot-v1.type-check.ts` — new `satisfies RunMetricsSnapshot` compile-time check
- `package.json` `exports` and `files` — `/runtime/metrics` subpath wiring (D-11)
- `CHANGELOG.md` — new `MetricsHook` type, `RunMetricsSnapshot` type, `metricsHook` field on `EngineOptions`/`DogpileOptions`, `logger` field on `EngineOptions`/`DogpileOptions`, `/runtime/metrics` subpath
- `CLAUDE.md` — update public-surface invariant chain for Phase 10 additions (metrics + logger fields)

### Phase 9 Subpath/Mirroring Pattern (follow exactly)
- `.planning/phases/09-otel-tracing-bridge/09-CONTEXT.md` D-05 — steps for adding to both EngineOptions and DogpileOptions. `metricsHook` and `logger` follow identical steps.
- `src/runtime/provenance.ts` — reference module shape for `src/runtime/metrics.ts` (pure TS, no Node-only deps, exported types + no side effects)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/runtime/logger.ts` — `Logger` interface + `noopLogger` — D-04 reuses this type directly. The `noopLogger` pattern (no-op when absent) applies to the fallback when no `logger` is provided on EngineOptions.
- `src/runtime/engine.ts` `startedAtMs = Date.now()` — already computed in `createEngine.run()` for timeout tracking. D-06 reuses the same `Date.now()` pattern at `runNonStreamingProtocol` entry.
- `src/runtime/provenance.ts` — structural template for `src/runtime/metrics.ts`. Pure TS, exported interface(s) + type(s), no Node-only deps, no side effects.

### Established Patterns
- **Standalone subpath module pattern** — `/runtime/provenance`, `/runtime/introspection`, `/runtime/health`, `/runtime/audit`, `/runtime/tracing`. `src/runtime/metrics.ts` is the 6th entry in this family.
- **`exactOptionalPropertyTypes`** — `metricsHook?`, `logger?`, `onRunComplete?`, `onSubRunComplete?`, `parentRunId?` in `RunMetricsSnapshot` must be absent (not `undefined`) when not provided. Pattern: `...(options.metricsHook ? { metricsHook: options.metricsHook } : {})`.
- **Mirrored-surface pattern** — Phase 9 D-05: `tracer` was added to both `EngineOptions` and `DogpileOptions`. `metricsHook` and `logger` follow identical steps.
- **`readonly` everywhere** — `MetricsHook`, `RunMetricsSnapshot` fields all `readonly`.
- **Internal type threading via `RunProtocolOptions`** — `emit`, `signal`, `parentDeadlineMs`, `parentSpan?` (Phase 9) are threaded this way. `metricsHook?: MetricsHook` follows the same pattern.
- **Frozen fixture pattern** — `provenance-event-v1.json`, `health-anomaly-v1.json`, `audit-record-v1.json`. `metrics-snapshot-v1.json` follows the same two-file pattern (JSON fixture + `.type-check.ts`).
- **Fire-and-forget Promise isolation** — `.catch(err => errorChannel(err))` on async hook returns. Researcher should check if any existing SDK code already has this pattern (e.g., in the streaming subscriber logic in `logger.ts` where logger throws are caught).

### Integration Points
- **`runNonStreamingProtocol` — primary seam.** The emit closure inside this function is where `sub-run-completed` is intercepted. The top-level run hook call fires at the end of this function (or at the end of `runProtocol` — planner picks the cleaner location after reading Phase 9 implementation).
- **`runProtocol` — internal threading seam.** `RunProtocolOptions` threads options into coordinator's child dispatch. `metricsHook` must be in this struct for sub-run hook calls inside coordinator-dispatched child runs to work.
- **Sub-run start tracking.** In the emit closure, maintain a `Map<childRunId, startMs>` populated on `sub-run-started` events and consumed on `sub-run-completed`. Needed for `durationMs` in `onSubRunComplete` snapshots (D-06 wall-clock approach).
- **Own vs. total cost derivation (D-07).** `totalCostUsd = subResult.cost.usd` (direct from Phase 2 rollup). `ownCostUsd = totalCostUsd - sum(nestedChildCostUsd)` where nested child costs come from `sub-run-completed` events in `subResult.trace.events`. Researcher should verify this derivation is sound by reading `SubRunCompletedEvent` nesting in the engine.
- **All-terminals hook (D-10).** The `try/finally` block structure in `runNonStreamingProtocol` (or the abort lifecycle) determines where budget-stopped and aborted hook calls fire. Researcher must confirm which partial data is available at each terminal path.

</code_context>

<specifics>
## Specific Ideas

- **Full `MetricsHook` type sketch** (from D-01, D-02, D-03):
  ```ts
  export interface RunMetricsSnapshot {
    readonly outcome: "completed" | "budget-stopped" | "aborted";
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd: number;
    readonly totalInputTokens: number;
    readonly totalOutputTokens: number;
    readonly totalCostUsd: number;
    readonly turns: number;
    readonly durationMs: number;
  }

  export interface MetricsHook {
    readonly onRunComplete?: (snapshot: RunMetricsSnapshot) => void | Promise<void>;
    readonly onSubRunComplete?: (snapshot: RunMetricsSnapshot) => void | Promise<void>;
  }
  ```
  Note: `RunMetricsSnapshot` does NOT include `runId`, `depth`, or `parentRunId` (per Q-02c which selected outcome only, not identity). If planner deems run identity necessary, it can be added to the subpath-only export without a root-export breaking change.

- **`logger` import problem (D-04):** `Logger` is currently only in `src/runtime/logger.ts`, but `EngineOptions` is in `src/types.ts`. The options:
  1. Move `Logger` interface to `src/types.ts` (or `src/types/logger.ts`) and re-export from `src/runtime/logger.ts` for backward compat.
  2. Import `Logger` from `./runtime/logger.js` in `types.ts` (unusual — types.ts typically has no runtime imports).
  3. Duplicate the interface inline in `types.ts` with a `satisfies Logger` check somewhere.
  Planner should consult Phase 9 context for how `DogpileTracer` was handled — it was declared in `src/runtime/tracing.ts` and referenced in `types.ts` via import.

- **`metricsHook` in `RunProtocolOptions` for coordinator dispatch.** The coordinator's sub-run dispatch (`runProtocol(childInput)`) already threads options like `signal`, `parentDeadlineMs`, `effectiveMaxDepth` through `RunProtocolOptions`. Adding `metricsHook` follows the same spread pattern. The child run's `runProtocol` invocation will then fire `onRunComplete` when the child completes — but this fires at the coordinator's depth level, not the parent's. The parent also intercepts `sub-run-completed` and fires `onSubRunComplete`. Callers receive TWO hook calls per successful sub-run: `onRunComplete` (from the child's own runProtocol) AND `onSubRunComplete` (from the parent's emit closure). This double-fire semantic should be documented and may be surprising. Planner should decide whether to suppress `onRunComplete` for non-root runs.

- **Double-fire concern:** If `onRunComplete` fires for every depth (including sub-runs via their own `runProtocol` calls) AND `onSubRunComplete` fires in the parent's emit closure, callers using both callbacks would receive duplicate data for sub-runs. Planner should resolve: either suppress `onRunComplete` for non-root runs (depth > 0), or document that `onRunComplete` is for all depths including sub-runs, and `onSubRunComplete` is specifically from the parent's perspective (with parent context). Given D-08b's "uniform" intent, likely `onRunComplete` fires for all depths and `onSubRunComplete` is a semantic alias from the parent's vantage point.

</specifics>

<deferred>
## Deferred Ideas

- **Q-11: Hook for `sub-run-failed` events** — not answered. Planner default: skip hook for failed sub-runs (partial/unreliable data; callers inspect DogpileError for partial trace if needed).
- **`runId`, `depth`, `parentRunId` on `RunMetricsSnapshot`** — not included in this phase (Q-02c selected outcome only). Could be added to the subpath-only type in a future pass if callers need run identity for metric tagging.
- **Replay hook behavior** — not discussed. Consistent with Phase 9 D-14 (tracer ignored for replay), the metrics hook should also be explicitly ignored for `replay()` / `replayStream()`. Planner should add a guard at the replay call site.
- **`dogpile.tool-call` metric tracking** — deferred from Phase 9. Tool call accounting (tool invocations, tool latency) could be a future counter dimension.
- **Built-in metric exporters** — explicitly out of scope per REQUIREMENTS.md. Caller bridges any backend (Prometheus, DataDog, StatsD) via the `MetricsHook` interface.
- **Per-turn hook** — not added. The hook fires at run/sub-run completion only. Per-turn counters would be a different interface and belong in a future phase.
- **`metricsHook` on `RunCallOptions`** — per-call override not added. The hook is set once at engine level. Consistent with tracer (Phase 9 deferred the same per-call override pattern).

</deferred>

---

*Phase: 10-Metrics/Counters*
*Context gathered: 2026-05-01*
