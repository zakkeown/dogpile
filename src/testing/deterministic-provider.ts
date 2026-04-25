import type { ConfiguredModelProvider, DogpileOptions, ModelRequest, ModelResponse } from "../types.js";

export function createDeterministicModelProvider(id = "deterministic-test-model"): ConfiguredModelProvider {
  return {
    id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const role = readStringMetadata(request, "role");
      const agentId = readStringMetadata(request, "agentId");
      const protocol = readStringMetadata(request, "protocol");
      const phase = readStringMetadata(request, "phase");
      const userMessage = request.messages.find((message) => message.role === "user")?.content ?? "";
      const hasPrior = userMessage.includes("Prior contributions:");
      const hasSharedState = userMessage.includes("Shared state:") && !userMessage.includes("Shared state:\n(empty)");
      const text =
        protocol === "broadcast"
          ? `${role}:${agentId} independently assessed the broadcast mission.`
          : protocol === "shared"
            ? hasSharedState
              ? `${role}:${agentId} improved the shared state.`
              : `${role}:${agentId} initialized the shared state.`
            : protocol === "coordinator"
              ? phase === "final-synthesis"
                ? `${role}:${agentId} synthesized the coordinator-managed mission.`
                : phase === "worker"
                  ? `${role}:${agentId} completed the coordinator-assigned work.`
                  : `${role}:${agentId} planned the coordinator-managed mission.`
          : hasPrior
            ? `${role}:${agentId} refined the mission using prior work.`
            : `${role}:${agentId} framed the mission.`;

      return {
        text,
        usage: {
          inputTokens: tokenEstimate(userMessage),
          outputTokens: tokenEstimate(text),
          totalTokens: tokenEstimate(userMessage) + tokenEstimate(text)
        },
        costUsd: 0.0001
      };
    }
  };
}

export function createDeterministicCoordinatorTestMission(
  model = createDeterministicModelProvider("deterministic-coordinator-model")
): DogpileOptions {
  return {
    intent: "Decide whether the coordinator protocol can run a portable release triage end to end.",
    protocol: { kind: "coordinator", maxTurns: 3 },
    tier: "fast",
    model,
    agents: [
      {
        id: "agent-1",
        role: "release-coordinator",
        instructions: "Assign release triage work and produce the final synthesis."
      },
      {
        id: "agent-2",
        role: "evidence-reviewer",
        instructions: "Check implementation evidence and identify release blockers."
      },
      {
        id: "agent-3",
        role: "portability-reviewer",
        instructions: "Check runtime portability and caller-managed replay."
      }
    ]
  };
}

export function createDeterministicBroadcastTestMission(
  model = createDeterministicModelProvider("deterministic-broadcast-model")
): DogpileOptions {
  return {
    intent: "Decide whether to ship a portable multi-agent SDK release candidate.",
    protocol: { kind: "broadcast", maxRounds: 1 },
    tier: "fast",
    model,
    agents: [
      {
        id: "agent-1",
        role: "release-engineer",
        instructions: "Check implementation readiness and release risk."
      },
      {
        id: "agent-2",
        role: "paper-reviewer",
        instructions: "Check protocol faithfulness and evidence quality."
      },
      {
        id: "agent-3",
        role: "developer-advocate",
        instructions: "Check API clarity and user-facing ergonomics."
      }
    ]
  };
}

export function createDeterministicSharedTestMission(
  model = createDeterministicModelProvider("deterministic-shared-model")
): DogpileOptions {
  return {
    intent: "Decide whether the shared protocol can support portable replay.",
    protocol: { kind: "shared", maxTurns: 3 },
    tier: "fast",
    model,
    agents: [
      {
        id: "agent-1",
        role: "state-initializer",
        instructions: "Create the first shared-state entry from the mission."
      },
      {
        id: "agent-2",
        role: "state-reviewer",
        instructions: "Read the shared state and improve gaps or contradictions."
      },
      {
        id: "agent-3",
        role: "state-synthesizer",
        instructions: "Preserve useful shared-state content and make it actionable."
      }
    ]
  };
}

function readStringMetadata(request: ModelRequest, key: string): string {
  const value = request.metadata[key];
  return typeof value === "string" ? value : "unknown";
}

function tokenEstimate(text: string): number {
  return Math.max(1, text.split(/\s+/u).filter(Boolean).length);
}
