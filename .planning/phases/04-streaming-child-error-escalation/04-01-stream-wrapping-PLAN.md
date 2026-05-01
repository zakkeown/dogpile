---
phase: 04-streaming-child-error-escalation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/types/events.ts
  - src/types.ts
  - src/runtime/coordinator.ts
  - src/runtime/replay.ts
  - src/tests/streaming-api.test.ts
  - src/tests/event-schema.test.ts
  - src/tests/result-contract.test.ts
autonomous: true
requirements: [STREAM-01, STREAM-02]
tags: [streaming, events, public-surface]

must_haves:
  truths:
    - "Every event variant in StreamLifecycleEvent ∪ StreamOutputEvent accepts an optional readonly parentRunIds?: readonly string[] field"
    - "When a child engine bubbles an event up through teedEmit, the parent's emit callback receives the event with parentRunIds = [self.runId, ...(inbound.parentRunIds ?? [])] (root → ... → immediate parent)"
    - "Per-child event order is preserved on the parent stream — events from one child arrive in the order the child engine emitted them"
    - "Persisted RunResult.events for the parent run contains zero events with parentRunIds set (chain is live-stream-only)"
    - "replay() re-fires events through a path that reconstructs the parentRunIds chain so live consumers of replay see the same ancestry as live runs"
    - "Parent-emitted sub-run-* lifecycle events have parentRunIds undefined (they originate at the parent level)"
  artifacts:
    - path: "src/types/events.ts"
      provides: "Optional readonly parentRunIds?: readonly string[] field on every member of StreamLifecycleEvent and StreamOutputEvent"
      contains: "parentRunIds"
    - path: "src/runtime/coordinator.ts"
      provides: "teedEmit wraps each child event with parentRunIds = [coordinator.runId, ...inbound.parentRunIds ?? []] before forwarding to options.emit; childEvents buffer (used for subResult.events) stores the ORIGINAL child event without the chain"
      contains: "parentRunIds"
    - path: "src/runtime/replay.ts"
      provides: "Replay's emit-side reconstructs parentRunIds at each bubbling boundary so replayed streams see the same chain as live"
      contains: "parentRunIds"
    - path: "src/tests/streaming-api.test.ts"
      provides: "STREAM-01 chain wrap test (single + grandchild) and STREAM-02 per-child order contract test (N=20 events with setImmediate interleaves; parallel-children variant asserts cross-child interleave is allowed)"
    - path: "src/tests/event-schema.test.ts"
      provides: "Public-surface lock for parentRunIds on every event variant; lock that sub-run-* parent-emitted events have parentRunIds undefined"
    - path: "src/tests/result-contract.test.ts"
      provides: "Assertion that for a run with delegated children, parent.events.find(e => 'parentRunIds' in e && e.parentRunIds !== undefined) is undefined (D-04 isolation)"
  key_links:
    - from: "src/runtime/coordinator.ts:teedEmit"
      to: "options.emit (parent stream)"
      via: "shallow-clone with parentRunIds prepended"
      pattern: "parentRunIds:\\s*\\[.*runId.*\\.\\.\\."
    - from: "src/runtime/coordinator.ts:childEvents.push"
      to: "subResult.events (persisted trace)"
      via: "store ORIGINAL inbound event (no chain mutation)"
      pattern: "childEvents\\.push"
---

<objective>
Land the STREAM-01 / STREAM-02 contract: every event bubbled through a parent stream carries a `parentRunIds: readonly string[]` ancestry chain (D-01 collapsed into D-02) so consumers can demultiplex concurrent children and grandchildren by exact-level or by ancestry. Per-child order is preserved by JS single-thread + serial publish — no new machinery, only a contract test (D-03). The persisted parent `RunResult.events` array remains chain-free (D-04 isolation) so Phase 2 D-15's parent-events termination math is unaffected.

Purpose: Phase 1 D-09's deferred child-event bubbling unlocks here. This is pure additive event-shape work — no cancellation logic (that's 04-02), no error logic (04-03/04-04). It is the foundation every other 04-XX plan stacks on.

Output: Optional `parentRunIds` field threaded through public event types; `teedEmit` chain prepend; replay-side mirror; three test files updated.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md
@CLAUDE.md
@src/types/events.ts
@src/runtime/coordinator.ts
@src/runtime/replay.ts

<interfaces>
<!-- Key shapes the executor needs. Extracted from existing code. -->

From src/types/events.ts:789-806:
```typescript
export type StreamLifecycleEvent =
  | StartEvent
  | FinalEvent
  | ConsensusEvent
  | SubRunStartedEvent
  | SubRunCompletedEvent
  | SubRunFailedEvent
  | SubRunQueuedEvent
  | SubRunConcurrencyClampedEvent;

export type StreamOutputEvent = ModelActivityEvent | ToolActivityEvent | TurnEvent | BroadcastEvent;
```

From src/runtime/coordinator.ts:1116–1121 (current teedEmit):
```typescript
const childEvents: RunEvent[] = [];

const teedEmit = (event: RunEvent): void => {
  childEvents.push(event);
  options.emit?.(event);
};
```

Target shape (after this plan):
```typescript
const teedEmit = (event: RunEvent): void => {
  // Persisted child trace: store the ORIGINAL event (no chain). D-04 isolation.
  childEvents.push(event);
  // Live-stream consumer: prepend this coordinator's runId to ancestry chain.
  const inbound = (event as { parentRunIds?: readonly string[] }).parentRunIds;
  const wrapped = { ...event, parentRunIds: [self.runId, ...(inbound ?? [])] as const };
  options.emit?.(wrapped as RunEvent);
};
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add optional parentRunIds field to all stream event variants and lock public surface</name>
  <files>src/types/events.ts, src/types.ts, src/tests/event-schema.test.ts, src/tests/result-contract.test.ts</files>
  <read_first>
    - src/types/events.ts (lines 789–852 — StreamLifecycleEvent, StreamOutputEvent, StreamErrorEvent unions)
    - src/types.ts (lines 1311–1359 — public event re-exports)
    - src/tests/event-schema.test.ts (existing public-surface lock structure)
    - src/tests/result-contract.test.ts (existing parent-events isolation assertions, including budget-first-stop pattern)
    - .planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md (D-01, D-02, D-04, D-15 #1)
  </read_first>
  <behavior>
    - Test 1 (event-schema.test.ts): Each event variant in StreamLifecycleEvent ∪ StreamOutputEvent accepts an optional `readonly parentRunIds?: readonly string[]`. A constructed event with `parentRunIds: ["root", "parent"]` type-checks and round-trips through JSON.stringify.
    - Test 2 (event-schema.test.ts): A parent-emitted sub-run-* lifecycle event (sub-run-started / sub-run-completed / sub-run-failed / sub-run-queued / sub-run-concurrency-clamped) constructed at the parent level has `parentRunIds === undefined` — locks D-04 cross-cutting note that sub-run-* events are PARENT-level.
    - Test 3 (result-contract.test.ts): For a run with delegated children, `parent.events.find(e => "parentRunIds" in e && (e as any).parentRunIds !== undefined)` is `undefined` (D-04 isolation: chain is live-stream-only, never persisted).
  </behavior>
  <action>
    Add an optional `readonly parentRunIds?: readonly string[]` field to EVERY interface backing a member of `StreamLifecycleEvent` and `StreamOutputEvent` in `src/types/events.ts`. Concretely:
    - `StartEvent`, `FinalEvent`, `ConsensusEvent`, `SubRunStartedEvent`, `SubRunCompletedEvent`, `SubRunFailedEvent`, `SubRunQueuedEvent`, `SubRunConcurrencyClampedEvent` (lifecycle)
    - `ModelActivityEvent`, `ToolActivityEvent`, `TurnEvent`, `BroadcastEvent` (output)
    Field shape verbatim: `readonly parentRunIds?: readonly string[];`. Empty/absent at root; `[parent]` at depth 1; `[grandparent, parent]` at depth N (D-02).

    Do NOT add the field to `StreamErrorEvent` or `StreamCompletionEvent` (those are stream-handle terminal events emitted by the parent engine itself, not bubbled).

    Do NOT add a flat `parentRunId?: string` field — D-02 explicitly DROPS the flat single-parent field (Q-01=a literal wording superseded by Q-02=b chain). Single canonical shape: `parentRunIds`.

    Re-exports in `src/types.ts` (lines 1311–1359) ride existing union exports — confirm via type-check that `StreamEvent` consumers see the new optional field. No new top-level export name needed (D-15 inventory: `package-exports.test.ts` is a no-op for this plan).

    Add tests per `<behavior>` in `src/tests/event-schema.test.ts` (variant coverage + sub-run-* parent-emitted absence) and `src/tests/result-contract.test.ts` (D-04 isolation assertion).
  </action>
  <verify>
    <automated>pnpm run typecheck && pnpm vitest run src/tests/event-schema.test.ts src/tests/result-contract.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "parentRunIds" src/types/events.ts` returns >= 12 (one per affected interface; allow whitespace tolerance — grep file with `-v '^[[:space:]]*\*\|^[[:space:]]*//'` to exclude comment-only lines if header prose is present).
    - `pnpm run typecheck` exits 0.
    - `pnpm vitest run src/tests/event-schema.test.ts -t "parentRunIds"` includes a passing test asserting the optional field exists on every variant.
    - `pnpm vitest run src/tests/result-contract.test.ts -t "parent events isolation"` passes with the new D-04 assertion (parent.events has no parentRunIds-bearing events).
    - Zero occurrences of `parentRunId?:` (singular, flat) in `src/types/events.ts` — D-02 dropped that shape.
  </acceptance_criteria>
  <done>
    Public event union carries the chain field; both schema and result-contract tests lock the surface; typecheck green.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement teedEmit chain prepend (live-stream only) and lock STREAM-01 / STREAM-02 contracts</name>
  <files>src/runtime/coordinator.ts, src/runtime/replay.ts, src/tests/streaming-api.test.ts</files>
  <read_first>
    - src/runtime/coordinator.ts (lines 1043–1262 — childEvents buffer, teedEmit, subResult assembly, child failure path)
    - src/runtime/replay.ts (entire file — replay's event re-fire path; identify whether it routes through teedEmit or an equivalent emit boundary at each delegate boundary)
    - src/tests/streaming-api.test.ts (existing streaming wrap tests — locate the dispatch-and-collect harness used for STREAM-* asserts)
    - .planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md (D-02 chain prepend semantics; D-03 order contract; D-04 stream-vs-trace asymmetry; cross-cutting note on replay round-trip)
    - src/runtime/engine.ts:316 (publish(event) parent-stream FIFO drain — confirms serial emit guarantees per-child order)
  </read_first>
  <behavior>
    - Test 1 (streaming-api.test.ts, STREAM-01 wrap, depth=1): Parent runs a coordinator delegating to one child. Collect parent-stream events. Every event whose `runId !== parent.runId` carries `parentRunIds = [parent.runId]`. Every event whose `runId === parent.runId` has `parentRunIds === undefined`.
    - Test 2 (streaming-api.test.ts, STREAM-01 wrap, depth=2 grandchild): Parent → child → grandchild. Events from grandchild on the parent stream carry `parentRunIds = [parent.runId, child.runId]` (root-first ancestry, immediate-parent last per D-02 demux semantics: `event.parentRunIds[event.parentRunIds.length - 1]` is immediate parent).
    - Test 3 (streaming-api.test.ts, STREAM-02 per-child order): Single child emits N=20 events with deliberate `setImmediate` interleaves between emits. Filter parent-stream events by `runId === child.runId`; assert the filtered subsequence equals the order the child engine emitted them.
    - Test 4 (streaming-api.test.ts, STREAM-02 cross-child interleave allowed): Two parallel children A and B each emit ≥3 events. Assert per-child subsequences are each monotonic (filter-by-runId still preserves order) AND assert the combined parent-stream order is NOT required to be a specific cross-child interleave (test merely asserts both subsequences preserved, allowing any interleave).
    - Test 5 (streaming-api.test.ts, D-04 isolation): After the run completes, `parent.events` (the persisted trace) contains zero events with `parentRunIds` defined. Pair this with: `parent.events.find(e => e.type === "sub-run-completed").subResult.events` ALSO contains zero events with `parentRunIds` defined (chain is bubble-time-only — child trace is byte-identical to what the child engine emitted).
    - Test 6 (streaming-api.test.ts, replay round-trip): Run a delegated trace, capture it, then `replayStream(trace)`; assert the replayed parent stream surfaces grandchild events with the same `parentRunIds` chain as the original live run (replay-emit-side reconstructs the chain — cross-cutting note in CONTEXT).
  </behavior>
  <action>
    **Coordinator change (`src/runtime/coordinator.ts:1116–1121` region — exact line range may shift; locate by the `const teedEmit = (event: RunEvent): void => {` declaration immediately after `const childEvents: RunEvent[] = [];`):**

    Replace the current `teedEmit` body so the live-stream wrap and the persisted-trace push diverge:

    ```typescript
    const teedEmit = (event: RunEvent): void => {
      // Persisted child trace stays byte-identical to what the child engine emitted (D-04).
      childEvents.push(event);
      // Live-stream consumer sees ancestry. Prepend THIS coordinator's runId to whatever
      // chain the child already carried (D-02: root → ... → immediate-parent ordering;
      // immediate-parent is the LAST element).
      if (options.emit) {
        const inbound = (event as { parentRunIds?: readonly string[] }).parentRunIds;
        const wrapped = { ...event, parentRunIds: [...(inbound ?? []), self.runId] as const };
        // NOTE: D-02 demux contract says event.parentRunIds[length-1] is immediate parent.
        // The CURRENT level prepends ITS runId as the new immediate parent on the way up,
        // i.e. APPENDS to the array (since the array is root-first, immediate-parent-last).
        options.emit(wrapped as RunEvent);
      }
    };
    ```

    CRITICAL: re-read CONTEXT D-02 carefully. The chain is "root → ... → immediate-parent" with immediate-parent at the END (per the demux example: `event.parentRunIds?.[event.parentRunIds.length - 1] === handle.runId` checks immediate-parent equality). The CONTEXT prose "prepend its OWN runId" describes the conceptual operation but the array order is root-first, so the implementation APPENDS each new wrapper's runId. Confirm by reading `<behavior>` Test 2 — grandchild events carry `[parent.runId, child.runId]`, where `parent` is the topmost (root) and `child` is the immediate parent.

    Locate `self.runId` — this is the running coordinator's runId (the engine context that owns this `teedEmit`). Use whatever the existing variable name is in coordinator.ts (likely `runId` from the surrounding closure, or an explicit parameter — read context lines 1043–1116 to find).

    Do NOT touch `childEvents.push(event)` — that buffer feeds `subResult.events` (line ~1225), which must stay chain-free per D-04.

    Sub-run-* lifecycle events (sub-run-started/completed/failed/queued/concurrency-clamped) emitted by the PARENT itself (not via teedEmit) must NOT receive `parentRunIds`. They originate at the parent level. Confirm parent-side emit sites do not accidentally route through teedEmit. (Cross-cutting note in CONTEXT.)

    **Replay-side mirror (`src/runtime/replay.ts`):**

    Replay walks `subResult.events` recursively to re-fire events through a fresh stream. At each delegate-boundary fire site, prepend the current replay-coordinator's runId to the chain so replayed streams see the same ancestry as live streams. If replay's current architecture has a single emit point per delegate boundary, wrap it the same way teedEmit does. If replay re-uses the production teedEmit (preferred), this is automatic — verify by tracing the replay event-fire path. If replay bypasses teedEmit, mirror the wrap inline.

    Concretely: any place in `src/runtime/replay.ts` where a recorded child-engine event is re-emitted to a parent stream consumer, the emit boundary must apply the same `[...inbound, self.runId]` append. Search replay.ts for `emit(` and `events.forEach`/equivalent traversal points.

    **Tests (`src/tests/streaming-api.test.ts`):**

    Add the six tests in `<behavior>`. Use existing test harness conventions (deterministic provider from `src/testing/`, intent + delegate decision fixtures). For Test 6 (replay round-trip), use `replay()` or `replayStream()` on the captured trace and assert chain reconstruction.

    No `childSeq` field, no per-child queue refactor — D-03 ships order as a contract assertion only.
  </action>
  <verify>
    <automated>pnpm vitest run src/tests/streaming-api.test.ts src/tests/event-schema.test.ts src/tests/result-contract.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "parentRunIds.*self\.runId|parentRunIds.*\.\.\." src/runtime/coordinator.ts` shows the chain-append at the teedEmit site (excluding comment-only lines: pipe through `grep -v '^[[:space:]]*//'` if needed).
    - `grep -c "parentRunIds" src/runtime/replay.ts` >= 1 (replay-side mirror present), OR a code comment in replay.ts explicitly notes that replay routes through the same teedEmit and therefore inherits the wrap (whichever is true after implementation).
    - `pnpm vitest run src/tests/streaming-api.test.ts -t "STREAM-01"` and `-t "STREAM-02"` and `-t "D-04 isolation"` all pass.
    - The depth=2 grandchild test passes — grandchild events on the parent stream carry exactly `[parent.runId, child.runId]` (length 2, root-first).
    - Filtering parent-stream events by a single child's runId yields a subsequence equal to that child's emit order (Test 3, deterministic with `setImmediate` interleaves).
    - The replay round-trip test (Test 6) shows replayed events carry the same `parentRunIds` chain as the original live run (proves replay-emit-side reconstructs the chain — cross-cutting note resolved).
    - `pnpm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    teedEmit appends self.runId to parentRunIds for live-stream consumers; childEvents buffer (and therefore subResult.events) stays chain-free; STREAM-01 wrap (depth 1 + grandchild), STREAM-02 per-child order (single + parallel), D-04 isolation, and replay round-trip all locked by tests.
  </done>
</task>

</tasks>

<verification>
- `pnpm run typecheck` clean
- `pnpm vitest run src/tests/streaming-api.test.ts src/tests/event-schema.test.ts src/tests/result-contract.test.ts` all green
- Manual sanity: `grep -nE "parentRunId(?!s)" src/types/events.ts src/runtime/coordinator.ts` returns no matches (no flat singular field anywhere)
- Manual sanity: `grep -c "parentRunIds" src/types/events.ts` matches the count of stream-bubbleable event variants (≥ 12 with comment-only lines filtered)
</verification>

<success_criteria>
- STREAM-01: Every child event surfaced on the parent stream carries a `parentRunIds` chain whose last element is the immediate parent and whose first element is the root. Empty/absent on root-emitted events.
- STREAM-02: Per-child order is preserved on the parent stream (contract test passes for single-child setImmediate interleaves and for two parallel children).
- D-04 isolation: `parent.events` (persisted) and every nested `subResult.events` have zero events carrying `parentRunIds`. Phase 2 D-15's parent-events termination math is byte-identical to before this plan.
- Replay round-trip: `replayStream(trace)` produces parent-stream events with the same `parentRunIds` chain as the live run.
- Public surface locked in `event-schema.test.ts` and `result-contract.test.ts`. CHANGELOG entry deferred to plan 04-04 (batched per Phase 2 D-20 / Phase 3 D-18 discipline).
</success_criteria>

<output>
After completion, create `.planning/phases/04-streaming-child-error-escalation/04-01-SUMMARY.md` per the template, recording: D-01/D-02 collapsed shape implemented (`parentRunIds` chain only; flat `parentRunId` dropped), teedEmit append site, replay-side mirror status, and the six new streaming-api.test.ts tests.
</output>
