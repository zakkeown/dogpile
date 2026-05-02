# Phase 10: Metrics / Counters - Pattern Map

**Mapped:** 2026-05-01
**Files analyzed:** 11 new/modified files
**Analogs found:** 11 / 11 (2 partial-only, listed under No Analog / Partial section)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/runtime/metrics.ts` | utility (type module) | transform | `src/runtime/tracing.ts` (lines 1–36) | exact |
| `src/runtime/metrics.test.ts` | test (unit, co-located) | — | `src/runtime/tracing.test.ts` (lines 1–58) | exact |
| `src/tests/metrics-contract.test.ts` | test (integration/contract) | event-driven | `src/tests/otel-tracing-contract.test.ts` (lines 1–181) | role-match |
| `src/tests/fixtures/metrics-snapshot-v1.json` | config (frozen fixture) | — | `src/tests/fixtures/audit-record-v1.json` (lines 1–19) | exact |
| `src/tests/fixtures/metrics-snapshot-v1.type-check.ts` | test (compile-time) | — | `src/tests/fixtures/audit-record-v1.type-check.ts` (lines 1–24) | exact |
| `src/runtime/engine.ts` | orchestrator | request-response | self — Phase 9 tracing touchpoints (lines 711–1046) | exact |
| `src/types.ts` | model | — | self — Phase 9 `tracer?` additions (lines 1887–1895, 2000–2008) | exact |
| `package.json` | config | — | self — `./runtime/tracing` entry (lines 93–97) | exact |
| `src/tests/package-exports.test.ts` | test (contract) | — | self — `./runtime/tracing` assertions (lines 1331–1335) | exact |
| `CHANGELOG.md` | docs | — | Phase 9 entry (lines 37–51) | exact |
| `CLAUDE.md` | docs | — | Phase 9 invariant chain addition | exact |

---

## Pattern Assignments

### `src/runtime/metrics.ts` (utility, type module)

**Analog:** `src/runtime/tracing.ts` (lines 1–36) — which was itself modeled on `src/runtime/provenance.ts`

**Full module shape to copy** (tracing.ts lines 1–36):
```typescript
// Complete file structure — one declaration block, no Node-only deps, no side effects
export interface DogpileSpan {
  end(): void;
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(code: "ok" | "error", message?: string): void;
}

export interface DogpileSpanOptions {
  readonly parent?: DogpileSpan;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface DogpileTracer {
  startSpan(name: string, options?: DogpileSpanOptions): DogpileSpan;
}

export const DOGPILE_SPAN_NAMES = {
  RUN: "dogpile.run",
  SUB_RUN: "dogpile.sub-run",
  AGENT_TURN: "dogpile.agent-turn",
  MODEL_CALL: "dogpile.model-call"
} as const;

export type DogpileSpanName = (typeof DOGPILE_SPAN_NAMES)[keyof typeof DOGPILE_SPAN_NAMES];
```

**Phase 10 translation — `metrics.ts` exports:**
```typescript
// src/runtime/metrics.ts — no imports required (all primitives)

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

**Conventions:**
- No imports (all fields are primitive — unlike `tracing.ts` which has no imports either)
- All interface fields are `readonly`
- No Node-only deps, no side effects, no storage, no class, no singleton
- ESM `.js` extension not needed here since there are no relative imports
- Two exported interfaces, no helper functions, no constants needed

---

### `src/runtime/engine.ts` — Touchpoint 1: `RunProtocolOptions` internal type (lines 651–707)

**Analog:** `src/runtime/engine.ts` lines 692–706 (existing `tracer?` and `parentSpan?` optional field additions)

**Existing optional field block at end of `RunProtocolOptions`** (lines 690–706):
```typescript
  readonly registerAbortDrain?: (drain: AbortDrainFn) => void;
  readonly failureInstancesByChildRunId?: Map<string, DogpileError>;
  readonly tracer?: EngineOptions["tracer"];
  /**
   * Optional parent span for the next runProtocol invocation. Threaded by the
   * coordinator when dispatching child runs so that the child's `dogpile.run`
   * span is correctly nested under its parent's `dogpile.sub-run` span.
   * Internal-only; not part of the public surface.
   */
  readonly parentSpan?: DogpileSpan;
  /**
   * Per-child sub-run span lookup, keyed by childRunId. Populated by the
   * parent's emit closure on `sub-run-started`. The coordinator dispatcher
   * reads this to thread the correct per-child span as parent for the
   * recursive runProtocol call. Internal-only.
   */
  readonly subRunSpansByChildId?: ReadonlyMap<string, DogpileSpan>;
}
```

**Add** these two fields after `tracer?` using the same optional readonly pattern:
```typescript
  readonly metricsHook?: EngineOptions["metricsHook"];
  readonly logger?: EngineOptions["logger"];
```

Import `MetricsHook` from `./metrics.js` as a type-only import. `Logger` is imported from `./logger.js` (already present at engine.ts line 1 area — verify existing imports before adding).

---

### `src/runtime/engine.ts` — Touchpoint 2: `MetricsState` internal helper type + `openRunMetrics` factory

**Analog:** `src/runtime/engine.ts` lines 711–752 (`TracingState` interface + `openRunTracing` factory function)

**Direct analog — `TracingState` / `openRunTracing` pattern** (lines 711–752):
```typescript
interface TracingState {
  readonly tracer: DogpileTracer;
  readonly runSpan: DogpileSpan;
  readonly subRunSpans: Map<string, DogpileSpan>;
  // ... more maps ...
}

function openRunTracing(options: {
  readonly tracer?: DogpileTracer;
  // ...
}): TracingState | undefined {
  if (!options.tracer) {
    return undefined;           // zero-overhead fast path
  }
  // ... build state ...
  return { tracer: options.tracer, runSpan, ... };
}
```

**Phase 10 translation — `MetricsState` / `openRunMetrics`:**
```typescript
interface MetricsState {
  readonly metricsHook: MetricsHook;
  readonly logger: Logger;
  readonly startedAtMs: number;
  readonly subRunStartTimes: Map<string, number>;  // childRunId → startMs
}

function openRunMetrics(options: {
  readonly metricsHook?: MetricsHook;
  readonly logger?: Logger;
}): MetricsState | undefined {
  if (!options.metricsHook) {
    return undefined;           // zero-overhead fast path — no allocations when hook absent
  }
  return {
    metricsHook: options.metricsHook,
    logger: options.logger ?? noopLogger,
    startedAtMs: Date.now(),
    subRunStartTimes: new Map()
  };
}
```

Note: `noopLogger` is imported from `./logger.js` (already in engine.ts import list — verify).

---

### `src/runtime/engine.ts` — Touchpoint 3: `handleMetricsEvent` helper + `closeRunMetrics` helper

**Analog:** `src/runtime/engine.ts` lines 754–912 (`handleTracingEvent` + `closeRunTracing` + `closeOpenTracingSpans`)

**`handleTracingEvent` structure to mirror** (lines 754–864):
```typescript
function handleTracingEvent(state: TracingState, event: RunEvent): void {
  const parentRunIds = (event as { readonly parentRunIds?: readonly string[] }).parentRunIds;
  if (parentRunIds !== undefined) {
    return;   // ignore bubbled child events — only handle own events
  }

  switch (event.type) {
    case "sub-run-started": { /* open span + record in map */ break; }
    case "sub-run-completed": { /* close span */ break; }
    case "sub-run-failed": { /* close span with error */ break; }
    default: break;
  }
}
```

**Phase 10 `handleMetricsEvent` translation:**
```typescript
function handleMetricsEvent(state: MetricsState, event: RunEvent): void {
  const parentRunIds = (event as { readonly parentRunIds?: readonly string[] }).parentRunIds;
  if (parentRunIds !== undefined) {
    return;   // same guard as tracing — ignore bubbled child events
  }

  switch (event.type) {
    case "sub-run-started": {
      state.subRunStartTimes.set(event.childRunId, Date.now());
      break;
    }
    case "sub-run-completed": {
      // NOTE: D-11 open question — see OQ-1 below before implementing
      const startMs = state.subRunStartTimes.get(event.childRunId);
      const durationMs = startMs !== undefined ? Date.now() - startMs : 0;
      state.subRunStartTimes.delete(event.childRunId);
      const snapshot = buildSubRunSnapshot(event.subResult, durationMs);
      fireHook(state.metricsHook.onSubRunComplete, snapshot, state.logger);
      break;
    }
    default:
      break;
  }
}
```

**`closeRunTracing` outcome derivation to copy verbatim** (lines 866–897):
```typescript
// engine.ts lines 881–884 — source of outcome detection for RunMetricsSnapshot.outcome
const budgetStopEvent = result.trace.events.find(
  (event): event is BudgetStopEvent => event.type === "budget-stop"
);
const terminationReason = budgetStopEvent?.reason;
const outcome = terminationReason !== undefined ? "budget-stopped" : "completed";
```

**Phase 10 `closeRunMetrics` translation:**
```typescript
function closeRunMetrics(
  state: MetricsState,
  result: RunResult | undefined,
  error?: unknown
): void {
  const durationMs = Date.now() - state.startedAtMs;
  const snapshot = buildRunSnapshot(result, durationMs, error);
  fireHook(state.metricsHook.onRunComplete, snapshot, state.logger);
}
```

---

### `src/runtime/engine.ts` — Touchpoint 4: Fire-and-forget `fireHook` helper

**No direct codebase analog.** Closest existing pattern is the synchronous try/catch in `src/runtime/logger.ts` lines 105–117 (`loggerFromEvents` subscriber isolation):

```typescript
// logger.ts lines 105–117 — sync try/catch isolation, NOT async
try {
  logger[level](message, fields);
} catch (cause) {
  try {
    logger.error("dogpile logger threw while handling event", { ... });
  } catch {
    // Swallow
  }
}
```

**Phase 10 `fireHook` must be async-aware** (no existing analog — construct from spec):
```typescript
function fireHook(
  callback: ((snapshot: RunMetricsSnapshot) => void | Promise<void>) | undefined,
  snapshot: RunMetricsSnapshot,
  logger: Logger
): void {
  if (!callback) return;
  try {
    const result = callback(snapshot);
    if (result instanceof Promise) {
      result.catch((err: unknown) => {
        logger.error("dogpile:metricsHook threw", {
          error: err instanceof Error ? err.message : String(err)
        });
      });
    }
  } catch (err: unknown) {
    logger.error("dogpile:metricsHook threw", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
```

This is the only new pattern without a codebase analog. The `.catch()` attachment on a returned Promise has no precedent in `src/runtime/` — confirm with `grep -rn "\.catch(" src/runtime/` (returns empty as of 2026-05-01).

---

### `src/runtime/engine.ts` — Touchpoint 5: `runProtocol` integration (lines 1010–1046)

**Analog:** `src/runtime/engine.ts` lines 1010–1046 (Phase 9 tracing integration in `runProtocol`)

**Existing `runProtocol` structure** (lines 1010–1046):
```typescript
async function runProtocol(options: RunProtocolOptions): Promise<RunResult> {
  const tracing = openRunTracing({
    ...(options.tracer ? { tracer: options.tracer } : {}),
    ...(options.parentSpan ? { parentSpan: options.parentSpan } : {}),
    intent: options.intent,
    protocolKind: options.protocol.kind,
    tier: options.tier
  });
  const emitForProtocol =
    tracing || options.emit
      ? (event: RunEvent): void => {
        if (tracing) {
          handleTracingEvent(tracing, event);
        }
        options.emit?.(event);
      }
      : undefined;
  // ...
  try {
    const result = await runProtocolInner(protocolOptions, emitForProtocol);
    if (tracing) {
      closeRunTracing(tracing, result);
    }
    return result;
  } catch (error) {
    if (tracing) {
      closeRunTracing(tracing, undefined, error);
    }
    throw error;
  }
}
```

**Phase 10 addition — parallel `metrics` alongside `tracing`:**

Add `openRunMetrics(...)` call alongside `openRunTracing(...)`. Extend `emitForProtocol` to call `handleMetricsEvent(metrics, event)`. Add `closeRunMetrics(metrics, result)` in the try path and `closeRunMetrics(metrics, undefined, error)` in the catch path — mirroring tracing exactly.

```typescript
async function runProtocol(options: RunProtocolOptions): Promise<RunResult> {
  const tracing = openRunTracing({ ... });
  const metrics = openRunMetrics({          // ← new: parallel to openRunTracing
    ...(options.metricsHook ? { metricsHook: options.metricsHook } : {}),
    ...(options.logger ? { logger: options.logger } : {})
  });
  const emitForProtocol =
    tracing || metrics || options.emit      // ← add metrics to the OR chain
      ? (event: RunEvent): void => {
        if (tracing) { handleTracingEvent(tracing, event); }
        if (metrics) { handleMetricsEvent(metrics, event); } // ← new
        options.emit?.(event);
      }
      : undefined;
  // ...
  try {
    const result = await runProtocolInner(protocolOptions, emitForProtocol);
    if (tracing) { closeRunTracing(tracing, result); }
    if (metrics) { closeRunMetrics(metrics, result); }  // ← new
    return result;
  } catch (error) {
    if (tracing) { closeRunTracing(tracing, undefined, error); }
    if (metrics) { closeRunMetrics(metrics, undefined, error); }  // ← new
    throw error;
  }
}
```

---

### `src/runtime/engine.ts` — Touchpoint 6: Coordinator child dispatch threading (lines 1113–1122)

**Analog:** `src/runtime/engine.ts` lines 1113–1122 (Phase 9 `tracer` threading into recursive `runProtocol`)

**Existing recursive dispatch** (lines 1113–1122):
```typescript
runProtocol: (childInput) => {
  const { runId: childRunId, ...childProtocolInput } = childInput;
  const childParent = options.subRunSpansByChildId?.get(childRunId) ?? options.parentSpan;
  return runProtocol({
    ...childProtocolInput,
    protocol: normalizeProtocol(childProtocolInput.protocol),
    ...(options.tracer ? { tracer: options.tracer } : {}),
    ...(childParent ? { parentSpan: childParent } : {})
  });
}
```

**Phase 10 addition** — add `metricsHook` and `logger` threading:
```typescript
runProtocol: (childInput) => {
  const { runId: childRunId, ...childProtocolInput } = childInput;
  const childParent = options.subRunSpansByChildId?.get(childRunId) ?? options.parentSpan;
  return runProtocol({
    ...childProtocolInput,
    protocol: normalizeProtocol(childProtocolInput.protocol),
    ...(options.tracer ? { tracer: options.tracer } : {}),
    ...(childParent ? { parentSpan: childParent } : {}),
    ...(options.metricsHook ? { metricsHook: options.metricsHook } : {}),  // ← new
    ...(options.logger ? { logger: options.logger } : {})                   // ← new
  });
}
```

**Flag to planner:** This threading means `onRunComplete` fires for child sub-runs as well as the root run. See OQ-1 below.

---

### `src/runtime/engine.ts` — Touchpoint 7: `createEngine` threading (lines 138, 267)

**Analog:** `src/runtime/engine.ts` lines 138, 267 (existing `tracer` conditional spreads in `createEngine.run()` and `createEngine.stream()` paths)

**Existing pattern** (line 138):
```typescript
...(options.tracer ? { tracer: options.tracer } : {}),
```

**Phase 10 addition** — same pattern for both fields at both sites:
```typescript
...(options.metricsHook ? { metricsHook: options.metricsHook } : {}),
...(options.logger ? { logger: options.logger } : {}),
```

---

### `src/types.ts` — `EngineOptions` and `DogpileOptions` field additions (lines 1895, 2008)

**Analog:** `src/types.ts` lines 1887–1895 (existing `tracer?` block on `EngineOptions`) and lines 2000–2008 (same on `DogpileOptions`)

**Existing import at line 1** (to copy for Logger):
```typescript
import type { DogpileTracer } from "./runtime/tracing.js";
```

**Phase 10 addition** — add `Logger` import alongside `DogpileTracer`:
```typescript
import type { DogpileTracer } from "./runtime/tracing.js";
import type { Logger } from "./runtime/logger.js";       // ← new
import type { MetricsHook } from "./runtime/metrics.js"; // ← new
```

**Existing `tracer?` field pattern** (lines 1887–1895) to copy for both new fields:
```typescript
/**
 * Optional duck-typed OTEL-compatible tracer. When provided, the SDK emits
 * spans for run start/end, sub-run start/end, agent-turn start/end, and
 * model-call start/end with correct parent-child ancestry. When absent the
 * run completes with zero span overhead — no allocations, no branch cost.
 * `replay()` and `replayStream()` ignore this field entirely.
 * See {@link DogpileTracer} in `@dogpile/sdk/runtime/tracing`.
 */
readonly tracer?: DogpileTracer;
```

**New fields to add** (after `tracer?`, before `maxDepth?`) on both `EngineOptions` and `DogpileOptions`:
```typescript
/**
 * Optional callback object for run-completion metrics. When provided,
 * `onRunComplete` fires with a `RunMetricsSnapshot` at every terminal state
 * (completed, budget-stopped, or aborted). `onSubRunComplete` fires for each
 * coordinator-dispatched child run that completes. Hook errors are routed to
 * `logger.error` (or `console.error` when no logger is provided) and never
 * propagate into the run result. When absent, zero overhead — no allocations.
 * See `@dogpile/sdk/runtime/metrics` for the interface.
 */
readonly metricsHook?: MetricsHook;
/**
 * Optional structured logger for SDK-internal diagnostics (hook errors,
 * future debug/info events). Implement against pino, winston, or any other
 * logger by satisfying the `Logger` interface. When absent, hook errors fall
 * back to `console.error`. See `@dogpile/sdk/runtime/logger` for the interface.
 */
readonly logger?: Logger;
```

---

### `src/runtime/metrics.test.ts` (co-located unit test)

**Analog:** `src/runtime/tracing.test.ts` (lines 1–58)

**Imports pattern** (tracing.test.ts lines 1–7):
```typescript
import { describe, expect, it } from "vitest";
import {
  DOGPILE_SPAN_NAMES,
  type DogpileSpan,
  type DogpileSpanOptions,
  type DogpileTracer
} from "./tracing.js";
```

**Phase 10 translation:**
```typescript
import { describe, expect, it } from "vitest";
import {
  type MetricsHook,
  type RunMetricsSnapshot
} from "./metrics.js";
```

**Test structure to copy** (tracing.test.ts lines 9–58):
```typescript
describe("MetricsHook / RunMetricsSnapshot structural types", () => {
  it("a minimal RunMetricsSnapshot satisfies the interface (compile-time)", () => {
    const snapshot: RunMetricsSnapshot = {
      outcome: "completed",
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
      totalInputTokens: 10,
      totalOutputTokens: 5,
      totalCostUsd: 0.001,
      turns: 2,
      durationMs: 1500
    };
    expect(typeof snapshot.outcome).toBe("string");
    expect(typeof snapshot.durationMs).toBe("number");
  });

  it("a MetricsHook with both callbacks satisfies the interface (compile-time)", () => {
    const hook: MetricsHook = {
      onRunComplete(_snapshot: RunMetricsSnapshot): void {},
      onSubRunComplete(_snapshot: RunMetricsSnapshot): void {}
    };
    expect(typeof hook.onRunComplete).toBe("function");
  });

  it("a MetricsHook with no callbacks satisfies the interface (compile-time)", () => {
    const hook: MetricsHook = {};
    expect(hook.onRunComplete).toBeUndefined();
    expect(hook.onSubRunComplete).toBeUndefined();
  });

  it("RunMetricsSnapshot accepts all three outcome values", () => {
    const outcomes: RunMetricsSnapshot["outcome"][] = ["completed", "budget-stopped", "aborted"];
    expect(outcomes).toHaveLength(3);
  });
});
```

---

### `src/tests/metrics-contract.test.ts` (integration/contract test)

**Analog:** `src/tests/otel-tracing-contract.test.ts` (lines 1–181)

**Imports pattern** (otel-tracing-contract.test.ts lines 8–19):
```typescript
import { describe, expect, it } from "vitest";
import { run } from "../runtime/engine.js";
import {
  type MetricsHook,
  type RunMetricsSnapshot
} from "../runtime/metrics.js";
import {
  createDelegatingDeterministicProvider,
  createDeterministicModelProvider
} from "../testing/deterministic-provider.js";
```

**Test structure** (modeled on otel-tracing-contract.test.ts lines 69–181):
```typescript
describe("MetricsHook contract", () => {
  it("calls onRunComplete with outcome=completed on a successful run", async () => {
    const snapshots: RunMetricsSnapshot[] = [];
    await run({
      intent: "metrics test",
      model: createDeterministicModelProvider("metrics-test-model"),
      protocol: { kind: "sequential", maxTurns: 1 },
      metricsHook: { onRunComplete(s) { snapshots.push(s); } }
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.outcome).toBe("completed");
    expect(snapshots[0]!.durationMs).toBeTypeOf("number");
    expect(snapshots[0]!.turns).toBeTypeOf("number");
    expect(snapshots[0]!.totalCostUsd).toBeTypeOf("number");
  });

  it("calls onSubRunComplete for each coordinator-dispatched child run", async () => {
    const subSnapshots: RunMetricsSnapshot[] = [];
    await run({
      intent: "sub-run metrics",
      model: createDelegatingDeterministicProvider({ id: "metrics-02-parent" }),
      protocol: { kind: "coordinator", maxTurns: 2 },
      metricsHook: { onSubRunComplete(s) { subSnapshots.push(s); } }
    });
    expect(subSnapshots.length).toBeGreaterThanOrEqual(1);
    expect(subSnapshots[0]!.outcome).toBe("completed");
    expect(subSnapshots[0]!.durationMs).toBeTypeOf("number");
  });

  it("emits no overhead when metricsHook is absent", async () => {
    const result = await run({
      intent: "no-hook baseline",
      model: createDeterministicModelProvider("no-hook"),
      protocol: { kind: "sequential", maxTurns: 1 }
    });
    expect(result.trace.runId).toBeTypeOf("string");
    expect(result.health).toBeDefined();
  });

  it("keeps the RunResult shape unchanged when metricsHook is present", async () => {
    const withoutHook = await run({
      intent: "shape",
      model: createDeterministicModelProvider("shape-without-hook"),
      protocol: { kind: "sequential", maxTurns: 1 }
    });
    const withHook = await run({
      intent: "shape",
      model: createDeterministicModelProvider("shape-with-hook"),
      protocol: { kind: "sequential", maxTurns: 1 },
      metricsHook: { onRunComplete() {} }
    });
    expect(Object.keys(withHook).sort()).toEqual(Object.keys(withoutHook).sort());
  });

  it("swallows a synchronously throwing hook without propagating to run result", async () => {
    let threw = false;
    const result = await run({
      intent: "throwing hook",
      model: createDeterministicModelProvider("throwing-hook"),
      protocol: { kind: "sequential", maxTurns: 1 },
      metricsHook: {
        onRunComplete() {
          threw = true;
          throw new Error("hook error");
        }
      }
    });
    expect(threw).toBe(true);
    expect(result.trace.runId).toBeTypeOf("string");
  });
});
```

---

### `src/tests/fixtures/metrics-snapshot-v1.json` (frozen fixture)

**Analog:** `src/tests/fixtures/audit-record-v1.json` (lines 1–19)

**Structure to copy** (audit-record-v1.json full file):
```json
{
  "auditSchemaVersion": "1",
  "runId": "audit-record-fixture-run-id",
  "intent": "Test audit record shape",
  ...
}
```

**Phase 10 translation — `metrics-snapshot-v1.json`:**
```json
{
  "outcome": "completed",
  "inputTokens": 21,
  "outputTokens": 12,
  "costUsd": 0.0003,
  "totalInputTokens": 21,
  "totalOutputTokens": 12,
  "totalCostUsd": 0.0003,
  "turns": 3,
  "durationMs": 1500
}
```

Values should be non-zero to exercise the full shape. Use the same token/cost values as `audit-record-v1.json` for consistency (`inputTokens: 21`, `outputTokens: 12`, `usd: 0.0003`).

---

### `src/tests/fixtures/metrics-snapshot-v1.type-check.ts` (compile-time type check)

**Analog:** `src/tests/fixtures/audit-record-v1.type-check.ts` (lines 1–24)

**Exact pattern to copy** (audit-record-v1.type-check.ts full file):
```typescript
import type { AuditRecord } from "../../runtime/audit.js";

// Inline object mirrors audit-record-v1.json exactly.
// Update this object whenever the fixture changes.
// This file is never imported at runtime - it exists only for tsc --noEmit coverage.
const _fixture = {
  auditSchemaVersion: "1",
  ...
} satisfies AuditRecord;
```

**Phase 10 translation:**
```typescript
import type { RunMetricsSnapshot } from "../../runtime/metrics.js";

// Inline object mirrors metrics-snapshot-v1.json exactly.
// Update this object whenever the fixture changes.
// This file is never imported at runtime - it exists only for tsc --noEmit coverage.
const _fixture = {
  outcome: "completed",
  inputTokens: 21,
  outputTokens: 12,
  costUsd: 0.0003,
  totalInputTokens: 21,
  totalOutputTokens: 12,
  totalCostUsd: 0.0003,
  turns: 3,
  durationMs: 1500
} satisfies RunMetricsSnapshot;
```

The `satisfies` keyword (not `as`) ensures compile-time type narrowing without widening. Matches audit-record and provenance fixture conventions exactly.

---

### `package.json` — `/runtime/metrics` subpath wiring

**Analog:** `package.json` lines 93–97 (`./runtime/tracing` entry) and lines 190 (`"src/runtime/tracing.ts"` in files array)

**Exact pattern to copy** (lines 93–97):
```json
"./runtime/tracing": {
  "types": "./dist/runtime/tracing.d.ts",
  "import": "./dist/runtime/tracing.js",
  "default": "./dist/runtime/tracing.js"
}
```

**New entry** (insert between `./runtime/logger` at line 103 and `./runtime/model` based on alphabetical order `metrics` < `model`):
```json
"./runtime/metrics": {
  "types": "./dist/runtime/metrics.d.ts",
  "import": "./dist/runtime/metrics.js",
  "default": "./dist/runtime/metrics.js"
}
```

**Files array addition** (follow line 190 `"src/runtime/tracing.ts"` pattern; insert near `logger` and `tracing` entries):
```json
"src/runtime/metrics.ts"
```

---

### `src/tests/package-exports.test.ts` — `/runtime/metrics` subpath assertions

**Analog:** `src/tests/package-exports.test.ts` lines 1331–1335 (`./runtime/tracing` assertion block)

**Exact pattern to copy** (lines 1331–1335):
```typescript
"./runtime/tracing": {
  types: "./dist/runtime/tracing.d.ts",
  import: "./dist/runtime/tracing.js",
  default: "./dist/runtime/tracing.js"
},
```

**New entry** (insert adjacent to `./runtime/logger` and `./runtime/tracing` assertions):
```typescript
"./runtime/metrics": {
  types: "./dist/runtime/metrics.d.ts",
  import: "./dist/runtime/metrics.js",
  default: "./dist/runtime/metrics.js"
},
```

**Type-check import addition** — analog: lines 38 and 1536–1549 (`DogpileSpan`/`DogpileTracer` type-check stubs)

```typescript
// Add near line 38 with other type imports:
import type { MetricsHook, RunMetricsSnapshot } from "@dogpile/sdk/runtime/metrics";

// Add in the type-check assertion block near lines 1536–1549:
const metricsSnapshot: RunMetricsSnapshot = {
  outcome: "completed",
  inputTokens: 10,
  outputTokens: 5,
  costUsd: 0.001,
  totalInputTokens: 10,
  totalOutputTokens: 5,
  totalCostUsd: 0.001,
  turns: 2,
  durationMs: 1500
};
const metricsHook: MetricsHook = {
  onRunComplete(_s: RunMetricsSnapshot): void {}
};
expect(typeof metricsHook.onRunComplete).toBe("function");
```

---

### `CHANGELOG.md` — Phase 10 entry

**Analog:** `CHANGELOG.md` lines 37–51 (Phase 9 `### Added — OTEL tracing bridge (Phase 9)` entry)

**Entry heading style** (line 37):
```markdown
### Added — OTEL tracing bridge (Phase 9)
```

**Phase 10 section** — insert after the Phase 9 block, under the existing `## [0.5.0] — 2026-05-01` header:
```markdown
### Added — Metrics / Counters hook (Phase 10)

- **New subpath: `@dogpile/sdk/runtime/metrics`.** Exports `MetricsHook` and `RunMetricsSnapshot`. Pure-TS, zero runtime dependencies. No root re-exports.
- **`metricsHook?: MetricsHook` on `EngineOptions` and `DogpileOptions`.** When provided, `onRunComplete` fires at every terminal state (completed, budget-stopped, aborted) with a `RunMetricsSnapshot`; `onSubRunComplete` fires for each coordinator-dispatched child run. When absent, zero overhead.
- **`RunMetricsSnapshot` fields:** `outcome`, `inputTokens`, `outputTokens`, `costUsd`, `totalInputTokens`, `totalOutputTokens`, `totalCostUsd`, `turns`, `durationMs`. Own-only counters exclude nested sub-run tokens; total counters include the full subtree.
- **`logger?: Logger` on `EngineOptions` and `DogpileOptions`.** Routes hook errors to a caller-supplied structured logger; falls back to `console.error` when absent. Uses the existing `Logger` interface from `@dogpile/sdk/runtime/logger`. Enables future engine-level diagnostic logging without another surface change.
- **Async fire-and-forget.** Hook callbacks are `(snapshot) => void | Promise<void>`. Async returns attach `.catch(err => logger.error(...))`. Hook latency never delays run completion.
- **`replay()` and `replayStream()` ignore `metricsHook` entirely.** Consistent with Phase 9 replay-is-tracing-free invariant.
- **Frozen fixture.** `src/tests/fixtures/metrics-snapshot-v1.json` records the canonical `RunMetricsSnapshot` v1 field order. Companion `metrics-snapshot-v1.type-check.ts` enforces compile-time type fidelity.
```

---

## Shared Patterns

### `exactOptionalPropertyTypes` Conditional Spread
**Source:** `src/runtime/engine.ts` lines 138, 267, 1012–1013, 1119–1120 (all Phase 9 optional spreads)
**Apply to:** All sites where `metricsHook?` or `logger?` is threaded (engine.ts lines 138, 267, coordinator dispatch at 1113–1122, `runProtocol` at 1010)
```typescript
// Correct — always use conditional spread for optional fields
...(options.metricsHook ? { metricsHook: options.metricsHook } : {})
...(options.logger ? { logger: options.logger } : {})
// Never: { metricsHook: options.metricsHook } — fails exactOptionalPropertyTypes when absent
```

### Optional-Chaining Zero-Overhead Guard
**Source:** `src/runtime/engine.ts` lines 1021–1024 (`if (tracing) { handleTracingEvent(...) }`)
**Apply to:** `if (metrics) { handleMetricsEvent(...) }` in `runProtocol` emit closure
```typescript
// Correct pattern for both tracing and metrics
if (tracing) { handleTracingEvent(tracing, event); }
if (metrics) { handleMetricsEvent(metrics, event); }
```

### Readonly Interfaces
**Source:** `src/runtime/tracing.ts` lines 13–26; `src/runtime/provenance.ts` lines 7–24
**Apply to:** All fields in `MetricsHook` and `RunMetricsSnapshot`
All callback fields in `MetricsHook` must be `readonly optional`. All data fields in `RunMetricsSnapshot` must be `readonly`.

### ESM `.js` Extension on Relative Imports
**Source:** `src/runtime/engine.ts` lines 1–55; `src/runtime/tracing.ts` (no imports — but tests use `.js`)
**Apply to:** All import statements in `src/runtime/metrics.test.ts` and `src/tests/metrics-contract.test.ts`
```typescript
import { type MetricsHook, type RunMetricsSnapshot } from "./metrics.js";
import { type MetricsHook } from "../runtime/metrics.js";
```

### Subpath Entry Ordering in `package.json`
**Source:** `package.json` lines 93–110 (alphabetical sequence: `tracing` → `logger` → `retry` → `sequential`)
**Apply to:** `./runtime/metrics` insertion — insert between `./runtime/logger` (line 103) and `./runtime/model` (line 83) by alphabetical order (`m-e` < `m-o`). The current order has `model` before `logger`/`tracing`, so verify the actual alphabetical slot against current file before inserting.

### `noopLogger` Default Fallback
**Source:** `src/runtime/logger.ts` lines 23–28 (`noopLogger` definition)
**Apply to:** `openRunMetrics` factory — when `metricsHook` is present but `logger` is absent, default to `noopLogger` not `console.error`. Then `fireHook` uses the logger (which is always defined after `openRunMetrics`). Only the `fireHook` sync-throw catch needs `console.error` as ultimate backstop if `logger.error` itself throws.

---

## Open Questions (Upstream — Flag to Planner)

| # | Question | File Affected | Resolution Path |
|---|----------|---------------|-----------------|
| OQ-1 | **Double-fire for sub-runs.** If `metricsHook` is threaded into coordinator child dispatch (Touchpoint 6 above), then `onRunComplete` fires inside the child's own `runProtocol` AND `onSubRunComplete` fires in the parent's emit closure on `sub-run-completed`. Callers using both callbacks receive two notifications per sub-run with different data shapes. Should `onRunComplete` be suppressed for `currentDepth > 0`? Evidence: `RunProtocolOptions` already carries `currentDepth` (line 671). The Phase 9 tracing analogy is not a clean guide here — tracing has no equivalent per-run callback, only spans. Planner must decide before wiring Touchpoint 6. | `src/runtime/engine.ts` lines 1113–1122, `RunProtocolOptions.currentDepth` line 671 | Planner decision: (a) suppress `onRunComplete` for `currentDepth > 0`, (b) allow double-fire and document it, or (c) do NOT thread `metricsHook` into child dispatch at all (only fire from `sub-run-completed` event) |
| OQ-2 | **`buildRunSnapshot` data for aborted/partial runs.** `closeRunMetrics` fires on error paths where `RunResult` is `undefined`. What values populate `inputTokens`, `outputTokens`, `turns`, `costUsd` for an aborted run? `runNonStreamingProtocol` catches the error before `canonicalizeRunResult` is called. Check if `emittedEvents` array (line 929) or any partial result is accessible at the catch site. | `src/runtime/engine.ts` lines 928–969 | Read `runNonStreamingProtocol` lines 928–970. If `emittedEvents` is in scope at the catch, partial token/turn counts can be derived from it. If not, the snapshot must zero-fill with `outcome: "aborted"`. |

---

## No Analog Found / Partial Only

| File / Pattern | Role | Data Flow | Reason |
|---|---|---|---|
| `fireHook` async isolation function | utility (internal) | event-driven | No `.catch(promise)` pattern exists in `src/runtime/`. Closest: sync try/catch in `logger.ts:105-117`. Must be constructed from spec (D-03). |
| `Map<childRunId, startMs>` sub-run start tracking | internal state | event-driven | Phase 9's `subRunSpans` Map (engine.ts line 745) tracks span identity but not time. `tokenAccumByAgent` (line 719) is structurally similar (Map keyed by id, values consumed on paired event). Neither provides a direct copy. |

---

## Metadata

**Analog search scope:** `src/runtime/tracing.ts`, `src/runtime/engine.ts`, `src/runtime/logger.ts`, `src/types.ts`, `src/tests/otel-tracing-contract.test.ts`, `src/tests/package-exports.test.ts`, `src/tests/fixtures/audit-record-v1.*`, `package.json`, `CHANGELOG.md`
**Files scanned:** ~15 source files read or grep-searched
**Pattern extraction date:** 2026-05-01

**Key analog relationships:**
- `src/runtime/metrics.ts` → exact copy of `tracing.ts` module shape (interfaces + no imports)
- `src/tests/fixtures/metrics-snapshot-v1.type-check.ts` → exact copy of `audit-record-v1.type-check.ts` with `satisfies RunMetricsSnapshot`
- `src/tests/metrics-contract.test.ts` → structural copy of `otel-tracing-contract.test.ts` without OTEL SDK bridge setup
- `src/runtime/engine.ts` (7 touchpoints) → self-analog from Phase 9 tracing touchpoints; `MetricsState`/`openRunMetrics`/`handleMetricsEvent`/`closeRunMetrics` mirror `TracingState`/`openRunTracing`/`handleTracingEvent`/`closeRunTracing` at lines 711–912
- All subpath wiring → `./runtime/tracing` entry as immediate precedent
- `logger?` import in `types.ts` → same pattern as `DogpileTracer` import at types.ts line 1
