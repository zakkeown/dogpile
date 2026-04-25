import type {
  AgentSpec,
  ConfiguredModelProvider,
  CoordinatorProtocolConfig,
  CostSummary,
  DogpileOptions,
  JsonObject,
  JsonValue,
  ModelRequest,
  ModelResponse,
  ReplayTraceProtocolDecision,
  ReplayTraceProviderCall,
  RuntimeTool,
  RuntimeToolExecutor,
  RunEvent,
  RunResult,
  TerminationCondition,
  TerminationStopRecord,
  Tier,
  TranscriptEntry
} from "../types.js";
import {
  addCost,
  createReplayTraceBudget,
  createReplayTraceBudgetStateChanges,
  createReplayTraceFinalOutput,
  createReplayTraceProtocolDecision,
  createReplayTraceRunInputs,
  createReplayTraceSeed,
  createRunAccounting,
  createRunEventLog,
  createRunMetadata,
  createRunUsage,
  createTranscriptLink,
  emptyCost,
  nextProviderCallId
} from "./defaults.js";
import { throwIfAborted } from "./cancellation.js";
import { generateModelTurn } from "./model.js";
import { evaluateTerminationStop } from "./termination.js";
import { createRuntimeToolExecutor, executeModelResponseToolRequests, runtimeToolAvailability } from "./tools.js";

interface CoordinatorRunOptions {
  readonly intent: string;
  readonly protocol: CoordinatorProtocolConfig;
  readonly tier: Tier;
  readonly model: ConfiguredModelProvider;
  readonly agents: readonly AgentSpec[];
  readonly tools: readonly RuntimeTool<JsonObject, JsonValue>[];
  readonly temperature: number;
  readonly budget?: DogpileOptions["budget"];
  readonly seed?: string | number;
  readonly signal?: AbortSignal;
  readonly terminate?: TerminationCondition;
  readonly emit?: (event: RunEvent) => void;
}

export async function runCoordinator(options: CoordinatorRunOptions): Promise<RunResult> {
  const runId = createRunId();
  const events: RunEvent[] = [];
  const transcript: TranscriptEntry[] = [];
  const protocolDecisions: ReplayTraceProtocolDecision[] = [];
  const providerCalls: ReplayTraceProviderCall[] = [];
  let totalCost = emptyCost();
  const maxTurns = options.protocol.maxTurns ?? options.agents.length;
  const activeAgents = options.agents.slice(0, maxTurns);
  const coordinator = activeAgents[0];
  const startedAtMs = nowMs();
  let stopped = false;
  let termination: TerminationStopRecord | undefined;

  const emit = (event: RunEvent): void => {
    events.push(event);
    options.emit?.(event);
  };

  const recordProtocolDecision = (
    event: RunEvent,
    decisionOptions?: Parameters<typeof createReplayTraceProtocolDecision>[3]
  ): void => {
    protocolDecisions.push(
      createReplayTraceProtocolDecision("coordinator", event, events.length - 1, decisionOptions)
    );
  };

  const toolExecutor = createRuntimeToolExecutor({
    runId,
    protocol: "coordinator",
    tier: options.tier,
    tools: options.tools,
    emit(event): void {
      emit(event);
      recordProtocolDecision(event);
    },
    getTrace: () => ({ events, transcript }),
    ...(options.signal !== undefined ? { abortSignal: options.signal } : {})
  });
  const toolAvailability = runtimeToolAvailability(toolExecutor.tools);

  throwIfAborted(options.signal, options.model.id);

  for (const agent of activeAgents) {
    const event: RunEvent = {
      type: "role-assignment",
      runId,
      at: new Date().toISOString(),
      agentId: agent.id,
      role: agent.role
    };
    emit(event);
    recordProtocolDecision(event);
  }

  if (coordinator) {
    if (!stopIfNeeded()) {
      totalCost = await runCoordinatorTurn({
        agent: coordinator,
        coordinator,
        input: buildCoordinatorPlanInput(options.intent, coordinator),
        phase: "plan",
        options,
        runId,
        transcript,
        totalCost,
        providerCalls,
        toolExecutor,
        toolAvailability,
        emit,
        recordProtocolDecision
      });
      stopIfNeeded();
    }

    for (const agent of activeAgents.slice(1)) {
      if (stopIfNeeded()) {
        break;
      }

      totalCost = await runCoordinatorTurn({
        agent,
        coordinator,
        input: buildWorkerInput(options.intent, transcript, coordinator),
        phase: "worker",
        options,
        runId,
        transcript,
        totalCost,
        providerCalls,
        toolExecutor,
        toolAvailability,
        emit,
        recordProtocolDecision
      });
      stopIfNeeded();
    }

    if (!stopIfNeeded()) {
      totalCost = await runCoordinatorTurn({
        agent: coordinator,
        coordinator,
        input: buildFinalSynthesisInput(options.intent, transcript, coordinator),
        phase: "final-synthesis",
        options,
        runId,
        transcript,
        totalCost,
        providerCalls,
        toolExecutor,
        toolAvailability,
        emit,
        recordProtocolDecision
      });
      stopIfNeeded();
    }
  }

  const output = transcript.at(-1)?.output ?? "";
  throwIfAborted(options.signal, options.model.id);
  const final: RunEvent = {
    type: "final",
    runId,
    at: new Date().toISOString(),
    output,
    cost: totalCost,
    transcript: createTranscriptLink(transcript),
    ...(termination !== undefined ? { termination } : {})
  };
  emit(final);
  recordProtocolDecision(final, {
    transcriptEntryCount: transcript.length
  });
  const finalEvent = events.at(-1);

  return {
    output,
    eventLog: createRunEventLog(runId, "coordinator", events),
    trace: {
      schemaVersion: "1.0",
      runId,
      protocol: "coordinator",
      tier: options.tier,
      modelProviderId: options.model.id,
      agentsUsed: activeAgents,
      inputs: createReplayTraceRunInputs({
        intent: options.intent,
        protocol: options.protocol,
        tier: options.tier,
        modelProviderId: options.model.id,
        agents: activeAgents,
        temperature: options.temperature
      }),
      budget: createReplayTraceBudget({
        tier: options.tier,
        ...(options.budget ? { caps: options.budget } : {}),
        ...(options.terminate ? { termination: options.terminate } : {})
      }),
      budgetStateChanges: createReplayTraceBudgetStateChanges(events),
      seed: createReplayTraceSeed(options.seed),
      protocolDecisions,
      providerCalls,
      finalOutput: createReplayTraceFinalOutput(output, finalEvent ?? {
        type: "final",
        runId,
        at: "",
        output,
        cost: totalCost,
        transcript: createTranscriptLink(transcript)
      }),
      events,
      transcript
    },
    transcript,
    usage: createRunUsage(totalCost),
    metadata: createRunMetadata({
      runId,
      protocol: "coordinator",
      tier: options.tier,
      modelProviderId: options.model.id,
      agentsUsed: activeAgents,
      events
    }),
    accounting: createRunAccounting({
      tier: options.tier,
      ...(options.budget ? { budget: options.budget } : {}),
      ...(options.terminate ? { termination: options.terminate } : {}),
      cost: totalCost,
      events
    }),
    cost: totalCost
  };

  function stopIfNeeded(): boolean {
    throwIfAborted(options.signal, options.model.id);

    if (stopped || !options.terminate) {
      return stopped;
    }

    const stopRecord = evaluateTerminationStop(options.terminate, {
      runId,
      protocol: "coordinator",
      tier: options.tier,
      cost: totalCost,
      events,
      transcript,
      iteration: transcript.length,
      elapsedMs: elapsedMs(startedAtMs)
    });

    if (!stopRecord) {
      return false;
    }

    stopped = true;
    termination = stopRecord;
    if (stopRecord.reason === "budget") {
      emitBudgetStop(stopRecord);
    }
    return true;
  }

  function emitBudgetStop(record: TerminationStopRecord): void {
    const event: RunEvent = {
      type: "budget-stop",
      runId,
      at: new Date().toISOString(),
      reason: record.budgetReason ?? "cost",
      cost: totalCost,
      iteration: transcript.length,
      elapsedMs: elapsedMs(startedAtMs),
      detail: record.detail ?? {}
    };
    emit(event);
    recordProtocolDecision(event, {
      transcriptEntryCount: transcript.length
    });
  }
}

interface CoordinatorTurnOptions {
  readonly agent: AgentSpec;
  readonly coordinator: AgentSpec;
  readonly input: string;
  readonly phase: "plan" | "worker" | "final-synthesis";
  readonly options: CoordinatorRunOptions;
  readonly runId: string;
  readonly transcript: TranscriptEntry[];
  readonly totalCost: CostSummary;
  readonly providerCalls: ReplayTraceProviderCall[];
  readonly toolExecutor: RuntimeToolExecutor;
  readonly toolAvailability: JsonObject;
  readonly emit: (event: RunEvent) => void;
  readonly recordProtocolDecision: (
    event: RunEvent,
    decisionOptions?: Parameters<typeof createReplayTraceProtocolDecision>[3]
  ) => void;
}

async function runCoordinatorTurn(turn: CoordinatorTurnOptions): Promise<CostSummary> {
  throwIfAborted(turn.options.signal, turn.options.model.id);

  const request: ModelRequest = {
    temperature: turn.options.temperature,
    ...(turn.options.signal !== undefined ? { signal: turn.options.signal } : {}),
    metadata: {
      runId: turn.runId,
      protocol: "coordinator",
      agentId: turn.agent.id,
      role: turn.agent.role,
      coordinatorAgentId: turn.coordinator.id,
      tier: turn.options.tier,
      phase: turn.phase,
      ...turn.toolAvailability
    },
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(turn.agent, turn.coordinator)
      },
      {
        role: "user",
        content: turn.input
      }
    ]
  };
  const response = await generateModelTurn({
    model: turn.options.model,
    request,
    runId: turn.runId,
    agent: turn.agent,
    input: turn.input,
    emit: turn.emit,
    callId: nextProviderCallId(turn.runId, turn.providerCalls),
    onProviderCall(call): void {
      turn.providerCalls.push(call);
    }
  });
  const totalCost = addCost(turn.totalCost, responseCost(response));
  const toolCalls = await executeModelResponseToolRequests({
    response,
    executor: turn.toolExecutor,
    agentId: turn.agent.id,
    role: turn.agent.role,
    turn: turn.transcript.length + 1,
    metadata: {
      phase: turn.phase
    }
  });
  throwIfAborted(turn.options.signal, turn.options.model.id);

  turn.transcript.push({
    agentId: turn.agent.id,
    role: turn.agent.role,
    input: turn.input,
    output: response.text,
    ...(toolCalls.length > 0 ? { toolCalls } : {})
  });

  const event: RunEvent = {
    type: "agent-turn",
    runId: turn.runId,
    at: new Date().toISOString(),
    agentId: turn.agent.id,
    role: turn.agent.role,
    input: turn.input,
    output: response.text,
    cost: totalCost
  };
  turn.emit(event);
  turn.recordProtocolDecision(event, {
    turn: turn.transcript.length,
    phase: turn.phase,
    transcriptEntryCount: turn.transcript.length
  });

  return totalCost;
}

function buildSystemPrompt(agent: AgentSpec, coordinator: AgentSpec | undefined): string {
  const instruction = agent.instructions ? `\nInstructions: ${agent.instructions}` : "";
  const coordinatorText =
    coordinator && agent.id === coordinator.id
      ? "You are the coordinator: assign work, integrate worker contributions, and produce the final answer."
      : `You are a worker managed by coordinator ${coordinator?.id ?? "unknown"}.`;
  return `You are ${agent.id}, acting as ${agent.role} in a Coordinator multi-agent protocol. ${coordinatorText}${instruction}`;
}

function buildCoordinatorPlanInput(intent: string, coordinator: AgentSpec): string {
  return `Mission: ${intent}\nCoordinator ${coordinator.id}: assign the work, name the plan, and provide the first contribution.`;
}

function buildWorkerInput(
  intent: string,
  transcript: readonly TranscriptEntry[],
  coordinator: AgentSpec
): string {
  const prior = transcript
    .map((entry) => `${entry.role} (${entry.agentId}): ${entry.output}`)
    .join("\n\n");
  return `Mission: ${intent}\n\nCoordinator: ${coordinator.id}\nPrior contributions:\n${prior}\n\nFollow the coordinator-managed plan and provide your assigned contribution.`;
}

function buildFinalSynthesisInput(
  intent: string,
  transcript: readonly TranscriptEntry[],
  coordinator: AgentSpec
): string {
  const prior = transcript
    .map((entry) => `${entry.role} (${entry.agentId}): ${entry.output}`)
    .join("\n\n");
  return `Mission: ${intent}\n\nCoordinator: ${coordinator.id}\nPrior contributions:\n${prior}\n\nSynthesize the final answer as the coordinator.`;
}

function responseCost(response: ModelResponse): CostSummary {
  return {
    usd: response.costUsd ?? 0,
    inputTokens: response.usage?.inputTokens ?? 0,
    outputTokens: response.usage?.outputTokens ?? 0,
    totalTokens: response.usage?.totalTokens ?? 0
  };
}

function createRunId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `run-${Date.now().toString(36)}`;
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function elapsedMs(startedAtMs: number): number {
  return Math.max(0, nowMs() - startedAtMs);
}
