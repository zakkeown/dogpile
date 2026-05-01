/**
 * Typed event query function for filtering completed trace events.
 *
 * @module
 */
import type {
  BroadcastEvent,
  BudgetStopEvent,
  FinalEvent,
  ModelOutputChunkEvent,
  ModelRequestEvent,
  ModelResponseEvent,
  RoleAssignmentEvent,
  RunEvent,
  SubRunBudgetClampedEvent,
  SubRunCompletedEvent,
  SubRunConcurrencyClampedEvent,
  SubRunFailedEvent,
  SubRunParentAbortedEvent,
  SubRunQueuedEvent,
  SubRunStartedEvent,
  ToolCallEvent,
  ToolResultEvent,
  TurnEvent
} from "../types.js";

/**
 * Filter criteria for querying a completed trace event log.
 *
 * All fields are optional. AND semantics: all present fields must match.
 * An empty filter object returns all events. An unmatched filter returns [].
 *
 * `costRange` matches only events with a `cost.usd` field: TurnEvent and
 * BroadcastEvent. Events without a cost field are excluded from results when
 * `costRange` is set (not returned as unmatched - silently excluded).
 *
 * `turnRange` uses the global 1-based position of agent-turn events across
 * all agents. Position 1 is the first TurnEvent in the event array regardless
 * of which agent produced it. BroadcastEvent.round is a separate concept and
 * is not matched by turnRange.
 */
export interface EventQueryFilter {
  /** Filter to events with this exact type discriminant. */
  readonly type?: RunEvent["type"];
  /** Filter to events where agentId === this value. Events without agentId are excluded. */
  readonly agentId?: string;
  /**
   * Filter to agent-turn events at the specified global 1-based position range.
   * Only TurnEvents are included in results when this filter is set.
   */
  readonly turnRange?: {
    readonly min?: number;
    readonly max?: number;
  };
  /**
   * Filter to events where cost.usd is within [min, max].
   * Only TurnEvent and BroadcastEvent have cost.usd - all other events are excluded.
   */
  readonly costRange?: {
    readonly min?: number;
    readonly max?: number;
  };
}

// One overload per RunEvent discriminant (D-03: hand-written overloads, IDE-reliable)
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "role-assignment" }): RoleAssignmentEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "model-request" }): ModelRequestEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "model-response" }): ModelResponseEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "model-output-chunk" }): ModelOutputChunkEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "tool-call" }): ToolCallEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "tool-result" }): ToolResultEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "agent-turn" }): TurnEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "broadcast" }): BroadcastEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "sub-run-started" }): SubRunStartedEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "sub-run-completed" }): SubRunCompletedEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "sub-run-failed" }): SubRunFailedEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "sub-run-parent-aborted" }): SubRunParentAbortedEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "sub-run-budget-clamped" }): SubRunBudgetClampedEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "sub-run-queued" }): SubRunQueuedEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "sub-run-concurrency-clamped" }): SubRunConcurrencyClampedEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "budget-stop" }): BudgetStopEvent[];
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter & { type: "final" }): FinalEvent[];
// Fallback overload: no type constraint -> returns full RunEvent[]
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter): RunEvent[];
// Implementation signature (not visible to callers):
export function queryEvents(events: readonly RunEvent[], filter: EventQueryFilter): RunEvent[] {
  let result: RunEvent[] = filter.type !== undefined
    ? events.filter((event) => event.type === filter.type)
    : [...events];

  if (filter.agentId !== undefined) {
    const { agentId } = filter;
    result = result.filter((event) => "agentId" in event && (event as { agentId?: string }).agentId === agentId);
  }

  if (filter.turnRange !== undefined) {
    const { min, max } = filter.turnRange;
    const agentTurnEvents = events.filter((event): event is TurnEvent => event.type === "agent-turn");
    const inRangeSet = new Set<RunEvent>(
      agentTurnEvents.filter((_, index) => {
        const position = index + 1;
        return (min === undefined || position >= min) && (max === undefined || position <= max);
      })
    );

    result = result.filter((event) => event.type === "agent-turn" && inRangeSet.has(event));
  }

  if (filter.costRange !== undefined) {
    const { min, max } = filter.costRange;
    result = result.filter((event) => {
      if (event.type !== "agent-turn" && event.type !== "broadcast") {
        return false;
      }

      const usd = event.cost.usd;
      return (min === undefined || usd >= min) && (max === undefined || usd <= max);
    });
  }

  return result;
}
