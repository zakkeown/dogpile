---
phase: 04-streaming-child-error-escalation
plan: 04
type: execute
wave: 4
depends_on: ["04-01", "04-02", "04-03"]
files_modified:
  - src/runtime/coordinator.ts
  - src/runtime/engine.ts
  - src/runtime/cancellation.ts
  - src/runtime/replay.ts
  - src/types.ts
  - src/types/events.ts
  - src/providers/openai-compatible.ts
  - src/tests/public-error-api.test.ts
  - src/tests/cancellation-contract.test.ts
  - src/tests/event-schema.test.ts
  - CHANGELOG.md
autonomous: true
requirements: [ERROR-02, ERROR-03]
tags: [errors, timeout, public-surface, changelog]

must_haves:
  truths:
    - "On terminate-without-final-synthesis (parent ended without a `final` event AND its events array contains at least one REAL `sub-run-failed`), the parent throws the LAST real `sub-run-failed`'s error — synthetic sibling-failed (Phase 3 D-09) and synthetic parent-aborted (04-02 D-06) entries are EXCLUDED from candidate set"
    - "Runtime path: a per-run `Map<childRunId, DogpileError>` populated in the failure path BEFORE errorPayloadFromUnknown serializes the payload; the throw site re-throws the SAME instance for instance-identity preservation"
    - "Replay path: replay() reconstructs a fresh DogpileError from the serialized payload (code, providerId, detail, message); `instanceof DogpileError` holds; .stack is fresh"
    - "Map cleared on parent run termination (success OR re-throw) — no cross-run leak when callers reuse engine instances"
    - "Termination-path matrix: `final` emitted → no re-throw; budget timeout / maxIterations / maxRounds / maxCost exhausted with real failure in trace → re-throw last real failure; degenerate plan turn with real failure in trace → re-throw; explicit cancel() / signal.abort() → throw cancel error VERBATIM (D-12: cancel-wins); depth overflow → throws depth-overflow error verbatim; onChildFailure='abort' → re-throw the snapshotted triggering failure from 04-03"
    - "Three observable timeout cases: (1) provider HTTP timeout → code: 'provider-timeout', detail.source: 'provider'; (2) child engine deadline expired → code: 'provider-timeout', detail.source: 'engine'; (3) parent budget propagated to child → code: 'aborted', detail.reason: 'timeout' (already shipped in Phase 2)"
    - "detail.source is OPTIONAL and additive on provider-timeout; consumers MUST treat absence as 'provider' (backwards-compat)"
    - "classifyChildTimeoutSource(error, context) helper in cancellation.ts is the single source of truth, called from engine.ts (engine-deadline path) and coordinator.ts (coordinator-dispatch path)"
    - "OpenAI-compatible adapter (src/providers/openai-compatible.ts) sets detail.source: 'provider' on its provider-timeout emits going forward"
    - "CHANGELOG v0.4.0 batched entry lists the full Phase 1-4 public-surface inventory: delegate decision, sub-run-* events, locality, maxConcurrentChildren, maxDepth (existing) PLUS Phase 4 additions (parentRunIds chain, AbortedEvent, onChildFailure, detail.source on provider-timeout, structured coordinator-prompt failures section)"
  artifacts:
    - path: "src/runtime/coordinator.ts"
      provides: "Per-run failureInstancesByChildRunId Map<string, DogpileError> populated in the child failure path BEFORE errorPayloadFromUnknown; cleared on run completion"
      contains: "failureInstancesByChildRunId"
    - path: "src/runtime/engine.ts"
      provides: "Terminate-without-final detection and dispatch to one of: throw cancel-error-verbatim (cancel/abort path); throw last-real-failure (budget/degenerate path with failures in trace); throw depth-overflow verbatim; throw triggering-failure-from-abort-mode (04-03 hand-off); no throw (success final emitted)"
      contains: "terminate-without-final"
    - path: "src/runtime/cancellation.ts"
      provides: "classifyChildTimeoutSource(error, { decisionTimeoutMs?, engineDefaultTimeoutMs?, isProviderError }): 'provider' | 'engine' helper, callable from engine + coordinator paths"
      contains: "classifyChildTimeoutSource"
    - path: "src/runtime/replay.ts"
      provides: "Replay reconstructs DogpileError from serialized payload at the throw boundary (code, providerId, detail, message); instanceof DogpileError holds"
      contains: "DogpileError"
    - path: "src/types/events.ts"
      provides: "Optional readonly source?: 'provider' | 'engine' on the provider-timeout error detail shape (backwards-compat: absent === 'provider')"
      contains: "source"
    - path: "src/providers/openai-compatible.ts"
      provides: "Existing provider-timeout emits gain detail.source: 'provider'"
      contains: "source: \"provider\""
    - path: "src/tests/public-error-api.test.ts"
      provides: "ERROR-02 termination matrix locks: success final → no throw; budget exhausted with two real failures + one synthetic → throws F2 (last real); cancel-during-fan-out → throws cancel error verbatim, NOT child failure; depth-overflow → throws depth-overflow verbatim; onChildFailure='abort' with two failures F1+F2 → throws F1 (snapshotted triggering, not last); runtime instance identity (same DogpileError object thrown); replay payload equality + instanceof DogpileError"
    - path: "src/tests/cancellation-contract.test.ts"
      provides: "ERROR-03 timeout discrimination locks: provider-timeout with detail.source: 'provider' (OpenAI-compatible adapter); provider-timeout with detail.source: 'engine' (child engine deadline); aborted with detail.reason: 'timeout' (parent budget propagation); absence of detail.source parses as 'provider' (backwards-compat); classifyChildTimeoutSource unit tests"
    - path: "CHANGELOG.md"
      provides: "Single batched v0.4.0 entry listing the Phase 1-4 public-surface inventory (D-15 #5 wrap-up)"
  key_links:
    - from: "coordinator.ts child failure path (~line 1244)"
      to: "failureInstancesByChildRunId.set(childRunId, originalDogpileError)"
      via: "BEFORE errorPayloadFromUnknown serializes"
      pattern: "failureInstancesByChildRunId"
    - from: "engine.ts terminate-without-final detection"
      to: "throw site"
      via: "discriminator: cancel? → cancel error; abort-mode triggering snapshot? → that failure; budget/degenerate with real failures? → last real failure from Map; else success/depth-overflow"
      pattern: "terminate"
    - from: "engine.ts engine-deadline path AND coordinator.ts dispatch failure path"
      to: "classifyChildTimeoutSource"
      via: "both layers call the helper for source discrimination"
      pattern: "classifyChildTimeoutSource"
    - from: "src/providers/openai-compatible.ts provider-timeout emit"
      to: "detail.source: 'provider'"
      via: "additive field on existing emit"
      pattern: "source:\\s*\"provider\""
---

<objective>
Land ERROR-02 + ERROR-03 — the most consequential plan in Phase 4. Implement:

- **D-10 (last-failure throw):** parent throws the LAST real `sub-run-failed`'s error on terminate-without-final-synthesis; synthetic failures (Phase 3 D-09 sibling-failed, 04-02 D-06 parent-aborted) are excluded from the candidate set.
- **D-11 (instance-keyed Map + replay reconstruct):** runtime path holds `Map<childRunId, DogpileError>` so the SAME instance is re-thrown (preserving identity, .stack); replay path reconstructs from serialized payload (`instanceof DogpileError` still holds; .stack is fresh).
- **D-12 (cancel-wins precedence):** explicit cancel/abort throws the cancel error verbatim; child failures are NOT escalated past a cancel. Depth-overflow throws its own error. `onChildFailure: "abort"` re-throws the triggering failure snapshotted by 04-03.
- **D-13 (timeout discrimination):** provider-timeout errors gain optional `detail.source?: "provider" | "engine"`. Three observable cases locked.
- **D-14 (`classifyChildTimeoutSource` helper):** single source of truth in `cancellation.ts`, callable from engine + coordinator layers.

Plus the phase-wrap CHANGELOG v0.4.0 entry (D-15 #5; matches Phase 2 D-20 / Phase 3 D-18 batched discipline).

Note: D-15 #2 (the new `aborted` lifecycle event variant) was lifted into 04-02 per CONTEXT D-17's planner-judgment note — it is NOT re-implemented here. This plan only touches it through tests if needed.

Purpose: callers see deterministic, debuggable terminal errors. Cancel always means cancel. Budget-exhausted with failures means the last failure (the one closest to the termination decision). Provider timeouts vs engine timeouts vs parent-budget timeouts are all distinguishable.

Output: failure Map + throw matrix in coordinator/engine; classifier helper in cancellation.ts; replay reconstruct path; OpenAI adapter discriminator; comprehensive ERROR-02 + ERROR-03 test locks; CHANGELOG.
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
@.planning/phases/04-streaming-child-error-escalation/04-02-cancel-propagation-PLAN.md
@.planning/phases/04-streaming-child-error-escalation/04-03-coordinator-failure-context-PLAN.md
@.planning/phases/02-budget-cancellation-cost-rollup/02-CONTEXT.md
@CLAUDE.md
@CHANGELOG.md
@src/runtime/coordinator.ts
@src/runtime/engine.ts
@src/runtime/cancellation.ts
@src/runtime/replay.ts
@src/providers/openai-compatible.ts
@src/types.ts
@src/types/events.ts

<interfaces>
<!-- Existing DogpileError shape (already public). Confirm fields by reading src/runtime/errors.ts or wherever DogpileError lives. -->
```typescript
export class DogpileError extends Error {
  readonly code: string;
  readonly providerId?: string;
  readonly detail?: Record<string, unknown>;
  // ...
}
```

<!-- New optional discriminator on provider-timeout detail (D-13). -->
```typescript
// On any provider-timeout DogpileError:
//   detail?: { source?: "provider" | "engine"; ... };
// Absence === "provider" for backwards compat.
```

<!-- New helper in cancellation.ts (D-14). -->
```typescript
export function classifyChildTimeoutSource(
  error: unknown,
  context: {
    readonly decisionTimeoutMs?: number;
    readonly engineDefaultTimeoutMs?: number;
    readonly isProviderError: boolean;
  },
): "provider" | "engine";
```

<!-- Termination-path discrimination (D-12 matrix). -->
//
//   coordinator emits final → no re-throw (happy path)
//   parent.signal.abort() / StreamHandle.cancel() → throw the cancel error verbatim
//                                                   (existing aborted + detail.reason: "parent-aborted")
//   onChildFailure: "abort" → throw runtimeContext.triggeringFailureForAbortMode (04-03 hand-off)
//   depth overflow at dispatch → throws depth-overflow error verbatim (already its own well-defined error)
//   budget timeout / maxIterations / maxRounds / maxCost exhausted, real failure in trace
//                          → throw last real failure (instance from failureInstancesByChildRunId Map)
//   degenerate plan turn, real failure in trace → throw last real failure
//   degenerate plan turn, no real failure → existing degenerate-turn error (unchanged)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Populate failureInstancesByChildRunId Map in coordinator failure path; expose to engine for throw decision</name>
  <files>src/runtime/coordinator.ts, src/runtime/engine.ts</files>
  <read_first>
    - src/runtime/coordinator.ts (lines 1212–1262 — child failure path; locate `errorPayloadFromUnknown` call site at ~1244 per CONTEXT)
    - src/runtime/engine.ts (terminate-without-final detection; success/error path around line 273+)
    - .planning/phases/04-streaming-child-error-escalation/04-03-coordinator-failure-context-PLAN.md (Task 2 — confirm exact field name used for the abort-mode triggering snapshot)
    - .planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md (D-10, D-11; cross-cutting "D-11 memory bound")
  </read_first>
  <behavior>
    - Test 1 (coordinator-internal, white-box if needed): a real child failure populates `failureInstancesByChildRunId.get(childRunId)` with the SAME `DogpileError` instance the child engine threw (object identity via `===`).
    - Test 2: synthetic failures (Phase 3 D-09 sibling-failed and 04-02 D-06 parent-aborted) do NOT populate the Map. They are excluded from the candidate set for ERROR-02 throws.
    - Test 3: After the parent run terminates (success OR throw), the Map is cleared on the runtime context — running the same engine instance again starts with an empty Map.
  </behavior>
  <action>
    **Per-run runtime context field (`src/runtime/coordinator.ts` or wherever per-run runtime context lives — Phase 2 cost accumulators / Phase 3 D-12 clamp-emit flag are siblings):**

    Add:

    ```typescript
    const failureInstancesByChildRunId = new Map<string, DogpileError>();
    ```

    Place this in the same scope as Phase 2's cost accumulators (per-run, NOT per-engine-instance — clearing happens automatically on run boundary).

    **Population (coordinator.ts:~1244, BEFORE `errorPayloadFromUnknown`):**

    Locate the child failure path. The current code shape (approximate):

    ```typescript
    } catch (childError) {
      const errorPayload = errorPayloadFromUnknown(childError);
      // ... emit sub-run-failed with errorPayload
    }
    ```

    Insert BEFORE `errorPayloadFromUnknown`:

    ```typescript
    if (childError instanceof DogpileError) {
      failureInstancesByChildRunId.set(childRunId, childError);
    }
    ```

    Only real `DogpileError` instances are stored. Non-DogpileError throws (which `errorPayloadFromUnknown` wraps) do NOT populate the Map — those callers receive the wrapped error on re-throw, not the original (which wasn't a DogpileError to begin with).

    **Synthetic exclusion:**

    The synthetic-failure paths from Phase 3 D-09 and 04-02 D-06 do NOT pass through this `catch` block — they construct synthetic `sub-run-failed` payloads directly. As long as the Map population is at the real-throw catch site, synthetics are excluded by construction. Verify by tracing the synthetic emit sites: they should NOT touch this Map.

    **Engine read access:**

    Expose the Map (or a getter) to the engine layer so the throw site can look up the last real failure. Add to the runtime context object (the same one the engine already accesses for cost rollup, etc.). Likely path:

    ```typescript
    // engine.ts — terminate-without-final block:
    const lastRealFailure = getLastRealFailureForCurrentRun(runtimeContext);
    ```

    Where `getLastRealFailureForCurrentRun` walks `parent.events` in reverse, finds the most recent `sub-run-failed` whose `childRunId` is a key in `failureInstancesByChildRunId`, and returns the Map value. This implementation choice (walk events vs maintain insertion-order) is locked: walking events ensures we honor "last in event-array order" per D-10's tightened wording.

    **Cleanup:**

    The Map lives in per-run scope, so it is freed when the run scope ends. Confirm by reading the existing per-run lifetime — if the runtime context is held on an engine-instance field that survives across runs, explicitly clear the Map on run termination (success OR throw). Cross-cutting "D-11 memory bound": the Map is bounded by `MAX_DISPATCH_PER_TURN (8) × turns × maxDepth (4)` — small. No eviction needed within a run.

    **No tests in this task** — Task 4's `public-error-api.test.ts` end-to-end suite covers the integration. Optionally add a coordinator-internal test if the engine read-path needs isolation.
  </action>
  <verify>
    <automated>pnpm run typecheck && pnpm vitest run src/runtime/coordinator.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "failureInstancesByChildRunId" src/runtime/coordinator.ts` >= 2 (declaration + population).
    - `grep -nE "failureInstancesByChildRunId\\.set" src/runtime/coordinator.ts` shows the population call placed BEFORE the line containing `errorPayloadFromUnknown` in the same `catch` block.
    - Population is gated on `instanceof DogpileError` — `grep -nE "instanceof DogpileError" src/runtime/coordinator.ts` shows the gate near the Map.set.
    - Synthetic emit sites (sibling-failed from Phase 3 D-09; parent-aborted from 04-02 D-06) do NOT populate the Map (visual inspection — no `failureInstancesByChildRunId.set` near those construction sites).
    - `pnpm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    Per-run Map captures real DogpileError instances by childRunId; synthetic failures are excluded by construction; cleanup is automatic via per-run scope.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement terminate-without-final throw matrix in engine.ts and replay reconstruct path</name>
  <files>src/runtime/engine.ts, src/runtime/replay.ts, src/runtime/coordinator.ts, src/tests/public-error-api.test.ts</files>
  <read_first>
    - src/runtime/engine.ts (run lifecycle; success path; existing aborted-throw at ~line 293; depth-overflow path)
    - src/runtime/replay.ts (entire file — replay's terminal handling; locate where replay throws on a re-walked failure)
    - src/runtime/errors.ts (or wherever DogpileError lives — confirm the constructor signature for replay reconstruction)
    - .planning/phases/04-streaming-child-error-escalation/04-03-coordinator-failure-context-PLAN.md (locate exact field name for abort-mode triggering snapshot — `triggeringFailureForAbortMode` per Plan 04-03 Task 2)
    - .planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md (D-10, D-11, D-12; cross-cutting D-12 vs D-09 vs cancel three-way precedence)
    - src/tests/public-error-api.test.ts (existing test patterns)
  </read_first>
  <behavior>
    - Test 1 (public-error-api.test.ts, success path): coordinator emits `final` → run completes; no throw.
    - Test 2 (public-error-api.test.ts, last-real-failure on budget exhaustion): build a scenario with two REAL failures F1, F2 and one synthetic sibling-failed S in the trace. Force termination via budget exhaustion (e.g. `maxCost`). Assert the thrown error matches F2's payload AND `===` the original F2 instance (instance identity).
    - Test 3 (public-error-api.test.ts, cancel-wins): in-flight run, child fails, then `handle.cancel()` fires. Assert the thrown error is the cancel error (`code: "aborted"`, `detail.reason: "parent-aborted"`) — NOT the child failure. D-12 cross-cutting three-way precedence.
    - Test 4 (public-error-api.test.ts, depth overflow): construct a delegate at depth N+1. Assert the thrown error is the existing depth-overflow error VERBATIM (`code: "invalid-configuration"`, `detail.kind: "delegate-validation"`, `detail.reason: "depth-overflow"`) — NOT escalated as a child failure.
    - Test 5 (public-error-api.test.ts, onChildFailure='abort' with two failures): F1 fires first; F2 fires before short-circuit lands. Assert the thrown error matches F1 (the snapshotted triggering failure from 04-03), NOT F2 (which would be "last in event-array order" if we used D-10's rule). Cross-cutting D-09 interaction.
    - Test 6 (public-error-api.test.ts, replay payload equality + instanceof): capture a trace from Test 2's scenario; pass to `replay()`; assert `replay()` throws an error that is `instanceof DogpileError`, has `code === F2.code`, `providerId === F2.providerId`, deep-equal `detail`, and `message === F2.message`. NOTE: it is NOT `===` the original instance — replay reconstructs.
    - Test 7 (public-error-api.test.ts, runtime instance identity): the runtime path's thrown error from Test 2 IS `===` the original DogpileError instance the child engine threw (D-11 instance preservation).
    - Test 8 (public-error-api.test.ts, degenerate plan turn with real failure): coordinator returned no decision after a wave with a real failure. Assert the thrown error is the last real failure (D-12: degenerate-plan-turn termination treated like budget — re-throw).
    - Test 9 (public-error-api.test.ts, degenerate plan turn with NO failures): coordinator returned no decision, no failures. Assert the existing degenerate-turn error fires (unchanged behavior — no regression).
  </behavior>
  <action>
    **`src/runtime/engine.ts` — terminate-without-final dispatcher:**

    Locate the engine's terminal-decision site. There is currently a path that determines whether to throw, and what to throw. Restructure into an explicit precedence chain (D-12 matrix):

    ```typescript
    function resolveTerminalThrow(
      runtimeContext: RuntimeContext,
      reason: TerminationReason,
      events: readonly RunEvent[],
      cancelError: DogpileError | null,
    ): DogpileError | null {
      // Precedence (highest first):
      // 1. Explicit cancel/abort wins.
      if (cancelError) return cancelError;

      // 2. Depth overflow throws its own error verbatim — already handled at
      //    dispatch site, but re-confirm here that we don't second-guess it.
      if (reason === "depth-overflow") return /* whatever the existing path constructs */;

      // 3. Coordinator emitted final → success, no throw.
      if (reason === "final-emitted") return null;

      // 4. onChildFailure='abort' triggered: re-throw the snapshotted triggering failure.
      if (reason === "on-child-failure-abort") {
        return runtimeContext.triggeringFailureForAbortMode ?? /* fallback to last-real */ null;
      }

      // 5. Budget / degenerate-plan-turn with at least one real failure → last real.
      if (reason === "budget-exhausted" || reason === "degenerate-plan-turn") {
        const last = findLastRealFailure(events, runtimeContext.failureInstancesByChildRunId);
        if (last) return last;
        // Degenerate-plan-turn with no real failure: fall through to existing degenerate error.
      }

      // 6. Existing degenerate-plan-turn error (unchanged).
      if (reason === "degenerate-plan-turn") return /* existing error */;

      return null;
    }

    function findLastRealFailure(
      events: readonly RunEvent[],
      map: ReadonlyMap<string, DogpileError>,
    ): DogpileError | null {
      // Walk events in REVERSE; find the most recent sub-run-failed whose childRunId is a Map key.
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.type === "sub-run-failed") {
          const instance = map.get(ev.childRunId);
          if (instance) return instance; // synthetic failures aren't in the Map → automatically excluded.
        }
      }
      return null;
    }
    ```

    The exact identifier names for `runtimeContext`, `cancelError`, `reason`, etc. MUST match the existing engine code. Read engine.ts to find the actual structure — the above is shape-only.

    Existing aborted-throw path (line ~293 per CONTEXT) becomes the `cancelError` argument source. Existing depth-overflow path stays where it is.

    **Wire `triggeringFailureForAbortMode` consumption:**

    04-03's coordinator stores the snapshot when `onChildFailure: "abort"` short-circuits. Engine reads from the same runtime context. Confirm field name by reading 04-03's implementation post-execution.

    **`src/runtime/replay.ts` — reconstruct path:**

    Replay walks a recorded trace and decides whether to throw at the end. Locate the terminal-throw decision in replay.ts (likely near where replay builds the final RunResult). Replicate the same precedence matrix using the SERIALIZED error payloads on `sub-run-failed` events:

    ```typescript
    function reconstructLastRealFailure(events: readonly RunEvent[]): DogpileError | null {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.type === "sub-run-failed") {
          // Synthetic detection: detail.reason === "sibling-failed" (Phase 3 D-09)
          //                  or detail.reason === "parent-aborted" (04-02 D-06)
          // → exclude (these are bookkeeping, not real causes).
          const reason = ev.error?.detail?.reason;
          if (reason === "sibling-failed" || reason === "parent-aborted") continue;
          return new DogpileError({
            code: ev.error.code,
            message: ev.error.message,
            providerId: ev.error.providerId,
            detail: ev.error.detail,
          });
        }
      }
      return null;
    }
    ```

    `instanceof DogpileError` holds; `.stack` is fresh (no original instance to preserve in replay).

    **Tests (`src/tests/public-error-api.test.ts`):**

    Add Tests 1–9 per `<behavior>`. The test fixtures should construct deterministic scenarios using the test harness; for Test 5 (abort-mode triggering), exercise 04-03's short-circuit hand-off explicitly.

    For Test 7 (instance identity), the test must observe `thrownError === originalDogpileError` where `originalDogpileError` is the instance the child engine's `throw` statement raised. This requires a test harness that can inject a known DogpileError into the child engine's run path.
  </action>
  <verify>
    <automated>pnpm vitest run src/tests/public-error-api.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "findLastRealFailure|reconstructLastRealFailure" src/runtime/engine.ts src/runtime/replay.ts | wc -l` >= 2.
    - `grep -nE "triggeringFailureForAbortMode" src/runtime/engine.ts` >= 1 (engine reads the snapshot).
    - `grep -nE "sibling-failed|parent-aborted" src/runtime/replay.ts` shows replay's synthetic-exclusion logic.
    - `pnpm vitest run src/tests/public-error-api.test.ts -t "success path"` passes Test 1.
    - `pnpm vitest run src/tests/public-error-api.test.ts -t "last real failure"` passes Tests 2 + 7 (payload + instance identity).
    - `pnpm vitest run src/tests/public-error-api.test.ts -t "cancel-wins|cancel.*verbatim"` passes Test 3.
    - `pnpm vitest run src/tests/public-error-api.test.ts -t "depth.*overflow.*verbatim"` passes Test 4.
    - `pnpm vitest run src/tests/public-error-api.test.ts -t "abort.*triggering.*F1|onChildFailure.*abort"` passes Test 5.
    - `pnpm vitest run src/tests/public-error-api.test.ts -t "replay.*instanceof|replay.*payload"` passes Test 6.
    - `pnpm vitest run src/tests/public-error-api.test.ts -t "degenerate"` passes Tests 8 + 9.
  </acceptance_criteria>
  <done>
    Termination-throw matrix is implemented end-to-end: cancel wins, abort-mode hand-off honored, last-real-failure on budget/degenerate, depth-overflow verbatim, replay reconstructs with instanceof + payload equality. ERROR-02 fully locked.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Add classifyChildTimeoutSource helper, detail.source on provider-timeout, and OpenAI-compatible adapter wiring</name>
  <files>src/runtime/cancellation.ts, src/runtime/engine.ts, src/runtime/coordinator.ts, src/types/events.ts, src/types.ts, src/providers/openai-compatible.ts, src/tests/cancellation-contract.test.ts, src/tests/event-schema.test.ts</files>
  <read_first>
    - src/runtime/cancellation.ts (existing `enrichAbortErrorWithParentReason` Phase 2 D-08 helper — mirror its shape)
    - src/runtime/engine.ts (engine deadline path — locate where the child engine's own timeout fires before emitting the terminal error)
    - src/runtime/coordinator.ts (coordinator dispatch path — failure path at ~1244 where provider-timeout from child runProtocol rejection is handled)
    - src/providers/openai-compatible.ts (existing provider-timeout emit site — find by grepping for "provider-timeout" or timeout error construction)
    - src/types/events.ts (DogpileError detail shape — check if there's a discriminated detail union or a generic record)
    - src/tests/cancellation-contract.test.ts (existing timeout-contract test patterns from Phase 2)
    - .planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md (D-13, D-14; cross-cutting "D-13 backwards-compat for provider-timeout")
    - .planning/phases/02-budget-cancellation-cost-rollup/02-CONTEXT.md (D-08/D-13 — existing parent-aborted+timeout vocabulary)
  </read_first>
  <behavior>
    - Test 1 (cancellation-contract.test.ts, provider HTTP timeout): a provider's HTTP/SDK call times out (simulated via the OpenAI-compatible adapter or test harness). Resulting DogpileError has `code: "provider-timeout"` and `detail.source: "provider"`.
    - Test 2 (cancellation-contract.test.ts, child engine deadline): a child engine's own `defaultSubRunTimeoutMs` (or decision-supplied timeout) fires BEFORE the provider call resolves. Resulting DogpileError has `code: "provider-timeout"` and `detail.source: "engine"`.
    - Test 3 (cancellation-contract.test.ts, parent-budget propagation): parent's deadline propagates to child via Phase 2 D-11 `parentDeadlineMs - now`. Resulting DogpileError has `code: "aborted"` and `detail.reason: "timeout"` (Phase 2 D-08/D-13 — already shipped). NO change to this case; lock it as part of the three-case discrimination.
    - Test 4 (cancellation-contract.test.ts, backwards-compat): a fixture provider-timeout error WITHOUT `detail.source` parses through consumer code as if `source === "provider"`. The contract assertion: a switch on `detail.source ?? "provider"` correctly classifies absence as provider.
    - Test 5 (cancellation-contract.test.ts, classifyChildTimeoutSource unit): direct unit test of the helper. (a) `isProviderError: true`, no engine timeout context → "provider". (b) `isProviderError: false`, `engineDefaultTimeoutMs` set, error matches engine deadline → "engine". (c) Mixed cases per the helper's spec.
    - Test 6 (event-schema.test.ts, optional source field): public-surface lock that `detail.source?: "provider" | "engine"` is recognized on provider-timeout DogpileError shapes; other error codes are unaffected.
  </behavior>
  <action>
    **Public type (`src/types/events.ts` and/or `src/types.ts` — wherever DogpileError detail shapes are documented):**

    Document the optional `detail.source?: "provider" | "engine"` discriminator. If detail is currently a generic `Record<string, unknown>`, consider adding a typed discriminator for `provider-timeout` shapes:

    ```typescript
    // Provider-timeout error detail shape (additive; backwards-compat: source absent === "provider").
    interface ProviderTimeoutDetail {
      readonly source?: "provider" | "engine";
      // ... existing fields preserved
    }
    ```

    If the project does not currently maintain typed-detail shapes per code (likely — DogpileError has a generic detail field), instead add JSDoc on the relevant types and a constant string-literal helper. The exact integration depends on project convention — read `src/runtime/errors.ts` (or wherever DogpileError is defined) to choose.

    **`src/runtime/cancellation.ts` — classifyChildTimeoutSource helper (D-14):**

    Add the helper:

    ```typescript
    export function classifyChildTimeoutSource(
      error: unknown,
      context: {
        readonly decisionTimeoutMs?: number;
        readonly engineDefaultTimeoutMs?: number;
        readonly isProviderError: boolean;
      },
    ): "provider" | "engine" {
      // If the error was raised by the upstream provider call → "provider".
      if (context.isProviderError) return "provider";
      // Otherwise the child engine's own deadline fired → "engine".
      // Engine-deadline detection: a timeout occurred AND a decision/engine-default timeout
      // was active at the time of the failure.
      if (context.decisionTimeoutMs !== undefined || context.engineDefaultTimeoutMs !== undefined) {
        return "engine";
      }
      // Default fall-through: treat as provider for backwards-compat (consistent with
      // CONTEXT D-13: "Absence is interpreted as 'provider' for any consumer that switches on it").
      return "provider";
    }
    ```

    Mirror the placement of `enrichAbortErrorWithParentReason` (also in cancellation.ts). Export from the same surface.

    **Engine path call site (`src/runtime/engine.ts`):**

    When a child engine's own deadline fires (the engine's internal timeout, not the provider's), call `classifyChildTimeoutSource` with `isProviderError: false` and the relevant timeout context. Set the resulting `source` on the emitted error's `detail`:

    ```typescript
    const source = classifyChildTimeoutSource(rawError, {
      decisionTimeoutMs: decision?.timeoutMs,
      engineDefaultTimeoutMs: defaults.defaultSubRunTimeoutMs,
      isProviderError: false,
    });
    const enriched = new DogpileError({
      code: "provider-timeout",
      message: rawError.message,
      detail: { ...rawError.detail, source },
    });
    ```

    Locate the existing engine-deadline emit site (search for `provider-timeout` construction in engine.ts or for the deadline-fire path).

    **Coordinator path call site (`src/runtime/coordinator.ts`):**

    When a child's `runProtocol` rejects with a `provider-timeout` rooted in the upstream provider call, classify with `isProviderError: true` and stamp `source: "provider"` on the error before emitting `sub-run-failed`. This may be a re-stamp if the child engine already classified — confirm the layered behavior preserves the inner classification rather than overwriting (the inner engine knows whether the timeout was its own deadline or a provider call; the coordinator should defer to that classification).

    Implementation rule: if the incoming error already has `detail.source` set, leave it. Only set if absent.

    **OpenAI-compatible adapter (`src/providers/openai-compatible.ts`):**

    Existing provider-timeout emit sites (search for `provider-timeout` or `code: "provider-timeout"`) gain `detail.source: "provider"`:

    ```typescript
    throw new DogpileError({
      code: "provider-timeout",
      message: /* existing message */,
      providerId: /* existing providerId */,
      detail: {
        // ... existing detail fields
        source: "provider",
      },
    });
    ```

    Backwards-compat: consumers reading old fixtures must treat absence as `"provider"`. Lock this in Test 4.

    **Tests:**

    Add Tests 1–5 to `src/tests/cancellation-contract.test.ts`. Add Test 6 to `src/tests/event-schema.test.ts`.

    For Tests 1–3, use the deterministic provider with controlled timeout behavior, or the OpenAI-compatible adapter with a stubbed-out HTTP layer. Test 5 unit-tests the helper directly.
  </action>
  <verify>
    <automated>pnpm vitest run src/tests/cancellation-contract.test.ts src/tests/event-schema.test.ts && pnpm run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "classifyChildTimeoutSource" src/runtime/cancellation.ts` >= 1 (declaration + export).
    - `grep -c "classifyChildTimeoutSource" src/runtime/engine.ts src/runtime/coordinator.ts` >= 2 (call sites in both layers).
    - `grep -nE "source:\\s*\"provider\"" src/providers/openai-compatible.ts` shows the adapter sets the field.
    - `pnpm vitest run src/tests/cancellation-contract.test.ts -t "provider.*timeout.*source"` passes Tests 1 + 2 + 4.
    - `pnpm vitest run src/tests/cancellation-contract.test.ts -t "parent-budget.*timeout|aborted.*timeout"` passes Test 3.
    - `pnpm vitest run src/tests/cancellation-contract.test.ts -t "classifyChildTimeoutSource"` passes Test 5 (unit).
    - `pnpm vitest run src/tests/event-schema.test.ts -t "provider-timeout.*source"` passes Test 6.
    - `pnpm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    Three observable timeout cases are distinguishable via `code` + `detail.source`: provider HTTP, engine deadline, parent-budget. Helper is single source of truth, called from both engine and coordinator. OpenAI-compatible adapter ships the discriminator. Backwards-compat assured. ERROR-03 fully locked.
  </done>
</task>

<task type="auto">
  <name>Task 4: Write the v0.4.0 CHANGELOG entry (batched Phase 1-4 public-surface inventory)</name>
  <files>CHANGELOG.md</files>
  <read_first>
    - CHANGELOG.md (existing v0.3.x entries — match the formatting and section structure exactly)
    - .planning/phases/03-provider-locality-bounded-concurrency/03-CONTEXT.md (D-18 — Phase 3 wrap-up; current CHANGELOG already includes the Phase 1-3 inventory per STATE.md)
    - .planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md (D-15 inventory; cross-cutting list)
    - .planning/phases/04-streaming-child-error-escalation/04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md (after they're written by prior plans — confirm exact final shapes for the CHANGELOG)
  </read_first>
  <behavior>
    - The CHANGELOG v0.4.0 entry is a single batched section listing the full Phase 1-4 public-surface inventory.
    - All five D-15 items appear with one-line descriptions: (1) `parentRunIds` chain on stream events; (2) new `aborted` lifecycle event variant; (3) `onChildFailure?: "continue" | "abort"` config; (4) optional `detail.source?: "provider" | "engine"` on `provider-timeout` errors; (5) coordinator prompt now includes structured failure roster.
    - Plus inherited Phase 1-3 items (delegate decision, sub-run-* events, locality, maxConcurrentChildren, maxDepth) — these are likely already in CHANGELOG per STATE.md Phase 3 D-18, so confirm and consolidate rather than duplicate.
    - Includes the D-10 wording note: "original DogpileError unwrapped" means "the child's own thrown DogpileError, not a wrapper" — NOT "the first one chronologically" — to avoid spec-drift confusion (CONTEXT D-10).
  </behavior>
  <action>
    Open `CHANGELOG.md`. The current state (per STATE.md Phase 3 D-18) likely has v0.4.0 entries already including the Phase 1-3 inventory. Append (or merge into the existing v0.4.0 section) the Phase 4 additions:

    ```markdown
    ## [0.4.0] — UNRELEASED

    ### Added (Phase 4 — streaming + error escalation)

    - **`parentRunIds: readonly string[]` on stream events.** Every variant in `StreamLifecycleEvent` and `StreamOutputEvent` accepts an optional ancestry chain (root → ... → immediate-parent). Set on the live parent stream when child events bubble through `teedEmit`; NOT persisted in `RunResult.events` (the trace stays chain-free, per the trace/stream isolation contract). `replay()` reconstructs the chain at the bubbling boundary so replay-from-stream sees the same ancestry as live runs.
    - **New `aborted` lifecycle event.** Top-level `StreamLifecycleEvent` variant `{ type: "aborted", runId, at, reason: "parent-aborted" | "timeout", detail? }`. Emitted on the parent stream BEFORE the terminal `error` event on cancel/abort. Closes the parent-aborted-after-completion observability gap (no in-flight children to drain, but consumers still see a terminal lifecycle marker).
    - **`onChildFailure?: "continue" | "abort"` config option.** Engine-level + per-run option; default `"continue"` preserves spec behavior. `"abort"` short-circuits the next plan turn after the first real child failure and re-throws that failure (snapshotted at the abort moment, NOT walked from the trace at terminate time).
    - **Optional `detail.source?: "provider" | "engine"` on `provider-timeout` errors.** Discriminates upstream provider HTTP timeout from a child engine's own deadline expiring. Backwards-compat: absence is interpreted as `"provider"`. Set going forward by the OpenAI-compatible adapter (`"provider"`) and the child-engine deadline path (`"engine"`). Parent-budget propagation continues to surface as `code: "aborted"`, `detail.reason: "timeout"` (unchanged from v0.3.x).
    - **Coordinator prompt now includes a structured `## Sub-run failures since last decision` JSON block.** Lists real (non-synthetic) child failures from the most recent dispatch wave with `{ childRunId, intent, error: { code, message, detail.reason? }, partialCost: { usd } }`. `partialTrace` is intentionally excluded from the prompt (still available on `sub-run-failed.partialTrace` for developers/replay). Empty waves omit the section entirely. Observable to LLM determinism — fixture comparison may need rebaselining.
    - **Cancel-during-fan-out drain.** On `StreamHandle.cancel()`, every in-flight child receives a synthetic `sub-run-failed` with `error.code: "aborted"`, `error.detail.reason: "parent-aborted"`, `partialTrace`, and `partialCost` BEFORE the terminal `error` event. Late events from drained children are suppressed at the parent stream boundary.

    ### Changed

    - **Terminate-without-final throw rule clarified.** "Original DogpileError unwrapped" (per ROADMAP) means "the child's own thrown `DogpileError`, not a wrapper" — NOT "the first one chronologically." Parent re-throws the LAST REAL `sub-run-failed`'s instance (synthetic sibling-failed and parent-aborted entries excluded). Explicit cancel/abort always wins and throws the cancel error verbatim — child failures are never escalated past a cancel.

    ### Notes

    - `package-exports.test.ts` is unchanged: every Phase 4 addition rides existing top-level union exports (`StreamEvent`, `RunEvent`, `EngineOptions`, `RunCallOptions`).
    - `package.json` `files` allowlist: no change.
    ```

    Match existing CHANGELOG header style (date format, capitalization). If the file already has a `## [0.4.0]` section from Phase 3 D-18, MERGE these additions into the existing structure rather than duplicating the heading.

    No tests for this task — `pnpm run verify` includes the changelog in the release gate; manual review confirms the inventory matches D-15.
  </action>
  <verify>
    <automated>grep -c "parentRunIds\|aborted lifecycle\|onChildFailure\|detail.source\|Sub-run failures since last decision" CHANGELOG.md</automated>
  </verify>
  <acceptance_criteria>
    - Output of the verify grep is >= 5 (one match per D-15 item).
    - `grep -c "0.4.0" CHANGELOG.md` shows exactly one v0.4.0 section header (no duplication).
    - The "original DogpileError unwrapped" clarification (D-10 wording note) appears in the CHANGELOG.
    - The Phase 1-3 inventory (delegate, sub-run-*, locality, maxConcurrentChildren, maxDepth) is preserved (visual review — pre-existing entries should not be removed).
  </acceptance_criteria>
  <done>
    Single batched v0.4.0 CHANGELOG entry covers the Phase 1-4 public-surface inventory per D-15 #5 wrap-up discipline.
  </done>
</task>

</tasks>

<verification>
- `pnpm run verify` (release gate: identity → build → artifact check → packed quickstart smoke → typecheck → test) green
- `pnpm vitest run src/tests/public-error-api.test.ts src/tests/cancellation-contract.test.ts src/tests/event-schema.test.ts src/tests/result-contract.test.ts src/tests/streaming-api.test.ts src/tests/config-validation.test.ts src/runtime/coordinator.test.ts` all green
- `grep -c "classifyChildTimeoutSource" src/runtime/cancellation.ts src/runtime/engine.ts src/runtime/coordinator.ts | awk -F: '{s+=$2} END{print s}'` >= 3
- CHANGELOG v0.4.0 entry contains all five D-15 items
</verification>

<success_criteria>
- ERROR-02: parent throws the LAST real `sub-run-failed`'s error on terminate-without-final-synthesis (budget / degenerate plan turn). Cancel always wins. Depth-overflow throws verbatim. `onChildFailure: "abort"` re-throws the snapshotted triggering failure. Runtime path preserves instance identity (Map<childRunId, DogpileError>); replay reconstructs from payload (`instanceof DogpileError` holds; `.stack` fresh).
- ERROR-03: provider-timeout vs engine-deadline vs parent-budget timeouts are distinguishable via `code` + `detail.source` (with backwards-compat). Single `classifyChildTimeoutSource` helper used by both engine and coordinator layers.
- D-15 #5: CHANGELOG v0.4.0 batched entry locked.
- Phase 4 success criteria from ROADMAP.md all green: `Dogpile.stream` wraps + demuxes; `StreamHandle.cancel` propagates; child failures surface to coordinator; unhandled failure throws unwrapped; child timeouts vs parent timeouts discriminable.
</success_criteria>

<output>
After completion, create `.planning/phases/04-streaming-child-error-escalation/04-04-SUMMARY.md` recording:
- The exact terminate-without-final throw matrix as implemented (one row per termination path → thrown error)
- Map field name and the engine read-path call site
- Replay reconstruct site
- classifyChildTimeoutSource final spec (parameters, return values, fallback rule)
- OpenAI-compatible adapter detail.source emit sites
- Confirmation that CHANGELOG v0.4.0 covers all five D-15 items
</output>
