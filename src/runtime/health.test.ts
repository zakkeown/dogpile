import { describe, expect, it } from "vitest";
import { computeHealth, DEFAULT_HEALTH_THRESHOLDS } from "./health.js";
import type { CostSummary, RunEvent, Trace, TurnEvent } from "../types.js";

const runId = "run-health-test";
const at = "2026-05-01T00:00:00.000Z";

describe("computeHealth", () => {
  it("computes total turn count and distinct agent count from agent-turn events", () => {
    const trace = traceWith([
      turnEvent("agent-1", "first"),
      turnEvent("agent-2", "second"),
      turnEvent("agent-1", "third")
    ]);

    const result = computeHealth(trace);

    expect(result.stats.totalTurns).toBe(3);
    expect(result.stats.agentCount).toBe(2);
  });

  it("computes budget utilization percentage from final cost and max USD cap", () => {
    const trace = traceWith([], { finalUsd: 0.5, budgetCaps: { maxUsd: 1 } });

    const result = computeHealth(trace);

    expect(result.stats.budgetUtilizationPct).toBe(50);
  });

  it("returns null budget utilization when budget caps are absent", () => {
    const trace = traceWith([], { finalUsd: 0.5 });

    const result = computeHealth(trace);

    expect(result.stats.budgetUtilizationPct).toBeNull();
  });

  it("returns null budget utilization when budget caps have no maxUsd", () => {
    const trace = traceWith([], { finalUsd: 0.5, budgetCaps: { maxTokens: 100 } });

    const result = computeHealth(trace);

    expect(result.stats.budgetUtilizationPct).toBeNull();
  });

  it("emits empty-contribution for whitespace-only output", () => {
    const trace = traceWith([turnEvent("agent-blank", "   ")]);

    const result = computeHealth(trace);

    expect(result.anomalies).toContainEqual({
      code: "empty-contribution",
      severity: "error",
      value: 0,
      threshold: 0,
      agentId: "agent-blank"
    });
  });

  it("emits empty-contribution for empty output", () => {
    const trace = traceWith([turnEvent("agent-empty", "")]);

    const result = computeHealth(trace);

    expect(result.anomalies).toContainEqual({
      code: "empty-contribution",
      severity: "error",
      value: 0,
      threshold: 0,
      agentId: "agent-empty"
    });
  });

  it("does not emit empty-contribution for non-empty output", () => {
    const trace = traceWith([turnEvent("agent-clear", "hello")]);

    const result = computeHealth(trace);

    expect(result.anomalies.map((anomaly) => anomaly.code)).not.toContain("empty-contribution");
  });

  it("emits runaway-turns when an agent exceeds the configured threshold", () => {
    const trace = traceWith([
      turnEvent("agent-loop", "one"),
      turnEvent("agent-loop", "two"),
      turnEvent("agent-loop", "three")
    ]);

    const result = computeHealth(trace, { runawayTurns: 2 });

    expect(result.anomalies).toContainEqual({
      code: "runaway-turns",
      severity: "error",
      value: 3,
      threshold: 2,
      agentId: "agent-loop"
    });
  });

  it("does not emit runaway-turns when an agent exactly meets the configured threshold", () => {
    const trace = traceWith([turnEvent("agent-steady", "one"), turnEvent("agent-steady", "two")]);

    const result = computeHealth(trace, { runawayTurns: 2 });

    expect(result.anomalies.map((anomaly) => anomaly.code)).not.toContain("runaway-turns");
  });

  it("suppresses runaway-turns when runawayTurns is undefined", () => {
    const trace = traceWith(
      Array.from({ length: 100 }, (_, index) => turnEvent("agent-many", `turn-${index}`))
    );

    const result = computeHealth(trace, { budgetNearMissPct: 1 });

    expect(result.anomalies.map((anomaly) => anomaly.code)).not.toContain("runaway-turns");
  });

  it("suppresses threshold-gated anomalies with DEFAULT_HEALTH_THRESHOLDS", () => {
    const trace = traceWith(
      Array.from({ length: 100 }, (_, index) => turnEvent("agent-default", `turn-${index}`)),
      { finalUsd: 0.95, budgetCaps: { maxUsd: 1 } }
    );

    const result = computeHealth(trace, DEFAULT_HEALTH_THRESHOLDS);

    expect(result.anomalies.map((anomaly) => anomaly.code)).not.toContain("runaway-turns");
    expect(result.anomalies.map((anomaly) => anomaly.code)).not.toContain("budget-near-miss");
  });

  it("emits budget-near-miss when utilization reaches the configured threshold", () => {
    const trace = traceWith([], { finalUsd: 0.85, budgetCaps: { maxUsd: 1 } });

    const result = computeHealth(trace, { budgetNearMissPct: 80 });

    expect(result.anomalies).toContainEqual({
      code: "budget-near-miss",
      severity: "warning",
      value: 85,
      threshold: 80
    });
  });

  it("does not emit budget-near-miss below the configured threshold", () => {
    const trace = traceWith([], { finalUsd: 0.79, budgetCaps: { maxUsd: 1 } });

    const result = computeHealth(trace, { budgetNearMissPct: 80 });

    expect(result.anomalies.map((anomaly) => anomaly.code)).not.toContain("budget-near-miss");
  });

  it("does not emit budget-near-miss without a maxUsd cap", () => {
    const trace = traceWith([], { finalUsd: 0.95, budgetCaps: { maxTokens: 100 } });

    const result = computeHealth(trace, { budgetNearMissPct: 80 });

    expect(result.anomalies.map((anomaly) => anomaly.code)).not.toContain("budget-near-miss");
  });

  it("never emits provider-error-recovered even when trace-like data includes retry hints", () => {
    const recoveredProviderEvent = {
      type: "model-response",
      runId,
      at,
      agentId: "agent-retry",
      recoveredErrors: 3
    } as unknown as RunEvent;
    const trace = traceWith([recoveredProviderEvent], {
      finalUsd: 0.95,
      budgetCaps: { maxUsd: 1 }
    });

    const result = computeHealth(trace, {
      runawayTurns: 1,
      budgetNearMissPct: 80
    });

    expect(result.anomalies.map((anomaly) => anomaly.code)).not.toContain("provider-error-recovered");
  });

  it("returns empty anomalies and zeroed stats for traces with no turn events", () => {
    const trace = traceWith([]);

    const result = computeHealth(trace);

    expect(result).toEqual({
      anomalies: [],
      stats: {
        totalTurns: 0,
        agentCount: 0,
        budgetUtilizationPct: null
      }
    });
  });

  it("returns identical output for the same trace and thresholds", () => {
    const trace = traceWith([
      turnEvent("agent-deterministic", "one"),
      turnEvent("agent-deterministic", "two"),
      turnEvent("agent-deterministic", "")
    ]);
    const thresholds = { runawayTurns: 2, budgetNearMissPct: 80 };

    const first = computeHealth(trace, thresholds);
    const second = computeHealth(trace, thresholds);

    expect(second).toEqual(first);
  });
});

function traceWith(
  events: readonly RunEvent[],
  options: { readonly finalUsd?: number; readonly budgetCaps?: Record<string, number> } = {}
): Trace {
  return {
    events,
    budget: {
      kind: "replay-trace-budget",
      tier: "balanced",
      ...(options.budgetCaps !== undefined ? { caps: options.budgetCaps } : {})
    },
    finalOutput: {
      kind: "replay-trace-final-output",
      output: "final output",
      cost: costSummary(options.finalUsd ?? 0),
      completedAt: at,
      transcript: {
        kind: "trace-transcript",
        entryCount: 0,
        lastEntryIndex: null
      }
    }
  } as unknown as Trace;
}

function turnEvent(agentId: string, output: string): TurnEvent {
  return {
    type: "agent-turn",
    runId,
    at,
    agentId,
    role: `role-${agentId}`,
    input: `input-${agentId}`,
    output,
    cost: costSummary(0)
  };
}

function costSummary(usd: number): CostSummary {
  return {
    usd,
    inputTokens: Math.round(usd * 1000),
    outputTokens: Math.round(usd * 2000),
    totalTokens: Math.round(usd * 3000)
  };
}
