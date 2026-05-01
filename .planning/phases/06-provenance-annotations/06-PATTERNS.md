# Phase 6: Provenance Annotations - Pattern Map

**Mapped:** 2026-05-01
**Files analyzed:** 16 (3 new, 13 modified)
**Analogs found:** 16 / 16

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/types/events.ts` | type-definition | type-shape | Self — extend existing ModelRequestEvent/ModelResponseEvent at lines 67–116 | self-extend |
| `src/types/replay.ts` | type-definition | type-shape | Self — extend ReplayTraceProviderCall at lines 177–196 | self-extend |
| `src/types.ts` | type-definition | type-shape | Self — extend ConfiguredModelProvider at lines 884–906 | self-extend |
| `src/runtime/model.ts` | runtime-module | event-emission | Self — extend generateModelTurn / recordProviderCall (full file, 118 lines) | self-extend |
| `src/runtime/defaults.ts` | runtime-module | type-shape | Self — fix createReplayTraceProtocolDecision base object at lines 362–374 | self-extend |
| `src/runtime/engine.ts` | runtime-module | replay-synthesis | Self — extend replay() at lines 920–959 | self-extend |
| `src/runtime/provenance.ts` | runtime-module | request-response | `src/runtime/termination.ts` lines 1–37 (pure-TS helper module pattern) | role-match |
| `src/providers/openai-compatible.ts` | provider-adapter | request-response | Self — extend createOpenAICompatibleProvider return object at lines 92–94 | self-extend |
| `src/internal/vercel-ai.ts` | provider-adapter | request-response | Self — extend createVercelAIProvider return object at lines 213–214 | self-extend |
| `src/tests/event-schema.test.ts` | contract-test | type-shape | Self — extend ModelRequestEvent/ModelResponseEvent shape assertions | self-extend |
| `src/tests/result-contract.test.ts` | contract-test | replay-synthesis | Self — extend providerCalls shape assertions at lines 569–588 | self-extend |
| `src/tests/package-exports.test.ts` | contract-test | package-export | Self — extend exports map assertion at lines 1283–1327 | self-extend |
| `src/runtime/provenance.test.ts` | unit-test | request-response | `src/runtime/logger.test.ts` lines 1–33 (co-located unit test header pattern) | role-match |
| `src/tests/provenance-shape.test.ts` | contract-test | event-emission | `src/tests/replay-version-skew.test.ts` lines 1–49 (frozen fixture test pattern) | exact |
| `src/tests/fixtures/provenance-event-v1.json` | fixture | event-emission | `src/tests/fixtures/replay-trace-v0_3.json` (frozen JSON fixture pattern) | exact |
| `package.json` | package-manifest | package-export | Self — extend exports map (runtime/* subpath shape from lines 1283–1327 of package-exports.test.ts) | self-extend |

---

## Pattern Assignments

### `src/types/events.ts` (type-definition, type-shape)

**Analog:** Self — existing definitions at lines 67–116

**Current ModelRequestEvent shape to mutate** (lines 67–86):
```typescript
export interface ModelRequestEvent {
  readonly type: "model-request";
  readonly runId: string;
  readonly parentRunIds?: readonly string[];
  readonly at: string;               // DROP this — replace with startedAt
  readonly callId: string;
  readonly providerId: string;
  readonly agentId: string;
  readonly role: string;
  readonly request: ModelRequest;
}
```

**Target shape after Phase 6 (D-07):**
```typescript
export interface ModelRequestEvent {
  readonly type: "model-request";
  readonly runId: string;
  readonly parentRunIds?: readonly string[];
  readonly startedAt: string;        // NEW — replaces `at`
  readonly callId: string;
  readonly providerId: string;
  readonly modelId: string;          // NEW — non-optional per D-03
  readonly agentId: string;
  readonly role: string;
  readonly request: ModelRequest;
}
```

**Current ModelResponseEvent shape to mutate** (lines 97–116):
```typescript
export interface ModelResponseEvent {
  readonly type: "model-response";
  readonly runId: string;
  readonly parentRunIds?: readonly string[];
  readonly at: string;               // DROP this — replace with startedAt + completedAt
  readonly callId: string;
  readonly providerId: string;
  readonly agentId: string;
  readonly role: string;
  readonly response: ModelResponse;
}
```

**Target shape after Phase 6 (D-08):**
```typescript
export interface ModelResponseEvent {
  readonly type: "model-response";
  readonly runId: string;
  readonly parentRunIds?: readonly string[];
  readonly startedAt: string;        // NEW — same value as paired ModelRequestEvent
  readonly completedAt: string;      // NEW
  readonly callId: string;
  readonly providerId: string;
  readonly modelId: string;          // NEW — non-optional per D-03
  readonly agentId: string;
  readonly role: string;
  readonly response: ModelResponse;
}
```

**Note:** `exactOptionalPropertyTypes: true` is in effect. Do NOT use `startedAt?: string` — these must be required fields.

---

### `src/types/replay.ts` (type-definition, type-shape)

**Analog:** Self — existing definition at lines 177–196

**Current ReplayTraceProviderCall shape to extend** (lines 177–196):
```typescript
export interface ReplayTraceProviderCall {
  readonly kind: "replay-trace-provider-call";
  readonly callId: string;
  readonly providerId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly agentId: string;
  readonly role: string;
  readonly request: ModelRequest;
  readonly response: ModelResponse;
}
```

**Change per D-10:** Add `readonly modelId: string;` (non-optional) after `providerId`. Position: after `providerId` line, before `startedAt`.

---

### `src/types.ts` (type-definition, type-shape)

**Analog:** Self — existing ConfiguredModelProvider at lines 884–906

**Current interface to extend** (lines 884–906):
```typescript
export interface ConfiguredModelProvider {
  readonly id: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
  stream?(request: ModelRequest): AsyncIterable<ModelOutputChunk>;
  readonly metadata?: {
    readonly locality?: "local" | "remote";
  };
}
```

**Change per D-02:** Add `readonly modelId?: string;` as optional field after `id`. The optional pattern matches `metadata?` already present. The `??` fallback at runtime (`provider.modelId ?? provider.id`) is the consumption pattern for all callers.

---

### `src/runtime/model.ts` (runtime-module, event-emission)

**Analog:** Self — full file (118 lines, already read)

**Current generateModelTurn — missing emit calls** (lines 25–35, non-stream path):
```typescript
export async function generateModelTurn(options: GenerateModelTurnOptions): Promise<ModelResponse> {
  const startedAt = new Date().toISOString();
  let response: ModelResponse;

  throwIfAborted(options.request.signal, options.model.id);

  if (!options.model.stream) {
    response = await options.model.generate(options.request);
    throwIfAborted(options.request.signal, options.model.id);
    recordProviderCall(response, startedAt, options);
    return response;
  }
  // ...
}
```

**Extended pattern — emit before/after provider call:**
```typescript
export async function generateModelTurn(options: GenerateModelTurnOptions): Promise<ModelResponse> {
  const startedAt = new Date().toISOString();
  const modelId = options.model.modelId ?? options.model.id;  // D-03 fallback
  let response: ModelResponse;

  throwIfAborted(options.request.signal, options.model.id);

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

  if (!options.model.stream) {
    response = await options.model.generate(options.request);
    throwIfAborted(options.request.signal, options.model.id);
    recordProviderCall(response, startedAt, modelId, options);  // modelId threaded through
    return response;
  }
  // ... streaming path: same emit pattern after loop ...
}
```

**Current recordProviderCall — missing modelId** (lines 93–109):
```typescript
function recordProviderCall(
  response: ModelResponse,
  startedAt: string,
  options: GenerateModelTurnOptions
): void {
  options.onProviderCall?.({
    kind: "replay-trace-provider-call",
    callId: options.callId,
    providerId: options.model.id,
    startedAt,
    completedAt: new Date().toISOString(),
    agentId: options.agent.id,
    role: options.agent.role,
    request: requestForTrace(options.request),
    response
  });
}
```

**Extended pattern — emit ModelResponseEvent + pass modelId to onProviderCall:**
```typescript
function recordProviderCall(
  response: ModelResponse,
  startedAt: string,
  modelId: string,
  options: GenerateModelTurnOptions
): void {
  const completedAt = new Date().toISOString();

  options.emit({
    type: "model-response",
    runId: options.runId,
    callId: options.callId,
    providerId: options.model.id,
    modelId,
    startedAt,          // same value as paired model-request (D-08)
    completedAt,
    agentId: options.agent.id,
    role: options.agent.role,
    response
  });

  options.onProviderCall?.({
    kind: "replay-trace-provider-call",
    callId: options.callId,
    providerId: options.model.id,
    modelId,            // D-10: new field
    startedAt,
    completedAt,
    agentId: options.agent.id,
    role: options.agent.role,
    request: requestForTrace(options.request),
    response
  });
}
```

**Protocol files are NOT modified:** All four protocols (`sequential.ts`, `broadcast.ts`, `coordinator.ts`, `shared.ts`) pass `emit` into `generateModelTurn`. The new emission happens entirely inside `model.ts`.

---

### `src/runtime/defaults.ts` (runtime-module, type-shape)

**Analog:** Self — createReplayTraceProtocolDecision at lines 349–400+

**Blast-radius fix at lines 362–368 (Pitfall 1 from RESEARCH.md):**
```typescript
// CURRENT (will fail to compile after events.ts change):
const base = {
  kind: "replay-trace-protocol-decision" as const,
  eventIndex,
  eventType: event.type,
  protocol,
  decision: options.decision ?? defaultProtocolDecision(event),
  at: event.at,  // BROKEN: ModelRequestEvent and ModelResponseEvent no longer have `at`
  ...
};
```

**Fixed pattern:**
```typescript
const base = {
  kind: "replay-trace-protocol-decision" as const,
  eventIndex,
  eventType: event.type,
  protocol,
  decision: options.decision ?? defaultProtocolDecision(event),
  at: "at" in event ? event.at : event.startedAt,  // handle events without `at`
  ...
};
```

The `model-request` and `model-response` cases at lines 383–400 already read `event.callId`, `event.providerId`, `event.agentId`, `event.role` — those remain unchanged.

---

### `src/runtime/engine.ts` (runtime-module, replay-synthesis)

**Analog:** Self — replay() at lines 920–959

**Current replay() — passes trace.events unchanged** (lines 932–934):
```typescript
const baseResult = {
  output: trace.finalOutput.output,
  eventLog: createRunEventLog(trace.runId, trace.protocol, trace.events),
  trace,
  // ...
};
```

**Extended pattern per D-11 — synthesize model-request/response from providerCalls:**

Add a synthesis helper function and use it to augment the events array before building `eventLog`:
```typescript
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

Interleave synthesized pairs into `trace.events` before the corresponding `agent-turn` for each `callId` (D-05 sequence: `model-request` → [`model-output-chunk`*] → `model-response` → `agent-turn`). Return a new array — do NOT mutate `trace.events`.

**Open question (from RESEARCH.md):** Exact insertion position in `trace.events` during replay is for the planner to confirm against PROV-02 success criteria. Simplest safe approach: for each providerCall, find the first `agent-turn` event index that does not already have a preceding model-request/response pair, and insert before it.

---

### `src/runtime/provenance.ts` (runtime-module, request-response) — NEW FILE

**Analog:** `src/runtime/termination.ts` lines 1–37 (pure-TS export module with no Node-only deps)

**Imports pattern** (from termination.ts lines 1–24):
```typescript
import type {
  ModelRequestEvent,
  ModelResponseEvent
} from "../types.js";
```

Use `import type` for event types (pure type imports). No runtime deps. ESM with explicit `.js` extension on relative imports (project convention from CLAUDE.md).

**Core pattern** (from RESEARCH.md Pattern 4):
```typescript
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
): ProvenanceRecord | PartialProvenanceRecord {
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

Function overloads are idiomatic here: `exactOptionalPropertyTypes: true` makes `completedAt?: string` on a single return type problematic. Two named return types (`ProvenanceRecord` / `PartialProvenanceRecord`) let callers reference them without type assertions.

**No Node-only imports.** This module must run under Node 22/24, Bun latest, and browser ESM per the cross-cutting invariant in CLAUDE.md.

---

### `src/providers/openai-compatible.ts` (provider-adapter, request-response)

**Analog:** Self — createOpenAICompatibleProvider return object at lines 92–94

**Current return object** (lines 92–94):
```typescript
return {
  id: providerId,
  metadata: { locality: resolvedLocality },
  async generate(request: ModelRequest): Promise<ModelResponse> { ... },
  // ...
};
```

**Change per D-02:** Add `modelId: options.model` to the returned object after `id`:
```typescript
return {
  id: providerId,
  modelId: options.model,  // NEW — options.model is the caller-supplied model string (e.g. "gpt-4o")
  metadata: { locality: resolvedLocality },
  // ...
};
```

`options.model` is `string` (see `OpenAICompatibleProviderOptions.model: string` at line 30) — this is the caller-supplied model identifier, the right value for `modelId`.

---

### `src/internal/vercel-ai.ts` (provider-adapter, request-response)

**Analog:** Self — createVercelAIProvider return object at lines 213–214

**Current return object** (lines 213–214):
```typescript
return {
  id: providerId,
  async generate(request: ModelRequest): Promise<ModelResponse> { ... },
  // ...
};
```

**Change per D-02 + deferred feasibility confirmed HIGH (RESEARCH.md Pattern 5):**
```typescript
return {
  id: providerId,
  modelId: typeof options.model === "string"
    ? options.model
    : (options.model as { modelId?: string }).modelId,  // LanguageModel.modelId confirmed at node_modules/ai/dist/index.d.ts:44
  // ...
};
```

This is internal-only (not exported). `LanguageModel.modelId: string` is confirmed present in the Vercel AI types. The adapter already reads `modelRecord.modelId` for `inferProviderId()` at line 747 — same source.

---

### `src/tests/event-schema.test.ts` (contract-test, type-shape)

**Analog:** Self — existing event shape assertions

**Update pattern:** Find the existing test(s) that construct `ModelRequestEvent` and `ModelResponseEvent` literal objects. Replace `at: "..."` with `startedAt: "..."` on `ModelRequestEvent`; replace `at: "..."` with `startedAt: "..."` and `completedAt: "..."` on `ModelResponseEvent`; add `modelId: "..."` to both. The exhaustive `expectedEventTypes` array at lines 40–58 does NOT change — `"model-request"` and `"model-response"` are already in the union.

---

### `src/tests/result-contract.test.ts` (contract-test, replay-synthesis)

**Analog:** Self — providerCalls shape assertions at lines 569–588

**Current shape assertion** (lines 580–588):
```typescript
expect(call.providerId).toBe(trace.modelProviderId);
expect(call.agentId).toBe(transcript.agentId);
expect(call.role).toBe(transcript.role);
expect(call.request.messages.at(-1)?.content).toBe(transcript.input);
expect(call.response.text).toBe(transcript.output);
expect(turnEvent.output).toBe(call.response.text);
expect(Date.parse(call.startedAt)).toBeLessThanOrEqual(Date.parse(call.completedAt));
expect(Date.parse(call.completedAt)).toBeLessThanOrEqual(Date.parse(turnEvent.at));
```

**Extended pattern — add modelId assertion:**
```typescript
expect(call.modelId).toBeDefined();        // NEW: D-10 — non-optional on ReplayTraceProviderCall
expect(typeof call.modelId).toBe("string"); // NEW
```

Also add/extend replay round-trip assertions to cover provenance fields in `model-request`/`model-response` events in the replayed result (PROV-02).

---

### `src/tests/package-exports.test.ts` (contract-test, package-export)

**Analog:** Self — existing runtime/* subpath block at lines 1283–1327

**Existing pattern to copy for new subpath** (lines 1283–1287):
```typescript
"./runtime/engine": {
  types: "./dist/runtime/engine.d.ts",
  import: "./dist/runtime/engine.js",
  default: "./dist/runtime/engine.js"
},
```

**New entry to add:**
```typescript
"./runtime/provenance": {
  types: "./dist/runtime/provenance.d.ts",
  import: "./dist/runtime/provenance.js",
  default: "./dist/runtime/provenance.js"
},
```

Note: NO `browser` condition on runtime/* subpaths — the existing subpaths at lines 1283–1327 do not include one, and `src/runtime/provenance.ts` is browser-compatible (pure TS, no Node-only deps).

---

### `src/runtime/provenance.test.ts` (unit-test, request-response) — NEW FILE

**Analog:** `src/runtime/logger.test.ts` lines 1–33 (co-located unit test header pattern)

**Imports pattern** (from logger.test.ts lines 1–9):
```typescript
import { describe, expect, it } from "vitest";
import {
  getProvenance,
  type ProvenanceRecord,
  type PartialProvenanceRecord
} from "./provenance.js";
import type { ModelRequestEvent, ModelResponseEvent } from "../types.js";
```

Import the subject module with explicit `.js` extension. Import `type` for type-only imports. Place test file next to `provenance.ts` per co-located unit test convention (CLAUDE.md).

**Test structure to cover:**
- `getProvenance(ModelResponseEvent)` returns `ProvenanceRecord` with all five fields
- `getProvenance(ModelRequestEvent)` returns `PartialProvenanceRecord` with four fields (no `completedAt`)
- Return type narrowing: TypeScript should narrow return type via overloads (compile-time test)
- JSON round-trip: `JSON.parse(JSON.stringify(result))` equals result

---

### `src/tests/provenance-shape.test.ts` (contract-test, event-emission) — NEW FILE

**Analog:** `src/tests/replay-version-skew.test.ts` lines 1–49 (exact pattern match)

**Full pattern** (from replay-version-skew.test.ts, lines 1–49):
```typescript
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run } from "../index.js";
import { createDeterministicModelProvider } from "../internal.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixturePath = join(repoRoot, "src/tests/fixtures/provenance-event-v1.json");

async function captureProvenanceEvents() {
  // Run with deterministic model to get stable model-request + model-response events
  const result = await run({ ... });
  return result.eventLog.events.filter(
    (e) => e.type === "model-request" || e.type === "model-response"
  );
}

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

**Bootstrap protocol:** Implement emission in `model.ts` before running this test. Run `pnpm vitest run src/tests/provenance-shape.test.ts` once after emission works to bootstrap `provenance-event-v1.json`; then commit the fixture file.

---

### `src/tests/fixtures/provenance-event-v1.json` (fixture, event-emission) — NEW FILE

**Analog:** `src/tests/fixtures/replay-trace-v0_3.json` (frozen JSON fixture)

Auto-bootstrapped by `provenance-shape.test.ts` on first run. Contents: a JSON array of two events — one `ModelRequestEvent` and one `ModelResponseEvent` — with all required fields present. Shape after bootstrap:
```json
[
  {
    "type": "model-request",
    "runId": "run-xxx",
    "callId": "run-xxx:provider-call:1",
    "providerId": "...",
    "modelId": "...",
    "startedAt": "2026-...",
    "agentId": "...",
    "role": "..."
  },
  {
    "type": "model-response",
    "runId": "run-xxx",
    "callId": "run-xxx:provider-call:1",
    "providerId": "...",
    "modelId": "...",
    "startedAt": "2026-...",
    "completedAt": "2026-...",
    "agentId": "...",
    "role": "...",
    "response": { ... }
  }
]
```

Do NOT hand-write this file. Let the test bootstrap it from a live run with the deterministic provider.

---

### `package.json` (package-manifest, package-export)

**Analog:** Self — existing exports map (evidenced by package-exports.test.ts lines 1283–1327)

**Export entry to add per D-12:**
```json
"./runtime/provenance": {
  "types": "./dist/runtime/provenance.d.ts",
  "import": "./dist/runtime/provenance.js",
  "default": "./dist/runtime/provenance.js"
}
```

**files allowlist:** RESEARCH.md confirms `src/runtime/*.ts` files are listed explicitly (not by glob). Add `"src/runtime/provenance.ts"` to the `files` array. The `"dist/runtime/*.js"` glob covers `dist/runtime/provenance.js` — verify `dist/runtime/provenance.d.ts` is also covered or add it explicitly.

**CHANGELOG.md and CLAUDE.md:** Not pattern-mapped here (documentation changes). Planner should treat these as editorial tasks guided by D-14 and the public-surface invariant chain in CLAUDE.md.

---

## Shared Patterns

### modelId Non-Optional Fallback
**Source:** `src/runtime/model.ts` (pattern to add)
**Apply to:** `model.ts` (emission), any code reading `modelId` from provider
```typescript
const modelId = options.model.modelId ?? options.model.id;
```
This single expression must be used everywhere `modelId` is resolved from a `ConfiguredModelProvider`. Define it once at the top of `generateModelTurn` and thread `modelId` as a parameter to `recordProviderCall`.

### ISO-8601 Timestamp Capture
**Source:** `src/runtime/model.ts` line 26 (existing pattern)
**Apply to:** `model.ts` recordProviderCall extension
```typescript
const startedAt = new Date().toISOString();   // before provider call — already at line 26
const completedAt = new Date().toISOString();  // after provider call — in recordProviderCall
```
`perf_hooks` and `process.hrtime` are explicitly out of scope (REQUIREMENTS.md).

### callId Correlation
**Source:** `src/runtime/sequential.ts` line 172, `src/runtime/model.ts` line 19 (existing pattern)
**Apply to:** Both emitted events and `ReplayTraceProviderCall`
```typescript
// callId is passed in via GenerateModelTurnOptions — no change needed
options.callId  // ties ModelRequestEvent, ModelResponseEvent, ReplayTraceProviderCall together
```

### Pure-TS Runtime Module (no Node-only deps)
**Source:** `src/runtime/termination.ts` (import pattern)
**Apply to:** `src/runtime/provenance.ts`
- Use `import type` for type-only imports
- Explicit `.js` extensions on relative imports
- No `import { readFile } from "node:fs/promises"` or any `node:` protocol imports

### ESM + Explicit .js Extensions
**Source:** All `src/runtime/*.ts` files (project-wide convention per CLAUDE.md)
**Apply to:** `src/runtime/provenance.ts`, `src/runtime/provenance.test.ts`, `src/tests/provenance-shape.test.ts`
```typescript
import { getProvenance } from "./provenance.js";  // .js, not .ts
import type { ModelRequestEvent } from "../types.js";
```

### Frozen Fixture Bootstrap Protocol
**Source:** `src/tests/replay-version-skew.test.ts` lines 30–33
**Apply to:** `src/tests/provenance-shape.test.ts`
```typescript
if (!existsSync(fixturePath)) {
  const seed = await captureProvenanceEvents();
  await writeFile(fixturePath, JSON.stringify(seed, null, 2) + "\n", "utf8");
}
```
Bootstrap runs once; thereafter the fixture is read-only. Commit the bootstrapped file.

---

## No Analog Found

All files have analogs. The two genuinely new files (`provenance.ts`, `provenance.test.ts`) have role-match analogs in the existing `src/runtime/` directory.

---

## Metadata

**Analog search scope:** `src/runtime/`, `src/types/`, `src/types.ts`, `src/providers/`, `src/internal/`, `src/tests/`, `src/tests/fixtures/`
**Files scanned:** 12 source files read directly
**Pattern extraction date:** 2026-05-01
