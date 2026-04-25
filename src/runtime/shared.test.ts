import { describe, expect, it } from "vitest";
import { createDeterministicSharedTestMission } from "../internal.js";
import { Dogpile, run, runtimeToolManifest } from "../index.js";
import type {
  ConfiguredModelProvider,
  JsonObject,
  ModelRequest,
  ModelResponse,
  RunEvent,
  RuntimeTool
} from "../index.js";

describe("shared protocol", () => {
  it("executes end-to-end through the branded high-level SDK call", async () => {
    const result = await Dogpile.pile(createDeterministicSharedTestMission());

    expect(result.output).toBe(
      [
        "state-initializer:agent-1 => state-initializer:agent-1 initialized the shared state.",
        "state-reviewer:agent-2 => state-reviewer:agent-2 improved the shared state.",
        "state-synthesizer:agent-3 => state-synthesizer:agent-3 improved the shared state."
      ].join("\n")
    );
    expect(result.trace.protocol).toBe("shared");
    expect(result.trace.modelProviderId).toBe("deterministic-shared-model");
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(result.transcript).toHaveLength(3);
    expect(result.trace.transcript).toEqual(result.transcript);
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
    expect(result.cost.totalTokens).toBeGreaterThan(0);
  });

  it("runs a deterministic shared-state test mission against the configured model provider", async () => {
    const requests: ModelRequest[] = [];
    const model: ConfiguredModelProvider = {
      id: "configured-shared-model",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        requests.push(request);
        const agentId = String(request.metadata.agentId);
        const role = String(request.metadata.role);
        const turn = Number(request.metadata.turn);

        return {
          text: `${role}:${agentId} wrote shared turn ${turn}.`,
          usage: {
            inputTokens: 9,
            outputTokens: 5,
            totalTokens: 14
          },
          costUsd: 0.001
        };
      }
    };

    const result = await run(createDeterministicSharedTestMission(model));

    expect(requests).toHaveLength(3);
    expect(result.trace.protocol).toBe("shared");
    expect(result.trace.modelProviderId).toBe("configured-shared-model");
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);

    for (const [index, request] of requests.entries()) {
      const turn = index + 1;
      const userMessage = request.messages.find((message) => message.role === "user");
      const systemMessage = request.messages.find((message) => message.role === "system");

      expect(request.metadata).toMatchObject({
        protocol: "shared",
        tier: "fast",
        turn
      });
      expect(userMessage?.content).toContain("Decide whether the shared protocol can support portable replay.");
      expect(userMessage?.content).toContain(`Shared turn ${turn}`);
      expect(userMessage?.content).toContain("Shared state:");
      expect(systemMessage?.content).toContain("Shared multi-agent protocol");
    }

    expect(requests[0]?.messages.find((message) => message.role === "user")?.content).toContain("(empty)");
    expect(requests[1]?.messages.find((message) => message.role === "user")?.content).toContain(
      "state-initializer:agent-1 => state-initializer:agent-1 wrote shared turn 1."
    );
    expect(result.output).toBe(
      [
        "state-initializer:agent-1 => state-initializer:agent-1 wrote shared turn 1.",
        "state-reviewer:agent-2 => state-reviewer:agent-2 wrote shared turn 2.",
        "state-synthesizer:agent-3 => state-synthesizer:agent-3 wrote shared turn 3."
      ].join("\n")
    );
    expect(result.transcript).toHaveLength(3);
    expect(result.trace.transcript).toEqual(result.transcript);
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
    expect(result.cost.totalTokens).toBe(42);
  });

  it("streams shared coordination events through the high-level SDK handle", async () => {
    const handle = Dogpile.stream(createDeterministicSharedTestMission());

    const streamedEvents: RunEvent[] = [];
    for await (const event of handle) {
      if (event.type !== "error") {
        streamedEvents.push(event as RunEvent);
      }
    }
    const result = await handle.result;

    const expectedOutput = [
      "state-initializer:agent-1 => state-initializer:agent-1 initialized the shared state.",
      "state-reviewer:agent-2 => state-reviewer:agent-2 improved the shared state.",
      "state-synthesizer:agent-3 => state-synthesizer:agent-3 improved the shared state."
    ].join("\n");

    expect(result.output).toBe(expectedOutput);
    expect(streamedEvents.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(result.trace.events).toEqual(streamedEvents);
    expect(result.transcript).toEqual([
      {
        agentId: "agent-1",
        role: "state-initializer",
        input:
          "Mission: Decide whether the shared protocol can support portable replay.\nShared turn 1: read the shared state and return an improved shared-state update.\n\nShared state:\n(empty)",
        output: "state-initializer:agent-1 initialized the shared state."
      },
      {
        agentId: "agent-2",
        role: "state-reviewer",
        input:
          "Mission: Decide whether the shared protocol can support portable replay.\nShared turn 2: read the shared state and return an improved shared-state update.\n\nShared state:\nstate-initializer:agent-1 => state-initializer:agent-1 initialized the shared state.",
        output: "state-reviewer:agent-2 improved the shared state."
      },
      {
        agentId: "agent-3",
        role: "state-synthesizer",
        input:
          "Mission: Decide whether the shared protocol can support portable replay.\nShared turn 3: read the shared state and return an improved shared-state update.\n\nShared state:\nstate-initializer:agent-1 => state-initializer:agent-1 initialized the shared state.\nstate-reviewer:agent-2 => state-reviewer:agent-2 improved the shared state.",
        output: "state-synthesizer:agent-3 improved the shared state."
      }
    ]);
    expect(result.trace.transcript).toEqual(result.transcript);
  });

  it("threads runtime tool availability through every shared model turn", async () => {
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
      id: "shared-tool-availability-model",
      async generate(request) {
        requests.push(request);
        return { text: `turn-${requests.length}` };
      }
    };

    await run({
      intent: "Use available tools while updating shared state.",
      protocol: { kind: "shared", maxTurns: 2 },
      tier: "fast",
      model,
      agents: [
        { id: "initializer-seat", role: "initializer" },
        { id: "reviewer-seat", role: "reviewer" }
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
