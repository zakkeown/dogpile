<!-- refreshed: 2026-04-29 -->
# Architecture

**Analysis Date:** 2026-04-29

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                       Public surface (`src/index.ts`)                │
│   Dogpile.pile / run / stream / createEngine / replay / replayStream │
│   createOpenAICompatibleProvider · DogpileError · termination DSL    │
│   built-in tool adapters · public types (re-exported from types.ts)  │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Engine / orchestrator                            │
│                  `src/runtime/engine.ts`                             │
│   - normalizes options, defaults, agent ordering, termination        │
│   - owns AbortController + timeout race + cancellation translation  │
│   - non-streaming path (`runNonStreamingProtocol`)                  │
│   - streaming path (`StreamHandle`: async iterator + subscribe)     │
│   - `replay` / `replayStream` (provider-free trace rehydration)     │
└──────┬──────────────────┬──────────────────┬──────────────────┬─────┘
       │                  │                  │                  │
       ▼                  ▼                  ▼                  ▼
┌────────────┐    ┌──────────────┐    ┌─────────────┐    ┌────────────┐
│ sequential │    │  broadcast   │    │ coordinator │    │   shared   │
│   `src/    │    │   `src/      │    │   `src/     │    │   `src/    │
│  runtime/  │    │   runtime/   │    │   runtime/  │    │  runtime/  │
│sequential  │    │ broadcast.ts │    │coordinator  │    │ shared.ts` │
│   .ts`     │    │              │    │   .ts`      │    │            │
└─────┬──────┘    └──────┬───────┘    └──────┬──────┘    └─────┬──────┘
      │                  │                   │                  │
      └────────────┬─────┴───────────────────┴──────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Per-turn / cross-cutting helpers                  │
│  model.ts (provider call + streaming chunk fan-out + trace record)   │
│  decisions.ts (parse `role_selected/participation/contribution`)     │
│  termination.ts (budget · convergence · judge · firstOf)             │
│  tools.ts (runtime tool adapters, built-in webSearch / codeExec)     │
│  wrap-up.ts (final-turn hint controller)                             │
│  cancellation.ts (abort + timeout DogpileError translation)          │
│  defaults.ts (agents, tier→temperature, trace canonicalization,      │
│               accounting, event log, transcript link helpers)        │
│  validation.ts (input validation → DogpileError("invalid-...")       │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│        Caller-supplied `ConfiguredModelProvider { id, generate,      │
│        stream? }`  — Dogpile reads no env, has no required SDK       │
│  Reference: `src/providers/openai-compatible.ts`                     │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Public exports | Single curated module; only public surface | `src/index.ts` |
| Engine | Orchestrator + cancellation lifecycle + replay | `src/runtime/engine.ts` |
| Sequential protocol | One agent per turn, ordered | `src/runtime/sequential.ts` |
| Broadcast protocol | All agents per round, multi-round | `src/runtime/broadcast.ts` |
| Coordinator protocol | Lead agent dispatches subordinates | `src/runtime/coordinator.ts` |
| Shared protocol | Agents read/write shared organizational memory | `src/runtime/shared.ts` |
| Model turn | Provider call + streaming chunk fan-out + trace record | `src/runtime/model.ts` |
| Decisions parser | Parses agent text into `AgentDecision` | `src/runtime/decisions.ts` |
| Termination DSL | `budget` · `convergence` · `judge` · `firstOf` · combinators | `src/runtime/termination.ts` |
| Tools | Runtime tool adapter contract, built-in `webSearch`/`codeExec` | `src/runtime/tools.ts` |
| Wrap-up hint | Final-turn hint controller | `src/runtime/wrap-up.ts` |
| Cancellation | Abort/timeout → typed `DogpileError` | `src/runtime/cancellation.ts` |
| Defaults & trace | Canonical trace, accounting, default agents, tier→temperature | `src/runtime/defaults.ts` |
| Validation | Public-input validation → `invalid-configuration` errors | `src/runtime/validation.ts` |
| Public types | All exported types and `DogpileError` class | `src/types.ts` |
| Reference provider | OpenAI-compatible chat completions adapter | `src/providers/openai-compatible.ts` |
| Browser entry | Bundle entry that re-exports `../index.js` | `src/browser/index.ts` |
| Repo-internal demos | Not shipped; powers benchmarks and demos | `src/internal.ts`, `src/demo.ts` |

## Pattern Overview

**Overall:** Stateless, provider-neutral SDK with a small composable runtime.
The public API is a thin facade (`run`, `stream`, `Dogpile.pile`, `createEngine`)
over a per-protocol functional core. Every completed run produces a single
JSON-serializable `Trace` that round-trips through `replay()`.

**Key Characteristics:**
- Pure TypeScript runtime — no Node-only deps, no filesystem, no env reads in `src/runtime/`, `src/browser/`, `src/providers/`. Same code runs under Node 22+, Bun, and browser ESM.
- Provider boundary is a single interface, `ConfiguredModelProvider { id, generate(request), stream?(request) }` (`src/types.ts`). Callers own credentials, pricing, retries, and storage.
- Replayable trace contract: completed runs return `{ output, eventLog, trace, transcript, usage, metadata, accounting, cost, quality? }` (`RunResult`). `replay(trace)` and `replayStream(trace)` rehydrate without calling any provider.
- Composable termination as data: `TerminationCondition` is a discriminated union (`kind: "budget" | "convergence" | "judge" | "firstOf"`), JSON-serializable, evaluated centrally in `src/runtime/termination.ts`.
- Per-protocol functional core: each of the four protocols is a single `runX(options)` async function returning a `RunResult`. They share helpers (`defaults.ts`, `model.ts`, `decisions.ts`) but never call each other.
- Streaming and non-streaming share the same event shapes — live consumers and persisted traces use one schema (`RunEvent`).
- ESM-only with explicit `.js` extensions on relative imports (TS resolves through `.js`).

## Layers

**Public surface layer:**
- Purpose: Narrow, deliberate caller-facing API
- Location: `src/index.ts`, `src/types.ts`, `src/browser/index.ts`
- Contains: Re-exports from runtime + types, no logic
- Depends on: `src/runtime/*`, `src/providers/openai-compatible.ts`
- Used by: External consumers via `@dogpile/sdk` (and subpath exports `@dogpile/sdk/runtime/*`, `/types`, `/browser`, `/providers/openai-compatible`)

**Engine / orchestrator layer:**
- Purpose: High-level entrypoints, defaults, cancellation lifecycle, replay
- Location: `src/runtime/engine.ts`
- Contains: `createEngine`, `run`, `stream`, `replay`, `replayStream`, `Dogpile`; abort race, timeout lifecycle, evaluation post-processing
- Depends on: All four protocol modules, `defaults.ts`, `cancellation.ts`, `termination.ts`, `validation.ts`
- Used by: `src/index.ts`

**Protocol layer:**
- Purpose: Coordinate one mission across one of four protocols
- Location: `src/runtime/sequential.ts`, `broadcast.ts`, `coordinator.ts`, `shared.ts`
- Contains: One `runX(options): Promise<RunResult>` per protocol; emits `RunEvent`s; assembles `Trace`, `transcript`, `RunAccounting`
- Depends on: `model.ts`, `decisions.ts`, `defaults.ts`, `termination.ts`, `tools.ts`, `wrap-up.ts`, `cancellation.ts`
- Used by: `engine.ts` (protocol switch in `runProtocol`)

**Per-turn / cross-cutting layer:**
- Purpose: Reusable mechanics common to all protocols
- Location: `src/runtime/model.ts`, `decisions.ts`, `termination.ts`, `tools.ts`, `wrap-up.ts`, `cancellation.ts`, `defaults.ts`, `validation.ts`
- Depends on: `src/types.ts` only (no upward imports)
- Used by: All four protocol modules and `engine.ts`

**Provider boundary layer:**
- Purpose: Interface where caller-supplied LLM providers plug in
- Location: `ConfiguredModelProvider` in `src/types.ts`; reference adapter at `src/providers/openai-compatible.ts`
- Contains: Type contract only; reference adapter wraps `fetch` against any OpenAI-compatible chat completions endpoint
- Depends on: `src/types.ts`
- Used by: `src/runtime/model.ts` (the only place provider methods are invoked)

## Data Flow

### Primary Request Path (non-streaming `run` / `Dogpile.pile`)

1. Caller invokes `run({ intent, model, protocol?, tier?, ... })` (`src/runtime/engine.ts:690`).
2. `validateDogpileOptions` enforces public-input contract (`src/runtime/validation.ts`).
3. `withHighLevelDefaults` applies `protocol="sequential"`, `tier="balanced"` (`src/runtime/engine.ts:860`).
4. `createEngine` normalizes the protocol config, derives temperature from tier, orders agents deterministically when `temperature===0`, and wires budget→termination (`src/runtime/engine.ts:62`).
5. `runNonStreamingProtocol` builds an abort/timeout lifecycle, then calls `runProtocol` (`src/runtime/engine.ts:526`).
6. `runProtocol` switches on `protocol.kind` and dispatches to `runSequential` / `runBroadcast` / `runCoordinator` / `runShared` (`src/runtime/engine.ts:608`).
7. The protocol loop, per turn:
   - Builds a `ModelRequest`, calls `generateModelTurn` which invokes `model.generate` or fans `model.stream` chunks into `model-output-chunk` events (`src/runtime/model.ts:25`).
   - Records a `ReplayTraceProviderCall`, emits `model-request` / `model-response` and protocol-specific events.
   - Parses agent text into an `AgentDecision` via `parseAgentDecision` (`src/runtime/decisions.ts`).
   - Executes any tool requests through the runtime tool executor (`src/runtime/tools.ts`).
   - Evaluates `evaluateTerminationStop` against the configured `TerminationCondition` (`src/runtime/termination.ts`).
8. After the loop, the protocol assembles a `Trace`, `transcript`, `RunAccounting`, and `RunEvent[]` and returns a `RunResult`.
9. `engine.ts` post-processes: rebuilds `accounting`, derives `budgetStateChanges` and `finalOutput`, optionally applies `evaluate(result)`, then `canonicalizeRunResult` produces the deterministic JSON shape.
10. Caller receives `RunResult { output, eventLog, trace, transcript, usage, metadata, accounting, cost, quality? }`.

### Streaming Path (`stream` / `Dogpile.stream`)

1. Same validation + defaults as above.
2. `Engine.stream(intent)` returns a `StreamHandle` immediately and starts `execute()` async (`src/runtime/engine.ts:92`).
3. Each `RunEvent` emitted by the protocol is canonicalized and pushed to: pending async-iterator queue, pending subscribers, and a buffered list (so late `subscribe()` callers replay history).
4. `final` events are deferred until after evaluation post-processing so the streamed final matches the resolved `RunResult`.
5. On error/abort/timeout, an `error` stream event is emitted, status flips to `failed` / `cancelled`, and `result` rejects with a typed `DogpileError`.

### Replay Path

1. Caller passes a saved `Trace` to `replay(trace)` (`src/runtime/engine.ts:726`).
2. No provider is called. `replay` rebuilds `RunResult` from `trace.events`, `trace.transcript`, `trace.finalOutput`, and the embedded cost summary.
3. `replayStream(trace)` yields the saved events in order to subscribers / async-iterator consumers (`src/runtime/engine.ts:773`).

**State Management:**
- Engine state is per-call. `createEngine` returns an object whose `run`/`stream` methods are stateless between calls — each invocation produces its own trace, event log, transcript, and accounting.
- No module-level mutable state. No singletons. No env reads. No filesystem.
- Cancellation state is scoped to a single `StreamHandle` via local `AbortController` and `closures`.

## Key Abstractions

**`ConfiguredModelProvider` (`src/types.ts`):**
- Purpose: The single provider boundary
- Shape: `{ id: string, generate(request), stream?(request) }`
- Pattern: Caller constructs and passes in; SDK never instantiates one itself

**`Protocol` / `ProtocolConfig` (`src/types.ts`):**
- Purpose: Discriminated union selecting and configuring one of four coordinator topologies
- Examples: `"sequential"`, `{ kind: "broadcast", maxRounds: 2 }`, `{ kind: "coordinator", maxTurns: 3 }`
- Pattern: String shorthand normalized via `normalizeProtocol` (`src/runtime/defaults.ts:28`)

**`TerminationCondition` (`src/runtime/termination.ts`):**
- Purpose: Composable, JSON-serializable stop conditions
- Examples: `budget({ maxUsd: 1 })`, `firstOf([budget(...), convergence({ stableTurns: 2 })])`, `judge({ rubric, ... })`
- Pattern: Tagged union evaluated centrally; combinator `firstOf` collects child stop records into `TerminationStopRecord`

**`AgentSpec` / `AgentDecision` (`src/types.ts`, `src/runtime/decisions.ts`):**
- Purpose: Per-agent identity (`id`, `role`, `instructions`) and per-turn parsed output
- Pattern: Agents emit a structured `role_selected: / participation: / rationale: / contribution:` block parsed by `parseAgentDecision`. Agents that abstain are skipped.

**`Trace` and `RunEvent` (`src/types.ts`):**
- Purpose: One canonical, replayable, JSON-serializable record per run
- Pattern: All trace mutations produced in protocol modules go through `defaults.ts` helpers to keep the shape stable. Event-shape changes are public-API changes.

**`RuntimeTool` and built-in tools (`src/runtime/tools.ts`):**
- Purpose: Caller-supplied or built-in tool adapters under caller policy
- Examples: `createWebSearchToolAdapter`, `createCodeExecToolAdapter`
- Pattern: Pluggable executor + JSON schema input; permissions and identity attached to each adapter.

## Entry Points

**`Dogpile.pile(options)` / `run(options)`:**
- Location: `src/runtime/engine.ts:876`, `src/runtime/engine.ts:690`
- Triggers: Caller invocation
- Responsibilities: High-level non-streaming workflow; resolves to `RunResult`

**`stream(options)`:**
- Location: `src/runtime/engine.ts:709`
- Triggers: Caller invocation
- Responsibilities: Returns a `StreamHandle` (async-iterable + subscribable) plus a `result` promise

**`createEngine(options)`:**
- Location: `src/runtime/engine.ts:62`
- Triggers: Research / harness code that reuses settings across many missions
- Responsibilities: Returns `{ run, stream }` over normalized protocol/tier/agents/budget/termination

**`replay(trace)` / `replayStream(trace)`:**
- Location: `src/runtime/engine.ts:726`, `src/runtime/engine.ts:773`
- Triggers: Persisted-trace consumers (UIs, observability)
- Responsibilities: Rehydrate `RunResult` / re-emit events without any provider call

**`createOpenAICompatibleProvider(options)`:**
- Location: `src/providers/openai-compatible.ts`
- Triggers: Caller wiring an OpenAI-compatible endpoint
- Responsibilities: Returns a `ConfiguredModelProvider`. Reference adapter only — every other provider is caller-supplied.

## Architectural Constraints

- **Threading:** Single-threaded async; one mission per `run`/`stream` call. Streaming uses an `AbortController`/timeout race orchestrated in `src/runtime/engine.ts`. No worker threads, no shared mutable state.
- **Global state:** None. No module-level mutable state, no singletons, no env reads, no filesystem in `src/runtime/`, `src/browser/`, `src/providers/`. The package declares `"sideEffects": false` in `package.json`.
- **Circular imports:** None. Layering is strict: `types.ts` → cross-cutting helpers → protocols → engine → public surface. Cross-cutting helpers do not import from protocols, and protocols do not import each other.
- **Provider neutrality:** No code outside `src/providers/openai-compatible.ts` may assume an SDK or pricing table beyond `ConfiguredModelProvider`. The OpenAI-compatible adapter is the reference implementation, not a privileged path.
- **Replayable trace contract:** Event-shape, `Trace` shape, and `RunResult` shape are public API. Changes require updates to `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, and `CHANGELOG.md`.
- **Public-surface gate:** Adding or removing any subpath export in `package.json#exports` must be reflected in `src/tests/package-exports.test.ts` and `scripts/check-package-artifacts.mjs`. The `files` allowlist in `package.json` controls the tarball.
- **ESM with explicit `.js` extensions** in relative imports (TS resolves through `.js` even though source is `.ts`).
- **Strict TS:** `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` are on (`tsconfig.json`).
- **Browser-safe runtime:** The `browser` export condition resolves through `src/browser/index.ts` to `dist/browser/`. Any Node-only API in the runtime breaks the browser bundle smoke test (`src/tests/browser-bundle-smoke.test.ts`).

## Anti-Patterns

### Importing a provider SDK from runtime code

**What happens:** A runtime module imports an LLM SDK directly (e.g. `import OpenAI from "openai"`).
**Why it's wrong:** Breaks provider neutrality and the browser bundle, forces a peer dependency, and violates the `ConfiguredModelProvider` boundary that callers rely on.
**Do this instead:** Accept `ConfiguredModelProvider` and call `model.generate` / `model.stream` (see `src/runtime/model.ts:25`). Provider adapters live only under `src/providers/`.

### Reading env vars or filesystem from runtime/browser/providers

**What happens:** Code in `src/runtime/`, `src/browser/`, or `src/providers/` reaches for `process.env`, `fs`, `path`, etc.
**Why it's wrong:** The same module must run under Node, Bun, and the browser. Env/FS access breaks the browser bundle smoke and the provider-neutral contract.
**Do this instead:** Take everything via options. Callers own configuration. See how `src/providers/openai-compatible.ts` accepts `apiKey`, `baseUrl`, and `fetch` as options rather than reading env.

### Mutating or reshaping `Trace` / `RunEvent` outside the helpers

**What happens:** A protocol module hand-builds a trace shape or pushes a new event field directly.
**Why it's wrong:** The trace must be canonical and replayable. Shape drift breaks `replay()`, the event schema test, and consumer expectations.
**Do this instead:** Use the helpers in `src/runtime/defaults.ts` (`createReplayTraceProtocolDecision`, `createRunEventLog`, `canonicalizeRunResult`, etc.) and update `src/tests/event-schema.test.ts` and `CHANGELOG.md` if the public shape genuinely needs to change.

### Throwing raw `Error` instances across the public boundary

**What happens:** A protocol or provider helper throws a generic `Error` or rethrows a provider SDK error untouched.
**Why it's wrong:** Callers branch on stable `DogpileErrorCode` values (`src/types.ts`); raw errors break that contract and lose `providerId` / `retryable` metadata.
**Do this instead:** Throw a `DogpileError` with a stable `code` (see `src/runtime/cancellation.ts` and `src/runtime/validation.ts` for canonical examples).

### Per-protocol divergence in result shape

**What happens:** A new protocol returns a slightly different `RunResult` (e.g., omits `accounting`, renames `transcript`).
**Why it's wrong:** The contract guarantees that switching `protocol` does not change the result shape.
**Do this instead:** Each protocol assembles its result with the same `defaults.ts` helpers. Add `src/tests/` coverage for the new protocol against `result-contract.test.ts`.

## Error Handling

**Strategy:** All public errors are instances of `DogpileError` (`src/types.ts`) with a stable `DogpileErrorCode` discriminant. Caller code branches on `error.code`, never on class identity beyond `DogpileError.isInstance(error)`.

**Patterns:**
- Validation: `src/runtime/validation.ts` throws `code: "invalid-configuration"` with `detail` describing the failing field.
- Cancellation/timeout: `src/runtime/cancellation.ts` produces `code: "aborted"` or `code: "timeout"` from the active `AbortSignal` reason.
- Provider failures: `src/providers/openai-compatible.ts` and the engine translate provider/network failures into the `provider-*` code family.
- Streaming: the engine emits a `StreamErrorEvent` and rejects the `result` promise with the same `DogpileError` (`src/runtime/engine.ts:457`).

## Cross-Cutting Concerns

**Logging:** None built-in. The SDK emits `RunEvent`s; callers wire them to logs/observability via `stream` subscribers or by walking `trace.events`.

**Validation:** Centralized in `src/runtime/validation.ts`. Every public entrypoint validates inputs before doing any work.

**Authentication:** Out of scope. Providers carry their own credentials; Dogpile reads no env vars.

**Cost & accounting:** Aggregated centrally in `src/runtime/defaults.ts` (`createRunAccounting`, `createRunUsage`, `addCost`). Per-call cost can be supplied by the provider on `ModelResponse.costUsd` / streaming chunks.

**Cancellation:** `AbortSignal` flows from caller → `EngineOptions.signal` → `ModelRequest.signal` → provider. Timeouts derived from `budget.timeoutMs` and `terminate.timeoutMs` race the operation in `src/runtime/engine.ts`.

---

*Architecture analysis: 2026-04-29*
