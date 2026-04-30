---
phase: 02-budget-cancellation-cost-rollup
generated: 2026-04-30
mode: power
answered: 20/20
---

# Phase 2 Context — Budget, Cancellation, Cost Roll-Up

Decisions captured from the power-mode questionnaire (`02-QUESTIONS.json`). These lock the gray areas before research/planning.

## Canonical refs

- `.planning/ROADMAP.md` — Phase 2 success criteria, requirements BUDGET-01..04
- `.planning/REQUIREMENTS.md` lines 35–44 — full requirement text
- `.planning/STATE.md` — Phase 1 decisions (D-01..D-18) the parent surface relies on
- `.planning/phases/01-delegate-decision-sub-run-traces/01-CONTEXT.md` — Phase 1 decision history
- `CLAUDE.md` — public-surface invariants (event-shape changes propagate to event-schema.test.ts, result-contract.test.ts, package-exports.test.ts, package.json, CHANGELOG.md)
- `src/runtime/coordinator.ts:787` — `dispatchDelegate` (cost roll-up + abort + timeout dispatch land here)
- `src/runtime/coordinator.ts:800` — current static `parentTimeoutMs` math (Q-11 changes this to deadline-now)
- `src/runtime/coordinator.ts:846` — `teedEmit` / partial-trace buffer (Q-15 invariant lives here)
- `src/runtime/cancellation.ts` — `createAbortError`, `createAbortErrorFromSignal`, `createTimeoutError` (Q-08/Q-13 enrich `detail.reason`)
- `src/runtime/engine.ts:341` — non-streaming `wireCallerAbortSignal` (child controller derivation Q-07 grafts onto this)
- `src/runtime/engine.ts:383` — timeout `setTimeout` → `abortController.abort(timeoutError)` (the path that produces Q-13's `detail.reason: "timeout"`)
- `src/runtime/defaults.ts:122` — `emptyCost` / `addCost` (token + USD parallel via Q-05)
- `src/runtime/defaults.ts:553` — `RECOMPUTE_FIELD_ORDER` (eight numeric fields the recompute checks; tokens roll up alongside USD per Q-05)
- `src/runtime/defaults.ts:662` — `recomputeAccountingFromTrace` (Q-04 adds the parent-rollup parity check)
- `src/runtime/termination.ts:445` — `protocolMinTurns` (per-instance floors per Q-16)
- `src/tests/cancellation-contract.test.ts` — recursive-tree abort cases (Q-18 hybrid)
- `src/tests/budget-first-stop.test.ts` — termination floor tests (Q-15/16/17 lock here)
- `src/runtime/coordinator.test.ts` — deep nesting and rollup scenarios (Q-18 hybrid)
- `src/tests/event-schema.test.ts` + `src/tests/result-contract.test.ts` — public-surface locks for Q-19's two new shapes

## Decisions

### Cost & Token Roll-Up (BUDGET-03)

**D-01: Roll up at `sub-run-completed` emit time.** (Q-01)
- Inside `dispatchDelegate` (coordinator.ts:787), immediately after `subResult` returns and before the `sub-run-completed` event is pushed, do `totalCost = addCost(totalCost, subResult.cost)`.
- Parent's `totalCost` is always current; the rolled-up number lands in the next `agent-turn`/`final` event automatically.
- Affects ordering: roll-up MUST happen before the `sub-run-completed` event is emitted with the parent's now-current cost OR the existing invariant "last cost-bearing event === final.cost" needs an exception. Planner: prefer "roll-up before emit so the existing invariant holds unchanged."
- Touches `dispatchDelegate` only; does NOT need to land in worker turns or shared/sequential/broadcast (they don't delegate).

**D-02: Failed sub-runs contribute their partial cost.** (Q-02 → reconciles with Q-19)
- Real provider calls before the throw are real wallet spend; parent must reflect them.
- Implementation route (combined with Q-19=d): lock `sub-run-failed.partialCost: CostSummary` as a new public field on the failed event. `dispatchDelegate`'s catch block computes the partial cost from the local `childEvents` buffer (the same buffer that already feeds `partialTrace`) using `lastCostBearingEventCost`-style logic and writes it onto the event before emit.
- Roll-up reads `event.partialCost` (single source of truth — no walking partialTrace twice at runtime AND replay).
- Keeps the failed-event payload internally consistent: `{ error, partialTrace, partialCost }`.

**D-03: `final.cost` is the rolled-up total.** (Q-03)
- Keeps the existing replay invariant in `lastCostBearingEventCost` intact: parent's final event === parent's recorded `accounting.cost` === local + sum(children).
- No splitting of "wallet" vs "provider-only" semantics on the live trace.

**D-04: Replay enforces parent = local + sum(children).** (Q-04)
- `recomputeAccountingFromTrace` (defaults.ts:662) gains a third comparison: rebuild `local` from parent events MINUS sub-run cost (i.e., `final.cost − sum(subResult.cost) − sum(failed.partialCost)`), then ensure that the parent's `accounting.cost` minus that local matches the recursive sum.
- Cleaner phrasing: at the parent level, the existing reconstructed-from-events accounting MUST equal `localOnly + sum(children completed) + sum(children failed partialCost)`. Drift throws `DogpileError({ code: "invalid-configuration", detail: { kind: "trace-validation", reason: "trace-accounting-mismatch", subReason: "parent-rollup-drift", field, recorded, recomputed, eventIndex } })`.
- Strongest tamper detection; matches Phase 1 D-10's posture.

**D-05: Tokens roll up in parallel with USD.** (Q-05)
- `addCost` already sums all eight numeric fields (`cost.usd`, `cost.inputTokens`, `cost.outputTokens`, `cost.totalTokens`, `usage.usd`, `usage.inputTokens`, `usage.outputTokens`, `usage.totalTokens`).
- Test: parameterize one rollup test over `RECOMPUTE_FIELD_ORDER` so each field has a non-zero contribution at depth ≥ 2.

**D-06: Roll-up helper lives in `defaults.ts` (engine-level).** (Q-06)
- Add `accumulateSubRunCost(events: readonly RunEvent[]): CostSummary` (or similar) in `defaults.ts` next to `addCost`. Coordinator imports it.
- Mirrors `recomputeAccountingFromTrace`'s engine-level location.
- If a future protocol gains delegate, the helper is reusable. Trivial extra abstraction; small surface, no public export needed (internal helper).

### Cancellation Propagation (BUDGET-01)

**D-07: Each sub-run gets a derived child `AbortController`.** (Q-07)
- In `dispatchDelegate`, before invoking `runProtocol`:
  ```ts
  const childController = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) childController.abort(options.signal.reason);
    else options.signal.addEventListener("abort", () => childController.abort(options.signal!.reason), { once: true });
  }
  ```
- `childOptions.signal = childController.signal` — child engine sees its own signal; parent abort still cascades because the listener forwards the reason.
- Cleaner ownership: the child's controller is the boundary. Lays groundwork for Phase 4 streaming (per-child handle is already there). Slight allocation overhead per child — acceptable.
- Replaces the current `signal: options.signal` direct passthrough at coordinator.ts:878.

**D-08: Aborted child error code is `"aborted"` + `detail.reason`.** (Q-08, Q-13)
- BUDGET-01 keeps `code: "aborted"` (verbatim spec wording).
- Lock `detail.reason` discriminator NOW in Phase 2 (rather than deferring to Phase 4): `"parent-aborted"` (parent signal explicitly aborted) vs `"timeout"` (parent deadline fired and triggered the abort).
- Source of truth: `cancellation.ts` gains a small helper that takes the parent abort reason and produces the right `detail.reason`. The parent's `setTimeout` path in `engine.ts:383` already aborts with a `timeoutError` — when that reason flows through `createAbortErrorFromSignal`, it's recognizable as the timeout case.
- ERROR-03 (Phase 4 scope) is partially front-loaded: Phase 2 ships the `detail.reason` plumbing; Phase 4 adds the contract-level test enforcing the public surface.

**D-09: `sub-run-failed` always emits, partialTrace included.** (Q-09)
- Aborted children → `sub-run-failed` event with whatever `childEvents` buffer accumulated, regardless of how small.
- No special-case suppression. Replay must be able to see "we tried, child was torn down" provenance.
- Combined with D-02, the failed event also carries `partialCost` extracted from the same buffer.

**D-10: Parent abort post-completion emits a `parent-aborted` marker event.** (Q-10)
- Race: child returns successfully, `sub-run-completed` lands, then parent.signal aborts before the next plan turn.
- Emit a parent-level event (NOT a `sub-run-*` variant) capturing the abort with whatever cause/reason is present. Concrete shape TBD by planner; suggested: extend the existing `final` / coordinator final-stop with an `abortedAfterSubRun: true` flag, OR add a new `aborted` event variant.
- Public-surface addition; planner picks the minimal-impact shape. The point is observability — a replay should be able to tell "parent gave up" from "parent terminated normally with sub-runs in flight."
- This is the only Q-19=d-driven addition that's NOT a sub-run event; planner: confirm whether to package it as `aborted` event variant or as a flag on existing `final`/abort surfaces.

### Timeout & Deadline Propagation (BUDGET-02)

**D-11: Child remaining = `deadline − now`, not static cap.** (Q-11)
- Plumb the parent's deadline into `dispatchDelegate`. Source: snapshot `parentDeadlineMs = startedAtMs + budget.timeoutMs` at parent run start; pass through `options` into the dispatcher.
- In `dispatchDelegate`, compute `remainingMs = Math.max(0, parentDeadlineMs − Date.now())`; replace the current `parentTimeoutMs = options.budget?.timeoutMs` line.
- If `remainingMs === 0`, throw `DogpileError({ code: "aborted", detail.reason: "timeout" })` BEFORE emitting `sub-run-started` (parallel with the depth-overflow gate at coordinator.ts:794).
- Fixes the existing race where a child dispatched 8s into a 10s parent budget gets a fresh 10s window.

**D-12: Decision overrides clamp + emit `subRun.budgetClamped`.** (Q-12, Q-19)
- Replace the current `decisionTimeoutMs > remainingMs` THROW (coordinator.ts:810) with: clamp to `remainingMs`, emit a new public event variant `subRun.budgetClamped` with `{ childRunId, requestedTimeoutMs, clampedTimeoutMs, reason: "exceeded-parent-remaining" }`.
- Shape parallels Phase 3's `subRun.concurrencyClamped` (CONCURRENCY-02).
- Public-surface delta: new event variant; updates `event-schema.test.ts`, `result-contract.test.ts`, `package-exports.test.ts` (if exported), `CHANGELOG.md`.

**D-13: Phase-4 ERROR-03 surfacing locked in Phase 2.** (Q-13)
- See D-08; `detail.reason: "timeout"` lands now on the parent-timeout abort path.
- Contract test in `src/tests/cancellation-contract.test.ts` asserts: parent budget timeout fires → child throws `code: "aborted"` with `detail.reason: "timeout"`; parent.signal.abort() → child throws `code: "aborted"` with `detail.reason: "parent-aborted"`.

**D-14: Engine-level default sub-run timeout ceiling.** (Q-14)
- Add `defaultSubRunTimeoutMs?: number` option on `createEngine` (and threaded through `Dogpile.pile` / `run` / `stream`).
- When parent has no `budget.timeoutMs` AND decision has no `budget.timeoutMs` AND engine default is set, child gets the engine default.
- Default value for the option itself: `undefined` (preserves current "no timeout" posture for callers who don't opt in).
- Public-surface addition; updates engine config types, validation, and the option-list in CHANGELOG.

### Termination Floors & Composition (BUDGET-04)

**D-15: Parent-events isolation locked with a contract test in `budget-first-stop.test.ts`.** (Q-15)
- Build a recursive scenario: child emits N=50 `agent-turn` events; parent has `terminate.budget.maxIterations = 5`. Assert parent terminates at 5 *parent* iterations, not affected by child counts.
- Catches any future regression where someone refactors `teedEmit` and accidentally pushes child events into the parent's `events` array.
- Doubles as the BUDGET-04 enforcement test.

**D-16: `minTurns` / `minRounds` independence test.** (Q-16)
- Coordinator parent (`minTurns: 3`) delegates to a sequential child (`minTurns: 5`). Assert child runs ≥5 turns; parent's own turns count independently and parent stops at 3 once child returns.
- Lives in `budget-first-stop.test.ts` or `coordinator.test.ts` — planner picks (Q-18=hybrid).

**D-17: `sub-run-completed` counts as 1 parent iteration.** (Q-17)
- Phase 1 D-18 already added a synthetic `transcript` entry per completed sub-run with `agentId: "sub-run:<id>"` and `role: "delegate-result"`.
- Lock current behavior: `transcript.length`-based iteration math counts that entry as one iteration. Document with a contract test.
- This is the path of least resistance and matches Phase 1's design intent.

### Tests & Public Surface

**D-18: Hybrid test organization.** (Q-18)
- Contract guarantees → existing files (`cancellation-contract.test.ts`, `budget-first-stop.test.ts`).
- Deep scenario tests (4-level nesting cost roll-up, deadline math edge cases) → `coordinator.test.ts`.
- New file *only* if a single concern grows beyond ~150 lines; planner judgment.

**D-19: Full public-surface observability — Q-19=d.** (Q-19, with D-02/D-12/D-10)
- Three additions to lock together with `event-schema.test.ts`, `result-contract.test.ts`, `package-exports.test.ts`, `package.json`, `CHANGELOG.md`:
  1. `sub-run-failed.partialCost: CostSummary` (D-02).
  2. `subRun.budgetClamped` event variant `{ childRunId, requestedTimeoutMs, clampedTimeoutMs, reason }` (D-12).
  3. Parent-aborted-after-completion marker (D-10) — final shape TBD by planner; either an `aborted` event variant OR a flag on existing surfaces.
- Plus engine option `defaultSubRunTimeoutMs?: number` (D-14) on the config types.
- Plus enrichment of `code: "aborted"` errors with `detail.reason: "parent-aborted" | "timeout"` (D-08/D-13) — lock in `public-error-api.test.ts` if that file exists, otherwise via cancellation-contract.

**D-20: Four plans, one per BUDGET requirement.** (Q-20)
- Plan 02-01 — BUDGET-01 (cancellation propagation): D-07, D-08, D-09, D-10, D-13 abort-side, contract tests in `cancellation-contract.test.ts`.
- Plan 02-02 — BUDGET-02 (timeout/deadline propagation): D-11, D-12, D-13 timeout-side, D-14, `subRun.budgetClamped` event, deadline math test.
- Plan 02-03 — BUDGET-03 (cost & token roll-up + replay parity): D-01, D-02, D-03, D-04, D-05, D-06, plus parent-rollup-drift error.
- Plan 02-04 — BUDGET-04 (termination floors lock): D-15, D-16, D-17, plus the parent-events-isolation contract test.
- Trade-off accepted: dispatchDelegate gets touched in 02-01, 02-02, AND 02-03. Each plan keeps its diff surgical; ordering matters (02-01 → 02-02 → 02-03 → 02-04) to minimize merge churn. Planner: confirm dependency order in PLAN files.
- Phase wrap commit updates CHANGELOG with the final list of public-surface additions (one batched entry, not per-plan).

## Cross-cutting / open notes for planner

- **Public-surface change inventory** (must move together per CLAUDE.md): `sub-run-failed.partialCost`, `subRun.budgetClamped` event variant, parent-aborted-after-completion observability shape, `defaultSubRunTimeoutMs` engine option, `aborted` error `detail.reason` enrichment. Updates required: `event-schema.test.ts`, `result-contract.test.ts`, `package-exports.test.ts`, `public-error-api.test.ts` (if extant), `package.json` exports/files (only if new export surfaces — none expected), CHANGELOG v0.4.0 entry.
- **Ordering risk in D-01:** roll-up assignment must happen BEFORE `sub-run-completed` is emitted so that the existing "last cost-bearing event === final.cost" invariant survives. Planner: confirm the emit ordering or surface an explicit invariant rewrite if simpler.
- **D-04 algorithm clarity:** the parent-rollup parity check is the third clause in `recomputeAccountingFromTrace`. Today the function checks (1) parent local accounting matches reconstructed-from-events, and (2) every child's recorded accounting matches its recursive recompute. The new (3) is: parent's recorded `cost.usd` (and the eight fields) equals `localOnly + Σ subRunCompleted.subResult.accounting + Σ subRunFailed.partialCost`. Planner: pick the cleanest factoring — either a new `accumulateSubRunCost` helper, or fold into the existing per-event walk.
- **D-07 + Phase 4 forward-compat:** the per-child `AbortController` lays the groundwork for Phase 4's streaming cancellation (STREAM-03). Plan 02-01's controller derivation should leave a hook (or at least a comment) noting where Phase 4 will attach the per-child stream cancel.
- **D-08 + D-13 detail.reason vocabulary:** the discriminator strings `"parent-aborted"` and `"timeout"` become public. Planner: decide whether to expose them as a string-literal type union or just document them as conventional values.
- **D-10 shape decision:** "parent aborts after sub-run completed" observability is the loosest of the Q-19 additions. Planner has discretion on event variant vs flag on existing surface; minimum bar is "replay can tell the abort happened."
- **D-14 ceiling default:** the engine-level `defaultSubRunTimeoutMs` default is `undefined`. Planner: confirm this is set ONCE at engine construction, not per-run, and that per-run / per-decision overrides still honor the existing precedence rules.
- **Phase 3 forward-compat:** the per-child `AbortController` (D-07) plus the deadline-now math (D-11) interact with Phase 3's `maxConcurrentChildren`. When concurrency lands and N children dispatch in parallel, each shares the parent's deadline snapshot at dispatch time. Planner: confirm "snapshot per dispatch" is correct vs "evaluate at each child's start" — current decision is snapshot.

## Deferred ideas

(none — all 20 questions answered with concrete options)

## Next step

```
/gsd-plan-phase 2
```
