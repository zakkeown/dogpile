---
phase: 04-streaming-child-error-escalation
verified: 2026-05-01T15:00:10Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 4: Streaming & Child Error Escalation Verification Report

**Phase Goal:** Live consumers see child events demultiplexable by `runId`, parent cancel reaches every child stream, and child failures surface as first-class context to the coordinator agent or escalate unwrapped if unhandled.
**Verified:** 2026-05-01T15:00:10Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `Dogpile.stream(parent)` emits child events wrapped with `parentRunIds` ancestry and child `runId`; root events remain unwrapped. | VERIFIED | `src/types/events.ts` has `parentRunIds` on stream lifecycle/output variants. `src/runtime/coordinator.ts:1322` stores original child events and, only when `streamEvents` is enabled, forwards a cloned event with `parentRunIds: [input.parentRunId, ...(inbound ?? [])]`. `src/tests/streaming-api.test.ts` covers direct child and grandchild ancestry. |
| 2 | Within a single child, event order is preserved; cross-child order is unspecified. | VERIFIED | `src/tests/streaming-api.test.ts` asserts a 20-chunk child sequence equals the provider-observed order, and verifies each parallel child subsequence independently without asserting a global interleave. |
| 3 | `StreamHandle.cancel()` on the parent cancels/drains in-flight child streams and terminates the parent with an aborted error. | VERIFIED | `src/runtime/engine.ts:279` registers the coordinator abort drain; `src/runtime/coordinator.ts:273` drains open children with synthetic `sub-run-failed` events. `src/runtime/engine.ts:1160` creates cancel errors with `detail.status: "cancelled"` and `detail.reason: "parent-aborted"`. STREAM-03 tests cover drain ordering, queued sibling failure, late-event suppression, and cancelled status. |
| 4 | Child failures surface as first-class coordinator context so the coordinator can retry, redirect, or terminate. | VERIFIED | `src/runtime/coordinator.ts:1124` renders `## Sub-run failures since last decision` JSON; `src/runtime/coordinator.ts:1137` excludes synthetic `sibling-failed` / `parent-aborted` failures and includes code/message/reason plus partial cost. Coordinator tests cover enriched tagged text, structured roster, empty omission, synthetic exclusion, continue mode, single-child continue, and abort short-circuit. |
| 5 | Unhandled child failures escalate unwrapped, preserving runtime `DogpileError` identity where possible; replay reconstructs equivalent typed errors. | VERIFIED | `src/runtime/coordinator.ts:1485` stores real `DogpileError` instances before serialization. `src/runtime/engine.ts:963` picks abort-mode triggering failure first, otherwise last real failure by event order, skips handled failures after final synthesis, and excludes synthetic failures for replay at `src/runtime/engine.ts:1021`. `src/tests/public-error-api.test.ts` covers runtime identity, last real failure, abort-mode first trigger, cancel-wins, depth overflow, and replay reconstruction. |
| 6 | Child/provider timeout cases are distinguishable: provider timeout, child engine deadline, parent budget timeout. | VERIFIED | `src/runtime/cancellation.ts:30` defines `classifyChildTimeoutSource`; `src/runtime/engine.ts` creates engine-deadline `provider-timeout` errors; `src/providers/openai-compatible.ts:420` stamps HTTP 408/504 as `detail.source: "provider"`; parent budget aborts remain `code: "aborted"` with `detail.reason: "timeout"`. `src/tests/cancellation-contract.test.ts` covers all three observable cases and backwards-compatible absent `detail.source`. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/types/events.ts` | Public event surface for `parentRunIds`, `AbortedEvent`, timeout detail source compatibility | VERIFIED | `parentRunIds` appears on 17 stream lifecycle/output variants; `AbortedEvent` includes `reason` and optional ancestry. |
| `src/types.ts` / `src/index.ts` | Public re-exports and option types | VERIFIED | `AbortedEvent`, `SubRunParentAbortedEvent`, and `OnChildFailureMode` are exported; engine/high-level/run options expose `onChildFailure`. |
| `src/runtime/coordinator.ts` | Stream bubbling, cancel drain, failure context, failure instance capture | VERIFIED | `teedEmit`, `drainOnParentAbort`, `buildFailuresSection`, abort-mode snapshot, and `failureInstancesByChildRunId.set()` are present and wired. |
| `src/runtime/engine.ts` | Stream handle cancellation, terminal throw matrix, replay/replayStream behavior | VERIFIED | Registers abort drain, clears failure map on stream close/non-streaming finally, resolves runtime/replay terminal throw, and reconstructs replay stream ancestry. |
| `src/runtime/cancellation.ts` | Timeout source helper | VERIFIED | `classifyChildTimeoutSource()` is exported and tested. |
| `src/providers/openai-compatible.ts` | Provider timeout discriminator | VERIFIED | HTTP 408/504 map to `provider-timeout` with `detail.source: "provider"` after lenient non-OK response parsing. |
| `src/runtime/replay.ts` | Planned replay artifact | VERIFIED VIA ALTERNATE PATH | File is absent; this repo implements `replay()` and `replayStream()` in `src/runtime/engine.ts`. Replay ancestry and replay error reconstruction are implemented there and covered by focused tests. |
| `src/tests/streaming-api.test.ts` | STREAM-01/02/03 contract tests | VERIFIED | Direct child/grandchild ancestry, per-child order, trace isolation, replayStream ancestry, and cancel drain tests present. |
| `src/tests/cancellation-contract.test.ts` | STREAM-03 and ERROR-03 tests | VERIFIED | Parent-aborted drain, timeout reason, provider/engine timeout source, and recursive abort coverage present. |
| `src/tests/public-error-api.test.ts` | ERROR-02 throw matrix tests | VERIFIED | Final synthesis no-throw, runtime identity, abort-mode trigger, replay reconstruction, cancel-wins, and depth overflow tests present. |
| `src/runtime/coordinator.test.ts` | ERROR-01 prompt/context tests | VERIFIED | Failure roster, enriched tagged line, synthetic exclusion, continue/abort behavior, and trigger snapshot tests present. |
| `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, `src/tests/config-validation.test.ts` | Public shape and validation locks | VERIFIED | Event surface, persisted-trace isolation, public option typing, and invalid config behavior covered. |
| `CHANGELOG.md` | Phase 4 public-surface inventory | VERIFIED | Unreleased v0.4.0 section documents Phase 4 `parentRunIds`, aborted event, `onChildFailure`, timeout `detail.source`, structured failures, cancel drain, and throw semantics. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `coordinator.ts:teedEmit` | Parent live stream | `options.streamEvents && options.emit` clone with `parentRunIds` | WIRED | Live-only forwarding exists; original child event is pushed to `childEvents` first. |
| `coordinator.ts:childEvents` | `subResult.trace.events` / partial traces | Original buffered events | WIRED | Persisted child traces remain chain-free; tests assert parent and nested traces contain no persisted `parentRunIds`. |
| `engine.ts:stream()` | Coordinator abort drain | `registerAbortDrain` callback | WIRED | Stream cancel/error paths invoke the active coordinator drain before publishing aborted/error events. |
| `coordinator.ts` failure path | Engine terminal throw | `failureInstancesByChildRunId` map | WIRED | Map is populated before `errorPayloadFromUnknown()` and read by `resolveRuntimeTerminalThrow()`. |
| `engine.ts` replay path | Reconstructed typed errors | `dogpileErrorFromSerializedPayload()` | WIRED | Replay reconstructs fresh `DogpileError` from serialized payload; tests assert `instanceof DogpileError` and payload equality. |
| `cancellation.ts` helper | Engine + coordinator timeout classification | Direct imports/calls | WIRED | Engine deadline path and coordinator enrichment both call `classifyChildTimeoutSource`. |
| `openai-compatible.ts` HTTP errors | Public `provider-timeout` detail | `source: "provider"` | WIRED | 408/504 response mapping stamps timeout source; tests include JSON and non-JSON response bodies. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `src/runtime/coordinator.ts` | Bubbled child event ancestry | Runtime child `RunEvent` plus current `parentRunId` | Yes | FLOWING |
| `src/runtime/coordinator.ts` | Failure roster | Real `sub-run-failed` event payloads via `dispatchWaveFailureFromEvent()` | Yes | FLOWING |
| `src/runtime/engine.ts` | Runtime terminal throw | Per-run `Map<childRunId, DogpileError>` and trace event order | Yes | FLOWING |
| `src/runtime/engine.ts` | Replay terminal throw | Serialized `sub-run-failed.error` payloads in trace | Yes | FLOWING |
| `src/runtime/engine.ts` | Replay stream ancestry | Embedded `subResult.trace` recursion | Yes | FLOWING |
| `src/runtime/cancellation.ts` | Timeout source | Provider/engine context flags | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Focused Phase 04 behavior suite | `pnpm exec vitest run src/tests/streaming-api.test.ts src/tests/cancellation-contract.test.ts src/tests/public-error-api.test.ts src/runtime/coordinator.test.ts src/tests/event-schema.test.ts src/tests/result-contract.test.ts src/tests/config-validation.test.ts` | 7 test files passed, 253 tests passed | PASS |
| Strict TypeScript | `pnpm run typecheck` | `tsc -p tsconfig.json --noEmit` exited 0 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| STREAM-01 | 04-01 | Parent stream emits child events with ancestry and child run id | SATISFIED | `teedEmit` wraps live child events; direct and grandchild stream tests pass. |
| STREAM-02 | 04-01 | Per-child event order is preserved | SATISFIED | Single-child 20-chunk order and parallel-child subsequence tests pass. |
| STREAM-03 | 04-02 | Parent stream cancel cancels/drains children | SATISFIED | Abort drain hook, per-child closed flag, synthetic failure drain, aborted-before-error tests pass. |
| ERROR-01 | 04-03 | Child failures surface to coordinator next decision context | SATISFIED | Failure roster and enriched text are generated; tests prove continue/default paths reissue plan with context. |
| ERROR-02 | 04-04 | Unhandled child failure throws original `DogpileError` unwrapped | SATISFIED | Runtime map preserves same instance; engine selects abort-mode trigger or last real failure; tests cover cancel/depth/final-synthesis precedence. |
| ERROR-03 | 04-04 | Child/provider/parent timeout surfaces are distinguishable | SATISFIED | Provider timeout source, engine deadline source, parent timeout reason, and legacy absent source tests pass. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `src/runtime/replay.ts` | n/a | Planned file absent | Info | Not a goal gap: replay/replayStream live in `src/runtime/engine.ts` in this codebase and are verified by behavior tests. |

### Human Verification Required

None.

### Gaps Summary

No blocking gaps found. Phase 04 goal is achieved in code and tests. The only notable deviation is a stale plan path for `src/runtime/replay.ts`; the required replay behavior exists in `src/runtime/engine.ts` and is covered by focused tests.

---

_Verified: 2026-05-01T15:00:10Z_
_Verifier: the agent (gsd-verifier)_
