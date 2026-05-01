# Phase 3: Provider Locality & Bounded Concurrency - Pattern Map

**Mapped:** 2026-04-30
**Files analyzed:** 14
**Analogs found:** 12 / 14

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/types.ts` | model | — | `src/types.ts` (existing `ConfiguredModelProvider`) | exact (additive field) |
| `src/types/events.ts` | model | event-driven | `src/types/events.ts:614` (`SubRunBudgetClampedEvent`) | exact |
| `src/providers/openai-compatible.ts` | provider/adapter | request-response | `src/providers/openai-compatible.ts:132` (`validateOptions`) | exact |
| `src/providers/openai-compatible.test.ts` | test | — | `src/providers/openai-compatible.test.ts:22` (existing `describe` block) | exact |
| `src/runtime/decisions.ts` | utility | transform | `src/runtime/decisions.ts:94-102` (reserved array-throw) | exact (unlock) |
| `src/runtime/coordinator.ts` | coordinator | event-driven | `src/runtime/coordinator.ts:840-975` (`dispatchDelegate`) | exact |
| `src/runtime/concurrency.ts` (optional) | utility | event-driven | none | no analog |
| `src/runtime/validation.ts` | middleware | request-response | `src/runtime/validation.ts:696` (`validatePositiveInteger`) | role-match |
| `src/runtime/defaults.ts` | utility | transform | `src/runtime/defaults.ts:267-500` (three exhaustive switches) | exact |
| `src/runtime/engine.ts` | controller | request-response | `src/runtime/engine.ts:74,81-84` (`engineMaxDepth`/`effectiveMaxDepth`) | exact |
| `src/tests/event-schema.test.ts` | test | — | `src/tests/event-schema.test.ts:37-53` (`expectedEventTypes`) | exact |
| `src/tests/result-contract.test.ts` | test | — | `src/tests/result-contract.test.ts:1-41` (import block) | exact |
| `src/tests/config-validation.test.ts` | test | — | `src/tests/config-validation.test.ts:39-79` (test-case array) | exact |
| `src/tests/cancellation-contract.test.ts` | test | — | `src/tests/cancellation-contract.test.ts:20-58` (`describe` block) | role-match |
| `src/tests/concurrency-contract.test.ts` (optional) | test | — | `src/tests/cancellation-contract.test.ts` | role-match |

---

## Pattern Assignments

### `src/types.ts` — additive `metadata?` field on `ConfiguredModelProvider`

**Analog:** `src/types.ts:876-890` (existing `ConfiguredModelProvider`)

**Existing interface shape** (lines 876-890):
```typescript
export interface ConfiguredModelProvider {
  /** Stable provider id recorded in traces. */
  readonly id: string;
  /** Generate a response for one protocol-managed model request. */
  generate(request: ModelRequest): Promise<ModelResponse>;
  /**
   * Optionally stream response text ...
   */
  stream?(request: ModelRequest): AsyncIterable<ModelOutputChunk>;
}
```

**Add after `stream?`:**
```typescript
/**
 * Optional provider hints for the runtime. Absent or omitted → treated as
 * `remote` for concurrency clamping (CONCURRENCY-02 / D-01).
 */
readonly metadata?: {
  /** Locality hint for dispatch clamping. Absent → `"remote"` for clamping. */
  readonly locality?: "local" | "remote";
};
```

**Copy pattern:** Optional readonly nested object on an existing exported interface. Follow the existing field comment style (one-line JSDoc per field). Keep `metadata` optional so existing custom providers require no changes.

---

### `src/types/events.ts` — two new event variants + `RunEvent` union update

**Analog:** `src/types/events.ts:601-633` (`SubRunBudgetClampedEvent` — Phase 2 D-12 exact template)

**`SubRunBudgetClampedEvent` shape** (lines 614-633):
```typescript
export interface SubRunBudgetClampedEvent {
  readonly type: "sub-run-budget-clamped";
  readonly runId: string;
  readonly at: string;
  readonly childRunId: string;
  readonly parentRunId: string;
  readonly parentDecisionId: string;
  readonly requestedTimeoutMs: number;
  readonly clampedTimeoutMs: number;
  readonly reason: "exceeded-parent-remaining";
}
```

**`RunEvent` union** (lines 675-689):
```typescript
export type RunEvent =
  | RoleAssignmentEvent
  | ...
  | SubRunBudgetClampedEvent
  | BudgetStopEvent
  // Phase 3 adds two entries here
```

**New `SubRunQueuedEvent` — mirrors `SubRunBudgetClampedEvent` structure but with child-identity fields:**
```typescript
// src/types/events.ts (new interface, insert before RunEvent union)
export interface SubRunQueuedEvent {
  readonly type: "sub-run-queued";
  readonly runId: string;
  readonly at: string;                  // ISO-8601
  readonly childRunId: string;
  readonly parentRunId: string;
  readonly parentDecisionId: string;    // stable per-plan-turn id (see parentDecisionArrayIndex note below)
  readonly parentDecisionArrayIndex: number; // NEW additive field — index of delegate in fan-out array; 0 for single-delegate turns
  readonly protocol: Protocol;
  readonly intent: string;
  readonly depth: number;
  readonly queuePosition: number;       // 0-indexed FIFO position
}
```

**New `SubRunConcurrencyClampedEvent` — mirrors `SubRunBudgetClampedEvent` structure without child-run fields:**
```typescript
// src/types/events.ts (new interface, insert before RunEvent union)
export interface SubRunConcurrencyClampedEvent {
  readonly type: "sub-run-concurrency-clamped";
  readonly runId: string;
  readonly at: string;
  readonly requestedMax: number;
  readonly effectiveMax: 1;             // always 1 for local-provider clamp (D-12)
  readonly reason: "local-provider-detected";
  readonly providerId: string;          // id of the first local provider found
}
```

**PLANNER NOTE — `parentDecisionArrayIndex` field:** RESEARCH.md Open Question #1 is a blocking decision for Plan 03-02. The current `String(events.length - 1)` scheme at `coordinator.ts:255` produces the same `parentDecisionId` for all N delegates from one fan-out turn. RESEARCH.md recommends adding `parentDecisionArrayIndex: number` as a strictly additive new field on `sub-run-queued`, `sub-run-started`, `sub-run-completed`, and `sub-run-failed` events (on the fan-out path only; single-delegate turns use `parentDecisionArrayIndex: 0`). The alternative is a composite `"${planTurnEventIndex}-${delegateArrayIndex}"` string format change. **Planner must lock one approach before writing Wave 1 tasks for Plan 03-02.** Both approaches are type-safe; the additive field is the non-breaking default.

**Copy pattern:** Match the `readonly type: "..."` discriminant, `runId`, `at` structure exactly. All fields `readonly`. Union entry added in the same block as existing sub-run variants.

---

### `src/providers/openai-compatible.ts` — locality classifier + validation + asymmetric override

**Analog A:** `src/providers/openai-compatible.ts:159-170` (`throwInvalid` pattern)

**`throwInvalid` helper** (lines 159-170):
```typescript
function throwInvalid(path: string, expected: string): never {
  throw new DogpileError({
    code: "invalid-configuration",
    message: `Invalid OpenAI-compatible provider option at ${path}.`,
    retryable: false,
    detail: {
      kind: "configuration-validation",
      path,
      expected
    }
  });
}
```

**Analog B:** `src/providers/openai-compatible.ts:132-157` (`validateOptions` — pattern for adding new validations)

**`validateOptions` body** (lines 132-157):
```typescript
function validateOptions(options: OpenAICompatibleProviderOptions): void {
  if (!isRecord(options)) {
    throwInvalid("options", "an options object");
  }
  if (!isNonEmptyString(options.model)) {
    throwInvalid("model", "a non-empty model id");
  }
  // ... each field check calls throwInvalid on failure
  if (options.maxOutputTokens !== undefined && (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens <= 0)) {
    throwInvalid("maxOutputTokens", "a positive integer when provided");
  }
}
```

**Analog C:** `src/providers/openai-compatible.ts:172-176` (`createURL` — where `classifyHostLocality` reads `.hostname`)

**`createURL`** (lines 172-176):
```typescript
function createURL(options: OpenAICompatibleProviderOptions): URL {
  const baseURL = new URL(String(options.baseURL ?? defaultBaseURL));
  const path = options.path ?? defaultPath;
  return new URL(path.startsWith("/") ? path.slice(1) : path, ensureTrailingSlash(baseURL));
}
```

**New additions:**

1. Add `locality?: "local" | "remote"` to `OpenAICompatibleProviderOptions` interface (after existing fields, before line 40).

2. Add `classifyHostLocality` helper colocated near `createURL`. The host is `baseURL.hostname` from `new URL(...)` — already parsed, no port, no brackets for IPv6 when read via `.hostname` (URL parser strips brackets). See RESEARCH.md Pattern 3 for the full regex classifier body.

3. Extend `validateOptions` (after line 154) to validate locality value and detect asymmetric override:
```typescript
// In validateOptions, after existing checks:
if (options.locality !== undefined && options.locality !== "local" && options.locality !== "remote") {
  throwInvalid("locality", "\"local\" | \"remote\" when provided");
}
// Asymmetric override check (D-04) — runs after locality value is validated:
if (options.locality !== undefined) {
  const baseURL = new URL(String(options.baseURL ?? defaultBaseURL));
  const detected = classifyHostLocality(baseURL.hostname);
  if (options.locality === "remote" && detected === "local") {
    throw new DogpileError({
      code: "invalid-configuration",
      message: `locality "remote" cannot be set when baseURL resolves to a local host (${baseURL.hostname}).`,
      retryable: false,
      detail: {
        kind: "configuration-validation",
        path: "locality",
        expected: "\"local\" (or omit to auto-detect)",
        reason: "remote-override-on-local-host",
        host: baseURL.hostname
      }
    });
  }
}
```

4. Set `metadata.locality` on the returned `ConfiguredModelProvider` object (in `createOpenAICompatibleProvider`, after `validateOptions`):
```typescript
const detectedOrExplicit = ((): "local" | "remote" => {
  const baseURL = new URL(String(options.baseURL ?? defaultBaseURL));
  const detected = classifyHostLocality(baseURL.hostname);
  return options.locality === "local" ? "local" : detected;
})();
// Return object gains:
return {
  id: providerId,
  metadata: { locality: detectedOrExplicit },
  async generate(request) { ... }
};
```

**Copy pattern:** Every new validation in `validateOptions` calls `throwInvalid`. `DogpileError` with `code: "invalid-configuration"` is the only error class used. `detail.kind: "configuration-validation"` is the invariant.

---

### `src/providers/openai-compatible.test.ts` — locality classifier + validation tests

**Analog:** `src/providers/openai-compatible.test.ts:22-60` (existing `describe("createOpenAICompatibleProvider")` block)

**Test structure pattern** (lines 1-20 and 22):
```typescript
import { describe, expect, it } from "vitest";
import { DogpileError, type ModelRequest } from "../index.js";
import { createOpenAICompatibleProvider, type OpenAICompatibleFetch } from "./openai-compatible.js";

describe("createOpenAICompatibleProvider", () => {
  it("...", async () => {
    const provider = createOpenAICompatibleProvider({ model: "...", fetch, ... });
    // assertions
  });
});
```

**New test additions follow the same describe/it structure.** For `classifyHostLocality`, use a parameterized approach per D-02:
```typescript
// Import classifyHostLocality (export it for tests from openai-compatible.ts)
import { classifyHostLocality } from "./openai-compatible.js";

describe("classifyHostLocality", () => {
  it.each([
    ["localhost", "local"],
    ["LOCALHOST", "local"],
    ["127.0.0.1", "local"],
    ["10.0.0.1", "local"],
    ["172.16.5.3", "local"],
    ["192.168.1.100", "local"],
    ["169.254.1.1", "local"],
    ["::1", "local"],
    ["mybox.local", "local"],
    ["SERVICE.LOCAL", "local"],
    // remote
    ["api.openai.com", "remote"],
    ["127.0.0.1.example.com", "remote"],  // not actually loopback
    ["8.8.8.8", "remote"],
  ])("classifies %s as %s", (host, expected) => {
    expect(classifyHostLocality(host)).toBe(expected);
  });
});
```

---

### `src/runtime/decisions.ts` — array-delegate parser unlock

**Analog:** `src/runtime/decisions.ts:77-102` (`parseDelegateDecision` body — the reserved throw is the exact change site)

**Current reserved throw** (lines 94-102):
```typescript
if (Array.isArray(parsed)) {
  throwInvalidDelegate({
    path: "decision",
    message:
      "delegate decision must be a single delegate object (array support reserved for Phase 3).",
    expected: "single delegate object (array support reserved for Phase 3)",
    received: "array"
  });
}
```

**Copy pattern — `parseDelegateDecision` signature and return** (lines 77-93 and 104+):
```typescript
function parseDelegateDecision(
  jsonText: string,
  context: ParseAgentDecisionContext
): DelegateAgentDecision {   // Phase 3: return type becomes DelegateAgentDecision | DelegateAgentDecision[]
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throwInvalidDelegate({
      path: "decision",
      message: `delegate JSON did not parse: ${reason}`,
      expected: "valid JSON object",
      received: truncate(jsonText)
    });
  }
  // Phase 3 replaces the array-throw with an array-fan-out branch
```

**Replace the array-throw block with:**
```typescript
if (Array.isArray(parsed)) {
  if (parsed.length === 0) {
    throwInvalidDelegate({
      path: "decision",
      message: "delegate array must not be empty.",
      expected: "array with 1..8 delegate objects",
      received: "empty array"
    });
  }
  // Each element validated as a single delegate object
  return parsed.map((item) => parseSingleDelegateObject(item, context));
  // Caller (parseAgentDecision) must handle DelegateAgentDecision[]
}
```

**Copy pattern:** Use the existing `throwInvalidDelegate` helper for all validation errors inside the array path. Preserve the `parseSingleDelegateObject` private helper by refactoring the non-array path into it (the record-field validation at lines 113+).

---

### `src/runtime/coordinator.ts` — dispatch loop + semaphore + per-dispatch locality walk + queued event

This is the largest change. Three sub-patterns, each with a direct analog.

#### Sub-pattern A: `subRun.concurrencyClamped` event emission (before `sub-run-started`)

**Analog:** `src/runtime/coordinator.ts:908-925` (Phase 2 `sub-run-budget-clamped` emit inside `dispatchDelegate`)

**Budget-clamp emit** (lines 908-925):
```typescript
if (clampedFrom !== undefined && childTimeoutMs !== undefined) {
  const clampEvent: SubRunBudgetClampedEvent = {
    type: "sub-run-budget-clamped",
    runId: input.parentRunId,
    at: new Date().toISOString(),
    childRunId,
    parentRunId: input.parentRunId,
    parentDecisionId: input.parentDecisionId,
    requestedTimeoutMs: clampedFrom,
    clampedTimeoutMs: childTimeoutMs,
    reason: "exceeded-parent-remaining"
  };
  input.emit(clampEvent);
  input.recordProtocolDecision(clampEvent);
}
```

**Copy for `SubRunConcurrencyClampedEvent`:** Same emit-before-`sub-run-started` placement in `dispatchDelegate`. The "emit once per run" flag (`concurrencyClampEmitted: boolean`) lives on the coordinator's run-level closure (alongside `events`, `totalCost`, etc.) — NOT on `input` or `options`. Check `!concurrencyClampEmitted` before emitting.

#### Sub-pattern B: per-child `AbortController` (D-17 stream-handle hook slot)

**Analog:** `src/runtime/coordinator.ts:942-961` (Phase 2 D-07 per-child controller)

**Per-child controller** (lines 942-961):
```typescript
// BUDGET-01 / D-07: derive a per-child AbortController so child engines see
// their own signal.
const parentSignal = options.signal;
const childController = new AbortController();
let removeParentAbortListener: (() => void) | undefined;
if (parentSignal !== undefined) {
  if (parentSignal.aborted) {
    childController.abort(parentSignal.reason);
  } else {
    const handler = (): void => {
      childController.abort(parentSignal.reason);
    };
    parentSignal.addEventListener("abort", handler, { once: true });
    removeParentAbortListener = (): void => {
      parentSignal.removeEventListener("abort", handler);
    };
  }
}
```

**D-17 placeholder:** Add to the per-child record (the new `DispatchedChild` tuple):
```typescript
interface DispatchedChild {
  readonly childRunId: string;
  readonly controller: AbortController;
  readonly removeParentListener: (() => void) | undefined;
  readonly streamHandle?: never; // STREAM-03 hook (Phase 4) — do not use
}
```

#### Sub-pattern C: dispatch loop sequential shape (Phase 3 fan-out replacement)

**Analog:** `src/runtime/coordinator.ts:213-275` (current sequential dispatch loop)

**Current sequential loop** (lines 213-275):
```typescript
let dispatchInput = buildCoordinatorPlanInput(options.intent, coordinator);
let dispatchCount = 0;
while (true) {
  const turnOutcome = await runCoordinatorTurn({ ... });
  totalCost = turnOutcome.totalCost;

  if (turnOutcome.decision?.type !== "delegate") {
    break;
  }

  if (dispatchCount >= MAX_DISPATCH_PER_TURN) {
    throw new DogpileError({ code: "invalid-configuration", ... });
  }
  dispatchCount += 1;

  const parentDecisionId = String(events.length - 1);  // NOTE: collision under fan-out; see PATTERNS.md
  const dispatchResult = await dispatchDelegate({ ... });
  dispatchInput = dispatchResult.nextInput;
}
```

**Phase 3 fan-out shape (copy + extend):**
- `turnOutcome.decision` is now `DelegateAgentDecision | DelegateAgentDecision[]` from the unlocked parser.
- Normalize to an array: `const delegates = Array.isArray(turnOutcome.decision) ? turnOutcome.decision : [turnOutcome.decision]`.
- `dispatchCount += delegates.length` (guard still at `MAX_DISPATCH_PER_TURN`).
- Compute `parentDecisionId` and `parentDecisionArrayIndex` for each delegate (planner must resolve Open Question #1 from RESEARCH.md first).
- Dispatch all N delegates through the semaphore (see `concurrency.ts` pattern below).
- Merge all N `DispatchDelegateResult` objects into `dispatchInput` in **completion order** (D-10).

**Sibling-failure drain — new code, copy `sub-run-failed` emit shape** (lines 1024-1036):
```typescript
const failEvent: SubRunFailedEvent = {
  type: "sub-run-failed",
  runId: input.parentRunId,
  at: new Date().toISOString(),
  childRunId,
  parentRunId: input.parentRunId,
  parentDecisionId: input.parentDecisionId,
  error: errorPayload,
  partialTrace,
  partialCost
};
parentEmit(failEvent);
input.recordProtocolDecision(failEvent);
```

For synthetic `sibling-failed` events: `partialCost = emptyCost()` (D-09 note), `error.code: "aborted"`, `error.detail.reason: "sibling-failed"`.

---

### `src/runtime/concurrency.ts` (optional extract per D-08)

**No codebase analog.** This is the only genuinely new mechanism in Phase 3.

**Template from RESEARCH.md Pattern 2:**
```typescript
// src/runtime/concurrency.ts (or inline in coordinator.ts if ≤30 LOC)
interface Semaphore {
  acquire(): Promise<void>;  // waits until a slot is free
  release(): void;           // frees a slot, starts next waiter
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

**`sub-run-queued` emission gate:** Check `semaphore.inFlight >= effective` BEFORE `semaphore.acquire()`. Emit synchronously then await acquire. Ordering: `check-pressure → emit-sub-run-queued → await-acquire → emit-sub-run-started`. This prevents queued events appearing after started events.

---

### `src/runtime/validation.ts` — `validateProviderLocality` + `maxConcurrentChildren` validation

**Analog A:** `src/runtime/validation.ts:696-705` (`validatePositiveInteger` — reuse for `maxConcurrentChildren`)

**`validatePositiveInteger`** (lines 696-705):
```typescript
function validatePositiveInteger(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    invalidConfiguration({
      path,
      rule: "positive-integer",
      message: "value must be a positive integer.",
      expected: "integer >= 1",
      actual: value
    });
  }
}
```

**CRITICAL:** Use `validatePositiveInteger` (not `validateOptionalNonNegativeInteger`) for `maxConcurrentChildren`. `0` must be rejected. The `validateOptionalPositiveInteger` wrapper (lines 689-694) is available for the optional case:
```typescript
function validateOptionalPositiveInteger(value: unknown, path: string): void {
  if (value === undefined) { return; }
  validatePositiveInteger(value, path);
}
```

**Analog B:** Imports pattern (lines 1-16):
```typescript
import { DogpileError } from "../types.js";
import type { ConfiguredModelProvider, ... } from "../types.js";
```

**New `validateProviderLocality`** (engine-time defense-in-depth per D-03):
```typescript
// Called from engine entry paths (createEngine, run, stream, Dogpile.pile)
// after validateDogpileOptions / validateEngineOptions.
// Walk: options.model + options.agents (but AgentSpec has no .model today —
// see RESEARCH.md Pitfall 1; use optional chaining throughout).
export function validateProviderLocality(provider: ConfiguredModelProvider): void {
  const loc = provider.metadata?.locality;
  if (loc !== undefined && loc !== "local" && loc !== "remote") {
    invalidConfiguration({
      path: "model.metadata.locality",
      rule: "enum",
      message: "model.metadata.locality must be \"local\" or \"remote\" when provided.",
      expected: "\"local\" | \"remote\"",
      actual: loc
    });
  }
}
// For agent-level walk, use: (agent as { model?: ConfiguredModelProvider }).model?.metadata?.locality
// with a comment: "// AgentSpec.model forward-compat — not yet available (see Phase 3 D-11)"
```

---

### `src/runtime/defaults.ts` — three exhaustive switch updates

**Analog:** `src/runtime/defaults.ts:267-310, 338-465, 468-500` (three existing exhaustive switches)

**Switch 1: `createReplayTraceBudgetStateChanges`** (lines 267-310, last case at lines 303-308):
```typescript
// Current last cases in the switch (lines 303-308):
case "sub-run-parent-aborted":
case "sub-run-budget-clamped":
  return [];

// Phase 3 additions — slot beside sub-run-budget-clamped:
case "sub-run-queued":
case "sub-run-concurrency-clamped":
  return [];
```

**Switch 2: `createReplayTraceProtocolDecision`** (lines 338-465, last case at lines 461-464):
```typescript
// Current last case (lines 461-464):
case "sub-run-budget-clamped":
  return {
    ...base
  };

// Phase 3 additions:
case "sub-run-queued":
  return {
    ...base,
    childRunId: event.childRunId,
    queuePosition: event.queuePosition
  };
case "sub-run-concurrency-clamped":
  return {
    ...base
  };
```

**Switch 3: `defaultProtocolDecision`** (lines 468-500, last case at line 499):
```typescript
// Current last case (line 499):
case "sub-run-budget-clamped":
  return "mark-sub-run-budget-clamped";

// Phase 3 additions:
case "sub-run-queued":
  return "queue-sub-run";
case "sub-run-concurrency-clamped":
  return "mark-sub-run-concurrency-clamped";
```

**Also update `ReplayTraceProtocolDecisionType`** (imported from `src/types.ts`, used as return type of `defaultProtocolDecision`). Add two new string literals: `"queue-sub-run"` and `"mark-sub-run-concurrency-clamped"`. Planner: verify whether this type is declared as an explicit union in `src/types.ts` or is `string` — if it's an explicit union, both new literals must be added there.

---

### `src/runtime/engine.ts` — `maxConcurrentChildren` threading

**Analog:** `src/runtime/engine.ts:74,81-84` (`engineMaxDepth`/`effectiveMaxDepth` — Phase 1 D-13 exact precedent)

**`maxDepth` threading** (lines 74, 81-84):
```typescript
// engine.ts:74 — engine-level resolution
const engineMaxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

// engine.ts:81-84 — per-run effective resolution (per-run can only lower)
const effectiveMaxDepth = Math.min(
  engineMaxDepth,
  runOptions?.maxDepth ?? Number.POSITIVE_INFINITY
);
```

**Copy exactly for `maxConcurrentChildren`:**
```typescript
// engine.ts — engine-level default
const DEFAULT_MAX_CONCURRENT_CHILDREN = 4;  // D-05
const engineMaxConcurrentChildren = options.maxConcurrentChildren ?? DEFAULT_MAX_CONCURRENT_CHILDREN;

// per-run effective (lower only)
const effectiveMaxConcurrentChildren = Math.min(
  engineMaxConcurrentChildren,
  runOptions?.maxConcurrentChildren ?? Number.POSITIVE_INFINITY
);

// Thread into runNonStreamingProtocol/coordinator options:
effectiveMaxConcurrentChildren,
```

**Decision-level resolution** (in `dispatchDelegate` or fan-out loop):
```typescript
const effective = Math.min(
  effectiveMaxConcurrentChildren,   // from engine/per-run
  decision.maxConcurrentChildren ?? Number.POSITIVE_INFINITY  // per-decision (D-05)
);
```

---

### `src/tests/event-schema.test.ts` — add two new event types to `expectedEventTypes`

**Analog:** `src/tests/event-schema.test.ts:37-53` (existing `expectedEventTypes` array)

**Current array** (lines 37-53):
```typescript
const expectedEventTypes = [
  "role-assignment",
  "model-request",
  "model-response",
  "model-output-chunk",
  "tool-call",
  "tool-result",
  "agent-turn",
  "broadcast",
  "sub-run-started",
  "sub-run-completed",
  "sub-run-failed",
  "sub-run-parent-aborted",
  "sub-run-budget-clamped",
  "budget-stop",
  "final"
] as const satisfies readonly RunEvent["type"][];
```

**Phase 3 additions:** Insert `"sub-run-queued"` after `"sub-run-budget-clamped"` and `"sub-run-concurrency-clamped"` after `"sub-run-queued"`. Also add `SubRunQueuedEvent` and `SubRunConcurrencyClampedEvent` to the `import type { ... }` block at lines 8-35. The `as const satisfies readonly RunEvent["type"][]` constraint ensures TS exhaustiveness.

---

### `src/tests/result-contract.test.ts` — import new event types

**Analog:** `src/tests/result-contract.test.ts:1-41` (existing import block + `SubRunBudgetClampedEvent` usage)

**Existing sub-run type imports** (lines 35-40):
```typescript
import type {
  ...
  SubRunBudgetClampedEvent,
  SubRunCompletedEvent,
  SubRunFailedEvent,
  SubRunParentAbortedEvent,
  ...
} from "../index.js";
```

**Phase 3 additions:** Add `SubRunQueuedEvent` and `SubRunConcurrencyClampedEvent` to the import block. Add corresponding type-usage assertions in the result-contract test body mirroring the existing `SubRunBudgetClampedEvent` usage pattern (type variable declarations that force the import to be load-bearing).

---

### `src/tests/config-validation.test.ts` — locality + maxConcurrentChildren validation cases

**Analog:** `src/tests/config-validation.test.ts:39-79` (parameterized `invalidDogpileOptionCases` array)

**Test-case array pattern** (lines 39-79):
```typescript
const invalidDogpileOptionCases = [
  {
    name: "missing options object",
    options: undefined,
    path: "options"
  },
  {
    name: "non-positive protocol turn limit",
    options: optionsWith({ protocol: { kind: "sequential", maxTurns: 0 } }),
    path: "protocol.maxTurns"
  },
  // ...
];
```

**Phase 3 additions follow the same object shape:**
```typescript
{
  name: "invalid locality string on model provider",
  options: optionsWith({ model: { id: "m", generate: async () => ({ text: "ok" }), metadata: { locality: "INVALID" } } }),
  path: "model.metadata.locality"
},
{
  name: "maxConcurrentChildren zero (not a positive integer)",
  options: optionsWith({ maxConcurrentChildren: 0 }),
  path: "maxConcurrentChildren"
},
{
  name: "maxConcurrentChildren negative",
  options: optionsWith({ maxConcurrentChildren: -1 }),
  path: "maxConcurrentChildren"
},
{
  name: "per-run maxConcurrentChildren exceeds engine ceiling",
  // validated via createEngine().run() not run() directly — use engineOptions path
  path: "maxConcurrentChildren"
},
```

---

### `src/tests/cancellation-contract.test.ts` — sibling-failed + local-provider-detected detail.reason

**Analog:** `src/tests/cancellation-contract.test.ts:20-58` (existing describe/it structure)

**Test structure** (lines 20-58):
```typescript
describe("caller cancellation contract", () => {
  it("propagates run() caller AbortSignal into the in-flight provider fetch", async () => {
    // ... probe pattern + expect(result).rejects.toMatchObject({
    //   code: "aborted",
    //   detail: { reason: "..." }
    // })
  });
```

**Phase 3 additions follow the same `expect(result).rejects.toMatchObject` + `detail.reason` assertion pattern:**
```typescript
// New: sibling-failed synthetic event detail
it("drains queued delegates with synthetic sub-run-failed when a sibling fails", async () => {
  // coordinator dispatches 3 delegates; semaphore allows 1; first fails
  // expect events to include sub-run-failed with:
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "sub-run-failed",
        error: expect.objectContaining({
          code: "aborted",
          detail: expect.objectContaining({ reason: "sibling-failed" })
        }),
        partialCost: emptyCost()
      })
    ])
  );
});

// New: local-provider-detected event
it("emits subRun.concurrencyClamped once when a local provider is detected", async () => {
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "sub-run-concurrency-clamped",
        reason: "local-provider-detected",
        effectiveMax: 1
      })
    ])
  );
});
```

---

## Shared Patterns

### `DogpileError` construction
**Source:** `src/providers/openai-compatible.ts:159-170` and `src/runtime/coordinator.ts:853-860`
**Apply to:** All new validation throws in `openai-compatible.ts`, `validation.ts`, `coordinator.ts`

```typescript
// All new invalid-configuration throws use exactly this shape:
throw new DogpileError({
  code: "invalid-configuration",   // or "aborted" for sibling-failed drain
  message: "...",
  retryable: false,
  detail: {
    kind: "configuration-validation",  // or "delegate-validation"
    path: "...",
    expected: "...",
    // optional: reason, host, actual
  }
});
```

### Emit-before-`sub-run-started` ordering
**Source:** `src/runtime/coordinator.ts:908-940`
**Apply to:** `subRun.concurrencyClamped` event (Plan 03-03), `sub-run-queued` event (Plan 03-02)

The budget-clamp emit at lines 908-925 establishes the canonical ordering: clamp/queued event → `sub-run-started`. For `sub-run-concurrency-clamped`, emit before `sub-run-started` in `dispatchDelegate`. For `sub-run-queued`, emit before `semaphore.acquire()` in the fan-out loop.

### Per-run closure-local state flag
**Source:** `src/runtime/coordinator.ts:139-158` (run-level accumulators: `events`, `transcript`, `totalCost`, etc.)
**Apply to:** `concurrencyClampEmitted` flag (D-12 single-emit)

```typescript
// All per-run state lives as closure-local variables inside runCoordinator:
const events: RunEvent[] = [];
let totalCost = emptyCost();
// Phase 3 adds:
let concurrencyClampEmitted = false;  // D-12: emit once per run, never per-engine
```

### ESM `.js` extension in relative imports
**Source:** `src/runtime/coordinator.ts:1` / `src/providers/openai-compatible.ts:1`
**Apply to:** All new files and imports

All relative imports use `.js` extensions even though source is `.ts` (TypeScript resolves through `.js`). Example: `import { DogpileError } from "../types.js"`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/runtime/concurrency.ts` (optional) | utility | event-driven | Hand-rolled semaphore; no existing concurrency primitive in the codebase. Use RESEARCH.md Pattern 2 directly. |
| `classifyHostLocality` (in `openai-compatible.ts`) | utility | transform | No IP/hostname classification exists anywhere. Use RESEARCH.md Pattern 3 + D-02 ranges. |

---

## Critical Pre-Planning Decisions (Planner Must Lock Before Wave 1)

1. **`parentDecisionArrayIndex` vs composite `parentDecisionId` string** (RESEARCH.md Open Question #1, blocks Plan 03-02 Wave 1): Additive `parentDecisionArrayIndex: number` field is recommended (non-breaking, new optional field on `sub-run-queued`/`sub-run-started`/`sub-run-completed`/`sub-run-failed`). Composite string `"${planTurnEventIndex}-${delegateArrayIndex}"` changes the format of an existing field. Both are viable; planner must choose and reflect in Plan 03-02 task 1 before any fan-out code is written.

2. **`ReplayTraceProtocolDecisionType` union update**: Verify in `src/types.ts` whether this type is an explicit string union (requiring two new literals) or `string`. Add `"queue-sub-run"` and `"mark-sub-run-concurrency-clamped"` if explicit.

3. **`concurrency-contract.test.ts` promotion threshold** (D-15): If coordinator.test.ts concurrency additions exceed ~150 new LOC, extract contract guarantees to `src/tests/concurrency-contract.test.ts`. Scenario tests stay in `coordinator.test.ts` regardless.

---

## Metadata

**Analog search scope:** `src/runtime/`, `src/providers/`, `src/tests/`, `src/types/`, `src/types.ts`
**Files scanned:** 14 source files + 5 test files
**Pattern extraction date:** 2026-04-30
