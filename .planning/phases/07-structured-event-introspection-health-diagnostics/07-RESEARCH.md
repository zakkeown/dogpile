# Phase 7: Structured Event Introspection + Health Diagnostics - Research

**Researched:** 2026-05-01
**Domain:** TypeScript runtime — pure event-filter function + trace-derived health summary
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `queryEvents` is a standalone function, not a method. Exported from `/runtime/introspection` as `queryEvents(events: readonly RunEvent[], filter: EventQueryFilter): RunEvent[]` (with overloads). No coupling to `RunEventLog` or `RunResult` interfaces — pure function.
- **D-02:** Filter shape is a single `EventQueryFilter` object with all optional fields: `{ type?: RunEvent["type"], agentId?: string, turnRange?: { min?: number, max?: number }, costRange?: { min?: number, max?: number } }`. AND semantics across fields. Empty filter returns all events. Unmatched filter returns `[]`.
- **D-03:** Overloaded signatures per event type. One overload per `RunEvent` member type so `queryEvents(events, { type: "agent-turn" })` returns `TurnEvent[]` with no caller cast. ~14 overloads — heavy but reliable and IDE-friendly.
- **D-04:** `costRange` matches against `TurnEvent.cost.usd` and `BroadcastEvent.cost.usd` only. Events without a `cost.usd` field are excluded from results when `costRange` is set.
- **D-05:** `RunHealthSummary` shape: `{ anomalies: HealthAnomaly[], stats: { totalTurns: number, agentCount: number, budgetUtilizationPct: number | null } }`. All fields deterministically computable from trace events.
- **D-06:** Dual path — `result.health` always present (auto-computed) + standalone `computeHealth(trace, thresholds?)` from `/runtime/health`. `DEFAULT_HEALTH_THRESHOLDS` exported as constant. `EngineOptions` does NOT get a `healthThresholds` field.
- **D-07:** `HealthAnomaly` shape: `{ code: AnomalyCode, severity: "warning" | "error", value: number, threshold: number, agentId?: string }`.
- **D-08:** No default `runaway-turns` threshold — suppressed unless caller sets it via `computeHealth(trace, { runawyTurns: N })`. (Note: `runawyTurns` is the spelling in CONTEXT.md — see Open Questions #5.)
- **D-09:** No default `budget-near-miss` threshold — suppressed unless caller sets `budgetNearMissPct`. Auto-path can emit `empty-contribution` and `provider-error-recovered` (threshold-free).
- **D-10:** Two separate new subpaths: `/runtime/introspection` + `/runtime/health`.
- **D-11:** Partial freeze — `HealthAnomaly` record shape only. `src/tests/fixtures/anomaly-record-v1.json` is added with one sample per anomaly code.

### Claude's Discretion

None declared in CONTEXT.md — all fields are locked decisions or deferred.

### Deferred Ideas (OUT OF SCOPE)

- Per-turn health streaming (deferred to v0.6.0+)
- `EngineOptions.healthThresholds`
- Exact `turnRange` semantics — researcher should determine
- `provider-error-recovered` detection mechanism — researcher should determine
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INTR-01 | Caller can filter completed trace events by type, agent id, turn number, or cost range using a typed query function | `queryEvents(events, filter)` — pure function on `readonly RunEvent[]`; all four filter axes verified against actual event shapes |
| INTR-02 | Introspection query returns typed subsets of `RunEvent[]` with no new types introduced (callers narrow, not cast) | Overloaded signatures with discriminant dispatch on `event.type`; conditional-type pattern also viable |
| HLTH-01 | Caller can read a structured health summary on `RunResult` with machine-readable anomaly codes and configurable thresholds | `result.health: RunHealthSummary` always-present field; `computeHealth()` for custom thresholds |
| HLTH-02 | Health summary is computed at result time, available on `replay()`, and re-computed identically from the same trace on any runtime | Attach site in both `runNonStreamingProtocol()` and `replay()` identified; pure computation from `trace.events` |
</phase_requirements>

---

## Summary

Phase 7 ships two independent observability utilities on top of the Phase 6 provenance foundation. Both are pure TypeScript functions with no Node-only dependencies, no filesystem access, and no coupling to the coordination protocols — they consume `readonly RunEvent[]` and produce plain typed objects.

The introspection side (`queryEvents`) is mechanically straightforward: filter an array by up to four independent predicates and return a narrowed type. The health side (`computeHealth`) requires understanding what is actually detectable from the event log, which leads to the critical research finding: `provider-error-recovered` is **not detectable from the trace as the runtime currently stands**, and adding detection would be an event-shape change that conflicts with the milestone-level invariant "Phase 6 (Provenance) is the only event-shape change."

The `withRetry` wrapper retries `provider.generate()` internally (confirmed: `src/runtime/retry.ts` lines 153–177) and exposes retries only through a caller-supplied `onRetry` side-effect callback. `generateModelTurn` (verified: `src/runtime/model.ts` lines 25–91) calls the already-wrapped provider without retry awareness. Phase 6 Plan 02 will emit one `model-request` and one `model-response` wrapping the outer call, but retries inside `withRetry` remain invisible to the trace.

**Primary recommendation:** Exclude `provider-error-recovered` from the auto-compute path in Phase 7. The anomaly code stays in the `AnomalyCode` union and the frozen fixture includes a sample record, but `computeHealth` never emits it (consistent with the milestone invariant). Adding detection infrastructure is deferred to the same phase or a follow-on where an event-shape change is permitted.

**Additional finding:** `canonicalizeRunResult` in `src/runtime/defaults.ts` enumerates `RunResult` fields explicitly — it does NOT spread `...result`. Phase 7 must add `health` to its enumeration, or the health field will be silently dropped on every result returned through `run()`, `stream()`, and `replay()`. [VERIFIED: defaults.ts lines 584–608]

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `queryEvents` filter function | Pure TS runtime (`src/runtime/introspection.ts`) | — | Operates on `readonly RunEvent[]`; no I/O, no protocol coupling |
| `computeHealth` computation | Pure TS runtime (`src/runtime/health.ts`) | — | Deterministic computation from trace events; no I/O |
| `result.health` attachment | Engine (`src/runtime/engine.ts`) | — | Two sites: `runNonStreamingProtocol()` result construction and `replay()` |
| `canonicalizeRunResult` update | `src/runtime/defaults.ts` | — | Enumerates RunResult fields explicitly — must add `health` to its output |
| Type definitions (`RunHealthSummary`, `HealthAnomaly`) | `src/types.ts` | — | Lives alongside `RunResult`; public-surface type |
| `EventQueryFilter` type | `src/runtime/introspection.ts` | — | Function-local; callers import from the subpath |
| Subpath exports | `package.json` exports + `src/tests/package-exports.test.ts` | — | Established subpath lockstep pattern |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^6.0.3 (devDep) | Type system for overloads and conditional types | Project constraint |
| Vitest | existing | Test framework | Established in project |

No new runtime dependencies. This phase adds zero entries to `dependencies` or `peerDependencies`. [VERIFIED: package.json]

### Installation

No new packages to install.

---

## Architecture Patterns

### System Architecture Diagram

```
result.eventLog.events / trace.events (readonly RunEvent[])
       │
       ├── queryEvents(events, filter) ──► filtered RunEvent[] subtype
       │        │
       │        ├── type filter: discriminant match on event.type
       │        ├── agentId filter: "agentId" in e && e.agentId === filter.agentId
       │        ├── turnRange filter: global 1-based position of agent-turn events in array
       │        └── costRange filter: TurnEvent.cost.usd | BroadcastEvent.cost.usd only
       │
       └── computeHealth(trace, thresholds?) ──► RunHealthSummary
                │
                ├── stats.totalTurns ← count of agent-turn events
                ├── stats.agentCount ← unique agentId values across agent-turn events
                ├── stats.budgetUtilizationPct ← trace.budget.caps.maxUsd present?
                │       (cost.usd / maxUsd * 100) : null
                ├── anomaly: runaway-turns (threshold-gated, per agent)
                ├── anomaly: budget-near-miss (threshold-gated, global)
                ├── anomaly: empty-contribution (threshold-free: agent-turn with empty/blank output)
                └── anomaly: provider-error-recovered (DEFERRED — no trace signal exists; see Critical Finding)

engine.ts:
  runNonStreamingProtocol() ──► runResult WITH health attached
                             ──► canonicalizeRunResult() ◄── health must be added to enumeration
  replay()                   ──► baseResult WITH health attached ──► canonicalizeRunResult()
  applyRunEvaluation()       ──► canonicalizeRunResult({ ...result, ... })
                                 ◄── health present on input result (from runNonStreamingProtocol)
                                 ◄── canonicalizeRunResult must include health in output
```

### Recommended Project Structure

```
src/
├── runtime/
│   ├── introspection.ts     # queryEvents() + EventQueryFilter type
│   └── health.ts            # computeHealth() + RunHealthSummary + HealthAnomaly types
├── types.ts                 # RunHealthSummary, HealthAnomaly, AnomalyCode added here
└── tests/
    ├── fixtures/
    │   └── anomaly-record-v1.json   # frozen HealthAnomaly shape, one record per code
    ├── introspection.test.ts        # co-located unit tests for queryEvents
    ├── health.test.ts               # co-located unit tests for computeHealth
    ├── health-shape.test.ts         # frozen fixture comparison (or inline in result-contract)
    └── package-exports.test.ts      # updated with two new subpaths
```

### Pattern 1: TypeScript Overload for Type Narrowing

D-03 prescribes ~14 hand-written overloads. There is also a more concise alternative using a conditional type. Both are documented here.

**Option A: Hand-written overloads (D-03 prescribed, ~15 overloads)**

```typescript
// Source: CONTEXT.md D-03 + TypeScript handbook — function overloads
// [ASSUMED] — example of prescribed pattern
function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "agent-turn" }): TurnEvent[];
function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "broadcast" }): BroadcastEvent[];
function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "model-request" }): ModelRequestEvent[];
// ... one overload per RunEvent discriminant (~15 total) ...
function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter): RunEvent[];
function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter): RunEvent[] {
  // implementation — all overloads share one body
}
```

**Option B: Generic + fallback (two overloads, more maintainable)**

```typescript
// Source: TypeScript docs — generic conditional types
// [ASSUMED] — alternative to D-03's prescribed form
type EventByType<T extends RunEvent["type"]> = Extract<RunEvent, { type: T }>;

function queryEvents<T extends RunEvent["type"]>(
  events: readonly RunEvent[],
  filter: { type: T } & Omit<EventQueryFilter, "type">
): EventByType<T>[];
function queryEvents(events: readonly RunEvent[], filter?: EventQueryFilter): RunEvent[];
```

Option B produces identical narrowing at call sites and requires no updates when new event types are added. D-03 explicitly chose Option A for IDE reliability and explicitness — the planner should follow D-03 unless a reason to deviate is documented.

### Pattern 2: Filter Implementation

```typescript
// Source: [ASSUMED] — standard array filter + type guard pattern
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter): RunEvent[] {
  let result: RunEvent[] = filter.type !== undefined
    ? events.filter(e => e.type === filter.type)
    : [...events];

  if (filter.agentId !== undefined) {
    const { agentId } = filter;
    // Use "in" check — not all events have agentId (e.g., BudgetStopEvent, FinalEvent)
    result = result.filter(e => "agentId" in e && (e as { agentId?: string }).agentId === agentId);
  }

  if (filter.turnRange !== undefined) {
    const { min, max } = filter.turnRange;
    // Build a Set of in-range TurnEvent objects by global 1-based position
    const agentTurnEvents = events.filter((e): e is TurnEvent => e.type === "agent-turn");
    const inRangeSet = new Set<RunEvent>(
      agentTurnEvents.filter((_, i) => {
        const n = i + 1;
        return (min === undefined || n >= min) && (max === undefined || n <= max);
      })
    );
    // Keep non-TurnEvents; keep TurnEvents only if they are in-range
    result = result.filter(e => e.type !== "agent-turn" || inRangeSet.has(e));
  }

  if (filter.costRange !== undefined) {
    const { min, max } = filter.costRange;
    result = result.filter(e => {
      if (e.type !== "agent-turn" && e.type !== "broadcast") return false;
      const usd = e.cost.usd;
      return (min === undefined || usd >= min) && (max === undefined || usd <= max);
    });
  }

  return result;
}
```

**Note on `turnRange` semantics (deferred question, resolved here):** `TurnEvent` has no `turnIndex` field [VERIFIED: src/types/events.ts]. The natural semantic is the **global (cross-agent) 1-based position** of agent-turn events in the event array. Per-agent indexing would require a derived counter and makes behavior non-obvious when multiple agents interleave. Recommendation: global turn index. `BroadcastEvent.round` is a separate concept and `turnRange` does NOT match against it. [ASSUMED: global indexing; planner should confirm if per-agent is preferred]

### Pattern 3: Health Computation

```typescript
// Source: [ASSUMED] — pure computation consistent with createRunAccounting pattern (defaults.ts:200)
export function computeHealth(
  trace: Trace,
  thresholds: HealthThresholds = {}
): RunHealthSummary {
  const turnEvents = trace.events.filter((e): e is TurnEvent => e.type === "agent-turn");
  const agentIds = new Set(turnEvents.map(e => e.agentId));
  const totalTurns = turnEvents.length;
  const agentCount = agentIds.size;

  const maxUsd = trace.budget?.caps?.maxUsd;
  const finalCost = trace.finalOutput.cost.usd;
  const budgetUtilizationPct: number | null = maxUsd !== undefined
    ? (maxUsd === 0 ? 0 : (finalCost / maxUsd) * 100)
    : null;

  const anomalies: HealthAnomaly[] = [];

  // threshold-gated: runaway-turns (per agent)
  if (thresholds.runawayTurns !== undefined) {
    for (const agentId of agentIds) {
      const count = turnEvents.filter(e => e.agentId === agentId).length;
      if (count > thresholds.runawayTurns) {
        anomalies.push({ code: "runaway-turns", severity: "error", value: count, threshold: thresholds.runawayTurns, agentId });
      }
    }
  }

  // threshold-gated: budget-near-miss (global)
  if (thresholds.budgetNearMissPct !== undefined && budgetUtilizationPct !== null) {
    if (budgetUtilizationPct >= thresholds.budgetNearMissPct) {
      anomalies.push({ code: "budget-near-miss", severity: "warning", value: budgetUtilizationPct, threshold: thresholds.budgetNearMissPct });
    }
  }

  // threshold-free: empty-contribution
  for (const e of turnEvents) {
    if (e.output.trim() === "") {
      anomalies.push({ code: "empty-contribution", severity: "error", value: 0, threshold: 0, agentId: e.agentId });
    }
  }

  // provider-error-recovered: DEFERRED — no trace signal exists (see Critical Finding section)
  // The anomaly code remains in AnomalyCode union and in the frozen fixture; computeHealth
  // never emits it from the auto-compute path in Phase 7.

  return { anomalies, stats: { totalTurns, agentCount, budgetUtilizationPct } };
}
```

### Anti-Patterns to Avoid

- **Coupling `queryEvents` to `RunEventLog` or `RunResult`:** The function must accept `readonly RunEvent[]` directly.
- **Making `result.health` optional:** Health is always computable from the trace — it must be non-optional on `RunResult`.
- **Forgetting `canonicalizeRunResult`:** This function enumerates `RunResult` fields explicitly (verified: `defaults.ts` lines 594–605). Health will be silently dropped if not added to its output.
- **Matching `turnRange` against `BroadcastEvent.round`:** Different concept. `round` is a broadcast protocol counter; `turnRange` is for agent turns.
- **Reading `usdCapUtilization` from `RunAccounting`:** That is a `0..1` ratio. `budgetUtilizationPct` must be computed independently as `(cost / maxUsd) * 100`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Type narrowing on discriminated union | Custom type guard registry | TypeScript overloads or `Extract<RunEvent, { type: T }>` | Built into the type system |
| Budget utilization calc | Custom formula | Mirror `createRunAccounting` pattern from `defaults.ts:211` | Already tested, consistent |
| Agent uniqueness count | Manual dedup | `new Set(turnEvents.map(e => e.agentId)).size` | Standard JS |

---

## Critical Research Finding: `provider-error-recovered` and the Milestone Invariant

### The Invariant

`STATE.md` (Accumulated Context, Decisions) states:

> **Phase 6 (Provenance) is the only event-shape change.** All other phases are pure additions or engine-option injections.

This is a milestone-level locked decision, not a Phase 7 choice.

### The Detection Problem

`withRetry` (`src/runtime/retry.ts` lines 153–177) retries `provider.generate()` silently inside the wrapper. The SDK-level `generateModelTurn()` (`src/runtime/model.ts` lines 25–91) calls the already-wrapped provider's `.generate()` — retries are completely invisible at this boundary. Phase 6 Plan 02 will add `model-request` / `model-response` emit calls wrapping the outer `provider.generate()` call, but those wrap the post-retry result. There is **no event, no field, and no counter in the current trace** that captures "this call required N retries before succeeding." [VERIFIED: src/runtime/retry.ts, src/runtime/model.ts]

`withRetry` is also caller-opt-in — many callers pass a raw provider with no retry wrapping at all.

### Three Options (in order of constraint compatibility)

**Option C: Exclude `provider-error-recovered` from auto-compute in Phase 7 (DEFAULT — consistent with milestone invariant)**

The anomaly code stays in the `AnomalyCode` union and `anomaly-record-v1.json` includes a sample record, but `computeHealth` never emits it. No event shape change. Deferred to the phase where detection infrastructure can be added.

- Fully consistent with STATE.md invariant.
- HLTH-02 is satisfied (health is still deterministically recomputed from trace — it just never emits this code).
- The frozen fixture documents the expected shape for when the code is eventually activated.

**Option A: Add `recoveredErrors?: number` to `ModelResponseEvent` (requires invariant waiver)**

After Phase 6 Plan 02 adds `model-request` / `model-response` event emission, extend `ModelResponseEvent` with an optional `readonly recoveredErrors?: number` field. Thread a retry counter through `generateModelTurn` options. `computeHealth` then reads this field from `model-response` events to detect recovered errors.

- **BLOCKED by STATE.md invariant unless user explicitly waives it.** Adding a field to `ModelResponseEvent` is an event-shape change.
- If waived: narrowest working implementation. `agentId` is already on `ModelResponseEvent` — per-agent attribution works.
- Requires `event-schema.test.ts` + `result-contract.test.ts` update and CHANGELOG entry.

**Option B: Multiple `model-request` events per retry attempt (largest surface impact)**

Emit one `model-request` per retry attempt inside `generateModelTurn`. Pattern-match sequences: N requests + 1 response with the same callId = N-1 recovered errors.

- Requires structural change to `withRetry` (a published subpath) and `generateModelTurn`.
- More noisy trace. Harder to detect post-hoc.
- Also an event-shape change — blocked by the same invariant.

### Recommendation

**Implement Option C in Phase 7.** Add `provider-error-recovered` to `AnomalyCode` and the fixture but do not emit it from `computeHealth`. If the user wants detection in this milestone, they must explicitly waive STATE.md's "only event-shape change" decision — that waiver belongs in discuss-phase, not in Phase 7 planning. [ASSUMED: "pure additions" in STATE.md means no event-shape mutation]

---

## Common Pitfalls

### Pitfall 1: `agentId` Filter Matches Non-Agent Events

**What goes wrong:** Events like `BudgetStopEvent`, `FinalEvent`, `SubRunStartedEvent` do not have `agentId` — a naive `e.agentId === filter.agentId` check fails at runtime under `noUncheckedIndexedAccess`.
**Why it happens:** `agentId` is present on `RoleAssignmentEvent`, `ModelRequestEvent`, `ModelResponseEvent`, `ModelOutputChunkEvent`, `TurnEvent`. It is absent on `BudgetStopEvent`, `FinalEvent`, `BroadcastEvent`, all sub-run events. `ToolCallEvent` and `ToolResultEvent` have `agentId?` (optional). [VERIFIED: src/types/events.ts]
**How to avoid:** `"agentId" in e && e.agentId === filter.agentId` — safely excludes events without the field.

### Pitfall 2: `canonicalizeRunResult` Drops `health` Field

**What goes wrong:** `health` is attached in `runNonStreamingProtocol` but silently dropped by `canonicalizeRunResult` before the result is returned.
**Why it happens:** `canonicalizeRunResult` (defaults.ts lines 594–605) enumerates the fields of `RunResult` explicitly — it does NOT spread `...result`. [VERIFIED: src/runtime/defaults.ts lines 584–608]
**How to avoid:** Add `health: canonicalizeSerializable(result.health)` to the `canonicalResult` object in `canonicalizeRunResult`. This is a mandatory change in Phase 7.
**Warning signs:** `result.health` defined before `canonicalizeRunResult` but `undefined` after.

### Pitfall 3: `replay()` Skips Health on Non-final Traces

**What goes wrong:** `replay()` has an early branch: if `lastEvent?.type !== "final"`, it returns `baseResult` directly without `quality`/`evaluation`. If `health` is only added in the `lastEvent.type === "final"` branch, incomplete traces won't have it.
**Why it happens:** D-06 says `result.health` is "always present" — this applies to replay too. [VERIFIED: src/runtime/engine.ts lines 950–958]
**How to avoid:** Attach `health` to `baseResult` before the `lastEvent?.type !== "final"` check so both branches return it.

### Pitfall 4: `applyRunEvaluation` Does Not Recompute Health

**What goes wrong:** `applyRunEvaluation` calls `canonicalizeRunResult({ ...result, quality, evaluation, trace, eventLog })`. The spread preserves `health` from the input result. After `canonicalizeRunResult` is updated (Pitfall 2 fix), health flows through correctly.
**Status:** Not a pitfall once Pitfall 2 is fixed — documented for clarity.
**Warning signs:** Only manifests if Pitfall 2 is not fixed.

### Pitfall 5: `turnRange` AND `costRange` Interaction

**What goes wrong:** A filter with both `turnRange` and `costRange` produces results that survive both predicates. A `TurnEvent` must be in the turn range AND have `cost.usd` in the cost range — which is the correct AND semantics.
**How to avoid:** Process predicates in sequence on the same `result` array. The current filter pattern handles this correctly.

### Pitfall 6: Frozen Fixture Must Be Committed, Not Bootstrapped

**What goes wrong:** Following the Phase 6 `provenance-event-v1.json` pattern of auto-bootstrapping on first run. For the anomaly fixture, auto-bootstrap on a trace with no anomalies produces an empty `anomalies` array — wrong shape for testing the record structure.
**How to avoid:** Commit `anomaly-record-v1.json` with explicit known-good records for all four anomaly codes as part of the Wave 0 plan. The test compares immediately against the fixture, does not bootstrap.

---

## Code Examples

### `canonicalizeRunResult` Update (REQUIRED)

```typescript
// Source: [VERIFIED: src/runtime/defaults.ts lines 584-608 — must add health field]
// Current function enumerates RunResult fields; health must be added:
const canonicalResult = {
  accounting: canonicalizeSerializable(result.accounting),
  cost: canonicalizeSerializable(result.cost),
  ...(result.evaluation !== undefined ? { evaluation: canonicalizeSerializable(result.evaluation) } : {}),
  eventLog,
  health: canonicalizeSerializable(result.health),  // Phase 7 addition
  metadata: canonicalizeSerializable(result.metadata),
  output: result.output,
  ...(result.quality !== undefined ? { quality: canonicalizeSerializable(result.quality) } : {}),
  trace,
  transcript: trace.transcript,
  usage: canonicalizeSerializable(result.usage)
};
```

### Engine Result Construction Attach Points

```typescript
// Source: [VERIFIED: src/runtime/engine.ts lines 721-732] — run path
const runResult = {
  ...result,
  accounting: createRunAccounting({ ... }),
  eventLog: createRunEventLog(trace.runId, trace.protocol, events),
  trace,
  health: computeHealth(trace, DEFAULT_HEALTH_THRESHOLDS)  // Phase 7 addition
};
// then: return canonicalizeRunResult(await abortLifecycle.run(applyRunEvaluation(runResult, ...)))

// Source: [VERIFIED: src/runtime/engine.ts lines 932-958] — replay path
const baseResult = {
  output: trace.finalOutput.output,
  eventLog: ...,
  trace,
  // ... other fields ...
  health: computeHealth(trace, DEFAULT_HEALTH_THRESHOLDS)  // Phase 7 addition — before lastEvent check
};
if (lastEvent?.type !== "final") {
  return baseResult;  // health already present
}
return {
  ...baseResult,
  ...(lastEvent.quality !== undefined ? { quality: lastEvent.quality } : {}),
  ...(lastEvent.evaluation !== undefined ? { evaluation: lastEvent.evaluation } : {})
};
```

### Subpath Export Pattern

```json
// Source: [VERIFIED: package.json — existing runtime subpaths follow this exact pattern]
"./runtime/introspection": {
  "types": "./dist/runtime/introspection.d.ts",
  "import": "./dist/runtime/introspection.js",
  "default": "./dist/runtime/introspection.js"
},
"./runtime/health": {
  "types": "./dist/runtime/health.d.ts",
  "import": "./dist/runtime/health.js",
  "default": "./dist/runtime/health.js"
}
```

The `files` allowlist uses glob `"dist/runtime/*.js"` etc. — new files in `src/runtime/` are automatically covered. [VERIFIED: package.json lines 126-130]

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| No typed event filter | `queryEvents()` with discriminant overloads | Callers can narrow without casts |
| Health signals only in trace (manual parse) | `result.health` auto-computed | Machine-readable diagnostics on every result |
| `provider-error-recovered` undetectable in Phase 7 | Deferred to future phase with event-shape change window | Consistent with milestone invariant |

---

## Open Questions

1. **`provider-error-recovered` scope in Phase 7**
   - What we know: No trace signal exists; adding one requires an event-shape change which STATE.md prohibits for phases other than Phase 6. [VERIFIED]
   - What's unclear: Whether user will waive the "only Phase 6 is event-shape change" invariant to get detection in Phase 7.
   - Recommendation: Default to Option C (no emission). User should confirm in discuss-phase if they want Option A (requires explicit STATE.md waiver).

2. **`turnRange` global vs per-agent semantics**
   - What we know: `TurnEvent` has no `turnIndex` field. [VERIFIED: src/types/events.ts]
   - What's unclear: Whether the user expects global (cross-agent) 1-based position or per-agent turn counting.
   - Recommendation: Global. [ASSUMED]

3. **Type placement for `RunHealthSummary`, `HealthAnomaly`, `AnomalyCode`**
   - What we know: `RunResult` is in `src/types.ts`; public-surface types live there. `RetryPolicy` lives in `src/runtime/retry.ts` (module-local).
   - Recommendation: `RunHealthSummary`, `HealthAnomaly`, `AnomalyCode` in `src/types.ts` (since `result.health` is a public `RunResult` field). `EventQueryFilter` and `HealthThresholds` in their respective runtime modules. [ASSUMED]

4. **`canonicalizeRunResult` update is confirmed required**
   - Verified: function enumerates fields explicitly at `defaults.ts` lines 594–605. `health` MUST be added.
   - No open question — this is a known required change.

5. **`runawyTurns` typo in CONTEXT.md D-08**
   - What we know: CONTEXT.md D-08 uses `runawyTurns` (missing 'a'). The intended field is `runawayTurns`.
   - What's unclear: Whether to implement with the typo (for fidelity to CONTEXT) or correct it to `runawayTurns` in the TypeScript interface.
   - Recommendation: Implement as `runawayTurns` (corrected). The typo in CONTEXT is a transcription error. [ASSUMED]

---

## Phase 6 Dependency Status

Phase 6 is actively executing. Plan 06-01 is **complete** (type shapes mutated: `startedAt`/`completedAt`/`modelId` on `ModelRequestEvent`/`ModelResponseEvent`). Plans 06-02 through 06-06 are **pending** (event emission, replay synthesis, `provenance.ts` subpath module, test contracts, CHANGELOG). [VERIFIED: STATE.md, 06-01-SUMMARY.md]

Phase 7 planning can proceed now. Phase 7 **execution** must wait for Phase 6 to complete. The Phase 6 `/runtime/provenance` module (`src/runtime/provenance.ts`) does not exist yet — it is the structural template for Phase 7 subpath modules. Phase 7 should cite its pattern but not import from it.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (existing) |
| Config file | Auto-discovered (no explicit vitest.config.*) |
| Quick run command | `pnpm vitest run src/runtime/introspection.test.ts src/runtime/health.test.ts` |
| Full suite command | `pnpm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INTR-01 | `queryEvents` filters by type, agentId, turnRange, costRange | unit | `pnpm vitest run src/runtime/introspection.test.ts` | ❌ Wave 0 |
| INTR-02 | Filtered return type matches discriminant — no cast at call site | unit (type-level) | `pnpm run typecheck` | ❌ Wave 0 |
| HLTH-01 | `result.health` present on `RunResult`; anomaly codes fire correctly | unit + contract | `pnpm vitest run src/runtime/health.test.ts src/tests/result-contract.test.ts` | ❌ Wave 0 |
| HLTH-02 | `replay(trace).health` equals `computeHealth(trace, DEFAULT_HEALTH_THRESHOLDS)` | unit | `pnpm vitest run src/tests/result-contract.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm run typecheck && pnpm vitest run <affected-test-file>`
- **Per wave merge:** `pnpm run test`
- **Phase gate:** `pnpm run verify` green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/runtime/introspection.test.ts` — unit tests: type filter, agentId filter, turnRange (global index), costRange, combined filters, empty filter, no-match filter
- [ ] `src/runtime/health.test.ts` — unit tests: all four anomaly codes (runaway-turns, budget-near-miss, empty-contribution, provider-error-recovered suppressed), budget pct non-null, budget pct null when no cap, threshold suppression for runaway/near-miss
- [ ] `src/tests/fixtures/anomaly-record-v1.json` — explicitly committed with four records (one per anomaly code, all fields)
- [ ] `src/tests/health-shape.test.ts` (or inline in `result-contract.test.ts`) — frozen fixture comparison that fails on any field addition/rename

---

## Security Domain

No applicable ASVS categories. This phase adds pure-TS data-shape additions (a filter function and a trace-analysis function). No auth paths, no input from external sources, no cryptographic operations, no network calls. [VERIFIED: phase description and all locked decisions]

---

## Project Constraints (from CLAUDE.md + STATE.md)

**From CLAUDE.md:**
- **Pure TypeScript runtime.** `src/runtime/introspection.ts` and `src/runtime/health.ts` must have zero Node-only imports.
- **ESM with explicit `.js` extensions** in relative imports.
- **Strict TS:** `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`. All new types must satisfy these.
- **`readonly` preference** on new types.
- **Public-surface lockstep:** Adding `result.health` to `RunResult`, two new subpaths, `queryEvents` API — all must update `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, `src/tests/package-exports.test.ts`, `package.json` exports+files, `CHANGELOG.md`, and `CLAUDE.md` cross-cutting invariants in lockstep.
- **New subpath exports** must match the established pattern (types + import + default) and appear in `package-exports.test.ts`.
- **Conventional Commit subjects** (`feat:`, `docs:`).
- **Two-space indent, double quotes, semicolons.**

**From STATE.md (milestone-level invariant):**
- **"Phase 6 (Provenance) is the only event-shape change."** Phase 7 must not mutate existing event type shapes. Adding fields to `RunEvent` members is an event-shape change requiring an explicit user waiver. This directly constrains the `provider-error-recovered` implementation (see Critical Research Finding).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `provider-error-recovered` should be excluded from auto-compute (Option C) to respect STATE.md invariant | Critical Research Finding | If user waives the invariant, Option A must be planned — adds `ModelResponseEvent.recoveredErrors?` and new engine threading |
| A2 | `turnRange` uses global 1-based position of agent-turn events in `events[]` | Architecture Patterns | If per-agent is preferred, filter logic and documentation change |
| A3 | `RunHealthSummary`, `HealthAnomaly`, `AnomalyCode` belong in `src/types.ts` | Architecture Map | If module-local is preferred, `RunResult.health` type import changes |
| A4 | `runawyTurns` typo in CONTEXT.md D-08 should be corrected to `runawayTurns` in implementation | User Constraints (D-08) | If typo must be preserved verbatim, `HealthThresholds.runawayTurns` becomes `HealthThresholds.runawyTurns` |

---

## Sources

### Primary (HIGH confidence)
- `src/runtime/retry.ts` — verified: `withRetry` retry loop is invisible to event log; `onRetry` is side-effect only
- `src/runtime/model.ts` — verified: `generateModelTurn` has no retry-awareness; no emit around retry loop
- `src/runtime/engine.ts` lines 700–959 — verified: `runNonStreamingProtocol` result construction and `replay()` base result construction; `applyRunEvaluation` spread pattern
- `src/runtime/defaults.ts` lines 584–608 — verified: `canonicalizeRunResult` enumerates RunResult fields explicitly (does NOT spread); `health` must be added
- `src/runtime/defaults.ts` lines 200–221 — verified: `createRunAccounting` budget utilization formula
- `src/types/events.ts` — verified: `RunEvent` union members (17 types), `TurnEvent.cost`, `BroadcastEvent.cost`, no `turnIndex` field, `agentId` presence per event type
- `src/types.ts` lines 1443–1500 — verified: `CostSummary.usd`, `Budget.maxUsd`, `RunAccounting`
- `package.json` lines 31–166 — verified: subpath export pattern; `dist/runtime/*.js` glob covers new files automatically
- `STATE.md` — verified: "Phase 6 (Provenance) is the only event-shape change" as milestone-level decision
- `06-01-SUMMARY.md` — verified: Phase 6 Plan 01 complete; plans 02–06 pending

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions D-01 through D-11 — authoritative user decisions for Phase 7

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; TypeScript patterns are standard
- Architecture: HIGH — engine attach points verified in source; filter logic is straightforward
- `provider-error-recovered` finding: HIGH — verified from source; conclusion is definitive
- `canonicalizeRunResult` finding: HIGH — verified from source; mandatory change is definitive
- Pitfalls: HIGH — all verified from source code

**Research date:** 2026-05-01
**Valid until:** 2026-05-31 (stable TypeScript patterns; Phase 6 completion may affect `model-response` shape)
