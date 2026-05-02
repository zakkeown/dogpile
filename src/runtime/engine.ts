import { DogpileError } from "../types.js";
import type {
  AbortedEvent,
  BudgetStopEvent,
  BudgetTier,
  CostSummary,
  DogpileErrorCode,
  DogpileOptions,
  Engine,
  EngineOptions,
  FinalEvent,
  JsonObject,
  JsonValue,
  ModelRequestEvent,
  ProtocolSelection,
  RunCallOptions,
  RunEvaluation,
  RunEvent,
  RunResult,
  ReplayTraceProviderCall,
  SubRunFailedEvent,
  StreamErrorEvent,
  StreamEvent,
  StreamEventSubscriber,
  StreamHandle,
  StreamHandleStatus,
  Trace
} from "../types.js";
import { runBroadcast } from "./broadcast.js";
import { runCoordinator, type AbortDrainFn } from "./coordinator.js";
import {
  addCost,
  createReplayTraceFinalOutput,
  createReplayTraceBudgetStateChanges,
  canonicalizeRunResult,
  canonicalizeSerializable,
  createRunAccounting,
  createRunEventLog,
  createRunMetadata,
  createRunUsage,
  defaultAgents,
  emptyCost,
  normalizeProtocol,
  orderAgentsForTemperature,
  recomputeAccountingFromTrace,
  resolveOnChildFailure,
  tierTemperature
} from "./defaults.js";
import { computeHealth, DEFAULT_HEALTH_THRESHOLDS } from "./health.js";
import { runSequential } from "./sequential.js";
import { runShared } from "./shared.js";
import {
  classifyChildTimeoutSource,
  createAbortErrorFromSignal,
  createEngineDeadlineTimeoutError,
  createTimeoutError
} from "./cancellation.js";
import { budget as budgetCondition } from "./termination.js";
import {
  validateDogpileOptions,
  validateEngineOptions,
  validateMissionIntent,
  validateProviderLocality,
  validateRunCallOptions
} from "./validation.js";
import { DOGPILE_SPAN_NAMES, type DogpileSpan, type DogpileTracer } from "./tracing.js";
import type { Logger } from "./logger.js";
import type { MetricsHook, RunMetricsSnapshot } from "./metrics.js";

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_CONCURRENT_CHILDREN = 4;

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
  const engineMaxConcurrentChildren = options.maxConcurrentChildren ?? DEFAULT_MAX_CONCURRENT_CHILDREN;
  const engineOnChildFailure = options.onChildFailure;

  return {
    run(intent: string, runOptions?: RunCallOptions): Promise<RunResult> {
      validateMissionIntent(intent);
      validateRunCallOptions(runOptions);
      validateProviderLocality(options.model, "model");

      const effectiveMaxDepth = Math.min(
        engineMaxDepth,
        runOptions?.maxDepth ?? Number.POSITIVE_INFINITY
      );
      assertRunDoesNotRaiseEngineMax(
        "maxConcurrentChildren",
        runOptions?.maxConcurrentChildren,
        engineMaxConcurrentChildren
      );
      const effectiveMaxConcurrentChildren = Math.min(
        engineMaxConcurrentChildren,
        runOptions?.maxConcurrentChildren ?? Number.POSITIVE_INFINITY
      );
      const onChildFailure = resolveOnChildFailure(runOptions?.onChildFailure, engineOnChildFailure);

      const startedAtMs = Date.now();
      const parentDeadlineMs =
        options.budget?.timeoutMs !== undefined ? startedAtMs + options.budget.timeoutMs : undefined;

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
        ...(options.tracer ? { tracer: options.tracer } : {}),
        ...(options.metricsHook ? { metricsHook: options.metricsHook } : {}),
        ...(options.logger ? { logger: options.logger } : {}),
        currentDepth: 0,
        effectiveMaxDepth,
        effectiveMaxConcurrentChildren,
        onChildFailure,
        ...(parentDeadlineMs !== undefined ? { parentDeadlineMs } : {}),
        ...(options.defaultSubRunTimeoutMs !== undefined
          ? { defaultSubRunTimeoutMs: options.defaultSubRunTimeoutMs }
          : {})
      });
    },

    stream(intent: string, runOptions?: RunCallOptions): StreamHandle {
      validateMissionIntent(intent);
      validateRunCallOptions(runOptions);
      validateProviderLocality(options.model, "model");

      const effectiveMaxDepth = Math.min(
        engineMaxDepth,
        runOptions?.maxDepth ?? Number.POSITIVE_INFINITY
      );
      assertRunDoesNotRaiseEngineMax(
        "maxConcurrentChildren",
        runOptions?.maxConcurrentChildren,
        engineMaxConcurrentChildren
      );
      const effectiveMaxConcurrentChildren = Math.min(
        engineMaxConcurrentChildren,
        runOptions?.maxConcurrentChildren ?? Number.POSITIVE_INFINITY
      );
      const onChildFailure = resolveOnChildFailure(runOptions?.onChildFailure, engineOnChildFailure);

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
      let rootRunId: string | undefined;
      let pendingFinalEvent: FinalEvent | undefined;
      let activeAbortDrain: AbortDrainFn | undefined;
      const failureInstancesByChildRunId = new Map<string, DogpileError>();
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
          const streamStartedAtMs = Date.now();
          const streamParentDeadlineMs =
            options.budget?.timeoutMs !== undefined ? streamStartedAtMs + options.budget.timeoutMs : undefined;
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
            effectiveMaxConcurrentChildren,
            onChildFailure,
            ...(streamParentDeadlineMs !== undefined ? { parentDeadlineMs: streamParentDeadlineMs } : {}),
            ...(options.defaultSubRunTimeoutMs !== undefined
              ? { defaultSubRunTimeoutMs: options.defaultSubRunTimeoutMs }
              : {}),
            ...(options.tracer ? { tracer: options.tracer } : {}),
            ...(options.metricsHook ? { metricsHook: options.metricsHook } : {}),
            ...(options.logger ? { logger: options.logger } : {}),
            streamEvents: true,
            emit(event: RunEvent): void {
              if (status !== "running") {
                return;
              }

              const parentRunIds = (event as { readonly parentRunIds?: readonly string[] }).parentRunIds;
              if (rootRunId === undefined && parentRunIds === undefined) {
                rootRunId = event.runId;
              }

              lastRunId = event.runId;
              if (event.type === "final" && event.runId === rootRunId) {
                pendingFinalEvent = event;
                return;
              }
              publish(event);
            },
            registerAbortDrain(drain: AbortDrainFn): void {
              activeAbortDrain = drain;
            },
            failureInstancesByChildRunId
          }));
          if (status !== "running") {
            return;
          }
          const terminalThrow = resolveRuntimeTerminalThrow(baseResult.trace, failureInstancesByChildRunId);
          if (terminalThrow) {
            throw terminalThrow;
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
          if (shouldPublishAborted(runtimeError)) {
            activeAbortDrain?.(runtimeError);
            publish(createStreamAbortedEvent(runtimeError, lastRunId));
          }
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
        abortController.abort(error);
        activeAbortDrain?.(error);
        publish(createStreamAbortedEvent(error, lastRunId));
        publish(createStreamErrorEvent(error, lastRunId));
        status = "cancelled";
        closeStream();
        rejectResult(error);
      }

      function closeStream(): void {
        if (complete) {
          return;
        }

        complete = true;
        failureInstancesByChildRunId.clear();
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
  readonly timeoutErrorSource?: "runtime" | "engine";
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
    providerId: options.providerId,
    timeoutErrorSource: options.timeoutErrorSource ?? "runtime"
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
  readonly timeoutErrorSource?: "runtime" | "engine";
}): TimeoutAbortLifecycle {
  if (options.timeoutMs === undefined) {
    return {
      translateError(error: unknown): unknown {
        return error;
      },
      cleanup(): void {}
    };
  }

  const timeoutSource = classifyChildTimeoutSource(undefined, {
    ...(options.timeoutErrorSource === "engine" ? { engineDefaultTimeoutMs: options.timeoutMs } : {}),
    isProviderError: false
  });
  const timeoutError =
    options.timeoutErrorSource === "engine" && timeoutSource === "engine"
      ? createEngineDeadlineTimeoutError(options.providerId, options.timeoutMs)
      : createTimeoutError(options.providerId, options.timeoutMs);
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

function createStreamAbortedEvent(error: unknown, runId: string): AbortedEvent {
  return {
    type: "aborted",
    runId,
    at: new Date().toISOString(),
    reason: streamAbortedReason(error)
  };
}

function shouldPublishAborted(error: unknown): boolean {
  return DogpileError.isInstance(error) && (error.code === "aborted" || error.code === "timeout");
}

function streamAbortedReason(error: unknown): AbortedEvent["reason"] {
  if (DogpileError.isInstance(error)) {
    if (error.code === "timeout" || error.detail?.["reason"] === "timeout") {
      return "timeout";
    }
  }
  return "parent-aborted";
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
  readonly streamEvents?: boolean;
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
  /** Effective max delegated child concurrency resolved at run start. */
  readonly effectiveMaxConcurrentChildren?: number;
  readonly onChildFailure?: EngineOptions["onChildFailure"];
  /**
   * Root-run deadline (epoch ms) threaded through every recursive coordinator
   * dispatch (BUDGET-02 / D-12). Children inherit `parentDeadlineMs - now()`
   * as their default timeout window.
   */
  readonly parentDeadlineMs?: number;
  /**
   * Engine-level fallback sub-run timeout (BUDGET-02 / D-14). Applied only when
   * neither the parent nor the decision specifies a `budget.timeoutMs`.
   */
  readonly defaultSubRunTimeoutMs?: number;
  readonly registerAbortDrain?: (drain: AbortDrainFn) => void;
  readonly failureInstancesByChildRunId?: Map<string, DogpileError>;
  readonly tracer?: EngineOptions["tracer"];
  readonly metricsHook?: EngineOptions["metricsHook"];
  readonly logger?: EngineOptions["logger"];
  /**
   * Optional parent span for the next runProtocol invocation. Threaded by the
   * coordinator when dispatching child runs so that the child's `dogpile.run`
   * span is correctly nested under its parent's `dogpile.sub-run` span.
   * Internal-only; not part of the public surface.
   */
  readonly parentSpan?: DogpileSpan;
  /**
   * Per-child sub-run span lookup, keyed by childRunId. Populated by the
   * parent's emit closure on `sub-run-started`. The coordinator dispatcher
   * reads this to thread the correct per-child span as parent for the
   * recursive runProtocol call. Internal-only.
   */
  readonly subRunSpansByChildId?: ReadonlyMap<string, DogpileSpan>;
}

type NonStreamingProtocolOptions = Omit<RunProtocolOptions, "emit"> & Pick<EngineOptions, "evaluate">;

interface TracingState {
  readonly tracer: DogpileTracer;
  readonly runSpan: DogpileSpan;
  readonly subRunSpans: Map<string, DogpileSpan>;
  readonly agentTurnSpans: Map<string, DogpileSpan>;
  readonly modelCallSpans: Map<string, DogpileSpan>;
  readonly pendingModelRequests: Map<string, ModelRequestEvent>;
  readonly agentTurnCounters: Map<string, number>;
  readonly turnAccumByAgent: Map<string, TurnAccum>;
  readonly agentIds: Set<string>;
  runId?: string;
  turnCount: number;
  lastCost: CostSummary;
}

interface TurnAccum {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function openRunTracing(options: {
  readonly tracer?: DogpileTracer;
  readonly parentSpan?: DogpileSpan;
  readonly intent: string;
  readonly protocolKind: string;
  readonly tier: unknown;
}): TracingState | undefined {
  if (!options.tracer) {
    return undefined;
  }

  const runSpan = options.tracer.startSpan(DOGPILE_SPAN_NAMES.RUN, {
    ...(options.parentSpan ? { parent: options.parentSpan } : {}),
    attributes: {
      "dogpile.run.protocol": options.protocolKind,
      "dogpile.run.tier": String(options.tier),
      "dogpile.run.intent": options.intent.slice(0, 200)
    }
  });

  return {
    tracer: options.tracer,
    runSpan,
    subRunSpans: new Map(),
    agentTurnSpans: new Map(),
    modelCallSpans: new Map(),
    pendingModelRequests: new Map(),
    agentTurnCounters: new Map(),
    turnAccumByAgent: new Map(),
    agentIds: new Set(),
    turnCount: 0,
    lastCost: emptyCost()
  };
}

interface MetricsState {
  readonly metricsHook: MetricsHook;
  readonly logger: Logger | undefined;
  readonly startedAtMs: number;
  readonly subRunStartTimes: Map<string, number>;
  totalCost: CostSummary;
  nestedCost: CostSummary;
  turns: number;
}

function openRunMetrics(options: {
  readonly metricsHook?: MetricsHook;
  readonly logger?: Logger;
}): MetricsState | undefined {
  if (!options.metricsHook) {
    return undefined;
  }

  return {
    metricsHook: options.metricsHook,
    logger: options.logger,
    startedAtMs: Date.now(),
    subRunStartTimes: new Map(),
    totalCost: emptyCost(),
    nestedCost: emptyCost(),
    turns: 0
  };
}

function routeMetricsError(err: unknown, logger: Logger | undefined): void {
  const msg = err instanceof Error ? err.message : String(err);
  try {
    if (logger !== undefined) {
      logger.error("dogpile:metricsHook threw", { error: msg });
    } else {
      console.error("dogpile:metricsHook threw", { error: msg });
    }
  } catch {
    // A logger that throws from error() cannot be helped.
  }
}

function fireHook(
  callback: ((snapshot: RunMetricsSnapshot) => void | Promise<void>) | undefined,
  snapshot: RunMetricsSnapshot,
  logger: Logger | undefined
): void {
  if (!callback) {
    return;
  }

  try {
    const result = callback(snapshot);
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch((err: unknown) => {
        routeMetricsError(err, logger);
      });
    }
  } catch (err: unknown) {
    routeMetricsError(err, logger);
  }
}

function buildRunSnapshot(
  result: RunResult,
  startedAtMs: number
): RunMetricsSnapshot {
  const nestedCosts = nestedSubRunCosts(result);
  const budgetStopEvent = result.trace.events.find((event): event is BudgetStopEvent => event.type === "budget-stop");
  const outcome: RunMetricsSnapshot["outcome"] = budgetStopEvent !== undefined ? "budget-stopped" : "completed";
  const totalInputTokens = result.cost.inputTokens;
  const totalOutputTokens = result.cost.outputTokens;
  const totalCostUsd = result.cost.usd;
  const ownInputTokens =
    totalInputTokens - nestedCosts.reduce((sum, cost) => sum + cost.inputTokens, 0);
  const ownOutputTokens =
    totalOutputTokens - nestedCosts.reduce((sum, cost) => sum + cost.outputTokens, 0);
  const ownCostUsd =
    totalCostUsd - nestedCosts.reduce((sum, cost) => sum + cost.usd, 0);
  const turns = result.trace.events.filter((event) => event.type === "agent-turn").length;

  return {
    outcome,
    inputTokens: ownInputTokens,
    outputTokens: ownOutputTokens,
    costUsd: ownCostUsd,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    turns,
    durationMs: Date.now() - startedAtMs
  };
}

function buildSubRunSnapshot(
  subResult: RunResult,
  durationMs: number
): RunMetricsSnapshot {
  const nestedCosts = nestedSubRunCosts(subResult);
  const budgetStopEvent = subResult.trace.events.find((event): event is BudgetStopEvent => event.type === "budget-stop");
  const outcome: RunMetricsSnapshot["outcome"] = budgetStopEvent !== undefined ? "budget-stopped" : "completed";
  const totalInputTokens = subResult.cost.inputTokens;
  const totalOutputTokens = subResult.cost.outputTokens;
  const totalCostUsd = subResult.cost.usd;
  const ownInputTokens =
    totalInputTokens - nestedCosts.reduce((sum, cost) => sum + cost.inputTokens, 0);
  const ownOutputTokens =
    totalOutputTokens - nestedCosts.reduce((sum, cost) => sum + cost.outputTokens, 0);
  const ownCostUsd =
    totalCostUsd - nestedCosts.reduce((sum, cost) => sum + cost.usd, 0);
  const turns = subResult.trace.events.filter((event) => event.type === "agent-turn").length;

  return {
    outcome,
    inputTokens: ownInputTokens,
    outputTokens: ownOutputTokens,
    costUsd: ownCostUsd,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    turns,
    durationMs
  };
}

function nestedSubRunCosts(result: RunResult): CostSummary[] {
  return result.trace.events.flatMap((event) => {
    if (event.type === "sub-run-completed") {
      return [event.subResult.cost];
    }
    if (event.type === "sub-run-failed") {
      return [event.partialCost];
    }
    return [];
  });
}

function subtractCost(total: CostSummary, nested: CostSummary): CostSummary {
  return {
    usd: total.usd - nested.usd,
    inputTokens: total.inputTokens - nested.inputTokens,
    outputTokens: total.outputTokens - nested.outputTokens,
    totalTokens: total.totalTokens - nested.totalTokens
  };
}

function handleMetricsEvent(state: MetricsState, event: RunEvent): void {
  const parentRunIds = (event as { readonly parentRunIds?: readonly string[] }).parentRunIds;
  if (parentRunIds !== undefined) {
    return;
  }

  switch (event.type) {
    case "agent-turn": {
      state.totalCost = event.cost;
      state.turns += 1;
      break;
    }
    case "broadcast":
    case "budget-stop":
    case "final": {
      state.totalCost = event.cost;
      break;
    }
    case "sub-run-started": {
      state.subRunStartTimes.set(event.childRunId, Date.now());
      break;
    }
    case "sub-run-completed": {
      state.totalCost = addCost(state.totalCost, event.subResult.cost);
      state.nestedCost = addCost(state.nestedCost, event.subResult.cost);
      const startMs = state.subRunStartTimes.get(event.childRunId);
      const durationMs = startMs !== undefined ? Date.now() - startMs : 0;
      state.subRunStartTimes.delete(event.childRunId);
      const snapshot = buildSubRunSnapshot(event.subResult, durationMs);
      fireHook(state.metricsHook.onSubRunComplete, snapshot, state.logger);
      break;
    }
    case "sub-run-failed": {
      state.totalCost = addCost(state.totalCost, event.partialCost);
      state.nestedCost = addCost(state.nestedCost, event.partialCost);
      state.subRunStartTimes.delete(event.childRunId);
      break;
    }
    default:
      break;
  }
}

function closeRunMetrics(state: MetricsState, result: RunResult | undefined): void {
  if (result !== undefined) {
    const snapshot = buildRunSnapshot(result, state.startedAtMs);
    fireHook(state.metricsHook.onRunComplete, snapshot, state.logger);
    return;
  }

  const ownCost = subtractCost(state.totalCost, state.nestedCost);
  const snapshot: RunMetricsSnapshot = {
    outcome: "aborted",
    inputTokens: ownCost.inputTokens,
    outputTokens: ownCost.outputTokens,
    costUsd: ownCost.usd,
    totalInputTokens: state.totalCost.inputTokens,
    totalOutputTokens: state.totalCost.outputTokens,
    totalCostUsd: state.totalCost.usd,
    turns: state.turns,
    durationMs: Date.now() - state.startedAtMs
  };
  fireHook(state.metricsHook.onRunComplete, snapshot, state.logger);
}

function handleTracingEvent(state: TracingState, event: RunEvent): void {
  const parentRunIds = (event as { readonly parentRunIds?: readonly string[] }).parentRunIds;
  if (parentRunIds !== undefined) {
    return;
  }

  if (state.runId === undefined) {
    state.runId = event.runId;
    state.runSpan.setAttribute("dogpile.run.id", event.runId);
  }

  switch (event.type) {
    case "model-request": {
      state.pendingModelRequests.set(event.callId, event);
      state.agentIds.add(event.agentId);

      if (!state.agentTurnSpans.has(event.agentId)) {
        const turnNumber = (state.agentTurnCounters.get(event.agentId) ?? 0) + 1;
        state.agentTurnCounters.set(event.agentId, turnNumber);
        const turnParent = state.subRunSpans.get(event.runId) ?? state.runSpan;
        const turnSpan = state.tracer.startSpan(DOGPILE_SPAN_NAMES.AGENT_TURN, {
          parent: turnParent,
          attributes: {
            "dogpile.agent.id": event.agentId,
            "dogpile.agent.role": event.role,
            "dogpile.turn.number": turnNumber,
            "dogpile.model.id": event.modelId
          }
        });
        state.agentTurnSpans.set(event.agentId, turnSpan);
      }

      const callParent =
        state.agentTurnSpans.get(event.agentId) ??
        state.subRunSpans.get(event.runId) ??
        state.runSpan;
      const callSpan = state.tracer.startSpan(DOGPILE_SPAN_NAMES.MODEL_CALL, {
        parent: callParent,
        attributes: {
          "dogpile.model.id": event.modelId,
          "dogpile.call.id": event.callId,
          "dogpile.provider.id": event.providerId
        }
      });
      state.modelCallSpans.set(event.callId, callSpan);
      break;
    }
    case "model-response": {
      const span = state.modelCallSpans.get(event.callId);
      if (span) {
        const inputTokens = event.response.usage?.inputTokens ?? 0;
        const outputTokens = event.response.usage?.outputTokens ?? 0;
        const responseCost: CostSummary = {
          usd: event.response.costUsd ?? 0,
          inputTokens,
          outputTokens,
          totalTokens: event.response.usage?.totalTokens ?? inputTokens + outputTokens
        };
        span.setAttribute("dogpile.model.input_tokens", inputTokens);
        span.setAttribute("dogpile.model.output_tokens", outputTokens);
        if (event.response.costUsd !== undefined) {
          span.setAttribute("dogpile.model.cost_usd", event.response.costUsd);
        }
        span.setStatus("ok");
        span.end();
        state.modelCallSpans.delete(event.callId);
        const accum = state.turnAccumByAgent.get(event.agentId) ?? {
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0
        };
        accum.inputTokens += inputTokens;
        accum.outputTokens += outputTokens;
        accum.costUsd += responseCost.usd;
        state.turnAccumByAgent.set(event.agentId, accum);
        state.lastCost = addCost(state.lastCost, responseCost);
      }
      state.pendingModelRequests.delete(event.callId);
      break;
    }
    case "agent-turn": {
      state.agentIds.add(event.agentId);
      state.turnCount += 1;
      state.lastCost = event.cost;
      const turnSpan = state.agentTurnSpans.get(event.agentId);
      if (turnSpan) {
        turnSpan.setAttribute("dogpile.agent.role", event.role);
        const accum = state.turnAccumByAgent.get(event.agentId);
        turnSpan.setAttribute("dogpile.turn.cost_usd", accum?.costUsd ?? 0);
        turnSpan.setAttribute("dogpile.turn.input_tokens", accum?.inputTokens ?? 0);
        turnSpan.setAttribute("dogpile.turn.output_tokens", accum?.outputTokens ?? 0);
        turnSpan.setStatus("ok");
        turnSpan.end();
        state.agentTurnSpans.delete(event.agentId);
      }
      state.turnAccumByAgent.delete(event.agentId);
      break;
    }
    case "broadcast":
    case "budget-stop":
    case "final": {
      state.lastCost = event.cost;
      break;
    }
    case "sub-run-started": {
      const span = state.tracer.startSpan(DOGPILE_SPAN_NAMES.SUB_RUN, {
        parent: state.runSpan,
        attributes: {
          "dogpile.sub_run.child_run_id": event.childRunId,
          "dogpile.sub_run.parent_run_id": event.parentRunId,
          "dogpile.sub_run.depth": event.depth
        }
      });
      state.subRunSpans.set(event.childRunId, span);
      break;
    }
    case "sub-run-completed": {
      const span = state.subRunSpans.get(event.childRunId);
      if (span) {
        span.setStatus("ok");
        span.end();
        state.subRunSpans.delete(event.childRunId);
      }
      break;
    }
    case "sub-run-failed": {
      const span = state.subRunSpans.get(event.childRunId);
      if (span) {
        span.setStatus("error", event.error.message);
        span.end();
        state.subRunSpans.delete(event.childRunId);
      }
      break;
    }
    default:
      break;
  }
}

function closeRunTracing(state: TracingState, result: RunResult | undefined, error?: unknown): void {
  if (error !== undefined) {
    if (state.runId !== undefined) {
      state.runSpan.setAttribute("dogpile.run.id", state.runId);
    }
    state.runSpan.setAttribute("dogpile.run.agent_count", state.agentIds.size);
    state.runSpan.setAttribute("dogpile.run.turn_count", state.turnCount);
    state.runSpan.setAttribute("dogpile.run.cost_usd", state.lastCost.usd);
    state.runSpan.setAttribute("dogpile.run.input_tokens", state.lastCost.inputTokens);
    state.runSpan.setAttribute("dogpile.run.output_tokens", state.lastCost.outputTokens);
    state.runSpan.setAttribute("dogpile.run.outcome", "aborted");
    state.runSpan.setStatus("error", error instanceof Error ? error.message : String(error));
    closeOpenTracingSpans(state);
    state.runSpan.end();
    return;
  }

  if (result === undefined) {
    closeOpenTracingSpans(state);
    state.runSpan.end();
    return;
  }

  const budgetStopEvent = result.trace.events.find((event): event is BudgetStopEvent => event.type === "budget-stop");
  const terminationReason = budgetStopEvent?.reason;
  const outcome = terminationReason !== undefined ? "budget-stopped" : "completed";
  state.runSpan.setAttribute("dogpile.run.id", result.trace.runId);
  state.runSpan.setAttribute("dogpile.run.agent_count", result.trace.agentsUsed.length);
  state.runSpan.setAttribute("dogpile.run.turn_count", result.trace.events.filter((event) => event.type === "agent-turn").length);
  state.runSpan.setAttribute("dogpile.run.cost_usd", result.cost.usd);
  state.runSpan.setAttribute("dogpile.run.input_tokens", result.cost.inputTokens);
  state.runSpan.setAttribute("dogpile.run.output_tokens", result.cost.outputTokens);
  state.runSpan.setAttribute("dogpile.run.outcome", outcome);
  if (terminationReason !== undefined) {
    state.runSpan.setAttribute("dogpile.run.termination_reason", terminationReason);
  }
  state.runSpan.setStatus("ok");
  closeOpenTracingSpans(state);
  state.runSpan.end();
}

function closeOpenTracingSpans(state: TracingState): void {
  for (const span of state.modelCallSpans.values()) {
    span.end();
  }
  state.modelCallSpans.clear();
  for (const span of state.agentTurnSpans.values()) {
    span.end();
  }
  state.agentTurnSpans.clear();
  for (const span of state.subRunSpans.values()) {
    span.end();
  }
  state.subRunSpans.clear();
}

async function runNonStreamingProtocol(options: NonStreamingProtocolOptions): Promise<RunResult> {
  const failureInstancesByChildRunId = new Map<string, DogpileError>();
  const abortLifecycle = createNonStreamingAbortLifecycle({
    callerSignal: options.signal,
    timeoutMs: runtimeTimeoutMs(options),
    providerId: options.model.id,
    timeoutErrorSource:
      options.currentDepth !== undefined &&
      options.currentDepth > 0 &&
      options.parentDeadlineMs === undefined
        ? "engine"
        : "runtime"
  });

  try {
    const emittedEvents: RunEvent[] = [];
    const result = await abortLifecycle.run(runProtocol({
      ...options,
      ...(abortLifecycle.signal !== undefined ? { signal: abortLifecycle.signal } : {}),
      emit(event: RunEvent): void {
        emittedEvents.push(event);
      },
      failureInstancesByChildRunId
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
      trace,
      health: computeHealth(trace, DEFAULT_HEALTH_THRESHOLDS)
    };
    const terminalThrow = resolveRuntimeTerminalThrow(runResult.trace, failureInstancesByChildRunId);
    if (terminalThrow) {
      throw terminalThrow;
    }
    return canonicalizeRunResult(await abortLifecycle.run(applyRunEvaluation(runResult, options.evaluate)));
  } catch (error: unknown) {
    throw abortLifecycle.translateError(error);
  } finally {
    failureInstancesByChildRunId.clear();
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

async function runProtocol(options: RunProtocolOptions): Promise<RunResult> {
  const tracing = openRunTracing({
    ...(options.tracer ? { tracer: options.tracer } : {}),
    ...(options.parentSpan ? { parentSpan: options.parentSpan } : {}),
    intent: options.intent,
    protocolKind: options.protocol.kind,
    tier: options.tier
  });
  const metrics = openRunMetrics({
    ...(options.metricsHook ? { metricsHook: options.metricsHook } : {}),
    ...(options.logger ? { logger: options.logger } : {})
  });
  const emitForProtocol =
    tracing || metrics || options.emit
      ? (event: RunEvent): void => {
        if (tracing) {
          handleTracingEvent(tracing, event);
        }
        if (metrics) {
          handleMetricsEvent(metrics, event);
        }
        options.emit?.(event);
      }
      : undefined;
  const protocolOptions = tracing
    ? {
      ...options,
      subRunSpansByChildId: tracing.subRunSpans
    }
    : options;

  try {
    const result = await runProtocolInner(protocolOptions, emitForProtocol);
    if (tracing) {
      closeRunTracing(tracing, result);
    }
    if (metrics && (options.currentDepth === 0 || options.currentDepth === undefined)) {
      closeRunMetrics(metrics, result);
    }
    return result;
  } catch (error) {
    if (tracing) {
      closeRunTracing(tracing, undefined, error);
    }
    if (metrics && (options.currentDepth === 0 || options.currentDepth === undefined)) {
      closeRunMetrics(metrics, undefined);
    }
    throw error;
  }
}

function runProtocolInner(
  options: RunProtocolOptions,
  emitForProtocol?: (event: RunEvent) => void
): Promise<RunResult> {
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
        ...(emitForProtocol ? { emit: emitForProtocol } : {})
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
        ...(emitForProtocol ? { emit: emitForProtocol } : {})
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
        ...(emitForProtocol ? { emit: emitForProtocol } : {}),
        ...(options.streamEvents !== undefined ? { streamEvents: options.streamEvents } : {}),
        currentDepth: options.currentDepth ?? 0,
        effectiveMaxDepth: options.effectiveMaxDepth ?? Infinity,
        effectiveMaxConcurrentChildren: options.effectiveMaxConcurrentChildren ?? DEFAULT_MAX_CONCURRENT_CHILDREN,
        onChildFailure: options.onChildFailure ?? "continue",
        ...(options.parentDeadlineMs !== undefined ? { parentDeadlineMs: options.parentDeadlineMs } : {}),
        ...(options.defaultSubRunTimeoutMs !== undefined
          ? { defaultSubRunTimeoutMs: options.defaultSubRunTimeoutMs }
          : {}),
        ...(options.registerAbortDrain !== undefined ? { registerAbortDrain: options.registerAbortDrain } : {}),
        ...(options.failureInstancesByChildRunId !== undefined
          ? { failureInstancesByChildRunId: options.failureInstancesByChildRunId }
          : {}),
        runProtocol: (childInput) => {
          const { runId: childRunId, ...childProtocolInput } = childInput;
          const childParent = options.subRunSpansByChildId?.get(childRunId) ?? options.parentSpan;
          return runProtocol({
            ...childProtocolInput,
            protocol: normalizeProtocol(childProtocolInput.protocol),
            ...(options.tracer ? { tracer: options.tracer } : {}),
            ...(childParent ? { parentSpan: childParent } : {}),
            ...(options.logger ? { logger: options.logger } : {})
          });
        }
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
        ...(emitForProtocol ? { emit: emitForProtocol } : {})
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
 *
 * Tracing and metrics: replay is intentionally tracing-free and metrics-free.
 * Even when an engine instance has been configured with a `tracer` or
 * `metricsHook` on its `EngineOptions`, calling this function emits no spans
 * or callbacks — replaying historical events with current timestamps would
 * confuse observability backends. See `docs/developer-usage.md`.
 */
// Tracing/metrics-free: replay never uses EngineOptions tracer or metricsHook.
export function replay(trace: Trace): RunResult {
  const cost = trace.finalOutput.cost;
  const lastEvent = trace.events.at(-1);
  // D-08 / D-10: rebuild accounting recursively from the saved trace and
  // verify every embedded sub-run's recorded accounting matches what the
  // child trace recomputes. Mismatches throw `invalid-configuration` with
  // `detail.reason: "trace-accounting-mismatch"`. No provider invocation.
  const accounting = recomputeAccountingFromTrace(trace);
  const replayThrow = resolveReplayTerminalThrow(trace);
  if (replayThrow) {
    throw replayThrow;
  }
  const baseResult = {
    output: trace.finalOutput.output,
    eventLog: createRunEventLog(
      trace.runId,
      trace.protocol,
      synthesizeProviderEvents(trace, trace.providerCalls)
    ),
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
    accounting,
    cost,
    health: computeHealth(trace, DEFAULT_HEALTH_THRESHOLDS)
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

function synthesizeProviderEvents(
  trace: Trace,
  providerCalls: readonly ReplayTraceProviderCall[]
): readonly RunEvent[] {
  const hasLiveProvenance = trace.events.some(
    (event) => event.type === "model-request" || event.type === "model-response"
  );
  if (hasLiveProvenance) {
    return trace.events;
  }

  const baseEvents = trace.events.filter(
    (event) => event.type !== "model-request" && event.type !== "model-response"
  );
  const result: RunEvent[] = [];
  let turnCount = 0;

  for (const event of baseEvents) {
    if (event.type === "agent-turn") {
      const call = providerCalls[turnCount];
      if (call !== undefined) {
        const modelId = typeof call.modelId === "string" && call.modelId.length > 0 ? call.modelId : call.providerId;
        result.push({
          type: "model-request",
          runId: trace.runId,
          callId: call.callId,
          providerId: call.providerId,
          modelId,
          startedAt: call.startedAt,
          agentId: call.agentId,
          role: call.role,
          request: call.request
        });
        result.push({
          type: "model-response",
          runId: trace.runId,
          callId: call.callId,
          providerId: call.providerId,
          modelId,
          startedAt: call.startedAt,
          completedAt: call.completedAt,
          agentId: call.agentId,
          role: call.role,
          response: call.response
        });
      }
      turnCount += 1;
    }
    result.push(event);
  }

  return result;
}

function resolveRuntimeTerminalThrow(
  trace: Trace,
  failureInstancesByChildRunId: ReadonlyMap<string, DogpileError>
): DogpileError | null {
  if (trace.triggeringFailureForAbortMode !== undefined) {
    return failureInstancesByChildRunId.get(trace.triggeringFailureForAbortMode.childRunId) ?? null;
  }

  const finalEvent = trace.events.at(-1);
  if (finalEvent?.type !== "final" || finalEvent.termination === undefined) {
    return null;
  }

  const lastFailure = findLastRealFailure(trace.events, failureInstancesByChildRunId);
  if (lastFailure === null) {
    return null;
  }
  if (hasFinalSynthesisAfterEvent(trace, lastFailure.eventIndex)) {
    return null;
  }
  return lastFailure.error;
}

function findLastRealFailure(
  events: readonly RunEvent[],
  failureInstancesByChildRunId: ReadonlyMap<string, DogpileError>
): { readonly error: DogpileError; readonly eventIndex: number } | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "sub-run-failed") {
      continue;
    }
    const instance = failureInstancesByChildRunId.get(event.childRunId);
    if (instance) {
      return { error: instance, eventIndex: index };
    }
  }
  return null;
}

function resolveReplayTerminalThrow(trace: Trace): DogpileError | null {
  if (trace.triggeringFailureForAbortMode !== undefined) {
    return dogpileErrorFromSerializedPayload(trace.triggeringFailureForAbortMode.error);
  }

  const finalEvent = trace.events.at(-1);
  if (finalEvent?.type !== "final" || finalEvent.termination === undefined) {
    return null;
  }

  const lastFailure = reconstructLastRealFailure(trace.events);
  if (lastFailure === null) {
    return null;
  }
  if (hasFinalSynthesisAfterEvent(trace, lastFailure.eventIndex)) {
    return null;
  }
  return lastFailure.error;
}

function reconstructLastRealFailure(
  events: readonly RunEvent[]
): { readonly error: DogpileError; readonly eventIndex: number } | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "sub-run-failed" || isSyntheticSubRunFailure(event)) {
      continue;
    }
    return { error: dogpileErrorFromSerializedPayload(event.error), eventIndex: index };
  }
  return null;
}

function hasFinalSynthesisAfterEvent(trace: Trace, eventIndex: number): boolean {
  return trace.protocolDecisions.some((decision) => {
    return decision.phase === "final-synthesis" && decision.eventIndex > eventIndex;
  });
}

function isSyntheticSubRunFailure(event: SubRunFailedEvent): boolean {
  const reason = event.error.detail?.["reason"];
  return reason === "sibling-failed" || reason === "parent-aborted";
}

function dogpileErrorFromSerializedPayload(input: {
  readonly code: string;
  readonly message: string;
  readonly providerId?: string;
  readonly detail?: JsonObject;
}): DogpileError {
  return new DogpileError({
    code: input.code as DogpileErrorCode,
    message: input.message,
    ...(input.providerId !== undefined ? { providerId: input.providerId } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {})
  });
}

/**
 * Replay a saved completed trace as a stream without invoking a model provider.
 *
 * @remarks
 * This is the streaming counterpart to {@link replay}. It yields the same
 * event sequence exposed by the replayed result event log, including legacy
 * provenance synthesis when a saved trace predates model request/response
 * events. Since all data comes from the trace, replay remains storage-free and
 * provider-free.
 *
 * Tracing and metrics: replayStream is intentionally tracing-free and
 * metrics-free. Even when an engine instance has been configured with a
 * `tracer` or `metricsHook` on its `EngineOptions`, calling this function
 * emits no spans or callbacks — replaying historical events with current
 * timestamps would confuse observability backends. See `docs/developer-usage.md`.
 */
// Tracing/metrics-free: replayStream never uses EngineOptions tracer or metricsHook.
export function replayStream(trace: Trace): StreamHandle {
  const result = Promise.resolve(replay(trace));
  const replayEvents = replayStreamEvents(trace);

  return {
    get status(): StreamHandleStatus {
      return "completed";
    },
    result,
    cancel(): void {
      // Replay streams are already completed snapshots, so cancellation is a no-op.
    },
    subscribe(subscriber: StreamEventSubscriber) {
      for (const event of replayEvents) {
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
          const event = replayEvents[index];
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

function replayStreamEvents(trace: Trace, parentRunIds: readonly string[] = []): StreamEvent[] {
  const events: StreamEvent[] = [];

  for (const event of synthesizeProviderEvents(trace, trace.providerCalls)) {
    if (event.type === "sub-run-completed") {
      events.push(...replayStreamEvents(event.subResult.trace, [...parentRunIds, trace.runId]));
    }
    events.push(wrapReplayStreamEvent(event, parentRunIds));
  }

  return events;
}

function wrapReplayStreamEvent(event: RunEvent, parentRunIds: readonly string[]): StreamEvent {
  if (parentRunIds.length === 0) {
    return event;
  }

  const inbound = (event as { readonly parentRunIds?: readonly string[] }).parentRunIds;
  return {
    ...event,
    parentRunIds: [...parentRunIds, ...(inbound ?? [])]
  } as StreamEvent;
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
      status: "cancelled",
      reason: "parent-aborted"
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

function assertRunDoesNotRaiseEngineMax(path: string, runValue: number | undefined, engineValue: number): void {
  if (runValue === undefined || runValue <= engineValue) {
    return;
  }
  throw new DogpileError({
    code: "invalid-configuration",
    message: `${path} cannot raise the engine ceiling (${engineValue}).`,
    retryable: false,
    detail: {
      kind: "configuration-validation",
      path,
      expected: `integer <= ${engineValue}`,
      actual: runValue
    }
  });
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
