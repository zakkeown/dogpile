---
gsd_state_version: 1.0
milestone: v0.4.0
milestone_name: milestone
status: Phase 5 complete; v0.4.0 shipped to npm on 2026-05-01
last_updated: "2026-05-01T16:30:00Z"
last_activity: 2026-05-01 -- Phase 05 complete; @dogpile/sdk@0.4.0 published
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 22
  completed_plans: 22
  percent: 100
---

# State

## Project Reference

**Core value:** Coordinated, observable, replayable multi-agent runs with a strict boundary — Dogpile owns the coordination loop; the application owns credentials, pricing, storage, queues, UI, and tool side effects.

**Current focus:** v0.4.0 Recursive Coordination — agent-driven nesting via a `delegate` decision on the `coordinator` protocol, with embedded child traces, propagated budgets/cancel/cost, bounded concurrency with locality clamp, child event bubbling, and child error escalation.

## Current Position

Phase: complete
Plan: complete
Status: v0.4.0 Recursive Coordination shipped to npm
Last activity: 2026-05-01 -- Phase 05 complete; @dogpile/sdk@0.4.0 published

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases complete | 5 / 5 |
| Requirements complete | 27 / 27 |
| Plans complete | 22 / 22 |

## Accumulated Context

### Decisions

- **Phase numbering starts at 1.** Project pre-dates GSD phase tracking; no prior `.planning/phases/` directory exists.
- **5 phases, dependency-ordered.** DELEGATE+TRACE grouped (same surface), then BUDGET, then PROVIDER+CONCURRENCY (locality is prerequisite for clamp), then STREAM+ERROR, then DOCS last.
- **Public-surface invariants must move together.** Every event/result/exports change updates `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, `src/tests/package-exports.test.ts`, `package.json` `exports`/`files`, and `CHANGELOG.md`.
- **Phase 1 — AgentDecision is a discriminated union.** `ParticipateAgentDecision | DelegateAgentDecision`, discriminated on `type`. Consumers must narrow on `decision.type === "participate"` before reading paper-style fields.
- **Phase 1 — Sub-run events.** `RunEvent` union extended with `sub-run-started`, `sub-run-completed`, `sub-run-failed`. `sub-run-completed.subResult` carries the child `RunResult` inline. `recursive: true` flag on `sub-run-started` when both parent and child protocol are `coordinator` (D-16).
- **Phase 1 — maxDepth dual gate.** Default 4; per-run can only LOWER the engine value (`effectiveMaxDepth = min(engine ?? 4, run ?? Infinity)`). Overflow throws `DogpileError({ code: "invalid-configuration", detail: { kind: "delegate-validation", reason: "depth-overflow" } })` at BOTH parse time AND dispatch time.
- **Phase 1 — Replay walks trace verbatim.** `recomputeAccountingFromTrace` recurses into `sub-run-completed.subResult`; mismatch throws with `reason: "trace-accounting-mismatch"`. No child-event bubbling in Phase 1 (deferred to Phase 4 per D-09).
- **Phase 1 — Provider inheritance.** Child sub-runs inherit the parent provider object verbatim (D-11); cost-cap not propagated; child timeoutMs default = `parent.deadline - now` (or undefined if parent uncapped, per planner-resolved Q3).
- **Phase 3 Plan 03-01 — Provider locality metadata.** `ConfiguredModelProvider.metadata?.locality` is the public provider hint; OpenAI-compatible providers auto-detect local hosts through `classifyHostLocality`; invalid locality is rejected at construct time and engine run start.
- **Phase 3 Plan 03-01 — Local spoofing guard.** `locality: "remote"` on a detected-local OpenAI-compatible `baseURL` throws `invalid-configuration` with `detail.reason: "remote-override-on-local-host"`.
- **Phase 3 Plan 03-02 — Bounded fan-out dispatch.** Coordinator delegate arrays now execute through a per-turn semaphore with default `maxConcurrentChildren=4`, per-run/decision lowering, `sub-run-queued` pressure events, completion-order result prompts, and synthetic `sibling-failed` failures for queued children abandoned after a sibling failure.
- **Phase 3 Plan 03-02 — Additive fan-out identity.** `parentDecisionId` format remains unchanged; `parentDecisionArrayIndex` disambiguates delegates from the same plan turn on queued/started/completed/failed sub-run events.
- **Phase 3 Plan 03-03 — Local-provider clamp.** Coordinator fan-out now walks the active provider tree at each dispatch; any `metadata.locality === "local"` provider clamps effective child concurrency to 1 and emits exactly one `sub-run-concurrency-clamped` event per run with `reason: "local-provider-detected"`.
- **Phase 3 Plan 03-03 — Public-surface wrap-up.** The v0.4.0 CHANGELOG now includes the Phase 1-3 recursive coordination public-surface inventory, including `metadata.locality`, `maxConcurrentChildren`, `sub-run-queued`, `parentDecisionArrayIndex`, `sub-run-concurrency-clamped`, and replay decision literals.
- **Phase 4 Plan 04-01 — Stream ancestry chain.** `parentRunIds?: readonly string[]` is the canonical stream ancestry shape on `StreamLifecycleEvent | StreamOutputEvent`; no flat `parentRunId?:` was added.
- **Phase 4 Plan 04-01 — Live-only child bubbling.** Child events are wrapped with root-first ancestry only for live streams; parent `RunResult.events` and embedded child `subResult.trace.events` remain chain-free.
- **Phase 4 Plan 04-01 — Replay stream mirror.** `replayStream()` expands embedded `subResult.trace` events and reconstructs `parentRunIds` at replay emit time.
- **Phase 4 Plan 04-02 — Stream cancel drain.** `StreamHandle.cancel()` now drains active coordinator `DispatchedChild` records before terminal error: started children get synthetic `sub-run-failed` with `detail.reason: "parent-aborted"`, queued children keep `sibling-failed`, and closed children suppress late live forwarding.
- **Phase 4 Plan 04-02 — Aborted lifecycle event.** `AbortedEvent` joins `StreamLifecycleEvent` with `reason: "parent-aborted" | "timeout"` and is emitted before terminal stream `error` events on abort paths.
- **Phase 4 Plan 04-03 — Coordinator failure context.** Real child failures now reach the next coordinator plan turn as enriched tagged text plus a structured JSON roster under `## Sub-run failures since last decision`; synthetic `sibling-failed` and `parent-aborted` failures are excluded.
- **Phase 4 Plan 04-03 — onChildFailure config.** `onChildFailure?: "continue" | "abort"` is public on engine, high-level, and per-run surfaces; it resolves per-run > engine > default `continue`, and abort mode stores `triggeringFailureForAbortMode`.
- **Phase 4 Plan 04-04 — Terminal child failure throws.** Budget terminal paths re-throw the last real child failure instance from `failureInstancesByChildRunId`; replay reconstructs a fresh `DogpileError` from serialized `sub-run-failed.error`; cancel and depth-overflow errors remain verbatim.
- **Phase 4 Plan 04-04 — Timeout source discrimination.** `provider-timeout` errors now support optional `detail.source: "provider" | "engine"`; absence remains provider-compatible, and parent-budget propagation remains `aborted` with `detail.reason: "timeout"`.
- **Phase 5 — v0.4.0 release shipped.** Recursive coordination docs, exhaustive reference, runnable example, README/examples index, developer/reference docs, changelog migration notes, release identity, tag `v0.4.0`, GitHub Release, and npm publication all landed; `@dogpile/sdk@0.4.0` is `latest`.

### Todos

(none)

### Blockers

(none)

## Session Continuity

**Next action:** v0.4.0 shipped. Define the next milestone or pick follow-ups from Future Requirements: caller-defined trees, cross-protocol shared transcript, per-child retry policy, or OTEL/tracing bridge.

---

*Last updated: 2026-05-01 — Phase 5 complete; 27/27 requirements shipped; @dogpile/sdk@0.4.0 published.*
