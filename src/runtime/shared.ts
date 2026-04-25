import type {
  AgentSpec,
  ConfiguredModelProvider,
  CostSummary,
  DogpileOptions,
  JsonObject,
  JsonValue,
  ModelRequest,
  ModelResponse,
  ReplayTraceProtocolDecision,
  ReplayTraceProviderCall,
  RuntimeTool,
  RunEvent,
  RunResult,
  SharedProtocolConfig,
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

interface SharedRunOptions {
  readonly intent: string;
  readonly protocol: SharedProtocolConfig;
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

export async function runShared(options: SharedRunOptions): Promise<RunResult> {
  const runId = createRunId();
  const events: RunEvent[] = [];
  const transcript: TranscriptEntry[] = [];
  const protocolDecisions: ReplayTraceProtocolDecision[] = [];
  const providerCalls: ReplayTraceProviderCall[] = [];
  let totalCost = emptyCost();
  let sharedState = "";
  const maxTurns = options.protocol.maxTurns ?? options.agents.length;
  const activeAgents = options.agents.slice(0, maxTurns);
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
    protocolDecisions.push(createReplayTraceProtocolDecision("shared", event, events.length - 1, decisionOptions));
  };

  const toolExecutor = createRuntimeToolExecutor({
    runId,
    protocol: "shared",
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

  for (const [index, agent] of activeAgents.entries()) {
    if (stopIfNeeded()) {
      break;
    }

    const turn = index + 1;
    const input = buildSharedInput(options.intent, sharedState, turn);
    const request: ModelRequest = {
      temperature: options.temperature,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      metadata: {
        runId,
        protocol: "shared",
        agentId: agent.id,
        role: agent.role,
        tier: options.tier,
        turn,
        ...toolAvailability
      },
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(agent)
        },
        {
          role: "user",
          content: input
        }
      ]
    };
    const response = await generateModelTurn({
      model: options.model,
      request,
      runId,
      agent,
      input,
      emit,
      callId: nextProviderCallId(runId, providerCalls),
      onProviderCall(call): void {
        providerCalls.push(call);
      }
    });
    const turnCost = responseCost(response);
    totalCost = addCost(totalCost, turnCost);
    const toolCalls = await executeModelResponseToolRequests({
      response,
      executor: toolExecutor,
      agentId: agent.id,
      role: agent.role,
      turn
    });
    throwIfAborted(options.signal, options.model.id);
    sharedState = appendSharedState(sharedState, agent, response.text);

    transcript.push({
      agentId: agent.id,
      role: agent.role,
      input,
      output: response.text,
      ...(toolCalls.length > 0 ? { toolCalls } : {})
    });

    const event: RunEvent = {
      type: "agent-turn",
      runId,
      at: new Date().toISOString(),
      agentId: agent.id,
      role: agent.role,
      input,
      output: response.text,
      cost: totalCost
    };
    emit(event);
    recordProtocolDecision(event, {
      turn,
      transcriptEntryCount: transcript.length
    });

    if (stopIfNeeded()) {
      break;
    }
  }

  const output = sharedState;
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
    eventLog: createRunEventLog(runId, "shared", events),
    trace: {
      schemaVersion: "1.0",
      runId,
      protocol: "shared",
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
      protocol: "shared",
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
      protocol: "shared",
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

function buildSystemPrompt(agent: AgentSpec): string {
  const instruction = agent.instructions ? `\nInstructions: ${agent.instructions}` : "";
  return `You are ${agent.id}, acting as ${agent.role} in a Shared multi-agent protocol. Read the shared state, update it with your best contribution, and preserve useful prior work.${instruction}`;
}

function buildSharedInput(intent: string, sharedState: string, turn: number): string {
  const state = sharedState ? sharedState : "(empty)";
  return `Mission: ${intent}\nShared turn ${turn}: read the shared state and return an improved shared-state update.\n\nShared state:\n${state}`;
}

function appendSharedState(sharedState: string, agent: AgentSpec, output: string): string {
  const entry = `${agent.role}:${agent.id} => ${output}`;
  return sharedState ? `${sharedState}\n${entry}` : entry;
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
