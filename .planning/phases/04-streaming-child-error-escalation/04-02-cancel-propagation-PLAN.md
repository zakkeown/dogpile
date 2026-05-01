---
phase: 04-streaming-child-error-escalation
plan: 02
type: execute
wave: 2
depends_on: ["04-01"]
files_modified:
  - src/runtime/engine.ts
  - src/runtime/coordinator.ts
  - src/types/events.ts
  - src/types.ts
  - src/tests/streaming-api.test.ts
  - src/tests/cancellation-contract.test.ts
  - src/tests/event-schema.test.ts
  - src/tests/result-contract.test.ts
autonomous: true
requirements: [STREAM-03]
tags: [streaming, cancellation, public-surface, aborted-event]

must_haves:
  truths:
    - "StreamHandle.cancel() reuses the parent AbortController; Phase 2 D-07's per-child controller forwarding propagates the abort to every in-flight child engine"
    - "Before the parent stream's terminal error event, the engine drains every in-flight DispatchedChild by emitting a synthetic sub-run-failed with error.code: 'aborted', error.detail.reason: 'parent-aborted', partialTrace from childEvents, partialCost from lastCostBearingEventCost(childEvents) ?? emptyCost()"
    - "After a child has received its synthetic parent-aborted sub-run-failed, the per-child closed flag suppresses any late events arriving from that child's teedEmit at the parent emit boundary"
    - "Queued-but-not-started children (Phase 3 D-09 sibling-failed pattern) and in-flight children (D-06 parent-aborted) are distinguished by DispatchedChild.started: a single iteration over DispatchedChild handles both with the right detail.reason"
    - "A new top-level lifecycle event variant `aborted` exists on StreamLifecycleEvent: { type: 'aborted', runId, at, reason: 'parent-aborted' | 'timeout', detail? }"
    - "On parent abort the parent stream emits the new aborted lifecycle event BEFORE the terminal error event (or as the terminal lifecycle marker if no error follows — e.g. parent-aborted-after-completion per Phase 2 D-10)"
  artifacts:
    - path: "src/runtime/coordinator.ts"
      provides: "DispatchedChild gains a `closed: boolean` flag (or equivalent) plus a `drainOnParentAbort()` helper that iterates DispatchedChild entries and emits synthetic sub-run-failed for in-flight (started=true, closed=false) entries; teedEmit gates on closed before forwarding late events"
      contains: "parent-aborted"
    - path: "src/runtime/engine.ts"
      provides: "Cancel/abort lifecycle (lines ~283–301 closeStream/createStreamErrorEvent) drains in-flight children FIRST, emits the new aborted lifecycle event, THEN emits the terminal error event"
      contains: "drainOnParentAbort"
    - path: "src/types/events.ts"
      provides: "New AbortedEvent interface added to StreamLifecycleEvent union: { type: 'aborted'; runId: string; at: string; reason: 'parent-aborted' | 'timeout'; detail?: ...; parentRunIds?: readonly string[] }"
      contains: "AbortedEvent"
    - path: "src/tests/streaming-api.test.ts"
      provides: "STREAM-03 cancel-during-fan-out test asserts: in-flight children get synthetic sub-run-failed before terminal; queued children get sibling-failed; aborted lifecycle event precedes error; late events from in-flight children are suppressed after their drain"
    - path: "src/tests/cancellation-contract.test.ts"
      provides: "detail.reason='parent-aborted' synthetic-event vocabulary lock; aborted lifecycle event reason='parent-aborted' lock; cancel after child completion (Phase 2 D-10) emits aborted variant terminal lifecycle without error"
    - path: "src/tests/event-schema.test.ts"
      provides: "AbortedEvent variant added to StreamLifecycleEvent union surface lock"
  key_links:
    - from: "StreamHandle.cancel()"
      to: "parent AbortController.abort()"
      via: "existing engine.ts:293 path"
      pattern: "controller\\.abort"
    - from: "engine.ts cancel lifecycle"
      to: "coordinator.ts drainOnParentAbort"
      via: "callback registered with the running coordinator OR direct invocation through engine context"
      pattern: "drainOnParentAbort"
    - from: "coordinator.ts teedEmit"
      to: "options.emit"
      via: "skip-if-closed gate keyed by childRunId"
      pattern: "if\\s*\\(.*closed"
    - from: "engine.ts publish(aborted lifecycle event)"
      to: "publish(error terminal)"
      via: "ordering: aborted FIRST (or sole terminal lifecycle if no error), error SECOND"
      pattern: "type:\\s*\"aborted\""
---

<objective>
Land STREAM-03: `StreamHandle.cancel()` propagates to every in-flight child stream and the parent stream itself with `DogpileError({ code: "aborted" })`. Implement D-05 (reuse Phase 2 controllers — no new stream-handle machinery) and D-06 (synthetic `sub-run-failed` drain for in-flight children with `detail.reason: "parent-aborted"`, plus a per-child closed flag that suppresses late events at the teedEmit boundary).

Also land D-15 #2 — the new `aborted` lifecycle event variant — here (planner judgment per CONTEXT D-17 note: lifting it into 04-02 keeps 04-04 leaner and the variant is used directly by this plan's drain story). The `aborted` variant is emitted on the parent stream BEFORE the terminal `error` event, or AS the terminal lifecycle marker when termination is the abort itself (Phase 2 D-10's parent-aborted-after-completion observability gap closes here).

Purpose: streaming consumers see a clean three-step terminal sequence on cancel: synthetic `sub-run-failed` for each in-flight child → `aborted` lifecycle event → terminal `error` (`createStreamErrorEvent`). Queued-but-not-started children continue to receive Phase 3 D-09's `sibling-failed` synthetic events; the only new state is in-flight drain.

Output: per-child closed flag + drain helper in coordinator; cancel-lifecycle ordering in engine; new `aborted` event variant; tests for cancel-during-fan-out, late-event suppression, parent-aborted-after-completion (D-10 closure), and the new variant's public surface.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md
@.planning/phases/04-streaming-child-error-escalation/04-01-stream-wrapping-PLAN.md
@.planning/phases/02-budget-cancellation-cost-rollup/02-CONTEXT.md
@.planning/phases/03-provider-locality-bounded-concurrency/03-CONTEXT.md
@CLAUDE.md
@src/runtime/engine.ts
@src/runtime/coordinator.ts
@src/types/events.ts

<interfaces>
<!-- Phase 2 D-09 partialTrace shape (already shipped on sub-run-failed): -->
```typescript
// sub-run-failed already carries:
//   error: DogpileError-shaped payload
//   partialTrace?: readonly RunEvent[]   (Phase 2 D-09)
//   partialCost: Cost                    (Phase 2 D-02)
```

<!-- Phase 3 D-17 DispatchedChild registry (existing — current shape): -->
```typescript
// In coordinator.ts:1163–1183 region — read existing DispatchedChild type to confirm field names.
// Has at minimum: childRunId, controller (AbortController), and a started/state field.
// Phase 4 adds:
//   closed: boolean   // true after a synthetic sub-run-failed has been emitted for this child
```

<!-- New event variant (D-15 #2). Add to StreamLifecycleEvent union. -->
```typescript
export interface AbortedEvent {
  readonly type: "aborted";
  readonly runId: string;
  readonly at: string; // ISO timestamp
  readonly reason: "parent-aborted" | "timeout";
  readonly detail?: { readonly [key: string]: unknown };
  readonly parentRunIds?: readonly string[]; // chain inherited from 04-01
}
```

<!-- Phase 2 D-08 cancellation vocabulary (already shipped): -->
//   detail.reason: "parent-aborted" | "timeout"   (and "sibling-failed", "remote-override-on-local-host")
//   No new vocabulary added in this plan.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add the `aborted` lifecycle event variant to the public surface</name>
  <files>src/types/events.ts, src/types.ts, src/tests/event-schema.test.ts, src/tests/result-contract.test.ts</files>
  <read_first>
    - src/types/events.ts (lines 789–852 — StreamLifecycleEvent union)
    - src/types.ts (lines 1311–1359 — public re-exports)
    - src/tests/event-schema.test.ts (existing variant locks)
    - .planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md (D-15 #2; cross-cutting note "D-15 #2 aborted event variant — exact placement")
    - .planning/phases/02-budget-cancellation-cost-rollup/02-CONTEXT.md (D-10 — parent-aborted-after-completion deferred shape; Phase 4 closes it via this variant)
  </read_first>
  <behavior>
    - Test 1 (event-schema.test.ts): `AbortedEvent` is a member of `StreamLifecycleEvent`; the union type narrows correctly on `event.type === "aborted"`; required fields are `type`, `runId`, `at`, `reason` (`"parent-aborted" | "timeout"`); optional fields are `detail` and `parentRunIds`.
    - Test 2 (event-schema.test.ts): `parentRunIds` is supported on `AbortedEvent` (from 04-01's chain) — round-trips through JSON.stringify with chain `[grandparent, parent]`.
    - Test 3 (result-contract.test.ts): a run that completes normally has zero `aborted` events in `result.events` (the variant is emitted only on abort paths).
  </behavior>
  <action>
    Add to `src/types/events.ts`:

    ```typescript
    export interface AbortedEvent {
      readonly type: "aborted";
      readonly runId: string;
      readonly at: string;
      readonly reason: "parent-aborted" | "timeout";
      readonly detail?: { readonly [key: string]: unknown };
      readonly parentRunIds?: readonly string[];
    }
    ```

    Append `AbortedEvent` to the `StreamLifecycleEvent` union (line ~789):

    ```typescript
    export type StreamLifecycleEvent =
      | StartEvent
      | FinalEvent
      | ConsensusEvent
      | SubRunStartedEvent
      | SubRunCompletedEvent
      | SubRunFailedEvent
      | SubRunQueuedEvent
      | SubRunConcurrencyClampedEvent
      | AbortedEvent;
    ```

    Re-export from `src/types.ts` (lines 1311–1359 region) following the same pattern as the other event interfaces.

    Add tests per `<behavior>`. Use existing event-schema test patterns to lock the variant.

    `package-exports.test.ts` is a no-op (D-15: no new top-level export name; the variant rides the existing `StreamLifecycleEvent` / `StreamEvent` union exports).

    Note for downstream tasks: the `reason: "timeout"` arm covers Phase 2's parent-budget-timeout scenario where the parent times out; emission paths for that arm are handled by 04-02 Task 3 (parent-aborted-after-completion + timeout) and 04-04 (provider-timeout discrimination). Vocabulary is established here.
  </action>
  <verify>
    <automated>pnpm run typecheck && pnpm vitest run src/tests/event-schema.test.ts src/tests/result-contract.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "AbortedEvent" src/types/events.ts` >= 2 (interface + union member).
    - `grep -c "AbortedEvent" src/types.ts` >= 1 (re-export).
    - `pnpm vitest run src/tests/event-schema.test.ts -t "AbortedEvent"` passes.
    - `pnpm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    `AbortedEvent` is a public, locked member of `StreamLifecycleEvent` ready to be emitted by Tasks 2 and 3.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Drain in-flight children with synthetic sub-run-failed (parent-aborted) and add per-child closed flag</name>
  <files>src/runtime/coordinator.ts, src/runtime/engine.ts, src/tests/streaming-api.test.ts, src/tests/cancellation-contract.test.ts</files>
  <read_first>
    - src/runtime/coordinator.ts (lines 1116–1262 — childEvents, teedEmit, DispatchedChild registry around 1163–1183, child failure path 1212–1262 including `errorPayloadFromUnknown` and `sub-run-failed` emit, lastCostBearingEventCost usage at line 1247)
    - src/runtime/engine.ts (lines 273–301 — cancel lifecycle, closeStream, createStreamErrorEvent at line 523)
    - src/runtime/cancellation.ts (`enrichAbortErrorWithParentReason` — Phase 2 D-08 helper; understand the parent-aborted error shape)
    - .planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md (D-05, D-06; cross-cutting "D-06 race with Phase 3 D-09 sibling-failed")
    - .planning/phases/03-provider-locality-bounded-concurrency/03-CONTEXT.md (D-09 sibling-failed synthetic event constructor — mirror its shape; D-17 DispatchedChild hook)
    - .planning/phases/02-budget-cancellation-cost-rollup/02-CONTEXT.md (D-07 per-child AbortController, D-09 partialTrace contract, D-02 emptyCost / lastCostBearingEventCost)
    - src/tests/streaming-api.test.ts (existing harness)
    - src/tests/cancellation-contract.test.ts (existing parent-aborted vocabulary tests)
  </read_first>
  <behavior>
    - Test 1 (streaming-api.test.ts, STREAM-03 cancel during fan-out): Parent runs a coordinator that delegates to 3 children. Two start (in-flight), one is queued (concurrency-clamped or beyond `maxConcurrentChildren`). Mid-flight, the consumer calls `handle.cancel()`. Assert event sequence on the parent stream:
      1. Each in-flight child receives one synthetic `sub-run-failed` with `error.code: "aborted"`, `error.detail.reason: "parent-aborted"`, `partialTrace` populated from that child's accumulated `childEvents`, `partialCost` from `lastCostBearingEventCost(childEvents) ?? emptyCost()`.
      2. The queued child receives a Phase 3 D-09 `sibling-failed` synthetic `sub-run-failed` (NOT `parent-aborted`) — distinguish by `DispatchedChild.started === false`.
      3. Then a single `aborted` lifecycle event with `reason: "parent-aborted"`, `runId === parent.runId`.
      4. Then the terminal `error` event from `createStreamErrorEvent`.
    - Test 2 (streaming-api.test.ts, late-event suppression): An in-flight child's `await runProtocol` is racing to honor the abort and emits one more event AFTER the synthetic sub-run-failed has been published. Assert that late event does NOT appear on the parent stream. The closed flag on `DispatchedChild` blocks teedEmit's forward to `options.emit`. The event MAY still be persisted to the child's `childEvents` buffer (developer-side trace capture is acceptable; only live-stream forwarding is suppressed).
    - Test 3 (cancellation-contract.test.ts, parent-aborted vocabulary lock): Constructed synthetic event has `error.detail.reason === "parent-aborted"` (Phase 2 D-08 vocabulary; no new strings).
    - Test 4 (cancellation-contract.test.ts, single iteration over DispatchedChild handles both states): Programmatically construct a fan-out with both queued and started children, abort, and assert exactly one walk over DispatchedChild produces both sets of synthetic events (no double-emit, no missed children).
  </behavior>
  <action>
    **`src/runtime/coordinator.ts` — DispatchedChild closed flag:**

    Locate the `DispatchedChild` type (around lines 1163–1183 per CONTEXT). Add a mutable field:

    ```typescript
    closed: boolean;
    ```

    Initialize `closed: false` at construction.

    **Drain helper:**

    Add a helper inside the coordinator's run scope (where `DispatchedChild` registry lives):

    ```typescript
    function drainOnParentAbort(): void {
      for (const child of dispatchedChildren) {
        if (child.closed) continue;
        if (!child.started) {
          // Phase 3 D-09 sibling-failed path — preserve existing behavior; this branch
          // may already be handled by the existing fan-out short-circuit. Confirm by
          // reading current code; if the existing path covers queued children on
          // ANY parent abort (not just sibling failure), no change here.
          continue; // existing sibling-failed machinery handles queued
        }
        // In-flight child: synthesize sub-run-failed with parent-aborted reason.
        const partialTrace = [...child.childEvents]; // snapshot; child events buffer is per-child in the existing implementation — locate exact field name
        const partialCost = lastCostBearingEventCost(child.childEvents) ?? emptyCost();
        const error = enrichAbortErrorWithParentReason(
          new DogpileError({ code: "aborted", message: "Parent run aborted", detail: { reason: "parent-aborted" } }),
          { reason: "parent-aborted" },
        );
        emitSubRunFailed({
          childRunId: child.runId,
          parentDecisionId: child.parentDecisionId,
          parentDecisionArrayIndex: child.parentDecisionArrayIndex,
          error: errorPayloadFromUnknown(error),
          partialTrace,
          partialCost,
        });
        child.closed = true;
      }
    }
    ```

    Field names (`dispatchedChildren`, `child.childEvents`, `emitSubRunFailed`, etc.) MUST be matched to the existing code — read the current coordinator.ts to find the actual identifiers. The pseudo-code above mirrors Phase 3 D-09's sibling-failed constructor shape (CONTEXT: "Mirrors Phase 3 D-09's sibling-failed synthetic-event pattern (same constructor shape, different detail.reason)").

    Expose `drainOnParentAbort` to the engine — either by returning it from `runProtocol`'s setup callback, attaching it to the running coordinator's context object, or registering it via the existing engine→coordinator interaction surface. Read engine.ts:273–301 to identify the cleanest hook (likely the same surface that Phase 2 used to wire per-child controller forwarding).

    **`src/runtime/coordinator.ts` — teedEmit closed gate:**

    Update teedEmit (the same site touched in 04-01) to skip the `options.emit` forward when the originating child is closed:

    ```typescript
    const teedEmit = (event: RunEvent): void => {
      childEvents.push(event); // unchanged — D-04 isolation
      if (self.closed) return; // self here is THIS coordinator's DispatchedChild record from its parent's POV
      if (options.emit) {
        const inbound = (event as { parentRunIds?: readonly string[] }).parentRunIds;
        const wrapped = { ...event, parentRunIds: [...(inbound ?? []), self.runId] as const };
        options.emit(wrapped as RunEvent);
      }
    };
    ```

    The `self.closed` check requires the running coordinator to know its own DispatchedChild record (passed in by its parent). Trace the wiring: parent coordinator builds `DispatchedChild` for each child engine call → child engine receives this record (or a callback to read its `closed` state) via run options. If the existing API doesn't expose this, add a minimal pass-through (e.g., an `isClosed: () => boolean` callback in the child's run options). Keep the surface internal.

    **`src/runtime/engine.ts` — cancel lifecycle ordering:**

    Locate the cancel/abort path around lines 273–301 (`closeStream`, `createStreamErrorEvent`). Insert two steps BEFORE the existing terminal `error` publish:

    ```typescript
    // Step 1: drain in-flight children with synthetic sub-run-failed (parent-aborted).
    runningCoordinator?.drainOnParentAbort();

    // Step 2: emit the new aborted lifecycle event (D-15 #2).
    publish({
      type: "aborted",
      runId: parent.runId,
      at: new Date().toISOString(),
      reason: "parent-aborted",
    });

    // Step 3 (existing): terminal error event.
    publish(createStreamErrorEvent(error, lastRunId));
    closeStream();
    ```

    `runningCoordinator?.drainOnParentAbort()` is conceptual — the actual hook depends on what the engine already holds. If the engine doesn't currently retain a reference to the running coordinator, add a minimal field set in `runProtocol`'s setup phase and cleared on completion. Phase 3 D-17's `DispatchedChild` hook may already provide the needed wiring point — confirm.

    **Tests:**

    Add Tests 1–4 per `<behavior>` to `src/tests/streaming-api.test.ts` (Tests 1, 2) and `src/tests/cancellation-contract.test.ts` (Tests 3, 4). Use deterministic provider; control fan-out via the existing test harness.

    Snapshot/assert the exact event ordering from Test 1 — this is the contract.
  </action>
  <verify>
    <automated>pnpm vitest run src/tests/streaming-api.test.ts src/tests/cancellation-contract.test.ts src/tests/event-schema.test.ts src/runtime/coordinator.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "drainOnParentAbort\|parent-aborted" src/runtime/coordinator.ts` >= 2.
    - `grep -nE "type:\s*\"aborted\"" src/runtime/engine.ts` returns at least one match (the new lifecycle emit on cancel path).
    - `grep -nE "closed.*=\s*true|closed:\s*false" src/runtime/coordinator.ts` shows the DispatchedChild closed flag is initialized and set after drain.
    - `pnpm vitest run src/tests/streaming-api.test.ts -t "STREAM-03"` passes the four-step cancel ordering test.
    - `pnpm vitest run src/tests/streaming-api.test.ts -t "late-event suppression"` passes — late events from drained children do NOT appear on the parent stream.
    - `pnpm vitest run src/tests/cancellation-contract.test.ts -t "parent-aborted"` includes the synthetic sub-run-failed vocabulary lock and passes.
    - The terminal `error` event from `createStreamErrorEvent` still uses `code: "aborted"` (no regression on Phase 2 D-08 vocabulary).
    - `pnpm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    On `StreamHandle.cancel()`: in-flight children get synthetic `sub-run-failed` (parent-aborted) with partialTrace + partialCost; queued children continue to receive sibling-failed; an `aborted` lifecycle event precedes the terminal `error`; late events from drained children are suppressed at teedEmit. Single iteration over DispatchedChild handles both states. STREAM-03 contract locked.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Cover parent-aborted-after-completion (Phase 2 D-10) and the standalone aborted-as-terminal-lifecycle path</name>
  <files>src/runtime/engine.ts, src/tests/cancellation-contract.test.ts, src/tests/streaming-api.test.ts</files>
  <read_first>
    - src/runtime/engine.ts (cancel lifecycle 273–301; identify the path where parent abort fires AFTER all children have already completed)
    - .planning/phases/02-budget-cancellation-cost-rollup/02-CONTEXT.md (D-10 — parent-aborted-after-completion deferred to Phase 4)
    - .planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md (cross-cutting "D-15 #2 aborted event variant — exact placement: confirm whether aborted ALWAYS pairs with subsequent error, or whether some abort paths terminate cleanly with just aborted + final-status cancelled")
  </read_first>
  <behavior>
    - Test 1 (cancellation-contract.test.ts, parent-aborted-after-completion): Parent runs, all children complete successfully, parent then receives an explicit `cancel()` BEFORE coordinator emits `final`. Assert: zero synthetic sub-run-failed events (no in-flight children to drain); one `aborted` lifecycle event with `reason: "parent-aborted"`; terminal sequence (either an `error` event OR clean termination with status `"cancelled"` — pick the path consistent with current engine semantics for parent-abort-without-final).
    - Test 2 (streaming-api.test.ts, status reflection): `StreamHandle.status` ends in `"cancelled"` after `cancel()` resolves (Phase 2 D-10 / src/types.ts:1365 reference — the StreamHandleStatus values).
    - Test 3 (cancellation-contract.test.ts, aborted variant always parents with the same reason as the underlying abort): If abort came from `signal.abort(timeout)` propagated as a parent-budget timeout, the `aborted` event carries `reason: "timeout"`; otherwise `reason: "parent-aborted"`.
  </behavior>
  <action>
    Confirm the engine's cancel lifecycle covers the after-completion case. From the cross-cutting note in CONTEXT: "confirm whether `aborted` ALWAYS pairs with a subsequent `error`, or whether some abort paths terminate cleanly with just `aborted` + final-status `cancelled`."

    Decision rule (planner judgment, locked here):
    - If the abort fires DURING in-flight work → `aborted` precedes terminal `error` (Task 2 path).
    - If the abort fires AFTER all children complete but BEFORE coordinator emits `final` → emit `aborted` as the TERMINAL lifecycle event; the existing engine path may still emit an `error` per current semantics (an aborted parent without final is an error condition). Confirm by reading current engine.ts behavior: if today the engine emits `error` in this case, keep that — `aborted` slots in BEFORE it. If today the engine terminates cleanly, `aborted` becomes the sole terminal lifecycle marker.

    Choose ONE behavior and lock it in `cancellation-contract.test.ts` Test 1. Document the choice in the SUMMARY.

    For Test 3 (timeout vs parent-aborted reason): the `aborted` event's `reason` field MUST mirror the underlying abort's `detail.reason`. If parent timeout fires (`detail.reason: "timeout"` from Phase 2 D-08/D-13), the lifecycle event carries `reason: "timeout"`. Wire this in the publish-aborted call in engine.ts by reading the abort error's enriched reason.

    No coordinator changes in this task — engine-level only.
  </action>
  <verify>
    <automated>pnpm vitest run src/tests/cancellation-contract.test.ts src/tests/streaming-api.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `pnpm vitest run src/tests/cancellation-contract.test.ts -t "parent-aborted-after-completion"` passes Test 1.
    - `pnpm vitest run src/tests/cancellation-contract.test.ts -t "aborted.*reason.*timeout"` passes Test 3 — when the underlying abort is a timeout, the `aborted` lifecycle event carries `reason: "timeout"`.
    - `pnpm vitest run src/tests/streaming-api.test.ts -t "status.*cancelled"` passes Test 2 — final StreamHandle.status is `"cancelled"`.
    - The chosen "aborted ALWAYS or sometimes pairs with error" behavior is documented in the plan summary.
  </acceptance_criteria>
  <done>
    Phase 2 D-10's parent-aborted-after-completion observability gap is closed. The `aborted` lifecycle event semantics are fully specified: emitted on every abort path with the right `reason`, with documented terminal-pairing behavior.
  </done>
</task>

</tasks>

<verification>
- `pnpm run verify` (release gate) green at end of plan
- `grep -c "AbortedEvent\|type: \"aborted\"" src/types/events.ts src/runtime/engine.ts | awk -F: '{s+=$2} END{print s}'` >= 3 (interface + union member + emit site)
- `grep -c "drainOnParentAbort\|parent-aborted" src/runtime/coordinator.ts` >= 2
- All STREAM-03 + cancel-contract tests green
</verification>

<success_criteria>
- STREAM-03: `StreamHandle.cancel()` propagates to every in-flight child engine (Phase 2 D-07 forwarding) and emits a synthetic `sub-run-failed` with `error.code: "aborted"`, `error.detail.reason: "parent-aborted"`, partialTrace + partialCost for each in-flight child BEFORE the terminal `error` event.
- Late events from drained children are suppressed at the teedEmit boundary via `DispatchedChild.closed`.
- Queued children continue to receive Phase 3 D-09 `sibling-failed` synthetic events; the two paths coexist via single iteration over `DispatchedChild` distinguished by `started`.
- New `aborted` lifecycle event variant (D-15 #2) is locked in `event-schema.test.ts`, emitted on every abort path with `reason: "parent-aborted" | "timeout"`.
- Phase 2 D-10's parent-aborted-after-completion observability gap closes — `aborted` is emitted even when no children are in flight.
- CHANGELOG entry deferred to plan 04-04 (batched).
</success_criteria>

<output>
After completion, create `.planning/phases/04-streaming-child-error-escalation/04-02-SUMMARY.md` recording:
- DispatchedChild closed flag wiring (where it lives, who reads it)
- drainOnParentAbort hook (how engine reaches the running coordinator)
- The exact engine.ts cancel-lifecycle ordering after this plan
- The chosen behavior for "aborted-pairs-with-error vs aborted-as-sole-terminal" with one test name as the lock
- New `AbortedEvent` shape exactly as added (frozen for Phase 5 docs)
</output>
