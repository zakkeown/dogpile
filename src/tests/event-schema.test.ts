import { describe, expect, it } from "vitest";
import {
  createDeterministicBroadcastTestMission,
  createDeterministicModelProvider
} from "../internal.js";
import { run, stream } from "../index.js";
import type {
  BroadcastEvent,
  ConfiguredModelProvider,
  CostSummary,
  FinalEvent,
  ModelActivityEvent,
  ModelRequestEvent,
  ModelResponse,
  ModelResponseEvent,
  RoleAssignmentEvent,
  RunEvent,
  StreamCompletionEvent,
  StreamErrorEvent,
  StreamEvent,
  StreamLifecycleEvent,
  StreamOutputEvent,
  ToolActivityEvent,
  ToolCallEvent,
  ToolResultEvent,
  Transcript,
  TurnEvent
} from "../index.js";

const expectedEventTypes = [
  "role-assignment",
  "model-request",
  "model-response",
  "model-output-chunk",
  "tool-call",
  "tool-result",
  "agent-turn",
  "broadcast",
  "budget-stop",
  "final"
] as const satisfies readonly RunEvent["type"][];

describe("trace event schema", () => {
  it("defines the public run event union variants required for coordination traces", () => {
    const eventTypes: readonly RunEvent["type"][] = expectedEventTypes;

    expect(eventTypes).toEqual([
      "role-assignment",
      "model-request",
      "model-response",
      "model-output-chunk",
      "tool-call",
      "tool-result",
      "agent-turn",
      "broadcast",
      "budget-stop",
      "final"
    ]);
  });

  it("defines the public stream event families for lifecycle, output, error, and completion handling", () => {
    const lifecycleEvent: StreamLifecycleEvent = {
      type: "role-assignment",
      runId: "run-stream-contract",
      at: "2026-04-24T00:00:00.000Z",
      agentId: "planner",
      role: "planner"
    };
    const outputEvent: StreamOutputEvent = {
      type: "agent-turn",
      runId: "run-stream-contract",
      at: "2026-04-24T00:00:01.000Z",
      agentId: "planner",
      role: "planner",
      input: "Mission: define stream output",
      output: "partial output",
      cost: emptyCost()
    };
    const errorEvent: StreamErrorEvent = {
      type: "error",
      runId: "run-stream-contract",
      at: "2026-04-24T00:00:02.000Z",
      name: "Error",
      message: "provider failed"
    };
    const completionEvent: StreamCompletionEvent = {
      type: "final",
      runId: "run-stream-contract",
      at: "2026-04-24T00:00:03.000Z",
      output: "final output",
      cost: emptyCost(),
      transcript: {
        kind: "trace-transcript",
        entryCount: 1,
        lastEntryIndex: 0
      }
    };
    const streamEvents: readonly StreamEvent[] = [lifecycleEvent, outputEvent, errorEvent, completionEvent];

    expect(streamEvents.map((event) => event.type)).toEqual(["role-assignment", "agent-turn", "error", "final"]);
    expect(JSON.parse(JSON.stringify(streamEvents))).toEqual(streamEvents);
  });

  it("defines public model activity, tool activity, and transcript artifact shapes", () => {
    const modelRequestEvent: ModelRequestEvent = {
      type: "model-request",
      runId: "run-activity-contract",
      at: "2026-04-24T00:00:00.000Z",
      callId: "run-activity-contract:provider-call:1",
      providerId: "deterministic-model",
      agentId: "planner",
      role: "planner",
      request: {
        messages: [{ role: "user", content: "Draft the plan." }],
        temperature: 0.2,
        metadata: {
          runId: "run-activity-contract",
          protocol: "sequential"
        }
      }
    };
    const modelResponseEvent: ModelResponseEvent = {
      type: "model-response",
      runId: "run-activity-contract",
      at: "2026-04-24T00:00:01.000Z",
      callId: modelRequestEvent.callId,
      providerId: modelRequestEvent.providerId,
      agentId: "planner",
      role: "planner",
      response: {
        text: "Planner output",
        usage: {
          inputTokens: 4,
          outputTokens: 2,
          totalTokens: 6
        },
        costUsd: 0.001
      }
    };
    const toolCallEvent: ToolCallEvent = {
      type: "tool-call",
      runId: "run-activity-contract",
      at: "2026-04-24T00:00:02.000Z",
      toolCallId: "run-activity-contract:tool-call:1",
      tool: {
        id: "web-search",
        name: "Web search"
      },
      input: {
        query: "Drop the Hierarchy and Roles"
      },
      agentId: "planner",
      role: "planner"
    };
    const toolResultEvent: ToolResultEvent = {
      type: "tool-result",
      runId: "run-activity-contract",
      at: "2026-04-24T00:00:03.000Z",
      toolCallId: toolCallEvent.toolCallId,
      tool: toolCallEvent.tool,
      result: {
        type: "success",
        toolCallId: toolCallEvent.toolCallId,
        tool: toolCallEvent.tool,
        output: {
          title: "Paper note"
        }
      },
      agentId: "planner",
      role: "planner"
    };
    const modelEvents: readonly ModelActivityEvent[] = [modelRequestEvent, modelResponseEvent];
    const toolEvents: readonly ToolActivityEvent[] = [toolCallEvent, toolResultEvent];
    const streamOutputEvents: readonly StreamOutputEvent[] = [...modelEvents, ...toolEvents];
    const transcript: Transcript = {
      kind: "run-transcript",
      runId: "run-activity-contract",
      entryCount: 1,
      entries: [
        {
          agentId: "planner",
          role: "planner",
          input: "Draft the plan.",
          output: "Planner output"
        }
      ],
      finalOutput: "Planner output"
    };

    expect(streamOutputEvents.map((event) => event.type)).toEqual([
      "model-request",
      "model-response",
      "tool-call",
      "tool-result"
    ]);
    expect(transcript.entryCount).toBe(transcript.entries.length);
    expect(JSON.parse(JSON.stringify([...streamOutputEvents, transcript]))).toEqual([...streamOutputEvents, transcript]);
  });

  it("emits serializable role-assignment, agent-turn, and final event variants", async () => {
    const result = await run({
      intent: "Verify sequential trace event schemas.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: createDeterministicModelProvider("event-schema-sequential-model")
    });

    expect(result.trace.events.map((event) => event.type)).toEqual(["role-assignment", "agent-turn", "final"]);
    expect(JSON.parse(JSON.stringify(result.trace.events))).toEqual(result.trace.events);

    const [roleAssignmentEvent, turnEvent, finalEvent] = result.trace.events;

    expect(roleAssignmentEvent?.type).toBe("role-assignment");
    if (roleAssignmentEvent?.type !== "role-assignment") {
      throw new Error("missing role-assignment event");
    }
    expectRoleAssignmentEvent(roleAssignmentEvent, result.trace.runId);

    expect(turnEvent?.type).toBe("agent-turn");
    if (turnEvent?.type !== "agent-turn") {
      throw new Error("missing agent-turn event");
    }
    expectTurnEvent(turnEvent, result.trace.runId);

    expect(finalEvent?.type).toBe("final");
    if (finalEvent?.type !== "final") {
      throw new Error("missing final event");
    }
    expectFinalEvent(finalEvent, result.trace.runId, result.output);
  });

  it("emits the broadcast event variant with grouped round contributions", async () => {
    const result = await run(createDeterministicBroadcastTestMission());
    const broadcastEvent = result.trace.events.find((event) => event.type === "broadcast");

    expect(broadcastEvent?.type).toBe("broadcast");
    if (broadcastEvent?.type !== "broadcast") {
      throw new Error("missing broadcast event");
    }

    expectBroadcastEvent(broadcastEvent, result.trace.runId);
    expect(broadcastEvent.contributions).toEqual(
      result.transcript.map((entry) => ({
        agentId: entry.agentId,
        role: entry.role,
        output: entry.output
      }))
    );
    expect(JSON.parse(JSON.stringify(broadcastEvent))).toEqual(broadcastEvent);
  });

  it("streams sequential events in trace-schema order", async () => {
    const handle = stream({
      intent: "Verify streamed sequential trace event schemas.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "fast",
      model: createDeterministicModelProvider("streamed-schema-sequential-model"),
      agents: [
        { id: "agent-1", role: "planner" },
        { id: "agent-2", role: "reviewer" }
      ]
    });

    const streamedEvents = await collectStreamedEvents(handle);
    const result = await handle.result;

    expect(streamedEvents).toEqual(result.trace.events);
    expect(streamedEvents.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expectStreamedTraceEvents(streamedEvents, result.trace.runId, result.output);
  });

  it("streams broadcast events in trace-schema order around the grouped coordination barrier", async () => {
    const handle = stream(createDeterministicBroadcastTestMission(createDeterministicModelProvider("streamed-schema-broadcast-model")));

    const streamedEvents = await collectStreamedEvents(handle);
    const result = await handle.result;

    expect(streamedEvents).toEqual(result.trace.events);
    expect(streamedEvents.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "broadcast",
      "final"
    ]);
    expectStreamedTraceEvents(streamedEvents, result.trace.runId, result.output);
  });

  it("yields a typed stream error event before the result promise rejects", async () => {
    const failure = new Error("provider unavailable during streamed run");
    const model: ConfiguredModelProvider = {
      id: "failing-stream-model",
      async generate(): Promise<ModelResponse> {
        throw failure;
      }
    };
    const handle = stream({
      intent: "Surface typed stream failures.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model,
      agents: [{ id: "agent-1", role: "planner" }]
    });

    const events: StreamEvent[] = [];
    for await (const event of handle) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(["role-assignment", "error"]);
    const errorEvent = events.at(-1);
    expect(errorEvent?.type).toBe("error");
    if (errorEvent?.type !== "error") {
      throw new Error("missing stream error event");
    }
    expect(errorEvent.name).toBe("Error");
    expect(errorEvent.message).toBe("provider unavailable during streamed run");
    expectIsoTimestamp(errorEvent.at);
    await expect(handle.result).rejects.toThrow(failure);
  });
});

async function collectStreamedEvents(handle: AsyncIterable<StreamEvent>): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of handle) {
    if (event.type !== "error") {
      events.push(event);
    }
  }
  return events;
}

function expectStreamedTraceEvents(events: readonly RunEvent[], runId: string, output: string): void {
  expect(JSON.parse(JSON.stringify(events))).toEqual(events);

  for (const event of events) {
    switch (event.type) {
      case "role-assignment":
        expectRoleAssignmentEvent(event, runId);
        break;
      case "agent-turn":
        expectTurnEvent(event, runId);
        break;
      case "broadcast":
        expectBroadcastEvent(event, runId);
        break;
      case "budget-stop":
        break;
      case "final":
        expectFinalEvent(event, runId, output);
        break;
    }
  }
}

function expectRoleAssignmentEvent(event: RoleAssignmentEvent, runId: string): void {
  expect(sortedKeys(event)).toEqual(["agentId", "at", "role", "runId", "type"]);
  expect(event.runId).toBe(runId);
  expectIsoTimestamp(event.at);
  expect(event.agentId).toBeTruthy();
  expect(event.role).toBeTruthy();
}

function expectTurnEvent(event: TurnEvent, runId: string): void {
  expect(sortedKeys(event)).toEqual(["agentId", "at", "cost", "input", "output", "role", "runId", "type"]);
  expect(event.runId).toBe(runId);
  expectIsoTimestamp(event.at);
  expect(event.agentId).toBeTruthy();
  expect(event.role).toBeTruthy();
  expect(event.input).toContain("Mission:");
  expect(event.output).toBeTruthy();
  expectCostSummary(event.cost);
}

function expectBroadcastEvent(event: BroadcastEvent, runId: string): void {
  expect(sortedKeys(event)).toEqual(["at", "contributions", "cost", "round", "runId", "type"]);
  expect(event.runId).toBe(runId);
  expectIsoTimestamp(event.at);
  expect(event.round).toBe(1);
  expect(event.contributions.length).toBeGreaterThan(0);
  for (const contribution of event.contributions) {
    expect(sortedKeys(contribution)).toEqual(["agentId", "output", "role"]);
    expect(contribution.agentId).toBeTruthy();
    expect(contribution.role).toBeTruthy();
    expect(contribution.output).toBeTruthy();
  }
  expectCostSummary(event.cost);
}

function expectFinalEvent(event: FinalEvent, runId: string, output: string): void {
  expect(sortedKeys(event)).toEqual(["at", "cost", "output", "runId", "transcript", "type"]);
  expect(event.runId).toBe(runId);
  expectIsoTimestamp(event.at);
  expect(event.output).toBe(output);
  expectCostSummary(event.cost);
  expect(sortedKeys(event.transcript)).toEqual(["entryCount", "kind", "lastEntryIndex"]);
  expect(event.transcript.kind).toBe("trace-transcript");
  expect(event.transcript.entryCount).toBeGreaterThan(0);
  expect(event.transcript.lastEntryIndex).toBe(event.transcript.entryCount - 1);
}

function expectCostSummary(cost: CostSummary): void {
  expect(sortedKeys(cost)).toEqual(["inputTokens", "outputTokens", "totalTokens", "usd"]);
  expect(cost.usd).toBeGreaterThanOrEqual(0);
  expect(cost.inputTokens).toBeGreaterThanOrEqual(0);
  expect(cost.outputTokens).toBeGreaterThanOrEqual(0);
  expect(cost.totalTokens).toBeGreaterThanOrEqual(0);
}

function emptyCost(): CostSummary {
  return { usd: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function expectIsoTimestamp(value: string): void {
  expect(new Date(value).toISOString()).toBe(value);
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}
