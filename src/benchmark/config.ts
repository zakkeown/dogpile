import type {
  BenchmarkCostAccounting,
  BenchmarkProtocolArtifact,
  BenchmarkProtocolScore,
  BenchmarkRunnerConfig,
  BenchmarkRunArtifact,
  BenchmarkScoreDimension,
  BenchmarkStreamingEventLog,
  DogpileOptions,
  Protocol,
  ProtocolBenchmarkRunConfig,
  ProtocolConfig,
  RunEvent,
  RunResult
} from "../types.js";
import { stream } from "../runtime/engine.js";
import { stableJsonStringify } from "../runtime/defaults.js";

/**
 * Attach a protocol to shared benchmark settings for a single runner call.
 */
export function createProtocolBenchmarkRunConfig(
  config: BenchmarkRunnerConfig,
  protocol: Protocol | ProtocolConfig
): ProtocolBenchmarkRunConfig {
  return {
    ...config,
    protocol
  };
}

/**
 * Project a protocol benchmark config into the high-level Dogpile runner shape.
 *
 * The benchmark contract keeps input, budget, and model settings grouped for
 * comparison control; protocol runners consume the same values through the
 * existing single-call API.
 */
export function benchmarkRunOptions(config: ProtocolBenchmarkRunConfig): DogpileOptions {
  const options: DogpileOptions = {
    intent: config.task.intent,
    protocol: config.protocol,
    tier: config.budget.tier,
    model: config.model.provider
  };

  if (config.agents !== undefined) {
    return withOptionalSettings({ ...options, agents: config.agents }, config);
  }

  return withOptionalSettings(options, config);
}

/**
 * Package one completed benchmark run as a reproducible persistence artifact.
 *
 * The artifact is pure data: callers can persist it wherever their benchmark
 * harness stores results without Dogpile taking a dependency on filesystem or
 * database APIs.
 */
export function createBenchmarkRunArtifact(
  config: ProtocolBenchmarkRunConfig,
  result: RunResult,
  streamingEvents: readonly RunEvent[] = result.trace.events
): BenchmarkRunArtifact {
  const firstEvent = result.trace.events[0];
  const lastEvent = result.trace.events.at(-1);
  const eventLog = createBenchmarkStreamingEventLog(result, streamingEvents);
  const accounting = createBenchmarkCostAccounting(config, result);
  const score = createBenchmarkProtocolScore(result, eventLog, accounting);

  return {
    kind: "benchmark-run",
    schemaVersion: "1.0",
    runId: result.trace.runId,
    startedAt: firstEvent?.at ?? "",
    completedAt: lastEvent?.at ?? "",
    reproducibility: {
      task: config.task,
      budget: config.budget,
      protocol: benchmarkProtocolArtifact(config.protocol),
      modelProviderId: config.model.provider.id,
      ...(config.model.temperature !== undefined ? { temperature: config.model.temperature } : {}),
      ...(config.model.seed !== undefined ? { seed: config.model.seed } : {}),
      ...(config.model.metadata !== undefined ? { modelMetadata: config.model.metadata } : {}),
      agents: result.trace.agentsUsed,
      ...(config.metadata !== undefined ? { benchmarkMetadata: config.metadata } : {})
    },
    output: result.output,
    transcript: result.transcript,
    eventLog,
    trace: result.trace,
    accounting,
    score,
    cost: result.cost,
    ...(result.quality !== undefined ? { quality: result.quality } : {})
  };
}

/**
 * Capture streaming events from a benchmark run while preserving the final
 * single-call result shape.
 */
export async function runBenchmarkWithStreamingEventLog(
  config: ProtocolBenchmarkRunConfig
): Promise<{
  readonly result: RunResult;
  readonly eventLog: BenchmarkStreamingEventLog;
  readonly accounting: BenchmarkCostAccounting;
}> {
  const handle = stream(benchmarkRunOptions(config));
  const streamingEvents: RunEvent[] = [];

  for await (const event of handle) {
    if (event.type !== "error") {
      streamingEvents.push(event as RunEvent);
    }
  }

  const result = await handle.result;

  return {
    result,
    eventLog: createBenchmarkStreamingEventLog(result, streamingEvents),
    accounting: createBenchmarkCostAccounting(config, result)
  };
}

function benchmarkProtocolArtifact(protocol: Protocol | ProtocolConfig): BenchmarkProtocolArtifact {
  return {
    kind: typeof protocol === "string" ? protocol : protocol.kind,
    config: protocol
  };
}

function createBenchmarkStreamingEventLog(
  result: RunResult,
  events: readonly RunEvent[]
): BenchmarkStreamingEventLog {
  return {
    kind: "benchmark-streaming-event-log",
    runId: result.trace.runId,
    protocol: result.trace.protocol,
    eventTypes: events.map((event) => event.type),
    eventCount: events.length,
    events
  };
}

function createBenchmarkCostAccounting(
  config: ProtocolBenchmarkRunConfig,
  result: RunResult
): BenchmarkCostAccounting {
  return {
    kind: "benchmark-cost-accounting",
    tier: config.budget.tier,
    budget: config.budget,
    cost: result.cost,
    ...(config.budget.maxUsd !== undefined
      ? { usdCapUtilization: ratioOrZero(result.cost.usd, config.budget.maxUsd) }
      : {}),
    ...(config.budget.maxTotalTokens !== undefined
      ? { totalTokenCapUtilization: ratioOrZero(result.cost.totalTokens, config.budget.maxTotalTokens) }
      : {})
  };
}

function createBenchmarkProtocolScore(
  result: RunResult,
  eventLog: BenchmarkStreamingEventLog,
  accounting: BenchmarkCostAccounting
): BenchmarkProtocolScore {
  if (result.quality !== undefined) {
    const normalizedScore = clamp01(result.quality);
    return {
      kind: "benchmark-protocol-score",
      protocol: result.trace.protocol,
      score: normalizedScore * 100,
      normalizedScore,
      maxScore: 100,
      source: "run-quality",
      dimensions: [
        {
          name: "run_quality",
          score: normalizedScore * 100,
          maxScore: 100
        }
      ]
    };
  }

  const dimensions: BenchmarkScoreDimension[] = [
    {
      name: "output_captured",
      score: result.output.trim().length > 0 ? 20 : 0,
      maxScore: 20
    },
    {
      name: "transcript_captured",
      score: result.transcript.length > 0 && result.trace.transcript.length === result.transcript.length ? 20 : 0,
      maxScore: 20
    },
    {
      name: "event_log_captured",
      score: scoreEventLogCapture(result, eventLog),
      maxScore: 40
    },
    {
      name: "budget_respected",
      score: scoreBudgetCompliance(accounting),
      maxScore: 20
    }
  ];
  const score = dimensions.reduce((total, dimension) => total + dimension.score, 0);

  return {
    kind: "benchmark-protocol-score",
    protocol: result.trace.protocol,
    score,
    normalizedScore: score / 100,
    maxScore: 100,
    source: "artifact-completeness",
    dimensions
  };
}

function scoreEventLogCapture(result: RunResult, eventLog: BenchmarkStreamingEventLog): number {
  if (eventLog.events.length === 0) {
    return 0;
  }

  const hasFinal = eventLog.eventTypes.includes("final");
  const matchesTrace =
    eventLog.eventCount === result.trace.events.length &&
    eventLog.events.every((event, index) => stableJsonStringify(event) === stableJsonStringify(result.trace.events[index]));

  if (hasFinal && matchesTrace) {
    return 40;
  }

  if (hasFinal || matchesTrace) {
    return 20;
  }

  return 10;
}

function scoreBudgetCompliance(accounting: BenchmarkCostAccounting): number {
  const usdOk = accounting.usdCapUtilization === undefined || accounting.usdCapUtilization <= 1;
  const tokensOk =
    accounting.totalTokenCapUtilization === undefined || accounting.totalTokenCapUtilization <= 1;

  return usdOk && tokensOk ? 20 : 0;
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }

  return value;
}

function ratioOrZero(value: number, cap: number): number {
  if (cap <= 0) {
    return 0;
  }

  return value / cap;
}

function withOptionalSettings(
  options: DogpileOptions,
  config: ProtocolBenchmarkRunConfig
): DogpileOptions {
  const budget = {
    ...(config.budget.maxUsd !== undefined ? { maxUsd: config.budget.maxUsd } : {}),
    ...(config.budget.maxTotalTokens !== undefined ? { maxTokens: config.budget.maxTotalTokens } : {}),
    ...(config.budget.qualityWeight !== undefined ? { qualityWeight: config.budget.qualityWeight } : {})
  };
  const hasBudget = Object.keys(budget).length > 0;

  return {
    ...options,
    ...(config.model.temperature !== undefined ? { temperature: config.model.temperature } : {}),
    ...(hasBudget ? { budget } : {})
  };
}
