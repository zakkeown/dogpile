import { describe, expect, it } from "vitest";
import { run } from "../runtime/engine.js";
import type { ModelRequest, SubRunCompletedEvent, SubRunStartedEvent } from "../types.js";
import { createDelegatingDeterministicProvider } from "./deterministic-provider.js";

function coordinatorRequest(phase: "plan" | "worker" | "final-synthesis"): ModelRequest {
  return {
    messages: [{ role: "user", content: "anything" }],
    metadata: {
      phase,
      protocol: "coordinator",
      role: phase === "worker" ? "worker" : "coordinator",
      agentId: phase === "worker" ? "worker-a" : "lead"
    }
  };
}

describe("createDelegatingDeterministicProvider", () => {
  it("emits a delegate text block on the first plan phase and a participate block on the second", async () => {
    const provider = createDelegatingDeterministicProvider({ id: "phase-test" });

    const first = await provider.generate(coordinatorRequest("plan"));
    const second = await provider.generate(coordinatorRequest("plan"));

    expect(first.text).toContain("delegate:");
    expect(first.text).toContain("\"protocol\":\"sequential\"");
    expect(first.text).toContain("\"intent\":\"delegated child run\"");
    expect(second.text).not.toContain("delegate:");
    expect(second.text).toContain("participation: contribute");
  });

  it("returns deterministic text on worker and final-synthesis phases", async () => {
    const provider = createDelegatingDeterministicProvider();

    const worker = await provider.generate(coordinatorRequest("worker"));
    const final = await provider.generate(coordinatorRequest("final-synthesis"));

    expect(worker.text).toBe("worker output");
    expect(final.text).toBe("coordinator:lead synthesized the coordinator-managed mission.");
  });

  it("respects the childProtocol and childIntent options in the delegate block", async () => {
    const provider = createDelegatingDeterministicProvider({
      childProtocol: "broadcast",
      childIntent: "inspect sibling outputs"
    });

    const first = await provider.generate(coordinatorRequest("plan"));

    expect(first.text).toContain("delegate:");
    expect(first.text).toContain("\"protocol\":\"broadcast\"");
    expect(first.text).toContain("\"intent\":\"inspect sibling outputs\"");
  });

  it("drives a live coordinator sub-run dispatch with paired sub-run lifecycle events", async () => {
    const result = await run({
      intent: "verify delegating provider drives sub-run dispatch",
      protocol: { kind: "coordinator", maxTurns: 4 },
      tier: "fast",
      model: createDelegatingDeterministicProvider(),
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });

    const started = result.trace.events.filter(
      (event): event is SubRunStartedEvent => event.type === "sub-run-started"
    );
    const completed = result.trace.events.filter(
      (event): event is SubRunCompletedEvent => event.type === "sub-run-completed"
    );

    expect(started.length).toBeGreaterThanOrEqual(1);
    expect(completed.length).toBeGreaterThanOrEqual(1);

    const completedIds = new Set(completed.map((event) => event.childRunId));
    for (const event of started) {
      expect(completedIds.has(event.childRunId)).toBe(true);
    }
  });
});
