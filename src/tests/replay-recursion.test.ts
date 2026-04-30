import { describe, expect, it } from "vitest";
import { DogpileError, replay, run } from "../index.js";
import type {
  ConfiguredModelProvider,
  ModelRequest,
  ModelResponse,
  RunEvent,
  RunResult,
  Trace
} from "../index.js";

const PARTICIPATE_OUTPUT = [
  "role_selected: coordinator",
  "participation: contribute",
  "rationale: synthesize after sub-run",
  "contribution:",
  "synthesized after sub-run"
].join("\n");

function delegateBlock(payload: { protocol: string; intent: string }): string {
  return ["delegate:", "```json", JSON.stringify(payload), "```", ""].join("\n");
}

interface ScriptedProviderOptions {
  readonly id?: string;
  readonly planResponses: readonly string[];
}

/**
 * Scripted coordinator provider — plan-phase responses are returned in order;
 * worker and final-synthesis phases return a fixed safe text. Counts every
 * `generate` invocation so tests can assert "zero provider calls during replay".
 */
function createScriptedCoordinatorProvider(opts: ScriptedProviderOptions): ConfiguredModelProvider & {
  readonly invocationCount: () => number;
} {
  let planIndex = 0;
  let invocations = 0;
  const provider = {
    id: opts.id ?? "scripted-coordinator-model",
    async generate(request: ModelRequest): Promise<ModelResponse> {
      invocations += 1;
      const phase = String(request.metadata.phase);
      let text: string;
      if (phase === "plan") {
        text = opts.planResponses[planIndex] ?? PARTICIPATE_OUTPUT;
        planIndex += 1;
      } else if (phase === "worker") {
        text = "worker output";
      } else {
        text = "final output";
      }
      return {
        text,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        costUsd: 0
      };
    },
    invocationCount: () => invocations
  };
  return provider;
}

async function buildNestedParentTrace(): Promise<{
  readonly result: RunResult;
  readonly invocationsBeforeReplay: number;
  readonly provider: ReturnType<typeof createScriptedCoordinatorProvider>;
}> {
  const provider = createScriptedCoordinatorProvider({
    id: "replay-recursion-nested-parent",
    planResponses: [
      // Parent plan-1: delegate to sequential.
      delegateBlock({ protocol: "sequential", intent: "first child via sequential" }),
      // Parent plan-2: delegate to coordinator (which itself will delegate to broadcast).
      delegateBlock({ protocol: "coordinator", intent: "second child via nested coordinator" }),
      // Inner coordinator's plan: delegate to broadcast, then participate.
      delegateBlock({ protocol: "broadcast", intent: "grandchild via broadcast" }),
      PARTICIPATE_OUTPUT,
      // Parent plan-3: participate, ending the dispatch loop.
      PARTICIPATE_OUTPUT
    ]
  });

  const result = await run({
    intent: "Build a nested coordinator trace for replay verification.",
    protocol: { kind: "coordinator", maxTurns: 4 },
    tier: "fast",
    model: provider,
    agents: [
      { id: "lead", role: "coordinator" },
      { id: "worker-a", role: "worker" }
    ]
  });

  return { result, invocationsBeforeReplay: provider.invocationCount(), provider };
}

function cloneTrace(trace: Trace): Trace {
  return JSON.parse(JSON.stringify(trace)) as Trace;
}

type NumericField =
  | "cost.usd"
  | "cost.inputTokens"
  | "cost.outputTokens"
  | "cost.totalTokens"
  | "usage.usd"
  | "usage.inputTokens"
  | "usage.outputTokens"
  | "usage.totalTokens";

const ALL_NUMERIC_FIELDS: readonly NumericField[] = [
  "cost.usd",
  "cost.inputTokens",
  "cost.outputTokens",
  "cost.totalTokens",
  "usage.usd",
  "usage.inputTokens",
  "usage.outputTokens",
  "usage.totalTokens"
];

const PARENT_TAMPERABLE_FIELDS: readonly NumericField[] = [
  "cost.usd",
  "cost.inputTokens",
  "cost.outputTokens",
  "cost.totalTokens"
];

function mutateAccountingField(
  target: Record<string, Record<string, number>>,
  field: NumericField,
  delta: number
): { readonly recorded: number; readonly recomputed: number } {
  const [section, key] = field.split(".") as [string, string];
  const recorded = target[section]![key]!;
  target[section]![key] = recorded + delta;
  return { recorded: recorded + delta, recomputed: recorded };
}

describe("replay recursion + accounting recompute (D-08, D-10)", () => {
  it("replay reproduces output, accounting, and event sequence verbatim with zero provider invocations", async () => {
    const { result, invocationsBeforeReplay, provider } = await buildNestedParentTrace();

    // Confirm the trace really is nested (sub-run-completed at parent level
    // and inside an embedded child trace).
    const parentSubRuns = result.trace.events.filter((event) => event.type === "sub-run-completed");
    expect(parentSubRuns.length).toBeGreaterThanOrEqual(2);
    const innerCoordinator = parentSubRuns.find((event) => {
      if (event.type !== "sub-run-completed") return false;
      return event.subResult.trace.protocol === "coordinator";
    });
    expect(innerCoordinator?.type).toBe("sub-run-completed");
    if (innerCoordinator?.type !== "sub-run-completed") throw new Error("expected nested coordinator child");
    const grandchildSubRuns = innerCoordinator.subResult.trace.events.filter(
      (event) => event.type === "sub-run-completed"
    );
    expect(grandchildSubRuns.length).toBeGreaterThanOrEqual(1);

    // Replay the parent trace.
    const replayed = replay(result.trace);

    // Zero additional provider invocations during replay.
    expect(provider.invocationCount()).toBe(invocationsBeforeReplay);

    // Output, accounting, and event sequence preserved.
    expect(replayed.output).toBe(result.output);
    expect(replayed.accounting).toEqual(result.accounting);
    // D-09: parent event sequence emitted verbatim (no child-event bubbling).
    expect(replayed.trace.events).toEqual(result.trace.events);
    expect(replayed.trace.events.map((event: RunEvent) => event.type)).toEqual(
      result.trace.events.map((event) => event.type)
    );

    // JSON round-trip.
    const roundTripped = cloneTrace(result.trace);
    const replayedFromJson = replay(roundTripped);
    expect(replayedFromJson.output).toBe(result.output);
    expect(replayedFromJson.accounting).toEqual(result.accounting);
    // Still no provider calls.
    expect(provider.invocationCount()).toBe(invocationsBeforeReplay);
  });

  // Per-field child-tamper tests — one per enumerated numeric field.
  for (const field of ALL_NUMERIC_FIELDS) {
    it(`throws trace-accounting-mismatch when child subResult.accounting.${field} is tampered`, async () => {
      const { result } = await buildNestedParentTrace();
      const tampered = cloneTrace(result.trace);

      // Find the first sub-run-completed and mutate its recorded accounting.
      const childIndex = tampered.events.findIndex((event) => event.type === "sub-run-completed");
      expect(childIndex).toBeGreaterThanOrEqual(0);
      const childEvent = tampered.events[childIndex];
      if (childEvent?.type !== "sub-run-completed") throw new Error("expected sub-run-completed");
      const accounting = childEvent.subResult.accounting as unknown as Record<string, Record<string, number>>;
      const { recorded, recomputed } = mutateAccountingField(accounting, field, 9999);

      let thrown: unknown;
      try {
        replay(tampered);
      } catch (error) {
        thrown = error;
      }

      expect(DogpileError.isInstance(thrown)).toBe(true);
      if (!DogpileError.isInstance(thrown)) throw new Error("not a DogpileError");
      expect(thrown.code).toBe("invalid-configuration");
      expect(thrown.detail?.["reason"]).toBe("trace-accounting-mismatch");
      expect(thrown.detail?.["field"]).toBe(field);
      expect(thrown.detail?.["childRunId"]).toBe(childEvent.childRunId);
      expect(thrown.detail?.["eventIndex"]).toBe(childIndex);
      expect(thrown.detail?.["recorded"]).toBe(recorded);
      expect(thrown.detail?.["recomputed"]).toBe(recomputed);
    });
  }

  // Per-field parent-tamper tests — only `cost.*` fields are independently
  // tamperable on the parent (parent usage is derived from finalOutput.cost
  // at replay time and would track any cost mutation; the comparison vector
  // for the parent is `trace.finalOutput.cost` vs the cost on the last
  // cost-bearing event).
  for (const field of PARENT_TAMPERABLE_FIELDS) {
    it(`throws trace-accounting-mismatch when parent trace.finalOutput.cost.${field} is tampered`, async () => {
      const { result } = await buildNestedParentTrace();
      const tampered = cloneTrace(result.trace);

      const [, key] = field.split(".") as [string, string];
      const finalCost = tampered.finalOutput.cost as unknown as Record<string, number>;
      const original = finalCost[key]!;
      finalCost[key] = original + 17;

      let thrown: unknown;
      try {
        replay(tampered);
      } catch (error) {
        thrown = error;
      }

      expect(DogpileError.isInstance(thrown)).toBe(true);
      if (!DogpileError.isInstance(thrown)) throw new Error("not a DogpileError");
      expect(thrown.code).toBe("invalid-configuration");
      expect(thrown.detail?.["reason"]).toBe("trace-accounting-mismatch");
      expect(thrown.detail?.["eventIndex"]).toBe(-1);
      expect(thrown.detail?.["childRunId"]).toBe(tampered.runId);
      // Parent comparison runs in the documented field order; the first
      // differing cost field for a single-field tamper is exactly `field`.
      expect(thrown.detail?.["field"]).toBe(field);
    });
  }

  it("a clean JSON round-trip of a nested trace still validates via replay", async () => {
    const { result } = await buildNestedParentTrace();
    const reparsed = cloneTrace(result.trace);
    expect(() => replay(reparsed)).not.toThrow();
  });
});
