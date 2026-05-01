---
phase: 06-provenance-annotations
reviewed: 2026-05-01T18:57:44Z
depth: standard
files_reviewed: 35
files_reviewed_list:
  - CHANGELOG.md
  - CLAUDE.md
  - package.json
  - src/benchmark/config.test.ts
  - src/benchmark/config.ts
  - src/demo.ts
  - src/internal/vercel-ai.ts
  - src/providers/openai-compatible.ts
  - src/runtime/broadcast.test.ts
  - src/runtime/coordinator.test.ts
  - src/runtime/coordinator.ts
  - src/runtime/defaults.ts
  - src/runtime/engine.ts
  - src/runtime/model.ts
  - src/runtime/provenance.test.ts
  - src/runtime/provenance.ts
  - src/runtime/sequential.test.ts
  - src/runtime/shared.test.ts
  - src/tests/browser-bundle-smoke.test.ts
  - src/tests/cancellation-contract.test.ts
  - src/tests/demo.test.ts
  - src/tests/event-schema.test.ts
  - src/tests/fixtures/provenance-event-v1.json
  - src/tests/package-exports.test.ts
  - src/tests/performance-baseline.test.ts
  - src/tests/provenance-shape.test.ts
  - src/tests/replay-version-skew.test.ts
  - src/tests/result-contract.test.ts
  - src/tests/streaming-api.test.ts
  - src/tests/temperature-zero-ordering.test.ts
  - src/tests/termination-types.test.ts
  - src/tests/v1-release-focused.test.ts
  - src/types.ts
  - src/types/events.ts
  - src/types/replay.ts
findings:
  critical: 2
  warning: 4
  info: 0
  total: 6
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-05-01T18:57:44Z
**Depth:** standard
**Files Reviewed:** 35
**Status:** issues_found

## Summary

Reviewed the provenance event implementation, replay synthesis, provider adapter model IDs, public helper, package exports, docs/changelog, and the listed contract tests. The highest-risk defects are in replay: current traces with already-correct live provenance are stripped and re-synthesized in a way that can reorder streaming/tool/concurrent events, and timestamp normalization treats `model-response` completion events as if they happened at request start.

## Critical Issues

### CR-01: BLOCKER: replay() rewrites current provenance events into the wrong event order

**File:** `src/runtime/engine.ts:970`
**Issue:** `synthesizeProviderEvents()` removes every existing `model-request` / `model-response` event from `trace.events` and re-inserts a request/response pair immediately before each `agent-turn` (lines 970-1007). That corrupts valid current traces, not just legacy traces. For streaming calls, `model-output-chunk` events remain in `baseEvents`, so replayed order becomes `model-output-chunk... model-request, model-response, agent-turn` instead of the live `model-request, model-output-chunk..., model-response, agent-turn`. The same bug can put tool events before the model request, and it flattens concurrent broadcast/shared/coordinator model activity into per-turn request/response pairs. This breaks the replay event-log contract for the new provenance surface.
**Fix:**
```ts
function synthesizeProviderEvents(trace: Trace, providerCalls: readonly ReplayTraceProviderCall[]): readonly RunEvent[] {
  const hasLiveProvenance = trace.events.some(
    (event) => event.type === "model-request" || event.type === "model-response"
  );
  if (hasLiveProvenance) {
    return trace.events;
  }

  // Legacy-only synthesis. Insert request before the first event belonging to
  // the provider call and response immediately before the completed turn, while
  // preserving chunk/tool ordering for traces that already have those events.
}
```

### CR-02: BLOCKER: model-response timestamps are normalized to startedAt instead of completedAt

**File:** `src/runtime/defaults.ts:562`
**Issue:** The shared timestamp helper returns `"at" in event ? event.at : event.startedAt` for all non-`at` events. `ModelResponseEvent` has both `startedAt` and `completedAt`, so `complete-model-call` protocol decisions created through `createReplayTraceProtocolDecision()` are stamped with the request start time instead of the completion time. The same pattern is repeated in user-facing/demo or artifact paths at `src/demo.ts:473`, `src/benchmark/config.ts:100`, and `src/runtime/coordinator.ts:1629`, so response rows and duration calculations can use the wrong boundary.
**Fix:**
```ts
function eventTimestamp(event: RunEvent | undefined): string | undefined {
  if (event === undefined) return undefined;
  if ("at" in event) return event.at;
  if (event.type === "model-response") return event.completedAt;
  return event.startedAt;
}
```

## Warnings

### WR-01: WARNING: replayStream() does not synthesize provenance for legacy traces

**File:** `src/runtime/engine.ts:1120`
**Issue:** `replayStream()` resolves `handle.result` via `replay(trace)`, whose `eventLog.events` may contain synthesized provenance events, but the iterator/subscriber path walks `trace.events` directly through `replayStreamEvents()` (lines 1120-1168). For a legacy trace without model provenance, `await handle.result` reports `model-request` / `model-response`, while iterating the handle never yields them. That gives two incompatible event histories from one replay handle.
**Fix:** Build replay-stream events from the same synthesized event sequence used by `replay()`, then apply the existing recursive `parentRunIds` wrapping. Add a legacy-trace replayStream test that removes provenance events from `trace.events` and asserts iterator/subscriber events match `handle.result.eventLog.events`.

### WR-02: WARNING: provenance request snapshots retain mutable provider-facing references

**File:** `src/runtime/model.ts:141`
**Issue:** `requestForTrace()` returns the original `request.messages` array and `request.metadata` object by reference. The same request object is then handed to the caller-owned provider. If a provider mutates `request.messages` or `request.metadata`, the already-emitted `model-request` event and the recorded `providerCalls` entry are retroactively changed, undermining replay/provenance integrity.
**Fix:**
```ts
function requestForTrace(request: ModelRequest): ModelRequest {
  return {
    messages: request.messages.map((message) => ({ ...message })),
    temperature: request.temperature,
    metadata: JSON.parse(JSON.stringify(request.metadata)) as ModelRequest["metadata"]
  };
}
```

### WR-03: WARNING: frozen fixture tests pass by creating missing fixtures

**File:** `src/tests/provenance-shape.test.ts:40`
**Issue:** The provenance shape test writes `src/tests/fixtures/provenance-event-v1.json` when it is missing. `src/tests/replay-version-skew.test.ts:30` has the same self-healing behavior for the replay fixture. A deleted or uncommitted frozen fixture should fail the test; instead, the test mutates the source tree and passes, hiding a packaging/contract regression.
**Fix:** Fail when the fixture is absent, and move regeneration behind an explicit script or opt-in environment variable that is never enabled in normal CI.

### WR-04: WARNING: changelog announces 0.5.0 while package.json still publishes 0.4.0

**File:** `CHANGELOG.md:3`
**Issue:** The top changelog entry is `## [0.5.0] - 2026-05-01`, but `package.json:3` remains `"version": "0.4.0"`. If this ships as-is, npm/package metadata reports 0.4.0 while release notes describe 0.5.0 provenance behavior.
**Fix:** Either bump all release identity files together for 0.5.0, or move the changelog entry under an `Unreleased` heading until the version bump phase.

---

_Reviewed: 2026-05-01T18:57:44Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
