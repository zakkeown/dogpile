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
  SubRunBudgetClampedEvent,
  SubRunConcurrencyClampedEvent,
  SubRunFailedEvent,
  SubRunQueuedEvent,
  SubRunParentAbortedEvent,
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
  lastCostBearingEventCost,
  nextProviderCallId
} from "./defaults.js";
import {
  classifyAbortReason,
  classifyChildTimeoutSource,
  createAbortErrorFromSignal,
  createEngineDeadlineTimeoutError,
  throwIfAborted
} from "./cancellation.js";
import { assertDepthWithinLimit, parseAgentDecision } from "./decisions.js";
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
  readonly streamEvents?: boolean;
  readonly currentDepth?: number;
  readonly effectiveMaxDepth?: number;
  readonly effectiveMaxConcurrentChildren?: number;
  readonly onChildFailure?: DogpileOptions["onChildFailure"];
  /**
   * Root-run deadline (epoch ms). Children inherit `parentDeadlineMs - now()`
   * as their default timeout window so a depth-N child sees the ROOT's deadline,
   * not its immediate parent's freshly-computed value (BUDGET-02 / D-12).
   */
  readonly parentDeadlineMs?: number;
  /**
   * Engine-level fallback sub-run timeout (BUDGET-02 / D-14). Applied only when
   * neither the parent nor the decision specifies a `budget.timeoutMs`.
   */
  readonly defaultSubRunTimeoutMs?: number;
  readonly registerAbortDrain?: (drain: AbortDrainFn) => void;
  readonly failureInstancesByChildRunId?: Map<string, DogpileError>;
}) => Promise<RunResult>;

export type AbortDrainFn = (reason?: unknown) => void;

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
  readonly streamEvents?: boolean;
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
  readonly effectiveMaxConcurrentChildren?: number;
  readonly onChildFailure?: DogpileOptions["onChildFailure"];
  /**
   * Engine `runProtocol` callback used by the delegate dispatch loop to
   * recursively run a child protocol. Optional so unit tests that exercise
   * the coordinator without the engine wrapper still typecheck — when omitted,
   * delegate dispatch falls back to throwing `invalid-configuration`.
   */
  readonly runProtocol?: RunProtocolFn;
  /**
   * Root-run deadline (epoch ms) threaded through every recursive coordinator
   * dispatch (BUDGET-02 / D-12). When set, sub-run dispatches compute their
   * `remainingMs = parentDeadlineMs - Date.now()` against this deadline rather
   * than the parent's full `budget.timeoutMs` window.
   */
  readonly parentDeadlineMs?: number;
  /**
   * Engine-level fallback sub-run timeout (BUDGET-02 / D-14). Applied only when
   * neither the parent nor the decision specifies a `budget.timeoutMs`.
   */
  readonly defaultSubRunTimeoutMs?: number;
  readonly registerAbortDrain?: (drain: AbortDrainFn) => void;
  readonly failureInstancesByChildRunId?: Map<string, DogpileError>;
}

/**
 * Hard-coded loop guard for the delegate dispatch in the coordinator plan
 * turn. After this many consecutive delegate decisions the coordinator throws
 * `invalid-configuration` (T-03-01). Not a public option.
 */
const MAX_DISPATCH_PER_TURN = 8;
const DEFAULT_MAX_CONCURRENT_CHILDREN = 4;

type DispatchWaveFailure = {
  readonly childRunId: string;
  readonly intent: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly detail?: { readonly reason?: string };
  };
  readonly partialCost: { readonly usd: number };
};

interface Semaphore {
  acquire(): Promise<void>;
  release(): void;
  readonly inFlight: number;
  readonly queued: number;
}

function createSemaphore(maxConcurrent: number): Semaphore {
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  return {
    acquire(): Promise<void> {
      if (inFlight < maxConcurrent) {
        inFlight += 1;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        waiters.push(() => {
          inFlight += 1;
          resolve();
        });
      });
    },
    release(): void {
      inFlight -= 1;
      const next = waiters.shift();
      if (next !== undefined) {
        next();
      }
    },
    get inFlight() {
      return inFlight;
    },
    get queued() {
      return waiters.length;
    }
  };
}

/**
 * Walk the coordinator's active provider set and return the FIRST provider
 * whose metadata.locality === "local", or undefined if none found.
 *
 * Walk order (forward-compat): options.model first, then options.agents in
 * declaration order. AgentSpec has no `model` field today (Phase 3 D-11
 * forward-compat scaffolding); the agent walk uses optional chaining and
 * effectively no-ops until a future phase adds AgentSpec.model.
 */
function findFirstLocalProvider(options: CoordinatorRunOptions): ConfiguredModelProvider | undefined {
  if (options.model.metadata?.locality === "local") {
    return options.model;
  }
  // Forward-compat: AgentSpec.model not yet declared (Phase 3 D-11). Walk no-ops today; ready for caller-defined trees in a future milestone.
  for (const agent of options.agents) {
    const agentModel = (agent as { readonly model?: ConfiguredModelProvider }).model;
    if (agentModel?.metadata?.locality === "local") {
      return agentModel;
    }
  }
  return undefined;
}

export async function runCoordinator(options: CoordinatorRunOptions): Promise<RunResult> {
  const runId = createRunId();
  const events: RunEvent[] = [];
  const transcript: TranscriptEntry[] = [];
  const protocolDecisions: ReplayTraceProtocolDecision[] = [];
  const providerCalls: ReplayTraceProviderCall[] = [];
  const dispatchedChildren = new Map<string, DispatchedChild>();
  let totalCost = emptyCost();
  let concurrencyClampEmitted = false; // D-12: emit once per run, never per-engine.
  const maxTurns = options.protocol.maxTurns ?? options.agents.length;
  const activeAgents = options.agents.slice(0, maxTurns);
  const coordinator = activeAgents[0];
  const startedAtMs = nowMs();
  let stopped = false;
  let termination: TerminationStopRecord | undefined;
  let triggeringFailureForAbortMode: DispatchWaveFailure | undefined;
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

  const drainOnParentAbort = (reasonSource?: unknown): void => {
    const reason = classifyAbortReason(reasonSource);
    for (const child of dispatchedChildren.values()) {
      if (child.closed) {
        continue;
      }
      const partialCost = child.started
        ? lastCostBearingEventCost(child.childEvents) ?? emptyCost()
        : emptyCost();
      const partialTrace = buildPartialTrace({
        childRunId: child.childRunId,
        events: [...child.childEvents],
        startedAtMs: child.startedAtMs,
        protocol: child.decision.protocol,
        tier: options.tier,
        modelProviderId: options.model.id,
        agents: options.agents,
        intent: child.decision.intent,
        temperature: options.temperature,
        ...(child.childTimeoutMs !== undefined ? { childTimeoutMs: child.childTimeoutMs } : {}),
        ...(options.seed !== undefined ? { seed: options.seed } : {})
      });
      const failedEvent: SubRunFailedEvent = {
        type: "sub-run-failed",
        runId,
        at: new Date().toISOString(),
        childRunId: child.childRunId,
        parentRunId: runId,
        parentDecisionId: child.parentDecisionId,
        parentDecisionArrayIndex: child.parentDecisionArrayIndex,
        error: child.started
          ? {
            code: "aborted",
            message: "Parent run aborted.",
            detail: {
              reason
            }
          }
          : {
            code: "aborted",
            message: "Sibling delegate failed; queued delegate never started.",
            detail: {
              reason: "sibling-failed"
            }
          },
        partialTrace,
        partialCost
      };
      child.closed = true;
      totalCost = addCost(totalCost, partialCost);
      emit(failedEvent);
      recordProtocolDecision(failedEvent);
    }
  };

  options.registerAbortDrain?.(drainOnParentAbort);

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

        if (turnOutcome.decision === undefined) {
          break;
        }

        const delegates = Array.isArray(turnOutcome.decision)
          ? turnOutcome.decision
          : turnOutcome.decision.type === "delegate"
            ? [turnOutcome.decision]
            : [];
        if (delegates.length === 0) {
          break;
        }

        if (dispatchCount + delegates.length > MAX_DISPATCH_PER_TURN) {
          throw new DogpileError({
            code: "invalid-configuration",
            message: `Coordinator plan turn delegated ${delegates.length} more children after ${dispatchCount}; max is ${MAX_DISPATCH_PER_TURN}.`,
            retryable: false,
            detail: {
              kind: "delegate-validation",
              path: "decision",
              reason: "loop-guard-exceeded",
              maxDispatchPerTurn: MAX_DISPATCH_PER_TURN
            }
          });
        }

        const parentDecisionId = String(events.length - 1);
        const parentDepth = options.currentDepth ?? 0;
        const decisionMax = delegates.reduce(
          (max, delegate) => Math.min(max, delegate.maxConcurrentChildren ?? Number.POSITIVE_INFINITY),
          Number.POSITIVE_INFINITY
        );
        let effectiveForTurn = Math.min(
          options.effectiveMaxConcurrentChildren ?? DEFAULT_MAX_CONCURRENT_CHILDREN,
          decisionMax
        );
        const requestedMax = effectiveForTurn;
        const localProvider = findFirstLocalProvider(options);
        if (localProvider !== undefined) {
          effectiveForTurn = 1;
          if (!concurrencyClampEmitted) {
            const clampEvent: SubRunConcurrencyClampedEvent = {
              type: "sub-run-concurrency-clamped",
              runId,
              at: new Date().toISOString(),
              requestedMax,
              effectiveMax: 1,
              reason: "local-provider-detected",
              providerId: localProvider.id
            };
            emit(clampEvent);
            recordProtocolDecision(clampEvent);
            concurrencyClampEmitted = true;
          }
        }
        const semaphore = createSemaphore(effectiveForTurn);
        const childRunIds = delegates.map(() => createRunId());
        const dispatchedForTurn = delegates.map((delegate, index): DispatchedChild => {
          const childRunId = childRunIds[index];
          if (childRunId === undefined) {
            throw new Error("missing child run id");
          }
          const dispatchedChild: DispatchedChild = {
            childRunId,
            decision: delegate,
            parentDecisionId,
            parentDecisionArrayIndex: index,
            parentDepth,
            controller: new AbortController(),
            removeParentListener: undefined,
            childEvents: [],
            started: false,
            closed: false,
            startedAtMs: Date.now(),
            childTimeoutMs: undefined,
            failure: undefined
          };
          dispatchedChildren.set(childRunId, dispatchedChild);
          return dispatchedChild;
        });
        const dispatchResults: Array<{ readonly index: number; readonly result: DispatchDelegateResult }> = [];
        let firstFailureIndex: number | undefined;

        const tasks = delegates.map(async (delegate, index) => {
          const childRunId = childRunIds[index];
          if (childRunId === undefined) {
            throw new Error("missing child run id");
          }
          if (semaphore.inFlight >= effectiveForTurn) {
            const queuedEvent: SubRunQueuedEvent = {
              type: "sub-run-queued",
              runId,
              at: new Date().toISOString(),
              childRunId,
              parentRunId: runId,
              parentDecisionId,
              parentDecisionArrayIndex: index,
              protocol: delegate.protocol,
              intent: delegate.intent,
              depth: parentDepth + 1,
              queuePosition: semaphore.queued
            };
            emit(queuedEvent);
            recordProtocolDecision(queuedEvent);
          }

          await semaphore.acquire();
          try {
            const dispatchedChild = dispatchedForTurn[index];
            if (!dispatchedChild) {
              throw new Error("missing dispatched child");
            }
            if (firstFailureIndex !== undefined) {
              if (dispatchedChild.closed) {
                dispatchResults.push({
                  index,
                  result: {
                    nextInput: "",
                    taggedText: `[sub-run ${childRunId}]: skipped because the parent run aborted`,
                    completedAtMs: Date.now()
                  }
                });
                return;
              }
              const partialCost = emptyCost();
              const partialTrace = buildPartialTrace({
                childRunId,
                events: [],
                startedAtMs: Date.now(),
                protocol: delegate.protocol,
                tier: options.tier,
                modelProviderId: options.model.id,
                agents: options.agents,
                intent: delegate.intent,
                temperature: options.temperature,
                ...(options.seed !== undefined ? { seed: options.seed } : {})
              });
              const failedEvent: SubRunFailedEvent = {
                type: "sub-run-failed",
                runId,
                at: new Date().toISOString(),
                childRunId,
                parentRunId: runId,
                parentDecisionId,
                parentDecisionArrayIndex: index,
                error: {
                  code: "aborted",
                  message: "Sibling delegate failed; queued delegate never started.",
                  detail: {
                    reason: "sibling-failed"
                  }
                },
                partialTrace,
                partialCost
              };
              emit(failedEvent);
              recordProtocolDecision(failedEvent);
              dispatchedChild.closed = true;
              dispatchResults.push({
                index,
                result: {
                  nextInput: "",
                  taggedText: `[sub-run ${childRunId}]: skipped because a sibling delegate failed`,
                  completedAtMs: Date.now()
                }
              });
              return;
            }
            const result = await dispatchDelegate({
              decision: delegate,
              childRunId,
              parentDecisionId,
              parentDecisionArrayIndex: index,
              parentDepth,
              parentRunId: runId,
              options,
              transcript,
              emit,
              recordProtocolDecision,
              recordSubRunCost: (cost: CostSummary): void => {
                totalCost = addCost(totalCost, cost);
              },
              dispatchedChild
            });
            dispatchResults.push({ index, result });
          } catch (error) {
            firstFailureIndex ??= index;
            if (delegates.length === 1 && options.onChildFailure === "abort") {
              throw error;
            }
            const dispatchedChild = dispatchedForTurn[index];
            const failure = dispatchedChild?.failure;
            const failureMessage = error instanceof Error ? error.message : String(error);
            let taggedText = `[sub-run ${childRunId} failed]: ${failureMessage}`;
            if (failure) {
              const error = failure.error;
              taggedText = `[sub-run ${childRunId} failed | code=${error.code} | spent=$${failure.partialCost.usd.toFixed(3)}]: ${error.message}`;
            }
            dispatchResults.push({
              index,
              result: {
                nextInput: "",
                taggedText,
                completedAtMs: Date.now()
              }
            });
          } finally {
            semaphore.release();
          }
        });
        const settled = await Promise.allSettled(tasks);
        const firstRejected = settled.find((result) => result.status === "rejected");
        if (firstRejected?.status === "rejected" && delegates.length === 1 && options.onChildFailure === "abort") {
          throw firstRejected.reason;
        }

        dispatchResults.sort((a, b) => a.result.completedAtMs - b.result.completedAtMs);
        const taggedResults = dispatchResults.map((entry) => entry.result.taggedText).join("\n\n");
        const currentWaveFailures = dispatchedForTurn
          .map((child) => child.failure)
          .filter((failure): failure is DispatchWaveFailure => failure !== undefined);
        if (options.onChildFailure === "abort" && currentWaveFailures.length > 0) {
          triggeringFailureForAbortMode ??= currentWaveFailures[0];
          break;
        }
        const failuresSection = buildFailuresSection(currentWaveFailures);
        const coordinatorAgent = options.agents[0] ?? { id: "coordinator", role: "coordinator" };
        const baseInput = buildCoordinatorPlanInput(options.intent, coordinatorAgent);
        dispatchInput = [
          baseInput,
          taggedResults,
          failuresSection,
          "Using the sub-run results above, decide the next step (participate or delegate)."
        ].filter((section): section is string => Boolean(section)).join("\n\n");
        dispatchCount += delegates.length;
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
      if (Array.isArray(synthesisOutcome.decision) || synthesisOutcome.decision?.type === "delegate") {
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
      ...(triggeringFailureForAbortMode !== undefined ? { triggeringFailureForAbortMode } : {}),
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
    parentProviderId: turn.options.model.id,
    currentDepth: turn.options.currentDepth ?? 0,
    maxDepth: turn.options.effectiveMaxDepth ?? Number.POSITIVE_INFINITY
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
    parentProviderId: turn.options.model.id,
    currentDepth: turn.options.currentDepth ?? 0,
    maxDepth: turn.options.effectiveMaxDepth ?? Number.POSITIVE_INFINITY
  });
  if (Array.isArray(decision) || decision?.type === "delegate") {
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

function buildFailuresSection(failures: readonly DispatchWaveFailure[]): string | null {
  if (failures.length === 0) {
    return null;
  }
  return [
    "## Sub-run failures since last decision",
    "",
    "```json",
    JSON.stringify(failures, null, 2),
    "```"
  ].join("\n");
}

function dispatchWaveFailureFromEvent(
  intent: string,
  event: SubRunFailedEvent
): DispatchWaveFailure | undefined {
  const reason = typeof event.error.detail?.["reason"] === "string" ? event.error.detail["reason"] : undefined;
  if (reason === "sibling-failed" || reason === "parent-aborted") {
    return undefined;
  }
  return {
    childRunId: event.childRunId,
    intent,
    error: {
      code: event.error.code,
      message: event.error.message,
      ...(reason !== undefined ? { detail: { reason } } : {})
    },
    partialCost: { usd: event.partialCost.usd }
  };
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
  readonly childRunId?: string;
  readonly parentDecisionId: string;
  readonly parentDecisionArrayIndex: number;
  readonly parentDepth: number;
  readonly parentRunId: string;
  readonly options: CoordinatorRunOptions;
  readonly transcript: TranscriptEntry[];
  readonly emit: (event: RunEvent) => void;
  readonly recordProtocolDecision: (
    event: RunEvent,
    decisionOptions?: { readonly transcriptEntryCount?: number }
  ) => void;
  /**
   * BUDGET-03 / D-01 seam: closure-mutation callback that adds child cost
   * (subResult.cost on success, partialCost on failure) into the parent's
   * `totalCost` accumulator. Invoked BEFORE `parentEmit(completedEvent)` /
   * `parentEmit(failEvent)` so the existing "last cost-bearing event ===
   * final.cost" invariant survives unchanged.
   */
  readonly recordSubRunCost: (cost: CostSummary) => void;
  readonly dispatchedChild: DispatchedChild;
}

interface DispatchDelegateResult {
  readonly nextInput: string;
  readonly taggedText: string;
  readonly completedAtMs: number;
}

interface DispatchedChild {
  readonly childRunId: string;
  readonly decision: DelegateAgentDecision;
  readonly parentDecisionId: string;
  readonly parentDecisionArrayIndex: number;
  readonly parentDepth: number;
  readonly controller: AbortController;
  removeParentListener: (() => void) | undefined;
  readonly childEvents: RunEvent[];
  started: boolean;
  closed: boolean;
  startedAtMs: number;
  childTimeoutMs: number | undefined;
  failure: DispatchWaveFailure | undefined;
  /** STREAM-03 hook (Phase 4). Reserved; do not use. */
  readonly streamHandle?: never;
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

  // Dispatcher-time depth gate (D-14). Same error shape as the parser; this
  // is the TOCTOU defense for any state mutation between parse and dispatch.
  // Fires BEFORE sub-run-started is emitted so failed dispatches do not show
  // up in the trace as half-started sub-runs.
  if (options.effectiveMaxDepth !== undefined) {
    assertDepthWithinLimit(input.parentDepth, options.effectiveMaxDepth);
  }

  const childRunId = input.childRunId ?? createRunId();
  const recursive = decision.protocol === "coordinator";
  const decisionTimeoutMs = decision.budget?.timeoutMs;
  const parentDeadlineMs = options.parentDeadlineMs;

  // BUDGET-02 / D-12: deadline-based remaining-time math. Children inherit
  // `parentDeadlineMs - now()`, not a static `parent.budget.timeoutMs`. If the
  // parent's deadline has already elapsed, throw `code: "aborted"` with
  // `detail.reason: "timeout"` BEFORE `sub-run-started` is emitted.
  const remainingMs =
    parentDeadlineMs !== undefined ? Math.max(0, parentDeadlineMs - Date.now()) : undefined;

  if (parentDeadlineMs !== undefined && remainingMs === 0) {
    throw new DogpileError({
      code: "aborted",
      message: "Parent deadline elapsed before sub-run dispatch.",
      retryable: false,
      providerId: options.model.id,
      detail: { reason: "timeout" }
    });
  }

  // Resolve child timeout with precedence (D-12 / D-14):
  //   decision.budget.timeoutMs > parent's remaining > defaultSubRunTimeoutMs > undefined.
  // When the decision-level timeout exceeds the parent's remaining, CLAMP
  // (no longer throw) and emit a `sub-run-budget-clamped` event below.
  let childTimeoutMs: number | undefined;
  let clampedFrom: number | undefined;
  if (remainingMs !== undefined) {
    if (decisionTimeoutMs !== undefined) {
      if (decisionTimeoutMs > remainingMs) {
        clampedFrom = decisionTimeoutMs;
        childTimeoutMs = remainingMs;
      } else {
        childTimeoutMs = decisionTimeoutMs;
      }
    } else {
      childTimeoutMs = remainingMs;
    }
  } else if (decisionTimeoutMs !== undefined) {
    childTimeoutMs = decisionTimeoutMs;
  } else if (options.defaultSubRunTimeoutMs !== undefined) {
    childTimeoutMs = options.defaultSubRunTimeoutMs;
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
  const childEvents = input.dispatchedChild.childEvents;
  const parentEmit = input.emit;
  const teedEmit = (event: RunEvent): void => {
    childEvents.push(event);
    if (input.dispatchedChild.closed) {
      return;
    }
    if (options.streamEvents && options.emit) {
      const inbound = (event as { readonly parentRunIds?: readonly string[] }).parentRunIds;
      options.emit({
        ...event,
        parentRunIds: [input.parentRunId, ...(inbound ?? [])]
      } as RunEvent);
    }
  };
  const childStartedAt = Date.now();
  input.dispatchedChild.startedAtMs = childStartedAt;

  // BUDGET-02 / D-12: emit clamp event BEFORE sub-run-started so the trace
  // records "this child's requested timeout was reduced to fit parent's
  // remaining deadline." Skipped on the happy path (no clamp, no event).
  if (clampedFrom !== undefined && childTimeoutMs !== undefined) {
    const clampEvent: SubRunBudgetClampedEvent = {
      type: "sub-run-budget-clamped",
      runId: input.parentRunId,
      at: new Date().toISOString(),
      childRunId,
      parentRunId: input.parentRunId,
      parentDecisionId: input.parentDecisionId,
      requestedTimeoutMs: clampedFrom,
      clampedTimeoutMs: childTimeoutMs,
      reason: "exceeded-parent-remaining"
    };
    input.emit(clampEvent);
    input.recordProtocolDecision(clampEvent);
  }

  const startEvent: RunEvent = {
    type: "sub-run-started",
    runId: input.parentRunId,
    at: new Date().toISOString(),
    childRunId,
    parentRunId: input.parentRunId,
    parentDecisionId: input.parentDecisionId,
    parentDecisionArrayIndex: input.parentDecisionArrayIndex,
    protocol: decision.protocol,
    intent: decision.intent,
    depth: input.parentDepth + 1,
    ...(recursive ? { recursive: true } : {})
  };
  parentEmit(startEvent);
  input.recordProtocolDecision(startEvent);

  // BUDGET-01 / D-07: derive a per-child AbortController so child engines see
  // their own signal. Listener forwards parent.signal.reason verbatim, so
  // detail.reason classification (parent-aborted vs timeout) is preserved.
  // Phase 4 STREAM-03 hook: per-child cancel handle attaches here.
  const parentSignal = options.signal;
  let removeParentAbortListener: (() => void) | undefined;
  if (parentSignal !== undefined) {
    if (parentSignal.aborted) {
      input.dispatchedChild.controller.abort(parentSignal.reason);
    } else {
      const handler = (): void => {
        input.dispatchedChild.controller.abort(parentSignal.reason);
      };
      parentSignal.addEventListener("abort", handler, { once: true });
      removeParentAbortListener = (): void => {
        parentSignal.removeEventListener("abort", handler);
      };
    }
  }
  input.dispatchedChild.removeParentListener = removeParentAbortListener;
  input.dispatchedChild.started = true;
  input.dispatchedChild.childTimeoutMs = childTimeoutMs;
  const childDeadlineReason =
    childTimeoutMs !== undefined && parentDeadlineMs === undefined
      ? createEngineDeadlineTimeoutError(options.model.id, childTimeoutMs)
      : undefined;
  const childDeadlineTimer =
    childDeadlineReason !== undefined
      ? setTimeout(() => {
        input.dispatchedChild.controller.abort(childDeadlineReason);
      }, childTimeoutMs)
      : undefined;

  const childOptions = {
    intent: decision.intent,
    protocol: decision.protocol,
    tier: options.tier,
    model: options.model, // D-11: same provider instance verbatim
    agents: options.agents,
    tools: options.tools,
    temperature: options.temperature,
    ...(childTimeoutMs !== undefined ? { budget: { timeoutMs: childTimeoutMs } } : {}),
    signal: input.dispatchedChild.controller.signal,
    emit: teedEmit,
    ...(options.streamEvents !== undefined ? { streamEvents: options.streamEvents } : {}),
    currentDepth: input.parentDepth + 1,
    ...(options.effectiveMaxDepth !== undefined ? { effectiveMaxDepth: options.effectiveMaxDepth } : {}),
    ...(options.effectiveMaxConcurrentChildren !== undefined
      ? { effectiveMaxConcurrentChildren: options.effectiveMaxConcurrentChildren }
      : {}),
    ...(options.onChildFailure !== undefined ? { onChildFailure: options.onChildFailure } : {}),
    // BUDGET-02 / D-12: forward the ROOT deadline so depth-N grandchildren
    // see the same `parentDeadlineMs` rather than a fresh per-level snapshot.
    ...(parentDeadlineMs !== undefined ? { parentDeadlineMs } : {}),
    ...(options.defaultSubRunTimeoutMs !== undefined
      ? { defaultSubRunTimeoutMs: options.defaultSubRunTimeoutMs }
      : {})
  };

  let subResult: RunResult;
  try {
    subResult = await options.runProtocol(childOptions);
  } catch (error) {
    if (childDeadlineTimer !== undefined) {
      clearTimeout(childDeadlineTimer);
    }
    removeParentAbortListener?.();
    if (input.dispatchedChild.closed) {
      const enrichedError = enrichAbortErrorWithParentReason(error, parentSignal);
      if (DogpileError.isInstance(enrichedError)) {
        throw enrichedError;
      }
      throw error;
    }

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

    // BUDGET-01 / D-08: when the child aborted because the parent.signal
    // aborted, lock detail.reason on the surfaced error. Upstream engine
    // wrapping (e.g., createStreamCancellationError) attaches its own
    // detail.status; we add detail.reason so consumers can discriminate
    // parent-aborted vs timeout regardless of which engine path produced the
    // abort error.
    const enrichedError = enrichProviderTimeoutSource(
      enrichAbortErrorWithParentReason(error, parentSignal),
      {
        ...(decisionTimeoutMs !== undefined ? { decisionTimeoutMs } : {}),
        ...(options.defaultSubRunTimeoutMs !== undefined
          ? { engineDefaultTimeoutMs: options.defaultSubRunTimeoutMs }
          : {})
      }
    );
    if (DogpileError.isInstance(enrichedError)) {
      options.failureInstancesByChildRunId?.set(childRunId, enrichedError);
    }
    const errorPayload = errorPayloadFromUnknown(enrichedError, failedDecision);
    // BUDGET-03 / D-02: capture real provider spend before the throw and
    // roll it into the parent's totalCost BEFORE emitting sub-run-failed.
    const partialCost = lastCostBearingEventCost(childEvents) ?? emptyCost();
    input.recordSubRunCost(partialCost);
    const failEvent: SubRunFailedEvent = {
      type: "sub-run-failed",
      runId: input.parentRunId,
      at: new Date().toISOString(),
      childRunId,
      parentRunId: input.parentRunId,
      parentDecisionId: input.parentDecisionId,
      parentDecisionArrayIndex: input.parentDecisionArrayIndex,
      error: errorPayload,
      partialTrace,
      partialCost
    };
    parentEmit(failEvent);
    input.recordProtocolDecision(failEvent);
    input.dispatchedChild.closed = true;
    input.dispatchedChild.failure = dispatchWaveFailureFromEvent(decision.intent, failEvent);

    // Re-throw a DogpileError so the parent run terminates with a typed error.
    if (DogpileError.isInstance(enrichedError)) {
      throw enrichedError;
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

  if (childDeadlineTimer !== undefined) {
    clearTimeout(childDeadlineTimer);
  }
  removeParentAbortListener?.();

  // BUDGET-03 / D-01: roll child's full cost into the parent's totalCost
  // BEFORE emitting sub-run-completed. The next agent-turn / final event will
  // read totalCost from the closure scope, preserving the existing
  // "last cost-bearing event === final.cost" invariant.
  input.recordSubRunCost(subResult.cost);

  const completedEvent: RunEvent = {
    type: "sub-run-completed",
    runId: input.parentRunId,
    at: new Date().toISOString(),
    childRunId,
    parentRunId: input.parentRunId,
    parentDecisionId: input.parentDecisionId,
    parentDecisionArrayIndex: input.parentDecisionArrayIndex,
    subResult
  };
  parentEmit(completedEvent);
  input.recordProtocolDecision(completedEvent);
  input.dispatchedChild.closed = true;

  // BUDGET-01 / D-10: parent.signal aborted AFTER the child completed but
  // before we advance to the next coordinator turn. Emit a marker event so
  // streaming subscribers see "parent gave up after sub-run" provenance,
  // then re-throw the parent's abort reason. Non-streaming run() rejects with
  // the thrown error and does NOT preserve the marker — engine.ts does not
  // attach the parent events array to the rejected error (verified at
  // engine.ts:230-239). Streaming-subscriber observability is the contract.
  if (parentSignal?.aborted) {
    const abortMarker: SubRunParentAbortedEvent = {
      type: "sub-run-parent-aborted",
      runId: input.parentRunId,
      at: new Date().toISOString(),
      childRunId,
      parentRunId: input.parentRunId,
      reason: "parent-aborted"
    };
    parentEmit(abortMarker);
    input.recordProtocolDecision(abortMarker);
    throw enrichAbortErrorWithParentReason(
      createAbortErrorFromSignal(parentSignal, options.model.id),
      parentSignal
    );
  }

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
    nextInput: `${baseInput}\n\n${taggedText}\n\nUsing the sub-run result above, decide the next step (participate or delegate).`,
    taggedText,
    completedAtMs: Date.now()
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

/**
 * BUDGET-01 / D-08: when a child sub-run threw because the parent's signal
 * aborted, lock the `detail.reason` discriminator on the resulting
 * `code: "aborted"` error. Preserves any pre-existing detail keys (e.g.,
 * `detail.status: "cancelled"` attached by `createStreamCancellationError`).
 *
 * No-op when:
 *   - parent.signal is undefined or not aborted (child failure was unrelated)
 *   - error is not a DogpileError with `code: "aborted"`
 *   - error already has a `detail.reason` set (preserve upstream classification)
 */
function enrichAbortErrorWithParentReason(error: unknown, parentSignal: AbortSignal | undefined): unknown {
  if (parentSignal === undefined || !parentSignal.aborted) {
    return error;
  }
  if (!DogpileError.isInstance(error) || error.code !== "aborted") {
    return error;
  }
  const existingDetail = error.detail ?? {};
  if (existingDetail["reason"] !== undefined) {
    return error;
  }
  const reason = classifyAbortReason(parentSignal.reason);
  return new DogpileError({
    code: "aborted",
    message: error.message,
    retryable: error.retryable ?? false,
    ...(error.providerId !== undefined ? { providerId: error.providerId } : {}),
    detail: { ...existingDetail, reason },
    ...(error.cause !== undefined ? { cause: error.cause } : {})
  });
}

function enrichProviderTimeoutSource(
  error: unknown,
  context: {
    readonly decisionTimeoutMs?: number;
    readonly engineDefaultTimeoutMs?: number;
  }
): unknown {
  if (!DogpileError.isInstance(error) || error.code !== "provider-timeout") {
    return error;
  }
  const existingDetail = error.detail ?? {};
  if (existingDetail["source"] !== undefined) {
    return error;
  }
  const source = classifyChildTimeoutSource(error, {
    ...context,
    isProviderError: true
  });
  return new DogpileError({
    code: "provider-timeout",
    message: error.message,
    retryable: error.retryable ?? true,
    ...(error.providerId !== undefined ? { providerId: error.providerId } : {}),
    detail: { ...existingDetail, source },
    ...(error.cause !== undefined ? { cause: error.cause } : {})
  });
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
