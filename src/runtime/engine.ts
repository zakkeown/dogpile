import { DogpileError } from "../types.js";
import type {
  BudgetTier,
  DogpileOptions,
  Engine,
  EngineOptions,
  FinalEvent,
  JsonObject,
  JsonValue,
  ProtocolSelection,
  RunCallOptions,
  RunEvaluation,
  RunEvent,
  RunResult,
  StreamErrorEvent,
  StreamEvent,
  StreamEventSubscriber,
  StreamHandle,
  StreamHandleStatus,
  Trace
} from "../types.js";
import { runBroadcast } from "./broadcast.js";
import { runCoordinator } from "./coordinator.js";
import {
  createReplayTraceFinalOutput,
  createReplayTraceBudgetStateChanges,
  canonicalizeRunResult,
  canonicalizeSerializable,
  createRunAccounting,
  createRunEventLog,
  createRunMetadata,
  createRunUsage,
  defaultAgents,
  normalizeProtocol,
  orderAgentsForTemperature,
  tierTemperature
} from "./defaults.js";
import { runSequential } from "./sequential.js";
import { runShared } from "./shared.js";
import { createAbortErrorFromSignal, createTimeoutError } from "./cancellation.js";
import { budget as budgetCondition } from "./termination.js";
import { validateDogpileOptions, validateEngineOptions, validateMissionIntent, validateRunCallOptions } from "./validation.js";

const DEFAULT_MAX_DEPTH = 4;

const defaultHighLevelProtocol = "sequential";
const defaultHighLevelTier = "balanced";

type NormalizedDogpileOptions = Omit<DogpileOptions, "protocol" | "tier"> & {
  readonly protocol: ProtocolSelection;
  readonly tier: BudgetTier;
};

/**
 * Create a reusable low-level protocol engine.
 *
 * @remarks
 * Use this escape hatch to hold protocol, tier, model, agents, and budget caps
 * constant across repeated missions. Most application code can call
 * {@link run}, {@link stream}, or {@link Dogpile.pile} directly.
 *
 * The returned engine is stateless between calls: each `run()` or `stream()`
 * invocation produces its own serializable trace, event log, and transcript.
 */
export function createEngine(options: EngineOptions): Engine {
  validateEngineOptions(options);

  const protocol = normalizeProtocol(options.protocol);
  const tools = options.tools ?? [];
  const temperature = options.temperature ?? tierTemperature(options.tier);
  const agents = orderAgentsForTemperature(options.agents ?? defaultAgents(), temperature, options.seed);
  const terminate = options.terminate ?? (options.budget ? conditionFromBudget(options.budget) : undefined);
  const engineMaxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  return {
    run(intent: string, runOptions?: RunCallOptions): Promise<RunResult> {
      validateMissionIntent(intent);
      validateRunCallOptions(runOptions);

      const effectiveMaxDepth = Math.min(
        engineMaxDepth,
        runOptions?.maxDepth ?? Number.POSITIVE_INFINITY
      );

      return runNonStreamingProtocol({
        intent,
        protocol,
        tier: options.tier,
        model: options.model,
        agents,
        tools,
        temperature,
        ...(options.budget ? { budget: options.budget } : {}),
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(terminate ? { terminate } : {}),
        ...(options.wrapUpHint ? { wrapUpHint: options.wrapUpHint } : {}),
        ...(options.evaluate ? { evaluate: options.evaluate } : {}),
        currentDepth: 0,
        effectiveMaxDepth
      });
    },

    stream(intent: string, runOptions?: RunCallOptions): StreamHandle {
      validateMissionIntent(intent);
      validateRunCallOptions(runOptions);

      const effectiveMaxDepth = Math.min(
        engineMaxDepth,
        runOptions?.maxDepth ?? Number.POSITIVE_INFINITY
      );

      const pendingEvents: StreamEvent[] = [];
      const pendingResolvers: Array<(value: IteratorResult<StreamEvent>) => void> = [];
      const emittedEvents: StreamEvent[] = [];
      const subscribers = new Set<StreamEventSubscriber>();
      const abortController = new AbortController();
      const timeoutLifecycle = createTimeoutAbortLifecycle({
        abortController,
        timeoutMs: runtimeTimeoutMs({ budget: options.budget, terminate }),
        providerId: options.model.id
      });
      const abortRace = createAbortRace(abortController.signal, options.model.id);
      let complete = false;
      let lastRunId = "";
      let pendingFinalEvent: FinalEvent | undefined;
      let status: StreamHandleStatus = "running";
      let resolveResult!: (result: RunResult) => void;
      let rejectResult!: (error: unknown) => void;
      let removeCallerAbortListener = (): void => {};

      const result = new Promise<RunResult>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      removeCallerAbortListener = wireCallerAbortSignal(options.signal, abortController, cancelRun);
      void execute();

      return {
        get status(): StreamHandleStatus {
          return status;
        },
        result,
        cancel(): void {
          cancelRun();
        },
        subscribe(subscriber: StreamEventSubscriber) {
          subscribers.add(subscriber);

          for (const event of emittedEvents) {
            subscriber(event);
          }

          return {
            unsubscribe(): void {
              subscribers.delete(subscriber);
            }
          };
        },
        [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
          return {
            next(): Promise<IteratorResult<StreamEvent>> {
              const event = pendingEvents.shift();
              if (event) {
                return Promise.resolve({ done: false, value: event });
              }
              if (complete) {
                return Promise.resolve({ done: true, value: undefined });
              }
              return new Promise<IteratorResult<StreamEvent>>((resolve) => {
                pendingResolvers.push(resolve);
              });
            }
          };
        }
      };

      async function execute(): Promise<void> {
        if (status !== "running") {
          return;
        }

        try {
          const baseResult = await abortRace.run(runProtocol({
            intent,
            protocol,
            tier: options.tier,
            model: options.model,
            agents,
            tools,
            temperature,
            ...(options.budget ? { budget: options.budget } : {}),
            ...(options.seed !== undefined ? { seed: options.seed } : {}),
            signal: abortController.signal,
            ...(terminate ? { terminate } : {}),
            currentDepth: 0,
            effectiveMaxDepth,
            emit(event: RunEvent): void {
              if (status !== "running") {
                return;
              }

              lastRunId = event.runId;
              if (event.type === "final") {
                pendingFinalEvent = event;
                return;
              }
              publish(event);
            }
          }));
          if (status !== "running") {
            return;
          }

          const finalizedResult = await abortRace.run(applyRunEvaluation(baseResult, options.evaluate));
          if (status !== "running") {
            return;
          }

          const finalEvent = finalizedResult.trace.events.at(-1);
          if (finalEvent?.type === "final") {
            publish(finalEvent);
          } else if (pendingFinalEvent) {
            publish(pendingFinalEvent);
          }
          status = "completed";
          closeStream();
          resolveResult(finalizedResult);
        } catch (error: unknown) {
          if (isStreamHandleStatus(status, "cancelled")) {
            return;
          }

          const runtimeError = timeoutLifecycle.translateError(error);
          status = isCancellationError(runtimeError) ? "cancelled" : "failed";
          publish(createStreamErrorEvent(runtimeError, lastRunId));
          closeStream();
          rejectResult(runtimeError);
        }
      }

      function cancelRun(cause?: unknown): void {
        if (status !== "running") {
          return;
        }

        const error = createStreamCancellationError(options.model.id, cause);
        status = "cancelled";
        abortController.abort(error);
        publish(createStreamErrorEvent(error, lastRunId));
        closeStream();
        rejectResult(error);
      }

      function closeStream(): void {
        if (complete) {
          return;
        }

        complete = true;
        removeCallerAbortListener();
        timeoutLifecycle.cleanup();
        abortRace.cleanup();
        subscribers.clear();
        for (const resolver of pendingResolvers.splice(0)) {
          resolver({ done: true, value: undefined });
        }
      }

      function publish(event: StreamEvent): void {
        if (complete) {
          return;
        }

        const canonicalEvent = canonicalizeSerializable(event);
        emittedEvents.push(canonicalEvent);

        for (const subscriber of subscribers) {
          try {
            subscriber(canonicalEvent);
          } catch {
            // Subscriber failures should not cancel the underlying SDK run.
          }
        }

        const resolver = pendingResolvers.shift();
        if (resolver) {
          resolver({ done: false, value: canonicalEvent });
          return;
        }
        pendingEvents.push(canonicalEvent);
      }
    }
  };
}

function isStreamHandleStatus(status: StreamHandleStatus, expected: StreamHandleStatus): boolean {
  return status === expected;
}

function conditionFromBudget(budget: NonNullable<EngineOptions["budget"]>): ReturnType<typeof budgetCondition> {
  return budgetCondition({
    ...(budget.maxUsd !== undefined ? { maxUsd: budget.maxUsd } : {}),
    ...(budget.maxTokens !== undefined ? { maxTokens: budget.maxTokens } : {}),
    ...(budget.maxIterations !== undefined ? { maxIterations: budget.maxIterations } : {}),
    ...(budget.timeoutMs !== undefined ? { timeoutMs: budget.timeoutMs } : {})
  });
}

interface AbortLifecycle {
  readonly signal: AbortSignal | undefined;
  run<T>(operation: Promise<T>): Promise<T>;
  translateError(error: unknown): unknown;
  cleanup(): void;
}

interface TimeoutAbortLifecycle {
  translateError(error: unknown): unknown;
  cleanup(): void;
}

function createNonStreamingAbortLifecycle(options: {
  readonly callerSignal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
  readonly providerId: string;
}): AbortLifecycle {
  if (options.timeoutMs === undefined) {
    return {
      signal: options.callerSignal,
      async run<T>(operation: Promise<T>): Promise<T> {
        return await operation;
      },
      translateError(error: unknown): unknown {
        return error;
      },
      cleanup(): void {}
    };
  }

  const abortController = new AbortController();
  const timeoutLifecycle = createTimeoutAbortLifecycle({
    abortController,
    timeoutMs: options.timeoutMs,
    providerId: options.providerId
  });
  const abortRace = createAbortRace(abortController.signal, options.providerId);
  const removeCallerAbortListener = wireCallerAbortSignal(options.callerSignal, abortController, () => {
    abortController.abort(readAbortSignalReason(options.callerSignal));
  });

  return {
    signal: abortController.signal,
    async run<T>(operation: Promise<T>): Promise<T> {
      return await abortRace.run(operation);
    },
    translateError(error: unknown): unknown {
      return timeoutLifecycle.translateError(error);
    },
    cleanup(): void {
      timeoutLifecycle.cleanup();
      abortRace.cleanup();
      removeCallerAbortListener();
    }
  };
}

function createTimeoutAbortLifecycle(options: {
  readonly abortController: AbortController;
  readonly timeoutMs?: number | undefined;
  readonly providerId: string;
}): TimeoutAbortLifecycle {
  if (options.timeoutMs === undefined) {
    return {
      translateError(error: unknown): unknown {
        return error;
      },
      cleanup(): void {}
    };
  }

  const timeoutError = createTimeoutError(options.providerId, options.timeoutMs);
  const timeoutId = setTimeout(() => {
    options.abortController.abort(timeoutError);
  }, options.timeoutMs);

  return {
    translateError(error: unknown): unknown {
      return options.abortController.signal.reason === timeoutError ? timeoutError : error;
    },
    cleanup(): void {
      clearTimeout(timeoutId);
    }
  };
}

function createAbortRace(signal: AbortSignal, providerId: string): AbortLifecycle {
  let cleanupAbortListener = (): void => {};

  return {
    signal,
    async run<T>(operation: Promise<T>): Promise<T> {
      if (signal.aborted) {
        throw createAbortErrorFromSignal(signal, providerId);
      }

      const abortPromise = new Promise<never>((_, reject) => {
        const abortHandler = (): void => {
          cleanupAbortListener();
          reject(createAbortErrorFromSignal(signal, providerId));
        };

        cleanupAbortListener = (): void => {
          signal.removeEventListener("abort", abortHandler);
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      });

      try {
        return await Promise.race([operation, abortPromise]);
      } finally {
        cleanupAbortListener();
        cleanupAbortListener = (): void => {};
      }
    },
    translateError(error: unknown): unknown {
      return error;
    },
    cleanup(): void {
      cleanupAbortListener();
      cleanupAbortListener = (): void => {};
    }
  };
}

function runtimeTimeoutMs(options: {
  readonly budget?: EngineOptions["budget"] | undefined;
  readonly terminate?: EngineOptions["terminate"] | undefined;
}): number | undefined {
  const budgetTimeoutMs = options.budget?.timeoutMs;
  const terminationTimeoutMs = timeoutMsFromTermination(options.terminate);

  if (budgetTimeoutMs === undefined) {
    return terminationTimeoutMs;
  }
  if (terminationTimeoutMs === undefined) {
    return budgetTimeoutMs;
  }
  return Math.min(budgetTimeoutMs, terminationTimeoutMs);
}

function timeoutMsFromTermination(condition: EngineOptions["terminate"] | undefined): number | undefined {
  if (!condition) {
    return undefined;
  }

  switch (condition.kind) {
    case "budget":
      return condition.timeoutMs;
    case "firstOf":
      return condition.conditions.reduce<number | undefined>((current, child) => {
        const childTimeoutMs = timeoutMsFromTermination(child);
        if (childTimeoutMs === undefined) {
          return current;
        }
        return current === undefined ? childTimeoutMs : Math.min(current, childTimeoutMs);
      }, undefined);
    case "convergence":
    case "judge":
      return undefined;
  }
}

function readAbortSignalReason(signal: AbortSignal | undefined): unknown {
  return signal?.aborted ? signal.reason : undefined;
}

function createStreamErrorEvent(error: unknown, runId: string): StreamErrorEvent {
  if (DogpileError.isInstance(error)) {
    return {
      type: "error",
      runId,
      at: new Date().toISOString(),
      name: error.name,
      message: error.message,
      detail: dogpileErrorStreamDetail(error)
    };
  }

  if (error instanceof Error) {
    return {
      type: "error",
      runId,
      at: new Date().toISOString(),
      name: error.name,
      message: error.message
    };
  }

  return {
    type: "error",
    runId,
    at: new Date().toISOString(),
    name: "Error",
    message: String(error)
  };
}

function dogpileErrorStreamDetail(error: DogpileError): JsonObject {
  const detail: Record<string, JsonValue> = {
    code: error.code
  };

  if (error.providerId !== undefined) {
    detail.providerId = error.providerId;
  }
  if (error.retryable !== undefined) {
    detail.retryable = error.retryable;
  }
  if (error.detail !== undefined) {
    for (const [key, value] of Object.entries(error.detail)) {
      detail[key] = value;
    }
  }

  return detail;
}

interface RunProtocolOptions {
  readonly intent: string;
  readonly protocol: ReturnType<typeof normalizeProtocol>;
  readonly tier: EngineOptions["tier"];
  readonly model: EngineOptions["model"];
  readonly agents: readonly NonNullable<EngineOptions["agents"]>[number][];
  readonly tools: NonNullable<EngineOptions["tools"]>;
  readonly temperature: number;
  readonly budget?: EngineOptions["budget"];
  readonly seed?: EngineOptions["seed"];
  readonly signal?: EngineOptions["signal"];
  readonly terminate?: EngineOptions["terminate"];
  readonly wrapUpHint?: EngineOptions["wrapUpHint"];
  readonly emit?: (event: RunEvent) => void;
  /**
   * Current recursion depth. Top-level runs use 0; the coordinator dispatch
   * loop increments before invoking {@link runProtocol} for a child run.
   * Plan 04 will wire `effectiveMaxDepth` validation around this value.
   */
  readonly currentDepth?: number;
  /**
   * Effective max recursion depth. Plan 04 enforces; Plan 03 plumbs the param.
   */
  readonly effectiveMaxDepth?: number;
}

type NonStreamingProtocolOptions = Omit<RunProtocolOptions, "emit"> & Pick<EngineOptions, "evaluate">;

async function runNonStreamingProtocol(options: NonStreamingProtocolOptions): Promise<RunResult> {
  const abortLifecycle = createNonStreamingAbortLifecycle({
    callerSignal: options.signal,
    timeoutMs: runtimeTimeoutMs(options),
    providerId: options.model.id
  });

  try {
    const emittedEvents: RunEvent[] = [];
    const result = await abortLifecycle.run(runProtocol({
      ...options,
      ...(abortLifecycle.signal !== undefined ? { signal: abortLifecycle.signal } : {}),
      emit(event: RunEvent): void {
        emittedEvents.push(event);
      }
    }));
    const events = emittedEvents.length > 0 ? emittedEvents : result.trace.events;
    const trace = {
      ...result.trace,
      events,
      budgetStateChanges: createReplayTraceBudgetStateChanges(events),
      finalOutput: createReplayTraceFinalOutput(result.output, events.at(-1) ?? result.trace.events.at(-1)!)
    };

    const runResult = {
      ...result,
      accounting: createRunAccounting({
        tier: trace.tier,
        ...(trace.budget.caps ? { budget: trace.budget.caps } : {}),
        ...(trace.budget.termination ? { termination: trace.budget.termination } : {}),
        cost: result.cost,
        events
      }),
      eventLog: createRunEventLog(trace.runId, trace.protocol, events),
      trace
    };
    return canonicalizeRunResult(await abortLifecycle.run(applyRunEvaluation(runResult, options.evaluate)));
  } catch (error: unknown) {
    throw abortLifecycle.translateError(error);
  } finally {
    abortLifecycle.cleanup();
  }
}

async function applyRunEvaluation(
  result: RunResult,
  evaluate: EngineOptions["evaluate"]
): Promise<RunResult> {
  if (!evaluate) {
    return canonicalizeRunResult(result);
  }

  const evaluation = await evaluate(result);
  const events = result.trace.events.map((event, index): RunEvent => {
    if (index !== result.trace.events.length - 1 || event.type !== "final") {
      return event;
    }

    return finalEventWithEvaluation(event, evaluation);
  });
  const trace = {
    ...result.trace,
    events
  };

  return canonicalizeRunResult({
    ...result,
    quality: evaluation.quality,
    evaluation,
    trace,
    eventLog: createRunEventLog(trace.runId, trace.protocol, events)
  });
}

function finalEventWithEvaluation(event: FinalEvent, evaluation: RunEvaluation): FinalEvent {
  return {
    ...event,
    quality: evaluation.quality,
    evaluation
  };
}

function runProtocol(options: RunProtocolOptions): Promise<RunResult> {
  switch (options.protocol.kind) {
    case "sequential":
      return runSequential({
        intent: options.intent,
        protocol: options.protocol,
        tier: options.tier,
        model: options.model,
        agents: options.agents,
        tools: options.tools,
        temperature: options.temperature,
        ...(options.budget ? { budget: options.budget } : {}),
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.terminate ? { terminate: options.terminate } : {}),
        ...(options.wrapUpHint ? { wrapUpHint: options.wrapUpHint } : {}),
        ...(options.emit ? { emit: options.emit } : {})
      });
    case "broadcast":
      return runBroadcast({
        intent: options.intent,
        protocol: options.protocol,
        tier: options.tier,
        model: options.model,
        agents: options.agents,
        tools: options.tools,
        temperature: options.temperature,
        ...(options.budget ? { budget: options.budget } : {}),
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.terminate ? { terminate: options.terminate } : {}),
        ...(options.wrapUpHint ? { wrapUpHint: options.wrapUpHint } : {}),
        ...(options.emit ? { emit: options.emit } : {})
      });
    case "coordinator":
      return runCoordinator({
        intent: options.intent,
        protocol: options.protocol,
        tier: options.tier,
        model: options.model,
        agents: options.agents,
        tools: options.tools,
        temperature: options.temperature,
        ...(options.budget ? { budget: options.budget } : {}),
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.terminate ? { terminate: options.terminate } : {}),
        ...(options.wrapUpHint ? { wrapUpHint: options.wrapUpHint } : {}),
        ...(options.emit ? { emit: options.emit } : {}),
        currentDepth: options.currentDepth ?? 0,
        effectiveMaxDepth: options.effectiveMaxDepth ?? Infinity,
        runProtocol: (childInput) =>
          runProtocol({
            ...childInput,
            protocol: normalizeProtocol(childInput.protocol)
          })
      });
    case "shared":
      return runShared({
        intent: options.intent,
        protocol: options.protocol,
        tier: options.tier,
        model: options.model,
        agents: options.agents,
        tools: options.tools,
        temperature: options.temperature,
        ...(options.budget ? { budget: options.budget } : {}),
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.terminate ? { terminate: options.terminate } : {}),
        ...(options.wrapUpHint ? { wrapUpHint: options.wrapUpHint } : {}),
        ...(options.emit ? { emit: options.emit } : {})
      });
  }
}

/**
 * Run a multi-agent workflow in a single call.
 *
 * @remarks
 * Supply a mission through `intent` and provide a configured model provider.
 * Omitted high-level controls default to Sequential coordination and the
 * `balanced` tier. The returned
 * {@link RunResult} contains the final `output`, a JSON-serializable `trace`,
 * direct `transcript` access, aggregate `cost`, and optional `quality`.
 *
 * Use {@link createEngine} when a research harness needs to reuse normalized
 * protocol/model/agent settings across many missions.
 */
export function run(options: DogpileOptions): Promise<RunResult> {
  validateDogpileOptions(options);

  const { intent, ...engineOptions } = withHighLevelDefaults(options);
  return createEngine(engineOptions).run(intent);
}

/**
 * Stream a multi-agent workflow and await the final result.
 *
 * @remarks
 * The returned handle is an async iterable of {@link RunEvent} values with a
 * `result` promise for the same {@link RunResult} shape returned by
 * {@link run}. This supports live event logs and trace UIs without requiring
 * SDK-managed storage.
 *
 * Streaming and final traces use the same event shapes, so callers can render
 * progress live and persist the completed trace without translation.
 */
export function stream(options: DogpileOptions): StreamHandle {
  validateDogpileOptions(options);

  const { intent, ...engineOptions } = withHighLevelDefaults(options);
  return createEngine(engineOptions).stream(intent);
}

/**
 * Rehydrate the public result shape from a saved completed trace artifact.
 *
 * @remarks
 * This is the caller-facing replay entrypoint for persisted traces. It does
 * not call the model provider or require SDK-owned storage; it reconstructs
 * the ergonomic {@link RunResult} wrapper from the JSON-serializable
 * {@link Trace} returned by a previous `run()`, `stream()`, or
 * `Dogpile.pile()` call.
 */
export function replay(trace: Trace): RunResult {
  const cost = trace.finalOutput.cost;
  const lastEvent = trace.events.at(-1);
  const baseResult = {
    output: trace.finalOutput.output,
    eventLog: createRunEventLog(trace.runId, trace.protocol, trace.events),
    trace,
    transcript: trace.transcript,
    usage: createRunUsage(cost),
    metadata: createRunMetadata({
      runId: trace.runId,
      protocol: trace.protocol,
      tier: trace.tier,
      modelProviderId: trace.modelProviderId,
      agentsUsed: trace.agentsUsed,
      events: trace.events
    }),
    accounting: createRunAccounting({
      tier: trace.tier,
      ...(trace.budget.caps ? { budget: trace.budget.caps } : {}),
      ...(trace.budget.termination ? { termination: trace.budget.termination } : {}),
      cost,
      events: trace.events
    }),
    cost
  };

  if (lastEvent?.type !== "final") {
    return baseResult;
  }

  return {
    ...baseResult,
    ...(lastEvent.quality !== undefined ? { quality: lastEvent.quality } : {}),
    ...(lastEvent.evaluation !== undefined ? { evaluation: lastEvent.evaluation } : {})
  };
}

/**
 * Replay a saved completed trace as a stream without invoking a model provider.
 *
 * @remarks
 * This is the streaming counterpart to {@link replay}. It yields the exact
 * saved {@link Trace.events} in order and resolves {@link StreamHandle.result}
 * to the rehydrated {@link RunResult}. Since all data comes from the trace,
 * replay remains storage-free and provider-free.
 */
export function replayStream(trace: Trace): StreamHandle {
  const result = Promise.resolve(replay(trace));

  return {
    get status(): StreamHandleStatus {
      return "completed";
    },
    result,
    cancel(): void {
      // Replay streams are already completed snapshots, so cancellation is a no-op.
    },
    subscribe(subscriber: StreamEventSubscriber) {
      for (const event of trace.events) {
        subscriber(event);
      }

      return {
        unsubscribe(): void {
          // Replay subscriptions are finite snapshots; there is no live source to detach from.
        }
      };
    },
    [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
      let index = 0;

      return {
        next(): Promise<IteratorResult<StreamEvent>> {
          const event = trace.events[index];
          if (event) {
            index += 1;
            return Promise.resolve({ done: false, value: event });
          }

          return Promise.resolve({ done: true, value: undefined });
        }
      };
    }
  };
}

function wireCallerAbortSignal(
  callerSignal: AbortSignal | undefined,
  abortController: AbortController,
  cancelRun: (reason?: unknown) => void
): () => void {
  if (!callerSignal) {
    return (): void => {};
  }

  const cancelFromCaller = (): void => {
    cancelRun(readAbortSignalReason(callerSignal));
  };

  if (callerSignal.aborted) {
    cancelFromCaller();
    return (): void => {};
  }

  callerSignal.addEventListener("abort", cancelFromCaller, { once: true });
  const remove = (): void => {
    callerSignal.removeEventListener("abort", cancelFromCaller);
  };
  abortController.signal.addEventListener("abort", remove, { once: true });
  return remove;
}

function createStreamCancellationError(providerId: string, cause?: unknown): DogpileError {
  return new DogpileError({
    code: "aborted",
    message: "The operation was aborted.",
    retryable: false,
    providerId,
    ...(cause !== undefined ? { cause } : {}),
    detail: {
      status: "cancelled"
    }
  });
}

function isCancellationError(error: unknown): boolean {
  if (DogpileError.isInstance(error)) {
    return error.code === "aborted";
  }

  return error instanceof Error && error.name === "AbortError";
}

function withHighLevelDefaults(options: DogpileOptions): NormalizedDogpileOptions {
  return {
    ...options,
    protocol: options.protocol ?? defaultHighLevelProtocol,
    tier: options.tier ?? defaultHighLevelTier
  };
}

/**
 * Branded high-level SDK namespace.
 *
 * `Dogpile.pile()` is the ergonomic caller-facing workflow API. It uses the
 * non-streaming execution path and resolves only after the protocol completes,
 * returning `{ output, eventLog, transcript, usage, metadata, trace, cost,
 * quality }`.
 */
function pile(options: DogpileOptions): Promise<RunResult> {
  return run(options);
}

export const Dogpile = {
  pile,
  replay,
  replayStream,
  stream,
  createEngine
} as const;
