# Phase 6: Provenance Annotations - Research

**Researched:** 2026-05-01
**Domain:** TypeScript event-shape mutation, runtime emission, replay synthesis, public subpath export
**Confidence:** HIGH

## Summary

Phase 6 adds structured provenance metadata to `model-request` and `model-response` events, activates those events as real runtime emissions for the first time, and ships a new `/runtime/provenance` subpath. All decisions are locked in CONTEXT.md. The work is purely internal to the existing `src/runtime/` and `src/types/` files — zero new libraries, no external dependencies.

The implementation splits into four layers: (1) type changes on `ModelRequestEvent`, `ModelResponseEvent`, `ReplayTraceProviderCall`, and `ConfiguredModelProvider`; (2) emission plumbing in `generateModelTurn` and `recordProviderCall` in `src/runtime/model.ts`; (3) `replay()` synthesis of model-request/response events from `providerCalls` in `src/runtime/engine.ts`; (4) a new `src/runtime/provenance.ts` module with `getProvenance()` and the `ProvenanceRecord` type.

All public-surface gates must move together: five existing test files, two JSON fixtures, `package.json` exports/files, `CHANGELOG.md`, and `CLAUDE.md` invariant chain.

**Primary recommendation:** Implement in `src/runtime/model.ts` first (the single emission point for all four protocols), then update types, then write `replay()` synthesis, then add the subpath. This ordering validates each layer before the next depends on it.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `modelId` and `providerId` are distinct concepts. `provider.id` = adapter identity; `modelId` = specific model. Both appear in provenance.
- **D-02:** `ConfiguredModelProvider` gains `readonly modelId?: string`. Callers who want model-level granularity set it; adapters should populate it from their constructor arg.
- **D-03:** `modelId` is always non-optional on events. Runtime substitutes `provider.id` when `provider.modelId` is absent via `provider.modelId ?? provider.id`.
- **D-04:** `model-request` and `model-response` events are now real runtime events emitted in `trace.events` and the streaming event log.
- **D-05:** Sequence per turn: `role-assignment` → `model-request` → [`model-output-chunk`*] → `model-response` → `agent-turn`. `model-request` emitted before provider call; `model-response` emitted after provider returns.
- **D-06:** This is a potentially breaking behavioral change. CHANGELOG v0.5.0 must include migration note.
- **D-07:** `ModelRequestEvent` drops `at` and uses `startedAt: string` instead.
- **D-08:** `ModelResponseEvent` drops `at` and carries both `startedAt: string` and `completedAt: string`. Both events gain `modelId: string`.
- **D-09:** Events and `providerCalls` are both canonical, serving different use-cases. Runtime keeps them in sync with same `callId`, `modelId`, `providerId`, `startedAt`, `completedAt`.
- **D-10:** `ReplayTraceProviderCall` gains `readonly modelId: string` (non-optional).
- **D-11:** During `replay()`, model-request/response events are re-derived from `trace.providerCalls`. `providerCalls` is the canonical replay anchor.
- **D-12:** New `/runtime/provenance` subpath export. Module exports `getProvenance(event)` and `ProvenanceRecord` type.
- **D-13:** Frozen JSON fixture `src/tests/fixtures/provenance-event-v1.json` protects the provenance event shape.
- **D-14:** CHANGELOG migration note required covering all surface changes.

### Claude's Discretion

- `getProvenance()` return type for `ModelRequestEvent` (no `completedAt`) — researcher should determine whether to use overloads, a union, or `completedAt?: string` optional.
- Whether the Vercel AI internal adapter should populate `modelId` from `model.modelId` — researcher should confirm feasibility.

### Deferred Ideas (OUT OF SCOPE)

- Per-turn health streaming
- Health diagnostics, introspection query API, OTEL spans, metrics (Phases 7–10)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROV-01 | Caller can read provenance metadata (model id, provider id, call id, ISO-8601 start/end timestamps) on model-request and model-response events in a completed trace | New fields on both event types; `getProvenance()` helper normalizes the read; frozen fixture enforces shape |
| PROV-02 | Provenance fields are JSON-serializable and survive a round-trip through `replay()` | `Date.prototype.toISOString()` produces strings; D-11 replay synthesis from `providerCalls` guarantees identical fields on round-trip |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Emit model-request/response events | API / Runtime (`model.ts`) | — | All four protocols delegate to `generateModelTurn`; single emission point handles all protocols without per-protocol changes |
| Timestamp capture | API / Runtime (`model.ts`) | — | `startedAt` already captured at line 26; `completedAt` captured after provider returns in `recordProviderCall` |
| modelId resolution | API / Runtime (`model.ts`) | Types (`types.ts`) | `provider.modelId ?? provider.id` fallback is a runtime expression; the optional field lives on `ConfiguredModelProvider` |
| Replay synthesis | API / Runtime (`engine.ts`) | — | `replay()` reconstructs model-request/response events from `trace.providerCalls` as the canonical anchor |
| Public helper | New subpath (`provenance.ts`) | — | Pure TS module; no Node-only deps; returns normalized `ProvenanceRecord` from either event type |
| Shape protection | Test layer (`src/tests/`) | — | Frozen fixture test pattern (same as `replay-trace-v0_3.json`) rejects unannounced shape changes |

## Standard Stack

No new dependencies. This phase uses only existing runtime primitives:

- **Timestamp:** `new Date().toISOString()` — cross-runtime (Node 22+, Bun, browser ESM). `perf_hooks` / `process.hrtime` are explicitly out of scope per REQUIREMENTS.md. [VERIFIED: codebase — `model.ts:26` already uses this pattern]
- **callId correlation:** `nextProviderCallId(runId, providerCalls)` — already called at each emit point; ties `ModelRequestEvent`, `ModelResponseEvent`, and `ReplayTraceProviderCall` together. [VERIFIED: codebase — `src/runtime/sequential.ts:172` and others]
- **TypeScript compiler:** Strict mode with `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`. [VERIFIED: tsconfig.json]

## Architecture Patterns

### System Architecture Diagram

```
Provider call in generateModelTurn()
         |
         v
  capture startedAt           <- new Date().toISOString()
         |
         v
  emit ModelRequestEvent      <- NEW: before provider call
  { type, runId, callId, providerId, modelId, startedAt, agentId, role, request }
         |
         v
  model.generate() / model.stream()
         |
         v
  capture completedAt         <- new Date().toISOString() in recordProviderCall()
         |
         v
  emit ModelResponseEvent     <- NEW: after provider call
  { type, runId, callId, providerId, modelId, startedAt, completedAt, agentId, role, response }
         |
         v
  onProviderCall({... modelId, startedAt, completedAt })  <- ReplayTraceProviderCall gains modelId
         |
         v
  emit agent-turn             <- unchanged
         |
         v
────────────────────────────────────────────
  replay(trace)
         |
         v
  for each trace.providerCalls entry      <- canonical anchor
         |
         v
  synthesize ModelRequestEvent + ModelResponseEvent  <- D-11: not from stored trace.events
         |
         v
  return RunResult with same events shape <- PROV-02 satisfied
```

### Recommended Project Structure

```
src/
├── types/
│   └── events.ts          # ModelRequestEvent/ModelResponseEvent: drop `at`, add startedAt/completedAt/modelId
├── types.ts               # ConfiguredModelProvider gains modelId?
├── types/
│   └── replay.ts          # ReplayTraceProviderCall gains modelId
├── runtime/
│   ├── model.ts           # Emit model-request before call; emit model-response after; pass modelId
│   ├── engine.ts          # replay() synthesizes model-request/response from providerCalls
│   └── provenance.ts      # NEW: getProvenance() + ProvenanceRecord type
├── providers/
│   └── openai-compatible.ts  # Populate modelId from constructor arg
└── tests/
    ├── event-schema.test.ts          # Update ModelRequest/ResponseEvent assertions
    ├── result-contract.test.ts       # Update providerCalls shape assertions
    ├── package-exports.test.ts       # Add /runtime/provenance subpath
    └── fixtures/
        └── provenance-event-v1.json  # NEW: frozen shape fixture
```

### Pattern 1: Event Emission in generateModelTurn

The emit call for `model-request` goes immediately before the provider call; `model-response` goes immediately after. The `startedAt` value captured at the top of the function is threaded into both events. `callId` is passed in via `GenerateModelTurnOptions` (already present).

```typescript
// Source: src/runtime/model.ts (current pattern extended)
export async function generateModelTurn(options: GenerateModelTurnOptions): Promise<ModelResponse> {
  const startedAt = new Date().toISOString();
  const modelId = options.model.modelId ?? options.model.id;  // D-03 fallback

  options.emit({
    type: "model-request",
    runId: options.runId,
    callId: options.callId,
    providerId: options.model.id,
    modelId,
    startedAt,
    agentId: options.agent.id,
    role: options.agent.role,
    request: requestForTrace(options.request)
  });

  // ... provider call ...

  options.emit({
    type: "model-response",
    runId: options.runId,
    callId: options.callId,
    providerId: options.model.id,
    modelId,
    startedAt,                           // same value as paired model-request
    completedAt: new Date().toISOString(),
    agentId: options.agent.id,
    role: options.agent.role,
    response
  });
}
```

[VERIFIED: current model.ts structure — `startedAt`, `callId`, `options.model.id`, `options.agent` are all already present]

### Pattern 2: Replay Synthesis (D-11)

`replay()` in `engine.ts` currently returns `trace` unchanged in `baseResult`. For D-11, the model-request/response events must be synthesized from `trace.providerCalls` entries rather than relying on stored events. The key insight: `trace.events` does NOT yet contain these events (only live runs will after Phase 6), so the replay path must build them from `providerCalls`.

```typescript
// Source: src/runtime/engine.ts replay() — synthesis pattern
function synthesizeProviderEvents(
  trace: Trace,
  providerCalls: readonly ReplayTraceProviderCall[]
): RunEvent[] {
  const synthesized: RunEvent[] = [];
  for (const call of providerCalls) {
    synthesized.push({
      type: "model-request",
      runId: trace.runId,
      callId: call.callId,
      providerId: call.providerId,
      modelId: call.modelId,
      startedAt: call.startedAt,
      agentId: call.agentId,
      role: call.role,
      request: call.request
    });
    synthesized.push({
      type: "model-response",
      runId: trace.runId,
      callId: call.callId,
      providerId: call.providerId,
      modelId: call.modelId,
      startedAt: call.startedAt,
      completedAt: call.completedAt,
      agentId: call.agentId,
      role: call.role,
      response: call.response
    });
  }
  return synthesized;
}
```

Note: These synthesized events must be inserted into `trace.events` in the correct position (per D-05 sequence) or the `eventLog` built from them must reflect the correct ordering. Existing traces without these events will gain them on replay — this is by design for PROV-02.

### Pattern 3: Frozen Fixture Test

The existing frozen fixture test (`replay-version-skew.test.ts`) is the precedent. [VERIFIED: codebase — `src/tests/replay-version-skew.test.ts`]

Key pattern:
1. Fixture JSON is checked into `src/tests/fixtures/`.
2. Test reads fixture from disk and does `toEqual` against live output.
3. If fixture file does not exist, test bootstraps it (write on first run, then commit).
4. Any shape change that is not accompanied by a fixture update causes `toEqual` to fail.

For `provenance-event-v1.json`: include one `ModelRequestEvent` and one `ModelResponseEvent` with all fields present. The test captures a live run with the deterministic provider and compares the events at positions matching the D-05 sequence.

### Pattern 4: getProvenance() Return Type

With `exactOptionalPropertyTypes: true`, `completedAt?: string` and `completedAt: string | undefined` are distinct — the former means the property may be absent; the latter means it must be present with the value `undefined`. This constrains the design.

**Recommendation: function overloads.** Two overloads give callers a discriminated return type with no `completedAt` on the `ModelRequestEvent` path and a `ProvenanceRecord` with `completedAt` on the `ModelResponseEvent` path:

```typescript
// Source: src/runtime/provenance.ts (new file)
export interface ProvenanceRecord {
  readonly modelId: string;
  readonly providerId: string;
  readonly callId: string;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface PartialProvenanceRecord {
  readonly modelId: string;
  readonly providerId: string;
  readonly callId: string;
  readonly startedAt: string;
}

export function getProvenance(event: ModelResponseEvent): ProvenanceRecord;
export function getProvenance(event: ModelRequestEvent): PartialProvenanceRecord;
export function getProvenance(event: ModelRequestEvent | ModelResponseEvent): ProvenanceRecord | PartialProvenanceRecord {
  const base = {
    modelId: event.modelId,
    providerId: event.providerId,
    callId: event.callId,
    startedAt: event.startedAt
  };
  if (event.type === "model-response") {
    return { ...base, completedAt: event.completedAt };
  }
  return base;
}
```

The overload approach is idiomatic in this codebase (many existing typed narrowing patterns) and avoids optional fields that `exactOptionalPropertyTypes` complicates. Two return types are explicitly named so callers can reference them without type assertions.

### Pattern 5: Vercel AI modelId Population (Deferred Feasibility)

`createVercelAIProvider()` constructs a `ConfiguredModelProvider` at `src/internal/vercel-ai.ts:213`. The Vercel AI `LanguageModel` interface exposes `readonly modelId: string` [VERIFIED: node_modules/ai/dist/index.d.ts line 44]. The adapter already reads `modelRecord.modelId` for `inferProviderId()` at line 747. Adding `modelId` to the returned object is a one-line change:

```typescript
return {
  id: providerId,
  modelId: typeof options.model === "string" ? options.model : (options.model as Record<string, unknown>).modelId as string | undefined,
  // ...
};
```

This is internal-only (not exported), so it does not affect the public surface. The question is whether the `model.modelId` is always a meaningful model name (e.g., `"gpt-4o"`) or sometimes an opaque provider ID. Based on Vercel AI SDK conventions, `model.modelId` is the caller-supplied model identifier — it is the right value to populate `ConfiguredModelProvider.modelId`. Feasibility: HIGH.

### Anti-Patterns to Avoid

- **Reading `event.at` on model-request/response in generic iteration code.** After Phase 6, these two event types no longer have `at`. Any code that reads `event.at` in a generic loop (without type-narrowing) will fail at the type-check level. See blast-radius section below.
- **Synthesizing model-request/response in replay() by replaying stored trace.events.** The stored events from pre-Phase-6 traces will not contain these events. Always derive from `providerCalls` (D-11).
- **Inserting parentRunIds on synthesized replay events without plumbing it.** The `parentRunIds` field on events is populated during streaming by the coordinator/broadcast broadcast path. Synthesized replay events should carry `parentRunIds` only if the `providerCall` record stores it — verify whether to include it.
- **Using `completedAt?: string` with exactOptionalPropertyTypes.** Using an optional property means `ProvenanceRecord.completedAt` can be structurally absent, which prevents consistent consumer access. Prefer two distinct return types (see Pattern 4).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ISO-8601 timestamps | Custom date formatter | `new Date().toISOString()` | Already used at `model.ts:26`; cross-runtime |
| callId correlation | New ID scheme | `nextProviderCallId(runId, providerCalls)` | Already assigns stable IDs; change would break existing providerCalls |
| Event shape regression protection | Manual assertion list | Frozen JSON fixture + `toEqual` pattern | Existing `replay-version-skew.test.ts` is the proven precedent |

## Common Pitfalls

### Pitfall 1: `at` Field Blast Radius in defaults.ts

**What goes wrong:** `createReplayTraceProtocolDecision()` at `defaults.ts:368` does `at: event.at` unconditionally for all event types, including `model-request` and `model-response`. After Phase 6, those two types no longer have `at`. This will be a TypeScript compile error under `strictNullChecks` + `exactOptionalPropertyTypes`.

**Why it happens:** The function dispatches on `event.type` but builds the `base` object before the switch — the `at: event.at` line is in the shared base, not in a narrowed branch.

**How to avoid:** The `model-request` and `model-response` cases already return early in `createReplayTraceBudgetStateChanges` (they return `[]`). The `createReplayTraceProtocolDecision` base construction needs an `at` that works for all event types. Options: (a) use `"at" in event ? event.at : event.startedAt` for the base `at` field; (b) add a helper `eventTimestamp(event: RunEvent): string` that extracts the appropriate timestamp; (c) use `event.startedAt` for the protocol decision `at` field on model-request/response events specifically.

**Warning signs:** TypeScript compile error on `defaults.ts:368` — `Property 'at' does not exist on type 'ModelRequestEvent'`.

Similarly, `createRunMetadata()` at `defaults.ts:239` reads `firstEvent?.at` and `lastEvent?.at`. If the first event is ever a model-request (unlikely — role-assignment comes first), this would produce `undefined`. Not a current issue but worth noting.

### Pitfall 2: ReplayTraceProtocolDecision `at` field for model-request/response

**What goes wrong:** `createReplayTraceProtocolDecision` includes `model-request` and `model-response` cases that read `event.callId`, `event.providerId`, etc. These cases will also need `at` in the base object. After Phase 6, they must use `event.startedAt` instead.

**How to avoid:** In the `base` object construction, use a discriminated value: `at: "at" in event ? event.at : event.startedAt`. This keeps the `ReplayTraceProtocolDecision.at` field consistent as an ISO-8601 timestamp across all event types.

### Pitfall 3: Ordering of synthesized events in replay()

**What goes wrong:** D-11 says events are re-derived from `providerCalls` during `replay()`. But `trace.events` is the source used for `eventLog` and all downstream consumers. If synthesized model-request/response events are interleaved into `trace.events` at the wrong positions, the event sequence visible to callers will not match D-05.

**How to avoid:** Do not mutate `trace.events`. Instead, build a new event array during replay that inserts the synthesized events in the correct positions. The `providerCalls` entries are in call order; for each `providerCall`, find the matching `agent-turn` event by `callId` association (or insert by position). The simpler approach: insert each pair immediately before the corresponding `agent-turn` event using the `callId` from each `providerCall` to find the turn event index.

**Warning signs:** `result-contract.test.ts` test for `providerCalls` will pass but the `eventLog.eventTypes` assertion will be in wrong order.

### Pitfall 4: Frozen fixture bootstrap must happen once

**What goes wrong:** The `provenance-event-v1.json` fixture uses the auto-bootstrap pattern (write on first run if absent). If the test runs before the emission plumbing is in place, it bootstraps an incomplete fixture that must be deleted and re-generated.

**How to avoid:** Implement emission in `model.ts` before writing or running the fixture test. Run `pnpm vitest run src/tests/provenance-shape.test.ts` once after emission is working; commit the generated fixture.

### Pitfall 5: `parentRunIds` on synthesized events

**What goes wrong:** `ReplayTraceProviderCall` does not currently carry `parentRunIds`. Synthesized model-request/response events during replay would not have this field, but events from live coordinator/broadcast runs do. This creates a discrepancy between live and replayed events.

**How to avoid:** For Phase 6, omit `parentRunIds` from synthesized replay events (or add `readonly parentRunIds?: readonly string[]` to `ReplayTraceProviderCall` if needed for PROV-02). Clarify in the planner that `parentRunIds` on provenance events is out of scope for Phase 6 unless needed for round-trip equality.

## Public-Surface Lockstep Chain

Every file in this chain must be updated in the same logical unit. The planner should treat these as a set, not as independent tasks:

| File | Change |
|------|--------|
| `src/types/events.ts` | `ModelRequestEvent`: drop `at`, add `startedAt: string`, add `modelId: string`; `ModelResponseEvent`: drop `at`, add `startedAt: string`, add `completedAt: string`, add `modelId: string` |
| `src/types/replay.ts` | `ReplayTraceProviderCall` gains `readonly modelId: string` |
| `src/types.ts` | `ConfiguredModelProvider` gains `readonly modelId?: string` |
| `src/runtime/model.ts` | Emit `model-request` before provider call; emit `model-response` after; add `modelId` to `recordProviderCall` |
| `src/runtime/defaults.ts` | Fix `createReplayTraceProtocolDecision` base `at` to handle events without `at` |
| `src/runtime/engine.ts` | `replay()` synthesizes model-request/response events from `trace.providerCalls` |
| `src/runtime/provenance.ts` | NEW: `getProvenance()`, `ProvenanceRecord`, `PartialProvenanceRecord` |
| `src/providers/openai-compatible.ts` | Populate `modelId` from constructor arg |
| `src/internal/vercel-ai.ts` | Populate `modelId` from `options.model.modelId` (deferred feasibility confirmed HIGH) |
| `src/tests/event-schema.test.ts` | Update `ModelRequestEvent`/`ModelResponseEvent` schema assertions |
| `src/tests/result-contract.test.ts` | Update `providerCalls` shape assertions (add `modelId`) |
| `src/tests/package-exports.test.ts` | Add `/runtime/provenance` subpath assertion |
| `src/tests/fixtures/provenance-event-v1.json` | NEW: frozen shape fixture (one request + one response) |
| `package.json` | Add `./runtime/provenance` to `exports`; add `dist/runtime/provenance.*` to `files` (covered by existing `dist/runtime/*.js` glob — verify) |
| `CHANGELOG.md` | v0.5.0 entry: behavioral addition, breaking shape, new field, new subpath |
| `CLAUDE.md` | Update cross-cutting invariants to mention `ModelRequestEvent`/`ModelResponseEvent` shape |

Note on `package.json` `files`: The existing `"dist/runtime/*.js"` glob pattern covers `dist/runtime/provenance.js`. However, the `exports` entry must be added explicitly. Also confirm `src/runtime/provenance.ts` needs to be added to the `files` array (existing source files are allowlisted individually, not by glob). [VERIFIED: current `files` array lists each `src/runtime/*.ts` file explicitly]

## Code Examples

### Existing Frozen Fixture Test Pattern (precedent for provenance-event-v1.json)

```typescript
// Source: src/tests/replay-version-skew.test.ts — exact precedent
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fixturePath = join(repoRoot, "src/tests/fixtures/provenance-event-v1.json");

describe("provenance event shape contract", () => {
  it("frozen provenance event fixture matches live emission shape", async () => {
    if (!existsSync(fixturePath)) {
      const events = await captureProvenanceEvents();
      await writeFile(fixturePath, JSON.stringify(events, null, 2) + "\n", "utf8");
    }
    const raw = await readFile(fixturePath, "utf8");
    const saved = JSON.parse(raw);
    const live = await captureProvenanceEvents();
    expect(live).toEqual(saved);
  });
});
```

### Package Exports Addition Pattern (precedent from existing subpaths)

```json
// Source: package.json exports (existing pattern for runtime/* subpaths)
"./runtime/provenance": {
  "types": "./dist/runtime/provenance.d.ts",
  "import": "./dist/runtime/provenance.js",
  "default": "./dist/runtime/provenance.js"
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `model-request`/`model-response` typed but never emitted | Both events now emitted as real runtime events | Phase 6 (this phase) | Callers with exhaustive switches must handle these cases |
| `ModelRequestEvent.at` / `ModelResponseEvent.at` | `startedAt` / `completedAt` — duration computable from single event | Phase 6 (this phase) | Breaking shape change; CHANGELOG migration note required |
| `ReplayTraceProviderCall` without `modelId` | Gains `readonly modelId: string` | Phase 6 (this phase) | Breaking change on the replay type public surface |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `dist/runtime/*.js` glob in `files` covers `provenance.js` without an explicit entry | Public-Surface Lockstep Chain | New subpath would be missing from published tarball; `pack:check` would catch this |
| A2 | `parentRunIds` is safe to omit from synthesized replay events in Phase 6 | Pitfall 5 | PROV-02 round-trip assertion might fail if test compares parentRunIds; check against live coordinator run |

## Open Questions

1. **Where exactly do synthesized events insert into `trace.events` during replay()?**
   - What we know: Current `replay()` returns `trace` unchanged; events from a live run contain role-assignment, agent-turn, final — not model-request/response (since they were never emitted before Phase 6).
   - What's unclear: For replay to return model-request/response events as part of `eventLog`, they must either be part of `trace.events` (which they won't be in older traces) or returned separately. D-11 says "synthesizes from providerCalls" — but doesn't specify whether they augment the stored `trace.events` or replace them.
   - Recommendation: For Phase 6, replay() should return a new `events` array that interleaves synthesized model-request/response events from `providerCalls` into the stored `trace.events` at the correct positions (before each `agent-turn`). This ensures PROV-02 is satisfied and old traces gain the events on replay. The planner should confirm this interpretation against PROV-02 success criteria.

2. **Does `createReplayTraceProtocolDecision` need an `at` field for model-request/response events?**
   - What we know: The function reads `event.at` unconditionally in its `base` object (line 368). After Phase 6, model-request/response no longer have `at`.
   - What's unclear: Whether `ReplayTraceProtocolDecision.at` for these event types should use `startedAt` (for model-request) or `startedAt` (for model-response, since `completedAt` is also available).
   - Recommendation: Use `startedAt` for both — it represents when the event "started" and is present on both types.

## Environment Availability

Step 2.6: SKIPPED — no external dependencies. Phase is pure TypeScript code changes within the existing repository; all tooling (pnpm, Vitest, tsc) is already validated by the project.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (from `pnpm run test`) |
| Config file | `vitest.config.ts` (inferred from `pnpm run test` = `vitest run`) |
| Quick run command | `pnpm vitest run src/tests/event-schema.test.ts` |
| Full suite command | `pnpm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROV-01 | `model-request` event has `modelId`, `providerId`, `callId`, `startedAt` fields | unit | `pnpm vitest run src/tests/event-schema.test.ts` | ✅ (needs update) |
| PROV-01 | `model-response` event has `modelId`, `providerId`, `callId`, `startedAt`, `completedAt` fields | unit | `pnpm vitest run src/tests/event-schema.test.ts` | ✅ (needs update) |
| PROV-01 | `getProvenance()` returns `ProvenanceRecord` from `ModelResponseEvent` | unit | `pnpm vitest run src/runtime/provenance.test.ts` | ❌ Wave 0 |
| PROV-01 | Provenance fields present on every model event in a completed trace | integration | `pnpm vitest run src/tests/result-contract.test.ts` | ✅ (needs update) |
| PROV-01 | Frozen fixture protects provenance event shape | contract | `pnpm vitest run src/tests/provenance-shape.test.ts` | ❌ Wave 0 |
| PROV-02 | `JSON.stringify → JSON.parse` round-trip of trace with provenance fields | unit | `pnpm vitest run src/tests/result-contract.test.ts` | ✅ (needs extension) |
| PROV-02 | `replay(trace)` returns provenance fields identical to originals | integration | `pnpm vitest run src/tests/result-contract.test.ts` | ✅ (needs extension) |

### Sampling Rate

- **Per task commit:** `pnpm vitest run src/tests/event-schema.test.ts src/tests/result-contract.test.ts`
- **Per wave merge:** `pnpm run test`
- **Phase gate:** Full suite green + `pnpm run typecheck` before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/runtime/provenance.test.ts` — unit tests for `getProvenance()` overloads and `ProvenanceRecord` shape
- [ ] `src/tests/provenance-shape.test.ts` — frozen fixture test (follows `replay-version-skew.test.ts` pattern)

## Security Domain

This phase adds timestamp strings and provider IDs to trace events. No authentication, session management, access control, or cryptography is involved. ASVS V5 (input validation) applies trivially: `modelId` and `providerId` are caller-supplied strings that pass through to events — no sanitization is needed since they are not executed or rendered in a security context. No threat patterns are introduced.

## Sources

### Primary (HIGH confidence)

- Codebase — `src/runtime/model.ts` — existing `startedAt`, `callId`, `emit`, `onProviderCall` structure
- Codebase — `src/runtime/engine.ts:920` — current `replay()` implementation (returns `trace` unchanged)
- Codebase — `src/types/events.ts:67-116` — current `ModelRequestEvent` and `ModelResponseEvent` definitions
- Codebase — `src/types/replay.ts:177-196` — current `ReplayTraceProviderCall` definition
- Codebase — `src/types.ts:884-906` — current `ConfiguredModelProvider` interface
- Codebase — `src/runtime/defaults.ts:280-400` — `createReplayTraceProtocolDecision` and `createReplayTraceBudgetStateChanges`
- Codebase — `src/tests/replay-version-skew.test.ts` — frozen fixture test precedent
- Codebase — `tsconfig.json` — `exactOptionalPropertyTypes: true` confirmed
- Codebase — `package.json` — exports and files allowlist (explicit per-file for src/runtime/*.ts)
- Codebase — `node_modules/ai/dist/index.d.ts:44` — `LanguageModel.modelId: string` confirmed
- Codebase — `src/internal/vercel-ai.ts:740-754` — `inferProviderId` already reads `modelRecord.modelId`

### Secondary (MEDIUM confidence)

- `.planning/phases/06-provenance-annotations/06-CONTEXT.md` — all locked decisions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; existing patterns verified in source
- Architecture: HIGH — single emission point in `model.ts` confirmed; all four protocols delegate to it
- Pitfalls: HIGH — blast radius of `at` removal found via grep; `defaults.ts` confirmed affected
- `getProvenance()` return type: HIGH — `exactOptionalPropertyTypes` confirmed; overload recommendation based on verified tsconfig
- Vercel AI `modelId` feasibility: HIGH — `LanguageModel.modelId` confirmed in node_modules types

**Research date:** 2026-05-01
**Valid until:** 2026-06-01 (stable domain — type system and runtime patterns are locked)
