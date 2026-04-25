import { describe, expect, it } from "vitest";
import { createDeterministicBroadcastTestMission } from "../internal.js";
import { run, runtimeToolManifest, stream } from "../index.js";
import type {
  AgentSpec,
  ConfiguredModelProvider,
  JsonObject,
  ModelRequest,
  ModelResponse,
  RuntimeTool
} from "../index.js";

describe("broadcast protocol", () => {
  it("dispatches the mission to every configured seat and aggregates their responses", async () => {
    const intent = "Assess whether the benchmark release should ship today.";
    const agents: readonly AgentSpec[] = [
      {
        id: "seat-release",
        role: "release",
        instructions: "Focus on release blocking risk."
      },
      {
        id: "seat-eval",
        role: "evaluator",
        instructions: "Focus on reproduction evidence."
      },
      {
        id: "seat-api",
        role: "api",
        instructions: "Focus on caller ergonomics."
      },
      {
        id: "seat-runtime",
        role: "runtime",
        instructions: "Focus on portability."
      }
    ];
    const requests: ModelRequest[] = [];
    const model: ConfiguredModelProvider = {
      id: "capturing-broadcast-model",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        requests.push(request);
        const agentId = String(request.metadata.agentId);
        const role = String(request.metadata.role);
        return {
          text: `${agentId}(${role}) saw the shared broadcast mission`,
          usage: {
            inputTokens: 7,
            outputTokens: 5,
            totalTokens: 12
          },
          costUsd: 0.001
        };
      }
    };

    const result = await run({
      intent,
      protocol: { kind: "broadcast", maxRounds: 1 },
      tier: "balanced",
      model,
      agents
    });

    expect(requests).toHaveLength(agents.length);
    for (const [index, agent] of agents.entries()) {
      const request = requests[index];
      if (!request) {
        throw new Error(`missing broadcast request for ${agent.id}`);
      }
      const userMessage = request.messages.find((message) => message.role === "user");
      const systemMessage = request.messages.find((message) => message.role === "system");

      expect(request.metadata).toMatchObject({
        protocol: "broadcast",
        agentId: agent.id,
        role: agent.role,
        tier: "balanced",
        round: 1
      });
      expect(userMessage?.content).toContain(intent);
      expect(userMessage?.content).toContain("Broadcast round 1");
      expect(systemMessage?.content).toContain(agent.id);
      expect(systemMessage?.content).toContain(agent.role);
      expect(systemMessage?.content).toContain(agent.instructions);
    }

    const expectedOutputs = agents.map(
      (agent) => `${agent.id}(${agent.role}) saw the shared broadcast mission`
    );
    expect(result.transcript.map((entry) => entry.output)).toEqual(expectedOutputs);
    expect(result.output).toBe(
      agents
        .map((agent, index) => `${agent.role}:${agent.id} => ${expectedOutputs[index]}`)
        .join("\n")
    );

    const broadcastEvent = result.trace.events.find((event) => event.type === "broadcast");
    expect(broadcastEvent?.type).toBe("broadcast");
    if (broadcastEvent?.type !== "broadcast") {
      throw new Error("expected broadcast event");
    }
    expect(broadcastEvent.contributions.map((contribution) => contribution.output)).toEqual(expectedOutputs);
  });

  it("runs a deterministic test mission against a configured model provider", async () => {
    const result = await run(createDeterministicBroadcastTestMission());
    const expectedTranscript = [
      {
        agentId: "agent-1",
        role: "release-engineer",
        input:
          "Mission: Decide whether to ship a portable multi-agent SDK release candidate.\nBroadcast round 1: contribute independently before synthesis.",
        output: "release-engineer:agent-1 independently assessed the broadcast mission."
      },
      {
        agentId: "agent-2",
        role: "paper-reviewer",
        input:
          "Mission: Decide whether to ship a portable multi-agent SDK release candidate.\nBroadcast round 1: contribute independently before synthesis.",
        output: "paper-reviewer:agent-2 independently assessed the broadcast mission."
      },
      {
        agentId: "agent-3",
        role: "developer-advocate",
        input:
          "Mission: Decide whether to ship a portable multi-agent SDK release candidate.\nBroadcast round 1: contribute independently before synthesis.",
        output: "developer-advocate:agent-3 independently assessed the broadcast mission."
      }
    ] as const;
    const expectedOutput = expectedTranscript
      .map((entry) => `${entry.role}:${entry.agentId} => ${entry.output}`)
      .join("\n");

    expect(result.output).toBe(expectedOutput);
    expect(result.transcript).toEqual(expectedTranscript);
    expect(result.trace.transcript).toEqual(expectedTranscript);
    expect(result.trace.transcript).toEqual(result.transcript);
    expect(result.trace.protocol).toBe("broadcast");
    expect(result.trace.modelProviderId).toBe("deterministic-broadcast-model");
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "broadcast",
      "final"
    ]);
    for (const event of result.trace.events) {
      expect(event.runId).toBe(result.trace.runId);
      expect(new Date(event.at).toISOString()).toBe(event.at);
    }

    const broadcastEvent = result.trace.events.find((event) => event.type === "broadcast");
    expect(broadcastEvent?.type).toBe("broadcast");
    if (broadcastEvent?.type !== "broadcast") {
      throw new Error("expected broadcast event");
    }
    expect(broadcastEvent.round).toBe(1);
    expect(broadcastEvent.contributions).toHaveLength(3);
    expect(broadcastEvent.contributions.map((contribution) => contribution.agentId)).toEqual([
      "agent-1",
      "agent-2",
      "agent-3"
    ]);
    expect(broadcastEvent.contributions).toEqual(
      expectedTranscript.map((entry) => ({
        agentId: entry.agentId,
        role: entry.role,
        output: entry.output
      }))
    );
    const finalEvent = result.trace.events.at(-1);
    expect(finalEvent?.type).toBe("final");
    if (finalEvent?.type !== "final") {
      throw new Error("expected final event");
    }
    expect(finalEvent.output).toBe(expectedOutput);
    expect(finalEvent.cost).toEqual(result.cost);
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
    expect(result.cost.totalTokens).toBeGreaterThan(0);
  });

  it("streams broadcast coordination moments before resolving the final result", async () => {
    const handle = stream(createDeterministicBroadcastTestMission());

    const events: string[] = [];
    for await (const event of handle) {
      events.push(event.type);
    }
    const result = await handle.result;

    expect(events).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "broadcast",
      "final"
    ]);
    expect(result.output).toContain("developer-advocate:agent-3");
  });

  it("threads runtime tool availability through every broadcast model turn", async () => {
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
      id: "broadcast-tool-availability-model",
      async generate(request) {
        requests.push(request);
        return { text: `turn-${requests.length}` };
      }
    };

    await run({
      intent: "Use available tools while independently assessing a release.",
      protocol: { kind: "broadcast", maxRounds: 1 },
      tier: "fast",
      model,
      agents: [
        { id: "release-seat", role: "release" },
        { id: "eval-seat", role: "evaluator" }
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
