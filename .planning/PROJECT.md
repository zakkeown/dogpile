# Dogpile (`@dogpile/sdk`)

## What This Is

A strict, provider-neutral TypeScript SDK that runs one mission through a multi-agent coordination protocol and returns a replayable trace. For product teams that want multi-agent work without handing their application to an agent framework. Inspired by arXiv 2603.28990 ("Drop the Hierarchy and Roles"), packaged as an application SDK.

## Core Value

Coordinated, observable, replayable multi-agent runs with a strict boundary: Dogpile owns the coordination loop; the application owns credentials, pricing, storage, queues, UI, and tool side effects.

## Current State

**Shipped version:** `@dogpile/sdk@0.4.0` on 2026-05-01.

**Latest shipped milestone:** v0.4.0 Recursive Coordination.

Dogpile now supports agent-driven recursive coordination: a `coordinator` agent can return a `delegate` decision that runs a real child mission, embeds the child trace, rolls up accounting, propagates abort/timeout budget ceilings, streams child events with ancestry, and surfaces child failures back into coordinator decision context.

**Validated v0.4.0 features:**
- `delegate` decision on `coordinator` (no new protocol value)
- Inline child traces; `replay()` replays embedded children
- Budget / cancel / cost propagation parent → children
- Bounded child concurrency with local-model auto-clamp
- Provider `locality` hint (`local | remote`)
- Streaming demux via wrapped child `runId`
- Child error escalation through coordinator decision context
- Docs page, example, README row

## Current Milestone: v0.5.0 Observability and Auditability

**Goal:** Give callers full visibility into what Dogpile runs do — spans, metrics, event introspection, health diagnostics, stable audit records, and per-event provenance — without adding required dependencies or breaking the pure-TS runtime contract.

**Target features:**
- OTEL tracing bridge — caller-injected `tracer` (duck-typed against OTEL Tracer interface); SDK emits spans for runs, sub-runs, and agent turns; no-op when absent; zero new deps
- Metrics / counters — named numeric metrics (tokens, cost, turns, duration) emitted through a caller-supplied hook
- Structured event introspection — typed query/filter API over completed trace events (by type, agent, turn, cost)
- Health / diagnostics API — per-run health summary at result time: warnings, anomalies (runaway turns, budget near-miss, provider errors)
- Audit event schema — stable, versioned, human-readable audit record format for compliance
- Provenance annotations — structured metadata on each event (model id, provider id, timestamps) for decision traceability

## Requirements

### Validated

<!-- Shipped through 0.3.1. Locked unless explicitly revisited. -->

- ✓ **Public surface** — `Dogpile.pile / run / stream / createEngine / replay / replayStream`, plus `createOpenAICompatibleProvider`. Subpath exports: `/runtime/*`, `/types`, `/browser`, `/providers/openai-compatible`, `/runtime/logger`, `/runtime/retry`. — v0.1.0 → v0.3.1
- ✓ **Four first-party protocols** — `sequential`, `broadcast`, `shared`, `coordinator`; switching `protocol` does not change the result/event contract. — v0.1.0
- ✓ **Replayable trace contract** — completed runs return JSON-serializable traces (inputs, events, provider calls, transcript, accounting, output) that round-trip through `replay()`. — v0.1.0
- ✓ **Streaming** — `Dogpile.stream` emits events that match the final trace; `StreamHandle.cancel()` aborts provider requests and records `aborted`. — v0.1.0
- ✓ **Provider neutrality** — caller passes any object implementing `ConfiguredModelProvider`; SDK reads no env vars and has no required peer SDK. Dependency-free OpenAI-compatible adapter ships as the reference implementation. — v0.1.0
- ✓ **Stable typed errors** — `DogpileError` with documented string codes for validation, registration, provider, abort, timeout, and unknown-failure paths. — v0.1.0, hardened v0.3.1
- ✓ **Cost accounting** — `costUsd` computed from caller-supplied `costEstimator`; SDK bundles no pricing tables. — v0.1.0
- ✓ **End-to-end cancellation** — caller `AbortSignal`, `StreamHandle.cancel()`, and `budget.timeoutMs` all abort active provider requests. — v0.1.0
- ✓ **Runtime support** — Node.js LTS 22 / 24, Bun latest, browser ESM, all validated. — v0.1.0
- ✓ **Reproducible release gates** — local + CI build, pack, install tarball, import every public subpath, downstream type resolution, reject `workspace:` / `link:` installs, browser bundle smoke. — v0.1.0
- ✓ **Termination composability** — `budget`, `convergence`, `judge`, `firstOf`, `combineTerminationDecisions`. — v0.1.0
- ✓ **Termination floors** — `minTurns` / `minRounds` per protocol prevent convergence/judge firing before minimum progress. — v0.3.0
- ✓ **`wrapUpHint`** — one-shot signal so the next model turn can package work before hard caps terminate. — v0.3.0
- ✓ **Structured logging seam** — `@dogpile/sdk/runtime/logger`: `Logger` interface, `noopLogger`, `consoleLogger`, `loggerFromEvents`. Bridges any logger (pino/winston/console) via `handle.subscribe(loggerFromEvents(logger))`. Logger throws routed to logger's own `error` channel. — v0.3.1
- ✓ **`withRetry(provider, policy)`** — `@dogpile/sdk/runtime/retry`: opt-in transient-failure retry wrapper around any provider. Honors `error.detail.retryAfterMs`, short-circuits on `AbortSignal`, streaming forwarded unchanged. — v0.3.1
- ✓ **Browser ESM bundle** — `@dogpile/sdk/browser` + package root `browser` condition, both resolve to `dist/browser/index.js`. — v0.1.0
- ✓ **Paper-reproduction benchmark** — deterministic `pnpm run benchmark:baseline` harness over `benchmark-fixtures/`. — v0.2.0
- ✓ **Recursive coordination via `delegate`** — coordinator agents can dispatch `sequential`, `broadcast`, `shared`, or nested `coordinator` child missions with inline traces and replay support. — v0.4.0
- ✓ **Recursive budget, cancellation, and accounting** — parent abort/timeout ceilings propagate to children; costs and tokens roll up recursively. — v0.4.0
- ✓ **Provider locality and bounded child concurrency** — `metadata.locality`, OpenAI-compatible locality detection, `maxConcurrentChildren`, queued events, and local-provider clamp. — v0.4.0
- ✓ **Recursive streaming and child failure handling** — child stream events bubble with `parentRunIds`; coordinator decision context receives real child failures; unhandled terminal failures preserve child error identity. — v0.4.0
- ✓ **Recursive coordination documentation and release artifacts** — concept docs, exhaustive reference, runnable example, README/examples links, changelog, GitHub Release, and npm package. — v0.4.0

### Active

Requirements for v0.5.0 Observability and Auditability. See REQUIREMENTS.md for full REQ-ID list.

### Out of Scope

<!-- Explicit boundaries from CLAUDE.md. Re-adding requires explicit discussion. -->

- **Credentials, API keys, env reads** — caller's provider object owns all credentials; SDK never reads env vars.
- **Pricing tables** — caller supplies `costEstimator`; SDK bundles no pricing data.
- **Persistence, storage, queues, databases, session state** — caller persists `result.trace` wherever work already lives.
- **UI surface** — SDK emits events; rendering is the caller's job.
- **Tool side effects and policy** — web search, code execution, etc. run under caller policy. SDK only adapts.
- **Node-only deps in `src/runtime/`, `src/browser/`, `src/providers/`** — same code must run on Node 22/24, Bun latest, browser ESM.
- **Privileged providers** — OpenAI-compatible adapter is reference, not privileged. No assumed SDK or pricing beyond `ConfiguredModelProvider`.
- **Bare `dogpile` npm alias** — only `@dogpile/sdk` ships. No unscoped package.
- **Vercel AI provider as published surface** — internalized to `src/internal/vercel-ai.ts` so `ai` does not become a peer dep. — v0.3.1
- **Non-LTS Node, Deno, edge runtimes (as advertised targets)** — only Node 22/24, Bun latest, browser ESM are supported targets for this release line.

## Context

- Inspired by arXiv 2603.28990 ("Drop the Hierarchy and Roles"); the SDK is the application packaging of that paper's coordination model.
- Repo transferred GitHub org `zakkeown/dogpile` → `bubstack/dogpile` at v0.1.1; npm Trusted Publisher uses the `bubstack` org.
- Co-located unit tests live next to subjects in `src/runtime/`. Contract / packaging / browser-bundle tests live in `src/tests/` — these are the gates that protect the published contract.
- `src/testing/` is a *published* library of deterministic test helpers for SDK consumers — distinct from internal tests.
- `src/benchmark/` is a published code module (the `./benchmark` export, paper-reproduction surface). `benchmark-fixtures/` is repo-only.
- Detailed codebase mapping already lives at `.planning/codebase/` (ARCHITECTURE, STACK, CONVENTIONS, INTEGRATIONS, STRUCTURE, TESTING, CONCERNS).

## Constraints

- **Tech stack**: Node.js ≥ 22, pnpm 10.33.0 (declared in `packageManager`), TypeScript strict mode (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Vitest, Vite (browser bundle).
- **Runtime targets**: Node 22 / 24 LTS, Bun latest, browser ESM. `src/runtime/`, `src/browser/`, `src/providers/` must run on all of them.
- **Module format**: ESM only with explicit `.js` extensions in relative imports.
- **Public-surface discipline**: subpath exports, the `files` allowlist in `package.json`, and `src/tests/package-exports.test.ts` must move together. Adding/removing any subpath is a public-API change.
- **Replayable trace shape**: event-shape changes are public-API changes — update `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, and `CHANGELOG.md`.
- **License**: Apache-2.0.
- **Compatibility**: Conventional Commit subjects; PRs list verification commands and call out public-API / packaging / browser-bundle impact.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Provider-neutral `ConfiguredModelProvider` (`{ id, generate(request) }`) as the only model boundary | Keeps the SDK from owning credentials, retries, pricing, vendor SDKs | ✓ Good |
| OpenAI-compatible adapter is reference, not privileged | Preserves provider neutrality; no built-in path is "blessed" | ✓ Good |
| Pure TS runtime — no Node-only deps in `src/runtime/`, `src/browser/`, `src/providers/` | Same code must run on Node 22/24, Bun, browser ESM | ✓ Good |
| Replayable JSON-serializable trace as the unit of artifact | Lets callers store runs wherever work already lives; enables replay/audit/evals | ✓ Good |
| Strict TS with `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` | Catches optional/index bugs at the type layer | ✓ Good |
| Reproducible release gates (pack, install tarball, import every subpath, type-check downstream) | Protects published contract from local-only or workspace-only successes | ✓ Good |
| Internalize Vercel AI adapter to `src/internal/` | Avoids `ai` becoming a peer dependency; preserves provider neutrality | ✓ Good (v0.3.1) |
| Scoped npm name `@dogpile/sdk` only; no bare `dogpile` alias | Avoids name-squat ambiguity; npm Trusted Publisher under `bubstack` | ✓ Good |
| `costUsd` driven by caller-supplied `costEstimator`; no bundled pricing | SDK avoids stale pricing tables; caller owns vendor pricing | ✓ Good |
| Deterministic paper-reproduction benchmark without making a perf claim | Allows protocol-loop baseline comparisons without overpromising | ✓ Good |
| `delegate` on `coordinator`, not a fifth protocol | Recursive behavior is naturally a coordinator concern and preserves the four-protocol invariant | ✓ Good (v0.4.0) |
| Embedded child traces are the recursive replay unit | Keeps traces self-contained and lets replay avoid provider calls | ✓ Good (v0.4.0) |
| `parentRunIds` is the stream ancestry shape | Supports nested demux without adding a flat, ambiguous `parentRunId` | ✓ Good (v0.4.0) |
| Local providers clamp child concurrency to 1 | Protects local runtimes from unsafe fan-out while preserving remote parallelism | ✓ Good (v0.4.0) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-01 — v0.5.0 Observability and Auditability milestone started.*
