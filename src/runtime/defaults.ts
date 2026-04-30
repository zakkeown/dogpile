import type {
  AgentSpec,
  Budget,
  CostSummary,
  Protocol,
  ProtocolConfig,
  ReplayTraceBudget,
  ReplayTraceFinalOutput,
  ReplayTraceProtocolDecision,
  ReplayTraceProtocolDecisionType,
  ReplayTraceProviderCall,
  ReplayTraceRunInputs,
  ReplayTraceBudgetStateChange,
  ReplayTraceSeed,
  RunResult,
  RunAccounting,
  RunEvent,
  RunEventLog,
  RunMetadata,
  RunUsage,
  Tier,
  TranscriptEntry,
  TranscriptLink
} from "../types.js";

type SerializableRecord = Record<string, unknown>;

export function normalizeProtocol(protocol: Protocol | ProtocolConfig): ProtocolConfig {
  if (typeof protocol !== "string") {
    return protocol;
  }

  switch (protocol) {
    case "sequential":
      return { kind: "sequential", maxTurns: 3 };
    case "coordinator":
      return { kind: "coordinator", maxTurns: 3 };
    case "broadcast":
      return { kind: "broadcast", maxRounds: 2 };
    case "shared":
      return { kind: "shared", maxTurns: 3 };
  }
}

export function defaultAgents(): readonly AgentSpec[] {
  return [
    { id: "agent-1", role: "planner", instructions: "Frame the mission and identify the important constraints." },
    { id: "agent-2", role: "critic", instructions: "Stress-test the previous contribution and improve weak spots." },
    { id: "agent-3", role: "synthesizer", instructions: "Produce the final useful answer from the accumulated work." }
  ];
}

export function orderAgentsForTemperature(
  agents: readonly AgentSpec[],
  temperature: number,
  seed?: string | number
): readonly AgentSpec[] {
  if (temperature !== 0) {
    return agents;
  }

  if (seed !== undefined) {
    return [...agents].sort((left, right) => compareAgentsBySeededSelection(left, right, seed));
  }

  return [...agents].sort(compareAgentsByStableIdentity);
}

function compareAgentsBySeededSelection(left: AgentSpec, right: AgentSpec, seed: string | number): number {
  const leftScore = deterministicSelectionScore(seed, left);
  const rightScore = deterministicSelectionScore(seed, right);
  if (leftScore !== rightScore) {
    return leftScore - rightScore;
  }

  return compareAgentsByStableIdentity(left, right);
}

function deterministicSelectionScore(seed: string | number, agent: AgentSpec): number {
  return stableHash(`${String(seed)}\u0000${agent.id}\u0000${agent.role}\u0000${agent.instructions ?? ""}`);
}

function stableHash(input: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function compareAgentsByStableIdentity(left: AgentSpec, right: AgentSpec): number {
  const idOrder = left.id.localeCompare(right.id);
  if (idOrder !== 0) {
    return idOrder;
  }

  const roleOrder = left.role.localeCompare(right.role);
  if (roleOrder !== 0) {
    return roleOrder;
  }

  return (left.instructions ?? "").localeCompare(right.instructions ?? "");
}

export function tierTemperature(tier: Tier): number {
  switch (tier) {
    case "fast":
      return 0;
    case "balanced":
      return 0.2;
    case "quality":
      return 0.4;
  }
}

export function emptyCost(): CostSummary {
  return { usd: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

export function addCost(left: CostSummary, right: CostSummary): CostSummary {
  return {
    usd: left.usd + right.usd,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens
  };
}

export function createTranscriptLink(transcript: readonly TranscriptEntry[]): TranscriptLink {
  return {
    kind: "trace-transcript",
    entryCount: transcript.length,
    lastEntryIndex: transcript.length === 0 ? null : transcript.length - 1
  };
}

export function createRunEventLog(runId: string, protocol: Protocol, events: readonly RunEvent[]): RunEventLog {
  return {
    kind: "run-event-log",
    runId,
    protocol,
    eventTypes: events.map((event) => event.type),
    eventCount: events.length,
    events
  };
}

export function createRunUsage(cost: CostSummary): RunUsage {
  return {
    usd: cost.usd,
    inputTokens: cost.inputTokens,
    outputTokens: cost.outputTokens,
    totalTokens: cost.totalTokens
  };
}

export function createRunAccounting(options: {
  readonly tier: Tier;
  readonly budget?: Omit<Budget, "tier">;
  readonly termination?: ReplayTraceBudget["termination"];
  readonly cost: CostSummary;
  readonly events: readonly RunEvent[];
}): RunAccounting {
  const usage = createRunUsage(options.cost);
  return {
    kind: "run-accounting",
    tier: options.tier,
    ...(options.budget ? { budget: options.budget } : {}),
    ...(options.termination ? { termination: options.termination } : {}),
    usage,
    cost: options.cost,
    budgetStateChanges: createReplayTraceBudgetStateChanges(options.events),
    ...(options.budget?.maxUsd !== undefined
      ? { usdCapUtilization: options.budget.maxUsd === 0 ? 0 : options.cost.usd / options.budget.maxUsd }
      : {}),
    ...(options.budget?.maxTokens !== undefined
      ? {
          totalTokenCapUtilization:
            options.budget.maxTokens === 0 ? 0 : options.cost.totalTokens / options.budget.maxTokens
        }
      : {})
  };
}

export function createRunMetadata(options: {
  readonly runId: string;
  readonly protocol: Protocol;
  readonly tier: Tier;
  readonly modelProviderId: string;
  readonly agentsUsed: readonly AgentSpec[];
  readonly events: readonly RunEvent[];
}): RunMetadata {
  const firstEvent = options.events[0];
  const lastEvent = options.events.at(-1);
  return {
    runId: options.runId,
    protocol: options.protocol,
    tier: options.tier,
    modelProviderId: options.modelProviderId,
    agentsUsed: options.agentsUsed,
    startedAt: firstEvent?.at ?? "",
    completedAt: lastEvent?.at ?? ""
  };
}

export function createReplayTraceRunInputs(options: {
  readonly intent: string;
  readonly protocol: ProtocolConfig;
  readonly tier: Tier;
  readonly modelProviderId: string;
  readonly agents: readonly AgentSpec[];
  readonly temperature: number;
}): ReplayTraceRunInputs {
  return {
    kind: "replay-trace-run-inputs",
    intent: options.intent,
    protocol: options.protocol,
    tier: options.tier,
    modelProviderId: options.modelProviderId,
    agents: options.agents,
    temperature: options.temperature
  };
}

export function createReplayTraceBudget(options: {
  readonly tier: Tier;
  readonly caps?: Omit<Budget, "tier">;
  readonly termination?: ReplayTraceBudget["termination"];
}): ReplayTraceBudget {
  return {
    kind: "replay-trace-budget",
    tier: options.tier,
    ...(options.caps ? { caps: options.caps } : {}),
    ...(options.termination ? { termination: options.termination } : {})
  };
}

export function createReplayTraceBudgetStateChanges(
  events: readonly RunEvent[]
): readonly ReplayTraceBudgetStateChange[] {
  return events.flatMap((event, eventIndex): ReplayTraceBudgetStateChange[] => {
    switch (event.type) {
      case "agent-turn":
      case "broadcast":
      case "final":
        return [
          {
            kind: "replay-trace-budget-state-change",
            eventIndex,
            eventType: event.type,
            at: event.at,
            cost: event.cost
          }
        ];
      case "budget-stop":
        return [
          {
            kind: "replay-trace-budget-state-change",
            eventIndex,
            eventType: event.type,
            at: event.at,
            cost: event.cost,
            iteration: event.iteration,
            elapsedMs: event.elapsedMs,
            budgetReason: event.reason
          }
        ];
      case "role-assignment":
      case "model-request":
      case "model-response":
      case "model-output-chunk":
      case "tool-call":
      case "tool-result":
      case "sub-run-started":
      case "sub-run-completed":
      case "sub-run-failed":
        return [];
    }
  });
}

export function createReplayTraceSeed(seed: string | number | undefined): ReplayTraceSeed {
  if (seed === undefined) {
    return {
      kind: "replay-trace-seed",
      source: "none",
      value: null
    };
  }

  return {
    kind: "replay-trace-seed",
    source: "caller",
    value: seed
  };
}

export function createReplayTraceProtocolDecisions(
  protocol: Protocol,
  events: readonly RunEvent[]
): readonly ReplayTraceProtocolDecision[] {
  return events.map((event, eventIndex): ReplayTraceProtocolDecision => {
    return createReplayTraceProtocolDecision(protocol, event, eventIndex);
  });
}

export function createReplayTraceProtocolDecision(
  protocol: Protocol,
  event: RunEvent,
  eventIndex: number,
  options: {
    readonly decision?: ReplayTraceProtocolDecisionType;
    readonly turn?: number;
    readonly phase?: ReplayTraceProtocolDecision["phase"];
    readonly round?: number;
    readonly transcriptEntryCount?: number;
    readonly contributionCount?: number;
  } = {}
): ReplayTraceProtocolDecision {
  const base = {
    kind: "replay-trace-protocol-decision" as const,
    eventIndex,
    eventType: event.type,
    protocol,
    decision: options.decision ?? defaultProtocolDecision(event),
    at: event.at,
    ...(options.turn !== undefined ? { turn: options.turn } : {}),
    ...(options.phase !== undefined ? { phase: options.phase } : {}),
    ...(options.round !== undefined ? { round: options.round } : {}),
    ...(options.transcriptEntryCount !== undefined ? { transcriptEntryCount: options.transcriptEntryCount } : {}),
    ...(options.contributionCount !== undefined ? { contributionCount: options.contributionCount } : {})
  };

  switch (event.type) {
    case "role-assignment":
      return {
        ...base,
        agentId: event.agentId,
        role: event.role
      };
    case "model-request":
      return {
        ...base,
        agentId: event.agentId,
        role: event.role,
        callId: event.callId,
        providerId: event.providerId,
        input: event.request.messages.map((message) => message.content).join("\n")
      };
    case "model-response":
      return {
        ...base,
        agentId: event.agentId,
        role: event.role,
        callId: event.callId,
        providerId: event.providerId,
        output: event.response.text
      };
    case "model-output-chunk":
      return {
        ...base,
        agentId: event.agentId,
        role: event.role,
        input: event.input,
        output: event.output
      };
    case "tool-call":
      return {
        ...base,
        toolCallId: event.toolCallId,
        tool: event.tool,
        input: stableJsonStringify(event.input),
        ...eventAgentScope(event)
      };
    case "tool-result":
      return {
        ...base,
        toolCallId: event.toolCallId,
        tool: event.tool,
        output: stableJsonStringify(event.result),
        ...eventAgentScope(event)
      };
    case "agent-turn":
      return {
        ...base,
        agentId: event.agentId,
        role: event.role,
        input: event.input,
        output: event.output,
        cost: event.cost
      };
    case "broadcast":
      return {
        ...base,
        round: event.round,
        contributionCount: options.contributionCount ?? event.contributions.length,
        cost: event.cost
      };
    case "budget-stop":
      return {
        ...base,
        cost: event.cost,
        budgetReason: event.reason
      };
    case "final":
      return {
        ...base,
        output: event.output,
        cost: event.cost
      };
    case "sub-run-started":
      return {
        ...base,
        input: event.intent
      };
    case "sub-run-completed":
      return {
        ...base,
        output: event.subResult.output,
        cost: event.subResult.cost
      };
    case "sub-run-failed":
      return {
        ...base
      };
  }
}

function defaultProtocolDecision(event: RunEvent): ReplayTraceProtocolDecisionType {
  switch (event.type) {
    case "role-assignment":
      return "assign-role";
    case "model-request":
      return "start-model-call";
    case "model-response":
      return "complete-model-call";
    case "model-output-chunk":
      return "observe-model-output";
    case "tool-call":
      return "start-tool-call";
    case "tool-result":
      return "complete-tool-call";
    case "agent-turn":
      return "select-agent-turn";
    case "broadcast":
      return "collect-broadcast-round";
    case "budget-stop":
      return "stop-for-budget";
    case "final":
      return "finalize-output";
    case "sub-run-started":
      return "start-sub-run";
    case "sub-run-completed":
      return "complete-sub-run";
    case "sub-run-failed":
      return "fail-sub-run";
  }
}

function eventAgentScope(event: {
  readonly agentId?: string;
  readonly role?: string;
}): Pick<ReplayTraceProtocolDecision, "agentId" | "role"> {
  return {
    ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
    ...(event.role !== undefined ? { role: event.role } : {})
  };
}

export function createReplayTraceFinalOutput(output: string, event: RunEvent): ReplayTraceFinalOutput {
  if (event.type === "final") {
    return {
      kind: "replay-trace-final-output",
      output,
      cost: event.cost,
      completedAt: event.at,
      transcript: event.transcript
    };
  }

  return {
    kind: "replay-trace-final-output",
    output,
    cost: emptyCost(),
    completedAt: event.at,
    transcript: {
      kind: "trace-transcript",
      entryCount: 0,
      lastEntryIndex: null
    }
  };
}

export function nextProviderCallId(
  runId: string,
  providerCalls: readonly ReplayTraceProviderCall[]
): string {
  return `${runId}:provider-call:${providerCalls.length + 1}`;
}

/**
 * Normalize completed run artifacts into deterministic JSON shapes.
 *
 * This keeps caller-owned persistence stable across runtimes: object keys are
 * sorted recursively, undefined object fields are omitted, non-finite numbers
 * become JSON `null`, and negative zero is normalized to zero before callers
 * serialize the returned result, trace, event log, transcript, or metadata.
 */
export function canonicalizeRunResult(result: RunResult): RunResult {
  const trace = canonicalizeSerializable(result.trace);
  const eventLog: RunEventLog = {
    eventCount: trace.events.length,
    eventTypes: trace.events.map((event) => event.type),
    events: trace.events,
    kind: "run-event-log",
    protocol: trace.protocol,
    runId: trace.runId
  };
  const canonicalResult = {
    accounting: canonicalizeSerializable(result.accounting),
    cost: canonicalizeSerializable(result.cost),
    ...(result.evaluation !== undefined ? { evaluation: canonicalizeSerializable(result.evaluation) } : {}),
    eventLog,
    metadata: canonicalizeSerializable(result.metadata),
    output: result.output,
    ...(result.quality !== undefined ? { quality: canonicalizeSerializable(result.quality) } : {}),
    trace,
    transcript: trace.transcript,
    usage: canonicalizeSerializable(result.usage)
  };

  return canonicalResult;
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalizeSerializable(value));
}

export function canonicalizeSerializable<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeSerializable(item)) as T;
  }

  if (typeof value === "number") {
    if (Object.is(value, -0)) {
      return 0 as T;
    }
    if (!Number.isFinite(value)) {
      return null as T;
    }
    return value;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const input = value as SerializableRecord;
  const output: SerializableRecord = {};
  for (const key of Object.keys(input).sort()) {
    const child = input[key];
    if (child !== undefined) {
      output[key] = canonicalizeSerializable(child);
    }
  }

  return output as T;
}
