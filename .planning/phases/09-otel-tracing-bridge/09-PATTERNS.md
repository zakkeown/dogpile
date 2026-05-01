# Phase 9: OTEL Tracing Bridge - Pattern Map

**Mapped:** 2026-05-01
**Files analyzed:** 11 new/modified files
**Analogs found:** 11 / 11

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/runtime/tracing.ts` | utility (type module) | transform | `src/runtime/provenance.ts` | exact |
| `src/runtime/engine.ts` | orchestrator | request-response | self (6 distinct touchpoints) | exact |
| `src/types.ts` | model | — | self (prior field additions) | exact |
| `src/index.ts` | config (re-exports) | — | self (Phase 7/8 re-export additions) | exact |
| `package.json` | config | — | self (`./runtime/audit` entry) | exact |
| `src/tests/package-exports.test.ts` | test (contract) | — | self (`/runtime/audit` assertions) | exact |
| `src/runtime/tracing.test.ts` | test (unit, co-located) | — | `src/runtime/provenance.test.ts` | exact |
| `src/tests/otel-tracing-contract.test.ts` | test (integration/contract) | event-driven | `src/tests/audit-record-shape.test.ts` + `src/tests/provenance-shape.test.ts` | role-match |
| `src/tests/no-otel-imports.test.ts` | test (import-graph) | — | `src/tests/no-node-builtins.test.ts` | exact |
| `CHANGELOG.md` | docs | — | Phase 8 entry (lines 27–35) | exact |
| `docs/developer-usage.md` | docs | — | existing subpath sections | role-match |

---

## Pattern Assignments

### `src/runtime/tracing.ts` (utility, type module)

**Analog:** `src/runtime/provenance.ts` (lines 1–43)

**Module shape — full file pattern:**
```typescript
// src/runtime/provenance.ts lines 1–43
import type { ModelRequestEvent, ModelResponseEvent } from "../types.js";

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
export function getProvenance(
  event: ModelRequestEvent | ModelResponseEvent
): ProvenanceRecord | PartialProvenanceRecord { ... }
```

**Conventions to copy:**
- No imports beyond `../types.js` (type-only)
- All interface fields are `readonly`
- No Node-only deps, no side effects, no storage access
- Export interfaces and constants only — no class, no singleton
- ESM `.js` extensions on relative imports

**Span names constants — follow `src/runtime/defaults.ts` exported-constants pattern:**
```typescript
export const DOGPILE_SPAN_NAMES = {
  RUN: "dogpile.run",
  SUB_RUN: "dogpile.sub-run",
  AGENT_TURN: "dogpile.agent-turn",
  MODEL_CALL: "dogpile.model-call",
} as const;
```

---

### `src/runtime/engine.ts` — Touchpoint 1: `RunProtocolOptions` internal type (lines 646–687)

**Analog:** `src/runtime/engine.ts` lines 646–687 (existing `RunProtocolOptions` field additions)

**Existing field threading pattern** (lines 655–686):
```typescript
interface RunProtocolOptions {
  readonly intent: string;
  readonly protocol: ReturnType<typeof normalizeProtocol>;
  // ...
  readonly emit?: (event: RunEvent) => void;
  readonly streamEvents?: boolean;
  readonly currentDepth?: number;
  readonly effectiveMaxDepth?: number;
  readonly effectiveMaxConcurrentChildren?: number;
  readonly onChildFailure?: EngineOptions["onChildFailure"];
  readonly parentDeadlineMs?: number;
  readonly defaultSubRunTimeoutMs?: number;
  readonly registerAbortDrain?: (drain: AbortDrainFn) => void;
  readonly failureInstancesByChildRunId?: Map<string, DogpileError>;
}
```

**Add** `readonly parentSpan?: DogpileSpan;` following the same pattern — optional, readonly, after the existing optional fields. Import `DogpileSpan` from `./tracing.js`.

---

### `src/runtime/engine.ts` — Touchpoint 2: `runNonStreamingProtocol` run-span open/close (lines 691–747)

**Analog:** `src/runtime/engine.ts` lines 691–747 (existing `runNonStreamingProtocol` structure)

**Existing try/finally structure to wrap:**
```typescript
// lines 691–747
async function runNonStreamingProtocol(options: NonStreamingProtocolOptions): Promise<RunResult> {
  const failureInstancesByChildRunId = new Map<string, DogpileError>();
  const abortLifecycle = createNonStreamingAbortLifecycle({ ... });

  try {
    const emittedEvents: RunEvent[] = [];
    const result = await abortLifecycle.run(runProtocol({
      ...options,
      ...(abortLifecycle.signal !== undefined ? { signal: abortLifecycle.signal } : {}),
      emit(event: RunEvent): void {
        emittedEvents.push(event);
      },
      failureInstancesByChildRunId
    }));
    // ...result assembly...
    return canonicalizeRunResult(...);
  } catch (error: unknown) {
    throw abortLifecycle.translateError(error);
  } finally {
    failureInstancesByChildRunId.clear();
    abortLifecycle.cleanup();
  }
}
```

**Tracing seam:** Open `runSpan` before `abortLifecycle.run(runProtocol(...))`. Close in the `finally` block. Use `options.tracer?.startSpan(...)` — optional chaining is the zero-overhead guard. Set end-time attributes before `runSpan?.end()` in normal path; `runSpan?.setStatus("error", message)` + `runSpan?.end()` in catch.

---

### `src/runtime/engine.ts` — Touchpoint 3: `emit` callback span interception (lines 706–713)

**Analog:** `src/runtime/engine.ts` lines 706–713 (existing `emit` closure structure)

**Existing emit closure:**
```typescript
emit(event: RunEvent): void {
  emittedEvents.push(event);
},
```

**Tracing extension pattern** (zero-overhead fast path first):
```typescript
emit(event: RunEvent): void {
  emittedEvents.push(event);
  if (!tracer) return;  // zero-overhead fast path — no allocations below when tracer absent

  // intercept model-request: buffer for timing correlation + open model-call span
  // intercept model-response: close model-call span with token/cost attributes
  // intercept agent-turn: open + immediately close agent-turn span with attributes
  // intercept sub-run-started: open sub-run span keyed by childRunId
  // intercept sub-run-completed: close sub-run span with ok status
  // intercept sub-run-failed: close sub-run span with error status
},
```

**State maps to maintain inside `runNonStreamingProtocol` closure (before `try`):**
```typescript
const subRunSpans = new Map<string, DogpileSpan>();
const agentTurnSpans = new Map<string, DogpileSpan>();
const modelCallSpans = new Map<string, DogpileSpan>();
const pendingModelRequests = new Map<string, ModelRequestEvent>(); // keyed by agentId
```

---

### `src/runtime/engine.ts` — Touchpoint 4: Coordinator `runProtocol` recursive call (lines 849–853)

**Analog:** `src/runtime/engine.ts` lines 849–853 (existing coordinator delegation)

**Existing delegation:**
```typescript
runProtocol: (childInput) =>
  runProtocol({
    ...childInput,
    protocol: normalizeProtocol(childInput.protocol)
  })
```

**With parentSpan threading:**
```typescript
runProtocol: (childInput) =>
  runProtocol({
    ...childInput,
    protocol: normalizeProtocol(childInput.protocol),
    ...(options.parentSpan ? { parentSpan: options.parentSpan } : {})
  })
```

The `parentSpan` passed here should be the sub-run span opened on `sub-run-started` for that `childRunId`, not the root `runSpan`. The sub-run span is looked up from `subRunSpans.get(childRunId)` in the `emit` interception.

---

### `src/runtime/engine.ts` — Touchpoint 5: Streaming `execute()` parallel wiring (lines 234–270+)

**Analog:** `src/runtime/engine.ts` lines 234–270 (existing `execute()` async function)

**Existing streaming path structure:**
```typescript
async function execute(): Promise<void> {
  if (status !== "running") { return; }

  try {
    const streamStartedAtMs = Date.now();
    const streamParentDeadlineMs = ...;
    const baseResult = await abortRace.run(runProtocol({
      intent,
      protocol,
      // ...options spread...
      streamEvents: true,
      emit(event: RunEvent): void {
        if (status !== "running") { return; }
        const parentRunIds = (event as { readonly parentRunIds?: readonly string[] }).parentRunIds;
        // ... event routing to pendingEvents/subscribers ...
      },
      // ...
    }));
    // ...result assembly and resolveResult(runResult)...
  } catch (error) {
    // ...rejectResult / status = "error"...
  }
}
```

**Tracing wiring is structurally identical to the non-streaming path.** The same span maps, the same `if (!tracer) return` guard in emit, the same `runSpan` open before `runProtocol` and close in the catch/finally. The existing `emit` closure in `execute()` already has a `if (status !== "running") return` guard — add the tracer guard immediately after it.

---

### `src/runtime/engine.ts` — Touchpoint 6: `replay()` / `replayStream()` tracer-ignore guard (lines 923, 1131)

**Analog:** `src/runtime/engine.ts` lines 923–967 (existing `replay()` function body)

**Pattern:** At the top of `replay()` and `replayStream()`, add a comment. No guard condition needed (tracer is on `EngineOptions`, not on standalone `replay()`/`replayStream()` which are module-level exports unconnected to engine instances). The tracer is only present on the engine closure — the concern is if callers reuse an engine. Document explicitly in the JSDoc: `// tracer is not applied to replay — see docs/developer-usage.md`.

---

### `src/types.ts` — `EngineOptions` and `DogpileOptions` field additions (lines 1953+, 1856+)

**Analog:** `src/types.ts` lines 1880–1922 (existing optional field block on both interfaces)

**Existing optional field pattern** (lines 1984–1988 from `EngineOptions`):
```typescript
/** Optional caller-owned evaluator that supplies quality and evaluation data. */
readonly evaluate?: RunEvaluator;
/** Optional deterministic seed recorded in the replay trace. */
readonly seed?: string | number;
/** Optional caller cancellation signal passed to provider-facing model requests. */
readonly signal?: AbortSignal;
```

**New field to add** (same JSDoc + readonly optional pattern):
```typescript
/**
 * Optional duck-typed OTEL-compatible tracer. When provided, the SDK emits
 * spans for run start/end, sub-run start/end, agent-turn start/end, and
 * model-call start/end. Absent means zero span overhead — no allocations,
 * no branch cost. See `@dogpile/sdk/runtime/tracing` for the interface.
 * Note: `replay()` and `replayStream()` ignore this field entirely.
 */
readonly tracer?: DogpileTracer;
```

Add to both `EngineOptions` and `DogpileOptions`. Import `DogpileTracer` from `./runtime/tracing.js` (type-only import).

**`exactOptionalPropertyTypes` conditional spread pattern** (from `engine.ts` existing spreads):
```typescript
// When threading tracer into RunProtocolOptions at call sites:
...(options.tracer ? { tracer: options.tracer } : {})
```

---

### `src/index.ts` — Root re-export additions

**Analog:** `src/index.ts` lines 82–155 (existing type re-export block)

**Existing type export pattern** (lines 82–155):
```typescript
export type {
  AnomalyCode,          // Phase 7 addition
  // ...
  HealthAnomaly,        // Phase 7 addition
  // ...
  RunHealthSummary,     // Phase 7 addition
  // ...
}
```

**Add** `DogpileSpan`, `DogpileSpanOptions`, `DogpileTracer` to the same `export type { ... }` block in alphabetical order. These are type-only re-exports from `./runtime/tracing.js`.

---

### `package.json` — `/runtime/tracing` subpath wiring

**Analog:** `package.json` lines 48–51 (`./runtime/audit` entry) and lines 165–177 (files array)

**Exact pattern to copy:**
```json
"./runtime/audit": {
  "types": "./dist/runtime/audit.d.ts",
  "import": "./dist/runtime/audit.js",
  "default": "./dist/runtime/audit.js"
}
```

**New entry:**
```json
"./runtime/tracing": {
  "types": "./dist/runtime/tracing.d.ts",
  "import": "./dist/runtime/tracing.js",
  "default": "./dist/runtime/tracing.js"
}
```

**Files array addition** (follow line 165 `"src/runtime/audit.ts"` pattern):
```json
"src/runtime/tracing.ts"
```

---

### `src/tests/package-exports.test.ts` — `/runtime/tracing` subpath assertions

**Analog:** `src/tests/package-exports.test.ts` lines 1282–1325 (existing `./runtime/audit` and `./runtime/provenance` subpath assertion blocks)

**Exact pattern:**
```typescript
"./runtime/audit": {
  types: "./dist/runtime/audit.d.ts",
  import: "./dist/runtime/audit.js",
  default: "./dist/runtime/audit.js"
},
// and in files array:
"src/runtime/audit.ts",
```

**Type-check assertion pattern** (lines 1509–1525 for health types):
```typescript
const anomalyCode: AnomalyCode = "empty-contribution";
const healthAnomaly: HealthAnomaly = { ... };
```

Add parallel type-check assertions for `DogpileTracer`, `DogpileSpan`, `DogpileSpanOptions`:
```typescript
import type { DogpileTracer, DogpileSpan, DogpileSpanOptions } from "@dogpile/sdk/runtime/tracing";
// ... type assignability checks ...
const tracer: DogpileTracer = { startSpan: (name, options) => ({ end() {}, setAttribute() {}, setStatus() {} }) };
```

---

### `src/runtime/tracing.test.ts` (co-located unit test)

**Analog:** `src/runtime/provenance.test.ts` (full file, lines 1–68)

**Imports pattern** (lines 1–8):
```typescript
import { describe, expect, it } from "vitest";
import {
  getProvenance,
  type PartialProvenanceRecord,
  type ProvenanceRecord
} from "./provenance.js";
import type { ModelRequest, ModelRequestEvent, ModelResponseEvent } from "../types.js";
```

**Test structure pattern:**
```typescript
describe("getProvenance", () => {
  it("returns ProvenanceRecord with all five fields from ModelResponseEvent", () => { ... });
  it("returns PartialProvenanceRecord with four fields from ModelRequestEvent", () => { ... });
  it("ProvenanceRecord survives JSON round-trip without data loss", () => { ... });
});
```

**For `tracing.test.ts` — test what's exported:**
- `DOGPILE_SPAN_NAMES` contains exactly the four span name string values
- Each span name matches expected string literal (`"dogpile.run"` etc.)
- `DogpileSpan` interface shape (type-check tests: a concrete stub satisfies the type)
- `DogpileTracer` interface shape (type-check test: stub satisfies structural type)
- No Node-only imports in the module itself (guard via dynamic import + property check)

---

### `src/tests/otel-tracing-contract.test.ts` (integration/contract test)

**Analog:** `src/tests/audit-record-shape.test.ts` lines 1–60 (for the synthetic-trace + assertion pattern) and `src/tests/provenance-shape.test.ts` lines 1–80 (for the live-run + event capture pattern)

**Imports pattern from `audit-record-shape.test.ts`** (lines 1–11):
```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAuditRecord } from "../runtime/audit.js";
import type { CostSummary, RunEvent, Trace } from "../types.js";
```

**Live-run pattern from `provenance-shape.test.ts`** (lines 13–22):
```typescript
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

async function captureProvenanceEvents(): Promise<readonly ProvenanceEvent[]> {
  const result = await run({
    intent: "Test provenance shape",
    model: createDeterministicModelProvider("provenance-shape-fixture-model"),
    protocol: { kind: "sequential", maxTurns: 1 }
  });
  return result.eventLog.events.filter(isProvenanceEvent);
}
```

**For `otel-tracing-contract.test.ts` — OTEL integration via user-side bridge:**
- Use `@opentelemetry/sdk-trace-base` `InMemorySpanExporter` + `BasicTracerProvider` (devDep)
- Wire the user-side bridge (WeakMap pattern from RESEARCH.md Pattern 6) to create a `DogpileTracer`
- Run `run({ ..., tracer: makeDogpileTracer() })` with `createDeterministicModelProvider`
- Assert spans recorded in `InMemorySpanExporter` by name and parent-child relationship
- Test OTEL-01: all four span types present
- Test OTEL-02: sub-run spans have correct `parentSpanId` pointing to run span
- Test OTEL-03: run without tracer returns identical result shape (no extra fields)

---

### `src/tests/no-otel-imports.test.ts` (import-graph enforcement test)

**Analog:** `src/tests/no-node-builtins.test.ts` (full file, lines 1–60) — exact structural copy

**Full analog:**
```typescript
// src/tests/no-node-builtins.test.ts lines 1–60
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const guardedRoots = ["src/runtime", "src/browser", "src/providers"] as const;

const NODE_BUILTINS = [ "fs", "fs/promises", ... ];

async function walkTs(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkTs(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("pure-runtime invariant: no Node-only imports", () => {
  it("src/runtime, src/browser, src/providers must not import Node builtins", async () => {
    const offenders: string[] = [];
    for (const root of guardedRoots) {
      // ... walk + regex check ...
    }
    expect(offenders).toEqual([]);
  });
});
```

**For `no-otel-imports.test.ts`:**
- Same `guardedRoots`, same `walkTs` function (copy verbatim)
- Replace `NODE_BUILTINS` array with `const OTEL_SCOPE = "@opentelemetry/";`
- Replace check: `if (spec && spec.startsWith(OTEL_SCOPE))` instead of `NODE_BUILTINS.includes(spec)`
- Same `expect(offenders).toEqual([])` assertion
- `describe("pure-runtime invariant: no @opentelemetry/* imports", ...)`

---

### `CHANGELOG.md` — Phase 9 entry

**Analog:** `CHANGELOG.md` lines 27–35 (Phase 8 `### Added — Audit Event Schema` entry)

**Entry style to copy:**
```markdown
### Added — Audit Event Schema (Phase 8)

- **New subpath: `@dogpile/sdk/runtime/audit`.** Exports `createAuditRecord(trace)`, `AuditRecord`, ...
- **`createAuditRecord(trace: Trace): AuditRecord`.** Pure function that derives ...
- **`AuditRecord` standalone type.** The audit schema is independent of `RunEvent` ...
```

**Phase 9 section** follows same heading style `### Added — OTEL Tracing Bridge (Phase 9)` under the existing `## [0.5.0] — 2026-05-01` version header (or a new version bump if warranted). Bullet items to include:
- New subpath: `@dogpile/sdk/runtime/tracing` — exports `DogpileTracer`, `DogpileSpan`, `DogpileSpanOptions`, `DOGPILE_SPAN_NAMES`
- New optional field: `tracer?: DogpileTracer` on `EngineOptions` and `DogpileOptions`
- Four new span names: `dogpile.run`, `dogpile.sub-run`, `dogpile.agent-turn`, `dogpile.model-call`
- New root-exported types: `DogpileTracer`, `DogpileSpan`, `DogpileSpanOptions`
- Zero overhead when tracer absent
- `replay()` and `replayStream()` are tracing-free (D-14)

---

## Shared Patterns

### `exactOptionalPropertyTypes` Conditional Spread
**Source:** `src/runtime/engine.ts` lines 710, 800–803 (existing spread patterns)
**Apply to:** All sites where `tracer?`, `parentSpan?`, or any new optional field is spread
```typescript
// Correct pattern throughout engine.ts
...(options.tracer ? { tracer: options.tracer } : {})
...(options.parentSpan ? { parentSpan: options.parentSpan } : {})
// Never: { tracer: options.tracer } — fails exactOptionalPropertyTypes when field is absent
```

### Optional Chaining as Zero-Overhead Guard
**Source:** pattern established by `options.budget?.caps`, `options.signal`, etc. throughout `engine.ts`
**Apply to:** All span operations in `runNonStreamingProtocol` and streaming `execute()`
```typescript
const runSpan = tracer?.startSpan(DOGPILE_SPAN_NAMES.RUN, { attributes: { ... } });
// ... later ...
runSpan?.setStatus("ok");
runSpan?.end();
```
The `if (!tracer) return` in the `emit` callback is the critical performance guard — all attribute construction must be inside this guard.

### Readonly Interfaces
**Source:** `src/runtime/provenance.ts` lines 7–24 (all `ProvenanceRecord` fields are `readonly`)
**Apply to:** `DogpileSpan`, `DogpileSpanOptions`, `DogpileTracer` in `tracing.ts`
All fields in new interfaces must be `readonly`. Method signatures have no field syntax but the interfaces should not have mutable state.

### ESM `.js` Extension on Relative Imports
**Source:** `src/runtime/engine.ts` lines 26–52, `src/runtime/provenance.ts` line 1
**Apply to:** All import statements in `src/runtime/tracing.ts` and `src/runtime/tracing.test.ts`
```typescript
import type { ... } from "../types.js";  // .js extension required — TS resolves through
import { DOGPILE_SPAN_NAMES } from "./tracing.js";
```

### Subpath Entry Ordering
**Source:** `package.json` lines 48–91 (alphabetical by subpath name)
**Apply to:** New `./runtime/tracing` entry in `package.json` exports and `files`
Insert in alphabetical order: `audit` → `health` → `introspection` → `provenance` → `tracing`.

---

## Open Questions (Upstream — Flag to Planner)

These are unresolved from RESEARCH.md and must be verified before implementation:

| # | Question | File Affected | Resolution Path |
|---|----------|---------------|-----------------|
| OQ-1 | `TurnEvent` in `src/types/events.ts` lines 318–345 — does it have a `turnNumber` field? If not, `dogpile.turn.number` must be derived from a per-agentId counter in the `emit` closure. | `src/runtime/engine.ts` (emit interception) | Read `src/types/events.ts:318-345` before implementing D-11 |
| OQ-3 | ROADMAP.md SC 4 states `DogpileTracer` structurally satisfies OTEL `Tracer` without a bridge — but RESEARCH.md confirms this is false (setStatus + parent signatures differ). Planner should treat SC 4 as "bridge code achieves OTEL integration without shared SDK import" rather than "no bridge needed." | `src/tests/otel-tracing-contract.test.ts`, `docs/developer-usage.md` | Confirm interpretation with user or treat as RESEARCH.md resolution |

---

## No Analog Found

None — all files have close analogs in the codebase.

---

## Metadata

**Analog search scope:** `src/runtime/`, `src/tests/`, `src/index.ts`, `src/types.ts`, `package.json`, `CHANGELOG.md`
**Files scanned:** ~25 source files read or grep-searched
**Pattern extraction date:** 2026-05-01

**Key analog relationships:**
- `src/runtime/tracing.ts` → exact copy of `provenance.ts` module shape
- `src/tests/no-otel-imports.test.ts` → exact copy of `no-node-builtins.test.ts` with OTEL predicate
- `src/runtime/tracing.test.ts` → exact copy of `provenance.test.ts` test structure
- `src/runtime/engine.ts` (6 touchpoints) → self-analog from prior optional-field threading patterns
- All subpath wiring → `./runtime/audit` entry as immediate precedent
