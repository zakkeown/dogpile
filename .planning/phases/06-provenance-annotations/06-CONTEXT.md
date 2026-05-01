# Phase 6: Provenance Annotations - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Add structured provenance metadata (modelId, providerId, callId, ISO-8601 startedAt/completedAt) to `model-request` and `model-response` events in every completed trace. Start emitting these event types as real runtime events for the first time. Ship a new `/runtime/provenance` subpath with a `getProvenance()` helper and a frozen fixture test that protects the shape going forward.

This phase does NOT add health diagnostics, introspection query API, OTEL spans, or metrics — those are Phases 7–10.

</domain>

<decisions>
## Implementation Decisions

### modelId vs providerId (Q-01, Q-02, Q-03)

- **D-01: modelId and providerId are distinct concepts.** `provider.id` = adapter identity (e.g., `"openai-compatible"`); `modelId` = the specific model being called (e.g., `"gpt-4o"`). Both appear in provenance.
- **D-02: `modelId` comes from a new optional field on `ConfiguredModelProvider`.** `ConfiguredModelProvider` gains `readonly modelId?: string`. This is a public API addition — callers who want model-level granularity set it; adapters (openai-compatible, Vercel AI internal) should populate it from their constructor arg. `src/tests/package-exports.test.ts` must be updated.
- **D-03: `modelId` is always non-optional on events.** Runtime substitutes `provider.id` (i.e., `providerId`) when `provider.modelId` is absent. Events never have an undefined/absent `modelId` field — callers can always read it without a presence check.

### Event Emission (Q-04, Q-05)

- **D-04: `model-request` and `model-response` events are now real runtime events.** They are emitted by the runtime and appear in `trace.events` and the streaming event log. This activates event types that were previously typed-but-silent in the RunEvent union.
- **D-05: Sequence per turn: `role-assignment` → `model-request` → [`model-output-chunk`*] → `model-response` → `agent-turn`.** `model-request` is emitted immediately before the provider call begins. `model-response` is emitted immediately after the provider returns (before `agent-turn` is constructed). This applies to all four protocols.
- **D-06: This is a potentially breaking behavioral change.** Callers with exhaustive switches over `RunEvent.type` without a default may now hit these cases. CHANGELOG v0.5.0 must include a migration note: "model-request and model-response events are now emitted; update exhaustive switches if you relied on them never appearing." (Pattern matches how v0.4.0 handled `sub-run-*`.)

### Timestamp Shape (Q-06, Q-07)

- **D-07: `ModelRequestEvent` drops `at` and uses `startedAt: string` instead.** `startedAt` = ISO-8601 timestamp captured immediately before the provider call. All other event types keep `at`. This is a breaking shape change on `ModelRequestEvent` — `event-schema.test.ts` and `result-contract.test.ts` must be updated.
- **D-08: `ModelResponseEvent` drops `at` and carries both `startedAt: string` and `completedAt: string`.** `startedAt` = same value as the paired `model-request.startedAt` (threaded through from call start); `completedAt` = ISO-8601 timestamp after the provider call returns. Consumers can compute call duration from a single event. `callId` ties the two events together for consumers who join them.

### Alignment with trace.providerCalls (Q-08, Q-09)

- **D-09: Events and providerCalls are both canonical, serving different use-cases.** Events = streaming/real-time visibility + event-log queries (Phase 7 introspection). `trace.providerCalls` (`ReplayTraceProviderCall`) = replay anchor, full request/response bodies, audit (Phase 8). The runtime keeps them in sync — they carry the same callId, modelId, providerId, startedAt, completedAt.
- **D-10: `modelId` is added to `ReplayTraceProviderCall`.** `ReplayTraceProviderCall` gains `readonly modelId: string` (non-optional, same fallback rule as events). This is a public surface change on the replay type — add to CHANGELOG.
- **D-11: During `replay()`, model-request/response events are re-derived from `trace.providerCalls`.** `providerCalls` is the canonical replay anchor. On replay, the engine synthesizes `ModelRequestEvent` / `ModelResponseEvent` entries from each `ReplayTraceProviderCall` (matched by callId) rather than replaying raw stored events. This ensures provenance fields in replay are identical to the originals (PROV-02) while keeping providerCalls as the single authoritative source.

### Public Surface (Q-10, Q-11, Q-12, Q-13, Q-14)

- **D-12: Phase 6 ships a new `/runtime/provenance` subpath export.** The module exports: `getProvenance(event: ModelRequestEvent | ModelResponseEvent): ProvenanceRecord`, and the `ProvenanceRecord` type. `package.json` `exports` and `files` allowlist, `src/tests/package-exports.test.ts`, and CHANGELOG must all be updated.
- **D-13: A frozen JSON fixture protects the provenance event shape.** `src/tests/fixtures/provenance-event-v1.json` is added. Tests reject any shape change that isn't accompanied by an explicit fixture update — same protection pattern as AUDT-02 (Phase 8).
- **D-14: CHANGELOG migration note required.** v0.5.0 CHANGELOG entry must include: behavioral addition (model-request/response now emitted), breaking shape change on `ModelRequestEvent`/`ModelResponseEvent` (drop `at`, add `startedAt`/`completedAt`), new optional `ConfiguredModelProvider.modelId`, new `modelId` on `ReplayTraceProviderCall`, and new `/runtime/provenance` subpath.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and Roadmap
- `.planning/ROADMAP.md` — Phase 6 goal, success criteria, and PROV-01/PROV-02 requirement refs
- `.planning/REQUIREMENTS.md` — Full PROV-01 and PROV-02 requirement text, traceability table
- `.planning/PROJECT.md` — Milestone goal, constraints, key decisions table, public-surface invariants
- `.planning/STATE.md` — Accumulated decisions; note "Phase 6 (Provenance) is the only event-shape change"

### Prior Phase Context
- `.planning/phases/05-documentation-changelog/05-CONTEXT.md` — Canonical refs format, public-surface chain pattern

### Existing Type Definitions (MUST read before modifying)
- `src/types/events.ts` lines 67–115 — Current `ModelRequestEvent` and `ModelResponseEvent` definitions (these change in Phase 6)
- `src/types/replay.ts` lines 177–200 — `ReplayTraceProviderCall` definition (gains `modelId`)
- `src/types.ts` lines 884–910 — `ConfiguredModelProvider` interface (gains `modelId?`)

### Runtime Emission Points (MUST read to know where to add emit calls)
- `src/runtime/model.ts` — `generateModelTurn()` and `recordProviderCall()`: where `startedAt` is captured and where new emit calls go
- `src/runtime/sequential.ts` lines 63–90 — `emit()` function, `providerCalls` accumulator, turn loop
- `src/runtime/coordinator.ts` lines 238, 639–664 — `providerCalls` accumulator in coordinator and broadcast paths
- `src/runtime/broadcast.ts` lines 66, 131–207 — broadcast protocol providerCalls slots

### Replay Path (MUST read to implement D-11)
- `src/runtime/engine.ts` lines 710–735 — `replay()` implementation: how it reconstitutes events and the result shape
- `src/runtime/defaults.ts` lines 305–320 — `model-request`/`model-response` cases in `createReplayTraceBudgetStateChanges` (currently returns `[]`)

### Public Surface Gates (MUST update in lockstep)
- `src/tests/event-schema.test.ts` — ModelRequestEvent/ModelResponseEvent schema assertions
- `src/tests/result-contract.test.ts` — providerCalls shape assertions
- `src/tests/package-exports.test.ts` — new `/runtime/provenance` subpath must be added
- `CHANGELOG.md` — migration note, breaking shape change, new surface
- `CLAUDE.md` — public-surface invariant chain (all gates must move together)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/runtime/model.ts: generateModelTurn()` — already captures `startedAt` at line 26 and `completedAt` via `recordProviderCall()`. The emit points for `model-request` (before provider call) and `model-response` (after) slot in here with minimal restructure.
- `src/runtime/model.ts: GenerateModelTurnOptions` — already has `emit`, `callId`, `runId`, `agent`, `model` — all fields needed to build `ModelRequestEvent` and `ModelResponseEvent`.
- `src/types/events.ts: ModelRequestEvent / ModelResponseEvent` — types are defined and in the RunEvent union already; only field changes needed (drop `at`, add `startedAt` / `completedAt`, add `modelId`).
- `src/tests/fixtures/consumer-type-resolution-smoke.ts` lines 105–106 — already handles `model-request`/`model-response` cases in its exhaustive switch; no update needed there.

### Established Patterns
- **`at` on all other events** — keep `at` on every event type except `ModelRequestEvent` and `ModelResponseEvent`. Those two get `startedAt`/`completedAt` instead (D-07, D-08). The type union already uses discriminants — `exactOptionalPropertyTypes` will catch inconsistencies at compile time.
- **Non-optional fallback pattern** — the existing pattern (e.g., `provider.metadata?.locality` with a runtime fallback) shows how to safely read optional provider fields. Same pattern for `provider.modelId ?? provider.id`.
- **`nextProviderCallId(runId, providerCalls)`** — already called at each emit point; `callId` ties `ModelRequestEvent`, `ModelResponseEvent`, and `ReplayTraceProviderCall` together. No change needed.
- **`onProviderCall` callback in `GenerateModelTurnOptions`** — already threads `startedAt`/`completedAt` into `ReplayTraceProviderCall`. Phase 6 adds `modelId` to this call record and also emits the new events before/after the provider call.

### Integration Points
- **All four protocol files** (`sequential.ts`, `broadcast.ts`, `coordinator.ts`, and `shared.ts`) pass `emit` into `generateModelTurn`. The new event emission happens inside `generateModelTurn` / `recordProviderCall` — protocols don't change, only `model.ts` does (and `GenerateModelTurnOptions` types).
- **replay() in `engine.ts`** — must be updated to synthesize `ModelRequestEvent`/`ModelResponseEvent` from `trace.providerCalls` entries rather than relying on stored events. The `createReplayTraceBudgetStateChanges` dispatch in `defaults.ts` already has no-op cases for these event types.
- **`/runtime/provenance` module** — new file `src/runtime/provenance.ts`, exported via new subpath. Must be pure TS with no Node-only deps (same runtime constraint as all `src/runtime/` files).

</code_context>

<specifics>
## Specific Ideas

- `ProvenanceRecord` type: `{ modelId: string; providerId: string; callId: string; startedAt: string; completedAt: string }` — the normalized shape that `getProvenance()` returns. `completedAt` is only meaningful on `ModelResponseEvent`; on `ModelRequestEvent`, `completedAt` is absent or undefined (the function signature handles this via overloads or a union return type — researcher should investigate best pattern).
- Frozen fixture file: `src/tests/fixtures/provenance-event-v1.json` — include one `ModelRequestEvent` and one `ModelResponseEvent` example with all fields present. Test must fail if any field name changes or new fields are added without a fixture update.
- The `modelId` fallback in the runtime: `provider.modelId ?? provider.id`. This value is used in both the emitted events and the `ReplayTraceProviderCall` record. Define a single helper or inline expression to keep them consistent.

</specifics>

<deferred>
## Deferred Ideas

- `getProvenance()` return type for `ModelRequestEvent` (no `completedAt`) — researcher should determine whether to use overloads, a union, or a `completedAt?: string` optional. This is an implementation detail for the planner, not a user decision.
- Whether the Vercel AI internal adapter (`src/internal/vercel-ai.ts`) should populate `modelId` from `model.modelId` on the Vercel AI LanguageModel — this is a natural fit but internal-only and the researcher should confirm feasibility.
- Per-turn health streaming — deferred to v0.6.0+ per REQUIREMENTS.md future list.

</deferred>

---

*Phase: 6-Provenance Annotations*
*Context gathered: 2026-05-01*
