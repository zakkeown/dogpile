import type {
  AgentSpec,
  BroadcastContribution,
  BroadcastProtocolConfig,
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
  TerminationCondition,
  TerminationStopRecord,
  Tier,
  TranscriptEntry
} from "../types.js";
import { createRunId, elapsedMs, nowMs, providerCallIdFor } from "./ids.js";
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
  emptyCost
} from "./defaults.js";
import { throwIfAborted } from "./cancellation.js";
import { parseAgentDecision } from "./decisions.js";
import { generateModelTurn } from "./model.js";
import { evaluateTerminationStop, warnOnProtocolTerminationMisconfiguration } from "./termination.js";
import { createRuntimeToolExecutor, executeModelResponseToolRequests, runtimeToolAvailability } from "./tools.js";
import { createWrapUpHintController } from "./wrap-up.js";

interface BroadcastRunOptions {
  readonly intent: string;
  readonly protocol: BroadcastProtocolConfig;
  readonly tier: Tier;
  readonly model: ConfiguredModelProvider;
  readonly agents: readonly AgentSpec[];
  readonly tools: readonly RuntimeTool<JsonObject, JsonValue>[];
  readonly temperature: number;
  readonly budget?: DogpileOptions["budget"];
  readonly seed?: string | number;
  readonly signal?: AbortSignal;
  readonly terminate?: TerminationCondition;
  readonly wrapUpHint?: DogpileOptions["wrapUpHint"];
  readonly emit?: (event: RunEvent) => void;
}

export async function runBroadcast(options: BroadcastRunOptions): Promise<RunResult> {
  const runId = createRunId();
  const events: RunEvent[] = [];
  const transcript: TranscriptEntry[] = [];
  const protocolDecisions: ReplayTraceProtocolDecision[] = [];
  const providerCalls: ReplayTraceProviderCall[] = [];
  let totalCost = emptyCost();
  const maxRounds = options.protocol.maxRounds ?? 2;
  let firstRoundContributions: readonly BroadcastContribution[] = [];
  let lastContributions: readonly BroadcastContribution[] = [];
  const startedAtMs = nowMs();
  let stopped = false;
  let termination: TerminationStopRecord | undefined;
  const wrapUpHint = createWrapUpHintController({
    protocol: options.protocol,
    tier: options.tier,
    ...(options.budget ? { budget: options.budget } : {}),
    ...(options.terminate ? { terminate: options.terminate } : {}),
    ...(options.wrapUpHint ? { wrapUpHint: options.wrapUpHint } : {})
  });

  warnOnProtocolTerminationMisconfiguration(options.protocol, options.terminate);

  const emit = (event: RunEvent): void => {
    events.push(event);
    options.emit?.(event);
  };

  const recordProtocolDecision = (
    event: RunEvent,
    decisionOptions?: Parameters<typeof createReplayTraceProtocolDecision>[3]
  ): void => {
    protocolDecisions.push(
      createReplayTraceProtocolDecision("broadcast", event, events.length - 1, decisionOptions)
    );
  };

  const toolExecutor = createRuntimeToolExecutor({
    runId,
    protocol: "broadcast",
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

  for (const agent of options.agents) {
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

  for (let round = 1; round <= maxRounds; round += 1) {
    if (stopIfNeeded()) {
      break;
    }

    const providerCallSlots: ReplayTraceProviderCall[] = [];
    const turnResults = await Promise.all(
      options.agents.map(async (agent, agentIndex) => {
        const turn = transcript.length + agentIndex + 1;
        const input = buildBroadcastInput(options.intent, round, maxRounds, firstRoundContributions);
        const request: ModelRequest = {
          temperature: options.temperature,
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
          metadata: {
            runId,
            protocol: "broadcast",
            agentId: agent.id,
            role: agent.role,
            tier: options.tier,
            round,
            ...toolAvailability
          },
          messages: wrapUpHint.inject(
            [
              {
                role: "system",
                content: buildSystemPrompt(agent)
              },
              {
                role: "user",
                content: input
              }
            ],
            {
              runId,
              protocol: "broadcast",
              cost: totalCost,
              events,
              transcript,
              iteration: transcript.length,
              elapsedMs: elapsedMs(startedAtMs)
            }
          )
        };
        const response = await generateModelTurn({
          model: options.model,
          request,
          runId,
          agent,
          input,
          emit,
          callId: providerCallIdFor(runId, providerCalls.length + agentIndex + 1),
          onProviderCall(call): void {
            providerCallSlots[agentIndex] = call;
          }
        });
        const decision = parseAgentDecision(response.text);
        const toolCalls = await executeModelResponseToolRequests({
          response,
          executor: toolExecutor,
          agentId: agent.id,
          role: agent.role,
          turn,
          metadata: {
            round
          }
        });
        throwIfAborted(options.signal, options.model.id);

        return {
          agent,
          agentIndex,
          turn,
          input,
          response,
          decision,
          toolCalls,
          turnCost: responseCost(response)
        };
      })
    );
    providerCalls.push(...providerCallSlots.filter((call): call is ReplayTraceProviderCall => call !== undefined));

    const contributions: BroadcastContribution[] = [];
    for (const result of turnResults) {
      totalCost = addCost(totalCost, result.turnCost);
      transcript.push({
        agentId: result.agent.id,
        role: result.agent.role,
        input: result.input,
        output: result.response.text,
        ...(result.decision !== undefined ? { decision: result.decision } : {}),
        ...(result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {})
      });

      contributions.push({
        agentId: result.agent.id,
        role: result.agent.role,
        output: result.response.text,
        ...(result.decision !== undefined ? { decision: result.decision } : {})
      });

      const event: RunEvent = {
        type: "agent-turn",
        runId,
        at: new Date().toISOString(),
        agentId: result.agent.id,
        role: result.agent.role,
        input: result.input,
        output: result.response.text,
        ...(result.decision !== undefined ? { decision: result.decision } : {}),
        cost: totalCost
      };
      emit(event);
      recordProtocolDecision(event, {
        round,
        turn: result.turn,
        transcriptEntryCount: transcript.length,
        contributionCount: result.agentIndex + 1
      });
    }

    if (contributions.length === 0) {
      break;
    }
    if (round === 1) {
      firstRoundContributions = contributions;
    }
    lastContributions = contributions;

    const broadcast: RunEvent = {
      type: "broadcast",
      runId,
      at: new Date().toISOString(),
      round,
      contributions,
      cost: totalCost
    };
    emit(broadcast);
    recordProtocolDecision(broadcast, {
      round,
      transcriptEntryCount: transcript.length,
      contributionCount: contributions.length
    });

    if (stopIfNeeded()) {
      break;
    }
  }

  const output = synthesizeBroadcastOutput(lastContributions);
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
    eventLog: createRunEventLog(runId, "broadcast", events),
    trace: {
      schemaVersion: "1.0",
      runId,
      protocol: "broadcast",
      tier: options.tier,
      modelProviderId: options.model.id,
      agentsUsed: options.agents,
      inputs: createReplayTraceRunInputs({
        intent: options.intent,
        protocol: options.protocol,
        tier: options.tier,
        modelProviderId: options.model.id,
        agents: options.agents,
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
      protocol: "broadcast",
      tier: options.tier,
      modelProviderId: options.model.id,
      agentsUsed: options.agents,
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

    const stopRecord = evaluateTerminationStop(
      options.terminate,
      wrapUpHint.context({
        runId,
        protocol: "broadcast",
        protocolConfig: options.protocol,
        protocolIteration: broadcastRoundsCompleted(events),
        cost: totalCost,
        events,
        transcript,
        iteration: transcript.length,
        elapsedMs: elapsedMs(startedAtMs)
      })
    );

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

function broadcastRoundsCompleted(events: readonly RunEvent[]): number {
  return events.filter((event) => event.type === "broadcast").length;
}

function buildSystemPrompt(agent: AgentSpec): string {
  const instruction = agent.instructions ? `\nInstructions: ${agent.instructions}` : "";
  return `You are ${agent.id}, acting as ${agent.role} in a Broadcast multi-agent protocol.${instruction}`;
}

function buildBroadcastInput(
  intent: string,
  round: number,
  maxRounds: number,
  firstRoundContributions: readonly BroadcastContribution[]
): string {
  if (maxRounds === 1) {
    return `Mission: ${intent}\nBroadcast round ${round}: contribute independently before synthesis.`;
  }
  if (round === 1) {
    return `Mission: ${intent}\nBroadcast round 1: broadcast your intended role and participation decision. Do not produce the final plan yet.`;
  }

  const intentions = firstRoundContributions
    .map((contribution) => `${contribution.role}:${contribution.agentId} => ${contribution.output}`)
    .join("\n");
  return `Mission: ${intent}\n\nRound 1 intentions:\n${intentions || "(none)"}\n\nBroadcast round ${round}: make your final contribution or abstention decision informed by all round 1 intentions.`;
}

function synthesizeBroadcastOutput(contributions: readonly BroadcastContribution[]): string {
  return contributions.map((entry) => `${entry.role}:${entry.agentId} => ${entry.output}`).join("\n");
}

function responseCost(response: ModelResponse): CostSummary {
  return {
    usd: response.costUsd ?? 0,
    inputTokens: response.usage?.inputTokens ?? 0,
    outputTokens: response.usage?.outputTokens ?? 0,
    totalTokens: response.usage?.totalTokens ?? 0
  };
}

