import { DogpileError } from "../types.js";
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
  Trace,
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

/**
 * Walk a parent's events and accumulate the cost contributed by every
 * sub-run (BUDGET-03 / D-06). Internal helper — not part of the public surface.
 *
 * - `sub-run-completed` events contribute `event.subResult.cost`.
 * - `sub-run-failed` events contribute `event.partialCost` (real provider
 *   spend captured before the throw).
 *
 * Used by the `parent-rollup-drift` parity check in
 * {@link recomputeAccountingFromTrace} to verify the parent's recorded
 * accounting equals `localOnly + Σ children` recursively.
 */
export function accumulateSubRunCost(events: readonly RunEvent[]): CostSummary {
  let total = emptyCost();
  for (const event of events) {
    if (event.type === "sub-run-completed") {
      total = addCost(total, event.subResult.cost);
    } else if (event.type === "sub-run-failed") {
      total = addCost(total, event.partialCost);
    }
  }
  return total;
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
      case "sub-run-parent-aborted":
      case "sub-run-budget-clamped":
      case "sub-run-queued":
      case "sub-run-concurrency-clamped":
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
    case "sub-run-parent-aborted":
      return {
        ...base
      };
    case "sub-run-budget-clamped":
      return {
        ...base
      };
    case "sub-run-queued":
      return {
        ...base,
        childRunId: event.childRunId,
        queuePosition: event.queuePosition
      };
    case "sub-run-concurrency-clamped":
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
    case "sub-run-parent-aborted":
      return "mark-sub-run-parent-aborted";
    case "sub-run-budget-clamped":
      return "mark-sub-run-budget-clamped";
    case "sub-run-queued":
      return "queue-sub-run";
    case "sub-run-concurrency-clamped":
      return "mark-sub-run-concurrency-clamped";
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

/**
 * The eight numeric fields recursively verified by `recomputeAccountingFromTrace`.
 *
 * These are the only summable scalars on `RunAccounting`. Non-numeric fields
 * (`kind`, `tier`, `budget`, `termination`, `budgetStateChanges`) and derived
 * ratios (`usdCapUtilization`, `totalTokenCapUtilization`) are NOT in this set.
 */
const RECOMPUTE_FIELD_ORDER: readonly [
  "cost.usd",
  "cost.inputTokens",
  "cost.outputTokens",
  "cost.totalTokens",
  "usage.usd",
  "usage.inputTokens",
  "usage.outputTokens",
  "usage.totalTokens"
] = [
  "cost.usd",
  "cost.inputTokens",
  "cost.outputTokens",
  "cost.totalTokens",
  "usage.usd",
  "usage.inputTokens",
  "usage.outputTokens",
  "usage.totalTokens"
];

const USD_FIELDS: ReadonlySet<string> = new Set(["cost.usd", "usage.usd"]);
const FLOAT_EPSILON = 1e-9;

function readNumericField(accounting: RunAccounting, field: (typeof RECOMPUTE_FIELD_ORDER)[number]): number {
  switch (field) {
    case "cost.usd":
      return accounting.cost.usd;
    case "cost.inputTokens":
      return accounting.cost.inputTokens;
    case "cost.outputTokens":
      return accounting.cost.outputTokens;
    case "cost.totalTokens":
      return accounting.cost.totalTokens;
    case "usage.usd":
      return accounting.usage.usd;
    case "usage.inputTokens":
      return accounting.usage.inputTokens;
    case "usage.outputTokens":
      return accounting.usage.outputTokens;
    case "usage.totalTokens":
      return accounting.usage.totalTokens;
  }
}

function fieldsEqual(field: (typeof RECOMPUTE_FIELD_ORDER)[number], a: number, b: number): boolean {
  if (USD_FIELDS.has(field)) {
    return Math.abs(a - b) < FLOAT_EPSILON;
  }
  return a === b;
}

function firstDifferingField(
  recorded: RunAccounting,
  recomputed: RunAccounting
): { readonly field: (typeof RECOMPUTE_FIELD_ORDER)[number]; readonly recorded: number; readonly recomputed: number } | null {
  for (const field of RECOMPUTE_FIELD_ORDER) {
    const a = readNumericField(recorded, field);
    const b = readNumericField(recomputed, field);
    if (!fieldsEqual(field, a, b)) {
      return { field, recorded: a, recomputed: b };
    }
  }
  return null;
}

function buildLocalAccounting(trace: Trace): RunAccounting {
  return createRunAccounting({
    tier: trace.tier,
    ...(trace.budget.caps ? { budget: trace.budget.caps } : {}),
    ...(trace.budget.termination ? { termination: trace.budget.termination } : {}),
    cost: trace.finalOutput.cost,
    events: trace.events
  });
}

export function lastCostBearingEventCost(events: readonly RunEvent[]): CostSummary | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined) continue;
    if (
      event.type === "final" ||
      event.type === "agent-turn" ||
      event.type === "broadcast" ||
      event.type === "budget-stop"
    ) {
      return event.cost;
    }
  }
  return null;
}

/**
 * Recompute a parent's `RunAccounting` from a saved `Trace` for replay-time
 * tamper detection.
 *
 * @remarks
 * Returns the parent's local `RunAccounting` (built the same way `replay()`
 * builds it today, from `trace.finalOutput.cost` and `trace.events`). While
 * walking events, every `sub-run-completed` is recursed into and the
 * recomputed child accounting is compared field-by-field to the recorded
 * `event.subResult.accounting`. A mismatch on any of the eight enumerated
 * numeric fields throws `DogpileError({ code: "invalid-configuration" })`
 * with `detail.reason: "trace-accounting-mismatch"` and a concrete
 * `detail.field` identifying the first differing numeric.
 *
 * Pure: no provider calls, no I/O, no clock reads.
 *
 * Non-summed fields (`kind`, `tier`, `budget`, `termination`,
 * `budgetStateChanges`) and derived ratios (`usdCapUtilization`,
 * `totalTokenCapUtilization`) are not in the comparison set.
 */
export function recomputeAccountingFromTrace(trace: Trace): RunAccounting {
  const local = buildLocalAccounting(trace);

  // Parent-level integrity: the recorded `trace.finalOutput.cost` must match
  // the cost on the last cost-bearing event. On a clean trace this holds by
  // construction (every protocol writes `totalCost` into the final event).
  // On a trace where `finalOutput.cost` was mutated without updating the
  // events (or vice versa), this catches the drift.
  const lastEventCost = lastCostBearingEventCost(trace.events);
  if (lastEventCost !== null) {
    const reconstructedFromEvents: RunAccounting = createRunAccounting({
      tier: trace.tier,
      ...(trace.budget.caps ? { budget: trace.budget.caps } : {}),
      ...(trace.budget.termination ? { termination: trace.budget.termination } : {}),
      cost: lastEventCost,
      events: trace.events
    });
    const drift = firstDifferingField(local, reconstructedFromEvents);
    if (drift !== null) {
      throw new DogpileError({
        code: "invalid-configuration",
        message: `Trace accounting mismatch at parent run ${trace.runId}: field "${drift.field}" recorded ${drift.recorded}, recomputed ${drift.recomputed}.`,
        retryable: false,
        detail: {
          kind: "trace-validation",
          reason: "trace-accounting-mismatch",
          eventIndex: -1,
          childRunId: trace.runId,
          field: drift.field,
          recorded: drift.recorded,
          recomputed: drift.recomputed
        }
      });
    }
  }

  // BUDGET-03 / D-04: parent-rollup-drift parity check. Runs BEFORE the
  // child recurse loop so a tampered child cost surfaces with the dedicated
  // `subReason: "parent-rollup-drift"` rather than the generic
  // `trace-accounting-mismatch` from the recurse check.
  //
  // The discriminator: each sub-run-completed event stores cost in TWO places
  // (`subResult.cost` and `subResult.accounting.cost`). They must agree
  // field-by-field — they are the parent-side roll-up source vs the
  // child-side accounting source. Drift indicates someone mutated one without
  // the other. For sub-run-failed events, `partialCost` must equal the cost
  // implied by the partial trace's last cost-bearing event.
  //
  // Plus: Σ children must not exceed the parent's recorded total — cost is
  // monotonic. A child total > parent total is unambiguous tampering.
  for (let eventIndex = 0; eventIndex < trace.events.length; eventIndex += 1) {
    const event = trace.events[eventIndex];
    if (event === undefined) continue;
    if (event.type === "sub-run-completed") {
      const childRecordedRollup = createRunAccounting({
        tier: trace.tier,
        cost: event.subResult.cost,
        events: []
      });
      const childRecordedAccounting = event.subResult.accounting;
      const drift = firstDifferingField(childRecordedAccounting, childRecordedRollup);
      if (drift !== null) {
        throw new DogpileError({
          code: "invalid-configuration",
          message: `Trace parent-rollup mismatch at sub-run ${event.childRunId}: field "${drift.field}" recorded ${drift.recorded} on accounting, ${drift.recomputed} on subResult.cost.`,
          retryable: false,
          detail: {
            kind: "trace-validation",
            reason: "trace-accounting-mismatch",
            subReason: "parent-rollup-drift",
            eventIndex,
            childRunId: event.childRunId,
            field: drift.field,
            recorded: drift.recorded,
            recomputed: drift.recomputed
          }
        });
      }
    } else if (event.type === "sub-run-failed") {
      const partialFromTrace = lastCostBearingEventCost(event.partialTrace.events) ?? emptyCost();
      const recordedAccounting = createRunAccounting({
        tier: trace.tier,
        cost: event.partialCost,
        events: []
      });
      const recomputedAccounting = createRunAccounting({
        tier: trace.tier,
        cost: partialFromTrace,
        events: []
      });
      const drift = firstDifferingField(recordedAccounting, recomputedAccounting);
      if (drift !== null) {
        throw new DogpileError({
          code: "invalid-configuration",
          message: `Trace parent-rollup mismatch at sub-run ${event.childRunId}: partialCost field "${drift.field}" recorded ${drift.recorded}, recomputed ${drift.recomputed} from partialTrace events.`,
          retryable: false,
          detail: {
            kind: "trace-validation",
            reason: "trace-accounting-mismatch",
            subReason: "parent-rollup-drift",
            eventIndex,
            childRunId: event.childRunId,
            field: drift.field,
            recorded: drift.recorded,
            recomputed: drift.recomputed
          }
        });
      }
    }
  }

  // Tree-level monotonicity: Σ children must be ≤ parent's recorded total
  // across all 8 fields. Cost is non-negative and monotonic.
  const subRunTotal = accumulateSubRunCost(trace.events);
  const parentTotal = trace.finalOutput.cost;
  for (const field of RECOMPUTE_FIELD_ORDER) {
    if (field.startsWith("usage.")) continue; // usage mirrors cost; one check is enough.
    const [, key] = field.split(".") as [string, keyof CostSummary];
    const parentValue = parentTotal[key];
    const childValue = subRunTotal[key];
    if (childValue - parentValue > FLOAT_EPSILON) {
      throw new DogpileError({
        code: "invalid-configuration",
        message: `Trace parent-rollup mismatch at run ${trace.runId}: field "${field}" Σ children ${childValue} exceeds parent recorded ${parentValue}.`,
        retryable: false,
        detail: {
          kind: "trace-validation",
          reason: "trace-accounting-mismatch",
          subReason: "parent-rollup-drift",
          eventIndex: -1,
          childRunId: trace.runId,
          field,
          recorded: parentValue,
          recomputed: childValue
        }
      });
    }
  }

  // Child-level integrity: recurse into every sub-run-completed and verify
  // its recorded `subResult.accounting` matches what the child trace recomputes.
  for (let eventIndex = 0; eventIndex < trace.events.length; eventIndex += 1) {
    const event = trace.events[eventIndex];
    if (event === undefined || event.type !== "sub-run-completed") continue;

    const childRecomputed = recomputeAccountingFromTrace(event.subResult.trace);
    const childRecorded = event.subResult.accounting;
    const drift = firstDifferingField(childRecorded, childRecomputed);
    if (drift !== null) {
      throw new DogpileError({
        code: "invalid-configuration",
        message: `Trace accounting mismatch at sub-run ${event.childRunId}: field "${drift.field}" recorded ${drift.recorded}, recomputed ${drift.recomputed}.`,
        retryable: false,
        detail: {
          kind: "trace-validation",
          reason: "trace-accounting-mismatch",
          eventIndex,
          childRunId: event.childRunId,
          field: drift.field,
          recorded: drift.recorded,
          recomputed: drift.recomputed
        }
      });
    }
  }

  return local;
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
