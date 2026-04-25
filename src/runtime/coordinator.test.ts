import { describe, expect, it } from "vitest";
import { createDeterministicCoordinatorTestMission } from "../internal.js";
import { Dogpile, run, runtimeToolManifest, stream } from "../index.js";
import type {
  AgentSpec,
  ConfiguredModelProvider,
  JsonObject,
  JsonValue,
  ModelRequest,
  ModelResponse,
  RunEvent,
  RuntimeTool
} from "../index.js";

describe("coordinator protocol", () => {
  it("plans, dispatches workers, and synthesizes through the configured model provider", async () => {
    const intent = "Decide whether the coordinator path is wired to the configured provider.";
    const agents: readonly AgentSpec[] = [
      {
        id: "seat-coordinator",
        role: "coordinator",
        instructions: "Assign work and synthesize the final answer."
      },
      {
        id: "seat-research",
        role: "researcher",
        instructions: "Inspect provider wiring evidence."
      },
      {
        id: "seat-review",
        role: "reviewer",
        instructions: "Check the final path for hidden shortcuts."
      }
    ];
    const requests: ModelRequest[] = [];
    const model: ConfiguredModelProvider = {
      id: "capturing-coordinator-model",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        requests.push(request);
        const phase = String(request.metadata.phase);
        const role = String(request.metadata.role);
        const agentId = String(request.metadata.agentId);

        return {
          text: `${phase}:${role}:${agentId}`,
          usage: {
            inputTokens: 11,
            outputTokens: 7,
            totalTokens: 18
          },
          costUsd: 0.001
        };
      }
    };

    const result = await run({
      intent,
      protocol: { kind: "coordinator", maxTurns: 3 },
      tier: "balanced",
      model,
      agents
    });

    expect(requests).toHaveLength(4);
    expect(requests.map((request) => request.metadata)).toEqual([
      expect.objectContaining({
        protocol: "coordinator",
        agentId: "seat-coordinator",
        role: "coordinator",
        coordinatorAgentId: "seat-coordinator",
        tier: "balanced",
        phase: "plan"
      }),
      expect.objectContaining({
        protocol: "coordinator",
        agentId: "seat-research",
        role: "researcher",
        coordinatorAgentId: "seat-coordinator",
        tier: "balanced",
        phase: "worker"
      }),
      expect.objectContaining({
        protocol: "coordinator",
        agentId: "seat-review",
        role: "reviewer",
        coordinatorAgentId: "seat-coordinator",
        tier: "balanced",
        phase: "worker"
      }),
      expect.objectContaining({
        protocol: "coordinator",
        agentId: "seat-coordinator",
        role: "coordinator",
        coordinatorAgentId: "seat-coordinator",
        tier: "balanced",
        phase: "final-synthesis"
      })
    ]);
    expect(requests[0]?.messages.find((message) => message.role === "user")?.content).toContain(intent);
    expect(requests[1]?.messages.find((message) => message.role === "user")?.content).toContain(
      "plan:coordinator:seat-coordinator"
    );
    expect(requests[3]?.messages.find((message) => message.role === "user")?.content).toContain(
      "Synthesize the final answer as the coordinator."
    );
    expect(result.output).toBe("final-synthesis:coordinator:seat-coordinator");
    expect(result.transcript).toHaveLength(4);
    expect(result.trace.protocol).toBe("coordinator");
    expect(result.trace.modelProviderId).toBe("capturing-coordinator-model");
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
    expect(result.cost).toEqual({
      usd: 0.004,
      inputTokens: 44,
      outputTokens: 28,
      totalTokens: 72
    });
  });

  it("threads shared runtime tool availability through every coordinator phase", async () => {
    const requests: ModelRequest[] = [];
    const lookupTool: RuntimeTool<JsonObject, JsonValue> = {
      identity: {
        id: "fixture.lookup",
        namespace: "dogpile.test",
        name: "lookup",
        version: "1.0.0",
        description: "Lookup release-readiness evidence."
      },
      inputSchema: {
        kind: "json-schema",
        description: "Release evidence lookup input.",
        schema: {
          type: "object",
          properties: {
            query: { type: "string" }
          },
          required: ["query"],
          additionalProperties: false
        }
      },
      permissions: [
        {
          kind: "custom",
          name: "release-evidence",
          description: "Reads caller-owned release evidence."
        }
      ],
      execute(input, context) {
        return {
          type: "success",
          toolCallId: context.toolCallId,
          tool: this.identity,
          output: {
            protocol: context.protocol
          }
        };
      }
    };
    const model: ConfiguredModelProvider = {
      id: "coordinator-tool-availability-model",
      async generate(request) {
        requests.push(request);
        return { text: `${String(request.metadata.phase)}:${String(request.metadata.agentId)}` };
      }
    };

    await run({
      intent: "Use available tools while coordinating a release decision.",
      protocol: { kind: "coordinator", maxTurns: 3 },
      tier: "fast",
      model,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "risk", role: "risk-reviewer" },
        { id: "runtime", role: "runtime-reviewer" }
      ],
      tools: [lookupTool]
    });

    expect(requests).toHaveLength(4);
    expect(requests.map((request) => request.metadata.phase)).toEqual([
      "plan",
      "worker",
      "worker",
      "final-synthesis"
    ]);
    expect(requests.map((request) => request.metadata.tools)).toEqual([
      runtimeToolManifest([lookupTool]),
      runtimeToolManifest([lookupTool]),
      runtimeToolManifest([lookupTool]),
      runtimeToolManifest([lookupTool])
    ]);
  });

  it("streams coordinator provider-backed turns before the final result", async () => {
    const model = createPhaseEchoProvider("streaming-coordinator-model");
    const handle = stream({
      intent: "Stream a coordinator run.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model,
      agents: [
        { id: "agent-1", role: "coordinator" },
        { id: "agent-2", role: "worker" }
      ]
    });

    const events: string[] = [];
    for await (const event of handle) {
      events.push(event.type);
    }
    const result = await handle.result;

    expect(events).toEqual([
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(result.output).toBe("final-synthesis:coordinator:agent-1");
    expect(result.trace.events.map((event) => event.type)).toEqual(events);
  });

  it("runs coordinator end to end with the configured provider and produces output, event log, and transcript", async () => {
    const requests: ModelRequest[] = [];
    const model = createPhaseEchoProvider("coordinator-e2e-provider", requests);
    const handle = Dogpile.stream({
      intent: "Produce an end-to-end coordinator release decision.",
      protocol: { kind: "coordinator", maxTurns: 3 },
      tier: "quality",
      model,
      agents: [
        { id: "lead", role: "release-coordinator" },
        { id: "risk", role: "risk-reviewer" },
        { id: "runtime", role: "runtime-reviewer" }
      ]
    });

    const eventLog: RunEvent[] = [];
    for await (const event of handle) {
      if (event.type !== "error") {
        eventLog.push(event as RunEvent);
      }
    }
    const result = await handle.result;

    expect(requests).toHaveLength(4);
    expect(result.output).toBe("final-synthesis:release-coordinator:lead");
    expect(result.trace.protocol).toBe("coordinator");
    expect(result.trace.modelProviderId).toBe("coordinator-e2e-provider");
    expect(eventLog).toHaveLength(8);
    expect(eventLog).toEqual(result.trace.events);
    expect(eventLog.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(result.transcript).toHaveLength(4);
    expect(result.trace.transcript).toEqual(result.transcript);
    expect(result.transcript.every((entry) => entry.input.length > 0 && entry.output.length > 0)).toBe(true);

    const finalEvent = eventLog.at(-1);
    expect(finalEvent?.type).toBe("final");
    if (finalEvent?.type !== "final") {
      throw new Error("expected final event in coordinator e2e event log");
    }
    expect(finalEvent.output).toBe(result.output);
  });

  it("runs a deterministic coordinator mission end to end through the branded SDK call", async () => {
    const result = await Dogpile.pile(createDeterministicCoordinatorTestMission());
    const intent = "Decide whether the coordinator protocol can run a portable release triage end to end.";
    const expectedTranscript = [
      {
        agentId: "agent-1",
        role: "release-coordinator",
        input: `Mission: ${intent}\nCoordinator agent-1: assign the work, name the plan, and provide the first contribution.`,
        output: "release-coordinator:agent-1 planned the coordinator-managed mission."
      },
      {
        agentId: "agent-2",
        role: "evidence-reviewer",
        input: [
          `Mission: ${intent}`,
          "",
          "Coordinator: agent-1",
          "Prior contributions:",
          "release-coordinator (agent-1): release-coordinator:agent-1 planned the coordinator-managed mission.",
          "",
          "Follow the coordinator-managed plan and provide your assigned contribution."
        ].join("\n"),
        output: "evidence-reviewer:agent-2 completed the coordinator-assigned work."
      },
      {
        agentId: "agent-3",
        role: "portability-reviewer",
        input: [
          `Mission: ${intent}`,
          "",
          "Coordinator: agent-1",
          "Prior contributions:",
          "release-coordinator (agent-1): release-coordinator:agent-1 planned the coordinator-managed mission.",
          "",
          "evidence-reviewer (agent-2): evidence-reviewer:agent-2 completed the coordinator-assigned work.",
          "",
          "Follow the coordinator-managed plan and provide your assigned contribution."
        ].join("\n"),
        output: "portability-reviewer:agent-3 completed the coordinator-assigned work."
      },
      {
        agentId: "agent-1",
        role: "release-coordinator",
        input: [
          `Mission: ${intent}`,
          "",
          "Coordinator: agent-1",
          "Prior contributions:",
          "release-coordinator (agent-1): release-coordinator:agent-1 planned the coordinator-managed mission.",
          "",
          "evidence-reviewer (agent-2): evidence-reviewer:agent-2 completed the coordinator-assigned work.",
          "",
          "portability-reviewer (agent-3): portability-reviewer:agent-3 completed the coordinator-assigned work.",
          "",
          "Synthesize the final answer as the coordinator."
        ].join("\n"),
        output: "release-coordinator:agent-1 synthesized the coordinator-managed mission."
      }
    ] as const;

    expect(result.output).toBe("release-coordinator:agent-1 synthesized the coordinator-managed mission.");
    expect(result.transcript).toEqual(expectedTranscript);
    expect(result.trace.transcript).toEqual(expectedTranscript);
    expect(result.trace.transcript).toEqual(result.transcript);
    expect(result.trace.protocol).toBe("coordinator");
    expect(result.trace.modelProviderId).toBe("deterministic-coordinator-model");
    expect(result.trace.agentsUsed.map((agent) => agent.id)).toEqual(["agent-1", "agent-2", "agent-3"]);
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);

    const finalEvent = result.trace.events.at(-1);
    expect(finalEvent?.type).toBe("final");
    if (finalEvent?.type !== "final") {
      throw new Error("expected final event");
    }
    expect(finalEvent.output).toBe(result.output);
    expect(finalEvent.cost).toEqual(result.cost);
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
    expect(result.cost.totalTokens).toBeGreaterThan(0);
  });
});

function createPhaseEchoProvider(id: string, requests: ModelRequest[] = []): ConfiguredModelProvider {
  return {
    id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      requests.push(request);
      return {
        text: `${String(request.metadata.phase)}:${String(request.metadata.role)}:${String(
          request.metadata.agentId
        )}`,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        },
        costUsd: 0
      };
    }
  };
}
