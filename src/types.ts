/**
 * Primitive JSON value accepted in serializable trace metadata.
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * JSON-compatible value used for trace metadata, model request metadata, and
 * caller-managed replay artifacts.
 *
 * Dogpile core is stateless, so everything needed to inspect or persist a run
 * is represented with serializable data instead of SDK-owned storage.
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

/**
 * JSON-compatible object with immutable properties.
 */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

const dogpileErrorCodes = [
  "invalid-configuration",
  "aborted",
  "timeout",
  "provider-authentication",
  "provider-invalid-request",
  "provider-invalid-response",
  "provider-not-found",
  "provider-rate-limited",
  "provider-timeout",
  "provider-unavailable",
  "provider-unsupported",
  "provider-error",
  "unknown"
] as const;

/**
 * Stable machine-readable error codes thrown by Dogpile public adapters.
 *
 * @remarks
 * The string values are part of the v1 API contract so JavaScript callers can
 * branch on provider failures without depending on provider SDK classes.
 */
export type DogpileErrorCode = (typeof dogpileErrorCodes)[number];

/**
 * Options used to construct a stable Dogpile public error.
 */
export interface DogpileErrorOptions<Code extends DogpileErrorCode = DogpileErrorCode> {
  /** Stable machine-readable error code. */
  readonly code: Code;
  /** Human-readable error message. */
  readonly message: string;
  /** Original thrown value, kept off JSON serialization by default. */
  readonly cause?: unknown;
  /** Whether caller retry policy may safely retry the same operation. */
  readonly retryable?: boolean;
  /** Configured provider id associated with the failure, when available. */
  readonly providerId?: string;
  /** Optional serializable diagnostic detail. */
  readonly detail?: JsonObject;
}

interface DogpileErrorBase<Code extends DogpileErrorCode> extends Error {
  /** Public error class name. */
  readonly name: "DogpileError";
  /** Stable machine-readable error code. */
  readonly code: Code;
  /** Whether caller retry policy may safely retry the same operation. */
  readonly retryable?: boolean;
  /** Configured provider id associated with the failure, when available. */
  readonly providerId?: string;
  /** Optional serializable diagnostic detail. */
  readonly detail?: JsonObject;
  /** Original thrown value, if Dogpile wrapped a lower-level failure. */
  readonly cause?: unknown;
  /** JSON-safe representation for logs, traces, and observability tools. */
  toJSON(): JsonObject;
}

export type DogpileInvalidConfigurationError = DogpileErrorBase<"invalid-configuration">;
export type DogpileAbortedError = DogpileErrorBase<"aborted">;
export type DogpileTimeoutError = DogpileErrorBase<"timeout">;
export type DogpileProviderAuthenticationError = DogpileErrorBase<"provider-authentication">;
export type DogpileProviderInvalidRequestError = DogpileErrorBase<"provider-invalid-request">;
export type DogpileProviderInvalidResponseError = DogpileErrorBase<"provider-invalid-response">;
export type DogpileProviderNotFoundError = DogpileErrorBase<"provider-not-found">;
export type DogpileProviderRateLimitedError = DogpileErrorBase<"provider-rate-limited">;
export type DogpileProviderTimeoutError = DogpileErrorBase<"provider-timeout">;
export type DogpileProviderUnavailableError = DogpileErrorBase<"provider-unavailable">;
export type DogpileProviderUnsupportedError = DogpileErrorBase<"provider-unsupported">;
export type DogpileProviderError = DogpileErrorBase<"provider-error">;
export type DogpileUnknownError = DogpileErrorBase<"unknown">;

/**
 * Public Dogpile error union with stable string code discriminants.
 *
 * @remarks
 * `code` is the discriminant for exhaustive caller handling. The exported
 * `DogpileError` value is still the constructor used to create these errors.
 */
export type DogpileError =
  | DogpileInvalidConfigurationError
  | DogpileAbortedError
  | DogpileTimeoutError
  | DogpileProviderAuthenticationError
  | DogpileProviderInvalidRequestError
  | DogpileProviderInvalidResponseError
  | DogpileProviderNotFoundError
  | DogpileProviderRateLimitedError
  | DogpileProviderTimeoutError
  | DogpileProviderUnavailableError
  | DogpileProviderUnsupportedError
  | DogpileProviderError
  | DogpileUnknownError;

export type DogpileErrorByCode<Code extends DogpileErrorCode> = Extract<DogpileError, { readonly code: Code }>;

export interface DogpileErrorConstructor {
  new <Code extends DogpileErrorCode>(options: DogpileErrorOptions<Code>): DogpileErrorByCode<Code>;
  readonly prototype: DogpileError;
  /**
   * Cross-realm guard for Dogpile public errors.
   */
  isInstance(error: unknown): error is DogpileError;
}

class DogpileErrorImpl extends Error implements DogpileErrorBase<DogpileErrorCode> {
  override name = "DogpileError" as const;
  /** Stable machine-readable error code. */
  readonly code: DogpileErrorCode;
  /** Whether caller retry policy may safely retry the same operation. */
  readonly retryable?: boolean;
  /** Configured provider id associated with the failure, when available. */
  readonly providerId?: string;
  /** Optional serializable diagnostic detail. */
  readonly detail?: JsonObject;
  /** Original thrown value, if Dogpile wrapped a lower-level failure. */
  readonly cause?: unknown;

  constructor(options: DogpileErrorOptions) {
    super(options.message);
    this.code = options.code;

    if (options.retryable !== undefined) {
      this.retryable = options.retryable;
    }
    if (options.providerId !== undefined) {
      this.providerId = options.providerId;
    }
    if (options.detail !== undefined) {
      this.detail = options.detail;
    }
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }

    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Cross-realm guard for Dogpile public errors.
   */
  static isInstance(error: unknown): error is DogpileError {
    if (error instanceof DogpileErrorImpl) {
      return true;
    }

    if (!isRecord(error)) {
      return false;
    }

    return error.name === "DogpileError" && isDogpileErrorCode(error.code) && typeof error.message === "string";
  }

  /**
   * JSON-safe representation for logs, traces, and observability tools.
   */
  toJSON(): JsonObject {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.retryable !== undefined ? { retryable: this.retryable } : {}),
      ...(this.providerId !== undefined ? { providerId: this.providerId } : {}),
      ...(this.detail !== undefined ? { detail: this.detail } : {})
    };
  }
}

/**
 * Public Dogpile error constructor.
 */
export const DogpileError = DogpileErrorImpl as DogpileErrorConstructor;

function isDogpileErrorCode(value: unknown): value is DogpileErrorCode {
  return typeof value === "string" && dogpileErrorCodes.includes(value as DogpileErrorCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Coordination protocols supported by the public SDK surface.
 *
 * Supported values:
 *
 * - `coordinator`: a coordinator assigns work and synthesizes a final answer.
 * - `sequential`: agents refine the answer one after another.
 * - `broadcast`: agents answer the same mission independently before merge.
 * - `shared`: agents collaborate through shared state.
 *
 * Passing a string protocol uses the SDK defaults from {@link ProtocolConfig}:
 * `maxTurns: 3` for `coordinator`, `sequential`, and `shared`, and
 * `maxRounds: 2` for `broadcast`.
 */
export type Protocol = "coordinator" | "sequential" | "broadcast" | "shared";

/**
 * Public coordination protocol selector name.
 *
 * @remarks
 * This alias is the caller-facing literal union shared by high-level calls,
 * low-level engine configuration, traces, events, and benchmark artifacts.
 * `Protocol` remains the short compatibility name for the same public union.
 */
export type ProtocolName = Protocol;

/**
 * Named cost and quality presets.
 *
 * Supported values:
 *
 * - `fast`: minimizes latency and spend; default temperature is `0`.
 * - `balanced`: general-purpose tradeoff; default temperature is `0.2`.
 * - `quality`: spends more work on answer quality; default temperature is `0.4`.
 *
 * High-level workflow calls default to `balanced` when callers omit a tier.
 * Low-level engine configuration keeps the tier explicit for repeatable
 * research runs.
 */
export type BudgetTier = "fast" | "balanced" | "quality";

/**
 * Short compatibility name for the public budget tier union.
 */
export type Tier = BudgetTier;

/**
 * Sequential protocol configuration.
 *
 * Agents contribute in order, with each turn seeing the prior transcript.
 * Default when `protocol: "sequential"` is supplied: `{ kind: "sequential",
 * maxTurns: 3 }`.
 */
export interface SequentialProtocolConfig {
  /** Discriminant for exhaustive protocol handling. */
  readonly kind: "sequential";
  /** Maximum number of agent turns to execute; defaults to `3` for named protocols. */
  readonly maxTurns?: number;
  /**
   * Floor for convergence and judge termination checks.
   *
   * Budget caps still apply immediately. Defaults to `0` when omitted.
   */
  readonly minTurns?: number;
}

/**
 * Coordinator protocol configuration.
 *
 * A coordinator manages worker turns and synthesizes the final output.
 * Default when `protocol: "coordinator"` is supplied: `{ kind: "coordinator",
 * maxTurns: 3 }`.
 */
export interface CoordinatorProtocolConfig {
  /** Discriminant for exhaustive protocol handling. */
  readonly kind: "coordinator";
  /** Maximum number of coordinator-managed turns to execute; defaults to `3` for named protocols. */
  readonly maxTurns?: number;
  /**
   * Floor for convergence and judge termination checks.
   *
   * Budget caps still apply immediately. Defaults to `0` when omitted.
   */
  readonly minTurns?: number;
}

/**
 * Broadcast protocol configuration.
 *
 * Agents independently answer the same mission before a merge/synthesis step.
 * Default when `protocol: "broadcast"` is supplied: `{ kind: "broadcast",
 * maxRounds: 2 }`.
 */
export interface BroadcastProtocolConfig {
  /** Discriminant for exhaustive protocol handling. */
  readonly kind: "broadcast";
  /** Maximum number of broadcast/merge rounds to execute; defaults to `2` for named protocols. */
  readonly maxRounds?: number;
  /**
   * Floor for convergence and judge termination checks.
   *
   * Budget caps still apply immediately. Defaults to `0` when omitted.
   */
  readonly minRounds?: number;
}

/**
 * Shared-state protocol configuration.
 *
 * Agents coordinate by reading and updating a shared working state.
 * Default when `protocol: "shared"` is supplied: `{ kind: "shared",
 * maxTurns: 3 }`.
 */
export interface SharedProtocolConfig {
  /** Discriminant for exhaustive protocol handling. */
  readonly kind: "shared";
  /** Maximum number of shared-state turns to execute; defaults to `3` for named protocols. */
  readonly maxTurns?: number;
  /**
   * Floor for convergence and judge termination checks.
   *
   * Budget caps still apply immediately. Defaults to `0` when omitted.
   */
  readonly minTurns?: number;
  /** Optional organizational memory snapshot visible to every shared agent. */
  readonly organizationalMemory?: string;
}

/**
 * Discriminated protocol configuration union for low-level runs.
 *
 * Use this union when the named {@link Protocol} defaults are too coarse. The
 * `kind` property is the discriminant and supported values are `coordinator`,
 * `sequential`, `broadcast`, and `shared`.
 */
export type ProtocolConfig =
  | SequentialProtocolConfig
  | CoordinatorProtocolConfig
  | BroadcastProtocolConfig
  | SharedProtocolConfig;

/**
 * Budget policy composed from a named tier plus optional hard caps.
 *
 * Supported `tier` values are `fast`, `balanced`, and `quality`. The tier
 * selects default execution behavior such as temperature, while `maxUsd`,
 * `maxTokens`, and `qualityWeight` layer caller-owned cost policy over that
 * preset.
 *
 * The SDK should halt before cap breach and report accumulated usage in
 * {@link CostSummary}. `qualityWeight` expresses how strongly the caller values
 * spending additional budget for higher answer quality.
 */
export interface Budget {
  /** Named preset used to choose default execution behavior; recommended default is `balanced`. */
  readonly tier: BudgetTier;
  /** Optional maximum spend in US dollars; omit for no SDK-enforced dollar cap. */
  readonly maxUsd?: number;
  /** Optional maximum total token count; omit for no SDK-enforced token cap. */
  readonly maxTokens?: number;
  /** Optional maximum completed model-turn iterations; omit for no SDK-enforced iteration cap. */
  readonly maxIterations?: number;
  /** Optional maximum elapsed runtime in milliseconds; omit for no SDK-enforced timeout cap. */
  readonly timeoutMs?: number;
  /** Optional quality preference in the inclusive range `0..1`; omit to use the tier default. */
  readonly qualityWeight?: number;
}

/**
 * Serializable termination condition for cost-controlled and quality-aware runs.
 *
 * @remarks
 * Conditions are discriminated by `kind` so callers can compose and inspect
 * stop policies without relying on functions, closures, storage, or
 * runtime-specific state. Use {@link FirstOfTerminationCondition} when multiple
 * conditions should race and the first terminating condition should win.
 */
export type TerminationCondition =
  | BudgetTerminationCondition
  | ConvergenceTerminationCondition
  | JudgeTerminationCondition
  | FirstOfTerminationCondition;

/**
 * Primitive, non-composite termination conditions accepted by `firstOf`.
 */
export type PrimitiveTerminationCondition =
  | BudgetTerminationCondition
  | ConvergenceTerminationCondition
  | JudgeTerminationCondition;

/**
 * Halt when observed usage reaches or would exceed a configured cap.
 */
export interface BudgetTerminationCondition {
  /** Discriminant for exhaustive termination handling. */
  readonly kind: "budget";
  /** Optional maximum spend in US dollars. */
  readonly maxUsd?: number;
  /** Optional maximum total token count. */
  readonly maxTokens?: number;
  /** Optional maximum completed model-turn iterations. */
  readonly maxIterations?: number;
  /** Optional maximum elapsed runtime in milliseconds. */
  readonly timeoutMs?: number;
}

/**
 * Normalized machine-readable reason for a budget stop.
 */
export type BudgetStopReason = "cost" | "tokens" | "iterations" | "timeout";

/**
 * Halt when recent outputs are stable enough to treat the run as converged.
 */
export interface ConvergenceTerminationCondition {
  /** Discriminant for exhaustive termination handling. */
  readonly kind: "convergence";
  /** Number of consecutive stable turns required before terminating. */
  readonly stableTurns: number;
  /** Similarity threshold in the inclusive range `0..1`. */
  readonly minSimilarity: number;
}

/**
 * Halt when a judge accepts, rejects, or scores the current run state.
 */
export interface JudgeTerminationCondition {
  /** Discriminant for exhaustive termination handling. */
  readonly kind: "judge";
  /** Model-visible rubric or serialized judge configuration. */
  readonly rubric: string | JsonObject;
  /** Optional score threshold in the inclusive range `0..1`. */
  readonly minScore?: number;
}

/**
 * Normalized machine-readable reason for a judge stop.
 */
export type JudgeStopReason = "accepted" | "rejected" | "score-threshold";

/**
 * Normalized machine-readable stop reason across all termination evaluators.
 */
export type NormalizedStopReason =
  | "budget:cost"
  | "budget:tokens"
  | "budget:iterations"
  | "budget:timeout"
  | "convergence"
  | "judge:accepted"
  | "judge:rejected"
  | "judge:score-threshold";

/**
 * Serializable judge decision visible to judge termination evaluators.
 *
 * @remarks
 * Judge decisions are deliberately separate from budget and convergence state:
 * a caller-owned evaluator can record an explicit accept/reject verdict or a
 * normalized score without coupling termination checks to cost caps or protocol
 * transcript similarity.
 */
export type JudgeEvaluationDecision =
  | JudgeAcceptDecision
  | JudgeRejectDecision
  | JudgeScoreDecision;

/**
 * Judge verdict that accepts the current run state.
 */
export interface JudgeAcceptDecision {
  /** Decision discriminant for exhaustive judge handling. */
  readonly type: "accept";
  /** Optional normalized quality score in the inclusive range `0..1`. */
  readonly score?: NormalizedQualityScore;
  /** Optional serializable rationale for trace diagnostics. */
  readonly rationale?: string;
  /** Optional serializable judge metadata. */
  readonly metadata?: JsonObject;
}

/**
 * Judge verdict that rejects the current run state.
 */
export interface JudgeRejectDecision {
  /** Decision discriminant for exhaustive judge handling. */
  readonly type: "reject";
  /** Optional normalized quality score in the inclusive range `0..1`. */
  readonly score?: NormalizedQualityScore;
  /** Optional serializable rationale for trace diagnostics. */
  readonly rationale?: string;
  /** Optional serializable judge metadata. */
  readonly metadata?: JsonObject;
}

/**
 * Judge score without a hard accept/reject verdict.
 */
export interface JudgeScoreDecision {
  /** Decision discriminant for exhaustive judge handling. */
  readonly type: "score";
  /** Normalized quality score in the inclusive range `0..1`. */
  readonly score: NormalizedQualityScore;
  /** Optional serializable rationale for trace diagnostics. */
  readonly rationale?: string;
  /** Optional serializable judge metadata. */
  readonly metadata?: JsonObject;
}

/**
 * Input tuple accepted by a `firstOf(...conditions)` helper.
 */
export type FirstOfTerminationConditions = readonly [
  PrimitiveTerminationCondition | FirstOfTerminationCondition,
  ...(PrimitiveTerminationCondition | FirstOfTerminationCondition)[]
];

/**
 * Composite termination condition where the earliest terminating child wins.
 */
export interface FirstOfTerminationCondition {
  /** Discriminant for exhaustive termination handling. */
  readonly kind: "firstOf";
  /** Ordered child conditions evaluated by the composite. */
  readonly conditions: FirstOfTerminationConditions;
}

/**
 * Serializable input passed to a firstOf composition evaluator.
 */
export interface FirstOfTerminationInput {
  /** Composition input discriminant for logs and tests. */
  readonly kind: "firstOf-input";
  /** Conditions to evaluate in order. */
  readonly conditions: FirstOfTerminationConditions;
  /** Current run state visible to termination evaluators. */
  readonly context: TerminationEvaluationContext;
}

/**
 * Current run state visible to termination evaluators.
 */
export interface TerminationEvaluationContext {
  /** Stable id for the workflow run being evaluated. */
  readonly runId: string;
  /** Protocol currently executing. */
  readonly protocol: Protocol;
  /** Exact normalized protocol configuration when the evaluator needs protocol-specific limits. */
  readonly protocolConfig?: ProtocolConfig;
  /** Cost/quality tier selected for the run. */
  readonly tier: BudgetTier;
  /** Current accumulated cost and token usage. */
  readonly cost: CostSummary;
  /** Completed coordination events available at the evaluation point. */
  readonly events: readonly RunEvent[];
  /** Completed transcript entries available at the evaluation point. */
  readonly transcript: readonly TranscriptEntry[];
  /** Completed model-turn iterations at the evaluation point. */
  readonly iteration?: number;
  /** Protocol-native progress count: turns for sequential/coordinator/shared, rounds for broadcast. */
  readonly protocolIteration?: number;
  /** Elapsed runtime in milliseconds at the evaluation point. */
  readonly elapsedMs?: number;
  /** Effective hard caps visible to this evaluation point. */
  readonly budget?: BudgetCaps;
  /** Remaining headroom computed from the effective hard caps at this evaluation point. */
  readonly remainingBudget?: RemainingBudget;
  /** Optional normalized judge or quality score in the inclusive range `0..1`. */
  readonly quality?: NormalizedQualityScore;
  /** Optional caller-owned judge decision for judge termination checks. */
  readonly judgeDecision?: JudgeEvaluationDecision;
  /** Additional serializable evaluator metadata. */
  readonly metadata?: JsonObject;
}

/**
 * Remaining budget headroom derived from the current evaluation context.
 */
export interface RemainingBudget {
  /** Remaining turn iterations before an iteration cap is reached. */
  readonly iterations?: number;
  /** Remaining elapsed milliseconds before a timeout cap is reached. */
  readonly timeoutMs?: number;
  /** Remaining spend in US dollars before a cost cap is reached. */
  readonly usd?: number;
  /** Remaining total tokens before a token cap is reached. */
  readonly tokens?: number;
}

/**
 * Decision returned by a termination condition evaluator.
 */
export type TerminationDecision = ContinueTerminationDecision | StopTerminationDecision;

/**
 * Continue running because a condition has not fired.
 */
export interface ContinueTerminationDecision {
  /** Decision discriminant for exhaustive termination handling. */
  readonly type: "continue";
  /** Condition that was evaluated. */
  readonly condition: TerminationCondition;
}

/**
 * Stop running because a condition fired.
 */
export interface StopTerminationDecision {
  /** Decision discriminant for exhaustive termination handling. */
  readonly type: "stop";
  /** Condition that fired. */
  readonly condition: TerminationCondition;
  /** Machine-readable stop reason. */
  readonly reason: "budget" | "convergence" | "judge";
  /** Normalized machine-readable stop reason across all stop classes. */
  readonly normalizedReason: NormalizedStopReason;
  /** Normalized budget stop reason when `reason` is `budget`. */
  readonly budgetReason?: BudgetStopReason;
  /** Normalized judge stop reason when `reason` is `judge`. */
  readonly judgeReason?: JudgeStopReason;
  /** Optional serializable detail for traces and diagnostics. */
  readonly detail?: JsonObject;
}

/**
 * Output returned after evaluating a `firstOf` composition.
 */
export interface FirstOfTerminationOutput {
  /** Composition output discriminant for logs and tests. */
  readonly kind: "firstOf-output";
  /** Final decision for the composite condition. */
  readonly decision: TerminationDecision;
  /** Zero-based index of the child condition that fired, or `null` if none fired. */
  readonly winningConditionIndex: number | null;
  /** Per-child decisions in evaluation order. */
  readonly evaluated: readonly TerminationDecision[];
}

/**
 * Serializable diagnostics for a firstOf composition that stopped a run.
 */
export interface FirstOfTerminationStopRecord {
  /** Composition stop discriminant for trace consumers. */
  readonly kind: "firstOf-stop";
  /** Zero-based index of the top-level child condition that fired. */
  readonly winningConditionIndex: number;
  /** Top-level child condition that fired. */
  readonly winningCondition: TerminationCondition;
  /** Concrete condition that produced the stop decision. */
  readonly firedCondition: TerminationCondition;
  /** Per-child decisions in evaluation order. */
  readonly evaluated: readonly TerminationDecision[];
}

/**
 * Serializable record of the termination condition that stopped a run.
 */
export interface TerminationStopRecord {
  /** Stop record discriminant for trace consumers. */
  readonly kind: "termination-stop";
  /** Condition supplied to the protocol runner. */
  readonly rootCondition: TerminationCondition;
  /** Concrete condition that fired. */
  readonly firedCondition: TerminationCondition;
  /** Machine-readable stop reason. */
  readonly reason: StopTerminationDecision["reason"];
  /** Normalized machine-readable stop reason across all stop classes. */
  readonly normalizedReason: NormalizedStopReason;
  /** Normalized budget stop reason when the fired condition is budget-based. */
  readonly budgetReason?: BudgetStopReason;
  /** Normalized judge stop reason when the fired condition is judge-based. */
  readonly judgeReason?: JudgeStopReason;
  /** Optional serializable detail from the fired condition. */
  readonly detail?: JsonObject;
  /** firstOf winner diagnostics when the root condition is a composition. */
  readonly firstOf?: FirstOfTerminationStopRecord;
}

/**
 * Agent participating in a coordinated workflow.
 */
export interface AgentSpec {
  /** Stable id written into events, traces, and transcripts. */
  readonly id: string;
  /** Model-visible role or perspective for this agent. */
  readonly role: string;
  /** Optional per-agent instruction appended to the protocol prompt. */
  readonly instructions?: string;
}

/**
 * Provider-facing model message.
 *
 * @remarks
 * This is the smallest prompt unit handed to a model adapter. Dogpile keeps it
 * provider-neutral so researchers can bridge the same protocol run into Vercel
 * AI SDK models, deterministic fixtures, or custom lab harnesses without
 * changing protocol code.
 */
export interface ModelMessage {
  /** Chat role supplied to the configured model provider. */
  readonly role: "system" | "user" | "assistant";
  /** Message text supplied to the configured model provider. */
  readonly content: string;
}

/**
 * Provider-neutral reason why a model call stopped generating.
 *
 * @remarks
 * This mirrors the Vercel AI SDK's unified finish reasons while keeping
 * Dogpile's core provider contract independent from the `ai` package.
 */
export type ModelFinishReason = "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";

/**
 * Request passed to a configured model provider.
 *
 * @remarks
 * This is the low-level researcher escape hatch for provider adapters. It is
 * intentionally fetch/runtime neutral and does not depend on Node-only APIs,
 * mutable SDK state, or a specific provider package. Adapters can translate
 * `messages` and `temperature` directly into a Vercel AI SDK call while
 * preserving `metadata` for experiment labels, protocol state, replay ids, or
 * provider-specific request annotations.
 *
 * The metadata object must remain JSON-compatible because it is eligible for
 * inclusion in caller-managed traces and benchmark artifacts.
 *
 * @example
 * ```ts
 * const response = await generateText({
 *   model,
 *   messages: request.messages,
 *   temperature: request.temperature
 * });
 * ```
 */
export interface ModelRequest {
  /** Ordered chat messages for the next model call. */
  readonly messages: readonly ModelMessage[];
  /** Sampling temperature selected from the tier or caller override. */
  readonly temperature: number;
  /** Optional cancellation signal passed through to fetch-based model adapters. */
  readonly signal?: AbortSignal;
  /** Serializable protocol metadata for tracing and provider adapters. */
  readonly metadata: JsonObject;
}

/**
 * Response returned by a configured model provider.
 *
 * @remarks
 * Provider adapters return only the text Dogpile should feed back into the
 * active protocol plus optional usage/cost telemetry. Keeping the response
 * small makes deterministic fixtures and cross-runtime adapters easy to write.
 * When the upstream provider cannot report usage or price, omit those fields
 * rather than inventing non-replayable side data.
 */
export interface ModelResponse {
  /** Generated text used by the active coordination protocol. */
  readonly text: string;
  /** Optional provider-normalized finish reason for the model call. */
  readonly finishReason?: ModelFinishReason;
  /**
   * Optional provider-neutral runtime tool requests produced by the model adapter.
   *
   * @remarks
   * Adapters that translate Vercel AI SDK tool calls can return normalized
   * requests here. First-party protocols execute them through the shared
   * runtime tool executor and emit matched `tool-call` / `tool-result` events
   * without coupling core to a provider-specific tool-call shape.
   */
  readonly toolRequests?: readonly RuntimeToolExecutionRequest[];
  /** Optional provider-reported token usage. */
  readonly usage?: {
    /** Input tokens consumed by the model call. */
    readonly inputTokens: number;
    /** Output tokens generated by the model call. */
    readonly outputTokens: number;
    /** Combined input and output token count. */
    readonly totalTokens: number;
  };
  /** Optional provider-reported or adapter-estimated cost in US dollars. */
  readonly costUsd?: number;
  /** Optional provider-adapter metadata normalized to JSON-compatible data. */
  readonly metadata?: JsonObject;
}

// Replay trace types: see src/types/replay.ts
import type {
  ReplayTraceBudget,
  ReplayTraceBudgetStateChange,
  ReplayTraceFinalOutput,
  ReplayTraceProtocolDecision,
  ReplayTraceProtocolDecisionType,
  ReplayTraceProviderCall,
  ReplayTraceRunInputs,
  ReplayTraceSchemaVersion,
  ReplayTraceSeed
} from "./types/replay.js";
export type {
  ReplayTraceBudget,
  ReplayTraceBudgetStateChange,
  ReplayTraceFinalOutput,
  ReplayTraceProtocolDecision,
  ReplayTraceProtocolDecisionType,
  ReplayTraceProviderCall,
  ReplayTraceRunInputs,
  ReplayTraceSchemaVersion,
  ReplayTraceSeed
};


/**
 * Incremental text produced by a streaming model provider.
 *
 * @remarks
 * Providers that can surface partial model output should implement
 * {@link ConfiguredModelProvider.stream}. Dogpile concatenates `text` chunks
 * into the completed {@link ModelResponse.text} for transcript and final
 * result compatibility while emitting each chunk as a typed stream/trace event.
 *
 * Usage and cost are optional on chunks because many provider SDKs only expose
 * them at stream completion. When supplied, the last observed usage/cost values
 * are used for the completed model turn.
 */
export interface ModelOutputChunk {
  /** Text delta produced by the provider. */
  readonly text: string;
  /** Optional provider-normalized finish reason surfaced on a final chunk. */
  readonly finishReason?: ModelResponse["finishReason"];
  /** Optional provider-neutral runtime tool requests surfaced on a final chunk. */
  readonly toolRequests?: ModelResponse["toolRequests"];
  /** Optional provider-reported token usage for the stream so far or final chunk. */
  readonly usage?: ModelResponse["usage"];
  /** Optional provider-reported or adapter-estimated cost in US dollars. */
  readonly costUsd?: number;
  /** Optional provider-adapter metadata normalized to JSON-compatible data. */
  readonly metadata?: ModelResponse["metadata"];
}

/**
 * Runtime-neutral model provider configured by the caller.
 *
 * @remarks
 * This is the primary model-extension point. Production adapters can wrap
 * Vercel AI SDK models behind this interface while tests can provide
 * deterministic providers for replayable protocol checks.
 *
 * Implementations should be pure TypeScript and fetch-compatible for Node LTS,
 * Bun, and browser ESM runtimes. Do not assume filesystem access,
 * process globals, or SDK-managed session storage.
 *
 * @example
 * ```ts
 * const provider: ConfiguredModelProvider = {
 *   id: "vercel-ai:model-name",
 *   async generate(request) {
 *     const result = await generateText({
 *       model,
 *       messages: request.messages,
 *       temperature: request.temperature
 *     });
 *
 *     return { text: result.text };
 *   }
 * };
 * ```
 */
export interface ConfiguredModelProvider {
  /** Stable provider id recorded in traces. */
  readonly id: string;
  /** Generate a response for one protocol-managed model request. */
  generate(request: ModelRequest): Promise<ModelResponse>;
  /**
   * Optionally stream response text for one protocol-managed model request.
   *
   * When present, protocol execution consumes this stream directly and emits
   * `model-output-chunk` events before the completed `agent-turn` event. The
   * fallback `generate()` method remains required for adapters that do not
   * support incremental output and for callers that prefer batch execution.
   */
  stream?(request: ModelRequest): AsyncIterable<ModelOutputChunk>;
  /**
   * Optional provider hints for the runtime. Absent or omitted is treated as
   * `remote` for concurrency clamping (CONCURRENCY-02 / Phase 3 D-01).
   */
  readonly metadata?: {
    /** Locality hint for dispatch clamping. Absent -> "remote" for clamping. */
    readonly locality?: "local" | "remote";
  };
}

/**
 * Stable identity for a runtime tool available to protocol execution.
 *
 * @remarks
 * Tool identity is protocol-agnostic: the same tool can be made visible to
 * coordinator, sequential, broadcast, or shared runs. `id` is the canonical
 * trace key and should remain stable across releases when replay fixtures
 * depend on it. `namespace` and `version` let applications distinguish
 * similarly named tools without baking provider or runtime details into core.
 */
export interface RuntimeToolIdentity {
  /** Stable tool id written into tool calls, results, and trace artifacts. */
  readonly id: string;
  /** Human-readable tool name suitable for model-visible descriptions. */
  readonly name: string;
  /** Optional package, product, or caller-owned namespace. */
  readonly namespace?: string;
  /** Optional semantic version or caller-managed revision label. */
  readonly version?: string;
  /** Optional model-visible description of what the tool does. */
  readonly description?: string;
}

/**
 * Protocol-agnostic input schema for a runtime tool.
 *
 * @remarks
 * Dogpile keeps the schema as JSON-compatible data so callers can translate it
 * into Vercel AI SDK tool definitions, provider-specific function calling, or
 * custom researcher harnesses without importing Node-only validators. The
 * schema should describe a JSON object input; tool execution receives that
 * object as the typed `input` argument.
 */
export interface RuntimeToolInputSchema {
  /** Schema discriminant for future schema families. */
  readonly kind: "json-schema";
  /** JSON Schema-compatible object describing the tool input. */
  readonly schema: JsonObject;
  /** Optional human-readable input description. */
  readonly description?: string;
}

/**
 * Immutable trace snapshot visible to a runtime tool during execution.
 *
 * @remarks
 * The snapshot is intentionally read-only and serializable. Tools can inspect
 * coordination history without mutating SDK state or depending on storage.
 */
export interface RuntimeToolTraceContext {
  /** Ordered coordination events emitted before this tool execution. */
  readonly events: readonly RunEvent[];
  /** Ordered transcript entries completed before this tool execution. */
  readonly transcript: readonly TranscriptEntry[];
}

/**
 * Protocol-agnostic execution context passed to runtime tools.
 *
 * @remarks
 * The context gives a tool the active run identity, protocol, tier, optional
 * agent/turn labels, and a read-only trace snapshot. The optional
 * `abortSignal` is runtime-neutral across modern JS runtimes and lets budget
 * or timeout policy cancel long-running fetch-based tools without requiring
 * Node-only APIs.
 */
export interface RuntimeToolExecutionContext {
  /** Stable id for the workflow run that requested the tool. */
  readonly runId: string;
  /** Stable id for this individual tool call. */
  readonly toolCallId: string;
  /** Coordination protocol currently executing. */
  readonly protocol: Protocol;
  /** Cost/quality tier selected for the run. */
  readonly tier: Tier;
  /** Agent that requested the tool, when execution is agent-scoped. */
  readonly agentId?: string;
  /** Model-visible role of the requesting agent, when available. */
  readonly role?: string;
  /** One-based protocol turn index, when execution is turn-scoped. */
  readonly turn?: number;
  /** Read-only serializable trace state visible at the call boundary. */
  readonly trace?: RuntimeToolTraceContext;
  /** Optional cancellation signal for fetch-based tool implementations. */
  readonly abortSignal?: AbortSignal;
  /** Additional caller-owned serializable execution metadata. */
  readonly metadata?: JsonObject;
}

/**
 * Protocol-neutral request to execute one runtime tool.
 *
 * @remarks
 * First-party protocols use this shape instead of protocol-specific tool call
 * objects. The input and metadata are JSON-compatible so the request-side
 * event can be persisted for caller-managed replay, while `abortSignal`
 * remains an execution-only control for portable fetch-based adapters.
 */
export interface RuntimeToolExecutionRequest {
  /** Stable tool id from {@link RuntimeToolIdentity.id}. */
  readonly toolId: string;
  /** Optional caller-supplied call id; generated by the executor when omitted. */
  readonly toolCallId?: string;
  /** JSON-serializable tool input. */
  readonly input: JsonObject;
  /** Agent that requested the tool, when agent-scoped. */
  readonly agentId?: string;
  /** Model-visible role of the requesting agent, when available. */
  readonly role?: string;
  /** One-based protocol turn index, when execution is turn-scoped. */
  readonly turn?: number;
  /** Optional cancellation signal for this call. */
  readonly abortSignal?: AbortSignal;
  /** Additional caller-owned serializable request metadata. */
  readonly metadata?: JsonObject;
}

/**
 * Shared protocol-agnostic tool executor used by first-party protocol runners.
 */
export interface RuntimeToolExecutor {
  /** Runtime tools available to the active protocol run. */
  readonly tools: readonly RuntimeTool<JsonObject, JsonValue>[];
  /** Execute one normalized tool request and emit matching tool events. */
  execute(request: RuntimeToolExecutionRequest): Promise<RuntimeToolResult>;
}

/**
 * JSON-serializable runtime tool error shape.
 *
 * @remarks
 * Tool errors are data, not thrown values, at the public boundary. Adapters may
 * still throw internally, but protocol code should normalize failures into
 * this shape before writing traces so failed tool calls remain replayable.
 */
export interface RuntimeToolError {
  /** Machine-readable error code, for example `timeout` or `invalid-input`. */
  readonly code: string;
  /** Human-readable error message. */
  readonly message: string;
  /** Whether the same call may be retried safely by caller policy. */
  readonly retryable?: boolean;
  /** Optional serializable diagnostic detail. */
  readonly detail?: JsonObject;
}

/**
 * Successful runtime tool execution result.
 */
export interface RuntimeToolSuccessResult<Output = JsonValue> {
  /** Result discriminant for exhaustive tool-result handling. */
  readonly type: "success";
  /** Stable id matching the execution context call id. */
  readonly toolCallId: string;
  /** Tool identity that produced the result. */
  readonly tool: RuntimeToolIdentity;
  /** JSON-serializable tool output. */
  readonly output: Output;
  /** Optional serializable result metadata. */
  readonly metadata?: JsonObject;
}

/**
 * Failed runtime tool execution result.
 */
export interface RuntimeToolErrorResult {
  /** Result discriminant for exhaustive tool-result handling. */
  readonly type: "error";
  /** Stable id matching the execution context call id. */
  readonly toolCallId: string;
  /** Tool identity that produced the error. */
  readonly tool: RuntimeToolIdentity;
  /** JSON-serializable normalized error. */
  readonly error: RuntimeToolError;
  /** Optional serializable result metadata. */
  readonly metadata?: JsonObject;
}

/**
 * Runtime tool result union shared by every coordination protocol.
 */
export type RuntimeToolResult<Output = JsonValue> =
  | RuntimeToolSuccessResult<Output>
  | RuntimeToolErrorResult;

/**
 * Tool call/result pair preserved on the transcript entry for the model turn
 * that requested it.
 */
export interface TranscriptToolCall {
  /** Stable id shared by the request event and result payload. */
  readonly toolCallId: string;
  /** Tool identity selected for execution. */
  readonly tool: RuntimeToolIdentity;
  /** JSON-serializable tool input requested by the model/provider adapter. */
  readonly input: JsonObject;
  /** Normalized JSON-serializable tool result returned by the runtime tool. */
  readonly result: RuntimeToolResult;
}

/**
 * Protocol-agnostic runtime tool definition.
 *
 * @remarks
 * This is the low-level tool escape hatch used by applications and research
 * harnesses. Core owns the orchestration context and serializable result
 * contract; callers own the actual implementation and any fetch-based I/O the
 * tool performs. `inputSchema` is the model-visible JSON contract; optional
 * `validateInput` is the adapter-owned runtime check applied immediately before
 * `execute`.
 */
export interface RuntimeTool<Input extends object = JsonObject, Output = JsonValue> {
  /** Stable identity and model-visible description. */
  readonly identity: RuntimeToolIdentity;
  /** JSON-compatible schema for the object input expected by `execute`. */
  readonly inputSchema: RuntimeToolInputSchema;
  /** Optional permissions the adapter needs from caller policy before execution. */
  readonly permissions?: readonly RuntimeToolPermission[];
  /**
   * Optional adapter-owned input validation hook evaluated before execution.
   *
   * @remarks
   * Dogpile validates that this property is callable at registration time.
   * During a tool call, Dogpile invokes it after the `tool-call` event and
   * before `execute`. Returning `{ type: "invalid", issues }` prevents
   * `execute` from running and produces a `RuntimeToolErrorResult` with
   * `error.code: "invalid-input"` and serializable issue details. Use this
   * hook for deterministic, side-effect-free runtime checks that narrow the
   * JSON input before the tool performs I/O.
   */
  validateInput?(input: Readonly<Input>): RuntimeToolValidationResult;
  /** Execute the tool for one protocol-managed call. */
  execute(
    input: Readonly<Input>,
    context: RuntimeToolExecutionContext
  ): RuntimeToolResult<Output> | Promise<RuntimeToolResult<Output>>;
}

/**
 * Permission declaration for tool adapters.
 *
 * @remarks
 * Permissions are declarative and serializable. Dogpile core does not grant
 * capabilities itself; applications and protocol harnesses can inspect this
 * data before exposing tools to model-driven execution.
 */
export type RuntimeToolPermission =
  | RuntimeToolNetworkPermission
  | RuntimeToolCodeExecutionPermission
  | RuntimeToolCustomPermission;

/**
 * Permission declaration for fetch-compatible network access.
 */
export interface RuntimeToolNetworkPermission {
  /** Permission discriminant. */
  readonly kind: "network";
  /** Optional host allowlist expected by the adapter. */
  readonly allowHosts?: readonly string[];
  /** Whether private-network destinations may be reached. */
  readonly allowPrivateNetwork?: boolean;
}

/**
 * Permission declaration for caller-owned code execution sandboxes.
 */
export interface RuntimeToolCodeExecutionPermission {
  /** Permission discriminant. */
  readonly kind: "code-execution";
  /** Sandbox boundary supplied by the caller or host application. */
  readonly sandbox: "caller-provided" | "none";
  /** Optional language allowlist exposed by the adapter. */
  readonly languages?: readonly string[];
  /** Whether executed code may perform network I/O inside the sandbox. */
  readonly allowNetwork?: boolean;
}

/**
 * Permission declaration for adapter-specific capabilities.
 */
export interface RuntimeToolCustomPermission {
  /** Permission discriminant. */
  readonly kind: "custom";
  /** Stable custom permission name. */
  readonly name: string;
  /** Optional human-readable policy note for caller-owned authorization checks. */
  readonly description?: string;
  /** Optional serializable policy metadata. */
  readonly metadata?: JsonObject;
}

/**
 * Shared validation issue emitted before a tool adapter executes.
 */
export interface RuntimeToolValidationIssue {
  /** Machine-readable validation code. */
  readonly code: "invalid-type" | "missing-field" | "invalid-value" | "out-of-range";
  /** Dot-path or field name that failed validation. */
  readonly path: string;
  /** Human-readable validation message. */
  readonly message: string;
  /** Optional serializable diagnostic detail. */
  readonly detail?: JsonObject;
}

/**
 * Shared validation result for adapter input checks.
 */
export type RuntimeToolValidationResult =
  | RuntimeToolValidationValidResult
  | RuntimeToolValidationInvalidResult;

/**
 * Valid adapter input.
 */
export interface RuntimeToolValidationValidResult {
  /** Validation discriminant. */
  readonly type: "valid";
}

/**
 * Invalid adapter input.
 */
export interface RuntimeToolValidationInvalidResult {
  /** Validation discriminant. */
  readonly type: "invalid";
  /** One or more serializable validation issues. */
  readonly issues: readonly RuntimeToolValidationIssue[];
}

/**
 * Common adapter error codes used by built-in and third-party tools.
 */
export type RuntimeToolAdapterErrorCode =
  | "invalid-input"
  | "permission-denied"
  | "timeout"
  | "aborted"
  | "unavailable"
  | "backend-error"
  | "unknown";

/**
 * Normalized adapter error data.
 */
export interface RuntimeToolAdapterError extends RuntimeToolError {
  /** Common machine-readable adapter error code. */
  readonly code: RuntimeToolAdapterErrorCode;
}

/**
 * Shared adapter contract implemented by built-in adapters and low-level tools.
 */
export interface RuntimeToolAdapterContract<Input extends object = JsonObject, Output = JsonValue>
  extends RuntimeTool<Input, Output> {
  /** Permissions required before this adapter should be exposed or executed. */
  readonly permissions: readonly RuntimeToolPermission[];
  /** Adapter-owned input validation hook. */
  validateInput(input: Readonly<Input>): RuntimeToolValidationResult;
}

// Benchmark types: see src/types/benchmark.ts
import type {
  BenchmarkBudget,
  BenchmarkCostAccounting,
  BenchmarkModelSettings,
  BenchmarkProtocolArtifact,
  BenchmarkProtocolScore,
  BenchmarkReproducibilityArtifact,
  BenchmarkRequiredArtifact,
  BenchmarkRunArtifact,
  BenchmarkRunnerConfig,
  BenchmarkScoreDimension,
  BenchmarkStreamingEventLog,
  BenchmarkTaskInput,
  ProtocolBenchmarkRunConfig
} from "./types/benchmark.js";
export type {
  BenchmarkBudget,
  BenchmarkCostAccounting,
  BenchmarkModelSettings,
  BenchmarkProtocolArtifact,
  BenchmarkProtocolScore,
  BenchmarkReproducibilityArtifact,
  BenchmarkRequiredArtifact,
  BenchmarkRunArtifact,
  BenchmarkRunnerConfig,
  BenchmarkScoreDimension,
  BenchmarkStreamingEventLog,
  BenchmarkTaskInput,
  ProtocolBenchmarkRunConfig
};

// Events: see src/types/events.ts
import type {
  AbortedEvent,
  AgentDecision,
  AgentParticipation,
  BroadcastContribution,
  BroadcastEvent,
  BudgetStopEvent,
  DelegateAgentDecision,
  FinalEvent,
  ModelActivityEvent,
  ModelOutputChunkEvent,
  ModelRequestEvent,
  ModelResponseEvent,
  ParticipateAgentDecision,
  RoleAssignmentEvent,
  RunEvent,
  StreamCompletionEvent,
  StreamErrorEvent,
  StreamEvent,
  StreamLifecycleEvent,
  StreamOutputEvent,
  SubRunBudgetClampedEvent,
  SubRunCompletedEvent,
  SubRunConcurrencyClampedEvent,
  SubRunFailedEvent,
  SubRunParentAbortedEvent,
  SubRunQueuedEvent,
  SubRunStartedEvent,
  ToolActivityEvent,
  ToolCallEvent,
  ToolResultEvent,
  TranscriptLink,
  TurnEvent
} from "./types/events.js";
export type {
  AbortedEvent,
  AgentDecision,
  AgentParticipation,
  DelegateAgentDecision,
  ParticipateAgentDecision,
  BroadcastContribution,
  BroadcastEvent,
  BudgetStopEvent,
  FinalEvent,
  ModelActivityEvent,
  ModelOutputChunkEvent,
  ModelRequestEvent,
  ModelResponseEvent,
  RoleAssignmentEvent,
  RunEvent,
  StreamCompletionEvent,
  StreamErrorEvent,
  StreamEvent,
  StreamLifecycleEvent,
  StreamOutputEvent,
  SubRunBudgetClampedEvent,
  SubRunCompletedEvent,
  SubRunConcurrencyClampedEvent,
  SubRunFailedEvent,
  SubRunParentAbortedEvent,
  SubRunQueuedEvent,
  SubRunStartedEvent,
  ToolActivityEvent,
  ToolCallEvent,
  ToolResultEvent,
  TranscriptLink,
  TurnEvent
};


/**
 * Lifecycle status for a live {@link StreamHandle}.
 */
export type StreamHandleStatus = "running" | "completed" | "failed" | "cancelled";

/**
 * Normalized transcript entry captured during a run.
 *
 * @remarks
 * The transcript is an ordered list of model-visible contributions. Each entry
 * represents exactly one agent prompt/response pair in the order Dogpile
 * executed it. Unlike {@link RunEvent}, transcript entries omit lifecycle
 * timing, broadcast grouping, and cumulative cost so the structure stays small
 * and stable for application display, caller-managed persistence, and replay
 * fixtures.
 *
 * Transcript structure:
 *
 * - `agentId`: stable id of the agent that produced the contribution.
 * - `role`: model-visible role or perspective for that contribution.
 * - `input`: prompt text visible to the agent for that turn.
 * - `output`: generated text returned by the model provider.
 * - `toolCalls`: optional ordered tool call/result pairs requested during
 *   that turn.
 *
 * `RunResult.transcript` and `Trace.transcript` contain the same ordered
 * entries; the result-level copy exists for ergonomic access while the trace
 * keeps the complete serializable replay artifact together.
 */
export interface TranscriptEntry {
  /** Agent that produced the transcript contribution. */
  readonly agentId: string;
  /** Agent role for the contribution. */
  readonly role: string;
  /** Prompt/input visible to the agent. */
  readonly input: string;
  /** Text produced by the agent. */
  readonly output: string;
  /** Optional structured role/participation decision parsed from model output. */
  readonly decision?: AgentDecision | readonly DelegateAgentDecision[];
  /** Ordered runtime tool calls and results requested during this turn. */
  readonly toolCalls?: readonly TranscriptToolCall[];
}

/**
 * Complete transcript artifact for a finished run.
 *
 * @remarks
 * High-level APIs expose `readonly TranscriptEntry[]` directly for ergonomic
 * application use. This named structure is the durable artifact shape for
 * callers that want a self-describing transcript object with the run id, entry
 * count, and final output bundled together for persistence or replay.
 */
export interface Transcript {
  /** Transcript artifact discriminant. */
  readonly kind: "run-transcript";
  /** Stable run id shared by the source trace and event log. */
  readonly runId: string;
  /** Number of entries in the completed transcript. */
  readonly entryCount: number;
  /** Ordered agent prompt/response entries. */
  readonly entries: readonly TranscriptEntry[];
  /** Final synthesized output produced from these entries. */
  readonly finalOutput: string;
}

/**
 * Token and spend accounting for a run or turn.
 */
export interface CostSummary {
  /** Estimated spend in US dollars. */
  readonly usd: number;
  /** Input tokens consumed. */
  readonly inputTokens: number;
  /** Output tokens generated. */
  readonly outputTokens: number;
  /** Combined input and output token count. */
  readonly totalTokens: number;
}

/**
 * Aggregate provider usage reported for a completed run.
 *
 * This mirrors {@link CostSummary} at the non-streaming result boundary so
 * callers can read model usage without treating spend accounting as the only
 * usage artifact. It remains JSON-serializable and runtime-neutral.
 */
export interface RunUsage {
  /** Estimated spend in US dollars. */
  readonly usd: number;
  /** Input tokens consumed across all model calls. */
  readonly inputTokens: number;
  /** Output tokens generated across all model calls. */
  readonly outputTokens: number;
  /** Combined input and output token count. */
  readonly totalTokens: number;
}

/**
 * Result-level cost and budget accounting for a completed run.
 *
 * @remarks
 * This block makes budget state first-class on {@link RunResult} without
 * forcing application code to unpack the full replay trace. It records the
 * selected tier, caller-supplied caps, optional termination policy, final
 * usage/cost totals, and compact cap-utilization metadata.
 */
export interface RunAccounting {
  /** Accounting artifact discriminant. */
  readonly kind: "run-accounting";
  /** Named budget/cost tier selected for the run. */
  readonly tier: Tier;
  /** Optional hard caps supplied by the caller. */
  readonly budget?: BudgetCaps;
  /** Optional termination policy used by the protocol. */
  readonly termination?: TerminationCondition;
  /** Total token and spend usage for the run. */
  readonly usage: RunUsage;
  /** Total token and spend cost for the run. */
  readonly cost: CostSummary;
  /** Ordered budget state snapshots derived from cost-bearing events. */
  readonly budgetStateChanges: readonly ReplayTraceBudgetStateChange[];
  /** Fraction of the configured USD cap consumed, when `maxUsd` is present. */
  readonly usdCapUtilization?: number;
  /** Fraction of the configured total-token cap consumed, when `maxTokens` is present. */
  readonly totalTokenCapUtilization?: number;
}

/**
 * Normalized quality score for a completed run.
 *
 * Values use the inclusive `0..1` range. The field is optional on
 * {@link RunResult} because production model runs may not have a judge, while
 * benchmark and researcher harnesses can attach a score without changing the
 * single-call result shape.
 */
export type NormalizedQualityScore = number;

/**
 * Serializable evaluation payload for a completed run.
 *
 * @remarks
 * Applications and benchmark harnesses can attach caller-owned judge output
 * without making Dogpile core depend on a storage layer, model-specific judge,
 * or Node-only runtime. The `quality` value is mirrored to
 * {@link RunResult.quality} and the terminal {@link FinalEvent} so streaming
 * and non-streaming execution expose the same judged result.
 */
export interface RunEvaluation {
  /** Normalized quality score in the inclusive range `0..1`. */
  readonly quality: NormalizedQualityScore;
  /** Optional human-readable judge rationale. */
  readonly rationale?: string;
  /** Optional serializable judge or benchmark metadata. */
  readonly metadata?: JsonObject;
}

/**
 * JSON-serializable trace returned with every completed workflow.
 *
 * @remarks
 * This is the canonical caller-managed replay artifact. Dogpile core remains
 * stateless, so every SDK-owned fact needed to inspect a completed run is
 * represented as JSON-compatible data here: normalized inputs, budget policy,
 * seed metadata, ordered events, protocol decisions, provider requests and
 * responses, budget snapshots, transcript entries, and the final output.
 *
 * Event order is authoritative. `events[n]` is the source coordination moment
 * for `protocolDecisions[n]`, and `RunEventLog.events` uses the same order as
 * this trace for completed runs. Provider calls are ordered by execution and
 * capture the exact {@link ModelRequest} handed to the configured adapter plus
 * the exact {@link ModelResponse} returned by that adapter, including optional
 * usage and cost telemetry. Current protocol runners keep provider calls
 * one-to-one with transcript entries and completed `agent-turn` events.
 */
export interface Trace {
  /** Replay trace schema version. */
  readonly schemaVersion: ReplayTraceSchemaVersion;
  /** Stable id for this workflow run. */
  readonly runId: string;
  /** Protocol that produced this trace. */
  readonly protocol: Protocol;
  /** Cost/quality tier selected for the run. */
  readonly tier: Tier;
  /** Configured model provider id used by the run. */
  readonly modelProviderId: string;
  /** Concrete agents that participated in the run. */
  readonly agentsUsed: readonly AgentSpec[];
  /** Normalized caller inputs needed to replay this run. */
  readonly inputs: ReplayTraceRunInputs;
  /** Budget caps and termination policy used by this run. */
  readonly budget: ReplayTraceBudget;
  /** Ordered budget state snapshots derived from cost-bearing events. */
  readonly budgetStateChanges: readonly ReplayTraceBudgetStateChange[];
  /** Deterministic seed metadata for replay tooling. */
  readonly seed: ReplayTraceSeed;
  /** Ordered protocol decisions derived from the event log. */
  readonly protocolDecisions: readonly ReplayTraceProtocolDecision[];
  /** Provider requests and responses captured during execution. */
  readonly providerCalls: readonly ReplayTraceProviderCall[];
  /** Final output artifact for replay consumers. */
  readonly finalOutput: ReplayTraceFinalOutput;
  /**
   * Ordered coordination and lifecycle events.
   *
   * This is the complete streaming event log captured during execution. It has
   * the same event shapes yielded by {@link StreamHandle} and remains
   * JSON-serializable for caller-managed replay.
   */
  readonly events: readonly RunEvent[];
  /**
   * Complete normalized model-turn transcript.
   *
   * Entries are ordered by execution and contain only agent id, role, input,
   * and output. Use this when the application needs the conversation artifact
   * without streaming lifecycle metadata.
   */
  readonly transcript: readonly TranscriptEntry[];
}

/**
 * Complete event log returned by non-streaming APIs.
 *
 * This is the result-level counterpart to the live {@link StreamHandle}
 * iterator. It contains the exact ordered events also stored in
 * {@link Trace.events}, plus compact metadata useful for dashboards and tests
 * that do not need to unpack the full trace.
 */
export interface RunEventLog {
  /** Event-log artifact discriminant. */
  readonly kind: "run-event-log";
  /** Stable id shared by every event in this log. */
  readonly runId: string;
  /** Protocol that produced the event log. */
  readonly protocol: Protocol;
  /** Ordered event kinds for compact coverage checks. */
  readonly eventTypes: readonly RunEvent["type"][];
  /** Number of events captured. */
  readonly eventCount: number;
  /** Complete ordered event log for the run. */
  readonly events: readonly RunEvent[];
}

/**
 * Run metadata returned by non-streaming APIs.
 *
 * The metadata block gathers stable identifiers and timing boundaries that are
 * otherwise derivable from {@link Trace}. Keeping it explicit makes the
 * single-call result easier to persist, index, and inspect without adding SDK
 * storage.
 */
export interface RunMetadata {
  /** Stable id for this workflow run. */
  readonly runId: string;
  /** Protocol that produced this run. */
  readonly protocol: Protocol;
  /** Cost/quality tier selected for the run. */
  readonly tier: Tier;
  /** Configured model provider id used by the run. */
  readonly modelProviderId: string;
  /** Concrete agents that participated in the run. */
  readonly agentsUsed: readonly AgentSpec[];
  /** ISO-8601 timestamp of the first event, or an empty string for eventless runs. */
  readonly startedAt: string;
  /** ISO-8601 timestamp of the final event, or an empty string for eventless runs. */
  readonly completedAt: string;
}

/**
 * Result returned by high-level single-call APIs.
 *
 * The returned shape is
 * `{ output, eventLog, transcript, usage, metadata, accounting, trace, cost, quality, evaluation }`.
 * `output` is the final synthesized answer, `eventLog` is the complete ordered
 * coordination log, `transcript` is the complete agent-turn transcript,
 * `usage` reports token and dollar accounting, and `metadata` exposes stable
 * run identifiers and timing. `accounting` bundles the selected tier, budget
 * caps, final usage/cost, and cap utilization. `trace` remains the complete
 * serializable replay artifact, `cost` is retained as a compatibility alias
 * for `usage`, and `quality` and `evaluation` are present when a judge or
 * benchmark supplies a normalized score and serializable evaluation payload.
 */
export interface RunResult {
  /** Final synthesized answer for the supplied intent. */
  readonly output: string;
  /** Complete non-streaming event log captured during the run. */
  readonly eventLog: RunEventLog;
  /** Full serializable trace and event log. */
  readonly trace: Trace;
  /**
   * Complete normalized transcript for direct application use.
   *
   * This duplicates `trace.transcript` so high-level callers can read the
   * ordered agent contributions without unpacking the full trace object.
   */
  readonly transcript: readonly TranscriptEntry[];
  /** Total usage and spend accounting for the run. */
  readonly usage: RunUsage;
  /** Stable ids, selected controls, provider id, participating agents, and timing boundaries. */
  readonly metadata: RunMetadata;
  /** Result-level budget, usage, cost, and cap-utilization accounting. */
  readonly accounting: RunAccounting;
  /** Total cost and token accounting for the run; compatibility alias for `usage`. */
  readonly cost: CostSummary;
  /** Optional normalized quality score in the inclusive range `0..1`. */
  readonly quality?: NormalizedQualityScore;
  /** Optional serializable evaluation data supplied by a caller-owned evaluator. */
  readonly evaluation?: RunEvaluation;
}

/**
 * Caller-owned evaluator invoked after protocol execution and before the final
 * result is exposed to `run()` or `stream()` callers.
 */
export type RunEvaluator = (result: Omit<RunResult, "quality" | "evaluation">) => RunEvaluation | Promise<RunEvaluation>;

/**
 * Mission supplied to a high-level Dogpile workflow call.
 *
 * @remarks
 * `intent` is the caller-facing mission statement for the agent collective. It
 * is kept as a named type so applications can expose the same concept without
 * depending on the full {@link DogpileOptions} object.
 */
export type MissionIntent = string;

/**
 * Coordination protocol selection accepted by high-level SDK calls.
 *
 * @remarks
 * Pass a named protocol for ergonomic defaults, or a protocol config object
 * when a run needs explicit turn/round limits. The union remains
 * discriminated once normalized through {@link ProtocolConfig}.
 */
export type ProtocolSelection = ProtocolName | ProtocolConfig;

/**
 * Compatibility alias for high-level coordination protocol selection.
 */
export type CoordinationProtocolSelection = ProtocolSelection;

/**
 * Hard budget caps layered over a selected cost/quality tier.
 *
 * @remarks
 * High-level calls keep `tier` next to `budget`, so the budget object only
 * carries caps and quality weighting. This shape is JSON-serializable and can
 * be copied directly into replay traces.
 */
export type BudgetCaps = Omit<Budget, "tier">;

/**
 * Cost and budget controls accepted by high-level SDK calls.
 *
 * @remarks
 * Omit `tier` to use the high-level default `balanced` preset. Omit `budget`
 * for an uncapped run beyond the tier preset.
 */
export interface BudgetCostTierOptions {
  /**
   * Named budget/cost tier.
   *
   * Supported values are `fast`, `balanced`, and `quality`. Defaults to
   * `balanced` when omitted.
   */
  readonly tier?: BudgetTier;
  /** Optional hard caps layered over the selected tier; omitted fields are uncapped. */
  readonly budget?: BudgetCaps;
}

/**
 * Advisory wrap-up hint injected into the next model turn near a hard cap.
 */
export interface WrapUpHintConfig {
  /** Absolute completed model-turn iteration at which to inject the hint once. */
  readonly atIteration?: number;
  /**
   * Fraction of `maxIterations` or `timeoutMs` at which to inject the hint once.
   *
   * `0.8` means the next turn after reaching 80% of a supported cap receives
   * the wrap-up hint.
   */
  readonly atFraction?: number;
  /**
   * Optional custom hint builder. When omitted, the SDK injects a default
   * message that describes the remaining turn and/or time budget.
   */
  readonly inject?: (context: TerminationEvaluationContext) => string;
}

/**
 * Options accepted by the high-level single-call workflow APIs.
 *
 * Provide an `intent` and configure a model provider. The high-level surface
 * defaults to the Sequential protocol and `balanced` tier; callers can pass a
 * protocol, tier, agents, temperature, or budget caps to refine execution
 * without constructing an engine.
 */
export interface DogpileOptions extends BudgetCostTierOptions {
  /** Mission or intent for the agent collective. */
  readonly intent: MissionIntent;
  /**
   * Coordination protocol, either by name or explicit configuration.
   *
   * Supported names are `coordinator`, `sequential`, `broadcast`, and `shared`.
   * Named protocols use default configs: `maxTurns: 3` for coordinator,
   * sequential, and shared; `maxRounds: 2` for broadcast.
   */
  readonly protocol?: ProtocolSelection;
  /** Caller-configured model provider, typically backed by the Vercel AI SDK. */
  readonly model: ConfiguredModelProvider;
  /** Optional explicit agents; defaults are used when omitted. */
  readonly agents?: readonly AgentSpec[];
  /** Optional protocol-agnostic runtime tools available to first-party protocols. */
  readonly tools?: readonly RuntimeTool<JsonObject, JsonValue>[];
  /** Optional temperature override. */
  readonly temperature?: number;
  /** Optional composable termination policy for budget, convergence, judge, or firstOf stop conditions. */
  readonly terminate?: TerminationCondition;
  /** Optional one-shot advisory hint injected into the next model turn near a hard cap. */
  readonly wrapUpHint?: WrapUpHintConfig;
  /** Optional caller-owned evaluator that supplies quality and evaluation data. */
  readonly evaluate?: RunEvaluator;
  /** Optional deterministic seed recorded in the replay trace. */
  readonly seed?: string | number;
  /** Optional caller cancellation signal passed to provider-facing model requests. */
  readonly signal?: AbortSignal;
  /**
   * Maximum coordinator → sub-run recursion depth.
   *
   * Defaults to 4. Per-run values can only LOWER the engine ceiling; raising
   * is silently capped via
   * `effectiveMaxDepth = Math.min(engineMaxDepth, runMaxDepth ?? Infinity)`.
   * Depth overflow throws `DogpileError({ code: "invalid-configuration",
   * detail: { kind: "delegate-validation", reason: "depth-overflow" } })`.
   */
  readonly maxDepth?: number;
  /**
   * Maximum delegated child runs that may execute in parallel.
   *
   * Defaults to 4. Per-run and per-decision values can only lower the engine
   * ceiling; the effective value is `min(engine, run ?? Infinity, decision ?? Infinity)`.
   */
  readonly maxConcurrentChildren?: number;
  /**
   * Fallback timeout (milliseconds) applied to delegated sub-runs when neither
   * the parent's `budget.timeoutMs` nor the decision-level
   * `decision.budget.timeoutMs` specifies one (BUDGET-02 / D-14).
   *
   * Precedence (most specific wins):
   *   `decision.budget.timeoutMs` > parent's remaining deadline (when parent has
   *   `budget.timeoutMs`) > `defaultSubRunTimeoutMs` > undefined.
   *
   * Default: `undefined` (preserves the "no sub-run timeout" posture).
   */
  readonly defaultSubRunTimeoutMs?: number;
}

/**
 * Low-level engine configuration for reusable protocol execution.
 *
 * @remarks
 * Researchers can create one engine with fixed protocol/model/agent settings
 * and run multiple missions through it for controlled comparisons. Application
 * code usually starts with {@link DogpileOptions}; use this escape hatch when
 * you need stable experiment controls, repeated runs against the same model
 * adapter, custom agent rosters, or explicit protocol configs.
 *
 * `budget` is layered over `tier` for caps and quality weighting. The core
 * remains stateless: every run still returns its own serializable trace and
 * transcript, and the caller owns persistence or replay.
 *
 * @example
 * ```ts
 * const engine = createEngine({
 *   protocol: { kind: "sequential", maxTurns: 4 },
 *   tier: "balanced",
 *   model: provider,
 *   agents
 * });
 *
 * const result = await engine.run("Compare the protocol variants.");
 * ```
 */
export interface EngineOptions {
  /**
   * Coordination protocol, either by name or explicit configuration.
   *
   * Supported names are `coordinator`, `sequential`, `broadcast`, and `shared`.
   * Named protocols use default configs: `maxTurns: 3` for coordinator,
   * sequential, and shared; `maxRounds: 2` for broadcast.
   */
  readonly protocol: ProtocolSelection;
  /**
   * Named budget/cost tier.
   *
   * Supported values are `fast`, `balanced`, and `quality`. Use `balanced` as
   * the recommended default when callers do not expose a user preference.
   */
  readonly tier: BudgetTier;
  /** Caller-configured model provider, typically backed by the Vercel AI SDK. */
  readonly model: ConfiguredModelProvider;
  /** Optional explicit agents; defaults are used when omitted. */
  readonly agents?: readonly AgentSpec[];
  /** Optional protocol-agnostic runtime tools available to first-party protocols. */
  readonly tools?: readonly RuntimeTool<JsonObject, JsonValue>[];
  /** Optional temperature override. */
  readonly temperature?: number;
  /** Optional hard caps layered over the selected tier; omitted fields are uncapped. */
  readonly budget?: Omit<Budget, "tier">;
  /** Optional composable termination policy for budget, convergence, judge, or firstOf stop conditions. */
  readonly terminate?: TerminationCondition;
  /** Optional one-shot advisory hint injected into the next model turn near a hard cap. */
  readonly wrapUpHint?: WrapUpHintConfig;
  /** Optional caller-owned evaluator that supplies quality and evaluation data. */
  readonly evaluate?: RunEvaluator;
  /** Optional deterministic seed recorded in the replay trace. */
  readonly seed?: string | number;
  /** Optional caller cancellation signal passed to provider-facing model requests. */
  readonly signal?: AbortSignal;
  /**
   * Maximum coordinator → sub-run recursion depth ceiling.
   *
   * Defaults to 4. Per-run lowering happens at `engine.run` / `engine.stream`
   * call sites via {@link RunCallOptions.maxDepth}; per-run can only lower this
   * ceiling. Depth overflow throws `DogpileError({ code: "invalid-configuration",
   * detail: { kind: "delegate-validation", reason: "depth-overflow" } })`.
   */
  readonly maxDepth?: number;
  /**
   * Maximum delegated child runs that may execute in parallel.
   *
   * Defaults to 4. Per-run lowering happens at `engine.run` / `engine.stream`
   * call sites via {@link RunCallOptions.maxConcurrentChildren}.
   */
  readonly maxConcurrentChildren?: number;
  /**
   * Fallback timeout (milliseconds) applied to delegated sub-runs when neither
   * the parent's `budget.timeoutMs` nor the decision-level
   * `decision.budget.timeoutMs` specifies one (BUDGET-02 / D-14).
   *
   * Precedence (most specific wins):
   *   `decision.budget.timeoutMs` > parent's remaining deadline (when parent has
   *   `budget.timeoutMs`) > `defaultSubRunTimeoutMs` > undefined.
   *
   * Default: `undefined` (preserves the "no sub-run timeout" posture).
   */
  readonly defaultSubRunTimeoutMs?: number;
}

/**
 * Per-call overrides accepted by {@link Engine.run} and {@link Engine.stream}.
 *
 * @remarks
 * Only fields that should be controllable per-mission live here. Today the
 * fields are controls that can only LOWER the engine's ceiling.
 */
export interface RunCallOptions {
  /**
   * Per-run maximum recursion depth. Cannot raise the engine's ceiling — the
   * effective value is `Math.min(engine.maxDepth ?? 4, runOptions.maxDepth ?? Infinity)`.
   */
  readonly maxDepth?: number;
  /**
   * Per-run delegated child concurrency ceiling. Cannot raise the engine's
   * ceiling.
   */
  readonly maxConcurrentChildren?: number;
}

/**
 * Async event stream returned by `stream()`.
 *
 * @remarks
 * Iterate the handle to receive live {@link StreamEvent} values. Successful
 * lifecycle, output, and completion events are stored in `result.trace.events`
 * in the same order. If execution fails, the stream yields one `error` event
 * and {@link StreamHandle.result} rejects with the original error.
 *
 * @example
 * ```ts
 * const handle = Dogpile.stream(options);
 *
 * for await (const event of handle) {
 *   if (event.type === "agent-turn") {
 *     renderTurn(event.agentId, event.output);
 *   }
 * }
 *
 * const result = await handle.result;
 * ```
 */
export interface StreamHandle extends AsyncIterable<StreamEvent> {
  /** Current lifecycle state for this handle. */
  readonly status: StreamHandleStatus;
  /** Final result resolved after the stream completes. */
  readonly result: Promise<RunResult>;
  /**
   * Cancel this live stream.
   *
   * Cancellation aborts the active provider-facing request signal, emits a
   * terminal `error` stream event with `code: "aborted"` and
   * `status: "cancelled"` diagnostics, rejects {@link result}, and closes the
   * consumer-facing iterator. Calling `cancel()` after the handle has already
   * completed is a no-op.
   */
  cancel(): void;
  /**
   * Attach to live events emitted by this run.
   *
   * Subscribers first receive the events already emitted by the handle, then
   * receive live events until they unsubscribe or the run completes. The
   * returned subscription detaches the listener without cancelling the
   * underlying run, so demos and UIs can mount/unmount against a live SDK
   * workflow while the caller still awaits {@link result}.
   */
  subscribe(subscriber: StreamEventSubscriber): StreamSubscription;
}

/**
 * Callback invoked for each live streaming event.
 */
export type StreamEventSubscriber = (event: StreamEvent) => void;

/**
 * Subscription returned by {@link StreamHandle.subscribe}.
 */
export interface StreamSubscription {
  /** Stop delivering future events to the subscriber. */
  unsubscribe(): void;
}

/**
 * Reusable low-level protocol engine.
 *
 * @remarks
 * `Engine` is the extension point behind the high-level `run()`,
 * `stream()`, and `Dogpile.pile()` helpers. It lets research harnesses reuse
 * one normalized protocol configuration across many missions while choosing
 * between batch results and live event streams.
 *
 * The engine does not retain run history. Store each returned
 * {@link RunResult.trace} in caller-managed infrastructure if you need replay,
 * audit, or benchmark aggregation.
 */
export interface Engine {
  /** Execute a mission to completion and return the final result. */
  run(intent: string, options?: RunCallOptions): Promise<RunResult>;
  /** Stream a mission's events while preserving access to the final result. */
  stream(intent: string, options?: RunCallOptions): StreamHandle;
}
