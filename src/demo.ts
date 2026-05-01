import { stream } from "./runtime/engine.js";
import type {
  AgentSpec,
  Budget,
  BudgetStopReason,
  ConfiguredModelProvider,
  DogpileOptions,
  JsonObject,
  Protocol,
  ProtocolConfig,
  RunEvent,
  RunResult,
  StreamHandle,
  StreamSubscription,
  Tier
} from "./types.js";

export type DemoRunStatus = "running" | "completed" | "failed";

export const requiredDemoTraceEventTypes = [
  "role-assignment",
  "model-output-chunk",
  "agent-turn",
  "budget-stop",
  "broadcast",
  "final"
] as const satisfies readonly RunEvent["type"][];

export type RequiredDemoTraceEventType = (typeof requiredDemoTraceEventTypes)[number];

export interface DemoWorkflowControls {
  readonly mission: string;
  readonly coordinationProtocol: Protocol | ProtocolConfig;
  readonly costTier: Tier;
  readonly budget?: Omit<Budget, "tier">;
}

export interface DemoWorkflowEntrypointInput extends Partial<DemoWorkflowControls> {
  readonly model: ConfiguredModelProvider;
  readonly agents?: readonly AgentSpec[];
  readonly temperature?: number;
}

export interface DemoWorkflowEntrypoint {
  readonly mission: string;
  readonly coordinationProtocol: Protocol | ProtocolConfig;
  readonly costTier: Tier;
  readonly budget?: Omit<Budget, "tier">;
  readonly options: DogpileOptions;
  start(): DemoRunApp;
}

export const sampleDemoWorkflowControls = {
  mission: "Compare protocol risks and produce a release-readiness recommendation for the SDK.",
  coordinationProtocol: {
    kind: "sequential",
    maxTurns: 3
  },
  costTier: "balanced",
  budget: {
    maxTokens: 12_000,
    maxUsd: 0.25,
    qualityWeight: 0.6
  }
} satisfies DemoWorkflowControls;

export type DemoTraceEventVisualSection =
  | "role-roster"
  | "agent-turns"
  | "broadcast-rounds"
  | "activity-log"
  | "final-output";

export type DemoTraceEventVisualState =
  | "participant-assigned"
  | "turn-completed"
  | "broadcast-completed"
  | "budget-stopped"
  | "run-completed";

export type DemoTraceEventMetadata =
  | DemoRoleAssignmentEventMetadata
  | DemoModelRequestEventMetadata
  | DemoModelResponseEventMetadata
  | DemoModelOutputChunkEventMetadata
  | DemoToolCallEventMetadata
  | DemoToolResultEventMetadata
  | DemoAgentTurnEventMetadata
  | DemoBroadcastEventMetadata
  | DemoBudgetStopEventMetadata
  | DemoFinalEventMetadata
  | DemoSubRunStartedEventMetadata
  | DemoSubRunCompletedEventMetadata
  | DemoSubRunFailedEventMetadata
  | DemoSubRunParentAbortedEventMetadata
  | DemoSubRunBudgetClampedEventMetadata
  | DemoSubRunQueuedEventMetadata
  | DemoSubRunConcurrencyClampedEventMetadata;

export interface DemoRoleAssignmentEventMetadata {
  readonly type: "role-assignment";
  readonly agentId: string;
  readonly role: string;
}

export interface DemoModelRequestEventMetadata {
  readonly type: "model-request";
  readonly callId: string;
  readonly providerId: string;
  readonly agentId: string;
  readonly role: string;
  readonly messageCount: number;
}

export interface DemoModelResponseEventMetadata {
  readonly type: "model-response";
  readonly callId: string;
  readonly providerId: string;
  readonly agentId: string;
  readonly role: string;
  readonly outputLength: number;
  readonly totalTokens?: number;
  readonly costUsd?: number;
}

export interface DemoModelOutputChunkEventMetadata {
  readonly type: "model-output-chunk";
  readonly agentId: string;
  readonly role: string;
  readonly inputLength: number;
  readonly chunkIndex: number;
  readonly chunkLength: number;
  readonly outputLength: number;
}

export interface DemoToolCallEventMetadata {
  readonly type: "tool-call";
  readonly toolCallId: string;
  readonly toolId: string;
  readonly toolName: string;
  readonly agentId?: string;
  readonly role?: string;
}

export interface DemoToolResultEventMetadata {
  readonly type: "tool-result";
  readonly toolCallId: string;
  readonly toolId: string;
  readonly toolName: string;
  readonly resultType: "success" | "error";
  readonly agentId?: string;
  readonly role?: string;
}

export interface DemoAgentTurnEventMetadata {
  readonly type: "agent-turn";
  readonly agentId: string;
  readonly role: string;
  readonly inputLength: number;
  readonly outputLength: number;
  readonly totalTokens: number;
  readonly costUsd: number;
}

export interface DemoBroadcastEventMetadata {
  readonly type: "broadcast";
  readonly round: number;
  readonly contributionCount: number;
  readonly totalTokens: number;
  readonly costUsd: number;
}

export interface DemoBudgetStopEventMetadata {
  readonly type: "budget-stop";
  readonly reason: BudgetStopReason;
  readonly iteration: number;
  readonly elapsedMs: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly detail: JsonObject;
}

export interface DemoFinalEventMetadata {
  readonly type: "final";
  readonly outputLength: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly transcriptEntryCount: number;
}

export interface DemoSubRunStartedEventMetadata {
  readonly type: "sub-run-started";
  readonly childRunId: string;
  readonly parentRunId: string;
  readonly parentDecisionId: string;
  readonly parentDecisionArrayIndex: number;
  readonly protocol: string;
  readonly intent: string;
  readonly depth: number;
  readonly recursive?: boolean;
}

export interface DemoSubRunCompletedEventMetadata {
  readonly type: "sub-run-completed";
  readonly childRunId: string;
  readonly parentRunId: string;
  readonly parentDecisionId: string;
  readonly parentDecisionArrayIndex: number;
}

export interface DemoSubRunFailedEventMetadata {
  readonly type: "sub-run-failed";
  readonly childRunId: string;
  readonly parentRunId: string;
  readonly parentDecisionId: string;
  readonly parentDecisionArrayIndex: number;
  readonly errorCode: string;
  readonly errorMessage: string;
}

export interface DemoSubRunParentAbortedEventMetadata {
  readonly type: "sub-run-parent-aborted";
  readonly childRunId: string;
  readonly parentRunId: string;
  readonly reason: "parent-aborted";
}

export interface DemoSubRunBudgetClampedEventMetadata {
  readonly type: "sub-run-budget-clamped";
  readonly childRunId: string;
  readonly parentRunId: string;
  readonly parentDecisionId: string;
  readonly requestedTimeoutMs: number;
  readonly clampedTimeoutMs: number;
  readonly reason: "exceeded-parent-remaining";
}

export interface DemoSubRunQueuedEventMetadata {
  readonly type: "sub-run-queued";
  readonly childRunId: string;
  readonly parentRunId: string;
  readonly parentDecisionId: string;
  readonly parentDecisionArrayIndex: number;
  readonly queuePosition: number;
}

export interface DemoSubRunConcurrencyClampedEventMetadata {
  readonly type: "sub-run-concurrency-clamped";
  readonly requestedMax: number;
  readonly effectiveMax: 1;
  readonly reason: "local-provider-detected";
  readonly providerId: string;
}

export interface DemoTraceEventListItem {
  readonly order: number;
  readonly eventType: RunEvent["type"];
  readonly at: string;
  readonly runId: string;
  readonly title: string;
  readonly visualSection: DemoTraceEventVisualSection;
  readonly visualState: DemoTraceEventVisualState;
  readonly metadata: DemoTraceEventMetadata;
}

export interface DemoRoleAssignmentSection {
  readonly id: "role-assignments";
  readonly title: "Role assignments";
  readonly state: "empty" | "visible";
  readonly items: readonly DemoTraceEventListItem[];
}

export interface DemoAgentTurnSection {
  readonly id: "agent-turns";
  readonly title: "Agent turns";
  readonly state: "empty" | "active";
  readonly items: readonly DemoTraceEventListItem[];
}

export interface DemoBroadcastSection {
  readonly id: "broadcast-rounds";
  readonly title: "Broadcast rounds";
  readonly state: "empty" | "active";
  readonly items: readonly DemoTraceEventListItem[];
}

export interface DemoFinalOutputSection {
  readonly id: "final-output";
  readonly title: "Final output";
  readonly state: "empty" | "completed";
  readonly items: readonly DemoTraceEventListItem[];
  readonly output?: string;
}

export interface DemoRunSnapshot {
  readonly status: DemoRunStatus;
  readonly requiredTraceEventTypes: readonly RequiredDemoTraceEventType[];
  readonly capturedRequiredTraceEventTypes: readonly RequiredDemoTraceEventType[];
  readonly missingRequiredTraceEventTypes: readonly RequiredDemoTraceEventType[];
  readonly hasCapturedRequiredTraceEventTypes: boolean;
  readonly traceEventCount: number;
  readonly traceEventTypes: readonly RunEvent["type"][];
  readonly traceEvents: readonly RunEvent[];
  readonly traceEventList: readonly DemoTraceEventListItem[];
  readonly roleAssignmentSection: DemoRoleAssignmentSection;
  readonly agentTurnSection: DemoAgentTurnSection;
  readonly broadcastSection: DemoBroadcastSection;
  readonly finalOutputSection: DemoFinalOutputSection;
  readonly latestTraceEvent?: RunEvent;
  readonly latestTraceEventListItem?: DemoTraceEventListItem;
  readonly eventCount: number;
  readonly eventTypes: readonly RunEvent["type"][];
  readonly events: readonly RunEvent[];
  readonly latestOutput?: string;
  readonly errorMessage?: string;
}

export interface DemoRunApp {
  readonly result: Promise<RunResult>;
  snapshot(): DemoRunSnapshot;
  stop(): void;
}

export function defineDemoWorkflowEntrypoint(input: DemoWorkflowEntrypointInput): DemoWorkflowEntrypoint {
  const mission = input.mission ?? sampleDemoWorkflowControls.mission;
  const coordinationProtocol = input.coordinationProtocol ?? sampleDemoWorkflowControls.coordinationProtocol;
  const costTier = input.costTier ?? sampleDemoWorkflowControls.costTier;
  const budget = input.budget ?? sampleDemoWorkflowControls.budget;
  const options: DogpileOptions = {
    intent: mission,
    protocol: coordinationProtocol,
    tier: costTier,
    model: input.model,
    ...(input.agents ? { agents: input.agents } : {}),
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(budget ? { budget } : {})
  };

  return {
    mission,
    coordinationProtocol,
    costTier,
    ...(budget ? { budget } : {}),
    options,
    start(): DemoRunApp {
      return startDemoRun(options);
    }
  };
}

export function startSampleWorkflow(input: DemoWorkflowEntrypointInput): DemoRunApp {
  return defineDemoWorkflowEntrypoint(input).start();
}

export function startDemoRun(options: DogpileOptions): DemoRunApp {
  return attachDemoApp(stream(options));
}

export function attachDemoApp(handle: StreamHandle): DemoRunApp {
  const traceEvents: RunEvent[] = [];
  let status: DemoRunStatus = "running";
  let latestOutput: string | undefined;
  let errorMessage: string | undefined;
  const subscription = handle.subscribe((event) => {
    if (event.type === "error") {
      status = "failed";
      errorMessage = event.message;
      return;
    }

    traceEvents.push(event as RunEvent);

    if (event.type === "agent-turn" || event.type === "final") {
      latestOutput = event.output;
    }

    if (event.type === "final") {
      status = "completed";
    }
  });

  const result = observeResult(
    handle.result,
    subscription,
    (runResult) => {
      status = "completed";
      latestOutput = runResult.output;
    },
    (error) => {
      status = "failed";
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  );

  return {
    result,
    snapshot(): DemoRunSnapshot {
      const eventTypes = traceEvents.map((event) => event.type);
      const events = [...traceEvents];
      const capturedRequiredTraceEventTypes = requiredDemoTraceEventTypes.filter((type) => eventTypes.includes(type));
      const missingRequiredTraceEventTypes = requiredDemoTraceEventTypes.filter((type) => !eventTypes.includes(type));
      const traceEventList = traceEvents.map(toTraceEventListItem);
      const roleAssignmentItems = traceEventList.filter((item) => item.eventType === "role-assignment");
      const agentTurnItems = traceEventList.filter((item) => item.eventType === "agent-turn");
      const broadcastItems = traceEventList.filter((item) => item.eventType === "broadcast");
      const finalOutputItems = traceEventList.filter((item) => item.eventType === "final");

      return {
        status,
        requiredTraceEventTypes: requiredDemoTraceEventTypes,
        capturedRequiredTraceEventTypes,
        missingRequiredTraceEventTypes,
        hasCapturedRequiredTraceEventTypes: missingRequiredTraceEventTypes.length === 0,
        traceEventCount: traceEvents.length,
        traceEventTypes: eventTypes,
        traceEvents: events,
        traceEventList,
        roleAssignmentSection: {
          id: "role-assignments",
          title: "Role assignments",
          state: roleAssignmentItems.length === 0 ? "empty" : "visible",
          items: roleAssignmentItems
        },
        agentTurnSection: {
          id: "agent-turns",
          title: "Agent turns",
          state: agentTurnItems.length === 0 ? "empty" : "active",
          items: agentTurnItems
        },
        broadcastSection: {
          id: "broadcast-rounds",
          title: "Broadcast rounds",
          state: broadcastItems.length === 0 ? "empty" : "active",
          items: broadcastItems
        },
        finalOutputSection: {
          id: "final-output",
          title: "Final output",
          state: finalOutputItems.length === 0 ? "empty" : "completed",
          items: finalOutputItems,
          ...(finalOutputItems.length === 0 || latestOutput === undefined ? {} : { output: latestOutput })
        },
        ...(traceEvents.length === 0 ? {} : { latestTraceEvent: traceEvents[traceEvents.length - 1] }),
        ...(traceEventList.length === 0 ? {} : { latestTraceEventListItem: traceEventList[traceEventList.length - 1] }),
        eventCount: traceEvents.length,
        eventTypes,
        events,
        ...(latestOutput === undefined ? {} : { latestOutput }),
        ...(errorMessage === undefined ? {} : { errorMessage })
      };
    },
    stop(): void {
      subscription.unsubscribe();
    }
  };
}

function toTraceEventListItem(event: RunEvent, index: number): DemoTraceEventListItem {
  const order = index + 1;

  return {
    order,
    eventType: event.type,
    at: event.at,
    runId: event.runId,
    title: traceEventTitle(event),
    visualSection: traceEventVisualSection(event),
    visualState: traceEventVisualState(event),
    metadata: traceEventMetadata(event)
  };
}

function traceEventTitle(event: RunEvent): string {
  switch (event.type) {
    case "role-assignment":
      return `Assigned ${event.role}`;
    case "model-request":
      return `${event.role} model request`;
    case "model-response":
      return `${event.role} model response`;
    case "model-output-chunk":
      return `${event.role} generating`;
    case "tool-call":
      return `Tool call: ${event.tool.name}`;
    case "tool-result":
      return `Tool result: ${event.tool.name}`;
    case "agent-turn":
      return `${event.role} turn`;
    case "broadcast":
      return `Broadcast round ${event.round}`;
    case "budget-stop":
      return `Budget stopped: ${event.reason}`;
    case "final":
      return "Final output";
    case "sub-run-started":
      return `Sub-run dispatched: ${event.protocol}`;
    case "sub-run-completed":
      return `Sub-run ${event.childRunId} completed`;
    case "sub-run-failed":
      return `Sub-run ${event.childRunId} failed: ${event.error.message}`;
    case "sub-run-parent-aborted":
      return `Parent aborted after sub-run ${event.childRunId}`;
    case "sub-run-budget-clamped":
      return `Sub-run ${event.childRunId} budget clamped to ${event.clampedTimeoutMs}ms`;
    case "sub-run-queued":
      return `Sub-run ${event.childRunId} queued`;
    case "sub-run-concurrency-clamped":
      return `Sub-run concurrency clamped for provider ${event.providerId}`;
  }

  return assertNever(event);
}

function traceEventVisualSection(event: RunEvent): DemoTraceEventVisualSection {
  switch (event.type) {
    case "role-assignment":
      return "role-roster";
    case "model-request":
    case "model-response":
    case "model-output-chunk":
      return "agent-turns";
    case "tool-call":
    case "tool-result":
      return "activity-log";
    case "agent-turn":
      return "agent-turns";
    case "broadcast":
      return "broadcast-rounds";
    case "budget-stop":
      return "activity-log";
    case "final":
      return "final-output";
    case "sub-run-started":
    case "sub-run-completed":
    case "sub-run-failed":
    case "sub-run-parent-aborted":
    case "sub-run-budget-clamped":
    case "sub-run-queued":
    case "sub-run-concurrency-clamped":
      return "activity-log";
  }

  return assertNever(event);
}

function traceEventVisualState(event: RunEvent): DemoTraceEventVisualState {
  switch (event.type) {
    case "role-assignment":
      return "participant-assigned";
    case "model-request":
    case "model-response":
    case "model-output-chunk":
      return "turn-completed";
    case "tool-call":
    case "tool-result":
      return "turn-completed";
    case "agent-turn":
      return "turn-completed";
    case "broadcast":
      return "broadcast-completed";
    case "budget-stop":
      return "budget-stopped";
    case "final":
      return "run-completed";
    case "sub-run-started":
    case "sub-run-completed":
    case "sub-run-failed":
    case "sub-run-parent-aborted":
    case "sub-run-budget-clamped":
    case "sub-run-queued":
    case "sub-run-concurrency-clamped":
      return "turn-completed";
  }

  return assertNever(event);
}

function traceEventMetadata(event: RunEvent): DemoTraceEventMetadata {
  switch (event.type) {
    case "role-assignment":
      return {
        type: event.type,
        agentId: event.agentId,
        role: event.role
      };
    case "model-request":
      return {
        type: event.type,
        callId: event.callId,
        providerId: event.providerId,
        agentId: event.agentId,
        role: event.role,
        messageCount: event.request.messages.length
      };
    case "model-response":
      return {
        type: event.type,
        callId: event.callId,
        providerId: event.providerId,
        agentId: event.agentId,
        role: event.role,
        outputLength: event.response.text.length,
        ...(event.response.usage ? { totalTokens: event.response.usage.totalTokens } : {}),
        ...(event.response.costUsd !== undefined ? { costUsd: event.response.costUsd } : {})
      };
    case "model-output-chunk":
      return {
        type: event.type,
        agentId: event.agentId,
        role: event.role,
        inputLength: event.input.length,
        chunkIndex: event.chunkIndex,
        chunkLength: event.text.length,
        outputLength: event.output.length
      };
    case "tool-call":
      return {
        type: event.type,
        toolCallId: event.toolCallId,
        toolId: event.tool.id,
        toolName: event.tool.name,
        ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
        ...(event.role !== undefined ? { role: event.role } : {})
      };
    case "tool-result":
      return {
        type: event.type,
        toolCallId: event.toolCallId,
        toolId: event.tool.id,
        toolName: event.tool.name,
        resultType: event.result.type,
        ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
        ...(event.role !== undefined ? { role: event.role } : {})
      };
    case "agent-turn":
      return {
        type: event.type,
        agentId: event.agentId,
        role: event.role,
        inputLength: event.input.length,
        outputLength: event.output.length,
        totalTokens: event.cost.totalTokens,
        costUsd: event.cost.usd
      };
    case "broadcast":
      return {
        type: event.type,
        round: event.round,
        contributionCount: event.contributions.length,
        totalTokens: event.cost.totalTokens,
        costUsd: event.cost.usd
      };
    case "budget-stop":
      return {
        type: event.type,
        reason: event.reason,
        iteration: event.iteration,
        elapsedMs: event.elapsedMs,
        totalTokens: event.cost.totalTokens,
        costUsd: event.cost.usd,
        detail: event.detail
      };
    case "final":
      return {
        type: event.type,
        outputLength: event.output.length,
        totalTokens: event.cost.totalTokens,
        costUsd: event.cost.usd,
        transcriptEntryCount: event.transcript.entryCount
      };
    case "sub-run-started":
      return {
        type: event.type,
        childRunId: event.childRunId,
        parentRunId: event.parentRunId,
        parentDecisionId: event.parentDecisionId,
        parentDecisionArrayIndex: event.parentDecisionArrayIndex,
        protocol: event.protocol,
        intent: event.intent,
        depth: event.depth,
        ...(event.recursive !== undefined ? { recursive: event.recursive } : {})
      };
    case "sub-run-completed":
      return {
        type: event.type,
        childRunId: event.childRunId,
        parentRunId: event.parentRunId,
        parentDecisionId: event.parentDecisionId,
        parentDecisionArrayIndex: event.parentDecisionArrayIndex
      };
    case "sub-run-failed":
      return {
        type: event.type,
        childRunId: event.childRunId,
        parentRunId: event.parentRunId,
        parentDecisionId: event.parentDecisionId,
        parentDecisionArrayIndex: event.parentDecisionArrayIndex,
        errorCode: event.error.code,
        errorMessage: event.error.message
      };
    case "sub-run-parent-aborted":
      return {
        type: event.type,
        childRunId: event.childRunId,
        parentRunId: event.parentRunId,
        reason: event.reason
      };
    case "sub-run-budget-clamped":
      return {
        type: event.type,
        childRunId: event.childRunId,
        parentRunId: event.parentRunId,
        parentDecisionId: event.parentDecisionId,
        requestedTimeoutMs: event.requestedTimeoutMs,
        clampedTimeoutMs: event.clampedTimeoutMs,
        reason: event.reason
      };
    case "sub-run-queued":
      return {
        type: event.type,
        childRunId: event.childRunId,
        parentRunId: event.parentRunId,
        parentDecisionId: event.parentDecisionId,
        parentDecisionArrayIndex: event.parentDecisionArrayIndex,
        queuePosition: event.queuePosition
      };
    case "sub-run-concurrency-clamped":
      return {
        type: event.type,
        requestedMax: event.requestedMax,
        effectiveMax: event.effectiveMax,
        reason: event.reason,
        providerId: event.providerId
      };
  }

  return assertNever(event);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled demo event: ${JSON.stringify(value)}`);
}

function observeResult(
  result: Promise<RunResult>,
  subscription: StreamSubscription,
  complete: (result: RunResult) => void,
  fail: (error: unknown) => void
): Promise<RunResult> {
  return result.then((runResult) => {
    complete(runResult);
    subscription.unsubscribe();
    return runResult;
  }, (error: unknown) => {
    fail(error);
    subscription.unsubscribe();
    throw error;
  });
}
