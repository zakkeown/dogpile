---
gsd_state_version: 1.0
milestone: v0.4.0
milestone_name: milestone
status: Phase 4 in progress; Plan 04-01 stream wrapping complete
last_updated: "2026-05-01T13:57:51Z"
last_activity: 2026-05-01
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 16
  completed_plans: 13
  percent: 81
---

# State

## Project Reference

**Core value:** Coordinated, observable, replayable multi-agent runs with a strict boundary — Dogpile owns the coordination loop; the application owns credentials, pricing, storage, queues, UI, and tool side effects.

**Current focus:** v0.4.0 Recursive Coordination — agent-driven nesting via a `delegate` decision on the `coordinator` protocol, with embedded child traces, propagated budgets/cancel/cost, bounded concurrency with locality clamp, child event bubbling, and child error escalation.

## Current Position

Phase: 04
Plan: 02
Status: Plan 04-01 complete; ready for cancel propagation
Last activity: 2026-05-01

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases complete | 3 / 5 |
| Requirements complete | 15 / 27 |
| Plans complete | 13 / 16 |

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

### Todos

- Execute Phase 4 Plan 04-02: cancel propagation.

### Blockers

(none)

## Session Continuity

**Next action:** Execute 04-02 cancel propagation.

---

*Last updated: 2026-05-01 — Phase 4 Plan 04-01 complete; 15/27 requirements shipped; verify green.*
