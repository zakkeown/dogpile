---
phase: 04-streaming-child-error-escalation
generated: 2026-05-01
mode: power
answered: 17/17
---

# Phase 4 Context — Streaming & Child Error Escalation

Decisions captured from the power-mode questionnaire (`04-QUESTIONS.json`). These lock the gray areas before research/planning.

## Canonical refs

- `.planning/ROADMAP.md` lines 73–84 — Phase 4 success criteria, requirements STREAM-01/02/03, ERROR-01/02/03
- `.planning/REQUIREMENTS.md` lines 45–53 — full requirement text
- `.planning/PROJECT.md` — provider-neutral / replayable-trace invariants
- `.planning/STATE.md` — running decision log (Phase 1–3 D-XX entries)
- `.planning/phases/01-delegate-decision-sub-run-traces/01-CONTEXT.md` — Phase 1 decisions. Notably D-04 (sub-run-* event types), D-09 (child-event bubbling deferred to Phase 4 — UNLOCKED HERE), D-13 (engine + per-run config precedent), D-18 (synthetic transcript entry per completed sub-run).
- `.planning/phases/02-budget-cancellation-cost-rollup/02-CONTEXT.md` — Phase 2 decisions. Notably D-07 (per-child AbortController — STREAM-03 attach point), D-08/D-13 (`detail.reason: parent-aborted | timeout` already locked), D-09 (`sub-run-failed.partialTrace` payload), D-10 (parent-aborted-after-completion shape — DEFERRED TO PLANNER, picked up in Phase 4 per Q-15=d).
- `.planning/phases/03-provider-locality-bounded-concurrency/03-CONTEXT.md` — Phase 3 decisions. Notably D-09 (sibling-failed semantics + synthetic event pattern reused for Q-06), D-12 (lazy single-emit clamp event pattern), D-17 (per-child stream-handle hook in `DispatchedChild` — Phase 4 attaches here).
- `CLAUDE.md` — public-surface invariants (event-shape changes propagate to `event-schema.test.ts`, `result-contract.test.ts`, `package-exports.test.ts`, `package.json` exports/files, `CHANGELOG.md`)
- `src/runtime/engine.ts:132` — `stream(intent, options)` — StreamHandle factory; cancellation lifecycle at line 293
- `src/runtime/engine.ts:316` — `publish(event)` parent-stream FIFO drain; gating point for Q-06's emit-after-cancel guarantee
- `src/runtime/engine.ts:283` — `createStreamErrorEvent` terminal-event emit on parent abort
- `src/runtime/coordinator.ts:1116` — `childEvents` buffer + `teedEmit` (lines 1118–1121) — Q-01 / Q-02 wrap point
- `src/runtime/coordinator.ts:459` — current synthetic transcript line on child failure (`[sub-run X failed]: ...`) — Q-07 enrichment site
- `src/runtime/coordinator.ts:1163–1183` — per-child `AbortController` derivation (Phase 2 D-07) + `DispatchedChild` (Phase 3 D-17 hook) — Q-05 reuses, Q-06's parent-aborted synthetic emits walk this set
- `src/runtime/coordinator.ts:1212–1262` — child failure path → `errorPayloadFromUnknown` + `sub-run-failed` emit — Q-11 reference-keeping site
- `src/runtime/cancellation.ts` — `enrichAbortErrorWithParentReason` (Phase 2 D-08) — Q-14 sibling helper lands here
- `src/types/events.ts:789–798` — `StreamLifecycleEvent` union (8 variants today) — Q-15(b) parent-aborted variant added here
- `src/types/events.ts:806` — `StreamOutputEvent` union — Q-01's `parentRunId?` field flows through these
- `src/types/events.ts:817–830` — `StreamErrorEvent` shape — terminal event referenced by Q-06
- `src/types.ts:1311–1359` — public event re-exports (the surface the new variants must thread through)
- `src/types.ts:1365` — `StreamHandleStatus` — Q-05's `cancelled` terminal state
- `src/types.ts:1954–1985` — `StreamHandle` interface — Q-05/Q-06 contract surface
- `src/tests/streaming-api.test.ts` — Q-01/Q-02/Q-04 wrap contract + Q-05/Q-06 cancel contract
- `src/tests/cancellation-contract.test.ts` — Q-13/Q-14 timeout-discriminator locks
- `src/tests/public-error-api.test.ts` — Q-10/Q-11 unwrapped re-throw contract
- `src/tests/event-schema.test.ts` — Q-15 public-surface lock for parentRunId(s) field, parent-aborted variant, `detail.source`
- `src/tests/result-contract.test.ts` — Q-04 parent-events isolation reaffirmation; new event variants in result fingerprint
- `src/tests/config-validation.test.ts` — Q-09 `onChildFailure` validation
- `src/tests/package-exports.test.ts` — only updated if a new top-level export surfaces (none expected)
- `src/runtime/coordinator.test.ts` — Q-07/Q-09 scenario coverage
- `src/runtime/engine.test.ts` (or co-located) — Q-05/Q-06 cancel ordering scenarios

## Decisions

### Stream Wrapping Shape (STREAM-01 / STREAM-02)

**D-01: Add `parentRunId?: string` (flat, immediate parent) to every event type that can flow through a parent stream — combined with D-02's full ancestry chain.** (Q-01 = a, refined by Q-02 = b)
- Every variant in `StreamLifecycleEvent` and `StreamOutputEvent` (src/types/events.ts:789, 806) gains an optional `readonly parentRunId?: string`. Absent → root event (originated in the receiving handle's run). Present → bubbled from a child engine.
- Set inside `teedEmit` (coordinator.ts:1118) BEFORE forwarding to `options.emit`: shallow-clone the event with `parentRunId = currentRunId` (the running coordinator's runId, NOT necessarily the topmost parent — the chain in D-02 holds full ancestry).
- Consumers demux via `event.parentRunId === handle.runId ? "own" : "child"` for the common one-level case.
- Phase 1 D-09's deferred child-event bubbling unlocks here.
- Public-surface delta: every existing event variant gets an optional field; non-breaking addition. Lock in `event-schema.test.ts`.

**D-02: Bubble grandchildren via a `parentRunIds: readonly string[]` ancestry chain prepended at every level.** (Q-02 = b)
- The optional D-01 flat `parentRunId` becomes `parentRunIds?: readonly string[]` — root → ... → immediate-parent. Empty/absent at root; `[parent]` at depth 1; `[grandparent, parent]` at depth N.
- Each level's `teedEmit` prepends its OWN runId to whatever inbound chain the child emitted: `event.parentRunIds = [self.runId, ...(event.parentRunIds ?? [])]`.
- Demux by exact-level: `event.parentRunIds?.[event.parentRunIds.length - 1] === handle.runId` checks immediate-parent equality (i.e., "this event's immediate parent is me"). Demux by ancestry: `event.parentRunIds?.includes(handle.runId)`.
- Resolves D-01 vs Q-01=a literal wording: we ship the chain (Q-02=b) and DROP the flat single-parent field. One canonical shape: `parentRunIds`.
- Phase 1's `recursive: true` flag on `sub-run-started` is unaffected; chain is independent.
- Lock in `event-schema.test.ts` and `result-contract.test.ts` — the chain field is part of the public event shape.

**D-03: Per-child event-order preservation rests on existing synchronous `teedEmit` + a contract test.** (Q-03 = a)
- No changes to the emit path. JS single-thread + serial `publish()` in engine.ts:316 already guarantees per-child monotonic order (events from one child's `await runProtocol(...)` cannot interleave with their own out-of-order siblings).
- Contract test in `streaming-api.test.ts`: dispatch a child that emits N=20 events with deliberate `setImmediate` interleaves; collect parent-stream events; assert per-child subsequence (filter by `childRunId`) preserves order. Add a parallel-children variant that asserts cross-child interleave is allowed.
- No `childSeq` field; no per-child queue refactor. STREAM-02 ships as a contract assertion, not new machinery.

**D-04: Stream-only wrapping; parent's persisted `RunResult.events` array is unchanged.** (Q-04 = a)
- The `parentRunIds` chain (D-02) is set inside `teedEmit` ONLY for the parent's live emit callback. The child engine's own `RunEvent` records (which feed `subResult.events`) do NOT carry the chain — they remain identical to what the child engine emitted before.
- Preserves Phase 2 D-15's parent-events isolation (budget-first-stop.test.ts contract). Termination math unaffected.
- Replay round-trip stays clean: replay walks `subResult.events` recursively; the chain is reconstructed for live consumers but not persisted.
- Implication: a stream consumer who logs every event sees the chain; a developer reading `result.events` afterwards does NOT — they walk into `subResult.events` to see child events. This asymmetry is intentional and doc-worthy in the Phase 5 docs page.
- One subtle test: `result-contract.test.ts` must assert that for a run with delegated children, `parent.events.find(e => e.parentRunIds)` is undefined (no child events leaked into the parent trace).

### Cancellation Propagation (STREAM-03)

**D-05: `StreamHandle.cancel()` reuses the parent AbortController + Phase 2's per-child propagation; no new stream-handle machinery.** (Q-05 = a)
- The existing `cancel()` path on `StreamHandle` aborts the parent run's signal. Phase 2 D-07's per-child controller listener (coordinator.ts:1170–1177) forwards the abort to every in-flight child engine. Phase 3 D-17's `DispatchedChild.controller` is the registry — Phase 4 just walks it.
- No new public surface for cancel. The streaming-side contract test in `streaming-api.test.ts` asserts: after `handle.cancel()`, every in-flight child's `runProtocol` rejects with `code: "aborted"`, and the parent stream emits a terminal `error` event (existing `createStreamErrorEvent` path at engine.ts:283).
- Phase 3 D-17's commented stream-handle hook on `DispatchedChild` may stay structural — no per-child user-facing StreamHandle needs to be exposed in Phase 4 (children remain internal).

**D-06: Synthetic `sub-run-failed` for every in-flight child (with `detail.reason: "parent-aborted"`) BEFORE the terminal parent `error` event.** (Q-06 = b)
- On `cancel()` (or any parent abort), iterate `DispatchedChild` entries that have started but not completed. For each, emit a synthetic `sub-run-failed` with:
  - `error.code: "aborted"`, `error.detail.reason: "parent-aborted"` (Phase 2 D-08 vocabulary)
  - `partialTrace`: built from the child's accumulated `childEvents` buffer (per Phase 2 D-09 contract)
  - `partialCost`: from `lastCostBearingEventCost(childEvents) ?? emptyCost()` (Phase 2 D-02)
- Mirrors Phase 3 D-09's sibling-failed synthetic-event pattern (same constructor shape, different `detail.reason`).
- After all in-flight children get their synthetic terminator, emit the parent's terminal `error` event (existing `createStreamErrorEvent` path).
- Implementation: gate the existing `closeStream()` (engine.ts:301) behind a "drain in-flight children with synthetic failures" pre-step. The actual child engines may still be racing to abort; the synthetic event is the trace-side terminator regardless of whether the real abort has landed.
- Avoids the race where in-flight child events arrive AFTER cancel(): once the synthetic `sub-run-failed` is emitted for a childRunId, set a per-child `closed` flag in `DispatchedChild`; subsequent late events from that child's `teedEmit` are suppressed at the parent emit boundary.
- Lock in `streaming-api.test.ts` AND `cancellation-contract.test.ts`. New `detail.reason` value is already in vocabulary (`parent-aborted`); no string-vocab additions for this decision.

### Child Error Surfacing into Coordinator Decision (ERROR-01)

**D-07: Both — keep the taggedText synthetic transcript line AND add a structured `failures: ReadonlyArray<{...}>` block in the coordinator prompt.** (Q-07 = c)
- Transcript continuity: keep the existing `[sub-run X failed]: <message>` line at coordinator.ts:459 for human-readable replay. Enrich it minimally with `error.code` and `partialCost.usd` (`[sub-run X failed | code=aborted | spent=$0.012]: <message>`).
- Structured failures roster: the coordinator's plan-turn prompt template (formatted in coordinator.ts before invoking the model) gains a dedicated section listing all sub-run failures from the most recent dispatch wave. Shape:
  ```
  failures: [
    { childRunId, intent, error: { code, message, detail.reason? }, partialCost: { usd } }
  ]
  ```
  Excludes `partialTrace` per D-08. Excludes "synthetic sibling-failed" entries (Phase 3 D-09 fabrications without real spend).
- The structured roster is rendered into the prompt as a JSON block under a clear header (e.g., `## Sub-run failures since last decision`). Empty array → omit the section entirely (avoid prompt noise on the happy path).
- Public-surface delta: prompt template change is observable to LLM determinism, NOT to TS callers. Document in CHANGELOG as "coordinator prompt now includes structured failure roster" — note for callers comparing trace fixtures across versions.
- Lock the prompt-template additions in `coordinator.test.ts` with a snapshot-style assertion on the prompt string for a known failure scenario.

**D-08: Coordinator agent sees `error.message`, `error.code`, `error.detail.reason`, `partialCost` only — NOT `partialTrace`.** (Q-08 = a)
- Keeps prompts cheap on failure-heavy runs. Coordinator decisions stay high-level (retry / different intent / terminate) without the LLM weighing trace internals.
- `partialTrace` remains available in the `sub-run-failed` event for developers/replay; it is not threaded into the prompt-build path.
- Defer richer surfacing (Q-08=b summarized partialTrace) as a deferred idea — Phase 5+ enhancement if real users request it.

**D-09: New engine config `onChildFailure?: "continue" | "abort"` (default `"continue"`).** (Q-09 = b)
- Three-level precedence consistent with Phase 1 D-13 / Phase 3 D-05: `engine.onChildFailure` (default `"continue"`) ≥ `Dogpile.pile/run/stream({ onChildFailure })` ≥ NOT per-decision (this one is a caller-side knob, not an agent-side one — agents express intent via decisions, not config).
- `"continue"` (default): preserves spec behavior — re-issue plan turn after every child failure, agent decides what's next.
- `"abort"`: skip re-issuing the plan turn after the first un-handled child failure; ERROR-02's throw path (D-10) fires immediately. Useful for batch jobs / fail-fast pipelines.
- Validation: any value other than the two literals → `invalid-configuration` error in `validation.ts`.
- Public-surface additions: `engine.onChildFailure` config option, `Dogpile.pile/run/stream` accept `onChildFailure?: "continue" | "abort"`. Update `config-validation.test.ts`. Add a string-literal type in the public types surface.
- Interaction with D-12: `"abort"` mode short-circuits termination semantics — the throw fires regardless of whether budget would have stopped the run anyway.

### Unhandled Failure Throw (ERROR-02)

**D-10: Parent throws the LAST `sub-run-failed`'s error on terminate-without-final-synthesis.** (Q-10 = b)
- "Terminate without final synthesis" = parent run ended without emitting a `final` event, AND its events array contains at least one `sub-run-failed` (gated further by D-12).
- Throw target: the MOST RECENT `sub-run-failed` (last in event-array order). Rationale: the failure closest to the termination decision is the one most likely to have caused the termination; debugging signal is highest there.
- Tightening of "original DogpileError unwrapped" wording: "original" here means "the child's own thrown DogpileError, not a wrapper" — NOT "the first one chronologically." Document this interpretation in CHANGELOG to avoid spec-drift confusion.
- Single-failure runs: trivially the same as first-failure (only one to throw).
- Synthetic `sub-run-failed` from Phase 3 D-09 sibling-failed and Phase 4 D-06 parent-aborted-drain are EXCLUDED from the "last failure" candidate set — only REAL child failures (those produced by the child engine throwing) are eligible. Synthetic failures are bookkeeping; throwing them masks the real cause.
- Lock in `public-error-api.test.ts`: build a scenario with two real failures (F1, F2) + one synthetic, terminate via budget, assert the thrown error matches F2's payload.

**D-11: Hold a runtime reference to the original `DogpileError` instance keyed by `childRunId`; reconstruct from `sub-run-failed.error` payload during replay.** (Q-11 = c)
- Runtime path: a per-run `Map<childRunId, DogpileError>` on the engine's runtime context (alongside Phase 2's cost accumulators / Phase 3 D-12's clamp-emit flag). Populated in the failure path (coordinator.ts:1244) BEFORE `errorPayloadFromUnknown` serializes the payload. On parent terminate-without-final, look up the LAST eligible (per D-10) entry and re-throw the SAME instance.
- Replay path: `replay()` walks the trace and has only the serialized `error` payload. Reconstruct a fresh `DogpileError` from the payload (`code`, `providerId`, `detail`, `message`) and throw that. `instanceof DogpileError` still holds; `.stack` is fresh (no original to preserve).
- Memory: errors held until parent run completes. Bounded by `MAX_DISPATCH_PER_TURN × turns` — small; acceptable.
- Cleanup: clear the map on parent run termination (success OR thrown re-throw), so engine instance reuse across runs doesn't leak.
- Lock in `public-error-api.test.ts`: runtime path asserts instance identity with a known thrown error; replay path asserts payload equality + `instanceof DogpileError`.

**D-12: Only budget-driven and degenerate-plan-turn terminations re-throw an unhandled child failure; explicit cancellation throws the cancel error verbatim.** (Q-12 = b)
- Termination paths and their re-throw behavior:
  - Coordinator emits `final` (success): NO re-throw — happy path.
  - Budget timeout / `maxIterations` / `maxRounds` / `maxCost` exhausted with un-handled failure in trace: RE-THROW per D-10/D-11.
  - Degenerate plan turn (coordinator returned no decision, no failure to handle): if un-handled failure exists → RE-THROW; otherwise existing degenerate-turn error.
  - Explicit `parent.signal.abort()` / `StreamHandle.cancel()`: throw the CANCEL error verbatim (the existing `aborted` + `detail.reason: "parent-aborted"` error from engine.ts:293). User intent wins; child failures are NOT escalated past a cancel.
  - Depth overflow at dispatch: throws the depth-overflow error verbatim (already its own well-defined error; not re-thrown as a child failure).
  - `onChildFailure: "abort"` mode (D-9): treated like a degenerate-plan-turn termination — re-throw the failure that triggered the abort.
- Rationale: principle of least surprise — `.cancel()` callers always get cancel errors. Budget callers get child failures (the budget IS the symptom; the failure IS the cause).
- Lock in `public-error-api.test.ts` with one assertion per termination path.

### Timeout Discrimination (ERROR-03)

**D-13: Three observable timeout cases via `code` + `detail.source`.** (Q-13 = c)
- (1) Provider HTTP/SDK timeout (the actual upstream call timing out): `code: "provider-timeout"`, `detail.source: "provider"` (or omitted — backwards-compat with existing provider-timeout shape: see below).
- (2) Child engine's own budget timing out (decision-supplied or engine-default `defaultSubRunTimeoutMs` from Phase 2 D-14): `code: "provider-timeout"`, `detail.source: "engine"`. The child's perspective: its own engine deadline expired.
- (3) Parent budget propagated to child (Phase 2 D-11 `parentDeadlineMs - now`): `code: "aborted"`, `detail.reason: "timeout"` (Phase 2 D-08/D-13 — already shipped).
- Backwards-compat: existing `provider-timeout` errors today carry no `detail.source`. The new field is OPTIONAL and additive; consumers get `detail.source: "provider"` going forward (set by the OpenAI-compatible adapter) and `detail.source: "engine"` for the new engine-deadline case. Absence is interpreted as `"provider"` for any consumer that switches on it.
- Public-surface delta: new optional `detail.source: "provider" | "engine"` discriminator string-literal pair. Lock in `cancellation-contract.test.ts` and `public-error-api.test.ts`.
- Note vs Phase 2 D-08 vocabulary: `detail.reason` covers `"parent-aborted" | "timeout"` (and Phase 3 D-09's `"sibling-failed"`, Phase 3 D-04's `"remote-override-on-local-host"`). `detail.source` is a SEPARATE axis specific to `provider-timeout` errors. Document the orthogonality.

**D-14: Timeout-classification logic lives in `cancellation.ts` helpers — extend `enrichAbortErrorWithParentReason` with a sibling helper.** (Q-14 = c)
- Add `classifyChildTimeoutSource(error: unknown, context: { decisionTimeoutMs?: number; engineDefaultTimeoutMs?: number; isProviderError: boolean }): "provider" | "engine"` — single source of truth.
- Called from:
  - **Engine path (engine.ts):** when the child engine's own deadline fires, before emitting the terminal error. Sets `detail.source: "engine"`.
  - **Coordinator dispatch path (coordinator.ts):** when a child's `runProtocol` rejects with a `provider-timeout` whose root is the upstream provider call (not an engine deadline). Sets `detail.source: "provider"`.
- Mirrors Phase 2 D-08's `enrichAbortErrorWithParentReason` pattern: helper-driven, callable from both layers, single test surface.
- Lock the helper's behavior in unit tests adjacent to `cancellation.ts` and the integration behavior in `cancellation-contract.test.ts`.

### Tests, Public Surface, Plan Breakdown

**D-15: Kitchen-sink public-surface inventory — five additions lock together.** (Q-15 = d)
- (1) `parentRunIds?: readonly string[]` ancestry chain on every event in `StreamLifecycleEvent` ∪ `StreamOutputEvent` (D-01/D-02). Live-stream-only; not in persisted `RunResult.events` (D-04).
- (2) New `aborted` event variant from Phase 2 D-10 deferred (parent-aborted-after-child-completed observability). Final shape: a top-level lifecycle event variant `{ type: "aborted", runId, at, reason: "parent-aborted" | "timeout", detail? }` emitted on the parent stream BEFORE the terminal `error` (or as the terminal lifecycle marker if no error follows). Joins `StreamLifecycleEvent`. Closes the Phase 2 D-10 open item.
- (3) `onChildFailure?: "continue" | "abort"` engine config + per-run option (D-09). String-literal type in public surface; default `"continue"`.
- (4) `detail.source?: "provider" | "engine"` on `provider-timeout` errors (D-13).
- (5) Coordinator prompt structured failures section (D-07). Not a TS-public-surface change (no exported types), but observable to LLM determinism — CHANGELOG-worthy entry.
- All five locked together in `event-schema.test.ts`, `result-contract.test.ts`, `config-validation.test.ts`, `cancellation-contract.test.ts`, `public-error-api.test.ts`, and a single batched `CHANGELOG.md` v0.4.0 entry at phase wrap (matching Phase 2 D-20 / Phase 3 D-18 discipline).
- `package-exports.test.ts` likely no-op: new shapes ride existing exports (event union grows, no new top-level export name).
- `package.json` `files` allowlist: no change expected (no new tarballed file paths).

**D-16: Hybrid test organization — same pattern as Phase 2 D-18 / Phase 3 D-15.** (Q-16 = a)
- Streaming-wrap contract (Q-01/02/03/04) → `src/tests/streaming-api.test.ts` (existing, per ROADMAP key files).
- Cancel propagation contract (Q-05/06) → `src/tests/streaming-api.test.ts` + `src/tests/cancellation-contract.test.ts` (split: streaming-side asserts in the former, cancel-vocabulary asserts in the latter).
- ERROR-01 prompt-roster + transcript-line scenarios → `src/runtime/coordinator.test.ts`.
- ERROR-02 throw contract → `src/tests/public-error-api.test.ts` (existing).
- ERROR-03 timeout discriminator → `src/tests/cancellation-contract.test.ts`.
- Public-surface event/decision locks (D-15 inventory) → `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, `src/tests/config-validation.test.ts`.
- Promotion-on-growth (Phase 3 D-15 policy): if any single concern grows past ~150 LOC of additions, planner extracts a new dedicated file. Default: stay in existing files.
- No new `recursive-coordination.test.ts` end-to-end file — that's Phase 5's example surface, not Phase 4's contract surface.

**D-17: Four plans, one per concern cluster; ordering = streaming foundation → cancel → error context → throw + timeout.** (Q-17 = d)
- **Plan 04-01 — Stream Wrapping (STREAM-01 + STREAM-02):** D-01 (parentRunIds field), D-02 (ancestry chain prepend), D-03 (per-child order contract test), D-04 (parent-events isolation reaffirm). Touches `src/types/events.ts`, `src/types.ts` (re-exports), `src/runtime/coordinator.ts` (`teedEmit` chain prepend at line 1118). Tests: `streaming-api.test.ts`, `event-schema.test.ts`, `result-contract.test.ts`. Pure additive event-shape work; no cancellation logic.
- **Plan 04-02 — Cancel Propagation (STREAM-03):** D-05 (reuse Phase 2 controllers), D-06 (synthetic sub-run-failed drain + suppress-late-events flag). Touches `src/runtime/engine.ts` (cancel lifecycle at line 293), `src/runtime/coordinator.ts` (DispatchedChild closed flag, drain helper). Tests: `streaming-api.test.ts`, `cancellation-contract.test.ts`. Closes Phase 3 D-17's hook.
- **Plan 04-03 — Coordinator Failure Context (ERROR-01):** D-07 (taggedText enrichment + structured failures section), D-08 (no partialTrace in prompt), D-09 (`onChildFailure` config). Touches `src/runtime/coordinator.ts` (prompt template, transcript line at line 459), `src/runtime/engine.ts` (config plumbing), `src/runtime/validation.ts` (config validation), `src/runtime/defaults.ts` (resolution). Tests: `coordinator.test.ts`, `config-validation.test.ts`. Public-surface: new config option (D-15 #3).
- **Plan 04-04 — Throw + Timeout Discrimination (ERROR-02 + ERROR-03):** D-10 (last-failure throw), D-11 (instance-keyed Map + reconstruct on replay), D-12 (cancel-wins-over-failure precedence), D-13 (`detail.source` for provider-timeout), D-14 (`cancellation.ts` helper). Touches `src/runtime/coordinator.ts` (failure Map population, throw site), `src/runtime/engine.ts` (terminate-without-final detection), `src/runtime/cancellation.ts` (classifier helper), `src/runtime/replay.ts` (reconstruct path), `src/types.ts` (error type/detail-source surface). Tests: `public-error-api.test.ts`, `cancellation-contract.test.ts`, `event-schema.test.ts` (for the `aborted` event variant from D-15 #2). Plus ALSO lands D-15 #2's `aborted` event variant — final, terminal, and parent-aborted-after-completion.
- Dependency order: 04-01 (event shape) → 04-02 (cancel uses sub-run-failed enrichment from 04-01) → 04-03 (failure context relies on 04-01 + 04-02 plumbing) → 04-04 (throw uses Map populated by failure path enriched in 04-03; D-15 #2 `aborted` variant is shared infra used by 04-02's drain story).
- 04-04 is the largest plan; planner may split D-15 #2's `aborted` event variant into 04-02 if it would shorten 04-04 — flagged for planner judgment.
- CHANGELOG updated once at phase wrap with the D-15 inventory (one batched v0.4.0 entry).

## Cross-cutting / open notes for planner

- **Public-surface change inventory** (must move together per CLAUDE.md): `parentRunIds?` field on event shapes (D-01/D-02), new `aborted` lifecycle event variant (D-15 #2), `onChildFailure` config (D-09), `detail.source?` on `provider-timeout` errors (D-13). Updates required: `event-schema.test.ts`, `result-contract.test.ts`, `config-validation.test.ts`, `cancellation-contract.test.ts`, `public-error-api.test.ts`, `package-exports.test.ts` (likely no-op), CHANGELOG v0.4.0 entry.

- **D-02 chain prepend semantics — replay round-trip:** the chain is set in `teedEmit` for live-stream consumers ONLY (D-04). When `replay()` re-runs a trace and re-fires events through a fresh stream, the replay engine must reconstruct the chain at the bubbling boundary (replay simulating a live stream from a recorded trace). Planner: confirm that `replay()`'s event-fire path goes through `teedEmit` (or an equivalent that prepends the chain). If it bypasses, replay-from-stream loses parentRunIds — make `replay()` emit-side mirror live-emit-side.

- **D-04 vs Phase 1 D-04 (sub-run-* events live in parent's events array):** `sub-run-started/completed/failed/queued/budgetClamped/concurrencyClamped` are PARENT-level lifecycle events that live in `parent.events` already. Their `parentRunIds` chain is empty/absent when emitted by the parent itself. Only INNER child events (model-activity, tool-activity, turn) get the chain. Lock this distinction in `event-schema.test.ts`: `sub-run-*.parentRunIds` is always undefined when the event is parent-emitted.

- **D-06 race with Phase 3 D-09 sibling-failed:** when parent aborts mid-fan-out, queued children are already getting synthetic sibling-failed events from Phase 3 D-09. In-flight children will get D-06's parent-aborted synthetic events. Both conditions can happen for one fan-out. Planner: confirm dispatch logic handles "queue drain (sibling-failed for queued, parent-aborted for in-flight)" cleanly — single iteration over `DispatchedChild` is fine, distinguish state with `started: boolean`.

- **D-07 prompt template versioning:** the structured `failures: [...]` JSON block is observable to the LLM. A change in the JSON shape after Phase 4 ships is a behavioral break for callers comparing trace fixtures. Lock the JSON shape with a snapshot test in `coordinator.test.ts` and treat shape changes as CHANGELOG-worthy.

- **D-09 `onChildFailure: "abort"` interaction with D-12:** when `"abort"` fires, ERROR-02's throw triggers immediately (before budget would have stopped). The thrown error MUST be the failure that triggered the abort (not the last in the trace, which might be a later sibling completing in parallel). Planner: in `"abort"` mode, snapshot the triggering failure at the abort moment, rather than walking the trace at terminate time.

- **D-11 memory bound:** the per-run `Map<childRunId, DogpileError>` holds error instances. Bounded by `MAX_DISPATCH_PER_TURN (8) × turns × maxDepth (4)` ≤ small. No eviction needed within a run. Confirm cleanup on engine.run() return / throw to avoid cross-run leak when callers reuse engine instances.

- **D-12 vs D-09 vs cancel:** explicit `cancel()` always wins. `onChildFailure: "abort"` triggers the throw via D-10 (not via cancel). Cancel during an "abort"-triggered throw: cancel wins, error becomes the cancel error. Lock this precedence in `public-error-api.test.ts` with a three-way scenario.

- **D-13 backwards-compat for `provider-timeout`:** existing fixtures and consumers do not have `detail.source`. Lock that existing emit sites in the OpenAI-compatible adapter (`src/providers/openai-compatible.ts`) gain `detail.source: "provider"` going forward, but consumers MUST treat absence as `"provider"`. Document in CHANGELOG; add a contract test asserting both forms parse correctly.

- **D-15 #2 `aborted` event variant — exact placement:** emitted on the parent stream BEFORE the terminal `error` event. For the parent-aborted-after-child-completed race (Phase 2 D-10's original concern), it lands as a normal lifecycle event then the run terminates normally (no `error` event if termination was the abort itself). Planner: confirm whether `aborted` ALWAYS pairs with a subsequent `error`, or whether some abort paths terminate cleanly with just `aborted` + final-status `cancelled`.

- **Phase 5 docs prep:** D-04's stream-vs-trace asymmetry (chain visible live, not in `result.events`) MUST be documented in `docs/recursive-coordination.md`. D-07's structured failures section shape is part of the public coordinator-prompt contract — also doc-worthy.

## Deferred ideas

- **Q-08(b) summarized partialTrace in coordinator prompt:** rejected for Phase 4 (D-08). Revisit if real users report that high-level error.code + message isn't enough signal for retry decisions.
- **Per-child caller-visible StreamHandle (`streamChild(childRunId)`):** Q-01(d) rejected. Phase 4 keeps children internal. Revisit if users need to render per-child UIs from a parent stream.
- **Per-child sequence number (`childSeq`) on bubbled events:** Q-03(b) rejected. JS single-thread + serial `publish()` already guarantees per-child order. Revisit only if a future refactor batches events.
- **Aggregate error wrapping all unhandled failures:** Q-10(d) rejected — contradicts spec wording ("original DogpileError unwrapped"). Revisit if multi-failure visibility becomes a frequent debugging request.
- **Acknowledgement-tracking for "unhandled":** Q-10(c) rejected — fuzzy semantics. Revisit if D-10's "last failure" rule produces surprising re-throws in practice.

## Next step

```
/gsd-plan-phase 4
```
