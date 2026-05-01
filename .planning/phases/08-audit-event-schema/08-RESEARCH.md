# Phase 8: Audit Event Schema - Research

**Researched:** 2026-05-01
**Domain:** TypeScript runtime — pure function deriving a versioned audit record from a completed Trace
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `createAuditRecord(trace: Trace): AuditRecord` — input is Trace, not RunResult. Consistent with Phase 7's `computeHealth(trace)`. Callers with a live result pass `result.trace`.
- **D-02:** Exported function name is `createAuditRecord`. Exported from the new `/runtime/audit` subpath alongside the `AuditRecord` type.
- **D-03:** Subpath is `/runtime/audit`. `package.json` `exports` and `files`, `src/tests/package-exports.test.ts`, and `CHANGELOG.md` must all be updated in lockstep.
- **D-04:** Full `AuditRecord` field set: `auditSchemaVersion`, `runId`, `intent`, `startedAt`, `completedAt`, `protocol`, `tier`, `modelProviderId`, `agentCount`, `turnCount`, `outcome`, `cost`, `terminationReason?`, `agents`, `childRunIds?`.
- **D-05:** `outcome` is `AuditOutcome = { status: "completed" | "budget-stopped" | "aborted"; terminationCode?: string }`. `terminationCode` carries the `BudgetStopReason` value (see CRITICAL CORRECTION below). Derivation: FinalEvent → "completed"; BudgetStopEvent (no FinalEvent) → "budget-stopped"; otherwise → "aborted".
- **D-06:** `terminationReason?: string` is also present as a top-level field. Planner may collapse into `outcome.terminationCode` (see recommendation in Common Pitfalls).
- **D-07:** `cost` is `AuditCost = { usd: number; inputTokens: number; outputTokens: number }` — inline, independent of `CostSummary` (intentionally omits `totalTokens`).
- **D-08:** `agents` is `AuditAgentRecord[] = { id: string; role: string; turnCount: number }`. `id` and `role` from `trace.agentsUsed` (matched by id); `turnCount` from TurnEvent entries per agentId.
- **D-09:** `agentCount` from distinct `agentId` values in TurnEvent entries (not `trace.agentsUsed.length`). Counts agents that actually contributed turns.
- **D-10:** `childRunIds?: readonly string[]` — flat list from `SubRunCompletedEvent.childRunId`. Absent (not `[]`) when no sub-runs — `exactOptionalPropertyTypes` applies.
- **D-11:** Frozen fixture: single realistic coordinator run with `agentCount > 1`, at least one `agents[]` entry, `childRunIds` with one child run id, `outcome.status: "completed"`.
- **D-12:** Fixture verification: JSON `deepEqual` (runtime) + `satisfies AuditRecord` in a companion `.type-check.ts` file (compile-time via `typecheck`/`verify`).

### Claude's Discretion

None declared in CONTEXT.md. D-06 (`terminationReason` collapse) is flagged for planner decision — see recommendation in Common Pitfalls.

### Deferred Ideas (OUT OF SCOPE)

- `result.auditRecord` auto-attach — not added in Phase 8.
- `compactAuditRecord` / deduplication mode.
- Per-agent cost in `AuditAgentRecord`.
- Nested `childRuns: AuditRecord[]`.
- `terminationReason` top-level field (if collapsed to `outcome.terminationCode`).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUDT-01 | Caller can produce a versioned (`auditSchemaVersion: "1"`) audit record from a completed trace using a pure function — not auto-attached to `RunResult` | `createAuditRecord(trace: Trace): AuditRecord` — pure function, standalone subpath, all fields derivable from `Trace` |
| AUDT-02 | `AuditRecord` type is independent of `RunEvent` schema and is validated by a frozen JSON fixture test that must be explicitly updated when the schema changes | `AuditRecord` type declared standalone in `audit.ts` with no imports of RunEvent variants; protected by `audit-record-v1.json` + `deepEqual` + `satisfies` |
</phase_requirements>

---

## Summary

Phase 8 ships `createAuditRecord(trace: Trace): AuditRecord` as a pure function in a new `/runtime/audit` subpath. All fields of `AuditRecord` are derivable from the `Trace` struct without any provider calls, filesystem access, or Node-only APIs. The implementation inspects `trace.events` internally to derive outcome, cost, agentCount, turnCount, childRunIds, and per-agent records — but `AuditRecord` and its sub-types are declared standalone with no imports from event-types modules.

The primary structural pattern follows `src/runtime/provenance.ts` exactly: a small pure TS module, exported pure function(s) plus exported type(s), no Node-only deps. The same code runs on Node 22/24, Bun latest, and browser ESM.

**CRITICAL CORRECTION — CONTEXT.md D-05 is inaccurate about terminationCode values.** CONTEXT.md references `"usd-cap"` and `"turn-cap"` as `terminationCode` examples. The actual `BudgetStopReason` type in `src/types.ts:423` is `"cost" | "tokens" | "iterations" | "timeout"`. The planner must use these values when documenting the AuditRecord fixture and any test assertions.

**Primary recommendation:** `turnCount` = count of `TurnEvent` entries only (type `"agent-turn"`). `BroadcastEvent` is a round-barrier aggregate — do not count it as a turn. Collapse `terminationReason?` into `outcome.terminationCode` only — the BudgetStopReason values are already plain English; a separate human-readable string adds noise without machine value.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Audit record derivation | Backend/Library | — | Pure computation on Trace struct; no UI or persistence layer |
| AuditRecord type export | Library public surface | — | Standalone type in subpath; callers import for type checking |
| Frozen fixture protection | Test layer | — | JSON deepEqual + TypeScript satisfies in `src/tests/` |
| Package subpath wiring | Build/Package | — | package.json exports + files in lockstep with test assertions |

## Standard Stack

### Core

This phase introduces zero new library dependencies. All capabilities use the project's existing TypeScript runtime.

| Item | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| TypeScript | ≥5.x (project constraint) | Type system, `satisfies`, `readonly` | Project-standard; `satisfies AuditRecord` compile-time check requires TS 4.9+ |
| Vitest | Project-standard | Test assertions and fixture verification | Project-standard test framework |

[VERIFIED: src/types.ts, src/runtime/provenance.ts, package.json]

### Files to Create

| File | Purpose |
|------|---------|
| `src/runtime/audit.ts` | Implementation — `createAuditRecord` function + exported types |
| `src/runtime/audit.test.ts` | Co-located unit tests |
| `src/tests/audit-record-shape.test.ts` | Frozen fixture deepEqual test (mirrors provenance-shape.test.ts pattern) |
| `src/tests/fixtures/audit-record-v1.json` | Frozen shape fixture — coordinator run with agentCount > 1 |
| `src/tests/fixtures/audit-record-v1.type-check.ts` | `fixture satisfies AuditRecord` compile-time assertion |

### Files to Update (public-surface lockstep)

| File | Change |
|------|--------|
| `package.json` `exports` | Add `./runtime/audit` block |
| `package.json` `files` | Add `src/runtime/audit.ts` (alphabetically between `provenance.ts` and `retry.ts`) |
| `src/tests/package-exports.test.ts` | Both `manifest.exports` toEqual block and `manifest.files` toEqual block |
| `CHANGELOG.md` | New `createAuditRecord` API, new `/runtime/audit` subpath, new `AuditRecord` type |
| `CLAUDE.md` | Update public-surface invariant chain |

**Do NOT update:** `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts` — `AuditRecord` is independent of `RunEvent` and not auto-attached to `RunResult`.

[VERIFIED: src/tests/package-exports.test.ts lines 1106–1164, 1252–1334]

## Architecture Patterns

### System Architecture Diagram

```
caller
  |
  |  result.trace  (or stored Trace from DB)
  v
createAuditRecord(trace: Trace)
  |
  |-- trace.runId, trace.protocol, trace.tier, trace.modelProviderId
  |-- trace.inputs.intent
  |-- trace.events[0].at          --> startedAt
  |-- trace.finalOutput.completedAt  --> completedAt
  |-- trace.events (filter "agent-turn")  --> agentCount, turnCount, agents[]
  |-- trace.events (filter "final")       --> outcome.status, cost
  |-- trace.events (filter "budget-stop") --> outcome.terminationCode
  |-- trace.events (filter "sub-run-completed") --> childRunIds[]
  v
AuditRecord (standalone JSON-serializable object)
  |
  |-- deepEqual check against audit-record-v1.json (runtime)
  |-- satisfies AuditRecord (compile-time)
```

### Recommended Project Structure

```
src/
├── runtime/
│   ├── audit.ts              # new — pure function + types
│   ├── audit.test.ts         # new — co-located unit tests
│   ├── provenance.ts         # template to follow
│   └── ...
└── tests/
    ├── audit-record-shape.test.ts   # new — frozen fixture test
    └── fixtures/
        ├── audit-record-v1.json           # new — frozen fixture
        └── audit-record-v1.type-check.ts  # new — compile-time check
```

### Pattern 1: Standalone Subpath Module (from provenance.ts)

**What:** Pure TS module with no imports from Node-only APIs or external packages. Exports pure function(s) and type(s). No side effects.

**When to use:** Every new `/runtime/X` subpath in this SDK.

```typescript
// Source: src/runtime/provenance.ts (verbatim structure)
import type { ModelRequestEvent, ModelResponseEvent } from "../types.js";

export interface ProvenanceRecord { /* ... */ }

export function getProvenance(event: ModelResponseEvent): ProvenanceRecord;
export function getProvenance(event: ModelRequestEvent): PartialProvenanceRecord;
export function getProvenance(
  event: ModelRequestEvent | ModelResponseEvent
): ProvenanceRecord | PartialProvenanceRecord {
  // pure computation, no side effects
}
```

For `audit.ts`, the same pattern applies — import only from `"../types.js"` and `"../types/events.js"` (type-only imports).

### Pattern 2: exactOptionalPropertyTypes — Conditional Spread

**What:** When a field must be absent (not `undefined`) when empty, use the conditional spread pattern.

**When to use:** `childRunIds?` and `terminationReason?` on `AuditRecord`. Required by `exactOptionalPropertyTypes: true` in `tsconfig.json`.

```typescript
// Source: established SDK pattern (used in coordinator.ts, shared.ts)
const childRunIds = trace.events
  .filter((e) => e.type === "sub-run-completed")
  .map((e) => (e as SubRunCompletedEvent).childRunId);

const record: AuditRecord = {
  // ...
  ...(childRunIds.length > 0 ? { childRunIds } : {})
};
```

### Pattern 3: Outcome Derivation Order

**What:** Determine AuditOutcome status by checking for terminal events in order.

**When to use:** Always in `createAuditRecord`.

```typescript
// Source: CONTEXT.md D-05 code_context "Outcome derivation order"
const finalEvent = trace.events.find((e) => e.type === "final") as FinalEvent | undefined;
const budgetStopEvent = trace.events.find((e) => e.type === "budget-stop") as BudgetStopEvent | undefined;

const outcome: AuditOutcome = finalEvent
  ? { status: "completed" }
  : budgetStopEvent
    ? { status: "budget-stopped", terminationCode: budgetStopEvent.reason }
    : { status: "aborted" };
```

Note: `BudgetStopEvent.reason` is typed as `BudgetStopReason = "cost" | "tokens" | "iterations" | "timeout"` — not user-facing strings like "usd-cap". These are the actual terminationCode values.

### Pattern 4: Event Timestamp Derivation (startedAt / completedAt)

**What:** `Trace` has no top-level `startedAt` or `completedAt` fields. These must be derived from events or `trace.finalOutput`.

**When to use:** Building startedAt and completedAt on AuditRecord.

```typescript
// Source: src/runtime/defaults.ts lines 562–568 — eventTimestamp() pattern
// startedAt: first event's "at" field (all events have "at" except model-request/response
//   which have "startedAt"/"completedAt" — for the first event this is always a lifecycle
//   event with "at")
const firstEvent = trace.events[0];
const startedAt = firstEvent ? (firstEvent as { at?: string }).at ?? "" : "";

// completedAt: use trace.finalOutput.completedAt — always populated (even for aborted runs,
//   defaults.ts:549 populates it from eventTimestamp(event) fallback)
const completedAt = trace.finalOutput.completedAt;
```

`trace.finalOutput` is always present on Trace and always has `completedAt` (verified in `src/runtime/defaults.ts:538–559` and `src/types/replay.ts:203–214`). This is the most reliable source.

`RunMetadata.startedAt` exists on `RunResult` but NOT on `Trace`. For `startedAt`, use the first event's `at` field.

### Pattern 5: Frozen Fixture Test Structure (from provenance-shape.test.ts)

**What:** Load a JSON fixture via `readFile` + `JSON.parse` and compare key/type shape against a live run output. Do not deepEqual raw values (timestamps differ); compare structural shape only.

**When to use:** `src/tests/audit-record-shape.test.ts`

```typescript
// Source: src/tests/provenance-shape.test.ts — structure reference
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAuditRecord } from "@dogpile/sdk/runtime/audit";
import { run } from "../index.js";
import { createDeterministicModelProvider } from "../internal.js";

const fixturePath = join(/* repo root */, "src/tests/fixtures/audit-record-v1.json");

// Generate a coordinator run to get agentCount > 1, then:
// expect(Object.keys(live)).toEqual(Object.keys(saved))   // ORDER-SENSITIVE — see Pitfall 8
// expect(typeShape(live)).toEqual(typeShape(saved))
// expect(saved).toEqual(expect.objectContaining({ auditSchemaVersion: "1", runId: expect.any(String), ... }))
```

For `audit-record-v1.type-check.ts`, bare JSON imports are NOT available in this project (tsconfig uses `moduleResolution: "Bundler"`, `verbatimModuleSyntax: true`, no `resolveJsonModule`). Use an inline object that mirrors the fixture, with a `satisfies AuditRecord` assertion:

```typescript
// Source: CONTEXT.md D-12 pattern — adapted for this project's tsconfig
import type { AuditRecord } from "@dogpile/sdk/runtime/audit";

// Inline object mirrors audit-record-v1.json exactly.
// Update this object whenever the fixture changes.
// This file is never imported at runtime — it exists only for tsc --noEmit coverage.
const _fixture = {
  auditSchemaVersion: "1",
  runId: "audit-record-fixture-run-id",
  intent: "Test audit record shape",
  startedAt: "2026-05-01T00:00:00.000Z",
  completedAt: "2026-05-01T00:00:01.000Z",
  protocol: "coordinator",
  tier: "balanced",
  modelProviderId: "audit-fixture-provider",
  agentCount: 2,
  turnCount: 3,
  outcome: { status: "completed" },
  cost: { usd: 0.0003, inputTokens: 21, outputTokens: 12 },
  agents: [
    { id: "agent-1", role: "planner", turnCount: 2 },
    { id: "agent-2", role: "executor", turnCount: 1 },
  ],
  childRunIds: ["child-run-abc"],
} satisfies AuditRecord;
```

This file is covered by `tsconfig.json`'s `"include": ["src/**/*.ts"]` — no additional config needed.

### Anti-Patterns to Avoid

- **Importing RunEvent variant types into AuditRecord type declarations:** The `AuditRecord` type must have zero imports from event-type modules. Only the implementation function body should type-narrow against event discriminants.
- **Using `trace.agentsUsed.length` for agentCount:** D-09 explicitly requires distinct `agentId` values from TurnEvent entries — a coordinator may appear in `agentsUsed` without contributing a turn.
- **Using `[]` for empty childRunIds:** With `exactOptionalPropertyTypes`, setting `childRunIds: []` and `childRunIds: undefined` are different. When no sub-runs exist, the field must be absent entirely. Use the conditional spread pattern.
- **Using `CostSummary` directly in AuditRecord:** D-07 specifies an inline `AuditCost` type that omits `totalTokens`. Import `CostSummary` in the implementation body for computation, but declare `AuditCost` as a standalone interface in `audit.ts`.
- **Counting BroadcastEvent as a turn:** BroadcastEvent is a round barrier that groups TurnEvents already emitted. Counting both double-counts. Only count `TurnEvent` (type `"agent-turn"`) for `turnCount`.
- **Bare JSON import in type-check.ts:** This project's tsconfig (`moduleResolution: "Bundler"`, `verbatimModuleSyntax: true`, no `resolveJsonModule`) does not support `import fixture from "./file.json"`. Use an inline object instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event timestamp extraction | Custom timestamp parser | Pattern from `defaults.ts:562–568` | Already handles all event variants including model-request/response |
| JSON fixture loading in tests | Inline fixture objects | `readFile` + `JSON.parse` (established pattern) | Survives fixture file edits; matches provenance-shape.test.ts pattern |
| Type-only imports for RunEvent variants | Runtime `instanceof` checks | `event.type === "agent-turn"` discriminant | SDK uses discriminated unions throughout; consistent with all other event handling |

## Common Pitfalls

### Pitfall 1: CRITICAL — BudgetStopReason Values in CONTEXT.md Are Wrong
**What goes wrong:** Plans or implementations reference terminationCode values like `"usd-cap"`, `"turn-cap"`, `"time-cap"`. These do not exist.
**Why it happens:** CONTEXT.md D-05 used illustrative examples that do not match the actual type definition.
**How to avoid:** Use `BudgetStopReason = "cost" | "tokens" | "iterations" | "timeout"` from `src/types.ts:423`. These are the values that will appear in `BudgetStopEvent.reason` and therefore in `outcome.terminationCode`.
**Warning signs:** Test assertions against "usd-cap" will fail at runtime; TypeScript will not catch this if terminationCode is typed as `string`.

[VERIFIED: src/types.ts line 423]

### Pitfall 2: terminationReason Redundancy — Recommend Collapse
**What goes wrong:** Keeping both `terminationReason?: string` (top-level) and `outcome.terminationCode` creates ambiguous semantics, wider type surface, and more fixture complexity.
**Why it happens:** D-06 was flagged for resolution in CONTEXT.md.
**How to avoid:** Collapse — remove `terminationReason?` from `AuditRecord`. `outcome.terminationCode` carrying `BudgetStopReason` values is machine-readable. The BudgetStopReason values ("cost", "tokens", "iterations", "timeout") are already plain-English enough. Future phases can add a description field if callers need human strings. **Planner recommendation: do not implement `terminationReason?`.**

### Pitfall 3: startedAt is Not a Trace Top-Level Field
**What goes wrong:** Implementation tries to read `trace.startedAt` — the field does not exist on `Trace`.
**Why it happens:** `RunMetadata.startedAt` exists on `RunResult`, not `Trace`. CONTEXT.md "specifics" note mentions deriving from `RunMetadata / first event` which is ambiguous.
**How to avoid:** Derive `startedAt` from `trace.events[0].at` (all non-model-request/response events have `at`). The first event in any trace will be a lifecycle event like `role-assignment` which has `at`. For `completedAt`, use `trace.finalOutput.completedAt` — always populated.

[VERIFIED: src/types.ts Trace interface lines 1549–1603; src/types/replay.ts ReplayTraceFinalOutput lines 203–214; src/runtime/defaults.ts lines 562–568]

### Pitfall 4: agentCount vs agentsUsed.length Mismatch
**What goes wrong:** Using `trace.agentsUsed.length` for `agentCount` produces wrong count for coordinator runs where the coordinator agent delegates but never produces a turn.
**How to avoid:** Count distinct `agentId` values from `TurnEvent` entries only (events with `type === "agent-turn"`). `agentCount === agents.length` is the invariant to verify.

[VERIFIED: CONTEXT.md D-09; src/types/events.ts TurnEvent interface]

### Pitfall 5: Package-Exports Test Has Two Assertion Blocks
**What goes wrong:** Adding `./runtime/audit` to `package.json` but forgetting to update both the `manifest.exports` block and the `manifest.files` block in `package-exports.test.ts`.
**How to avoid:** `package-exports.test.ts` contains two separate `toEqual` assertions: one for `manifest.exports` (line ~1252) and one for `manifest.files` (line ~1106). Both must be updated. The `files` entry is `"src/runtime/audit.ts"` (alphabetically between `provenance.ts` and `retry.ts`).

[VERIFIED: src/tests/package-exports.test.ts lines 1106–1164, 1252–1334]

### Pitfall 6: type-check.ts Must Be in TypeScript's Scope
**What goes wrong:** `audit-record-v1.type-check.ts` is not covered by `tsc --noEmit` and the `satisfies` assertion never runs.
**How to avoid:** `tsconfig.json` `include` is `"src/**/*.ts"` which covers `src/tests/fixtures/` — the file is in scope by default. No additional configuration needed. Confirm with `pnpm run typecheck` after creating the file.

[VERIFIED: tsconfig.json line 18: `"include": ["src/**/*.ts"]`]

### Pitfall 7: BroadcastEvent Double-Count for turnCount
**What goes wrong:** Counting both `TurnEvent` and `BroadcastEvent` for `turnCount`. In a broadcast protocol, each agent contributes one `TurnEvent` per round; `BroadcastEvent` is the aggregate barrier. Counting both would produce 2x the actual turn count.
**Why it happens:** CONTEXT.md "specifics" mentions "TurnEvent + BroadcastEvent" for turnCount derivation.
**How to avoid:** Count only `TurnEvent` (type `"agent-turn"`). BroadcastEvent.contributions.length equals the number of TurnEvents per round — they are not additive.

[VERIFIED: src/types/events.ts BroadcastEvent lines 387–402, BroadcastContribution lines 341–366, TurnEvent lines 318–339]

### Pitfall 8: Fixture Key Order Must Match Implementation Output Order
**What goes wrong:** `expect(Object.keys(live)).toEqual(Object.keys(saved))` fails because the implementation assembles the return object with fields in a different order than the fixture JSON.
**Why it happens:** `Object.keys` comparison is order-sensitive. The fixture JSON defines the canonical field order. If implementation builds the return object in a different order, the key comparison fails even though all fields are present.
**How to avoid:** The return object in `createAuditRecord` must assemble fields in the exact order they appear in `audit-record-v1.json`. Use the fixture JSON field order as the specification for the return statement key order.
**Warning signs:** Key comparison test fails but `objectContaining` assertions pass — mismatch is in order, not presence.

### Pitfall 9: agents Array Ordering is Non-Deterministic Without an Explicit Sort
**What goes wrong:** The `agents[]` array is built from a `Map` keyed by `agentId`. Map insertion order follows TurnEvent order in `trace.events`. For coordinator protocols with parallel sub-agent turns, event order may differ between runs, causing the fixture's `agents` ordering to drift from live output.
**Why it happens:** Map iteration order is insertion order in JS/TS, but parallel-turn events may not always arrive in the same order.
**How to avoid:** Sort `agents` by `id` before returning: `agents.sort((a, b) => a.id.localeCompare(b.id))`. The fixture JSON `agents[]` must be sorted by `id` to match. This gives deterministic output regardless of event arrival order.

## Code Examples

### AuditRecord Type Sketch (Verified Against Source)

```typescript
// Source: CONTEXT.md D-04 + verified against src/types.ts BudgetStopReason:423

export type AuditOutcomeStatus = "completed" | "budget-stopped" | "aborted";

export interface AuditOutcome {
  readonly status: AuditOutcomeStatus;
  readonly terminationCode?: string; // BudgetStopReason: "cost" | "tokens" | "iterations" | "timeout"
}

export interface AuditCost {
  readonly usd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  // Note: intentionally omits totalTokens (CostSummary has it — AuditCost is independent)
}

export interface AuditAgentRecord {
  readonly id: string;
  readonly role: string;
  readonly turnCount: number;
}

export interface AuditRecord {
  readonly auditSchemaVersion: "1";
  readonly runId: string;
  readonly intent: string;
  readonly startedAt: string;       // from trace.events[0].at
  readonly completedAt: string;     // from trace.finalOutput.completedAt
  readonly protocol: Protocol;      // from trace.protocol ("coordinator" | "sequential" | "broadcast" | "shared")
  readonly tier: Tier;              // from trace.tier ("fast" | "balanced" | "quality")
  readonly modelProviderId: string; // from trace.modelProviderId
  readonly agentCount: number;      // distinct agentId from TurnEvent entries
  readonly turnCount: number;       // count of TurnEvent entries
  readonly outcome: AuditOutcome;
  readonly cost: AuditCost;
  readonly agents: readonly AuditAgentRecord[];
  readonly childRunIds?: readonly string[]; // absent when empty (exactOptionalPropertyTypes)
}
```

### createAuditRecord Derivation Skeleton

```typescript
// Source: synthesized from CONTEXT.md code_context + verified event shapes
import type { Protocol, Tier } from "../types.js";
import type { TurnEvent, FinalEvent, BudgetStopEvent, SubRunCompletedEvent, RunEvent } from "../types/events.js";

export function createAuditRecord(trace: Trace): AuditRecord {
  // Outcome derivation (order matters)
  const finalEvent = trace.events.find((e): e is FinalEvent => e.type === "final");
  const budgetStopEvent = trace.events.find((e): e is BudgetStopEvent => e.type === "budget-stop");

  const outcome: AuditOutcome = finalEvent
    ? { status: "completed" }
    : budgetStopEvent
      ? { status: "budget-stopped", terminationCode: budgetStopEvent.reason }
      : { status: "aborted" };

  // Cost: prefer FinalEvent (completed), then BudgetStopEvent (budget-stopped),
  // then last TurnEvent's cumulative cost (aborted runs — no terminal cost event).
  // TurnEvent.cost is cumulative after each turn, so the last one is the best estimate.
  const lastTurnEvent = [...trace.events].reverse().find((e): e is TurnEvent => e.type === "agent-turn");
  const costSource = finalEvent?.cost ?? budgetStopEvent?.cost ?? lastTurnEvent?.cost;
  const cost: AuditCost = {
    usd: costSource?.usd ?? 0,
    inputTokens: costSource?.inputTokens ?? 0,
    outputTokens: costSource?.outputTokens ?? 0
  };

  // Agents and turn count from TurnEvent entries
  const turnEvents = trace.events.filter((e): e is TurnEvent => e.type === "agent-turn");
  const agentTurnMap = new Map<string, { role: string; count: number }>();
  for (const e of turnEvents) {
    const existing = agentTurnMap.get(e.agentId);
    if (existing) { existing.count++; }
    else { agentTurnMap.set(e.agentId, { role: e.role, count: 1 }); }
  }

  // Sort by id for deterministic ordering across runs (see Pitfall 9)
  const agents: AuditAgentRecord[] = [...agentTurnMap.entries()]
    .map(([id, { role, count }]) => ({ id, role, turnCount: count }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // childRunIds from SubRunCompletedEvent
  const childRunIds = trace.events
    .filter((e): e is SubRunCompletedEvent => e.type === "sub-run-completed")
    .map((e) => e.childRunId);

  // Field order must match audit-record-v1.json exactly (see Pitfall 8)
  return {
    auditSchemaVersion: "1",
    runId: trace.runId,
    intent: trace.inputs.intent,
    startedAt: (trace.events[0] as { at?: string } | undefined)?.at ?? "",
    completedAt: trace.finalOutput.completedAt,
    protocol: trace.protocol,
    tier: trace.tier,
    modelProviderId: trace.modelProviderId,
    agentCount: agentTurnMap.size,
    turnCount: turnEvents.length,
    outcome,
    cost,
    agents,
    ...(childRunIds.length > 0 ? { childRunIds } : {})
  };
}
```

### package.json exports Block (Follow Existing Pattern)

```json
"./runtime/audit": {
  "types": "./dist/runtime/audit.d.ts",
  "import": "./dist/runtime/audit.js",
  "default": "./dist/runtime/audit.js"
}
```

[VERIFIED: src/tests/package-exports.test.ts lines 1294–1298 — existing `./runtime/provenance` block to mirror]

### Fixture JSON Structure (audit-record-v1.json)

Fields are in the order the implementation assembles them. `agents[]` is sorted by `id`.

```json
{
  "auditSchemaVersion": "1",
  "runId": "audit-record-fixture-run-id",
  "intent": "Test audit record shape",
  "startedAt": "2026-05-01T00:00:00.000Z",
  "completedAt": "2026-05-01T00:00:01.000Z",
  "protocol": "coordinator",
  "tier": "balanced",
  "modelProviderId": "audit-fixture-provider",
  "agentCount": 2,
  "turnCount": 3,
  "outcome": { "status": "completed" },
  "cost": { "usd": 0.0003, "inputTokens": 21, "outputTokens": 12 },
  "agents": [
    { "id": "agent-1", "role": "planner", "turnCount": 2 },
    { "id": "agent-2", "role": "executor", "turnCount": 1 }
  ],
  "childRunIds": ["child-run-abc"]
}
```

## Key Type Lookups (Verified)

| Type | Location | Value |
|------|----------|-------|
| `Protocol` | `src/types.ts:227` | `"coordinator" \| "sequential" \| "broadcast" \| "shared"` |
| `Tier` | `src/types.ts:257` | `"fast" \| "balanced" \| "quality"` (alias of BudgetTier) |
| `BudgetStopReason` | `src/types.ts:423` | `"cost" \| "tokens" \| "iterations" \| "timeout"` |
| `TurnEvent.type` | `src/types/events.ts:320` | `"agent-turn"` |
| `BudgetStopEvent.type` | `src/types/events.ts:414` | `"budget-stop"` |
| `BudgetStopEvent.reason` | `src/types/events.ts:422` | `BudgetStopReason` |
| `FinalEvent.type` | `src/types/events.ts:472` | `"final"` |
| `FinalEvent.cost` | `src/types/events.ts:480` | `CostSummary` (full cost at completion) |
| `SubRunCompletedEvent.type` | `src/types/events.ts:549` | `"sub-run-completed"` |
| `SubRunCompletedEvent.childRunId` | `src/types/events.ts:557` | `string` |
| `Trace.inputs.intent` | `src/types/replay.ts:46` | `string` |
| `Trace.finalOutput.completedAt` | `src/types/replay.ts:211` | `string` (ISO-8601; always populated) |
| `Trace.agentsUsed` | `src/types.ts:1561` | `readonly AgentSpec[]` |
| `AgentSpec.id/role` | `src/types.ts:696–699` | `string` |

[VERIFIED: all line references confirmed against source files]

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Provenance via `at` field on model events | Phase 6 changed to `startedAt`/`completedAt`/`modelId` | Audit must use new field names on ModelRequestEvent/ModelResponseEvent (not used for AuditRecord directly, but relevant if future audit fields use provenance) |
| `result.health` as optional | Phase 7 attaches `health` to RunResult via engine integration | No impact on Phase 8 — AuditRecord remains caller-produced |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `trace.events[0]` will always have an `at` field for `startedAt` derivation | Code Examples | If first event is a model-request, use `startedAt` field instead — handle in implementation with the eventTimestamp pattern from defaults.ts |
| A2 | `BudgetStopEvent.cost` carries the full cumulative cost at stop point | Code Examples | Cost is still reasonable for budget-stopped runs; skeleton now also falls back to last TurnEvent cost |

[A2 VERIFIED: src/types/events.ts BudgetStopEvent line 424: `readonly cost: CostSummary`]

## Open Questions

1. **`terminationReason?` top-level field — collapse or keep?**
   - What we know: CONTEXT.md D-06 keeps it; D-06 notes the planner may collapse it
   - What's unclear: user preference
   - Recommendation: Collapse. Remove `terminationReason?`. `outcome.terminationCode` carrying BudgetStopReason is sufficient for all machine consumers. If the user requires human strings, add a field in Phase 9+. This recommendation is strong enough to make it the default plan choice.

2. **type-check.ts JSON import approach**
   - What we know: This project's tsconfig uses `moduleResolution: "Bundler"`, `verbatimModuleSyntax: true`, and has no `resolveJsonModule` — bare JSON imports are not supported. The `assert { type: "json" }` syntax is also deprecated in TS 5.3+ (replaced by `with { type: "json" }`), and neither form works without `resolveJsonModule`.
   - Resolution: Use an inline object that mirrors the fixture JSON with `satisfies AuditRecord` (see Pattern 5 and the updated Code Examples section). This is fully covered by `tsconfig.json`'s `"include": ["src/**/*.ts"]` with no additional config.

[VERIFIED: tsconfig.json — no `resolveJsonModule`, `verbatimModuleSyntax: true`, `moduleResolution: "Bundler"`]

## Environment Availability

SKIPPED — Phase 8 is a pure TypeScript addition. No external tools, services, CLIs, runtimes beyond the existing Node 22+/Bun/browser target are required. All derivations use in-memory Trace structs.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (project standard) |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `pnpm vitest run src/runtime/audit.test.ts` |
| Full suite command | `pnpm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUDT-01 | `createAuditRecord(trace)` returns object with `auditSchemaVersion: "1"` and all required fields | unit | `pnpm vitest run src/runtime/audit.test.ts` | ❌ Wave 0 |
| AUDT-01 | Pure function — works on replayed trace same as live trace | unit | `pnpm vitest run src/runtime/audit.test.ts` | ❌ Wave 0 |
| AUDT-02 | AuditRecord type has no RunEvent imports in its declaration | type/lint | `pnpm run typecheck` + import graph inspection | ❌ Wave 0 |
| AUDT-02 | Frozen fixture deepEqual test rejects schema change | integration | `pnpm vitest run src/tests/audit-record-shape.test.ts` | ❌ Wave 0 |
| AUDT-02 | `satisfies AuditRecord` compile-time check | type | `pnpm run typecheck` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm vitest run src/runtime/audit.test.ts`
- **Per wave merge:** `pnpm run test`
- **Phase gate:** Full suite green + `pnpm run typecheck` before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/runtime/audit.ts` — implementation (Wave 0 or Wave 1 depending on plan structure)
- [ ] `src/runtime/audit.test.ts` — co-located unit tests
- [ ] `src/tests/audit-record-shape.test.ts` — frozen fixture deepEqual test
- [ ] `src/tests/fixtures/audit-record-v1.json` — frozen fixture
- [ ] `src/tests/fixtures/audit-record-v1.type-check.ts` — compile-time satisfies assertion (inline object, not JSON import)

## Project Constraints (from CLAUDE.md)

- **Pure TypeScript runtime:** No Node-only deps, no filesystem, no storage, no env reads in `src/runtime/`. `audit.ts` must run on Node 22/24, Bun latest, browser ESM.
- **ESM with explicit `.js` extensions** in relative imports.
- **Strict TS:** `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` are on. `childRunIds?` must be absent (not `undefined`) when empty.
- **`readonly` everywhere:** All fields on `AuditRecord`, `AuditAgentRecord`, `AuditOutcome`, `AuditCost` must be `readonly`.
- **Public-surface lockstep invariant:** Adding `/runtime/audit` subpath requires updating `package.json` exports + files + `package-exports.test.ts` + `CHANGELOG.md` + `CLAUDE.md` together.
- **Event-shape changes are public-API changes.** Phase 8 introduces no event-shape changes — AuditRecord is computed from the trace, not emitted as an event.
- **`AuditRecord` is an independent type** (per STATE.md): not derived from `RunEvent` via Pick/Omit; has its own `auditSchemaVersion: "1"`.
- **Conventional Commit subjects** (`feat:` for new API, `docs:` for CHANGELOG/CLAUDE.md updates).
- **No bare JSON imports:** `tsconfig.json` uses `moduleResolution: "Bundler"` + `verbatimModuleSyntax: true` without `resolveJsonModule`. type-check.ts must use an inline object with `satisfies AuditRecord`.

## Security Domain

Phase 8 introduces no authentication, session management, access control, or cryptography. `AuditRecord` is a plain data object — SDK produces it, callers own persistence and access control. No ASVS categories apply to this phase.

## Sources

### Primary (HIGH confidence)

- `src/types.ts` — Trace interface (lines 1549–1603), Protocol/Tier/BudgetStopReason types, AgentSpec, CostSummary, RunMetadata
- `src/types/events.ts` — TurnEvent, BroadcastEvent, FinalEvent, BudgetStopEvent, SubRunCompletedEvent, RunEvent union
- `src/types/replay.ts` — ReplayTraceRunInputs (intent), ReplayTraceFinalOutput (completedAt)
- `src/runtime/provenance.ts` — Template for standalone subpath module structure
- `src/runtime/defaults.ts` — eventTimestamp() derivation pattern (lines 562–568), createReplayTraceFinalOutput (lines 538–560)
- `src/tests/package-exports.test.ts` — manifest.exports and manifest.files assertion blocks (lines 1106–1334)
- `src/tests/provenance-shape.test.ts` — frozen fixture test pattern (readFile + JSON.parse, not JSON import)
- `tsconfig.json` — moduleResolution, verbatimModuleSyntax, include glob
- `.planning/phases/08-audit-event-schema/08-CONTEXT.md` — all locked decisions
- `.planning/phases/07-structured-event-introspection-health-diagnostics/07-CONTEXT.md` — computeHealth pattern, subpath wiring steps

### Secondary (MEDIUM confidence)

- `.planning/STATE.md` — "AuditRecord is an independent type" milestone decision
- `.planning/REQUIREMENTS.md` — AUDT-01, AUDT-02 requirement text

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new dependencies; all patterns verified in codebase
- Architecture: HIGH — verified Trace field availability and event discriminants against source
- Pitfalls: HIGH — BudgetStopReason correction is a verified fact; other pitfalls confirmed from code reading
- Public-surface lockstep: HIGH — verified all affected files and their assertion structure

**Research date:** 2026-05-01
**Valid until:** 2026-06-01 (stable SDK, no anticipated breaking changes to Trace or event shapes)
