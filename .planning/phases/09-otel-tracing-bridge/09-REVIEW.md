---
phase: 09-otel-tracing-bridge
reviewed: 2026-05-02T00:27:29Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - CHANGELOG.md
  - CLAUDE.md
  - docs/developer-usage.md
  - package.json
  - src/index.ts
  - src/runtime/coordinator.ts
  - src/runtime/engine.ts
  - src/runtime/tracing.ts
  - src/runtime/tracing.test.ts
  - src/testing/deterministic-provider.ts
  - src/testing/deterministic-provider.test.ts
  - src/tests/no-otel-imports.test.ts
  - src/tests/otel-tracing-contract.test.ts
  - src/tests/package-exports.test.ts
  - src/types.ts
findings:
  critical: 2
  warning: 0
  info: 0
  total: 2
status: issues_found
---

# Phase 09: Code Review Report

**Reviewed:** 2026-05-02T00:27:29Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Reviewed the Phase 09 OTEL tracing bridge source, public exports, docs, and contract tests. The lockfile was read for dependency context but excluded from the source-file review count per workflow lockfile filtering. The bridge is structurally present, but two public tracing-contract defects remain: per-turn span accounting is wrong after the first cumulative turn, and failed run spans do not carry the advertised run identity/accounting attributes.

Focused verification run:

```sh
pnpm exec vitest run src/runtime/tracing.test.ts src/tests/otel-tracing-contract.test.ts src/tests/no-otel-imports.test.ts src/testing/deterministic-provider.test.ts
```

Result: 4 files / 15 tests passed. The existing tests do not cover the failing cases below.

## Critical Issues

### CR-01: Agent-Turn Span Cost Uses Cumulative Run Cost

**Classification:** BLOCKER

**File:** `src/runtime/engine.ts:820`

**Issue:** `handleTracingEvent()` writes `event.cost.usd` into `dogpile.turn.cost_usd` when closing an `agent-turn` span. `TurnEvent.cost` is cumulative run cost after the turn, not the cost of that turn. On a two-turn sequential run where each provider call costs `0.0001`, the second `dogpile.agent-turn` span reports `dogpile.turn.cost_usd = 0.0002` even though the turn itself cost `0.0001`. The same risk applies to token attributes whenever fallback to `event.cost` is used. This violates the Phase 09 public span-attribute contract for `dogpile.turn.*`.

**Fix:**

Track per-turn model-call accumulation in tracing state and use that when closing the turn span instead of the cumulative event cost.

```ts
type TurnAccum = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

// In TracingState:
readonly turnAccumByAgent: Map<string, TurnAccum>;

// On model-response:
const accum = state.turnAccumByAgent.get(event.agentId) ?? {
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0
};
accum.inputTokens += event.response.usage?.inputTokens ?? 0;
accum.outputTokens += event.response.usage?.outputTokens ?? 0;
accum.costUsd += event.response.costUsd ?? 0;
state.turnAccumByAgent.set(event.agentId, accum);

// On agent-turn:
const accum = state.turnAccumByAgent.get(event.agentId);
turnSpan.setAttribute("dogpile.turn.cost_usd", accum?.costUsd ?? 0);
turnSpan.setAttribute("dogpile.turn.input_tokens", accum?.inputTokens ?? 0);
turnSpan.setAttribute("dogpile.turn.output_tokens", accum?.outputTokens ?? 0);
state.turnAccumByAgent.delete(event.agentId);
```

Add an OTEL contract test with at least two sequential turns and assert each `dogpile.agent-turn` span reports the individual provider-call cost, not the cumulative run total.

### CR-02: Failed Run Spans Omit Required Run Attributes

**Classification:** BLOCKER

**File:** `src/runtime/engine.ts:867`

**Issue:** On any thrown or aborted run, `closeRunTracing()` sets only `dogpile.run.outcome = "aborted"` and an error status before ending the run span. Because `dogpile.run.id`, `dogpile.run.cost_usd`, `dogpile.run.turn_count`, `dogpile.run.input_tokens`, and `dogpile.run.output_tokens` are only populated from a completed `RunResult`, failed spans are missing the run identity and accounting attributes advertised in `CHANGELOG.md` and `docs/developer-usage.md`. This makes error traces hard to correlate with stream events or partial traces exactly when observability is most needed.

**Fix:**

Record best-effort run attributes as events pass through tracing, then apply them on the error path before ending the run span.

```ts
interface TracingState {
  // existing fields...
  runId?: string;
  turnCount: number;
  lastCost?: CostSummary;
}

function handleTracingEvent(state: TracingState, event: RunEvent): void {
  if (state.runId === undefined) {
    state.runId = event.runId;
    state.runSpan.setAttribute("dogpile.run.id", event.runId);
  }

  if (event.type === "agent-turn") {
    state.turnCount += 1;
    state.lastCost = event.cost;
  } else if (event.type === "budget-stop" || event.type === "final") {
    state.lastCost = event.cost;
  }

  // existing switch...
}

function closeRunTracing(state: TracingState, result: RunResult | undefined, error?: unknown): void {
  if (error !== undefined) {
    const cost = state.lastCost ?? { usd: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    state.runSpan.setAttribute("dogpile.run.turn_count", state.turnCount);
    state.runSpan.setAttribute("dogpile.run.cost_usd", cost.usd);
    state.runSpan.setAttribute("dogpile.run.input_tokens", cost.inputTokens);
    state.runSpan.setAttribute("dogpile.run.output_tokens", cost.outputTokens);
    state.runSpan.setAttribute("dogpile.run.outcome", "aborted");
    state.runSpan.setStatus("error", error instanceof Error ? error.message : String(error));
    closeOpenTracingSpans(state);
    state.runSpan.end();
    return;
  }

  // existing success path...
}
```

Add an OTEL contract test with a provider that throws after at least one emitted event and assert the finished `dogpile.run` span has `dogpile.run.id`, `dogpile.run.outcome = "aborted"`, `dogpile.run.turn_count`, and error status.

---

_Reviewed: 2026-05-02T00:27:29Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
