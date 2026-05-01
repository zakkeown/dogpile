import type { Protocol, Tier, Trace } from "../types.js";
import type { BudgetStopEvent, FinalEvent, SubRunCompletedEvent, TurnEvent } from "../types/events.js";

export type AuditOutcomeStatus = "completed" | "budget-stopped" | "aborted";

export interface AuditOutcome {
  readonly status: AuditOutcomeStatus;
  readonly terminationCode?: string;
}

export interface AuditCost {
  readonly usd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface AuditAgentRecord {
  readonly id: string;
  readonly role: string;
  readonly turnCount: number;
}

export interface AuditRecord {
  readonly auditSchemaVersion: "1";
  readonly runId: string;
  readonly intent: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly protocol: Protocol;
  readonly tier: Tier;
  readonly modelProviderId: string;
  readonly agentCount: number;
  readonly turnCount: number;
  readonly outcome: AuditOutcome;
  readonly cost: AuditCost;
  readonly agents: readonly AuditAgentRecord[];
  readonly childRunIds?: readonly string[];
}

/**
 * Derive a versioned, schema-stable audit record from a completed run trace.
 *
 * Pure function - no side effects, no I/O, no storage access. Deterministic:
 * given the same trace, always produces the same AuditRecord.
 *
 * @param trace - Completed run trace (from RunResult.trace or a stored/replayed trace).
 */
export function createAuditRecord(trace: Trace): AuditRecord {
  const finalEvent = trace.events.find((event): event is FinalEvent => event.type === "final");
  const budgetStopEvent = trace.events.find((event): event is BudgetStopEvent => event.type === "budget-stop");

  const outcome: AuditOutcome = budgetStopEvent
    ? { status: "budget-stopped", terminationCode: budgetStopEvent.reason }
    : finalEvent
      ? { status: "completed" }
      : { status: "aborted" };

  const lastTurnCost = [...trace.events]
    .reverse()
    .find((event): event is TurnEvent => event.type === "agent-turn")?.cost;
  const costSource = finalEvent?.cost ?? budgetStopEvent?.cost ?? lastTurnCost;
  const cost: AuditCost = {
    usd: costSource?.usd ?? 0,
    inputTokens: costSource?.inputTokens ?? 0,
    outputTokens: costSource?.outputTokens ?? 0
  };

  const turnEvents = trace.events.filter((event): event is TurnEvent => event.type === "agent-turn");
  const agentTurnMap = new Map<string, { role: string; count: number }>();
  for (const event of turnEvents) {
    const existing = agentTurnMap.get(event.agentId);
    if (existing !== undefined) {
      existing.count++;
    } else {
      agentTurnMap.set(event.agentId, { role: event.role, count: 1 });
    }
  }

  const agents: AuditAgentRecord[] = [...agentTurnMap.entries()]
    .map(([id, { role, count }]) => ({ id, role, turnCount: count }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const childRunIds = trace.events
    .filter((event): event is SubRunCompletedEvent => event.type === "sub-run-completed")
    .map((event) => event.childRunId);

  const startedAt = eventStartedAt(trace.events[0]);

  return {
    auditSchemaVersion: "1",
    runId: trace.runId,
    intent: trace.inputs.intent,
    startedAt,
    completedAt: trace.finalOutput.completedAt,
    protocol: trace.protocol,
    tier: trace.tier,
    modelProviderId: trace.modelProviderId,
    agentCount: agentTurnMap.size,
    turnCount: turnEvents.length,
    outcome,
    cost,
    agents,
    ...(childRunIds.length > 0 ? { childRunIds } : {})
  };
}

function eventStartedAt(event: Trace["events"][number] | undefined): string {
  if (event === undefined) {
    return "";
  }

  if ("at" in event) {
    return event.at;
  }

  if ("startedAt" in event) {
    return event.startedAt;
  }

  return "";
}
