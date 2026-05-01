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
  RunResult,
  StreamCompletionEvent,
  StreamErrorEvent,
  StreamEvent,
  StreamLifecycleEvent,
  StreamOutputEvent,
  AbortedEvent,
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
  Trace,
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
  "sub-run-started",
  "sub-run-completed",
  "sub-run-failed",
  "sub-run-parent-aborted",
  "sub-run-budget-clamped",
  "sub-run-queued",
  "sub-run-concurrency-clamped",
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
      "sub-run-started",
      "sub-run-completed",
      "sub-run-failed",
      "sub-run-parent-aborted",
      "sub-run-budget-clamped",
      "sub-run-queued",
      "sub-run-concurrency-clamped",
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

  it("locks AbortedEvent as a stream lifecycle variant", () => {
    const event: StreamLifecycleEvent = {
      type: "aborted",
      runId: "run-aborted-contract",
      at: "2026-05-01T00:00:00.000Z",
      reason: "parent-aborted"
    };
    const timeoutEvent: AbortedEvent = {
      type: "aborted",
      runId: "run-timeout-aborted-contract",
      at: "2026-05-01T00:00:01.000Z",
      reason: "timeout",
      detail: {
        source: "budget"
      }
    };
    const streamEvents: readonly StreamEvent[] = [event, timeoutEvent];

    const reasons = streamEvents.map((streamEvent) => {
      if (streamEvent.type !== "aborted") {
        return "not-aborted";
      }
      return streamEvent.reason;
    });

    expect(reasons).toEqual(["parent-aborted", "timeout"]);
    expect(JSON.parse(JSON.stringify(streamEvents))).toEqual(streamEvents);
  });

  it("accepts provider-timeout detail source discriminator", () => {
    const providerDetail = { source: "provider" as const };
    const engineDetail = { source: "engine" as const };

    expect(providerDetail.source).toBe("provider");
    expect(engineDetail.source).toBe("engine");
  });

  it("round-trips AbortedEvent parentRunIds ancestry through JSON serialization", () => {
    const parentRunIds = ["run-grandparent", "run-parent"] as const;
    const event: AbortedEvent = {
      type: "aborted",
      runId: "run-child",
      at: "2026-05-01T00:00:02.000Z",
      reason: "parent-aborted",
      parentRunIds
    };

    expect(JSON.parse(JSON.stringify(event))).toEqual({
      type: "aborted",
      runId: "run-child",
      at: "2026-05-01T00:00:02.000Z",
      reason: "parent-aborted",
      parentRunIds: ["run-grandparent", "run-parent"]
    });
  });

  it("accepts optional parentRunIds on every stream lifecycle and output variant", () => {
    const parentRunIds = ["run-root", "run-parent"] as const;
    const child = minimalRunResult("run-child-parentRunIds-contract");
    const lifecycleEvents = [
      {
        type: "role-assignment",
        runId: "run-child",
        at: "2026-05-01T00:00:00.000Z",
        agentId: "agent-1",
        role: "planner",
        parentRunIds
      },
      {
        type: "budget-stop",
        runId: "run-child",
        at: "2026-05-01T00:00:01.000Z",
        reason: "cost",
        cost: emptyCost(),
        iteration: 1,
        elapsedMs: 10,
        detail: {},
        parentRunIds
      },
      {
        type: "sub-run-started",
        runId: "run-child",
        at: "2026-05-01T00:00:02.000Z",
        childRunId: "run-grandchild-started",
        parentRunId: "run-child",
        parentDecisionId: "decision-1",
        parentDecisionArrayIndex: 0,
        protocol: "sequential",
        intent: "Started child",
        depth: 2,
        parentRunIds
      },
      {
        type: "sub-run-completed",
        runId: "run-child",
        at: "2026-05-01T00:00:03.000Z",
        childRunId: child.trace.runId,
        parentRunId: "run-child",
        parentDecisionId: "decision-2",
        parentDecisionArrayIndex: 0,
        subResult: child,
        parentRunIds
      },
      {
        type: "sub-run-failed",
        runId: "run-child",
        at: "2026-05-01T00:00:04.000Z",
        childRunId: child.trace.runId,
        parentRunId: "run-child",
        parentDecisionId: "decision-3",
        parentDecisionArrayIndex: 0,
        error: { code: "aborted", message: "failed" },
        partialTrace: child.trace,
        partialCost: emptyCost(),
        parentRunIds
      },
      {
        type: "sub-run-parent-aborted",
        runId: "run-child",
        at: "2026-05-01T00:00:05.000Z",
        childRunId: "run-grandchild-parent-aborted",
        parentRunId: "run-child",
        reason: "parent-aborted",
        parentRunIds
      },
      {
        type: "sub-run-budget-clamped",
        runId: "run-child",
        at: "2026-05-01T00:00:06.000Z",
        childRunId: "run-grandchild-budget-clamped",
        parentRunId: "run-child",
        parentDecisionId: "decision-4",
        requestedTimeoutMs: 1000,
        clampedTimeoutMs: 100,
        reason: "exceeded-parent-remaining",
        parentRunIds
      },
      {
        type: "sub-run-queued",
        runId: "run-child",
        at: "2026-05-01T00:00:07.000Z",
        childRunId: "run-grandchild-queued",
        parentRunId: "run-child",
        parentDecisionId: "decision-5",
        parentDecisionArrayIndex: 1,
        protocol: "shared",
        intent: "Queued child",
        depth: 2,
        queuePosition: 0,
        parentRunIds
      },
      {
        type: "sub-run-concurrency-clamped",
        runId: "run-child",
        at: "2026-05-01T00:00:08.000Z",
        requestedMax: 4,
        effectiveMax: 1,
        reason: "local-provider-detected",
        providerId: "local-provider",
        parentRunIds
      }
    ] as const satisfies readonly StreamLifecycleEvent[];
    const outputEvents = [
      {
        type: "model-request",
        runId: "run-child",
        startedAt: "2026-05-01T00:00:09.000Z",
        callId: "call-1",
        providerId: "provider",
        modelId: "provider",
        agentId: "agent-1",
        role: "planner",
        request: {
          messages: [{ role: "user", content: "Plan" }],
          temperature: 0,
          metadata: { runId: "run-child" }
        },
        parentRunIds
      },
      {
        type: "model-response",
        runId: "run-child",
        startedAt: "2026-05-01T00:00:09.000Z",
        completedAt: "2026-05-01T00:00:10.000Z",
        callId: "call-1",
        providerId: "provider",
        modelId: "provider",
        agentId: "agent-1",
        role: "planner",
        response: { text: "ok" },
        parentRunIds
      },
      {
        type: "model-output-chunk",
        runId: "run-child",
        at: "2026-05-01T00:00:11.000Z",
        agentId: "agent-1",
        role: "planner",
        input: "Plan",
        chunkIndex: 0,
        text: "o",
        output: "o",
        parentRunIds
      },
      {
        type: "tool-call",
        runId: "run-child",
        at: "2026-05-01T00:00:12.000Z",
        toolCallId: "tool-1",
        tool: { id: "lookup", name: "Lookup" },
        input: {},
        parentRunIds
      },
      {
        type: "tool-result",
        runId: "run-child",
        at: "2026-05-01T00:00:13.000Z",
        toolCallId: "tool-1",
        tool: { id: "lookup", name: "Lookup" },
        result: {
          type: "success",
          toolCallId: "tool-1",
          tool: { id: "lookup", name: "Lookup" },
          output: {}
        },
        parentRunIds
      },
      {
        type: "agent-turn",
        runId: "run-child",
        at: "2026-05-01T00:00:14.000Z",
        agentId: "agent-1",
        role: "planner",
        input: "Plan",
        output: "Done",
        cost: emptyCost(),
        parentRunIds
      },
      {
        type: "broadcast",
        runId: "run-child",
        at: "2026-05-01T00:00:15.000Z",
        round: 1,
        contributions: [{ agentId: "agent-1", role: "planner", output: "Done" }],
        cost: emptyCost(),
        parentRunIds
      }
    ] as const satisfies readonly StreamOutputEvent[];
    const events: readonly (StreamLifecycleEvent | StreamOutputEvent)[] = [...lifecycleEvents, ...outputEvents];

    expect(events).toHaveLength(16);
    expect(events.every((event) => event.parentRunIds === parentRunIds)).toBe(true);
    expect(JSON.parse(JSON.stringify(events))).toEqual(events);
  });

  it("keeps parent-emitted sub-run lifecycle events free of parentRunIds", () => {
    const child = minimalRunResult("run-child-parent-emitted-sub-run-contract");
    const events: readonly StreamLifecycleEvent[] = [
      {
        type: "sub-run-started",
        runId: "run-parent",
        at: "2026-05-01T01:00:00.000Z",
        childRunId: "run-child-started",
        parentRunId: "run-parent",
        parentDecisionId: "decision-1",
        parentDecisionArrayIndex: 0,
        protocol: "sequential",
        intent: "Started child",
        depth: 1
      },
      {
        type: "sub-run-completed",
        runId: "run-parent",
        at: "2026-05-01T01:00:01.000Z",
        childRunId: child.trace.runId,
        parentRunId: "run-parent",
        parentDecisionId: "decision-2",
        parentDecisionArrayIndex: 0,
        subResult: child
      },
      {
        type: "sub-run-failed",
        runId: "run-parent",
        at: "2026-05-01T01:00:02.000Z",
        childRunId: child.trace.runId,
        parentRunId: "run-parent",
        parentDecisionId: "decision-3",
        parentDecisionArrayIndex: 0,
        error: { code: "aborted", message: "failed" },
        partialTrace: child.trace,
        partialCost: emptyCost()
      },
      {
        type: "sub-run-queued",
        runId: "run-parent",
        at: "2026-05-01T01:00:03.000Z",
        childRunId: "run-child-queued",
        parentRunId: "run-parent",
        parentDecisionId: "decision-4",
        parentDecisionArrayIndex: 1,
        protocol: "shared",
        intent: "Queued child",
        depth: 1,
        queuePosition: 0
      },
      {
        type: "sub-run-concurrency-clamped",
        runId: "run-parent",
        at: "2026-05-01T01:00:04.000Z",
        requestedMax: 4,
        effectiveMax: 1,
        reason: "local-provider-detected",
        providerId: "local-provider"
      }
    ];

    expect(events.map((event) => event.parentRunIds)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(JSON.parse(JSON.stringify(events))).toEqual(events);
  });

  it("defines public model activity, tool activity, and transcript artifact shapes", () => {
    const modelRequestEvent: ModelRequestEvent = {
      type: "model-request",
      runId: "run-activity-contract",
      startedAt: "2026-04-24T00:00:00.000Z",
      callId: "run-activity-contract:provider-call:1",
      providerId: "deterministic-model",
      modelId: "deterministic-model",
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
      startedAt: modelRequestEvent.startedAt,
      completedAt: "2026-04-24T00:00:01.000Z",
      callId: modelRequestEvent.callId,
      providerId: modelRequestEvent.providerId,
      modelId: modelRequestEvent.modelId,
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

  it("emits serializable role-assignment, model activity, agent-turn, and final event variants", async () => {
    const result = await run({
      intent: "Verify sequential trace event schemas.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: createDeterministicModelProvider("event-schema-sequential-model")
    });

    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "model-request",
      "model-response",
      "agent-turn",
      "final"
    ]);
    expect(JSON.parse(JSON.stringify(result.trace.events))).toEqual(result.trace.events);

    const [roleAssignmentEvent, modelRequestEvent, modelResponseEvent, turnEvent, finalEvent] = result.trace.events;

    expect(roleAssignmentEvent?.type).toBe("role-assignment");
    if (roleAssignmentEvent?.type !== "role-assignment") {
      throw new Error("missing role-assignment event");
    }
    expectRoleAssignmentEvent(roleAssignmentEvent, result.trace.runId);

    expect(modelRequestEvent?.type).toBe("model-request");
    if (modelRequestEvent?.type !== "model-request") {
      throw new Error("missing model-request event");
    }
    expectModelRequestEvent(modelRequestEvent, result.trace.runId);

    expect(modelResponseEvent?.type).toBe("model-response");
    if (modelResponseEvent?.type !== "model-response") {
      throw new Error("missing model-response event");
    }
    expectModelResponseEvent(modelResponseEvent, result.trace.runId, modelRequestEvent);

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
      "model-request",
      "model-response",
      "agent-turn",
      "model-request",
      "model-response",
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
      "model-request",
      "model-request",
      "model-request",
      "model-response",
      "model-response",
      "model-response",
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

    expect(events.map((event) => event.type)).toEqual(["role-assignment", "model-request", "error"]);
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

  it("locks the sub-run-started event payload shape and JSON round-trip", () => {
    const fixture: SubRunStartedEvent = {
      type: "sub-run-started",
      runId: "run-parent-sub-run-started",
      at: "2026-04-30T00:00:00.000Z",
      childRunId: "run-child-sub-run-started",
      parentRunId: "run-parent-sub-run-started",
      parentDecisionId: "decision-1",
      parentDecisionArrayIndex: 0,
      protocol: "coordinator",
      intent: "Investigate constraint violations.",
      depth: 1,
      recursive: true
    };
    const variant: RunEvent = fixture;

    expect(variant.type).toBe("sub-run-started");
    expect(sortedKeys(fixture)).toEqual([
      "at",
      "childRunId",
      "depth",
      "intent",
      "parentDecisionArrayIndex",
      "parentDecisionId",
      "parentRunId",
      "protocol",
      "recursive",
      "runId",
      "type"
    ]);
    expect(fixture.runId).toBe(fixture.parentRunId);
    expectIsoTimestamp(fixture.at);
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
  });

  it("locks the sub-run-completed event payload shape and embeds the full child RunResult", async () => {
    const child = await run({
      intent: "Produce a deterministic child sub-run for embedding.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: createDeterministicModelProvider("event-schema-sub-run-child")
    });

    const fixture: SubRunCompletedEvent = {
      type: "sub-run-completed",
      runId: "run-parent-sub-run-completed",
      at: "2026-04-30T00:00:01.000Z",
      childRunId: child.trace.runId,
      parentRunId: "run-parent-sub-run-completed",
      parentDecisionId: "decision-2",
      parentDecisionArrayIndex: 0,
      subResult: child
    };
    const variant: RunEvent = fixture;

    expect(variant.type).toBe("sub-run-completed");
    expect(sortedKeys(fixture)).toEqual([
      "at",
      "childRunId",
      "parentDecisionArrayIndex",
      "parentDecisionId",
      "parentRunId",
      "runId",
      "subResult",
      "type"
    ]);
    expectIsoTimestamp(fixture.at);
    expect(fixture.subResult.trace.runId).toBe(child.trace.runId);
    expect(fixture.subResult.output).toBe(child.output);

    const roundTripped = JSON.parse(JSON.stringify(fixture)) as SubRunCompletedEvent;
    expect(roundTripped).toEqual(fixture);
    expect(roundTripped.subResult.trace.events).toEqual(child.trace.events);
    expect(roundTripped.subResult.accounting).toEqual(child.accounting);
    expect(roundTripped.subResult.output).toBe(child.output);
  });

  it("locks the sub-run-failed event payload shape and partialTrace round-trip", async () => {
    const child = await run({
      intent: "Capture a partial trace shape for sub-run-failed embedding.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: createDeterministicModelProvider("event-schema-sub-run-failed-fixture")
    });
    const partialTrace: Trace = child.trace;

    const fixture: SubRunFailedEvent = {
      type: "sub-run-failed",
      runId: "run-parent-sub-run-failed",
      at: "2026-04-30T00:00:02.000Z",
      childRunId: child.trace.runId,
      parentRunId: "run-parent-sub-run-failed",
      parentDecisionId: "decision-3",
      parentDecisionArrayIndex: 0,
      error: {
        code: "aborted",
        message: "Child run aborted before completion.",
        providerId: "event-schema-sub-run-failed-fixture",
        detail: {
          reason: "depth-overflow",
          failedDecision: {
            type: "delegate",
            protocol: "coordinator",
            intent: "Recurse beyond maxDepth."
          }
        }
      },
      partialTrace,
      partialCost: { usd: 0.0001, inputTokens: 7, outputTokens: 11, totalTokens: 18 }
    };
    const variant: RunEvent = fixture;

    expect(variant.type).toBe("sub-run-failed");
    expect(sortedKeys(fixture)).toEqual([
      "at",
      "childRunId",
      "error",
      "parentDecisionArrayIndex",
      "parentDecisionId",
      "parentRunId",
      "partialCost",
      "partialTrace",
      "runId",
      "type"
    ]);
    expectIsoTimestamp(fixture.at);
    expect(fixture.error.code).toBe("aborted");
    expect(fixture.partialTrace.runId).toBe(child.trace.runId);
    // BUDGET-03 / D-02: partialCost is a locked public field.
    expect(fixture.partialCost).toEqual({ usd: 0.0001, inputTokens: 7, outputTokens: 11, totalTokens: 18 });

    const roundTripped = JSON.parse(JSON.stringify(fixture)) as SubRunFailedEvent;
    expect(roundTripped).toEqual(fixture);
    expect(roundTripped.error.detail).toEqual(fixture.error.detail);
    expect(roundTripped.partialTrace.events).toEqual(partialTrace.events);
    expect(roundTripped.partialCost).toEqual(fixture.partialCost);
  });

  it("locks the sub-run-parent-aborted event payload shape and JSON round-trip", () => {
    const fixture: SubRunParentAbortedEvent = {
      type: "sub-run-parent-aborted",
      runId: "run-parent-sub-run-parent-aborted",
      at: "2026-04-30T00:00:03.000Z",
      childRunId: "run-child-sub-run-parent-aborted",
      parentRunId: "run-parent-sub-run-parent-aborted",
      reason: "parent-aborted"
    };
    const variant: RunEvent = fixture;

    expect(variant.type).toBe("sub-run-parent-aborted");
    expect(sortedKeys(fixture)).toEqual([
      "at",
      "childRunId",
      "parentRunId",
      "reason",
      "runId",
      "type"
    ]);
    expect(fixture.runId).toBe(fixture.parentRunId);
    expect(fixture.reason).toBe("parent-aborted");
    expectIsoTimestamp(fixture.at);
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
  });

  it("locks the sub-run-budget-clamped event payload shape and JSON round-trip", () => {
    // BUDGET-02 / D-12 typed-import lock: SubRunBudgetClampedEvent is a public
    // TS surface variant. If the type is removed from src/index.ts (or its
    // re-export blocks in src/types.ts), this file fails compile.
    const fixture: SubRunBudgetClampedEvent = {
      type: "sub-run-budget-clamped",
      runId: "run-parent-sub-run-budget-clamped",
      at: "2026-04-30T00:00:04.000Z",
      childRunId: "run-child-sub-run-budget-clamped",
      parentRunId: "run-parent-sub-run-budget-clamped",
      parentDecisionId: "decision-7",
      requestedTimeoutMs: 5000,
      clampedTimeoutMs: 200,
      reason: "exceeded-parent-remaining"
    };
    const variant: RunEvent = fixture;

    expect(variant.type).toBe("sub-run-budget-clamped");
    expect(sortedKeys(fixture)).toEqual([
      "at",
      "childRunId",
      "clampedTimeoutMs",
      "parentDecisionId",
      "parentRunId",
      "reason",
      "requestedTimeoutMs",
      "runId",
      "type"
    ]);
    expect(fixture.runId).toBe(fixture.parentRunId);
    expect(fixture.reason).toBe("exceeded-parent-remaining");
    expect(fixture.clampedTimeoutMs).toBeLessThan(fixture.requestedTimeoutMs);
    expectIsoTimestamp(fixture.at);
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
  });

  it("locks the sub-run-queued event payload shape and JSON round-trip", () => {
    const fixture: SubRunQueuedEvent = {
      type: "sub-run-queued",
      runId: "run-parent-sub-run-queued",
      at: "2026-05-01T00:00:00.000Z",
      childRunId: "run-child-sub-run-queued",
      parentRunId: "run-parent-sub-run-queued",
      parentDecisionId: "decision-8",
      parentDecisionArrayIndex: 1,
      protocol: "sequential",
      intent: "Wait for a bounded concurrency slot.",
      depth: 1,
      queuePosition: 0
    };
    const variant: RunEvent = fixture;

    expect(variant.type).toBe("sub-run-queued");
    expect(sortedKeys(fixture)).toEqual([
      "at",
      "childRunId",
      "depth",
      "intent",
      "parentDecisionArrayIndex",
      "parentDecisionId",
      "parentRunId",
      "protocol",
      "queuePosition",
      "runId",
      "type"
    ]);
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
  });

  it("locks the sub-run-concurrency-clamped event payload shape and JSON round-trip", () => {
    const fixture: SubRunConcurrencyClampedEvent = {
      type: "sub-run-concurrency-clamped",
      runId: "run-parent-sub-run-concurrency-clamped",
      at: "2026-05-01T00:00:01.000Z",
      requestedMax: 4,
      effectiveMax: 1,
      reason: "local-provider-detected",
      providerId: "local-provider"
    };
    const variant: RunEvent = fixture;

    expect(variant.type).toBe("sub-run-concurrency-clamped");
    expect(sortedKeys(fixture)).toEqual([
      "at",
      "effectiveMax",
      "providerId",
      "reason",
      "requestedMax",
      "runId",
      "type"
    ]);
    expect(fixture.effectiveMax).toBe(1);
    expect(fixture.reason).toBe("local-provider-detected");
    expect(fixture.providerId).toBe("local-provider");
    expectIsoTimestamp(fixture.at);
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
  });
});

async function collectStreamedEvents(handle: AsyncIterable<StreamEvent>): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of handle) {
    if (event.type !== "error" && event.type !== "aborted") {
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
      case "model-request":
        expectModelRequestEvent(event, runId);
        break;
      case "model-response": {
        const requestEvent = events.find(
          (candidate) => candidate.type === "model-request" && candidate.callId === event.callId
        );
        if (requestEvent?.type !== "model-request") {
          throw new Error("missing paired model-request event");
        }
        expectModelResponseEvent(event, runId, requestEvent);
        break;
      }
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

function expectModelRequestEvent(event: ModelRequestEvent, runId: string): void {
  expect(sortedKeys(event)).toEqual([
    "agentId",
    "callId",
    "modelId",
    "providerId",
    "request",
    "role",
    "runId",
    "startedAt",
    "type"
  ]);
  expect(event.runId).toBe(runId);
  expect(event.callId).toContain(`${runId}:provider-call:`);
  expect(event.modelId).toBeTruthy();
  expect(event.providerId).toBeTruthy();
  expect(event.agentId).toBeTruthy();
  expect(event.role).toBeTruthy();
  expectIsoTimestamp(event.startedAt);
  expect(event.request.messages.length).toBeGreaterThan(0);
}

function expectModelResponseEvent(
  event: ModelResponseEvent,
  runId: string,
  requestEvent: ModelRequestEvent
): void {
  expect(sortedKeys(event)).toEqual([
    "agentId",
    "callId",
    "completedAt",
    "modelId",
    "providerId",
    "response",
    "role",
    "runId",
    "startedAt",
    "type"
  ]);
  expect(event.runId).toBe(runId);
  expect(event.callId).toBe(requestEvent.callId);
  expect(event.providerId).toBe(requestEvent.providerId);
  expect(event.modelId).toBe(requestEvent.modelId);
  expect(event.agentId).toBe(requestEvent.agentId);
  expect(event.role).toBe(requestEvent.role);
  expect(event.startedAt).toBe(requestEvent.startedAt);
  expectIsoTimestamp(event.startedAt);
  expectIsoTimestamp(event.completedAt);
  expect(Date.parse(event.startedAt)).toBeLessThanOrEqual(Date.parse(event.completedAt));
  expect(event.response.text).toBeTruthy();
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

function minimalRunResult(runId: string): RunResult {
  const cost = emptyCost();
  const final: FinalEvent = {
    type: "final",
    runId,
    at: "2026-05-01T00:00:00.000Z",
    output: "child output",
    cost,
    transcript: {
      kind: "trace-transcript",
      entryCount: 0,
      lastEntryIndex: null
    }
  };
  const trace: Trace = {
    schemaVersion: "1.0",
    runId,
    protocol: "sequential",
    tier: "fast",
    modelProviderId: "minimal-provider",
    agentsUsed: [],
    inputs: {
      kind: "replay-trace-run-inputs",
      intent: "Minimal child result",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      modelProviderId: "minimal-provider",
      agents: [],
      temperature: 0
    },
    budget: {
      kind: "replay-trace-budget",
      tier: "fast"
    },
    budgetStateChanges: [],
    seed: { kind: "replay-trace-seed", source: "none", value: null },
    protocolDecisions: [],
    providerCalls: [],
    finalOutput: {
      kind: "replay-trace-final-output",
      output: "child output",
      cost,
      completedAt: final.at,
      transcript: final.transcript
    },
    events: [final],
    transcript: []
  };

  return {
    output: "child output",
    eventLog: {
      kind: "run-event-log",
      runId,
      protocol: "sequential",
      eventTypes: ["final"],
      eventCount: 1,
      events: trace.events
    },
    trace,
    transcript: trace.transcript,
    usage: cost,
    metadata: {
      runId,
      protocol: "sequential",
      tier: "fast",
      modelProviderId: "minimal-provider",
      agentsUsed: [],
      startedAt: final.at,
      completedAt: final.at
    },
    accounting: {
      kind: "run-accounting",
      tier: "fast",
      usage: cost,
      cost,
      budgetStateChanges: []
    },
    cost
  };
}

function expectIsoTimestamp(value: string): void {
  expect(new Date(value).toISOString()).toBe(value);
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}
