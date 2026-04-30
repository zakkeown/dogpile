---
phase: 01-delegate-decision-sub-run-traces
plan: 03
subsystem: runtime/coordinator, runtime/engine, types/replay
tags: [coordinator, dispatch, sub-run, recursion, replay-trace, public-api]
requires:
  - "AgentDecision discriminated union from Plan 01-01"
  - "sub-run-* RunEvent variants from Plan 01-02"
  - "RunResult / Trace / BudgetCaps in src/types.ts"
provides:
  - "Coordinator delegate dispatch loop on the plan turn"
  - "currentDepth / effectiveMaxDepth params on runProtocol and runCoordinator (Plan 04 wires enforcement)"
  - "RunProtocolFn callback that engine.ts injects to avoid circular imports"
  - "renderSubRunResult helper (D-17 prompt-injection format)"
  - "buildPartialTrace helper (sub-run-failed partialTrace from buffered tee)"
  - "Three new ReplayTraceProtocolDecisionType literals: start-sub-run / complete-sub-run / fail-sub-run"
  - "Worker / final-synthesis delegate rejection guards"
  - "Hard-coded MAX_DISPATCH_PER_TURN = 8 loop guard"
affects:
  - "src/runtime/defaults.ts createReplayTraceProtocolDecision/defaultProtocolDecision (replaces Plan 02 throw-markers)"
  - "src/runtime/engine.ts runProtocol switch (passes currentDepth + runProtocol callback into runCoordinator)"
tech-stack:
  added: []
  patterns:
    - "Inject runProtocol via options to avoid the engine ↔ coordinator circular import"
    - "Buffered tee'd emit captures child events into a local array; partialTrace built locally so runProtocol's error contract is unchanged"
    - "Plan-turn dispatch loop returns parsed decision from runCoordinatorTurn so the outer loop can branch on decision.type"
key-files:
  created: []
  modified:
    - "src/runtime/coordinator.ts"
    - "src/runtime/engine.ts"
    - "src/runtime/defaults.ts"
    - "src/types/replay.ts"
    - "src/runtime/coordinator.test.ts"
decisions:
  - "RunProtocolFn is injected by engine.ts into runCoordinator via the options object — coordinator never imports engine.ts directly. Plan 04 inherits the same callback shape."
  - "ReplayTraceProtocolDecisionType extended with start-sub-run / complete-sub-run / fail-sub-run rather than reusing existing kinds. The existing result-contract.test.ts expectedDecisions table only iterates basic protocols (no sub-run path), so widening the union does not require table updates."
  - "parentDecisionId is rendered as String(events.length - 1) (the index of the parent's plan agent-turn event) — matches the Plan 02 lock-test fixture, which uses an arbitrary index-shaped string."
  - "Final-synthesis turn rejects delegate decisions with the same Phase 1 worker-restriction message family. Plan 03 plan only locks worker rejection; final-synthesis is the natural symmetric guard and was added per Rule 2."
  - "Loop-guard counter increments BEFORE dispatch — 8 successful sub-run-started/completed pairs precede the 9th attempt's throw. The throw fires before sub-run-started for attempt #9 is emitted, matching the plan's test 7."
  - "buildPartialTrace fills required Trace fields with natural zero/empty defaults: empty protocolDecisions/providerCalls/transcript, zero-cost finalOutput, current-time completedAt. Child run's internal runId stays in the partialTrace.events (each event carries its own runId)."
metrics:
  duration: "~35 min"
  completed: "2026-04-30"
---

# Phase 01 Plan 03: Coordinator Delegate Dispatch Loop Summary

Builds the largest Phase 1 control-flow change: when the coordinator's plan turn returns a `delegate` decision, the runtime now recursively invokes `runProtocol` for the child, captures the result (or partial-trace failure), and re-issues the coordinator plan turn with D-17 tagged text and a D-18 synthetic transcript entry until the coordinator participates or the loop guard trips.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Thread currentDepth through runProtocol; add delegate dispatch loop in coordinator plan turn; replace Plan 02 throw-markers with real ReplayTraceProtocolDecisionType cases | `cae17ec` | `src/runtime/coordinator.ts`, `src/runtime/engine.ts`, `src/runtime/defaults.ts`, `src/types/replay.ts` |
| 2 | Coordinator delegate scenarios: happy-path, sub-run-failed (×2), recursive, provider inheritance, model-id mismatch, worker rejection, loop guard | `cc335ce` | `src/runtime/coordinator.test.ts` |

## Dispatch-Loop Structure

In `src/runtime/coordinator.ts`, the plan-turn block (formerly L127-148) now runs inside a `while (true)` that:

1. Calls `runCoordinatorTurn(...)` — which now returns `{ totalCost, decision }` (was `CostSummary`).
2. Breaks the loop when `decision?.type !== "delegate"` (participate or undefined).
3. Increments and checks `MAX_DISPATCH_PER_TURN = 8` (hard-coded constant, throws `invalid-configuration` with `detail.reason: "loop-guard-exceeded"`).
4. Calls `dispatchDelegate(...)` for the delegate decision; uses the returned `nextInput` as the prompt for the next iteration.

`dispatchDelegate` itself:

1. Mints `childRunId` via `createRunId()`.
2. Computes `recursive = decision.protocol === "coordinator"`.
3. Resolves child timeout per D-12: parent budget timeoutMs becomes the cap; per-decision timeout overrides only if ≤ remaining (else throws `decision.budget.timeoutMs`).
4. Allocates `childEvents: RunEvent[]` and a tee'd `emit` callback that pushes into the buffer **and** propagates to the caller's emit.
5. Emits `sub-run-started` and records the protocol decision.
6. Awaits `options.runProtocol(...)` with `model: options.model` (D-11), `signal: options.signal` (RESEARCH §6 — same reference, no new AbortController), `currentDepth: parentDepth + 1`, and the tee'd emit.
7. **Success path:** emits `sub-run-completed`, pushes the D-18 synthetic transcript entry (`agentId: "sub-run:<id>"`, `role: "delegate-result"`), and returns `nextInput` containing `buildCoordinatorPlanInput(...)` + the D-17 tagged block + a "decide the next step" suffix.
8. **Failure path:** builds `partialTrace` from the buffered `childEvents` array via `buildPartialTrace`, emits `sub-run-failed` with `error.detail.failedDecision`, then re-throws (`DogpileError` if the original was one, else wraps as `invalid-configuration`).

## runProtocol Signature Change

Two new optional fields were added to `RunProtocolOptions` in `src/runtime/engine.ts`:

```ts
interface RunProtocolOptions {
  // …existing…
  readonly currentDepth?: number;     // default 0; coordinator dispatch increments
  readonly effectiveMaxDepth?: number; // default Infinity; Plan 04 enforces
}
```

`runProtocol` only forwards them to `runCoordinator` (the only protocol that branches on decision.type today). The other three protocols are unchanged. Plan 04 will:

- Add the `effectiveMaxDepth` check at the top of `dispatchDelegate` before `sub-run-started` is emitted (parse-time check stays in `decisions.ts`).
- Compute `effectiveMaxDepth` from engine + per-run options at the engine entry points (`createEngine().run` / `createEngine().stream`) and forward it through `runProtocol` like `currentDepth`.

The two engine-level `runProtocol` invocations (`engine.ts:166` streaming and `engine.ts:535` non-streaming) currently leave both options at their defaults (0 / Infinity) — the call sites do not need to pass them explicitly.

## RunProtocolFn Callback (circular-import escape)

`engine.ts` imports `runCoordinator` from `coordinator.ts`. To let coordinator call back into `runProtocol`, engine.ts wraps the switch into a closure and passes it as `options.runProtocol` when invoking `runCoordinator`:

```ts
case "coordinator":
  return runCoordinator({
    // …
    runProtocol: (childInput) =>
      runProtocol({ ...childInput, protocol: normalizeProtocol(childInput.protocol) })
  });
```

`RunProtocolFn` is exported from `coordinator.ts` so Plan 04 / Plan 05 can reuse the type. `dispatchDelegate` accepts the parent's protocol-name (string) for the child and the wrapper normalizes it to a `ProtocolConfig` before re-entering `runProtocol`.

## D-17 Prompt-Injection Helper Location

`renderSubRunResult(childRunId, subResult)` in `src/runtime/coordinator.ts` (bottom of file) is the canonical D-17 formatter. It returns:

```
[sub-run <childRunId>]: <subResult.output>
[sub-run <childRunId> stats]: turns=<N> costUsd=<X> durationMs=<Y>
```

Plan 04 / Plan 05 should reuse this helper if they need to render sub-run results — duration is computed from the child's first/last event timestamps.

## buildPartialTrace Helper

`buildPartialTrace(...)` in `src/runtime/coordinator.ts` constructs a JSON-serializable `Trace` for `sub-run-failed.partialTrace` from the buffered `childEvents` array. All required `Trace` fields are filled with natural zero/empty defaults (no `protocolDecisions`, no `providerCalls`, empty transcript, zero-cost final output). The child run's actual internal `runId` is preserved on each event in the buffer; only the top-level `partialTrace.runId` is the synthetic `childRunId`.

## ReplayTraceProtocolDecisionType Extension

Plan 02 left `defaults.ts:414-420` and `:446-452` as throw-markers for the three sub-run event types, deferring the public-union extension to Plan 03. This plan added:

```ts
export type ReplayTraceProtocolDecisionType =
  | …
  | "start-sub-run"
  | "complete-sub-run"
  | "fail-sub-run";
```

Both throw-markers in `defaults.ts` are replaced with real recordings: `sub-run-started` records `input: event.intent`; `sub-run-completed` records `output: event.subResult.output, cost: event.subResult.cost`; `sub-run-failed` records the base shape only.

The `expectedDecisions` table in `src/tests/result-contract.test.ts` (L692-728) only iterates over basic protocols (sequential / coordinator / broadcast / shared) without delegate paths, so the union-widening passed regression with no edits to that test.

## Verification

- `pnpm run typecheck` — clean.
- `pnpm vitest run src/runtime/coordinator.test.ts` — 14/14 passed (6 pre-existing + 8 new delegate scenarios).
- `pnpm vitest run` (full suite) — 463 passed, 1 skipped, 1 failure (pre-existing `src/tests/consumer-type-resolution-smoke.test.ts` infra issue, documented in Plans 01-01 / 01-02 SUMMARY; unchanged by this plan).

## Deviations from Plan

### Rule 2 — Missing critical functionality (auto-applied)

**1. Final-synthesis turn delegate rejection**

- **Found during:** Task 1 implementation, while wiring the worker rejection guard.
- **Issue:** The plan locks worker turns from emitting delegate decisions in Phase 1, but the coordinator agent also runs a final-synthesis turn (`coordinator.ts` ~L211 / now ~L249). Without a symmetric guard, an agent emitting a delegate at synthesis time would be silently ignored — the loop already broke out of the dispatch path — but the parsed decision lingered on the transcript entry and would surface as a delegate in the trace without being acted on. That is a quiet correctness gap (Phase 1 spec is "delegate happens only on the plan turn").
- **Fix:** Added an explicit `synthesisOutcome.decision?.type === "delegate"` check that throws `invalid-configuration` with `detail.kind: "delegate-validation"`, `path: "decision"`, `phase: "final-synthesis"`.
- **Files modified:** `src/runtime/coordinator.ts`.
- **Commit:** `cae17ec` (rolled into Task 1).

**2. Loop-guard `detail.reason` field**

- **Found during:** Test 7 authoring.
- **Issue:** The plan spec says the guard throws `invalid-configuration` with a documented message but does not specify the `detail` shape. Test 7 needs a stable assertion target.
- **Fix:** Added `detail.reason: "loop-guard-exceeded"` and `detail.maxDispatchPerTurn: 8` so the test can pin the failure mode without parsing free-text messages. Matches the existing convention used by Plan 01's `delegate-validation` payloads.
- **Files modified:** `src/runtime/coordinator.ts`.
- **Commit:** `cae17ec` (rolled into Task 1).

### Rule 3 — Blocking issue (auto-applied)

**3. ReplayTraceProtocolDecisionType union extension**

- **Found during:** First test run after wiring `recordProtocolDecision` for sub-run events.
- **Issue:** Plan 02 deferred the public-type extension; the throw-markers in `defaults.ts` would trip on the very first `sub-run-started` emit. Without the extension, the dispatch loop is unrunnable.
- **Fix:** Added `start-sub-run` / `complete-sub-run` / `fail-sub-run` to `ReplayTraceProtocolDecisionType` in `src/types/replay.ts` and replaced both throw-markers in `defaults.ts` with concrete cases.
- **Files modified:** `src/types/replay.ts`, `src/runtime/defaults.ts`.
- **Commit:** `cae17ec` (rolled into Task 1).

### TDD framing note

The plan marks Task 1 `tdd="true"`, but the natural RED gate for this scope is the integration test scenarios in Task 2. Task 1 was executed against a typecheck-driven failure mode (the throw-markers in `defaults.ts`, plus the typecheck errors on `runCoordinator` options) and the existing six coordinator regression tests stayed green throughout. Task 2 is the behavioral lock for the new dispatch loop. The `feat:` (Task 1) + `test:` (Task 2) commit pattern matches Plan 01-02's TDD-compliance note.

### Out-of-scope (deferred)

- `effectiveMaxDepth` enforcement at dispatch time — Plan 04.
- `EngineOptions.maxDepth` / `DogpileOptions.maxDepth` plumbing — Plan 04.
- Replay-side recursive accounting recompute — Plan 05.
- `consumer-type-resolution-smoke.test.ts` is the pre-existing infra failure documented in Plans 01-01 / 01-02 SUMMARY. Out of scope.

## Authentication Gates

None.

## Public Surface Touched

| File | Status | Change |
|------|--------|--------|
| `src/runtime/coordinator.ts` | modified | Delegate dispatch loop, `RunProtocolFn` export, `renderSubRunResult` / `buildPartialTrace` helpers, worker / final-synthesis rejection guards |
| `src/runtime/engine.ts` | modified | `runProtocol` accepts `currentDepth` / `effectiveMaxDepth`; passes a `runProtocol` callback into `runCoordinator` |
| `src/runtime/defaults.ts` | modified | Real cases for sub-run events in `createReplayTraceProtocolDecision` and `defaultProtocolDecision` (replaces Plan 02 throw-markers) |
| `src/types/replay.ts` | modified | `ReplayTraceProtocolDecisionType` gains `start-sub-run` / `complete-sub-run` / `fail-sub-run` |
| `src/runtime/coordinator.test.ts` | modified | Eight new delegate-scenario tests |

`CHANGELOG.md` is intentionally untouched per the plan; Plan 05 owns the v0.4.0 entry. No `package.json` `exports`/`files` change.

## Deferred Issues

- **`src/tests/consumer-type-resolution-smoke.test.ts`** (pre-existing): see Plans 01-01 / 01-02 SUMMARY. The fixture itself typechecks cleanly via the workspace tsconfig.

## Threat Flags

None — this plan stays within the trust boundaries documented in the plan's STRIDE register (T-03-01..05). All five mitigations are in place:

- T-03-01 (infinite delegate loop) → `MAX_DISPATCH_PER_TURN = 8` guard with stable `detail.reason`.
- T-03-02 (provider swap via `decision.model`) → parse-time check in Plan 01-01 (`parentProviderId` context); dispatch-time check fires before `sub-run-started` is emitted (verified by the model-mismatch test).
- T-03-03 (failed-decision echo) → accepted; `error.detail.failedDecision` is intentional provenance.
- T-03-04 (worker delegate exhaustion) → worker-turn rejection throws.
- T-03-05 (mutating shared provider) → accepted per D-11; no defensive copy.

## TDD Gate Compliance

Task 1 is the implementation; Task 2 is the lock test. Git log shows `feat:` (Task 1, `cae17ec`) followed by `test:` (Task 2, `cc335ce`). Behavioral coverage of the dispatch loop lives in Task 2; Task 1 was gated by the typecheck failures on `RunProtocolOptions`/`runCoordinator` and the throw-markers in `defaults.ts` that flipped to concrete cases. Same convention as Plan 01-02.

## Self-Check: PASSED

- `src/runtime/coordinator.ts` (dispatch loop + helpers) — FOUND
- `src/runtime/engine.ts` (currentDepth + runProtocol callback) — FOUND
- `src/runtime/defaults.ts` (real sub-run replay cases) — FOUND
- `src/types/replay.ts` (extended ReplayTraceProtocolDecisionType) — FOUND
- `src/runtime/coordinator.test.ts` (8 new tests) — FOUND
- Commit `cae17ec` — FOUND
- Commit `cc335ce` — FOUND
- `pnpm run typecheck` — clean
- `pnpm vitest run src/runtime/coordinator.test.ts` — 14/14 pass
- `pnpm vitest run` (full suite) — 463 passed, only the pre-existing `consumer-type-resolution-smoke.test.ts` failure remains
