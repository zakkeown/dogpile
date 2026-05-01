# Phase 3: Provider Locality & Bounded Concurrency - Research

**Researched:** 2026-04-30
**Domain:** TypeScript SDK runtime — provider metadata extension, bounded concurrency semaphore, array-parser unlock
**Confidence:** HIGH (all findings verified against actual source files)

## Summary

Phase 3 builds on the clean plumbing laid in Phases 1-2 to add two orthogonal capabilities: (1) a `locality` hint on `ConfiguredModelProvider` that lets the engine clamp parallel dispatch to 1 when a local provider is detected, and (2) a bounded-concurrency semaphore in the coordinator that finally activates the array-delegate path reserved in Phase 1 D-03.

All 18 locked decisions in CONTEXT.md have been verified against current source. The code is clean, purpose-built anchor points exist for every planned change (the array-throw in `decisions.ts` literally says "reserved for Phase 3"), and the Phase 2 `SubRunBudgetClampedEvent` provides the exact shape template for the two new event variants. The main complexity risks are: (a) the `parentDecisionId` collision problem that arises when N delegates from one turn all use `String(events.length - 1)`, and (b) the exhaustive switches in `defaults.ts` requiring new cases for every new `RunEvent` variant.

**Primary recommendation:** Follow the three-plan ordering from D-18 strictly. Plan 03-01 (locality type + validation) is a clean additive; 03-02 (semaphore + array parser) is the largest change and benefits from having the locality metadata already available; 03-03 (clamping event) layers on top of both with minimal delta.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** `locality` lives in a new `metadata?` object on `ConfiguredModelProvider`. Add `readonly metadata?: { readonly locality?: "local" | "remote"; }` to `ConfiguredModelProvider` (src/types.ts:876). Absent metadata/locality → treated as `remote` for clamping.

**D-02:** Auto-detect classifies broadly: loopback + RFC1918 + IPv6 ULA + link-local + `*.local` mDNS. Classifier: `classifyHostLocality(host: string): "local" | "remote"`. Fixtures: parameterize over comprehensive host list including edge cases (`127.0.0.1.example.com` → remote, `LOCALHOST` → local, `[::1]` in brackets → local).

**D-03:** Validate locality at BOTH `createOpenAICompatibleProvider` construct-time AND engine run start (defense-in-depth). Engine-time: `validateProviderLocality(provider)` in `validation.ts`, called from all entry paths.

**D-04:** Asymmetric override — explicit `"local"` always wins; explicit `"remote"` on a detected-local host throws `DogpileError({ code: "invalid-configuration", path: "locality", detail: { reason: "remote-override-on-local-host" } })`.

**D-05:** `maxConcurrentChildren` at three levels: engine (default 4), per-run, per-coordinator-decision. Effective = `min(engine, run ?? Infinity, decision ?? Infinity)`. All three must be positive integer ≥ 1.

**D-06:** Array of delegates unlocked. Parser accepts single delegate object OR fenced JSON array. Mixed participate+delegate still forbidden. `MAX_DISPATCH_PER_TURN = 8` remains the cap per plan-turn.

**D-07:** `sub-run-queued` event emitted ONLY when slot is not immediately free. Three-event timeline under pressure: `sub-run-queued` → `sub-run-started` → `sub-run-completed/failed`. No-pressure path: only `sub-run-started` → completion (no queued event).

**D-08:** Hand-rolled semaphore inside coordinator.ts (or extracted to `src/runtime/concurrency.ts`). No `p-limit`. ~30 LOC.

**D-09:** Sibling failure tolerance — let in-flight finish, drain queue with synthetic `sub-run-failed` events (`error.code: "aborted"`, `detail.reason: "sibling-failed"`), return ALL outcomes.

**D-10:** Transcript append in completion (wall-clock) order. Stable `parentDecisionId` at dispatch time. Replay reproduces same completion-order append.

**D-11:** Re-evaluate locality per `dispatchDelegate` call. Walk `options.model.metadata?.locality` plus every `agent.model.metadata?.locality`. Any local → clamp to 1.

**D-12:** `subRun.concurrencyClamped` emitted ONCE lazily (first dispatch where clamp trips). Payload: `{ requestedMax, effectiveMax: 1, reason: "local-provider-detected", providerId }`. Per-run emission flag on the run's accumulator.

**D-13:** Silent clamp (no console.warn). The event IS the warning surface.

**D-14:** Public-surface inventory (4 additions): `ConfiguredModelProvider.metadata`, `maxConcurrentChildren` config, `subRun.concurrencyClamped` event, `sub-run-queued` event. Lock in `event-schema.test.ts`, `result-contract.test.ts`, `config-validation.test.ts`, CHANGELOG v0.4.0.

**D-15:** Hybrid test org. Locality classifier → `openai-compatible.test.ts`. Locality validation throws → `config-validation.test.ts`. Concurrency dispatch + array-parser + clamp → `coordinator.test.ts`. Public event/decision locks → `event-schema.test.ts`, `result-contract.test.ts`. `sibling-failed`/`local-provider-detected` detail → `cancellation-contract.test.ts`. Promote to `concurrency-contract.test.ts` if concurrency scenarios in coordinator.test.ts exceed ~150 new LOC.

**D-16:** Three plans: 03-01 (PROVIDER-01..03), 03-02 (CONCURRENCY-01 + Phase 1 D-03 unlock), 03-03 (CONCURRENCY-02).

**D-17:** `streamHandle?: never  // STREAM-03 hook (Phase 4)` placeholder on per-child dispatch record. Zero runtime code.

**D-18:** Plan order: 03-01 → 03-02 → 03-03. Hard dependency: 03-03 needs both 03-01 and 03-02.

### Claude's Discretion

None specified in CONTEXT.md.

### Deferred Ideas (OUT OF SCOPE)

- Dynamic locality (`getLocality?()` method on provider)
- Caller-defined trees (`Dogpile.nest`)
- `p-limit` dependency
- Logger/console.warn for clamps
- Per-event coordinator escalation context for the clamp event
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROVIDER-01 | `ConfiguredModelProvider` accepts `locality?: "local" \| "remote"`, default unknown treated as remote for clamping | D-01 adds `metadata?: { locality?: "local" \| "remote" }` to `ConfiguredModelProvider` at types.ts:876; absent value = remote per clamping logic |
| PROVIDER-02 | `createOpenAICompatibleProvider` auto-sets `locality: "local"` for loopback/RFC1918; caller override respected | D-02 `classifyHostLocality()` helper + D-04 asymmetric override in `validateOptions`/factory; existing `createURL` already parses `baseURL` at line 172 |
| PROVIDER-03 | Invalid locality throws `DogpileError({ code: "invalid-configuration" })` | D-03 dual-validation: construct-time in `validateOptions` (line 132) via existing `throwInvalid` helper; engine-time via new `validateProviderLocality()` in validation.ts |
| CONCURRENCY-01 | `maxConcurrentChildren` (default 4) bounds parallel delegate execution | D-05 three-level precedence + D-08 hand-rolled semaphore; D-06 array-parser unlock activates Phase 1 D-03 reserved path in decisions.ts:94-102 |
| CONCURRENCY-02 | Local provider → clamp to 1 + emit `subRun.concurrencyClamped` | D-11 per-dispatch locality walk + D-12 lazy single-emit + D-13 silent clamp UX; new `sub-run-concurrency-clamped` event variant mirroring `SubRunBudgetClampedEvent` shape |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Provider locality type shape | Types layer (`src/types.ts`) | — | `ConfiguredModelProvider` lives here; all consumers import from this layer |
| Auto-detection of local hosts | Provider adapter (`src/providers/openai-compatible.ts`) | — | Only the bundled adapter owns a `baseURL`; custom providers set locality directly |
| Locality validation (construct-time) | Provider adapter (`openai-compatible.ts`) | — | Matches existing `validateOptions` pattern; adapter-specific concern |
| Locality validation (engine-time) | Runtime validation (`src/runtime/validation.ts`) | Engine entry (`engine.ts`) | Defense-in-depth for user-implemented providers that bypass TS; mirrors Phase 1 D-14 depth guard pattern |
| Bounded concurrency semaphore | Coordinator runtime (`src/runtime/coordinator.ts`) | Optional extraction to `src/runtime/concurrency.ts` | Semaphore is a coordinator-internal concern; extract only if >30 LOC |
| Array-delegate parser | Decision parser (`src/runtime/decisions.ts`) | — | Already has the reserved throw; unlock is targeted removal + array-path handler |
| `sub-run-queued` event emission | Coordinator runtime (`coordinator.ts`) | — | Semaphore owns the queue; queued event emitted at enqueue time |
| `subRun.concurrencyClamped` event | Coordinator runtime (`coordinator.ts`) | — | Per-dispatch locality walk lives here; single-emit flag on run accumulator |
| Exhaustive switch updates | Replay/defaults (`src/runtime/defaults.ts`) | — | Three switches require new cases for each new `RunEvent` variant |
| Public-surface test locks | Contract tests (`src/tests/`) | — | event-schema, result-contract, config-validation, cancellation-contract |

## Standard Stack

No new dependencies. Phase 3 is pure hand-rolled TypeScript per CLAUDE.md ("Dogpile is dependency-free"). [VERIFIED: CLAUDE.md, src/runtime/ has no runtime imports from node_modules]

### Core (existing — verified against actual files)

| Module | Location | Role in Phase 3 |
|--------|----------|-----------------|
| `DogpileError` | `src/types.ts` | Invalid-configuration throws for locality validation and asymmetric override |
| `ConfiguredModelProvider` | `src/types.ts:876` | Gains `metadata?: { locality?: "local" \| "remote" }` |
| `createOpenAICompatibleProvider` | `src/providers/openai-compatible.ts:66` | Gains `classifyHostLocality` helper + locality override logic |
| `validateOptions` | `src/providers/openai-compatible.ts:132` | Construct-time locality validation lands here |
| `throwInvalid` helper | `src/providers/openai-compatible.ts:159` | Existing pattern for `DogpileError({ code: "invalid-configuration" })` |
| `createURL` | `src/providers/openai-compatible.ts:172` | Already parses `baseURL` with `new URL(...)`; `classifyHostLocality` reads `.hostname` |
| `parseAgentDecision` | `src/runtime/decisions.ts:24` | Array-parser unlock: remove throw at lines 94-102, add `Array.isArray(parsed)` branch |
| `runCoordinator` dispatch loop | `src/runtime/coordinator.ts:215` | Becomes fan-out with semaphore gate |
| `dispatchDelegate` | `src/runtime/coordinator.ts:829` | Gains per-dispatch locality walk + queued-event emission |
| `validatePositiveInteger` | `src/runtime/validation.ts:696` | Reused for `maxConcurrentChildren ≥ 1` validation |
| `createReplayTraceBudgetStateChanges` | `src/runtime/defaults.ts:267` | Exhaustive switch at line 271 — needs new cases returning `[]` |
| `createReplayTraceProtocolDecision` | `src/runtime/defaults.ts:338` | Exhaustive switch at line 365 — needs new protocol-decision cases |
| `defaultProtocolDecision` | `src/runtime/defaults.ts:468` | Exhaustive switch — needs new decision-type mappings |
| `SubRunBudgetClampedEvent` | `src/types/events.ts:616` | Shape template for `SubRunConcurrencyClampedEvent` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled semaphore | `p-limit` npm package | Rejected by D-08 and CLAUDE.md — Dogpile is dependency-free |
| Silent clamp + event | `console.warn` | Rejected by D-13 and CLAUDE.md — no logger, no env reads |
| Single validation site | Construct-time only | Rejected by D-03 — user-implemented providers bypass adapter validation |

## Architecture Patterns

### System Architecture Diagram

```
Coordinator Plan Turn
        |
        v
  parseAgentDecision()
  [decisions.ts:24]
        |
     Array?
    /       \
  No         Yes (Phase 3 unlock)
  |           |
  v           v
Single    Array of N delegates
delegate  (N <= MAX_DISPATCH_PER_TURN=8)
  |           |
  |     Per-delegate:
  |      compute parentDecisionId = `${planTurnEventIndex}-${delegateArrayIndex}`
  |      (stable, collision-free under fan-out)
  |           |
  v           v
  -------> Semaphore Gate [coordinator.ts]
           slots_available = min(engine, run, decision) [effective]
                |
          slot free?
         /          \
        Yes           No
        |             |
        |       emit sub-run-queued
        |       (enqueue)
        |             |
        v             v (when slot frees)
   Per-dispatch locality walk:
   options.model.metadata?.locality
   + options.agents[*].model?.metadata?.locality
        |
   any local?
  /           \
No             Yes
 |              |
 |         emit subRun.concurrencyClamped
 |         (once per run, lazy)
 |         effective = 1
 |              |
 v              v
emit sub-run-started
invoke child engine
        |
   [child runs, Phase 2 per-child AbortController]
        |
   complete/fail
        |
        v
 Semaphore release + pull next queued delegate
 Append to transcript (completion order, D-10)
        |
   sibling failed?
  /             \
No               Yes
 |               |
 |         drain queue: synthetic sub-run-failed
 |         (error.code: "aborted", detail.reason: "sibling-failed")
 |         partialCost = emptyCost()
 |               |
 v               v
All N outcomes feed next plan-turn prompt
```

### Recommended Project Structure (additive changes only)

```
src/
├── types.ts                        # + ConfiguredModelProvider.metadata.locality
├── types/
│   └── events.ts                   # + SubRunQueuedEvent, SubRunConcurrencyClampedEvent, update RunEvent union
├── providers/
│   ├── openai-compatible.ts        # + classifyHostLocality(), locality validation, asymmetric override
│   └── openai-compatible.test.ts   # + host-classification parameterized test cases
├── runtime/
│   ├── decisions.ts                # unlock array path (remove throw at lines 94-102)
│   ├── coordinator.ts              # semaphore, fan-out loop, per-dispatch locality walk, queued-event emission
│   ├── concurrency.ts              # (optional extract) semaphore primitive if >30 LOC
│   ├── validation.ts               # + validateProviderLocality(), maxConcurrentChildren validation
│   ├── defaults.ts                 # + new cases in 3 exhaustive switches
│   └── engine.ts                   # + maxConcurrentChildren config threading
└── tests/
    ├── event-schema.test.ts         # + sub-run-queued, sub-run-concurrency-clamped entries
    ├── result-contract.test.ts      # + SubRunQueuedEvent, SubRunConcurrencyClampedEvent imports
    ├── config-validation.test.ts    # + invalid-locality, maxConcurrentChildren-zero, per-run-only-lowers
    └── cancellation-contract.test.ts # + sibling-failed, local-provider-detected detail.reason
```

### Pattern 1: Array-Parser Unlock (decisions.ts:94-102)

**What:** Remove the reserved throw and add an `Array.isArray(parsed)` branch.
**When to use:** Phase 3 Plan 03-02.

```typescript
// BEFORE (src/runtime/decisions.ts:94-102) [VERIFIED: lines 94-102 contain this throw]
if (Array.isArray(parsed)) {
  throw new DogpileError({
    // ...
    message: "delegate decision must be a single delegate object (array support reserved for Phase 3).",
    expected: "single delegate object (array support reserved for Phase 3)",
  });
}

// AFTER: replace with array fan-out path
if (Array.isArray(parsed)) {
  if (parsed.length === 0) {
    throw new DogpileError({ code: "invalid-configuration", message: "delegate array must not be empty" });
  }
  return parsed.map((item, i) => parseDelegateDecision(item, context)); // returns DelegateAgentDecision[]
}
```

### Pattern 2: Hand-rolled Semaphore (~30 LOC)

**What:** Counter + FIFO queue. Caller acquires (waits), completes when slot returns.
**When to use:** Inside `runCoordinator` fan-out loop, Plan 03-02.

```typescript
// Suggested shape (src/runtime/coordinator.ts or concurrency.ts)
interface Semaphore {
  acquire(): Promise<void>; // waits until a slot is free
  release(): void;          // frees a slot, starts next waiter
  readonly inFlight: number;
  readonly queued: number;
}

function createSemaphore(maxConcurrent: number): Semaphore {
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  return {
    acquire() {
      if (inFlight < maxConcurrent) {
        inFlight++;
        return Promise.resolve();
      }
      return new Promise((resolve) => { waiters.push(() => { inFlight++; resolve(); }); });
    },
    release() {
      inFlight--;
      const next = waiters.shift();
      if (next) next();
    },
    get inFlight() { return inFlight; },
    get queued() { return waiters.length; }
  };
}
```

### Pattern 3: Locality Classifier (classifyHostLocality)

**What:** Pure function, no side effects, colocate next to `createURL` in `openai-compatible.ts`.
**When to use:** Plan 03-01.

```typescript
// src/providers/openai-compatible.ts (new helper, export for tests)
// Source: D-02 specification [VERIFIED: createURL at line 172 already parses baseURL]
export function classifyHostLocality(host: string): "local" | "remote" {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (lower === "localhost") return "local";
  if (lower.endsWith(".local")) return "local";
  // IPv4 loopback
  if (/^127\./.test(lower)) return "local";
  // RFC1918
  if (/^10\./.test(lower)) return "local";
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(lower)) return "local";
  if (/^192\.168\./.test(lower)) return "local";
  // link-local
  if (/^169\.254\./.test(lower)) return "local";
  // IPv6 loopback + ULA + link-local
  if (lower === "::1") return "local";
  if (/^f[ce][0-9a-f]{2}:/i.test(lower) || /^fc[0-9a-f]{2}:/i.test(lower)) return "local";
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return "local";
  return "remote";
}
```

### Pattern 4: `sub-run-queued` Event Shape (new variant)

**What:** Emitted per delegate when semaphore slot is not immediately free.
**Template:** `SubRunBudgetClampedEvent` at `src/types/events.ts:616`. [VERIFIED]

```typescript
// src/types/events.ts (new interface, add to RunEvent union)
export interface SubRunQueuedEvent {
  readonly type: "sub-run-queued";
  readonly runId: string;
  readonly at: string; // ISO timestamp
  readonly childRunId: string;
  readonly parentRunId: string;
  readonly parentDecisionId: string; // stable per-delegate id (D-10)
  readonly protocol: Protocol;
  readonly intent: string;
  readonly depth: number;
  readonly queuePosition: number; // 0-indexed position in FIFO queue
}
```

### Pattern 5: `sub-run-concurrency-clamped` Event Shape (new variant)

**What:** Emitted once per run when local-provider check trips.
**Template:** `SubRunBudgetClampedEvent` at `src/types/events.ts:616`. [VERIFIED]

```typescript
// src/types/events.ts (new interface, add to RunEvent union)
export interface SubRunConcurrencyClampedEvent {
  readonly type: "sub-run-concurrency-clamped";
  readonly runId: string;
  readonly at: string;
  readonly requestedMax: number;
  readonly effectiveMax: 1;        // always 1 for local-provider clamp
  readonly reason: "local-provider-detected";
  readonly providerId: string;     // id of first local provider found
}
```

### Pattern 6: `parentDecisionId` for Fan-Out (collision fix)

**What:** Current scheme at coordinator.ts:255 uses `String(events.length - 1)` — correct for single-delegate turns, but produces the SAME id for all N delegates from one fan-out turn.
**Fix:** At plan-turn dispatch time, compute a stable composite id:

```typescript
// coordinator.ts — at fan-out dispatch point
const planTurnEventIndex = events.length - 1; // index of the agent-turn event
// For each delegate at array index i:
const parentDecisionId = `${planTurnEventIndex}-${delegateArrayIndex}`;
// e.g., "42-0", "42-1", "42-2"
// Single-delegate backward compat: for legacy single-object decisions, use "42-0"
// (identical to old String(planTurnEventIndex) only if treated as opaque string — update
//  any test assertions that rely on the exact format)
```

**Important:** This changes the `parentDecisionId` string format for ALL delegate dispatches (single and array). Existing event-schema tests must be updated to accept the new format or made format-agnostic.

### Pattern 7: defaults.ts Exhaustive Switch Updates

**What:** Three switches in `defaults.ts` must handle every `RunEvent` type. Missing cases cause TypeScript exhaustiveness errors. [VERIFIED: all three switches verified, current last case is `sub-run-budget-clamped`]

For `createReplayTraceBudgetStateChanges` (line 267 switch):
```typescript
// Add to existing exhaustive switch (alongside sub-run-budget-clamped → []):
case "sub-run-queued":
case "sub-run-concurrency-clamped":
  return [];
```

For `createReplayTraceProtocolDecision` (line 365 switch):
```typescript
case "sub-run-queued":
  return { ...base, childRunId: event.childRunId, queuePosition: event.queuePosition };
case "sub-run-concurrency-clamped":
  return { ...base };
```

For `defaultProtocolDecision` (line 468 switch):
```typescript
case "sub-run-queued":
  return "queue-sub-run";
case "sub-run-concurrency-clamped":
  return "mark-sub-run-concurrency-clamped";
```

Note: `ReplayTraceProtocolDecisionType` must also gain these two new string literals.

### Anti-Patterns to Avoid

- **Emitting `sub-run-queued` when slot is immediately free:** D-07 explicitly forbids this. Check `semaphore.inFlight < effective` before emitting queued event. Tests must cover both paths.
- **Re-emitting `subRun.concurrencyClamped` on every dispatch:** D-12 specifies one emission per run. State flag on run accumulator, not module-level.
- **Using `String(events.length - 1)` for `parentDecisionId` in fan-out:** Produces the same id for all N delegates from one plan turn. Use composite `"${planTurnEventIndex}-${delegateArrayIndex}"` format.
- **Aborting in-flight siblings on failure:** D-09 is explicit — let in-flight finish. Synthetic `sub-run-failed` events drain ONLY the queue (never-started delegates).
- **Walking `agent.model.metadata?.locality` before `AgentSpec` has a `model` field:** `AgentSpec` at types.ts:687 has no `model` field today. The D-11 walk reduces to `options.model.metadata?.locality` only. The multi-agent walk is forward-compat scaffolding; use optional chaining with `?.` throughout.
- **Accumulating cost for synthetic sibling-failed events:** D-09 note says `partialCost = emptyCost()`. `accumulateSubRunCost` already handles `sub-run-failed` — pass `emptyCost()` so the accumulation contributes zero.
- **Calling `validateOptionalNonNegativeInteger` for `maxConcurrentChildren`:** Must use `validatePositiveInteger` (line 696) because 0 is invalid (min 1). Using the non-negative validator would silently allow 0.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IP range matching | Custom string parser | The classifier pattern from D-02 + existing `new URL()` for host extraction | URL parser handles percent-encoding, IPv6 brackets, port stripping |
| Bounded concurrency | Custom async queue with locks | The hand-rolled semaphore from D-08 (~30 LOC) | This IS the blessed approach per CLAUDE.md; no deps allowed |
| Exhaustive type unions | Ad-hoc `if/else if` chains | TypeScript discriminated union switches | TS exhaustiveness checking is the only way to catch missing cases at compile time |
| `DogpileError` for locality | Custom error class | Existing `DogpileError` with `code: "invalid-configuration"` | Callers catch `DogpileError` by code; adding a new class breaks error handling |

**Key insight:** This phase adds zero npm dependencies. Every new capability is 5-50 LOC of pure TypeScript using existing error shapes, event shapes, and validation patterns.

## Runtime State Inventory

Step 2.5: SKIPPED — not a rename/refactor/migration phase. This is a greenfield addition to a TypeScript SDK with no stored state.

## Common Pitfalls

### Pitfall 1: AgentSpec Has No `model` Field
**What goes wrong:** D-11 says "walk every `agent.model.metadata?.locality`" but `AgentSpec` at `src/types.ts:687` has no `model` field today. [VERIFIED: grep found no `model` on AgentSpec]
**Why it happens:** The CONTEXT.md references `src/types.ts:1758, 1830` for `Agent.model` but those lines don't exist as described — `AgentSpec` is a distinct type from `Agent` in the run context.
**How to avoid:** D-11's locality walk today is `options.model.metadata?.locality` ONLY. The multi-agent walk (`options.agents[*].model`) is forward-compat scaffolding using `?.` everywhere. Plan 03-03 should document this explicitly in comments.
**Warning signs:** TypeScript error accessing `agent.model` on `AgentSpec` type.

### Pitfall 2: `parentDecisionId` Collision in Fan-Out
**What goes wrong:** Current code at coordinator.ts:255: `const parentDecisionId = String(events.length - 1)`. For a 3-delegate fan-out from one plan turn, all three delegates get the same `parentDecisionId`.
**Why it happens:** The single-delegate case is a no-op (only one delegate per turn), so the collision was never visible before Phase 3.
**How to avoid:** Use composite id `"${planTurnEventIndex}-${delegateArrayIndex}"` (e.g., `"42-0"`, `"42-1"`). For single-delegate backward compat, use `"42-0"` uniformly — treat the id as an opaque string in tests.
**Warning signs:** Two `sub-run-started` events with the same `parentDecisionId` in the same run.

### Pitfall 3: Three Exhaustive Switches Must All Be Updated
**What goes wrong:** Adding `sub-run-queued` and `sub-run-concurrency-clamped` to `RunEvent` union causes TypeScript compile errors in `defaults.ts` at three separate switch statements. [VERIFIED: all three switches verified, current last case in each is `sub-run-budget-clamped`]
**Why it happens:** TypeScript `strictNullChecks` + exhaustive switches — each unhandled variant is a compile error.
**How to avoid:** Treat the three switches as a checklist in Plan 03-02/03-03: `createReplayTraceBudgetStateChanges` (line 271), `createReplayTraceProtocolDecision` (line 365), `defaultProtocolDecision` (line 468). Also update `ReplayTraceProtocolDecisionType` union with two new string literals.
**Warning signs:** `pnpm run typecheck` fails on `defaults.ts` with "not all code paths return a value" or similar exhaustiveness error.

### Pitfall 4: Queued Event Emission Ordering vs. Semaphore Timing
**What goes wrong:** If `sub-run-queued` is emitted AFTER the semaphore is decremented (when a slot frees), a race can produce: slot free → emit queued → start. This is wrong — queued should be emitted at enqueue time, before slot acquisition.
**Why it happens:** Async nature of the semaphore; placing emit in the wrong callback.
**How to avoid:** Emit `sub-run-queued` synchronously at the point where `semaphore.inFlight >= effective` is first detected, BEFORE the `semaphore.acquire()` promise is awaited. Ordering: check-pressure → emit-queued → await-acquire → emit-started.
**Warning signs:** `sub-run-queued` appearing after `sub-run-started` in the event array.

### Pitfall 5: Concurrency Flag Shared Across Parallel Runs
**What goes wrong:** The "have we emitted concurrencyClamped this run?" flag ends up on a shared object, causing one run's flag to suppress another run's emission.
**Why it happens:** Phase 2 accumulator pattern uses closure-local variables. If the flag is accidentally attached to `options` (which is per-engine, not per-run), parallel runs on the same engine share state.
**How to avoid:** Flag must live on the per-run accumulator (same scope as `events`, `providerCalls`, `totalCost` closures in `runCoordinator`). See Phase 2 D-12 per-child controller pattern for precedent.
**Warning signs:** Second parallel run never emits the clamp event even when a local provider is active.

### Pitfall 6: `validateOptionalNonNegativeInteger` vs. `validatePositiveInteger`
**What goes wrong:** Using `validateOptionalNonNegativeInteger` for `maxConcurrentChildren` allows 0, which would make the semaphore deadlock immediately.
**Why it happens:** Pattern confusion — `maxDepth` uses the non-negative variant (0 is valid depth).
**How to avoid:** `maxConcurrentChildren` must use `validatePositiveInteger` (validation.ts:696). Zero is explicitly forbidden by D-05.
**Warning signs:** Config validation test for `maxConcurrentChildren: 0` passes when it should throw.

## Code Examples

Verified patterns from actual source files:

### Existing `throwInvalid` pattern in `openai-compatible.ts` (template for locality validation)
```typescript
// Source: src/providers/openai-compatible.ts:159 [VERIFIED]
function throwInvalid(path: string, expected: string): never {
  throw new DogpileError({
    code: "invalid-configuration",
    message: `${path} must be ${expected}`,
    retryable: false,
    detail: { kind: "configuration-validation", path, expected }
  });
}
```

### Existing `validatePositiveInteger` (reuse for maxConcurrentChildren)
```typescript
// Source: src/runtime/validation.ts:696 [VERIFIED]
function validatePositiveInteger(value: unknown, path: string): void {
  // (existing implementation — positive integer >= 1)
}
// Called as: validatePositiveInteger(options.maxConcurrentChildren, "maxConcurrentChildren")
```

### `SubRunBudgetClampedEvent` shape template (src/types/events.ts:616)
```typescript
// Source: src/types/events.ts:616 [VERIFIED]
export interface SubRunBudgetClampedEvent {
  readonly type: "sub-run-budget-clamped";
  readonly runId: string;
  readonly at: string;
  readonly childRunId: string;
  readonly parentRunId: string;
  readonly parentDecisionId: string;
  readonly requestedTimeoutMs: number;
  readonly clampedTimeoutMs: number;
  readonly reason: "exceeded-engine-deadline" | "parent-deadline-exceeded";
}
// Phase 3 SubRunConcurrencyClampedEvent mirrors this pattern (omit child/parent ids,
// add requestedMax, effectiveMax, reason, providerId per D-12)
```

### Dispatch loop before fan-out (coordinator.ts:213-256) — excerpt of current sequential shape
```typescript
// Source: src/runtime/coordinator.ts:213-256 [VERIFIED]
let dispatchCount = 0;
while (true) {
  const turnOutcome = await runCoordinatorTurn({ ... });
  if (turnOutcome.decision?.type !== "delegate") break;
  if (dispatchCount >= MAX_DISPATCH_PER_TURN) { throw ...; }
  dispatchCount += 1;
  const parentDecisionId = String(events.length - 1); // Phase 3: collision under fan-out
  const dispatchResult = await dispatchDelegate({ ... });
  // ...
}
```

### event-schema.test.ts `expectedEventTypes` array (lines 37-56)
```typescript
// Source: src/tests/event-schema.test.ts:37 [VERIFIED]
const expectedEventTypes = [
  // ... 15 current entries including:
  "sub-run-started",
  "sub-run-completed",
  "sub-run-failed",
  "sub-run-parent-aborted",
  "sub-run-budget-clamped",
  // Phase 3 adds two:
  // "sub-run-queued",
  // "sub-run-concurrency-clamped",
] as const satisfies readonly RunEvent["type"][];
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Array delegates reserved/throw | Array delegates enabled | Phase 3 | Coordinators can fan out N delegates per turn |
| `ConfiguredModelProvider` has no locality hint | `metadata?.locality` field | Phase 3 | Engine can detect and clamp local-provider concurrency |
| Sequential single-delegate dispatch loop | Semaphore-bounded fan-out | Phase 3 | Parallel child execution up to `maxConcurrentChildren` |
| No concurrency config | Three-level `maxConcurrentChildren` | Phase 3 | Per-engine, per-run, per-decision control |

**Reserved/deprecated paths becoming active:**
- `parseAgentDecision` array-throw at decisions.ts:94-102: reserved for Phase 3 — explicitly labeled in source comments [VERIFIED]
- Phase 1 D-03 array-delegate shape: type union was designed for arrays; parser code path was withheld

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `AgentSpec` at types.ts:687 has no `model` field; D-11's multi-agent locality walk is forward-compat scaffolding only today | Architecture Patterns | If AgentSpec does have a model field, Plan 03-03 can add the full multi-agent walk immediately — no architectural change, just remove the forward-compat note |
| A2 | `ReplayTraceProtocolDecisionType` is a string union that needs two new literals for the new event types | Don't Hand-Roll / defaults.ts | If it's a generic `string`, no update needed — minor planner effort difference |
| A3 | `parentDecisionId` format change (from `"42"` to `"42-0"`) is safe for single-delegate backward compat because consumers treat it as an opaque string | Common Pitfalls | If any test asserts the exact numeric string format of `parentDecisionId`, those tests need updating |

*All remaining claims tagged [VERIFIED] above were confirmed against actual source files in this session.*

## Open Questions

1. **`parentDecisionArrayIndex` vs. composite string for `parentDecisionId`**
   - What we know: D-10 says "stable `parentDecisionId` at dispatch time"; current `String(events.length - 1)` collides
   - What's unclear: Whether to add a separate `parentDecisionArrayIndex: number` field on new sub-run events (additive, non-breaking) OR change `parentDecisionId` to composite string format
   - Recommendation: Composite string `"${planTurnEventIndex}-${delegateArrayIndex}"` is the minimal-surface option (one field, no new field on event shapes). Flag for planner to confirm before cutting Plan 03-02.

2. **`ReplayTraceProtocolDecisionType` union literal updates**
   - What we know: `defaultProtocolDecision` at defaults.ts:468 returns `ReplayTraceProtocolDecisionType`; two new event types need mappings
   - What's unclear: Whether the type is declared as an explicit union (requiring update) or `string`
   - Recommendation: Planner verifies in `src/types/` or `defaults.ts` import; add new literals `"queue-sub-run"` and `"mark-sub-run-concurrency-clamped"` if needed.

3. **`dispatchInput` reshape after fan-out completion**
   - What we know: D-10 says "all N results feed into the NEXT plan-turn's prompt context together"; current loop rebuilds `dispatchInput` from a single `dispatchResult`
   - What's unclear: How N parallel `DispatchDelegateResult` objects are merged into the next plan-turn input string
   - Recommendation: Planner defines a `mergeDispatchResults(results: DispatchDelegateResult[]): string` helper. Each result's `nextInput` is appended to the shared context in completion order (D-10), separated by a structured block delimiter.

## Environment Availability

Step 2.6: This phase is pure TypeScript runtime code changes (no external tools, services, or CLIs beyond the project's own build toolchain).

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22+ | Build + test | ✓ | (system node) | — |
| pnpm 10.33.0 | Install + build | ✓ | (package manager field) | — |
| Vitest | Test suite | ✓ | (existing devDep) | — |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (existing) |
| Config file | (inferred from package.json `test` script: `vitest run`) |
| Quick run command | `pnpm vitest run src/providers/openai-compatible.test.ts` (or specific file) |
| Full suite command | `pnpm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROVIDER-01 | `ConfiguredModelProvider.metadata?.locality` accepted; absent = remote for clamping | unit | `pnpm vitest run src/tests/config-validation.test.ts` | ✅ exists |
| PROVIDER-02 | `classifyHostLocality()` returns correct value for loopback/RFC1918/ULA/mDNS/remote | unit | `pnpm vitest run src/providers/openai-compatible.test.ts` | ✅ exists |
| PROVIDER-02 | `createOpenAICompatibleProvider` sets `metadata.locality = "local"` for local baseURL | unit | `pnpm vitest run src/providers/openai-compatible.test.ts` | ✅ exists |
| PROVIDER-03 | Invalid locality string throws `DogpileError({ code: "invalid-configuration" })` | unit | `pnpm vitest run src/tests/config-validation.test.ts` | ✅ exists |
| PROVIDER-03 | `"remote"` override on detected-local host throws with `reason: "remote-override-on-local-host"` | unit | `pnpm vitest run src/providers/openai-compatible.test.ts` | ✅ exists |
| CONCURRENCY-01 | N delegates dispatched in parallel up to `maxConcurrentChildren`, remaining queued | integration | `pnpm vitest run src/runtime/coordinator.test.ts` | ✅ exists |
| CONCURRENCY-01 | Array-parser unlock: `parseAgentDecision` accepts `[delegate, delegate]` | unit | `pnpm vitest run src/runtime/coordinator.test.ts` | ✅ exists |
| CONCURRENCY-01 | `sub-run-queued` emitted only under concurrency pressure (not on immediate-slot runs) | integration | `pnpm vitest run src/runtime/coordinator.test.ts` | ✅ exists |
| CONCURRENCY-01 | Sibling failure drains queue with synthetic `sub-run-failed` events (reason: sibling-failed) | integration | `pnpm vitest run src/tests/cancellation-contract.test.ts` | ✅ exists |
| CONCURRENCY-02 | Local provider clamps effective to 1 + emits `subRun.concurrencyClamped` once | integration | `pnpm vitest run src/runtime/coordinator.test.ts` | ✅ exists |
| CONCURRENCY-02 | Clamp event not re-emitted on subsequent dispatches in same run | integration | `pnpm vitest run src/runtime/coordinator.test.ts` | ✅ exists |
| — | Event-schema lock: 17 total event types (15 + 2 new) | contract | `pnpm vitest run src/tests/event-schema.test.ts` | ✅ exists |
| — | Result-contract lock: new event types importable from index | contract | `pnpm vitest run src/tests/result-contract.test.ts` | ✅ exists |
| — | `maxConcurrentChildren: 0` throws `invalid-configuration` | unit | `pnpm vitest run src/tests/config-validation.test.ts` | ✅ exists |
| — | Per-run `maxConcurrentChildren` can only lower engine ceiling | unit | `pnpm vitest run src/tests/config-validation.test.ts` | ✅ exists |

### Sampling Rate
- **Per task commit:** `pnpm vitest run <affected-test-file>`
- **Per wave merge:** `pnpm run test`
- **Phase gate:** `pnpm run verify` (full release gate: build → artifacts → typecheck → test)

### Wave 0 Gaps
None for existing test files — all test files listed above already exist. New test cases are additions within existing files. The only potential Wave 0 item is `src/tests/concurrency-contract.test.ts` — created at planner discretion per D-15 if coordinator.test.ts concurrency additions exceed ~150 new LOC.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `validateProviderLocality()` + `validatePositiveInteger()` for `maxConcurrentChildren`; `throwInvalid` for construct-time locality |
| V6 Cryptography | no | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed `locality` string on user-implemented provider bypasses TS types | Tampering | Engine-time `validateProviderLocality()` called at run start (D-03 defense-in-depth) |
| `"remote"` override on localhost tricks engine into allowing N parallel local calls | Tampering/DoS | D-04 asymmetric override throws at construct time for bundled adapter |
| `maxConcurrentChildren: 0` causes semaphore deadlock | DoS (self-inflicted) | `validatePositiveInteger` in validation.ts:696 |

## Sources

### Primary (HIGH confidence)
- `src/types.ts` — `ConfiguredModelProvider` at line 876 (verified via Read tool)
- `src/providers/openai-compatible.ts` — `createOpenAICompatibleProvider` at line 66, `validateOptions` at line 132, `createURL` at line 172, `throwInvalid` at line 159 (verified via Read tool)
- `src/runtime/decisions.ts` — `parseAgentDecision` array-throw at lines 94-102 (verified via grep)
- `src/runtime/coordinator.ts` — `MAX_DISPATCH_PER_TURN` at line 137, dispatch loop at line 215, `parentDecisionId` at line 255, `dispatchDelegate` at line 829, `AbortController` at line 947 (verified via grep + Read)
- `src/runtime/defaults.ts` — three exhaustive switches at lines 271, 365, 468 (verified via Read tool)
- `src/runtime/validation.ts` — `validatePositiveInteger` at line 696, `validateOptionalNonNegativeInteger` at line 708 (verified via grep)
- `src/types/events.ts` — `SubRunBudgetClampedEvent` at line 616, `RunEvent` union at line 675 (verified via grep)
- `src/tests/event-schema.test.ts` — `expectedEventTypes` at line 37, 15 current members (verified via grep + Read)
- `.planning/phases/03-provider-locality-bounded-concurrency/03-CONTEXT.md` — 18 locked decisions (verified via Read tool)

### Secondary (MEDIUM confidence)
- D-02 host classification ranges: loopback/RFC1918/IPv6 ULA/link-local/mDNS — well-established IANA/IETF ranges [ASSUMED: specific regex patterns should be reviewed by planner]

### Tertiary (LOW confidence)
None — all claims either verified in source or explicitly tagged [ASSUMED].

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all file locations verified against actual source
- Architecture: HIGH — all anchor points verified; one known gap (AgentSpec.model) documented
- Pitfalls: HIGH — verified from source code observations (the array-throw literally says "Phase 3", parentDecisionId scheme verified at line 255)

**Research date:** 2026-04-30
**Valid until:** 2026-05-30 (stable codebase; invalidated by any changes to coordinator.ts, defaults.ts, types/events.ts, or decisions.ts before planning)
