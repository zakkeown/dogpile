---
phase: 01-delegate-decision-sub-run-traces
plan: 05
subsystem: runtime/defaults, runtime/engine, replay
tags: [replay, recursion, accounting, tamper-detection, public-api, changelog]
requires:
  - "AgentDecision discriminated union from Plan 01-01"
  - "sub-run-* RunEvent variants from Plan 01-02"
  - "Coordinator delegate dispatch loop from Plan 01-03"
  - "maxDepth option + dual-gate from Plan 01-04"
provides:
  - "recomputeAccountingFromTrace(trace: Trace): RunAccounting helper (runtime-internal export)"
  - "replay() now performs recursive accounting verification on every embedded sub-run"
  - "Per-field tamper detection on the eight enumerated numeric fields with detail.field set"
  - "v0.4.0 [Unreleased] CHANGELOG entry covering every Phase 1 public-surface change"
affects:
  - "src/runtime/engine.ts replay() build path (delegates accounting construction to the helper)"
  - "src/tests/result-contract.test.ts (new replay-verbatim-event-sequence test)"
tech-stack:
  added: []
  patterns:
    - "Helper returns parent-LOCAL accounting (matches replay()'s historical build); recursive walk handles child verification as a side-effect; child-vs-recorded comparison happens inside the recursion, not at the top level"
    - "Parent-level integrity vector: trace.finalOutput.cost compared against the cost on the last cost-bearing event (final / agent-turn / broadcast / budget-stop). Catches finalOutput.cost mutation that does not also update the events"
    - "USD fields use Math.abs(a - b) < 1e-9 epsilon comparison; integer fields use ==="
    - "Fixed field-comparison order so the first differing field is reported deterministically: cost.usd, cost.inputTokens, cost.outputTokens, cost.totalTokens, usage.usd, usage.inputTokens, usage.outputTokens, usage.totalTokens"
key-files:
  created:
    - "src/tests/replay-recursion.test.ts"
  modified:
    - "src/runtime/defaults.ts"
    - "src/runtime/engine.ts"
    - "src/tests/result-contract.test.ts"
    - "src/tests/config-validation.test.ts"
    - "CHANGELOG.md"
decisions:
  - "recomputeAccountingFromTrace returns parent-LOCAL RunAccounting (not a parent+children sum). The plan text said 'sums parent + children'; that reading conflicts with how every protocol records totalCost (parent-only — verified at coordinator.ts:275) and would make T-05-02 (parent-tamper) fire on every clean nested trace. Resolution: helper returns parent-local; child recursion is for tamper-detection on children, surfaced via internal throws. The 'sum across children' framing was a plan-text mistake."
  - "There is no `trace.accounting` field on Trace (verified by grep). The plan said 'compare recomputed against trace.accounting' as an open question. The realistic parent comparison vector is `trace.finalOutput.cost` vs the cost recorded on the last cost-bearing event in `trace.events`. On a clean trace this holds by construction in every protocol (totalCost is written into the final event). On a tampered trace this catches finalOutput.cost mutation. Implemented as the parent-level branch inside the helper."
  - "Helper kept runtime-internal: not re-exported through src/index.ts / src/types.ts. package-exports.test.ts continues to pass without edits. If callers later need it, adding the export is additive."
  - "8 child-tamper tests + 4 parent-tamper tests = 12 tamper assertions. Parent's `usage` is derived from `cost` in createRunAccounting (lines 167, 152-158), so independent parent-usage tampering on `trace.finalOutput.cost` is not a separate vector — only the four cost.* fields are independently mutable at the parent level. Child accounting carries cost AND usage as independent storage, so all 8 child-side fields are independently tamperable."
  - "replayStream() inherits the validation transitively: it builds its result by awaiting replay(), so any tampered trace surfaces on either replay path. No explicit duplication of the validation in replayStream()."
  - "Replay does NOT call runProtocol or invoke any provider. The test asserts zero additional provider invocations during replay (live + JSON-round-trip)."
  - "Fixed two pre-existing typecheck errors in src/tests/config-validation.test.ts (Plan 04 escapee — DogpileOptions.tier optional vs EngineOptions.tier required) as a Rule 3 blocking-issue deviation."
metrics:
  duration: "~25 min"
  completed: "2026-04-30"
---

# Phase 01 Plan 05: Replay Recursion & Accounting Recompute Summary

Locks the replay-without-re-execute contract for nested traces (D-08) and the
recursive accounting verification (D-10). Adds the v0.4.0 CHANGELOG entry
documenting the entire Phase 1 public-surface inventory. Replay now produces
identical output, accounting, and event sequence as the live run for nested
coordinator-with-children traces, with zero provider invocation.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement recomputeAccountingFromTrace helper in defaults.ts | `012f4b6` | `src/runtime/defaults.ts`, `src/tests/config-validation.test.ts` |
| 2 | Wire replay() to recompute accounting; new replay-recursion.test.ts; extend result-contract.test.ts | `4773ed9` | `src/runtime/engine.ts`, `src/tests/replay-recursion.test.ts`, `src/tests/result-contract.test.ts` |
| 3 | Write CHANGELOG.md v0.4.0 [Unreleased] entry | `88672cd` | `CHANGELOG.md` |

## Where `recomputeAccountingFromTrace` Lives

`src/runtime/defaults.ts` — exported function appended after `createRunAccounting`'s
helpers, before `canonicalizeSerializable`. Takes `Trace`, returns the parent's
local `RunAccounting` (built with the same `createRunAccounting` shape that
`replay()` historically built inline).

The helper:

1. Builds parent-local accounting from `trace.tier`, `trace.budget.caps`,
   `trace.budget.termination`, `trace.finalOutput.cost`, and `trace.events`.
2. Computes a parallel parent accounting from the cost recorded on the last
   cost-bearing event (`final`, `agent-turn`, `broadcast`, or `budget-stop`).
   Compares the two parent accountings field-by-field across the eight
   enumerated numeric fields. Mismatch throws `invalid-configuration` with
   `detail.eventIndex: -1` and `detail.field` set to the first differing
   field. This is the parent-tamper layer.
3. Iterates `trace.events`. For each `sub-run-completed`, recursively calls
   itself on `event.subResult.trace`, then compares the recomputed child
   accounting against the recorded `event.subResult.accounting` field-by-field.
   Mismatch throws `invalid-configuration` with `detail.eventIndex` = index of
   the offending event in the parent `trace.events` array, `detail.childRunId`,
   and `detail.field`.
4. Returns the parent-local accounting.

Pure: no I/O, no `Date.now()`, no provider calls.

## Comparison Strategy (per field)

| Field | Comparison |
|-------|------------|
| `cost.usd` | `Math.abs(a - b) < 1e-9` |
| `cost.inputTokens` | `===` |
| `cost.outputTokens` | `===` |
| `cost.totalTokens` | `===` |
| `usage.usd` | `Math.abs(a - b) < 1e-9` |
| `usage.inputTokens` | `===` |
| `usage.outputTokens` | `===` |
| `usage.totalTokens` | `===` |

Fixed comparison order ensures the first differing field is reported
deterministically across runs.

## Eight Enumerated Summable Fields

`cost.usd`, `cost.inputTokens`, `cost.outputTokens`, `cost.totalTokens`,
`usage.usd`, `usage.inputTokens`, `usage.outputTokens`, `usage.totalTokens`.

Non-summed and non-compared: `kind`, `tier`, `budget`, `termination`,
`budgetStateChanges`, `usdCapUtilization`, `totalTokenCapUtilization`.

## Helper Visibility

**Internal.** `recomputeAccountingFromTrace` is exported from
`src/runtime/defaults.ts` (so engine.ts can call it) but is NOT re-exported
through `src/index.ts`, `src/types.ts`, or any subpath in `package.json`'s
`exports`. Verified by `pnpm vitest run src/tests/package-exports.test.ts`
remaining green. The helper is an SDK-invariant utility, not part of the
caller-facing surface. Adding the export is additive if a future plan needs
it.

## Phase 1 Test Files Added or Extended

| File | Status | Owning plan |
|------|--------|-------------|
| `src/runtime/decisions.test.ts` | extended | 01-01 |
| `src/runtime/coordinator.test.ts` | extended | 01-03 |
| `src/tests/event-schema.test.ts` | extended | 01-02 |
| `src/tests/result-contract.test.ts` | extended | 01-02, 01-05 |
| `src/tests/config-validation.test.ts` | extended | 01-04 |
| `src/tests/replay-recursion.test.ts` | **new (this plan)** | 01-05 |

The new `src/tests/replay-recursion.test.ts` file has 13 cases:

- 1 end-to-end nested-coordinator replay → output, accounting, event sequence
  preserved verbatim; provider invocation count unchanged across replay and
  JSON-round-trip replay.
- 8 child-level tamper tests (one per enumerated numeric field).
- 4 parent-level tamper tests (one per `cost.*` field; parent `usage` is
  derived from `cost` so it is not independently tamperable at the parent
  level).
- 1 clean-JSON-round-trip validation (defensive — guards against any future
  helper change that breaks pure replay on a clean trace).

## Replay vs. replayStream

`replay()` calls `recomputeAccountingFromTrace()` directly. `replayStream()`
inherits the validation transitively because it constructs its result handle
by `Promise.resolve(replay(trace))` (engine.ts:811) — any tampered trace
surfaces on either replay path with the same error shape. No duplicated
validation logic.

## Verification

- `pnpm run typecheck` — clean.
- `pnpm vitest run src/tests/replay-recursion.test.ts src/tests/result-contract.test.ts` — 28/28 pass.
- `pnpm vitest run` (full suite) — 488 passed, 1 skipped, 1 failure (pre-existing `src/tests/consumer-type-resolution-smoke.test.ts` infra issue documented in Plans 01-01 / 01-02 / 01-03 / 01-04 SUMMARYs; unchanged by this plan).

## Deviations from Plan

### Rule 1 — Plan-text correction (auto-applied)

**1. Helper returns parent-LOCAL accounting, not parent+children sum**

- **Found during:** Task 1 design review.
- **Issue:** The plan said "sums exactly these eight numeric fields across parent + every embedded child trace" and "the parent's returned accounting is `parentLocal + Σ childRecomputed`." But every protocol records `totalCost` as parent-local only (verified at `src/runtime/coordinator.ts:275` — `addCost(totalCost, result.turnCost)` does not include sub-run costs). On a clean nested trace, parent-local-recomputed equals `trace.accounting`, but parent-local-PLUS-children does NOT. The plan-text reading would make threat T-05-02 (parent-tamper detection) throw on every clean trace — which breaks replay.
- **Fix:** Helper returns parent-local accounting. Child recursion is preserved as the tamper-detection vector for children (T-05-01). The "sum across children" prose in the plan was a planner-side mistake; threat-model constraints (T-05-01..04 must all be detectable on tampered traces AND clean traces must validate) force the parent-local interpretation.
- **Files modified:** `src/runtime/defaults.ts` (helper implementation reflects parent-local return).
- **Commit:** `012f4b6` (rolled into Task 1).

### Rule 1 — Plan-text correction (auto-applied)

**2. Parent comparison target is `trace.finalOutput.cost`, not `trace.accounting`**

- **Found during:** Task 1 design review.
- **Issue:** The plan's `<interfaces>` section said "compare against `trace.accounting` (or whatever the recorded parent accounting field is — verify)" and the plan's tamper tests said "mutate that exact field on the top-level `trace.accounting`." Verified by `grep -n "trace\.accounting" src/types.ts src/runtime/*.ts` that NO such field exists on the `Trace` type — `replay()` rebuilds accounting from `trace.finalOutput.cost`, `trace.tier`, `trace.budget`, and `trace.events`.
- **Fix:** Parent-tamper detection compares `trace.finalOutput.cost` against the cost recorded on the last cost-bearing event in `trace.events` (final / agent-turn / broadcast / budget-stop). Every protocol writes `totalCost` into its final event by construction, so on a clean trace the two are equal; mutation of `finalOutput.cost` (or events) without updating the other side fires the throw with `detail.eventIndex: -1`.
- **Files modified:** `src/runtime/defaults.ts` (parent-tamper branch added inside the helper). Tests target `trace.finalOutput.cost.<field>` for parent tamper.
- **Commit:** `012f4b6` (rolled into Task 1).

### Rule 1 — Plan-text correction (auto-applied)

**3. Parent-level tamper tests cover four fields, not eight**

- **Found during:** Task 2 test authoring.
- **Issue:** The plan asked for tamper tests on all eight numeric fields including parent-level mutations. Parent's `usage` is derived from `cost` inside `createRunAccounting` (`src/runtime/defaults.ts:167` calls `createRunUsage(options.cost)`); mutating `trace.finalOutput.cost.usd` would update both `cost.usd` AND `usage.usd` together, so the two are not independently tamperable at the parent level. Only the four `cost.*` fields are.
- **Fix:** Parent-level tamper tests cover the four `cost.*` fields. Child-level tamper tests cover all eight (child accounting carries cost AND usage as independent storage, so each is independently tamperable). 8 child + 4 parent = 12 tamper tests total. The plan's "8 tamper tests, at least one parent-level" criterion is satisfied.
- **Files modified:** `src/tests/replay-recursion.test.ts`.
- **Commit:** `4773ed9` (rolled into Task 2).

### Rule 3 — Blocking issue (auto-applied)

**4. Pre-existing typecheck errors in src/tests/config-validation.test.ts**

- **Found during:** Task 1 verification gate.
- **Issue:** `pnpm run typecheck` reported two errors at `config-validation.test.ts:612` and `:632` (Plan 04 escapee — `DogpileOptions.tier` is optional but `EngineOptions.tier` is required; spreading `validDogpileOptions` into `createEngine` loses the required `tier`). Confirmed pre-existing on `main` via `git stash`. These blocked Task 1's `pnpm run typecheck` verification gate.
- **Fix:** Added explicit `tier: "fast"` to both `createEngine` calls (`it("uses engine value when per-run maxDepth lowers...")` and `it("clamps per-run maxDepth that tries to raise...")`).
- **Files modified:** `src/tests/config-validation.test.ts`.
- **Commit:** `012f4b6` (rolled into Task 1).

### Out-of-scope (deferred)

- **`src/tests/consumer-type-resolution-smoke.test.ts`** (pre-existing): `pnpm exec` cwd issue when running `tsc` from a separate directory. Logged in Plans 01-01 / 01-02 / 01-03 / 01-04 SUMMARYs. Unchanged by this plan; the fixture itself typechecks cleanly via the workspace tsconfig.

## Authentication Gates

None.

## Public Surface Touched

| File | Status | Change |
|------|--------|--------|
| `src/runtime/defaults.ts` | modified | New runtime-internal export `recomputeAccountingFromTrace`. Adds `Trace` to type imports and `DogpileError` to value imports. No re-export through `src/index.ts` / `src/types.ts` / `package.json` exports |
| `src/runtime/engine.ts` | modified | `replay()` calls `recomputeAccountingFromTrace()` instead of inlining `createRunAccounting()`. Behavior change: tampered traces now throw `invalid-configuration` where they previously rehydrated silently — the intended D-10 outcome, documented in CHANGELOG |
| `src/tests/replay-recursion.test.ts` | created | 13 cases covering nested-replay reproduction + 12 tamper assertions |
| `src/tests/result-contract.test.ts` | modified | New "replay round-trip preserves parent event sequence verbatim" test |
| `src/tests/config-validation.test.ts` | modified | Two `tier: "fast"` additions to fix pre-existing typecheck errors |
| `CHANGELOG.md` | modified | New `[Unreleased] — v0.4.0` section covering AgentDecision union, sub-run-* events, RunCallOptions / maxDepth, fenced-JSON parser, replay recursion, three new ReplayTraceProtocolDecisionType literals |

`package.json` `exports` / `files` unchanged. `package-exports.test.ts` still passes.

## Deferred Issues

- **`src/tests/consumer-type-resolution-smoke.test.ts`** (pre-existing): out of scope; documented above.

## Threat Flags

None — this plan stays within the trust boundaries documented in the plan's STRIDE register (T-05-01..05). Mitigations:

- **T-05-01** (modified child `subResult.accounting`): child-level recursive recompute throws `trace-accounting-mismatch` with `eventIndex` of the offending sub-run-completed and `detail.field` identifying the field. Verified by 8 child-tamper tests in `replay-recursion.test.ts`.
- **T-05-02** (modified parent accounting): parent-level recompute compares `trace.finalOutput.cost` against the cost on the last cost-bearing event; throws with `eventIndex: -1`. Verified by 4 parent-tamper tests.
- **T-05-03** (deeply-nested trace stack overflow): accepted per plan; `maxDepth` default `4` from Plan 04 bounds run-time recursion; replay accepts whatever depth was recorded.
- **T-05-04** (forged `subResult` with empty events but non-zero accounting): recomputed child accounting from empty events is zero; mismatch throws via the same child-recursion path.
- **T-05-05** (info disclosure in error message): accepted per plan; numeric values only, no secrets.

## TDD Gate Compliance

The plan frontmatter marks Tasks 1 and 2 `tdd="true"`. Git log for this plan shows:

- Task 1: `feat(01-05): add recomputeAccountingFromTrace for replay tamper detection` (`012f4b6`).
- Task 2: `feat(01-05): wire replay() to recompute accounting; add replay-recursion tests` (`4773ed9`).
- Task 3: `docs(01-05): add v0.4.0 [Unreleased] CHANGELOG entry` (`88672cd`).

The Task 1 + Task 2 commits use `feat:` rather than separate `test:` + `feat:` because lock tests are tightly coupled to implementation and land in the same commit (matching Plan 01-02 / 01-03 / 01-04 conventions for tightly-coupled implementation + lock test pairs). Task 1 was gated by `pnpm run typecheck` per the plan; Task 2 by the new behavioral lock tests in `replay-recursion.test.ts` plus the extension in `result-contract.test.ts` — all of which would have failed before the helper existed (import error) and before `replay()` was wired.

## Self-Check

- `src/runtime/defaults.ts` (recomputeAccountingFromTrace export) — FOUND
- `src/runtime/engine.ts` (replay() wired to helper) — FOUND
- `src/tests/replay-recursion.test.ts` (13 cases) — FOUND
- `src/tests/result-contract.test.ts` (new verbatim-event-sequence test) — FOUND
- `src/tests/config-validation.test.ts` (tier additions) — FOUND
- `CHANGELOG.md` (v0.4.0 [Unreleased] entry) — FOUND
- Commit `012f4b6` — FOUND
- Commit `4773ed9` — FOUND
- Commit `88672cd` — FOUND
- `pnpm run typecheck` — clean
- `pnpm vitest run src/tests/replay-recursion.test.ts src/tests/result-contract.test.ts` — 28/28 pass
- `pnpm vitest run` (full suite) — 488 passed, only the pre-existing `consumer-type-resolution-smoke.test.ts` failure remains

## Self-Check: PASSED
