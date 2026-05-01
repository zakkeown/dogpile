import { describe, expect, it } from "vitest";
import { createAuditRecord } from "./audit.js";
import type { CostSummary, RunEvent, Trace } from "../types.js";
import type { BudgetStopEvent, FinalEvent, SubRunCompletedEvent, TurnEvent } from "../types/events.js";

const runId = "run-audit-test";
const at = "2026-05-01T00:00:00.000Z";

describe("createAuditRecord", () => {
  it("returns auditSchemaVersion 1 for any trace", () => {
    const result = createAuditRecord(traceWith([]));

    expect(result.auditSchemaVersion).toBe("1");
  });

  it("passes through runId, intent, protocol, tier, and modelProviderId from trace fields", () => {
    const result = createAuditRecord(
      traceWith([], {
        intent: "audit this",
        protocol: "coordinator",
        tier: "quality",
        modelProviderId: "provider-a"
      })
    );

    expect(result.runId).toBe(runId);
    expect(result.intent).toBe("audit this");
    expect(result.protocol).toBe("coordinator");
    expect(result.tier).toBe("quality");
    expect(result.modelProviderId).toBe("provider-a");
  });

  it("derives startedAt from trace.events[0].at", () => {
    const result = createAuditRecord(traceWith([turnEvent("agent-1", "writer", "2026-05-01T00:00:02.000Z")]));

    expect(result.startedAt).toBe("2026-05-01T00:00:02.000Z");
  });

  it("derives startedAt from model activity events that use startedAt instead of at", () => {
    const result = createAuditRecord(traceWith([modelRequestEvent("2026-05-01T00:00:03.000Z")]));

    expect(result.startedAt).toBe("2026-05-01T00:00:03.000Z");
  });

  it("derives completedAt from trace.finalOutput.completedAt", () => {
    const result = createAuditRecord(traceWith([], { completedAt: "2026-05-01T00:00:05.000Z" }));

    expect(result.completedAt).toBe("2026-05-01T00:00:05.000Z");
  });

  it("sets outcome.status to completed when a FinalEvent is present", () => {
    const result = createAuditRecord(traceWith([finalEvent(0.0003, 21, 12)]));

    expect(result.outcome).toEqual({ status: "completed" });
  });

  it("sets budget-stopped outcome with terminationCode from BudgetStopEvent.reason", () => {
    const result = createAuditRecord(traceWith([budgetStopEvent("cost")]));

    expect(result.outcome).toEqual({ status: "budget-stopped", terminationCode: "cost" });
  });

  it("keeps budget-stopped outcome when a budget stop is followed by a final event", () => {
    const result = createAuditRecord(traceWith([budgetStopEvent("iterations"), finalEvent(0, 0, 0)]));

    expect(result.outcome).toEqual({ status: "budget-stopped", terminationCode: "iterations" });
  });

  it("sets outcome.status to aborted when no terminal event exists", () => {
    const result = createAuditRecord(traceWith([turnEvent("agent-1")]));

    expect(result.outcome).toEqual({ status: "aborted" });
  });

  it("passes through tokens budget stop as terminationCode", () => {
    const result = createAuditRecord(traceWith([budgetStopEvent("tokens")]));

    expect(result.outcome.terminationCode).toBe("tokens");
  });

  it("counts only agent-turn events for turnCount", () => {
    const broadcastEvent = {
      type: "broadcast",
      runId,
      at,
      round: 1,
      contributions: [],
      cost: costSummary(0.0002)
    } as unknown as RunEvent;
    const result = createAuditRecord(
      traceWith([turnEvent("agent-1"), broadcastEvent, turnEvent("agent-2"), turnEvent("agent-1")])
    );

    expect(result.turnCount).toBe(3);
  });

  it("counts distinct agentIds from agent-turn events for agentCount", () => {
    const result = createAuditRecord(traceWith([turnEvent("agent-1"), turnEvent("agent-2"), turnEvent("agent-1")]));

    expect(result.agentCount).toBe(2);
  });

  it("keeps agentCount equal to agents.length", () => {
    const result = createAuditRecord(traceWith([turnEvent("agent-1"), turnEvent("agent-2"), turnEvent("agent-1")]));

    expect(result.agentCount).toBe(result.agents.length);
  });

  it("sorts agents by id ascending", () => {
    const result = createAuditRecord(
      traceWith([turnEvent("agent-9", "reviewer"), turnEvent("agent-2", "planner"), turnEvent("agent-9", "reviewer")])
    );

    expect(result.agents).toEqual([
      { id: "agent-2", role: "planner", turnCount: 1 },
      { id: "agent-9", role: "reviewer", turnCount: 2 }
    ]);
  });

  it("omits childRunIds when no sub-run-completed events exist", () => {
    const result = createAuditRecord(traceWith([turnEvent("agent-1")]));

    expect("childRunIds" in result).toBe(false);
  });

  it("includes childRunIds from sub-run-completed events", () => {
    const result = createAuditRecord(traceWith([subRunCompletedEvent("child-run-abc")]));

    expect(result.childRunIds).toEqual(["child-run-abc"]);
  });

  it("derives cost fields from FinalEvent.cost for completed runs", () => {
    const result = createAuditRecord(traceWith([turnEvent("agent-1"), finalEvent(0.0003, 21, 12)]));

    expect(result.cost).toEqual({ usd: 0.0003, inputTokens: 21, outputTokens: 12 });
  });

  it("returns identical output for the same trace", () => {
    const trace = traceWith([turnEvent("agent-1"), finalEvent(0.0003, 21, 12)]);

    expect(createAuditRecord(trace)).toEqual(createAuditRecord(trace));
  });
});

function traceWith(
  events: readonly RunEvent[],
  options: {
    readonly finalUsd?: number;
    readonly intent?: string;
    readonly protocol?: string;
    readonly tier?: string;
    readonly modelProviderId?: string;
    readonly completedAt?: string;
  } = {}
): Trace {
  return {
    runId,
    protocol: options.protocol ?? "sequential",
    tier: options.tier ?? "balanced",
    modelProviderId: options.modelProviderId ?? "test-provider",
    inputs: { intent: options.intent ?? "test intent" },
    events,
    finalOutput: {
      kind: "replay-trace-final-output",
      completedAt: options.completedAt ?? at,
      cost: costSummary(options.finalUsd ?? 0),
      output: "",
      transcript: { kind: "trace-transcript", entryCount: 0, lastEntryIndex: null }
    }
  } as unknown as Trace;
}

function turnEvent(agentId: string, role?: string, eventAt: string = at): TurnEvent {
  return {
    type: "agent-turn",
    runId,
    at: eventAt,
    agentId,
    role: role ?? `role-${agentId}`,
    input: "input",
    output: "output",
    cost: costSummary(0.0001)
  };
}

function finalEvent(usd: number, inputTokens: number, outputTokens: number): FinalEvent {
  return {
    type: "final",
    runId,
    at,
    cost: { usd, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
  } as unknown as FinalEvent;
}

function budgetStopEvent(reason: "cost" | "tokens" | "iterations" | "timeout"): BudgetStopEvent {
  return {
    type: "budget-stop",
    runId,
    at,
    reason,
    cost: costSummary(0.001)
  } as unknown as BudgetStopEvent;
}

function modelRequestEvent(startedAt: string): RunEvent {
  return {
    type: "model-request",
    runId,
    startedAt,
    callId: "call-audit-test",
    providerId: "test-provider",
    modelId: "test-model",
    agentId: "agent-1",
    role: "writer",
    request: { messages: [] }
  } as unknown as RunEvent;
}

function subRunCompletedEvent(childRunId: string): SubRunCompletedEvent {
  return {
    type: "sub-run-completed",
    runId,
    at,
    childRunId
  } as unknown as SubRunCompletedEvent;
}

function costSummary(usd: number): CostSummary {
  return {
    usd,
    inputTokens: Math.round(usd * 1000),
    outputTokens: Math.round(usd * 2000),
    totalTokens: Math.round(usd * 3000)
  };
}
