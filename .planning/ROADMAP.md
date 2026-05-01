---
milestone: v0.4.0
name: Recursive Coordination
phases_total: 5
requirements_total: 27
---

# Roadmap — v0.4.0 Recursive Coordination

**Goal:** Let a `coordinator` run dispatch whole sub-missions (`sequential`, `broadcast`, `shared`, `coordinator`) as first-class agent decisions, with traces, costs, cancellation, and concurrency that compose cleanly. Agent-driven nesting only — caller-defined trees (`Dogpile.nest`) are deferred.

**Granularity:** Standard (5 phases). Phases follow dependency order: foundational decision shape + traces → propagation semantics → concurrency safety → bubbling and error pathways → docs/changelog.

## Phases

- [x] **Phase 1: Delegate Decision & Sub-Run Traces** — `delegate` decision on `coordinator`; embedded child traces; replay-without-re-execute; event-shape locks.
- [x] **Phase 2: Budget, Cancellation, Cost Roll-Up** — Parent abort + timeout propagation; recursive cost/token roll-up; per-instance termination floors.
- [x] **Phase 3: Provider Locality & Bounded Concurrency** — `locality` field on `ConfiguredModelProvider`; OpenAI-compatible auto-detect; `maxConcurrentChildren` with local auto-clamp.
- [ ] **Phase 4: Streaming & Child Error Escalation** — Child events wrapped on parent stream; cancel propagation; child failure surfaced through coordinator decision context.
- [ ] **Phase 5: Documentation & Changelog** — `docs/recursive-coordination.md`, runnable example, README row, CHANGELOG v0.4.0 entry.

## Phase Details

### Phase 1: Delegate Decision & Sub-Run Traces
**Goal**: Coordinator agents can return a `delegate` decision that runs a real sub-mission, and the parent trace contains the child's full trace inline so `replay()` rehydrates without re-executing children.
**Depends on**: Nothing (foundational; everything else builds on this surface).
**Requirements**: DELEGATE-01, DELEGATE-02, DELEGATE-03, DELEGATE-04, TRACE-01, TRACE-02, TRACE-03, TRACE-04
**Success Criteria** (what must be TRUE):
  1. A coordinator agent returning `{ type: "delegate", protocol, intent }` causes the runtime to run a real sub-mission and feed `result` back into the coordinator's next decision context, with child model defaulting to parent and child budget defaulting to parent's remaining.
  2. Invalid `delegate` payloads (unknown protocol, missing `intent`) and depth overflow (`> maxDepth`, default 4) throw `DogpileError({ code: "invalid-configuration", detail.path })` before any child run starts.
  3. Every delegated run emits a `subRun.started` event on parent trace at start and a `subRun.completed` (with child trace inline) or `subRun.failed` (with child error) event at end; child `runId` and parent decision id are present on both.
  4. `Dogpile.replay(parentTrace)` produces identical `output`, `accounting`, and event sequence to the original run without invoking any provider, including for nested children.
  5. `src/tests/event-schema.test.ts` and `src/tests/result-contract.test.ts` lock the new event variants and result-shape additions.
**Key files**: `src/runtime/coordinator.ts`, `src/runtime/engine.ts`, `src/runtime/decisions.ts`, `src/runtime/validation.ts`, `src/runtime/defaults.ts`, `src/types.ts`, `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, `src/runtime/coordinator.test.ts`
**Plans**: 5 plans
- [x] 01-01-agent-decision-union-and-delegate-parsing-PLAN.md — discriminated AgentDecision union + fenced-JSON delegate parsing
- [x] 01-02-sub-run-event-types-and-transcript-role-PLAN.md — sub-run-* event types, RunEvent union, public-surface lock
- [x] 01-03-coordinator-delegate-dispatch-loop-PLAN.md — coordinator plan-turn delegate dispatch + sub-run event emission
- [x] 01-04-max-depth-option-and-overflow-validation-PLAN.md — maxDepth option + dual parse/dispatch overflow enforcement
- [x] 01-05-replay-recursion-and-accounting-recompute-PLAN.md — replay walks sub-runs, recomputes accounting, CHANGELOG entry

### Phase 2: Budget, Cancellation, Cost Roll-Up
**Goal**: Parent abort, timeout, and cost accounting compose cleanly across the recursive tree; termination floors stay scoped per-protocol-instance.
**Depends on**: Phase 1 (cost roll-up reads `subRun.completed` payload; abort propagation rides the same parent→child link).
**Requirements**: BUDGET-01, BUDGET-02, BUDGET-03, BUDGET-04
**Success Criteria** (what must be TRUE):
  1. Cancelling the parent (`AbortSignal`, `StreamHandle.cancel()`) aborts every in-flight child; child surfaces `DogpileError({ code: "aborted" })` and parent's `subRun.failed` event captures it.
  2. Parent `budget.timeoutMs` is a hard ceiling for the whole tree: children inherit the parent's remaining time as their default; per-decision `budget` overrides are honored but cannot exceed parent's remaining.
  3. Parent `accounting.costUsd`, `usage.inputTokens`, and `usage.outputTokens` equal the sum of parent's own provider calls plus all children's accounting, recursive across depth.
  4. Parent termination policies (`budget`, `convergence`, `judge`, `firstOf`) evaluate over parent-level events only; `minTurns`/`minRounds` floors apply per-protocol-instance and do not propagate into children.
**Key files**: `src/runtime/coordinator.ts`, `src/runtime/engine.ts`, `src/runtime/cancellation.ts`, `src/runtime/termination.ts`, `src/runtime/defaults.ts`, `src/runtime/coordinator.test.ts`, `src/tests/cancellation-contract.test.ts`, `src/tests/budget-first-stop.test.ts`
**Plans**: 4 plans
- [x] 02-01-PLAN.md — BUDGET-01 cancellation propagation (per-child AbortController, parent-aborted detail.reason, post-completion abort marker)
- [x] 02-02-PLAN.md — BUDGET-02 timeout/deadline propagation (parentDeadlineMs, sub-run-budget-clamped event, defaultSubRunTimeoutMs option, timeout detail.reason)
- [x] 02-03-PLAN.md — BUDGET-03 cost & token roll-up + replay parity (partialCost on sub-run-failed, parent-rollup-drift)
- [x] 02-04-PLAN.md — BUDGET-04 termination floors lock (parent-events isolation, per-instance minTurns/minRounds)

### Phase 3: Provider Locality & Bounded Concurrency
**Goal**: Providers can declare `local` vs `remote`; coordinator runs delegated decisions in parallel up to a bound, auto-clamping to 1 when any local provider is in the active tree.
**Depends on**: Phase 1 (concurrency operates on delegated decisions). PROVIDER-01 must land before CONCURRENCY-02 — same phase, ordered intra-phase.
**Requirements**: PROVIDER-01, PROVIDER-02, PROVIDER-03, CONCURRENCY-01, CONCURRENCY-02
**Success Criteria** (what must be TRUE):
  1. `ConfiguredModelProvider` accepts optional `locality?: "local" | "remote"`; absent value is treated as `remote` for clamping; invalid value throws `DogpileError({ code: "invalid-configuration" })`.
  2. `createOpenAICompatibleProvider` auto-sets `locality: "local"` for loopback/RFC1918 `baseURL` hosts; caller-supplied `locality` overrides auto-detection.
  3. When a coordinator turn emits N `delegate` decisions, at most `maxConcurrentChildren` (default 4) execute concurrently; the rest queue and start as slots free up.
  4. When any provider in the active tree declares `locality: "local"`, effective concurrency clamps to 1 regardless of caller config and emits a `subRun.concurrencyClamped` event with `reason: "local-provider-detected"`.
**Key files**: `src/types.ts`, `src/providers/openai-compatible.ts`, `src/runtime/validation.ts`, `src/runtime/coordinator.ts`, `src/runtime/defaults.ts`, `src/providers/openai-compatible.test.ts`, `src/runtime/coordinator.test.ts`, `src/tests/event-schema.test.ts`, `src/tests/config-validation.test.ts`
**Plans**: 3 plans
- [x] 03-01-PLAN.md — Provider Locality (PROVIDER-01..03): metadata.locality field + classifyHostLocality + dual validation + asymmetric override
- [x] 03-02-PLAN.md — Bounded Dispatch + Array-Parser Unlock (CONCURRENCY-01): semaphore, fan-out, sub-run-queued event, sibling-failed drain, completion-order transcript
- [x] 03-03-PLAN.md — Local-Provider Clamping + Event (CONCURRENCY-02): per-dispatch locality walk, lazy single-emit subRun.concurrencyClamped, CHANGELOG v0.4.0 wrap-up

### Phase 4: Streaming & Child Error Escalation
**Goal**: Live consumers see child events demultiplexable by `runId`, parent cancel reaches every child stream, and child failures surface as first-class context to the coordinator agent (or escalate unwrapped if unhandled).
**Depends on**: Phases 1-2 (uses `subRun.*` events and abort propagation built earlier).
**Requirements**: STREAM-01, STREAM-02, STREAM-03, ERROR-01, ERROR-02, ERROR-03
**Success Criteria** (what must be TRUE):
  1. `Dogpile.stream(parent)` emits each child event wrapped with `parentRunId` and the child's `runId`; within a single child, event order is preserved (cross-child order unspecified).
  2. `StreamHandle.cancel()` on the parent aborts every in-flight child stream and the parent stream itself with `DogpileError({ code: "aborted" })`.
  3. A child failure surfaces as a `subRun.failed` event in the coordinator's next decision context; the coordinator agent can retry, delegate differently, or terminate.
  4. If the parent terminates without final synthesis after an unhandled child failure, the parent throws the child's original `DogpileError` unwrapped (same `code`, `providerId`, `detail`).
  5. Child timeouts surface as `provider-timeout` at the child level; parent-level timeouts surface as `aborted` with `detail.reason: "timeout"`.
**Key files**: `src/runtime/engine.ts`, `src/runtime/coordinator.ts`, `src/runtime/cancellation.ts`, `src/types.ts`, `src/tests/streaming-api.test.ts`, `src/tests/cancellation-contract.test.ts`, `src/tests/public-error-api.test.ts`, `src/runtime/coordinator.test.ts`
**Plans**: TBD

### Phase 5: Documentation & Changelog
**Goal**: Recursive coordination is discoverable: dedicated docs page, runnable example, README row, and a CHANGELOG entry that lists every public-surface addition.
**Depends on**: Phases 1-4 (docs describe shipped behavior).
**Requirements**: DOCS-01, DOCS-02, DOCS-03, DOCS-04
**Success Criteria** (what must be TRUE):
  1. `docs/recursive-coordination.md` documents the `delegate` decision shape, propagation rules (abort/timeout/cost), concurrency and locality, and trace embedding, with at least one worked example.
  2. `examples/recursive-coordination/` is a runnable example wired against `createOpenAICompatibleProvider` that exercises a real `delegate` flow end-to-end.
  3. README's "Choose Your Path" table gains a row pointing at `delegate` / recursive coordination.
  4. `CHANGELOG.md` v0.4.0 entry lists every public-surface addition: `delegate` decision variant, `subRun.*` events, `locality` field, `maxConcurrentChildren` config, `maxDepth` config.
**Key files**: `docs/recursive-coordination.md`, `examples/recursive-coordination/`, `README.md`, `CHANGELOG.md`, `examples/README.md`
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Delegate Decision & Sub-Run Traces | 5/5 | Complete | 2026-04-30 |
| 2. Budget, Cancellation, Cost Roll-Up | 4/4 | Complete | 2026-04-30 |
| 3. Provider Locality & Bounded Concurrency | 3/3 | Complete | 2026-05-01 |
| 4. Streaming & Child Error Escalation | 0/0 | Not started | - |
| 5. Documentation & Changelog | 0/0 | Not started | - |

## Coverage

27/27 v0.4.0 requirements mapped (no orphans, no duplicates):

- Phase 1 (8): DELEGATE-01, DELEGATE-02, DELEGATE-03, DELEGATE-04, TRACE-01, TRACE-02, TRACE-03, TRACE-04
- Phase 2 (4): BUDGET-01, BUDGET-02, BUDGET-03, BUDGET-04
- Phase 3 (5): PROVIDER-01, PROVIDER-02, PROVIDER-03, CONCURRENCY-01, CONCURRENCY-02
- Phase 4 (6): STREAM-01, STREAM-02, STREAM-03, ERROR-01, ERROR-02, ERROR-03
- Phase 5 (4): DOCS-01, DOCS-02, DOCS-03, DOCS-04

---

*Created 2026-04-30. Phase numbering starts at 1 (project pre-dates GSD phase tracking).*
