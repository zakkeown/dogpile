import { describe, expect, it } from "vitest";
import { createDeterministicModelProvider } from "../internal.js";
import { Dogpile, run, runtimeToolManifest, stream } from "../index.js";
import type { ConfiguredModelProvider, JsonObject, ModelRequest, RunEvent, RuntimeTool } from "../index.js";

describe("sequential protocol", () => {
  it("uses the ergonomic default flow when protocol and tier are omitted", async () => {
    const result = await Dogpile.pile({
      intent: "Draft a release note for a portable multi-agent SDK.",
      model: createDeterministicModelProvider("default-flow-model")
    });

    expect(result.output).toContain("synthesizer:agent-3");
    expect(result.transcript).toHaveLength(3);
    expect(result.trace.protocol).toBe("sequential");
    expect(result.trace.tier).toBe("balanced");
    expect(result.trace.modelProviderId).toBe("default-flow-model");
  });

  it("runs end-to-end against a configured model provider", async () => {
    const result = await run({
      intent: "Draft a release note for a portable multi-agent SDK.",
      protocol: "sequential",
      tier: "fast",
      model: createDeterministicModelProvider()
    });

    expect(result.output).toContain("synthesizer:agent-3");
    expect(result.transcript).toHaveLength(3);
    expect(result.trace.protocol).toBe("sequential");
    expect(result.trace.modelProviderId).toBe("deterministic-test-model");
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
    expect(result.cost.totalTokens).toBeGreaterThan(0);
  });

  it("passes a caller AbortSignal through every sequential model request", async () => {
    const abortController = new AbortController();
    const requests: ModelRequest[] = [];
    const model: ConfiguredModelProvider = {
      id: "abort-signal-model",
      async generate(request) {
        requests.push(request);
        return { text: `turn-${requests.length}` };
      }
    };

    const result = await run({
      intent: "Verify cancellation plumbing reaches the provider adapter.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "fast",
      model,
      signal: abortController.signal
    });

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.signal)).toEqual([
      abortController.signal,
      abortController.signal
    ]);
    expect(result.trace.providerCalls.map((call) => call.request.signal)).toEqual([
      undefined,
      undefined
    ]);
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
  });

  it("streams the same coordination moments before resolving the final result", async () => {
    const handle = stream({
      intent: "Summarize the value of sequential agent collaboration.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "balanced",
      model: createDeterministicModelProvider("configured-stream-model")
    });

    const events = [];
    for await (const event of handle) {
      events.push(event.type);
    }
    const result = await handle.result;

    expect(events).toEqual([
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(result.output).toContain("critic:agent-2");
    expect(result.trace.modelProviderId).toBe("configured-stream-model");
  });

  it("streams role-assignment events with agent ids and roles before agent work events", async () => {
    const handle = Dogpile.stream({
      intent: "Verify role assignment streaming before work starts.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "balanced",
      model: createDeterministicModelProvider("role-stream-model"),
      agents: [
        { id: "planner-seat", role: "planner" },
        { id: "reviewer-seat", role: "reviewer" }
      ]
    });

    const streamedEvents: RunEvent[] = [];
    for await (const event of handle) {
      if (event.type !== "error") {
        streamedEvents.push(event as RunEvent);
      }
    }
    const result = await handle.result;

    expect(streamedEvents.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(streamedEvents.slice(0, 2)).toEqual([
      expect.objectContaining({
        type: "role-assignment",
        runId: result.trace.runId,
        agentId: "planner-seat",
        role: "planner"
      }),
      expect.objectContaining({
        type: "role-assignment",
        runId: result.trace.runId,
        agentId: "reviewer-seat",
        role: "reviewer"
      })
    ]);
    expect(result.trace.events).toEqual(streamedEvents);
  });

  it("threads runtime tool availability through every sequential model turn", async () => {
    interface LookupInput extends JsonObject {
      readonly query: string;
    }

    interface LookupOutput extends JsonObject {
      readonly answer: string;
    }

    const requests: ModelRequest[] = [];
    const lookupTool: RuntimeTool<LookupInput, LookupOutput> = {
      identity: {
        id: "fixture.lookup",
        name: "lookup",
        description: "Lookup contextual facts for the active mission."
      },
      inputSchema: {
        kind: "json-schema",
        schema: {
          type: "object",
          properties: {
            query: { type: "string" }
          },
          required: ["query"],
          additionalProperties: false
        }
      },
      execute(input, context) {
        return {
          type: "success",
          toolCallId: context.toolCallId,
          tool: this.identity,
          output: {
            answer: `found:${input.query}`
          }
        };
      }
    };
    const model: ConfiguredModelProvider = {
      id: "sequential-tool-availability-model",
      async generate(request) {
        requests.push(request);
        return { text: `turn-${requests.length}` };
      }
    };

    await run({
      intent: "Use available tools while composing a release note.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "fast",
      model,
      agents: [
        { id: "researcher-seat", role: "researcher" },
        { id: "writer-seat", role: "writer" }
      ],
      tools: [lookupTool]
    });

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.metadata.tools)).toEqual([
      runtimeToolManifest([lookupTool]),
      runtimeToolManifest([lookupTool])
    ]);
  });
});
