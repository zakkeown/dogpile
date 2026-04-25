import { describe, expect, it } from "vitest";
import {
  attachDemoApp,
  defineDemoWorkflowEntrypoint,
  requiredDemoTraceEventTypes,
  sampleDemoWorkflowControls,
  startDemoRun,
  startSampleWorkflow
} from "../internal.js";
import { stream } from "../index.js";
import type { ConfiguredModelProvider, ModelOutputChunk, ModelRequest, ModelResponse, RunResult } from "../index.js";

describe("demo app streaming attachment", () => {
  it("defines a runnable sample workflow entrypoint from mission, protocol, and cost controls", async () => {
    const protocol = { kind: "broadcast", maxRounds: 1 } as const;
    const model = createImmediateModelProvider("demo-entrypoint-model");
    const entrypoint = defineDemoWorkflowEntrypoint({
      mission: "Run the sample release-readiness workflow.",
      coordinationProtocol: protocol,
      costTier: "quality",
      budget: { maxTokens: 12_000, maxUsd: 0.25, qualityWeight: 0.8 },
      model,
      agents: [
        { id: "entry-agent-1", role: "release-engineer" },
        { id: "entry-agent-2", role: "paper-reviewer" }
      ]
    });

    expect(entrypoint).toMatchObject({
      mission: "Run the sample release-readiness workflow.",
      coordinationProtocol: protocol,
      costTier: "quality",
      budget: { maxTokens: 12_000, maxUsd: 0.25, qualityWeight: 0.8 },
      options: {
        intent: "Run the sample release-readiness workflow.",
        protocol,
        tier: "quality",
        model,
        budget: { maxTokens: 12_000, maxUsd: 0.25, qualityWeight: 0.8 }
      }
    });

    const app = entrypoint.start();
    const result = await app.result;

    expect(result.metadata).toMatchObject({
      protocol: "broadcast",
      tier: "quality",
      modelProviderId: "demo-entrypoint-model"
    });
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "broadcast",
      "final"
    ]);
    expect(app.snapshot()).toMatchObject({
      status: "completed",
      traceEventTypes: ["role-assignment", "role-assignment", "agent-turn", "agent-turn", "broadcast", "final"],
      latestOutput: result.output
    });
  });

  it("starts the sample workflow with default mission, sequential protocol, and budget tier controls", async () => {
    const app = startSampleWorkflow({
      model: createImmediateModelProvider("demo-sample-default-model")
    });
    const result = await app.result;

    expect(sampleDemoWorkflowControls).toMatchObject({
      mission: expect.any(String),
      coordinationProtocol: { kind: "sequential", maxTurns: 3 },
      costTier: "balanced",
      budget: { maxTokens: 12_000, maxUsd: 0.25, qualityWeight: 0.6 }
    });
    expect(result.metadata).toMatchObject({
      protocol: "sequential",
      tier: "balanced",
      modelProviderId: "demo-sample-default-model"
    });
    expect(result.metadata.agentsUsed).toHaveLength(3);
    expect(result.trace.events.at(-1)?.type).toBe("final");
  });

  it("captures the complete required event-type set during the sample workflow execution", async () => {
    const app = startSampleWorkflow({
      coordinationProtocol: { kind: "broadcast", maxRounds: 1 },
      budget: { maxTokens: 1, maxUsd: 1, qualityWeight: 0.6 },
      model: createImmediateStreamingModelProvider("demo-sample-coverage-model"),
      agents: [
        { id: "coverage-agent-1", role: "release-engineer" },
        { id: "coverage-agent-2", role: "paper-reviewer" }
      ]
    });

    const result = await app.result;
    const snapshot = app.snapshot();

    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "model-output-chunk",
      "model-output-chunk",
      "agent-turn",
      "budget-stop",
      "broadcast",
      "final"
    ]);
    expect(result.eventLog.eventTypes).toEqual(result.trace.events.map((event) => event.type));
    expect(result.trace.transcript).toHaveLength(1);
    expect(snapshot.requiredTraceEventTypes).toEqual(requiredDemoTraceEventTypes);
    expect(snapshot.capturedRequiredTraceEventTypes).toEqual(requiredDemoTraceEventTypes);
    expect(snapshot.missingRequiredTraceEventTypes).toEqual([]);
    expect(snapshot.hasCapturedRequiredTraceEventTypes).toBe(true);
    expect(snapshot.traceEventList.map((item) => item.eventType)).toEqual(result.eventLog.eventTypes);
    expect(snapshot.traceEventList[2]).toMatchObject({
      eventType: "model-output-chunk",
      visualSection: "agent-turns",
      visualState: "turn-completed",
      metadata: {
        type: "model-output-chunk",
        agentId: "coverage-agent-1",
        role: "release-engineer",
        chunkIndex: 0
      }
    });
    expect(snapshot.traceEventList[5]).toMatchObject({
      eventType: "budget-stop",
      visualSection: "activity-log",
      visualState: "budget-stopped",
      metadata: {
        type: "budget-stop",
        reason: "tokens",
        iteration: 1
      }
    });
    expect(snapshot.broadcastSection.items).toEqual([snapshot.traceEventList[6]]);
    expect(snapshot.finalOutputSection.items).toEqual([snapshot.traceEventList[7]]);
  });

  it("starts a demo run through the SDK subscription API and records live events", async () => {
    const gate = createResponseGate();
    const app = startDemoRun({
      intent: "Render a live demo run.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: createGatedModelProvider("demo-start-model", gate),
      agents: [{ id: "demo-agent", role: "demo-runner" }]
    });

    expect(app.snapshot()).toMatchObject({
      status: "running",
      traceEventCount: 1,
      traceEventTypes: ["role-assignment"],
      roleAssignmentSection: {
        id: "role-assignments",
        title: "Role assignments",
        state: "visible",
        items: [
          {
            eventType: "role-assignment",
            visualSection: "role-roster",
            visualState: "participant-assigned"
          }
        ]
      },
      agentTurnSection: {
        id: "agent-turns",
        title: "Agent turns",
        state: "empty",
        items: []
      },
      broadcastSection: {
        id: "broadcast-rounds",
        title: "Broadcast rounds",
        state: "empty",
        items: []
      },
      finalOutputSection: {
        id: "final-output",
        title: "Final output",
        state: "empty",
        items: []
      },
      eventCount: 1,
      eventTypes: ["role-assignment"]
    });

    await gate.requested;
    gate.resolve("live demo output");
    const result = await app.result;

    expect(result.output).toBe("live demo output");
    expect(app.snapshot()).toMatchObject({
      status: "completed",
      traceEventTypes: ["role-assignment", "agent-turn", "final"],
      eventTypes: ["role-assignment", "agent-turn", "final"],
      latestOutput: "live demo output"
    });
  });

  it("stores incoming trace events incrementally before the run result resolves", async () => {
    const gate = createResponseGate();
    const app = startDemoRun({
      intent: "Persist the trace as the demo receives it.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: createGatedModelProvider("demo-incremental-model", gate),
      agents: [{ id: "incremental-agent", role: "incremental-runner" }]
    });

    await gate.requested;
    const pendingState = await settlementState(app.result);
    const runningSnapshot = app.snapshot();

    expect(pendingState).toBe("pending");
    expect(runningSnapshot.status).toBe("running");
    expect(runningSnapshot.traceEventTypes).toEqual(["role-assignment"]);
    expect(runningSnapshot.traceEvents).toHaveLength(1);
    expect(runningSnapshot.latestTraceEvent?.type).toBe("role-assignment");
    expect(runningSnapshot.traceEventList).toEqual([
      {
        order: 1,
        eventType: "role-assignment",
        at: runningSnapshot.traceEvents[0]?.at,
        runId: runningSnapshot.traceEvents[0]?.runId,
        title: "Assigned incremental-runner",
        visualSection: "role-roster",
        visualState: "participant-assigned",
        metadata: {
          type: "role-assignment",
          agentId: "incremental-agent",
          role: "incremental-runner"
        }
      }
    ]);
    expect(runningSnapshot.latestTraceEventListItem).toEqual(runningSnapshot.traceEventList[0]);
    expect(runningSnapshot.roleAssignmentSection).toEqual({
      id: "role-assignments",
      title: "Role assignments",
      state: "visible",
      items: [runningSnapshot.traceEventList[0]]
    });
    expect(runningSnapshot.agentTurnSection).toEqual({
      id: "agent-turns",
      title: "Agent turns",
      state: "empty",
      items: []
    });
    expect(runningSnapshot.broadcastSection).toEqual({
      id: "broadcast-rounds",
      title: "Broadcast rounds",
      state: "empty",
      items: []
    });
    expect(runningSnapshot.finalOutputSection).toEqual({
      id: "final-output",
      title: "Final output",
      state: "empty",
      items: []
    });
    expect(runningSnapshot.events).toEqual(runningSnapshot.traceEvents);

    gate.resolve("incremental output");
    const result = await app.result;
    const completedSnapshot = app.snapshot();

    expect(result.trace.events.map((event) => event.type)).toEqual(["role-assignment", "agent-turn", "final"]);
    expect(completedSnapshot.traceEvents).toEqual(result.trace.events);
    expect(completedSnapshot.traceEventList.map((item) => item.order)).toEqual([1, 2, 3]);
    expect(completedSnapshot.traceEventList.map((item) => item.eventType)).toEqual(["role-assignment", "agent-turn", "final"]);
    expect(completedSnapshot.traceEventList.map((item) => item.at)).toEqual(result.trace.events.map((event) => event.at));
    expect(completedSnapshot.traceEventList[1]).toMatchObject({
      order: 2,
      eventType: "agent-turn",
      runId: result.trace.runId,
      title: "incremental-runner turn",
      visualSection: "agent-turns",
      visualState: "turn-completed",
      metadata: {
        type: "agent-turn",
        agentId: "incremental-agent",
        role: "incremental-runner",
        outputLength: "incremental output".length,
        costUsd: 0.001
      }
    });
    expect(completedSnapshot.traceEventList[2]).toMatchObject({
      order: 3,
      eventType: "final",
      runId: result.trace.runId,
      title: "Final output",
      visualSection: "final-output",
      visualState: "run-completed",
      metadata: {
        type: "final",
        outputLength: "incremental output".length,
        transcriptEntryCount: result.transcript.length
      }
    });
    expect(completedSnapshot.latestTraceEventListItem).toEqual(completedSnapshot.traceEventList[2]);
    expect(completedSnapshot.roleAssignmentSection.items).toEqual([completedSnapshot.traceEventList[0]]);
    expect(completedSnapshot.agentTurnSection).toEqual({
      id: "agent-turns",
      title: "Agent turns",
      state: "active",
      items: [completedSnapshot.traceEventList[1]]
    });
    expect(completedSnapshot.broadcastSection).toEqual({
      id: "broadcast-rounds",
      title: "Broadcast rounds",
      state: "empty",
      items: []
    });
    expect(completedSnapshot.finalOutputSection).toEqual({
      id: "final-output",
      title: "Final output",
      state: "completed",
      items: [completedSnapshot.traceEventList[2]],
      output: "incremental output"
    });
    expect(runningSnapshot.traceEvents).toHaveLength(1);
    expect(runningSnapshot.traceEventList).toHaveLength(1);
  });

  it("renders final events in a distinct final output section", async () => {
    const app = startDemoRun({
      intent: "Render final output as its own demo state.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: createImmediateModelProvider("demo-final-model"),
      agents: [{ id: "final-agent", role: "final-runner" }]
    });

    const result = await app.result;
    const snapshot = app.snapshot();

    expect(result.trace.events.at(-1)?.type).toBe("final");
    expect(snapshot.finalOutputSection).toEqual({
      id: "final-output",
      title: "Final output",
      state: "completed",
      items: [snapshot.traceEventList[2]],
      output: result.output
    });
    expect(snapshot.traceEventList[2]).toMatchObject({
      order: 3,
      eventType: "final",
      runId: result.trace.runId,
      title: "Final output",
      visualSection: "final-output",
      visualState: "run-completed",
      metadata: {
        type: "final",
        outputLength: result.output.length,
        transcriptEntryCount: result.transcript.length
      }
    });
    expect(snapshot.finalOutputSection.items[0]?.visualSection).toBe("final-output");
    expect(snapshot.finalOutputSection.items[0]?.visualState).toBe("run-completed");
  });

  it("renders broadcast events in a distinct broadcast section", async () => {
    const app = startDemoRun({
      intent: "Render broadcast coordination as its own demo state.",
      protocol: { kind: "broadcast", maxRounds: 1 },
      tier: "fast",
      model: createImmediateModelProvider("demo-broadcast-model"),
      agents: [
        { id: "broadcast-agent-1", role: "release-engineer" },
        { id: "broadcast-agent-2", role: "paper-reviewer" }
      ]
    });

    const result = await app.result;
    const snapshot = app.snapshot();

    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "broadcast",
      "final"
    ]);
    expect(snapshot.broadcastSection).toEqual({
      id: "broadcast-rounds",
      title: "Broadcast rounds",
      state: "active",
      items: [snapshot.traceEventList[4]]
    });
    expect(snapshot.traceEventList[4]).toMatchObject({
      order: 5,
      eventType: "broadcast",
      runId: result.trace.runId,
      title: "Broadcast round 1",
      visualSection: "broadcast-rounds",
      visualState: "broadcast-completed",
      metadata: {
        type: "broadcast",
        round: 1,
        contributionCount: 2,
        costUsd: 0.002
      }
    });
    expect(snapshot.traceEventList[4]?.visualSection).not.toBe("activity-log");
    expect(snapshot.agentTurnSection.items).toEqual([snapshot.traceEventList[2], snapshot.traceEventList[3]]);
  });

  it("attaches to an existing live stream handle without consuming the async iterator", async () => {
    const gate = createResponseGate();
    const handle = stream({
      intent: "Attach a demo view to an existing SDK run.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: createGatedModelProvider("demo-attach-model", gate),
      agents: [{ id: "attached-agent", role: "attached-runner" }]
    });
    const app = attachDemoApp(handle);

    expect(app.snapshot().status).toBe("running");

    await gate.requested;
    gate.resolve("attached output");
    const result = await app.result;

    expect(result.trace.events.map((event) => event.type)).toEqual(["role-assignment", "agent-turn", "final"]);
    expect(app.snapshot()).toMatchObject({
      status: "completed",
      traceEventCount: 3,
      eventCount: 3,
      latestOutput: "attached output"
    });
  });

  it("lets demo subscribers detach without cancelling the SDK run", async () => {
    const gate = createResponseGate();
    const handle = stream({
      intent: "Keep the run alive after a demo unmounts.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: createGatedModelProvider("demo-stop-model", gate),
      agents: [{ id: "detached-agent", role: "detached-runner" }]
    });
    const app = attachDemoApp(handle);

    app.stop();
    await gate.requested;
    gate.resolve("detached output");
    const result = await handle.result;

    expect(result.output).toBe("detached output");
    expect(app.snapshot()).toMatchObject({
      status: "completed",
      traceEventCount: 1,
      traceEventTypes: ["role-assignment"],
      eventCount: 1,
      eventTypes: ["role-assignment"],
      latestOutput: "detached output"
    });
  });
});

interface ResponseGate {
  readonly requested: Promise<void>;
  resolve(text: string): void;
  text(): Promise<string>;
}

function createResponseGate(): ResponseGate {
  let markRequested: (() => void) | undefined;
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve;
  });
  let releaseResponse: ((text: string) => void) | undefined;
  const response = new Promise<string>((resolve) => {
    releaseResponse = resolve;
  });

  return {
    requested,
    resolve(text: string): void {
      releaseResponse?.(text);
    },
    async text(): Promise<string> {
      markRequested?.();
      return response;
    }
  };
}

function createGatedModelProvider(id: string, gate: ResponseGate): ConfiguredModelProvider {
  return {
    id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const text = await gate.text();
      const input = request.messages.find((message) => message.role === "user")?.content ?? "";

      return {
        text,
        usage: {
          inputTokens: countWords(input),
          outputTokens: countWords(text),
          totalTokens: countWords(input) + countWords(text)
        },
        costUsd: 0.001
      };
    }
  };
}

function createImmediateModelProvider(id: string): ConfiguredModelProvider {
  return {
    id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const input = request.messages.find((message) => message.role === "user")?.content ?? "";
      const text = `broadcast output for ${input}`;

      return {
        text,
        usage: {
          inputTokens: countWords(input),
          outputTokens: countWords(text),
          totalTokens: countWords(input) + countWords(text)
        },
        costUsd: 0.001
      };
    }
  };
}

function createImmediateStreamingModelProvider(id: string): ConfiguredModelProvider {
  return {
    id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const input = request.messages.find((message) => message.role === "user")?.content ?? "";
      const text = `streamed coverage output for ${input}`;

      return {
        text,
        usage: {
          inputTokens: countWords(input),
          outputTokens: countWords(text),
          totalTokens: countWords(input) + countWords(text)
        },
        costUsd: 0.001
      };
    },
    async *stream(request: ModelRequest): AsyncIterable<ModelOutputChunk> {
      const input = request.messages.find((message) => message.role === "user")?.content ?? "";
      const firstText = "streamed ";
      const secondText = `coverage output for ${input}`;
      yield { text: firstText };
      yield {
        text: secondText,
        usage: {
          inputTokens: countWords(input),
          outputTokens: countWords(firstText) + countWords(secondText),
          totalTokens: countWords(input) + countWords(firstText) + countWords(secondText)
        },
        costUsd: 0.001
      };
    }
  };
}

function countWords(text: string): number {
  return Math.max(1, text.split(/\s+/u).filter(Boolean).length);
}

async function settlementState(result: Promise<RunResult>): Promise<"pending" | "fulfilled" | "rejected"> {
  return Promise.race([
    result.then(
      () => "fulfilled" as const,
      () => "rejected" as const
    ),
    Promise.resolve("pending" as const)
  ]);
}
