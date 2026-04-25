import { describe, expect, it } from "vitest";
import { budget, convergence, firstOf, run } from "../index.js";
import type { ConfiguredModelProvider, ModelRequest, ModelResponse, ProtocolConfig } from "../index.js";

describe("convergence-first stop behavior", () => {
  it.each([
    ["coordinator", { kind: "coordinator", maxTurns: 3 }],
    ["sequential", { kind: "sequential", maxTurns: 3 }],
    ["broadcast", { kind: "broadcast", maxRounds: 2 }],
    ["shared", { kind: "shared", maxTurns: 3 }]
  ] as const)(
    "halts %s on convergence before an equally eligible budget cap",
    async (_name, protocol) => {
      const requests: ModelRequest[] = [];
      const model = createConstantModelProvider("convergence-first-model", "stable release decision", requests);
      const convergenceCondition = convergence({ stableTurns: 2, minSimilarity: 1 });
      const budgetCondition = budget({ maxIterations: 2 });
      const terminate = firstOf(convergenceCondition, budgetCondition);

      const result = await run({
        intent: "Stop when the protocol has converged, even if a later budget child would also fire.",
        protocol: protocol as ProtocolConfig,
        tier: "fast",
        terminate,
        model
      });

      expect(requests).toHaveLength(2);
      expect(result.transcript).toHaveLength(2);
      expect(result.transcript.map((entry) => entry.output)).toEqual([
        "stable release decision",
        "stable release decision"
      ]);
      expect(result.trace.events.map((event) => event.type)).not.toContain("budget-stop");

      const finalEvent = result.trace.events.at(-1);
      expect(finalEvent?.type).toBe("final");
      if (finalEvent?.type !== "final") {
        throw new Error("expected final event");
      }

      expect(finalEvent.termination).toMatchObject({
        kind: "termination-stop",
        rootCondition: terminate,
        firedCondition: convergenceCondition,
        reason: "convergence",
        normalizedReason: "convergence",
        firstOf: {
          kind: "firstOf-stop",
          winningConditionIndex: 0,
          winningCondition: convergenceCondition,
          firedCondition: convergenceCondition
        },
        detail: {
          stableTurns: 2,
          minSimilarity: 1,
          observedSimilarity: 1,
          outputs: ["stable release decision", "stable release decision"]
        }
      });
      expect(finalEvent.termination?.firstOf?.evaluated).toHaveLength(1);
      expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
    }
  );
});

function createConstantModelProvider(
  id: string,
  text: string,
  requests: ModelRequest[]
): ConfiguredModelProvider {
  return {
    id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      requests.push(request);
      const userMessage = request.messages.find((message) => message.role === "user")?.content ?? "";
      return {
        text,
        usage: {
          inputTokens: userMessage.length,
          outputTokens: text.length,
          totalTokens: userMessage.length + text.length
        },
        costUsd: 0.0001
      };
    }
  };
}
