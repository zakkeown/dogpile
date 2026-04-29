import type {
  BudgetStopReason,
  CostSummary,
  JsonObject,
  JsonValue,
  ModelFinishReason,
  ModelOutputChunk,
  ModelRequest,
  ModelResponse,
  NormalizedQualityScore,
  Protocol,
  RunEvaluation,
  RuntimeToolIdentity,
  RuntimeToolPermission,
  RuntimeToolResult,
  TerminationStopRecord
} from "../types.js";


/**
 * Event emitted when a protocol assigns or records an agent role.
 *
 * @remarks
 * This event normally appears near the beginning of a run and establishes the
 * `agentId`/`role` pair that later turn and transcript records refer to. A
 * renderer can use it to build the participant roster before model output
 * starts streaming.
 *
 * Payload shape:
 *
 * - `type`: always `role-assignment`.
 * - `runId`: stable id shared by every event and trace object for the run.
 * - `at`: ISO-8601 timestamp for when the assignment was emitted.
 * - `agentId`: stable agent id used in events, trace, and transcript entries.
 * - `role`: model-visible role or perspective assigned to that agent.
 */
export interface RoleAssignmentEvent {
  /** Discriminant for event rendering and exhaustive switches. */
  readonly type: "role-assignment";
  /** Stable run id shared by all events in one workflow. */
  readonly runId: string;
  /** ISO-8601 event timestamp. */
  readonly at: string;
  /** Agent receiving the role assignment. */
  readonly agentId: string;
  /** Role assigned to the agent. */
  readonly role: string;
}

/**
 * Event emitted when Dogpile is about to ask the configured model provider for
 * one protocol-managed response.
 *
 * @remarks
 * This event is the request-side model activity counterpart to
 * {@link ModelResponseEvent}. Protocol implementations may omit it when they
 * only expose completed turns, but adapters and researcher harnesses can emit
 * it to make provider calls visible in the same streaming event log as agent
 * turns and final output.
 */
export interface ModelRequestEvent {
  /** Discriminant for event rendering and exhaustive switches. */
  readonly type: "model-request";
  /** Stable run id shared by all events in one workflow. */
  readonly runId: string;
  /** ISO-8601 event timestamp. */
  readonly at: string;
  /** Stable provider call id within the run. */
  readonly callId: string;
  /** Configured model provider id receiving the request. */
  readonly providerId: string;
  /** Agent requesting the model call. */
  readonly agentId: string;
  /** Agent role for the active model call. */
  readonly role: string;
  /** Provider-neutral request handed to the model adapter. */
  readonly request: ModelRequest;
}

/**
 * Event emitted after the configured model provider returns one response.
 *
 * @remarks
 * This event records provider-level model activity without forcing callers to
 * infer it from the higher-level {@link TurnEvent}. The response is the same
 * provider-neutral shape captured in replay traces, so it remains portable and
 * JSON-serializable across Node LTS, Bun, and browser ESM runtimes.
 */
export interface ModelResponseEvent {
  /** Discriminant for event rendering and exhaustive switches. */
  readonly type: "model-response";
  /** Stable run id shared by all events in one workflow. */
  readonly runId: string;
  /** ISO-8601 event timestamp. */
  readonly at: string;
  /** Stable provider call id within the run. */
  readonly callId: string;
  /** Configured model provider id that produced the response. */
  readonly providerId: string;
  /** Agent that requested the model call. */
  readonly agentId: string;
  /** Agent role for the completed model call. */
  readonly role: string;
  /** Provider-neutral response returned by the model adapter. */
  readonly response: ModelResponse;
}

/**
 * Event emitted while a model turn is still generating text.
 *
 * @remarks
 * `model-output-chunk` lets streaming callers render provider output before
 * the protocol has enough information to commit the completed `agent-turn`
 * transcript entry. It is emitted only when the configured model provider
 * implements {@link ConfiguredModelProvider.stream}; non-streaming providers
 * continue to produce the existing role/turn/final event sequence.
 *
 * Payload shape:
 *
 * - `type`: always `model-output-chunk`.
 * - `runId`: stable id shared by every event and trace object for the run.
 * - `at`: ISO-8601 timestamp for when the chunk was observed.
 * - `agentId` and `role`: identify the active generating agent.
 * - `input`: prompt text visible to that agent for this turn.
 * - `chunkIndex`: zero-based chunk index within this model turn.
 * - `text`: text delta from the provider.
 * - `output`: accumulated output for this turn after applying the chunk.
 */
export interface ModelOutputChunkEvent {
  /** Discriminant for event rendering and exhaustive switches. */
  readonly type: "model-output-chunk";
  /** Stable run id shared by all events in one workflow. */
  readonly runId: string;
  /** ISO-8601 event timestamp. */
  readonly at: string;
  /** Agent currently producing output. */
  readonly agentId: string;
  /** Agent role for the active turn. */
  readonly role: string;
  /** Prompt/input visible to the agent for this turn. */
  readonly input: string;
  /** Zero-based chunk index within the active model turn. */
  readonly chunkIndex: number;
  /** Text delta produced by the model provider. */
  readonly text: string;
  /** Accumulated output for this turn after applying this chunk. */
  readonly output: string;
}

/**
 * Event emitted when a runtime tool is invoked by protocol or model policy.
 *
 * @remarks
 * Tools are caller-owned escape hatches. This request-side event keeps tool
 * invocation observable without making Dogpile core depend on Node-only
 * capabilities, a storage layer, or a provider-specific function-call shape.
 */
export interface ToolCallEvent {
  /** Discriminant for event rendering and exhaustive switches. */
  readonly type: "tool-call";
  /** Stable run id shared by all events in one workflow. */
  readonly runId: string;
  /** ISO-8601 event timestamp. */
  readonly at: string;
  /** Stable tool call id within the run. */
  readonly toolCallId: string;
  /** Tool identity selected for execution. */
  readonly tool: RuntimeToolIdentity;
  /** JSON-serializable tool input. */
  readonly input: JsonObject;
  /** Agent that requested the tool, when agent-scoped. */
  readonly agentId?: string;
  /** Agent role that requested the tool, when available. */
  readonly role?: string;
}

/**
 * Event emitted after a runtime tool returns a normalized result.
 *
 * @remarks
 * Tool failures are data at the public boundary. The result payload uses the
 * same discriminated union as runtime tool adapters, allowing log consumers to
 * render successful outputs and normalized errors exhaustively.
 */
export interface ToolResultEvent {
  /** Discriminant for event rendering and exhaustive switches. */
  readonly type: "tool-result";
  /** Stable run id shared by all events in one workflow. */
  readonly runId: string;
  /** ISO-8601 event timestamp. */
  readonly at: string;
  /** Stable tool call id within the run. */
  readonly toolCallId: string;
  /** Tool identity that produced the result. */
  readonly tool: RuntimeToolIdentity;
  /** Normalized JSON-serializable tool result. */
  readonly result: RuntimeToolResult;
  /** Agent that requested the tool, when agent-scoped. */
  readonly agentId?: string;
  /** Agent role that requested the tool, when available. */
  readonly role?: string;
}

/**
 * Provider-normalized participation decision parsed from paper-style agent output.
 *
 * @remarks
 * Dogpile preserves the raw model text on transcript entries and events. When
 * a model emits the labeled fields `role_selected`, `participation`,
 * `rationale`, and `contribution`, protocols also attach this structured
 * metadata so reproduction harnesses can distinguish contribution from
 * voluntary abstention without reparsing raw text.
 */
export interface AgentDecision {
  /** Task-specific role selected by the agent for this turn. */
  readonly selectedRole: string;
  /** Whether the agent contributed or voluntarily abstained. */
  readonly participation: AgentParticipation;
  /** Agent-provided rationale for the selected role and participation choice. */
  readonly rationale: string;
  /** Agent-provided contribution text, or abstention explanation. */
  readonly contribution: string;
}

/**
 * Agent participation state for a paper-style turn decision.
 */
export type AgentParticipation = "contribute" | "abstain";

/**
 * Event emitted after one agent contributes a model turn.
 *
 * @remarks
 * `agent-turn` is the primary streaming payload for sequential, coordinator,
 * shared-state, and broadcast executions. It captures the exact prompt/input
 * Dogpile supplied to the agent, the text returned by the model provider, and
 * the cumulative cost after applying that response.
 *
 * The corresponding durable transcript record contains the same
 * `agentId`/`role`/`input`/`output` contribution without event timing or cost
 * fields. Use this event for live progress UIs and the transcript for replay
 * or downstream application logic.
 *
 * Payload shape:
 *
 * - `type`: always `agent-turn`.
 * - `runId`: stable id shared by every event and trace object for the run.
 * - `at`: ISO-8601 timestamp for when the turn completed.
 * - `agentId` and `role`: identify the contributing agent.
 * - `input`: prompt text visible to that agent for this turn.
 * - `output`: generated model text produced by the agent.
 * - `cost`: cumulative token and spend accounting after this turn.
 */
export interface TurnEvent {
  /** Discriminant for event rendering and exhaustive switches. */
  readonly type: "agent-turn";
  /** Stable run id shared by all events in one workflow. */
  readonly runId: string;
  /** ISO-8601 event timestamp. */
  readonly at: string;
  /** Agent that produced this turn. */
  readonly agentId: string;
  /** Agent role for this turn. */
  readonly role: string;
  /** Prompt/input visible to the agent for this turn. */
  readonly input: string;
  /** Model output produced by the agent. */
  readonly output: string;
  /** Optional structured role/participation decision parsed from model output. */
  readonly decision?: AgentDecision;
  /** Cumulative cost after this turn. */
  readonly cost: CostSummary;
}

/**
 * One independent contribution captured by a broadcast round event.
 *
 * @remarks
 * Broadcast protocols collect one contribution per participating agent before
 * synthesis. The contribution payload is intentionally smaller than
 * {@link TurnEvent}: it is a round-level summary of model outputs, while the
 * complete prompt/output pair for each agent is still available as individual
 * `agent-turn` events and {@link TranscriptEntry} records.
 *
 * Payload shape:
 *
 * - `agentId`: stable id of the contributing agent.
 * - `role`: model-visible role or perspective used for that contribution.
 * - `output`: generated text contributed independently for the round.
 */
export interface BroadcastContribution {
  /** Agent that produced the broadcast contribution. */
  readonly agentId: string;
  /** Agent role for the contribution. */
  readonly role: string;
  /** Independent model output produced for the shared mission. */
  readonly output: string;
  /** Optional structured role/participation decision parsed from model output. */
  readonly decision?: AgentDecision;
}

/**
 * Event emitted after agents broadcast independent contributions for a round.
 *
 * @remarks
 * A `broadcast` event marks the coordination moment where independently
 * generated agent outputs are gathered for a shared round. It does not replace
 * per-agent `agent-turn` events; instead, it groups their outputs by round so
 * observers can render the broadcast barrier and replay the paper protocol's
 * independent-contribution step.
 *
 * Payload shape:
 *
 * - `type`: always `broadcast`.
 * - `runId`: stable id shared by every event and trace object for the run.
 * - `at`: ISO-8601 timestamp for when the round finished.
 * - `round`: one-based broadcast round number.
 * - `contributions`: independent outputs collected for this round.
 * - `cost`: cumulative token and spend accounting after the round.
 */
export interface BroadcastEvent {
  /** Discriminant for event rendering and exhaustive switches. */
  readonly type: "broadcast";
  /** Stable run id shared by all events in one workflow. */
  readonly runId: string;
  /** ISO-8601 event timestamp. */
  readonly at: string;
  /** One-based broadcast round number. */
  readonly round: number;
  /** Independent contributions collected in this broadcast round. */
  readonly contributions: readonly BroadcastContribution[];
  /** Cumulative cost after this broadcast round. */
  readonly cost: CostSummary;
}

/**
 * Event emitted when a workflow halts because a configured budget cap fired.
 *
 * @remarks
 * `budget-stop` records the normalized cap class that stopped execution before
 * the final event closes the run. The detail object is JSON-serializable so
 * callers can persist or replay the exact cap, observed value, and limit.
 */
export interface BudgetStopEvent {
  /** Discriminant for event rendering and exhaustive switches. */
  readonly type: "budget-stop";
  /** Stable run id shared by all events in one workflow. */
  readonly runId: string;
  /** ISO-8601 event timestamp. */
  readonly at: string;
  /** Normalized machine-readable budget stop reason. */
  readonly reason: BudgetStopReason;
  /** Total cost at the stop point. */
  readonly cost: CostSummary;
  /** Completed model-turn iterations at the stop point. */
  readonly iteration: number;
  /** Elapsed runtime in milliseconds at the stop point. */
  readonly elapsedMs: number;
  /** Serializable cap diagnostics. */
  readonly detail: JsonObject;
}

/**
 * Link from a terminal event to the completed trace transcript.
 *
 * @remarks
 * Final events are emitted before callers await {@link StreamHandle.result},
 * so this compact link tells streaming UIs exactly which transcript artifact
 * the terminal output closes over without duplicating every transcript entry
 * inside the event log.
 */
export interface TranscriptLink {
  /** Discriminant for future transcript link variants. */
  readonly kind: "trace-transcript";
  /** Number of transcript entries included in the completed trace. */
  readonly entryCount: number;
  /** Zero-based index of the last transcript entry, or `null` for empty runs. */
  readonly lastEntryIndex: number | null;
}

/**
 * Event emitted when a workflow produces its final output.
 *
 * @remarks
 * `final` is the terminal streaming event for a successful run. Its `output`
 * value matches {@link RunResult.output}, and its `cost` value matches the
 * final aggregate cost returned on the result. Its `transcript` link points to
 * the completed {@link Trace.transcript} entries that produced the terminal
 * output.
 *
 * Payload shape:
 *
 * - `type`: always `final`.
 * - `runId`: stable id shared by every event and trace object for the run.
 * - `at`: ISO-8601 timestamp for when final synthesis completed.
 * - `output`: final synthesized answer returned to the caller.
 * - `cost`: total token and spend accounting for the run.
 * - `transcript`: compact link to the completed trace transcript.
 */
export interface FinalEvent {
  /** Discriminant for event rendering and exhaustive switches. */
  readonly type: "final";
  /** Stable run id shared by all events in one workflow. */
  readonly runId: string;
  /** ISO-8601 event timestamp. */
  readonly at: string;
  /** Final synthesized answer returned as `RunResult.output`. */
  readonly output: string;
  /** Total cost at completion. */
  readonly cost: CostSummary;
  /** Link to the completed trace transcript. */
  readonly transcript: TranscriptLink;
  /** Optional normalized quality score supplied by a caller-owned evaluator. */
  readonly quality?: NormalizedQualityScore;
  /** Optional serializable evaluation payload supplied by a caller-owned evaluator. */
  readonly evaluation?: RunEvaluation;
  /** Termination condition that stopped the run, when the run ended by policy. */
  readonly termination?: TerminationStopRecord;
}

/**
 * Successful coordination event emitted by Dogpile and persisted in traces.
 *
 * @remarks
 * `RunEvent` is the discriminated union stored in {@link Trace.events} and
 * used by low-level protocol emit callbacks. Switch on `type` to handle each
 * coordination moment exhaustively:
 *
 * - `role-assignment`: participant/role roster was established.
 * - `model-request`: one provider-neutral model request was started.
 * - `model-response`: one provider-neutral model response completed.
 * - `model-output-chunk`: one streaming model text delta arrived.
 * - `tool-call`: one runtime tool invocation was started.
 * - `tool-result`: one runtime tool invocation completed.
 * - `agent-turn`: one agent completed a prompt/response turn.
 * - `broadcast`: a broadcast round gathered independent contributions.
 * - `budget-stop`: a configured budget cap halted further model turns.
 * - `final`: the run completed and produced the final output.
 *
 * Every variant is JSON-serializable and includes `runId` plus an ISO-8601
 * `at` timestamp so callers can persist, render, or replay the event log
 * without SDK-owned storage.
 *
 * @example
 * ```ts
 * for await (const event of Dogpile.stream(options)) {
 *   switch (event.type) {
 *     case "agent-turn":
 *       console.log(event.agentId, event.output);
 *       break;
 *     case "final":
 *       console.log(event.output);
 *       break;
 *   }
 * }
 * ```
 */
export type RunEvent =
  | RoleAssignmentEvent
  | ModelRequestEvent
  | ModelResponseEvent
  | ModelOutputChunkEvent
  | ToolCallEvent
  | ToolResultEvent
  | TurnEvent
  | BroadcastEvent
  | BudgetStopEvent
  | FinalEvent;

/**
 * Model activity events yielded by `stream()` and persisted in traces when a
 * protocol exposes provider-call boundaries.
 */
export type ModelActivityEvent = ModelRequestEvent | ModelResponseEvent | ModelOutputChunkEvent;

/**
 * Tool activity events yielded by `stream()` and persisted in traces when a
 * protocol or caller-owned adapter invokes runtime tools.
 */
export type ToolActivityEvent = ToolCallEvent | ToolResultEvent;

/**
 * Lifecycle event yielded by `stream()`.
 *
 * These events describe workflow coordination state rather than model text.
 * Role assignment establishes the participant roster, while `budget-stop`
 * records a lifecycle halt before the terminal completion event.
 */
export type StreamLifecycleEvent = RoleAssignmentEvent | BudgetStopEvent;

/**
 * Output event yielded by `stream()`.
 *
 * These events carry generated agent output or grouped round output while a
 * workflow is still running.
 */
export type StreamOutputEvent = ModelActivityEvent | ToolActivityEvent | TurnEvent | BroadcastEvent;

/**
 * Error event yielded by `stream()` when execution rejects.
 *
 * @remarks
 * Stream errors are emitted before {@link StreamHandle.result} rejects so UIs
 * and log collectors can record a terminal failure without wrapping the result
 * promise. The error payload is JSON-serializable and intentionally omits
 * runtime-specific values such as `Error.stack`.
 */
export interface StreamErrorEvent {
  /** Discriminant for stream event handling. */
  readonly type: "error";
  /** Stable run id when known; empty when failure happened before protocol startup. */
  readonly runId: string;
  /** ISO-8601 event timestamp. */
  readonly at: string;
  /** Error name when available. */
  readonly name: string;
  /** Human-readable error message. */
  readonly message: string;
  /** Optional serializable diagnostics supplied by the SDK. */
  readonly detail?: JsonObject;
}

/**
 * Completion event yielded by `stream()` after successful execution.
 */
export type StreamCompletionEvent = FinalEvent;

/**
 * Public streaming event union returned by `stream()`.
 *
 * @remarks
 * The union is grouped into lifecycle, output, error, and completion families:
 *
 * - lifecycle: {@link StreamLifecycleEvent}
 * - output: {@link StreamOutputEvent}
 * - error: {@link StreamErrorEvent}
 * - completion: {@link StreamCompletionEvent}
 *
 * Successful stream events are also persisted as {@link RunEvent} values in the
 * completed trace. `error` is stream-only because a failed run has no completed
 * {@link RunResult} trace to return.
 */
export type StreamEvent = StreamLifecycleEvent | StreamOutputEvent | StreamErrorEvent | StreamCompletionEvent;

