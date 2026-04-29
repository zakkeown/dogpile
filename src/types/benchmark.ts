import type {
  AgentSpec,
  ConfiguredModelProvider,
  CostSummary,
  JsonObject,
  ModelMessage,
  Protocol,
  ProtocolConfig,
  RunEvent,
  Tier,
  Trace,
  TranscriptEntry
} from "../types.js";

/**
 * Required output artifact for a benchmark task.
 */
export interface BenchmarkRequiredArtifact {
  /** Stable artifact name used by scorers and reports. */
  readonly name: string;
  /** Fixture-defined artifact shape, for example `enum` or `markdown_table`. */
  readonly type: string;
  /** Optional human-readable artifact requirement. */
  readonly description?: string;
  /** Optional allowed values for constrained artifacts. */
  readonly allowedValues?: readonly string[];
}

/**
 * Serializable task input shared by benchmark protocol runners.
 */
export interface BenchmarkTaskInput {
  /** Stable benchmark task id. */
  readonly id: string;
  /** Mission text supplied to protocol runners. */
  readonly intent: string;
  /** Optional task title for reports. */
  readonly title?: string;
  /** Optional benchmark difficulty or paper task level, such as `L3`. */
  readonly level?: string;
  /** Required artifacts the run output must contain. */
  readonly requiredArtifacts?: readonly BenchmarkRequiredArtifact[];
  /** Serializable scoring rubric or fixture-specific judging metadata. */
  readonly rubric?: JsonObject;
  /** Additional serializable fixture metadata. */
  readonly metadata?: JsonObject;
}

/**
 * Benchmark budget controls shared by all protocol runners in one comparison.
 */
export interface BenchmarkBudget {
  /** Named cost/quality tier selected for the benchmark run. */
  readonly tier: Tier;
  /** Optional maximum spend in US dollars. */
  readonly maxUsd?: number;
  /** Optional maximum input token count. */
  readonly maxInputTokens?: number;
  /** Optional maximum output token count. */
  readonly maxOutputTokens?: number;
  /** Optional maximum total token count. */
  readonly maxTotalTokens?: number;
  /** Optional quality preference in the inclusive range `0..1`. */
  readonly qualityWeight?: number;
}

/**
 * Benchmark model settings shared across protocol runners.
 *
 * @remarks
 * Research and reproduction workflows use this object to hold provider
 * settings constant while changing only the coordination protocol. The
 * `metadata` field is for serializable experiment labels such as corpus id,
 * prompt template version, model family, or paper reproduction condition.
 */
export interface BenchmarkModelSettings {
  /** Caller-configured model provider, typically backed by the Vercel AI SDK. */
  readonly provider: ConfiguredModelProvider;
  /** Optional fixed temperature for controlled reproduction runs. */
  readonly temperature?: number;
  /** Optional deterministic seed recorded for provider adapters that support it. */
  readonly seed?: number;
  /** Additional serializable provider or run metadata. */
  readonly metadata?: JsonObject;
}

/**
 * Shared benchmark runner configuration before selecting a protocol.
 *
 * @remarks
 * This contract carries the task input, budget policy, and model settings that
 * must stay constant when comparing multiple coordination protocols. It is the
 * researcher-facing escape hatch for paper-faithfulness checks: callers can
 * project one task into Sequential, Broadcast, Shared, and Coordinator runs
 * while preserving the same agents, tier, caps, model, and fixture metadata.
 *
 * The object is intentionally JSON-adjacent and storage-free. Persist benchmark
 * inputs, run manifests, and traces in caller-owned systems.
 */
export interface BenchmarkRunnerConfig {
  /** Serializable benchmark task input. */
  readonly task: BenchmarkTaskInput;
  /** Shared budget and cap policy. */
  readonly budget: BenchmarkBudget;
  /** Shared model provider and generation settings. */
  readonly model: BenchmarkModelSettings;
  /** Optional explicit agents; defaults are used when omitted. */
  readonly agents?: readonly AgentSpec[];
  /** Additional serializable benchmark metadata. */
  readonly metadata?: JsonObject;
}

/**
 * Benchmark configuration for one concrete protocol runner invocation.
 *
 * @remarks
 * Use this derived shape after selecting the protocol under test. It preserves
 * the shared benchmark controls from {@link BenchmarkRunnerConfig} and adds a
 * named or explicit {@link ProtocolConfig}, which lets reproduction code tune
 * protocol-native parameters without widening the high-level API.
 */
export interface ProtocolBenchmarkRunConfig extends BenchmarkRunnerConfig {
  /** Protocol being evaluated under the shared benchmark settings. */
  readonly protocol: Protocol | ProtocolConfig;
}

/**
 * Serializable benchmark protocol descriptor persisted with run artifacts.
 *
 * @remarks
 * Benchmark artifacts record both the normalized protocol name and the exact
 * caller-supplied protocol config so a reproduction harness can distinguish
 * `"sequential"` defaults from `{ kind: "sequential", maxTurns: 4 }`.
 */
export interface BenchmarkProtocolArtifact {
  /** Normalized protocol name used for comparison grouping. */
  readonly kind: Protocol;
  /** Exact protocol value supplied to the runner. */
  readonly config: Protocol | ProtocolConfig;
}

/**
 * Reproducibility metadata persisted with every benchmark run artifact.
 *
 * @remarks
 * This shape intentionally stores provider identity and serializable model
 * settings, but not the provider implementation itself. Callers own provider
 * construction and external storage; Dogpile owns the portable artifact shape.
 */
export interface BenchmarkReproducibilityArtifact {
  /** Benchmark task input used for this run. */
  readonly task: BenchmarkTaskInput;
  /** Shared budget and cap policy used for this run. */
  readonly budget: BenchmarkBudget;
  /** Protocol selected for this run. */
  readonly protocol: BenchmarkProtocolArtifact;
  /** Provider id recorded from the configured model. */
  readonly modelProviderId: string;
  /** Optional fixed temperature used for the run. */
  readonly temperature?: number;
  /** Optional deterministic seed recorded for provider adapters that support it. */
  readonly seed?: number;
  /** Additional serializable provider or run metadata. */
  readonly modelMetadata?: JsonObject;
  /** Concrete agent roster used for the run. */
  readonly agents: readonly AgentSpec[];
  /** Additional serializable benchmark metadata. */
  readonly benchmarkMetadata?: JsonObject;
}

/**
 * Cost and budget metadata recorded for one benchmark run.
 *
 * @remarks
 * This accounting block is intentionally duplicated from the run result and
 * benchmark controls so benchmark reports can group, filter, and audit spend
 * without unpacking the full trace or reproduction object. Utilization fields
 * are only present when the corresponding cap was configured.
 */
export interface BenchmarkCostAccounting {
  /** Accounting artifact discriminant for future benchmark metadata unions. */
  readonly kind: "benchmark-cost-accounting";
  /** Named budget/cost tier selected for this benchmark run. */
  readonly tier: Tier;
  /** Shared benchmark budget and cap policy used for this run. */
  readonly budget: BenchmarkBudget;
  /** Total token and spend accounting observed for this run. */
  readonly cost: CostSummary;
  /** Fraction of the configured USD cap consumed, when `maxUsd` is present. */
  readonly usdCapUtilization?: number;
  /** Fraction of the configured total-token cap consumed, when `maxTotalTokens` is present. */
  readonly totalTokenCapUtilization?: number;
}

/**
 * Structured streaming event log captured for one benchmark run.
 *
 * @remarks
 * Benchmark artifacts keep this log beside the full trace so reproduction
 * harnesses can inspect exactly what the streaming API yielded during the run
 * without unpacking unrelated trace metadata. The `events` array must match
 * `trace.events` for completed runs.
 */
export interface BenchmarkStreamingEventLog {
  /** Event-log discriminant for future benchmark observability artifacts. */
  readonly kind: "benchmark-streaming-event-log";
  /** Stable run id shared by the benchmark artifact and trace. */
  readonly runId: string;
  /** Protocol whose streaming events were captured. */
  readonly protocol: Protocol;
  /** Ordered event kinds for compact coverage checks. */
  readonly eventTypes: readonly RunEvent["type"][];
  /** Number of streaming events captured. */
  readonly eventCount: number;
  /** Complete ordered streaming events yielded by the run. */
  readonly events: readonly RunEvent[];
}

/**
 * Serializable score persisted for one protocol benchmark artifact.
 *
 * @remarks
 * The score is protocol-scoped because paper reproduction reports compare the
 * same task across protocol variants. When a judge supplies
 * {@link RunResult.quality}, the benchmark score records that value on a
 * 0..100 scale. Otherwise Dogpile computes a conservative artifact-completeness
 * score from the captured output, transcript, streaming event log, and budget
 * accounting so unjudged benchmark artifacts still carry an auditable score
 * derived from stored data.
 */
export interface BenchmarkProtocolScore {
  /** Score artifact discriminant for future benchmark scoring variants. */
  readonly kind: "benchmark-protocol-score";
  /** Protocol this score belongs to. */
  readonly protocol: Protocol;
  /** Score in the inclusive range `0..100`. */
  readonly score: number;
  /** Normalized score in the inclusive range `0..1`. */
  readonly normalizedScore: number;
  /** Maximum score for the current scoring scale. */
  readonly maxScore: 100;
  /** How the score was derived. */
  readonly source: "run-quality" | "artifact-completeness";
  /** Compact scoring dimensions used to compute the stored score. */
  readonly dimensions: readonly BenchmarkScoreDimension[];
}

/**
 * One serializable dimension contributing to a benchmark protocol score.
 */
export interface BenchmarkScoreDimension {
  /** Stable dimension name for reports. */
  readonly name: string;
  /** Earned points for this dimension. */
  readonly score: number;
  /** Maximum points available for this dimension. */
  readonly maxScore: number;
}

/**
 * Reproducible benchmark output artifact for one protocol run.
 *
 * @remarks
 * This is the storage-free persistence contract for reproduction workflows:
 * callers can write the object to JSON, NDJSON, object storage, or a database
 * without Dogpile depending on Node-only filesystem APIs. It contains the final
 * output, full transcript, a structured streaming event log, full trace, cost
 * summary, and all serializable controls needed to replay the run in
 * caller-managed infrastructure.
 */
export interface BenchmarkRunArtifact {
  /** Artifact discriminant for future benchmark artifact unions. */
  readonly kind: "benchmark-run";
  /** Schema version for reproducible artifact consumers. */
  readonly schemaVersion: "1.0";
  /** Stable run id from the trace. */
  readonly runId: string;
  /** ISO-8601 timestamp derived from the first trace event when available. */
  readonly startedAt: string;
  /** ISO-8601 timestamp derived from the final trace event when available. */
  readonly completedAt: string;
  /** Reproduction controls and serializable fixture inputs. */
  readonly reproducibility: BenchmarkReproducibilityArtifact;
  /** Final output produced by the protocol. */
  readonly output: string;
  /** Complete normalized transcript for this run. */
  readonly transcript: readonly TranscriptEntry[];
  /** Structured streaming event log captured for this benchmark run. */
  readonly eventLog: BenchmarkStreamingEventLog;
  /** Full serializable event log and trace for this run. */
  readonly trace: Trace;
  /** Cost, tier, and benchmark budget metadata for this run. */
  readonly accounting: BenchmarkCostAccounting;
  /** Per-protocol benchmark score computed from the captured artifact data. */
  readonly score: BenchmarkProtocolScore;
  /** Total token and spend accounting for this run. */
  readonly cost: CostSummary;
  /** Optional normalized quality score in the inclusive range `0..1`. */
  readonly quality?: number;
}
