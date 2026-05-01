---
phase: 04-streaming-child-error-escalation
plan: 03
type: execute
wave: 3
depends_on: ["04-01", "04-02"]
files_modified:
  - src/runtime/coordinator.ts
  - src/runtime/engine.ts
  - src/runtime/validation.ts
  - src/runtime/defaults.ts
  - src/types.ts
  - src/runtime/coordinator.test.ts
  - src/tests/config-validation.test.ts
autonomous: true
requirements: [ERROR-01]
tags: [coordinator-prompt, config, public-surface]

must_haves:
  truths:
    - "The synthetic transcript line at coordinator.ts ~line 459 is enriched: `[sub-run X failed | code=<error.code> | spent=$<partialCost.usd>]: <error.message>` (taggedText continuity preserved + structured fields appended)"
    - "The coordinator's plan-turn prompt template gains a structured `## Sub-run failures since last decision` section listing real failures from the most recent dispatch wave, rendered as a JSON block"
    - "The structured roster shape is exactly: `[{ childRunId, intent, error: { code, message, detail.reason? }, partialCost: { usd } }]` — partialTrace EXCLUDED (D-08); synthetic sibling-failed entries (Phase 3 D-09) and synthetic parent-aborted entries (04-02 D-06) EXCLUDED"
    - "When the failures list for the current wave is empty, the section is OMITTED from the prompt entirely (no header noise on the happy path)"
    - "A new public engine config option `onChildFailure?: \"continue\" | \"abort\"` is accepted at engine + per-run level, with default \"continue\""
    - "Validation rejects any value other than the two literals with code: \"invalid-configuration\" via validation.ts"
    - "Three-level precedence (consistent with Phase 1 D-13 / Phase 3 D-05): engine.onChildFailure ≥ Dogpile.pile/run/stream({ onChildFailure }) ≥ NOT per-decision"
    - "When onChildFailure is \"abort\", the coordinator skips re-issuing the plan turn after the first un-handled child failure and snapshots the triggering failure for ERROR-02's throw (cross-cutting note D-09 vs D-12 — the snapshot is read by 04-04, not by this plan's throw logic)"
  artifacts:
    - path: "src/runtime/coordinator.ts"
      provides: "Enriched transcript line at the existing failure handling site (~line 459); new `buildFailuresSection(failures: DispatchWaveFailure[]): string | null` helper that emits the JSON block under `## Sub-run failures since last decision` header or returns null for empty arrays; integration into the plan-turn prompt template"
      contains: "Sub-run failures since last decision"
    - path: "src/runtime/coordinator.ts"
      provides: "onChildFailure abort-mode short-circuit: when value is \"abort\" and a real (non-synthetic) child failure occurs, the coordinator skips re-issuing the plan turn and stores the triggering failure in a runtime field readable by 04-04's throw logic"
      contains: "onChildFailure"
    - path: "src/runtime/validation.ts"
      provides: "Validation for onChildFailure literal pair; rejects unknown values with invalid-configuration code"
    - path: "src/runtime/defaults.ts"
      provides: "Three-level resolution onChildFailure → engine ≥ run ≥ default \"continue\""
    - path: "src/types.ts"
      provides: "Public type literal `OnChildFailureMode = \"continue\" | \"abort\"` (or inline literal union); engine + RunCallOptions surface gain optional onChildFailure field"
      contains: "onChildFailure"
    - path: "src/runtime/coordinator.test.ts"
      provides: "Snapshot-style assertion on prompt string for a known failure scenario (D-07 prompt template versioning); enriched transcript line lock; abort-mode short-circuit test"
    - path: "src/tests/config-validation.test.ts"
      provides: "Accepts \"continue\" / \"abort\"; rejects any other string with invalid-configuration; verifies three-level precedence"
  key_links:
    - from: "coordinator.ts plan-turn prompt builder"
      to: "buildFailuresSection(currentWaveFailures)"
      via: "appended to prompt only when section is non-null"
      pattern: "Sub-run failures since last decision"
    - from: "engine.run / engine.stream / Dogpile.pile options"
      to: "resolved onChildFailure"
      via: "defaults.ts resolve"
      pattern: "onChildFailure"
    - from: "real (non-synthetic) child failure in coordinator failure path"
      to: "abort-mode short-circuit (skip plan turn)"
      via: "if (onChildFailure === \"abort\") { snapshotTriggeringFailure(...); break; }"
      pattern: "onChildFailure\\s*===\\s*\"abort\""
---

<objective>
Land ERROR-01: child failures surface as first-class context to the coordinator agent so it can retry, delegate differently, or terminate. Two parallel mechanisms (D-07): (1) keep and enrich the human-readable `[sub-run X failed]: ...` transcript line for replay continuity, (2) add a structured `failures: [...]` JSON block to the plan-turn prompt under a clear header. Per D-08, the structured roster carries `error.code`, `error.message`, `error.detail.reason?`, and `partialCost.usd` ONLY — `partialTrace` is intentionally excluded to keep prompts cheap on failure-heavy runs.

Add the new public config knob `onChildFailure?: "continue" | "abort"` (D-09): default `"continue"` preserves spec behavior; `"abort"` short-circuits the next plan turn and snapshots the triggering failure for plan 04-04's throw path. Three-level precedence consistent with prior phases.

Purpose: the coordinator agent finally has structured retry/redirect context, and callers get a fail-fast mode for batch/pipeline use cases. Snapshot-style prompt test in `coordinator.test.ts` locks the JSON shape (CONTEXT cross-cutting D-07: prompt template versioning is observable to LLM determinism).

Output: enriched transcript line, structured failures section, `onChildFailure` config + validation + resolution, abort-mode short-circuit with triggering-failure snapshot ready for 04-04, two new test files updated.
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
@CLAUDE.md
@src/runtime/coordinator.ts
@src/runtime/engine.ts
@src/runtime/validation.ts
@src/runtime/defaults.ts
@src/types.ts

<interfaces>
<!-- Existing transcript line (coordinator.ts:~459) — locate exact wording before editing. -->
// Current shape (approximate): `[sub-run ${childRunId} failed]: ${error.message}`
// Target shape (D-07): `[sub-run ${childRunId} failed | code=${error.code} | spent=$${partialCost.usd.toFixed(...)}]: ${error.message}`

<!-- New structured failures roster shape (D-07 + D-08; locked by snapshot test): -->
```typescript
type DispatchWaveFailure = {
  readonly childRunId: string;
  readonly intent: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly detail?: { readonly reason?: string };
  };
  readonly partialCost: { readonly usd: number };
};
```

<!-- Rendered prompt section (when array is non-empty): -->
//
// ## Sub-run failures since last decision
// ```json
// [
//   { "childRunId": "...", "intent": "...", "error": { "code": "...", "message": "...", "detail": { "reason": "..." } }, "partialCost": { "usd": 0.012 } }
// ]
// ```

<!-- Public config surface (D-09): -->
```typescript
export type OnChildFailureMode = "continue" | "abort";
// Engine option:
interface EngineOptions {
  // existing fields...
  onChildFailure?: OnChildFailureMode;
}
// Per-run option:
interface RunCallOptions {
  // existing fields...
  onChildFailure?: OnChildFailureMode;
}
```

<!-- Three-level precedence pattern from Phase 1 D-13 (already established in defaults.ts): -->
// resolved = run ?? engine ?? "continue"
// Validation runs at construction time (engine) AND run-call time (per-run option) per Phase 1 D-13.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Enrich the transcript line and add the structured failures prompt section</name>
  <files>src/runtime/coordinator.ts, src/runtime/coordinator.test.ts</files>
  <read_first>
    - src/runtime/coordinator.ts (lines 440–480 — current synthetic transcript line at ~459; lines 1212–1262 — child failure path where partialCost lives)
    - src/runtime/coordinator.ts (the plan-turn prompt builder — locate by searching for transcript-render or system-prompt-assembly site; usually somewhere before invoking the model)
    - src/runtime/coordinator.test.ts (existing test patterns; identify how prompt assertions are currently made — likely a snapshot or substring match)
    - .planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md (D-07 prompt template versioning; D-08 partialTrace exclusion; cross-cutting "D-07 prompt template versioning")
    - .planning/phases/03-provider-locality-bounded-concurrency/03-CONTEXT.md (D-09 sibling-failed synthetic event marker — must be EXCLUDED from the structured roster)
  </read_first>
  <behavior>
    - Test 1 (coordinator.test.ts, transcript enrichment): A run with a single real child failure produces a transcript line matching: `[sub-run <runId> failed | code=<error.code> | spent=$<partialCost.usd.toFixed(2 or 3 — match existing cost formatting>]: <error.message>`. Assert the enriched fields are present in addition to the existing `[sub-run X failed]: <message>` skeleton.
    - Test 2 (coordinator.test.ts, structured failures section snapshot): Build a fixture with two real child failures in the most recent dispatch wave (one with detail.reason, one without). Capture the rendered plan-turn prompt. Snapshot-assert (or substring-assert) that:
      - Exact header line `## Sub-run failures since last decision` appears.
      - A JSON code fence follows (` ```json ... ``` `).
      - The JSON body parses to an array of length 2.
      - Each element has shape `{ childRunId, intent, error: { code, message, detail?: { reason? } }, partialCost: { usd } }` and NO other fields (especially no `partialTrace`).
    - Test 3 (coordinator.test.ts, empty-array omission): A run with zero failures in the most recent dispatch wave produces a prompt with NO `## Sub-run failures since last decision` header at all. Assert the substring is absent.
    - Test 4 (coordinator.test.ts, synthetic exclusion): A run where the most recent dispatch wave produced one real failure + one Phase 3 D-09 sibling-failed (synthetic) + one 04-02 D-06 parent-aborted (synthetic). The structured roster contains EXACTLY ONE entry — only the real failure. Distinguishing marker: use whatever Phase 3 D-09's existing synthetic-event marker is (likely a flag on the event payload or the absence of a real error.code path) — read coordinator.ts to identify.
  </behavior>
  <action>
    **Transcript line enrichment (`src/runtime/coordinator.ts:~459`):**

    Locate the existing synthetic transcript line (search: `[sub-run` or `failed]:`). Replace with the enriched form:

    ```typescript
    const usdFormatted = partialCost.usd.toFixed(/* match existing cost formatting in this file */);
    const transcriptLine = `[sub-run ${childRunId} failed | code=${error.code} | spent=$${usdFormatted}]: ${error.message}`;
    ```

    Match the existing cost formatting style used elsewhere in coordinator.ts (likely `.toFixed(4)` or similar — read context to confirm). Do NOT introduce a new format.

    **Structured failures section helper:**

    Add a helper function in coordinator.ts:

    ```typescript
    type DispatchWaveFailure = {
      readonly childRunId: string;
      readonly intent: string;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly detail?: { readonly reason?: string };
      };
      readonly partialCost: { readonly usd: number };
    };

    function buildFailuresSection(failures: ReadonlyArray<DispatchWaveFailure>): string | null {
      if (failures.length === 0) return null;
      const json = JSON.stringify(failures, null, 2);
      return `## Sub-run failures since last decision\n\n\`\`\`json\n${json}\n\`\`\``;
    }
    ```

    The function returns `null` for empty input — the caller appends the section only when non-null (D-07: "Empty array → omit the section entirely").

    **Roster population (real failures only):**

    Track failures from the most recent dispatch wave. At the wave boundary (where current code re-issues the plan turn after dispatch completion), collect failures by walking `DispatchedChild` (or the wave's result records) and filter:
    - Include: real child failures (the child engine threw — `errorPayloadFromUnknown` was called with a real error from `runProtocol`'s rejection at coordinator.ts:1244).
    - Exclude: Phase 3 D-09 sibling-failed synthetics (queued children abandoned after a sibling failed).
    - Exclude: 04-02 D-06 parent-aborted synthetics (in-flight children drained on parent abort).

    The distinguishing marker depends on existing implementation. Likely options to inspect:
    - A `synthetic: true` flag on the `DispatchedChild` record set when a synthetic sub-run-failed was emitted.
    - The `detail.reason` value on the error: `"sibling-failed"` (Phase 3 D-09) and `"parent-aborted"` (04-02 D-06) are synthetic markers. ANY real failure NOT matching these reasons goes into the roster.
    - A boolean field added in 04-02 (`closed` is set after a synthetic emit but does NOT distinguish real vs synthetic — read 04-02's implementation if needed).

    Use the cleanest existing distinguisher; if none is suitable, add `kind: "real" | "synthetic"` to whatever record holds the failure.

    **Prompt integration:**

    In the plan-turn prompt builder, append the result of `buildFailuresSection(currentWaveFailures)` AFTER the existing transcript section, when non-null. Position: at the end of the prompt or in a stable, snapshot-testable location.

    **Tests (`src/runtime/coordinator.test.ts`):**

    Add Tests 1–4 per `<behavior>`. Use the existing prompt-capture harness if one exists; otherwise expose the prompt string from a test seam (the rendered prompt is observable already from existing coordinator tests — locate the seam).

    Snapshot-style assertions should freeze the JSON shape exactly — D-07 cross-cutting note: shape changes here are CHANGELOG-worthy.
  </action>
  <verify>
    <automated>pnpm vitest run src/runtime/coordinator.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "code=\$\{error\.code\}|code=\\\${error\.code\}" src/runtime/coordinator.ts` shows the enriched transcript line.
    - `grep -c "Sub-run failures since last decision" src/runtime/coordinator.ts` >= 1.
    - `grep -c "buildFailuresSection\|DispatchWaveFailure" src/runtime/coordinator.ts` >= 2.
    - `grep -c "partialTrace" src/runtime/coordinator.ts | xargs test 0 -lt` AND new structured-failures-roster code does NOT reference `partialTrace` (D-08 exclusion). Sanity: scoped grep around the buildFailuresSection helper and roster-population block has zero `partialTrace` matches.
    - `pnpm vitest run src/runtime/coordinator.test.ts -t "transcript enrichment"` passes.
    - `pnpm vitest run src/runtime/coordinator.test.ts -t "structured failures section"` passes — JSON parses, length matches, no extra fields.
    - `pnpm vitest run src/runtime/coordinator.test.ts -t "synthetic exclusion"` passes — only real failures appear in the roster.
    - `pnpm vitest run src/runtime/coordinator.test.ts -t "empty.*failures"` passes — section omitted entirely.
  </acceptance_criteria>
  <done>
    Coordinator transcript line is enriched with code + cost; the plan-turn prompt gains a structured failures section under a stable header; synthetic events are excluded; empty-wave runs see no header noise. Snapshot lock is in place for D-07 prompt template versioning.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add onChildFailure config option (engine + per-run), validation, three-level resolution, and abort-mode short-circuit</name>
  <files>src/runtime/coordinator.ts, src/runtime/engine.ts, src/runtime/validation.ts, src/runtime/defaults.ts, src/types.ts, src/tests/config-validation.test.ts, src/runtime/coordinator.test.ts</files>
  <read_first>
    - src/runtime/validation.ts (locate existing literal-validation patterns — e.g. how `protocol` or `tier` is validated; mirror it)
    - src/runtime/defaults.ts (existing three-level resolve patterns — Phase 1 D-13 set the precedent; Phase 3 D-05 mirrors)
    - src/runtime/engine.ts (engine options interface; per-run options threading)
    - src/types.ts (lines 1311–1985 — public type surface; locate where engine + RunCallOptions interfaces live)
    - src/runtime/coordinator.ts (plan-turn loop — find the point after dispatch wave completion where the next plan turn is decided)
    - src/tests/config-validation.test.ts (existing pattern for literal-pair validation tests)
    - .planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md (D-09 config surface; D-15 #3; cross-cutting note "D-09 onChildFailure: 'abort' interaction with D-12 — snapshot triggering failure at abort moment, not walk trace at terminate time")
  </read_first>
  <behavior>
    - Test 1 (config-validation.test.ts): `engine({ onChildFailure: "continue" })` and `engine({ onChildFailure: "abort" })` both construct successfully. `engine({ onChildFailure: "explode" as any })` throws `DogpileError` with `code: "invalid-configuration"`. Same applies to per-run: `Dogpile.pile({ ..., onChildFailure: "explode" as any })` throws `invalid-configuration`.
    - Test 2 (config-validation.test.ts, three-level precedence): per-run option overrides engine option overrides default. E.g. engine = "abort", run = "continue" → resolved "continue". engine = unset, run = unset → resolved "continue". engine = "abort", run = unset → resolved "abort".
    - Test 3 (coordinator.test.ts, abort short-circuit): `onChildFailure: "abort"`. A real child failure occurs in the dispatch wave. Assert: the coordinator does NOT issue another plan turn after this wave; the engine receives a signal/state indicating abort-mode termination; the triggering failure is snapshotted in a runtime field (named consistently — e.g. `triggeringFailureForAbortMode`) so 04-04's throw site can read it.
    - Test 4 (coordinator.test.ts, continue mode unaffected): `onChildFailure: "continue"` (default). The same scenario as Test 3 produces an additional plan turn (existing behavior). The structured failures section from Task 1 carries the failure into the agent's context.
    - Test 5 (coordinator.test.ts, abort mode picks the triggering failure, NOT later siblings): Two children fail in the same wave. In `"abort"` mode, the snapshotted failure is the FIRST observed failure (the one that triggered the abort) — not the most recent. Cross-cutting D-09 vs D-12: "snapshot the triggering failure at the abort moment, rather than walking the trace at terminate time".
  </behavior>
  <action>
    **Public type (`src/types.ts`):**

    Add a literal-union type and thread it through the engine + RunCallOptions interfaces. Either an exported alias or inline:

    ```typescript
    export type OnChildFailureMode = "continue" | "abort";
    ```

    Locate the engine options interface (search for the existing `EngineOptions` or equivalent) and add:

    ```typescript
    onChildFailure?: OnChildFailureMode;
    ```

    Same for `RunCallOptions` (the per-run options accepted by `Dogpile.pile / run / stream`). Ensure both surfaces accept the optional field with JSDoc comments matching project conventions.

    **Validation (`src/runtime/validation.ts`):**

    Add a validator following the existing literal-pair pattern (e.g. how `tier` or `protocol` is validated). Reject any value other than the two literals with:

    ```typescript
    new DogpileError({
      code: "invalid-configuration",
      message: `Invalid onChildFailure: expected "continue" or "abort", got ${JSON.stringify(value)}`,
      detail: { kind: "engine-options", reason: "invalid-on-child-failure" },
    });
    ```

    Wire validation into the existing engine-construction validation flow (where other options are checked) AND into the per-run validation flow (per Phase 1 D-13: validate at BOTH construction and dispatch time).

    **Resolution (`src/runtime/defaults.ts`):**

    Add a resolver mirroring Phase 1 D-13 / Phase 3 D-05 precedence:

    ```typescript
    function resolveOnChildFailure(
      runOption: OnChildFailureMode | undefined,
      engineOption: OnChildFailureMode | undefined,
    ): OnChildFailureMode {
      return runOption ?? engineOption ?? "continue";
    }
    ```

    Call this from wherever the engine builds the per-run effective config (likely the same site that resolves `maxDepth`, `maxConcurrentChildren`, etc.).

    **Coordinator short-circuit (`src/runtime/coordinator.ts`):**

    At the point where the plan-turn loop decides whether to re-issue another plan turn after a dispatch wave completes (locate by reading the plan-turn loop structure — likely a `while` or recursive call near where `currentWaveFailures` from Task 1 is computed):

    ```typescript
    const realFailures = currentWaveFailures.filter(/* exclude synthetic per Task 1 */);
    if (resolvedOnChildFailure === "abort" && realFailures.length > 0) {
      // Snapshot the triggering failure FIRST (chronologically, not last).
      runtimeContext.triggeringFailureForAbortMode = realFailures[0];
      // Skip re-issuing the plan turn; let the run terminate via the existing
      // "no more turns" path. 04-04 reads triggeringFailureForAbortMode at the
      // throw site (D-12: abort-mode treated like degenerate-plan-turn — re-throw
      // the failure that triggered the abort).
      break; // or `return` per existing loop structure
    }
    ```

    The exact field name (`triggeringFailureForAbortMode`) and storage location (`runtimeContext`, `engineRuntimeState`, etc.) MUST match the existing per-run runtime context structure (Phase 2's cost accumulators or Phase 3 D-12's clamp-emit flag are likely siblings). Read the surrounding code to identify.

    The snapshotted failure is read by 04-04's throw site — it is a hand-off, not consumed in this plan.

    **Tests:**

    Add Tests 1–2 to `src/tests/config-validation.test.ts` (validation + precedence).
    Add Tests 3–5 to `src/runtime/coordinator.test.ts` (short-circuit behavior; triggering-failure snapshot semantics).

    For Test 5, construct a fixture where children A and B both fail; assert the snapshotted failure matches A (the first observed), not B.
  </action>
  <verify>
    <automated>pnpm run typecheck && pnpm vitest run src/tests/config-validation.test.ts src/runtime/coordinator.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "onChildFailure" src/types.ts` >= 2 (engine + per-run surfaces).
    - `grep -c "onChildFailure" src/runtime/validation.ts` >= 1.
    - `grep -c "onChildFailure" src/runtime/defaults.ts` >= 1 (resolver).
    - `grep -nE "onChildFailure\\s*===\\s*\"abort\"|=== \"abort\"" src/runtime/coordinator.ts` shows the short-circuit branch.
    - `grep -c "triggeringFailureForAbortMode\|triggering.*failure" src/runtime/coordinator.ts` >= 1 (snapshot field).
    - `pnpm vitest run src/tests/config-validation.test.ts -t "onChildFailure"` passes (validation + precedence).
    - `pnpm vitest run src/runtime/coordinator.test.ts -t "abort.*short-circuit"` passes Tests 3 + 5.
    - `pnpm vitest run src/runtime/coordinator.test.ts -t "continue.*unaffected"` passes Test 4.
    - `pnpm run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    `onChildFailure` is a public, validated, three-level-resolved engine + per-run config option. In "abort" mode the coordinator skips the next plan turn after a real failure and snapshots the FIRST triggering failure for 04-04 to throw. In "continue" mode (default) behavior is unchanged.
  </done>
</task>

</tasks>

<verification>
- `pnpm run verify` green
- `pnpm vitest run src/runtime/coordinator.test.ts src/tests/config-validation.test.ts` all green
- New `onChildFailure` config visible in TS surface (`grep -c onChildFailure src/types.ts` >= 2)
- Snapshot test for the structured failures section is in place — any future shape change will fail loudly per D-07 prompt template versioning.
</verification>

<success_criteria>
- ERROR-01: child failures surface in BOTH the human-readable transcript line (enriched with code + spent) AND a structured JSON roster under `## Sub-run failures since last decision`. The coordinator agent receives the structured context and can retry/redirect/terminate.
- D-08 strictly enforced: no `partialTrace` in the prompt path.
- D-09: new public config option `onChildFailure?: "continue" | "abort"`, default `"continue"`, validated, three-level-resolved.
- Abort-mode hand-off: triggering failure is snapshotted in runtime context at the abort moment (cross-cutting D-09 vs D-12 lock) — read by 04-04's throw site.
- CHANGELOG entry deferred to plan 04-04 (batched).
</success_criteria>

<output>
After completion, create `.planning/phases/04-streaming-child-error-escalation/04-03-SUMMARY.md` recording:
- Exact transcript-line format chosen (with cost format token, e.g. `.toFixed(4)`)
- Exact JSON shape used in the prompt section (frozen by snapshot test)
- The synthetic-vs-real distinguisher used to filter the roster
- The runtime field name where the abort-mode triggering failure is stored (so 04-04 can wire to it)
- Three-level resolver call site
</output>
