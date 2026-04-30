import type {
  AgentSpec,
  Budget,
  BudgetStopReason,
  CostSummary,
  ModelRequest,
  ModelResponse,
  Protocol,
  ProtocolConfig,
  RunEvent,
  RuntimeToolIdentity,
  TerminationCondition,
  Tier,
  TranscriptLink
} from "../types.js";

/**
 * Version tag for the replay trace artifact schema.
 */
export type ReplayTraceSchemaVersion = "1.0";

/**
 * Serializable seed metadata recorded with replay traces.
 *
 * @remarks
 * Most providers do not expose deterministic seed control. Dogpile still
 * records an explicit empty seed artifact so replay consumers can distinguish
 * "no seed supplied" from a missing trace field.
 */
export interface ReplayTraceSeed {
  /** Seed artifact discriminant. */
  readonly kind: "replay-trace-seed";
  /** Seed source visible to replay tooling. */
  readonly source: "caller" | "none";
  /** Caller-supplied seed value, or `null` when no seed was supplied. */
  readonly value: string | number | null;
}

/**
 * Normalized run inputs persisted inside the replay trace artifact.
 */
export interface ReplayTraceRunInputs {
  /** Run input artifact discriminant. */
  readonly kind: "replay-trace-run-inputs";
  /** Mission or intent supplied by the caller. */
  readonly intent: string;
  /** Exact normalized protocol config used for execution. */
  readonly protocol: ProtocolConfig;
  /** Selected cost/quality tier. */
  readonly tier: Tier;
  /** Configured model provider id. */
  readonly modelProviderId: string;
  /** Concrete agent roster visible to the protocol. */
  readonly agents: readonly AgentSpec[];
  /** Temperature supplied to provider requests. */
  readonly temperature: number;
}

/**
 * Budget and stop-policy artifact persisted inside replay traces.
 */
export interface ReplayTraceBudget {
  /** Budget artifact discriminant. */
  readonly kind: "replay-trace-budget";
  /** Selected cost/quality tier. */
  readonly tier: Tier;
  /** Optional hard caps supplied by the caller. */
  readonly caps?: Omit<Budget, "tier">;
  /** Optional composable termination policy used by the protocol. */
  readonly termination?: TerminationCondition;
}

/**
 * Budget state snapshot derived from a cost-bearing trace event.
 *
 * @remarks
 * Replay consumers can inspect this artifact without walking the full event
 * log. Entries are emitted for model-turn accounting changes, coordination
 * barriers that expose cumulative cost, budget stops, and final completion.
 */
export interface ReplayTraceBudgetStateChange {
  /** Budget state artifact discriminant. */
  readonly kind: "replay-trace-budget-state-change";
  /** Zero-based event index that exposed this budget state. */
  readonly eventIndex: number;
  /** Source event type for the budget state. */
  readonly eventType: "agent-turn" | "broadcast" | "budget-stop" | "final";
  /** ISO-8601 timestamp from the source event. */
  readonly at: string;
  /** Cumulative cost visible at this point in the run. */
  readonly cost: CostSummary;
  /** Completed model-turn iteration count when known. */
  readonly iteration?: number;
  /** Elapsed runtime in milliseconds when known. */
  readonly elapsedMs?: number;
  /** Budget stop reason when this state records a halt. */
  readonly budgetReason?: BudgetStopReason;
}

/**
 * Provider-neutral protocol decision kinds recorded for replay.
 */
export type ReplayTraceProtocolDecisionType =
  | "assign-role"
  | "select-agent-turn"
  | "start-model-call"
  | "complete-model-call"
  | "observe-model-output"
  | "start-tool-call"
  | "complete-tool-call"
  | "collect-broadcast-round"
  | "stop-for-budget"
  | "finalize-output"
  | "start-sub-run"
  | "complete-sub-run"
  | "fail-sub-run";

/**
 * Protocol-level decision appended during execution.
 */
export interface ReplayTraceProtocolDecision {
  /** Decision artifact discriminant. */
  readonly kind: "replay-trace-protocol-decision";
  /** Zero-based event index that produced this decision. */
  readonly eventIndex: number;
  /** Event type that records the decision. */
  readonly eventType: RunEvent["type"];
  /** Coordination protocol that made the decision. */
  readonly protocol: Protocol;
  /** Provider-neutral decision kind for replay tooling. */
  readonly decision: ReplayTraceProtocolDecisionType;
  /** ISO-8601 timestamp from the source event. */
  readonly at: string;
  /** Agent involved in the decision, when agent-scoped. */
  readonly agentId?: string;
  /** Role involved in the decision, when agent-scoped. */
  readonly role?: string;
  /** Provider call involved in the decision, when model-scoped. */
  readonly callId?: string;
  /** Provider involved in the decision, when model-scoped. */
  readonly providerId?: string;
  /** Tool call involved in the decision, when tool-scoped. */
  readonly toolCallId?: string;
  /** Tool identity involved in the decision, when tool-scoped. */
  readonly tool?: RuntimeToolIdentity;
  /** One-based protocol turn for turn-scoped decisions. */
  readonly turn?: number;
  /** Coordinator phase for coordinator protocol turn decisions. */
  readonly phase?: "plan" | "worker" | "final-synthesis";
  /** One-based broadcast round for grouped broadcast decisions. */
  readonly round?: number;
  /** Number of transcript entries visible after this decision. */
  readonly transcriptEntryCount?: number;
  /** Number of contributions collected at a broadcast barrier. */
  readonly contributionCount?: number;
  /** Prompt/input associated with turn decisions. */
  readonly input?: string;
  /** Output associated with turn or final decisions. */
  readonly output?: string;
  /** Cumulative cost visible at this decision point. */
  readonly cost?: CostSummary;
  /** Normalized budget stop reason for budget-stop decisions. */
  readonly budgetReason?: BudgetStopReason;
}

/**
 * Provider call metadata and response captured for replay inspection.
 */
export interface ReplayTraceProviderCall {
  /** Provider call artifact discriminant. */
  readonly kind: "replay-trace-provider-call";
  /** Stable call id within the run. */
  readonly callId: string;
  /** Configured model provider id. */
  readonly providerId: string;
  /** ISO-8601 timestamp before the provider call started. */
  readonly startedAt: string;
  /** ISO-8601 timestamp after the provider call completed. */
  readonly completedAt: string;
  /** Agent that requested this provider call. */
  readonly agentId: string;
  /** Role that requested this provider call. */
  readonly role: string;
  /** Request handed to the configured model provider. */
  readonly request: ModelRequest;
  /** Response returned by the configured model provider. */
  readonly response: ModelResponse;
}

/**
 * Final output artifact persisted inside replay traces.
 */
export interface ReplayTraceFinalOutput {
  /** Final output artifact discriminant. */
  readonly kind: "replay-trace-final-output";
  /** Final synthesized output returned by the run. */
  readonly output: string;
  /** Total cost at completion. */
  readonly cost: CostSummary;
  /** ISO-8601 completion timestamp from the terminal event. */
  readonly completedAt: string;
  /** Link to the completed transcript artifact. */
  readonly transcript: TranscriptLink;
}
