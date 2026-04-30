import { DogpileError } from "../types.js";
import type {
  AgentSpec,
  ConfiguredModelProvider,
  CoordinatorProtocolConfig,
  CostSummary,
  DelegateAgentDecision,
  DogpileOptions,
  JsonObject,
  JsonValue,
  ModelRequest,
  ModelResponse,
  ProtocolSelection,
  ReplayTraceProtocolDecision,
  ReplayTraceProviderCall,
  RuntimeTool,
  RuntimeToolExecutor,
  RunEvent,
  RunResult,
  SubRunFailedEvent,
  TerminationCondition,
  TerminationStopRecord,
  Tier,
  Trace,
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
  emptyCost,
  nextProviderCallId
} from "./defaults.js";
import { throwIfAborted } from "./cancellation.js";
import { parseAgentDecision } from "./decisions.js";
import { generateModelTurn } from "./model.js";
import { evaluateTerminationStop, warnOnProtocolTerminationMisconfiguration } from "./termination.js";
import { createRuntimeToolExecutor, executeModelResponseToolRequests, runtimeToolAvailability } from "./tools.js";
import { createWrapUpHintController } from "./wrap-up.js";

/**
 * Callback to invoke a child run via the engine's `runProtocol` switch. Passed
 * in by `engine.ts` so coordinator avoids a circular import.
 */
export type RunProtocolFn = (input: {
  readonly intent: string;
  readonly protocol: ProtocolSelection;
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
  readonly currentDepth?: number;
  readonly effectiveMaxDepth?: number;
}) => Promise<RunResult>;

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
  readonly wrapUpHint?: DogpileOptions["wrapUpHint"];
  readonly emit?: (event: RunEvent) => void;
  /**
   * Recursion depth of this coordinator run. Top-level callers pass 0; child
   * sub-runs receive parent depth + 1 from the dispatch loop.
   */
  readonly currentDepth?: number;
  /**
   * Effective max recursion depth resolved at run start. Plan 04 enforces;
   * Plan 03 only plumbs the value.
   */
  readonly effectiveMaxDepth?: number;
  /**
   * Engine `runProtocol` callback used by the delegate dispatch loop to
   * recursively run a child protocol. Optional so unit tests that exercise
   * the coordinator without the engine wrapper still typecheck — when omitted,
   * delegate dispatch falls back to throwing `invalid-configuration`.
   */
  readonly runProtocol?: RunProtocolFn;
}

/**
 * Hard-coded loop guard for the delegate dispatch in the coordinator plan
 * turn. After this many consecutive delegate decisions the coordinator throws
 * `invalid-configuration` (T-03-01). Not a public option.
 */
const MAX_DISPATCH_PER_TURN = 8;

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
      // Delegate dispatch loop (D-11/D-16/D-17/D-18). Phase 1 limits delegation
      // to the coordinator's plan turn; workers cannot delegate. The loop
      // re-issues the coordinator plan turn after each successful sub-run with
      // the projected D-17 result tagged into the next prompt and a synthetic
      // D-18 transcript entry already appended. `partialTrace` for failed
      // sub-runs is captured via a tee'd emit buffer locally — `runProtocol`'s
      // error contract is unchanged.
      let dispatchInput = buildCoordinatorPlanInput(options.intent, coordinator);
      let dispatchCount = 0;
      while (true) {
        const turnOutcome = await runCoordinatorTurn({
          agent: coordinator,
          coordinator,
          input: dispatchInput,
          phase: "plan",
          options,
          runId,
          transcript,
          totalCost,
          providerCalls,
          toolExecutor,
          toolAvailability,
          events,
          startedAtMs,
          wrapUpHint,
          emit,
          recordProtocolDecision
        });
        totalCost = turnOutcome.totalCost;

        if (turnOutcome.decision?.type !== "delegate") {
          break;
        }

        if (dispatchCount >= MAX_DISPATCH_PER_TURN) {
          throw new DogpileError({
            code: "invalid-configuration",
            message: `Coordinator plan turn delegated more than ${MAX_DISPATCH_PER_TURN} times without participating`,
            retryable: false,
            detail: {
              kind: "delegate-validation",
              path: "decision",
              reason: "loop-guard-exceeded",
              maxDispatchPerTurn: MAX_DISPATCH_PER_TURN
            }
          });
        }
        dispatchCount += 1;

        const parentDecisionId = String(events.length - 1);
        const dispatchResult = await dispatchDelegate({
          decision: turnOutcome.decision,
          parentDecisionId,
          parentDepth: options.currentDepth ?? 0,
          parentRunId: runId,
          options,
          transcript,
          emit,
          recordProtocolDecision
        });
        dispatchInput = dispatchResult.nextInput;
      }
      stopIfNeeded();
    }

    if (!stopIfNeeded()) {
      const workers = activeAgents.slice(1);
      const providerCallSlots: ReplayTraceProviderCall[] = [];
      const planTranscript = [...transcript];
      const workerResults = await Promise.all(
        workers.map((agent, index) =>
          runCoordinatorWorkerTurn({
            agent,
            coordinator,
            input: buildWorkerInput(options.intent, planTranscript, coordinator),
            options,
            runId,
            turn: transcript.length + index + 1,
            providerCallId: providerCallIdFor(runId, providerCalls.length + index + 1),
            providerCallIndex: index,
            providerCallSlots,
            toolExecutor,
            toolAvailability,
            totalCost,
            events,
            transcript: planTranscript,
            startedAtMs,
            wrapUpHint,
            emit
          })
        )
      );
      providerCalls.push(...providerCallSlots.filter((call): call is ReplayTraceProviderCall => call !== undefined));

      for (const result of workerResults) {
        totalCost = addCost(totalCost, result.turnCost);
        transcript.push({
          agentId: result.agent.id,
          role: result.agent.role,
          input: result.input,
          output: result.response.text,
          ...(result.decision !== undefined ? { decision: result.decision } : {}),
          ...(result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {})
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
          turn: transcript.length,
          phase: "worker",
          transcriptEntryCount: transcript.length
        });
      }
      stopIfNeeded();
    }

    if (!stopIfNeeded()) {
      const synthesisOutcome = await runCoordinatorTurn({
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
        events,
        startedAtMs,
        wrapUpHint,
        emit,
        recordProtocolDecision
      });
      totalCost = synthesisOutcome.totalCost;
      // Phase 1: final-synthesis turn cannot delegate.
      if (synthesisOutcome.decision?.type === "delegate") {
        throw new DogpileError({
          code: "invalid-configuration",
          message: "Coordinator final-synthesis turn cannot emit a delegate decision in Phase 1",
          retryable: false,
          detail: {
            kind: "delegate-validation",
            path: "decision",
            phase: "final-synthesis"
          }
        });
      }
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

    const stopRecord = evaluateTerminationStop(
      options.terminate,
      wrapUpHint.context({
        runId,
        protocol: "coordinator",
        protocolConfig: options.protocol,
        protocolIteration: transcript.length,
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
  readonly events: RunEvent[];
  readonly startedAtMs: number;
  readonly wrapUpHint: ReturnType<typeof createWrapUpHintController>;
  readonly emit: (event: RunEvent) => void;
  readonly recordProtocolDecision: (
    event: RunEvent,
    decisionOptions?: Parameters<typeof createReplayTraceProtocolDecision>[3]
  ) => void;
}

interface CoordinatorTurnResult {
  readonly totalCost: CostSummary;
  readonly decision: ReturnType<typeof parseAgentDecision>;
}

async function runCoordinatorTurn(turn: CoordinatorTurnOptions): Promise<CoordinatorTurnResult> {
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
    messages: turn.wrapUpHint.inject(
      [
        {
          role: "system",
          content: buildSystemPrompt(turn.agent, turn.coordinator)
        },
        {
          role: "user",
          content: turn.input
        }
      ],
      {
        runId: turn.runId,
        protocol: "coordinator",
        cost: turn.totalCost,
        events: turn.events,
        transcript: turn.transcript,
        iteration: turn.transcript.length,
        elapsedMs: elapsedMs(turn.startedAtMs)
      }
    )
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
  const decision = parseAgentDecision(response.text, {
    parentProviderId: turn.options.model.id
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
    ...(decision !== undefined ? { decision } : {}),
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
    ...(decision !== undefined ? { decision } : {}),
    cost: totalCost
  };
  turn.emit(event);
  turn.recordProtocolDecision(event, {
    turn: turn.transcript.length,
    phase: turn.phase,
    transcriptEntryCount: turn.transcript.length
  });

  return { totalCost, decision };
}

interface CoordinatorWorkerTurnOptions {
  readonly agent: AgentSpec;
  readonly coordinator: AgentSpec;
  readonly input: string;
  readonly options: CoordinatorRunOptions;
  readonly runId: string;
  readonly turn: number;
  readonly providerCallId: string;
  readonly providerCallIndex: number;
  readonly providerCallSlots: ReplayTraceProviderCall[];
  readonly toolExecutor: RuntimeToolExecutor;
  readonly toolAvailability: JsonObject;
  readonly totalCost: CostSummary;
  readonly events: RunEvent[];
  readonly transcript: readonly TranscriptEntry[];
  readonly startedAtMs: number;
  readonly wrapUpHint: ReturnType<typeof createWrapUpHintController>;
  readonly emit: (event: RunEvent) => void;
}

interface CoordinatorWorkerTurnResult {
  readonly agent: AgentSpec;
  readonly input: string;
  readonly response: ModelResponse;
  readonly decision: ReturnType<typeof parseAgentDecision>;
  readonly toolCalls: Awaited<ReturnType<typeof executeModelResponseToolRequests>>;
  readonly turnCost: CostSummary;
}

async function runCoordinatorWorkerTurn(turn: CoordinatorWorkerTurnOptions): Promise<CoordinatorWorkerTurnResult> {
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
      phase: "worker",
      ...turn.toolAvailability
    },
    messages: turn.wrapUpHint.inject(
      [
        {
          role: "system",
          content: buildSystemPrompt(turn.agent, turn.coordinator)
        },
        {
          role: "user",
          content: turn.input
        }
      ],
      {
        runId: turn.runId,
        protocol: "coordinator",
        cost: turn.totalCost,
        events: turn.events,
        transcript: turn.transcript,
        iteration: turn.turn - 1,
        elapsedMs: elapsedMs(turn.startedAtMs)
      }
    )
  };
  const response = await generateModelTurn({
    model: turn.options.model,
    request,
    runId: turn.runId,
    agent: turn.agent,
    input: turn.input,
    emit: turn.emit,
    callId: turn.providerCallId,
    onProviderCall(call): void {
      turn.providerCallSlots[turn.providerCallIndex] = call;
    }
  });
  const decision = parseAgentDecision(response.text, {
    parentProviderId: turn.options.model.id
  });
  if (decision?.type === "delegate") {
    throw new DogpileError({
      code: "invalid-configuration",
      message: "Workers cannot emit delegate decisions in Phase 1",
      retryable: false,
      detail: {
        kind: "delegate-validation",
        path: "decision",
        phase: "worker"
      }
    });
  }
  const toolCalls = await executeModelResponseToolRequests({
    response,
    executor: turn.toolExecutor,
    agentId: turn.agent.id,
    role: turn.agent.role,
    turn: turn.turn,
    metadata: {
      phase: "worker"
    }
  });
  throwIfAborted(turn.options.signal, turn.options.model.id);

  return {
    agent: turn.agent,
    input: turn.input,
    response,
    decision,
    toolCalls,
    turnCost: responseCost(response)
  };
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

interface DispatchDelegateOptions {
  readonly decision: DelegateAgentDecision;
  readonly parentDecisionId: string;
  readonly parentDepth: number;
  readonly parentRunId: string;
  readonly options: CoordinatorRunOptions;
  readonly transcript: TranscriptEntry[];
  readonly emit: (event: RunEvent) => void;
  readonly recordProtocolDecision: (
    event: RunEvent,
    decisionOptions?: { readonly transcriptEntryCount?: number }
  ) => void;
}

interface DispatchDelegateResult {
  readonly nextInput: string;
}

/**
 * Dispatch a single delegate decision as a recursive sub-run.
 *
 * D-11: child reuses the parent provider object verbatim.
 * D-16: `recursive: true` flag set when both parent and child protocol are
 *   `coordinator`.
 * D-17: tagged result text appended to the next coordinator prompt.
 * D-18: synthetic transcript entry pushed for replay/provenance.
 *
 * On thrown error from the child engine, builds `partialTrace` from a locally
 * tee'd `childEvents` buffer — `runProtocol`'s error contract is unchanged.
 */
async function dispatchDelegate(input: DispatchDelegateOptions): Promise<DispatchDelegateResult> {
  const { decision, options } = input;
  const childRunId = createRunId();
  const recursive = decision.protocol === "coordinator";
  const parentTimeoutMs = options.budget?.timeoutMs;
  const decisionTimeoutMs = decision.budget?.timeoutMs;

  // Compute remaining time per D-12 / planner Q3. If parent has no timeoutMs,
  // child has none either. If decision overrides exceed parent's remaining,
  // throw `invalid-configuration` per the plan.
  let childTimeoutMs: number | undefined;
  if (parentTimeoutMs !== undefined) {
    const remainingMs = Math.max(0, parentTimeoutMs);
    if (decisionTimeoutMs !== undefined) {
      if (decisionTimeoutMs > remainingMs) {
        throw new DogpileError({
          code: "invalid-configuration",
          message: `delegate decision budget.timeoutMs (${decisionTimeoutMs}) exceeds parent's remaining timeout (${remainingMs})`,
          retryable: false,
          detail: {
            kind: "delegate-validation",
            path: "decision.budget.timeoutMs",
            expected: `<= ${remainingMs}`,
            received: String(decisionTimeoutMs)
          }
        });
      }
      childTimeoutMs = decisionTimeoutMs;
    } else {
      childTimeoutMs = remainingMs;
    }
  } else if (decisionTimeoutMs !== undefined) {
    childTimeoutMs = decisionTimeoutMs;
  }

  if (!options.runProtocol) {
    throw new DogpileError({
      code: "invalid-configuration",
      message:
        "Coordinator delegate dispatch requires the engine `runProtocol` callback. " +
        "Use `Dogpile.run` / `createEngine` rather than calling `runCoordinator` directly when delegate is in play.",
      retryable: false,
      detail: {
        kind: "delegate-validation",
        path: "runProtocol"
      }
    });
  }

  // Buffered tee for partialTrace capture — see Plan 03 step 8.
  const childEvents: RunEvent[] = [];
  const parentEmit = input.emit;
  const teedEmit = (event: RunEvent): void => {
    childEvents.push(event);
    options.emit?.(event);
  };
  const childStartedAt = Date.now();

  const startEvent: RunEvent = {
    type: "sub-run-started",
    runId: input.parentRunId,
    at: new Date().toISOString(),
    childRunId,
    parentRunId: input.parentRunId,
    parentDecisionId: input.parentDecisionId,
    protocol: decision.protocol,
    intent: decision.intent,
    depth: input.parentDepth + 1,
    ...(recursive ? { recursive: true } : {})
  };
  parentEmit(startEvent);
  input.recordProtocolDecision(startEvent);

  const childOptions = {
    intent: decision.intent,
    protocol: decision.protocol,
    tier: options.tier,
    model: options.model, // D-11: same provider instance verbatim
    agents: options.agents,
    tools: options.tools,
    temperature: options.temperature,
    ...(childTimeoutMs !== undefined ? { budget: { timeoutMs: childTimeoutMs } } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    emit: teedEmit,
    currentDepth: input.parentDepth + 1,
    ...(options.effectiveMaxDepth !== undefined ? { effectiveMaxDepth: options.effectiveMaxDepth } : {})
  };

  let subResult: RunResult;
  try {
    subResult = await options.runProtocol(childOptions);
  } catch (error) {
    const failedDecision: JsonObject = {
      type: "delegate",
      protocol: decision.protocol,
      intent: decision.intent,
      ...(decision.model !== undefined ? { model: decision.model } : {}),
      ...(decision.budget !== undefined ? { budget: decision.budget as unknown as JsonValue } : {})
    };

    const partialTrace: Trace = buildPartialTrace({
      childRunId,
      events: childEvents,
      startedAtMs: childStartedAt,
      protocol: decision.protocol,
      tier: options.tier,
      modelProviderId: options.model.id,
      agents: options.agents,
      intent: decision.intent,
      temperature: options.temperature,
      ...(childTimeoutMs !== undefined ? { childTimeoutMs } : {}),
      ...(options.seed !== undefined ? { seed: options.seed } : {})
    });

    const errorPayload = errorPayloadFromUnknown(error, failedDecision);
    const failEvent: SubRunFailedEvent = {
      type: "sub-run-failed",
      runId: input.parentRunId,
      at: new Date().toISOString(),
      childRunId,
      parentRunId: input.parentRunId,
      parentDecisionId: input.parentDecisionId,
      error: errorPayload,
      partialTrace
    };
    parentEmit(failEvent);
    input.recordProtocolDecision(failEvent);

    // Re-throw a DogpileError so the parent run terminates with a typed error.
    if (DogpileError.isInstance(error)) {
      throw error;
    }
    throw new DogpileError({
      code: "invalid-configuration",
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
      detail: {
        kind: "delegate-validation",
        path: "decision",
        reason: "child-run-failed"
      }
    });
  }

  const completedEvent: RunEvent = {
    type: "sub-run-completed",
    runId: input.parentRunId,
    at: new Date().toISOString(),
    childRunId,
    parentRunId: input.parentRunId,
    parentDecisionId: input.parentDecisionId,
    subResult
  };
  parentEmit(completedEvent);
  input.recordProtocolDecision(completedEvent);

  // D-18 synthetic transcript entry.
  const decisionAsJson: JsonObject = {
    type: "delegate",
    protocol: decision.protocol,
    intent: decision.intent,
    ...(decision.model !== undefined ? { model: decision.model } : {}),
    ...(decision.budget !== undefined ? { budget: decision.budget as unknown as JsonValue } : {})
  };
  const taggedText = renderSubRunResult(childRunId, subResult);
  input.transcript.push({
    agentId: `sub-run:${childRunId}`,
    role: "delegate-result",
    input: JSON.stringify(decisionAsJson),
    output: taggedText
  });

  // Build the next coordinator prompt by appending the D-17 tagged block.
  const coordinatorAgent = options.agents[0];
  const baseInput = buildCoordinatorPlanInput(input.options.intent, coordinatorAgent ?? {
    id: "coordinator",
    role: "coordinator"
  });
  return {
    nextInput: `${baseInput}\n\n${taggedText}\n\nUsing the sub-run result above, decide the next step (participate or delegate).`
  };
}

/**
 * D-17 prompt-injection helper. Renders a child `RunResult` as the canonical
 * tagged-result block injected into the parent coordinator's next prompt.
 *
 * Format:
 *   `[sub-run <childRunId>]: <output>`
 *   `[sub-run <childRunId> stats]: turns=<N> costUsd=<X> durationMs=<Y>`
 *
 * The stats line is a soft contract — field names stable, ordering stable.
 */
function renderSubRunResult(childRunId: string, subResult: RunResult): string {
  const turns = subResult.transcript.length;
  const costUsd = subResult.cost.usd ?? 0;
  const startedAt = subResult.trace.events[0]?.at;
  const endedAt = subResult.trace.events.at(-1)?.at;
  const durationMs =
    startedAt && endedAt
      ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt))
      : 0;
  return [
    `[sub-run ${childRunId}]: ${subResult.output}`,
    `[sub-run ${childRunId} stats]: turns=${turns} costUsd=${costUsd} durationMs=${durationMs}`
  ].join("\n");
}

/**
 * Build a JSON-serializable {@link Trace} for `sub-run-failed.partialTrace`
 * from a buffered tee of child emits. Keeps `runProtocol`'s error contract
 * unchanged — Plan 03 step 8.
 */
function buildPartialTrace(input: {
  readonly childRunId: string;
  readonly events: readonly RunEvent[];
  readonly startedAtMs: number;
  readonly protocol: ProtocolSelection;
  readonly tier: Tier;
  readonly modelProviderId: string;
  readonly agents: readonly AgentSpec[];
  readonly intent: string;
  readonly temperature: number;
  readonly childTimeoutMs?: number;
  readonly seed?: string | number;
}): Trace {
  const protocolName = typeof input.protocol === "string" ? input.protocol : input.protocol.kind;
  const protocolConfig =
    typeof input.protocol === "string"
      ? ({ kind: input.protocol } as unknown as Parameters<typeof createReplayTraceRunInputs>[0]["protocol"])
      : input.protocol;
  return {
    schemaVersion: "1.0",
    runId: input.childRunId,
    protocol: protocolName,
    tier: input.tier,
    modelProviderId: input.modelProviderId,
    agentsUsed: input.agents,
    inputs: createReplayTraceRunInputs({
      intent: input.intent,
      protocol: protocolConfig,
      tier: input.tier,
      modelProviderId: input.modelProviderId,
      agents: input.agents,
      temperature: input.temperature
    }),
    budget: createReplayTraceBudget({
      tier: input.tier,
      ...(input.childTimeoutMs !== undefined ? { caps: { timeoutMs: input.childTimeoutMs } } : {})
    }),
    budgetStateChanges: createReplayTraceBudgetStateChanges(input.events),
    seed: createReplayTraceSeed(input.seed),
    protocolDecisions: [],
    providerCalls: [],
    finalOutput: {
      kind: "replay-trace-final-output",
      output: "",
      cost: emptyCost(),
      completedAt: new Date().toISOString(),
      transcript: createTranscriptLink([])
    },
    events: input.events,
    transcript: []
  };
}

function errorPayloadFromUnknown(error: unknown, failedDecision: JsonObject): SubRunFailedEvent["error"] {
  if (DogpileError.isInstance(error)) {
    const detail: JsonObject = {
      ...(error.detail ?? {}),
      failedDecision
    };
    return {
      code: error.code,
      message: error.message,
      ...(error.providerId !== undefined ? { providerId: error.providerId } : {}),
      detail
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "invalid-configuration",
    message,
    detail: { failedDecision }
  };
}

