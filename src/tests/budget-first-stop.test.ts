import { describe, expect, it } from "vitest";
import { run } from "../index.js";
import type { ConfiguredModelProvider, ModelRequest, ModelResponse, ProtocolConfig } from "../index.js";

describe("budget-first stop behavior", () => {
  it.each([
    ["coordinator", { kind: "coordinator", maxTurns: 3 }],
    ["sequential", { kind: "sequential", maxTurns: 3 }],
    ["broadcast", { kind: "broadcast", maxRounds: 1 }],
    ["shared", { kind: "shared", maxTurns: 3 }]
  ] as const)("halts %s before spending a model turn when the budget is already exhausted", async (_name, protocol) => {
    const requests: ModelRequest[] = [];
    const model: ConfiguredModelProvider = {
      id: "budget-first-stop-model",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        requests.push(request);
        return {
          text: "this response should never be generated",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2
          },
          costUsd: 0.001
        };
      }
    };

    const result = await run({
      intent: "Do not spend model budget when the cap is already exhausted.",
      protocol: protocol as ProtocolConfig,
      tier: "fast",
      budget: { maxIterations: 0 },
      model
    });

    expect(requests).toHaveLength(0);
    expect(result.output).toBe("");
    expect(result.transcript).toHaveLength(0);
    expect(result.cost).toEqual({
      usd: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    });
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "budget-stop",
      "final"
    ]);

    const stopEvent = result.trace.events.find((event) => event.type === "budget-stop");
    expect(stopEvent).toMatchObject({
      type: "budget-stop",
      reason: "iterations",
      iteration: 0,
      cost: {
        usd: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      },
      detail: {
        cap: "maxIterations",
        limit: 0,
        observed: 0
      }
    });

    const finalEvent = result.trace.events.at(-1);
    expect(finalEvent?.type).toBe("final");
    if (finalEvent?.type !== "final") {
      throw new Error("expected final event");
    }
    expect(finalEvent.termination).toMatchObject({
      kind: "termination-stop",
      firedCondition: { kind: "budget", maxIterations: 0 },
      reason: "budget",
      normalizedReason: "budget:iterations",
      budgetReason: "iterations",
      detail: {
        cap: "maxIterations",
        limit: 0,
        observed: 0
      }
    });
  });
});
