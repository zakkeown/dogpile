import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DogpileError, replay, run, stream } from "../index.js";
import type {
  ConfiguredModelProvider,
  DogpileError as DogpileErrorUnion,
  DogpileErrorCode,
  ModelRequest,
  RunEvent,
  Trace
} from "../index.js";

const documentedDogpileErrorCodes = [
  "invalid-configuration",
  "aborted",
  "timeout",
  "provider-authentication",
  "provider-invalid-request",
  "provider-invalid-response",
  "provider-not-found",
  "provider-rate-limited",
  "provider-timeout",
  "provider-unavailable",
  "provider-unsupported",
  "provider-error",
  "unknown"
] as const satisfies readonly DogpileErrorCode[];

type DocumentedDogpileErrorCode = (typeof documentedDogpileErrorCodes)[number];
type UndocumentedDogpileErrorCode = Exclude<DogpileErrorCode, DocumentedDogpileErrorCode>;

describe("public DogpileError API", () => {
  it("documents every exported DogpileError code in the reference handling table", () => {
    expectNoUndocumentedDogpileErrorCodes(true);

    const reference = readFileSync(new URL("../../docs/reference.md", import.meta.url), "utf8");
    expect(reference).toContain("## DogpileError Codes");

    for (const code of documentedDogpileErrorCodes) {
      expect(reference).toContain(`| \`${code}\` |`);
    }
  });

  it("constructs stable coded errors and exposes them as the typed public union", () => {
    const error = new DogpileError({
      code: "provider-rate-limited",
      message: "Provider quota was exceeded.",
      retryable: true,
      providerId: "vercel-ai:test",
      detail: {
        statusCode: 429
      }
    });

    const publicError: DogpileErrorUnion = error;

    expect(error).toBeInstanceOf(DogpileError);
    expect(DogpileError.isInstance(error)).toBe(true);
    expect(publicError.code).toBe("provider-rate-limited");
    expect(error.toJSON()).toEqual({
      name: "DogpileError",
      code: "provider-rate-limited",
      message: "Provider quota was exceeded.",
      retryable: true,
      providerId: "vercel-ai:test",
      detail: {
        statusCode: 429
      }
    });
    expect(classifyDogpileError(publicError)).toBe("retryable-provider");
  });

  it("locks the BUDGET-01 detail.reason vocabulary on code: aborted errors", () => {
    // BUDGET-01 / D-08: aborted errors carry `detail.reason: "parent-aborted"`
    // when the parent.signal aborted (BUDGET-01 lands "parent-aborted"; the
    // "timeout" half lands in BUDGET-02). Vocabulary is documented-convention
    // (no exported string-literal type union) but is observable through
    // `error.detail.reason` on the public error surface.
    const error = new DogpileError({
      code: "aborted",
      message: "The operation was aborted.",
      retryable: false,
      providerId: "budget-01-detail-reason-lock",
      detail: {
        reason: "parent-aborted"
      }
    });
    expect(error.code).toBe("aborted");
    expect(error.detail).toEqual({ reason: "parent-aborted" });
    expect(error.toJSON()).toEqual({
      name: "DogpileError",
      code: "aborted",
      message: "The operation was aborted.",
      retryable: false,
      providerId: "budget-01-detail-reason-lock",
      detail: {
        reason: "parent-aborted"
      }
    });
  });

  it("locks the BUDGET-02 detail.reason vocabulary on code: aborted errors (timeout)", () => {
    // BUDGET-02 / D-12: parent timeouts surface on the child as
    // `code: "aborted"` with `detail.reason: "timeout"`. This pairs with the
    // BUDGET-01 `parent-aborted` lock above to fully cover the documented
    // vocabulary on aborted errors.
    const error = new DogpileError({
      code: "aborted",
      message: "Parent deadline elapsed before sub-run dispatch.",
      retryable: false,
      providerId: "budget-02-detail-reason-lock",
      detail: {
        reason: "timeout"
      }
    });
    expect(error.code).toBe("aborted");
    expect(error.detail).toEqual({ reason: "timeout" });
    expect(error.toJSON()).toEqual({
      name: "DogpileError",
      code: "aborted",
      message: "Parent deadline elapsed before sub-run dispatch.",
      retryable: false,
      providerId: "budget-02-detail-reason-lock",
      detail: {
        reason: "timeout"
      }
    });
  });

  it("guards cross-realm error-shaped values with the stable code set", () => {
    expect(
      DogpileError.isInstance({
        name: "DogpileError",
        code: "timeout",
        message: "Timed out."
      })
    ).toBe(true);

    expect(
      DogpileError.isInstance({
        name: "DogpileError",
        code: "provider-overloaded",
        message: "Not part of the v1 code contract."
      })
    ).toBe(false);
  });

  it("success path with final synthesis does not re-throw handled child failures", async () => {
    const provider = createThrowMatrixProvider({
      firstPlan: delegateBlock([
        { protocol: "sequential", intent: "fail first child" },
        { protocol: "sequential", intent: "fail second child" }
      ]),
      followUpPlan: participateBlock("handled child failures"),
      finalResponse: "final synthesis succeeded",
      failures: {
        "fail first child": new DogpileError({
          code: "provider-timeout",
          message: "F1 exploded",
          providerId: "throw-matrix-provider",
          detail: { source: "provider", marker: "F1" }
        }),
        "fail second child": new DogpileError({
          code: "provider-timeout",
          message: "F2 exploded",
          providerId: "throw-matrix-provider",
          detail: { source: "provider", marker: "F2" }
        })
      }
    });

    const result = await run({
      intent: "success path handles failures",
      protocol: { kind: "coordinator", maxTurns: 1 },
      tier: "fast",
      model: provider
    });

    expect(result.output).toBe("final synthesis succeeded");
    expect(result.trace.events.some((event) => event.type === "sub-run-failed")).toBe(true);
  });

  it("last real failure is re-thrown with runtime instance identity", async () => {
    const firstError = new DogpileError({
      code: "provider-timeout",
      message: "F1 exploded",
      providerId: "throw-matrix-provider",
      detail: { source: "provider", marker: "F1" }
    });
    const secondError = new DogpileError({
      code: "provider-timeout",
      message: "F2 exploded",
      providerId: "throw-matrix-provider",
      detail: { source: "provider", marker: "F2" }
    });
    const provider = createThrowMatrixProvider({
      firstPlan: delegateBlock([
        { protocol: "sequential", intent: "fail first child" },
        { protocol: "sequential", intent: "fail second child" },
        { protocol: "sequential", intent: "queued synthetic child" }
      ]),
      followUpPlan: participateBlock("budget terminal"),
      finalResponse: "should not surface",
      failures: {
        "fail first child": firstError,
        "fail second child": secondError
      }
    });

    await expect(run({
      intent: "last real failure budget path",
      protocol: { kind: "coordinator", maxTurns: 1 },
      tier: "fast",
      model: provider,
      budget: { maxIterations: 1 },
      maxConcurrentChildren: 2
    })).rejects.toBe(secondError);
  });

  it("onChildFailure abort re-throws the triggering F1 failure instead of later failures", async () => {
    const firstError = new DogpileError({
      code: "provider-timeout",
      message: "F1 triggered abort",
      providerId: "throw-matrix-provider",
      detail: { source: "provider", marker: "F1" }
    });
    const secondError = new DogpileError({
      code: "provider-timeout",
      message: "F2 finished later",
      providerId: "throw-matrix-provider",
      detail: { source: "provider", marker: "F2" }
    });
    const provider = createThrowMatrixProvider({
      firstPlan: delegateBlock([
        { protocol: "sequential", intent: "fail first child" },
        { protocol: "sequential", intent: "fail second child" }
      ]),
      followUpPlan: participateBlock("should not be requested"),
      finalResponse: "should not surface",
      failures: {
        "fail first child": firstError,
        "fail second child": secondError
      }
    });

    await expect(run({
      intent: "abort triggering failure path",
      protocol: { kind: "coordinator", maxTurns: 1 },
      tier: "fast",
      model: provider,
      onChildFailure: "abort"
    })).rejects.toBe(firstError);
  });

  it("replay reconstructs the last real failure payload as a fresh DogpileError instance", async () => {
    const secondError = new DogpileError({
      code: "provider-timeout",
      message: "F2 exploded",
      providerId: "throw-matrix-provider",
      detail: { source: "provider", marker: "F2" }
    });
    const provider = createThrowMatrixProvider({
      firstPlan: delegateBlock([
        { protocol: "sequential", intent: "fail first child" },
        { protocol: "sequential", intent: "fail second child" }
      ]),
      followUpPlan: participateBlock("handled for trace capture"),
      finalResponse: "trace captured",
      failures: {
        "fail first child": new DogpileError({
          code: "provider-timeout",
          message: "F1 exploded",
          providerId: "throw-matrix-provider",
          detail: { source: "provider", marker: "F1" }
        }),
        "fail second child": secondError
      }
    });
    const result = await run({
      intent: "capture failure trace",
      protocol: { kind: "coordinator", maxTurns: 1 },
      tier: "fast",
      model: provider
    });
    const terminalTrace = traceWithBudgetTermination(result.trace);

    let replayError: unknown;
    try {
      replay(terminalTrace);
    } catch (error) {
      replayError = error;
    }

    expect(replayError).toBeInstanceOf(DogpileError);
    expect(replayError).not.toBe(secondError);
    expect(replayError).toMatchObject({
      code: secondError.code,
      providerId: secondError.providerId,
      message: secondError.message,
      detail: secondError.detail
    });
  });

  it("cancel-wins throws the cancel error verbatim", async () => {
    const provider: ConfiguredModelProvider = {
      id: "cancel-wins-provider",
      async generate(request) {
        if (request.metadata?.phase === "plan") {
          return {
            text: delegateBlock({ protocol: "sequential", intent: "wait for cancel" })
          };
        }
        await new Promise<never>((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => {
            reject(request.signal?.reason);
          }, { once: true });
        });
        throw new Error("expected cancellation to reject the provider request");
      }
    };

    const handle = stream({
      intent: "cancel wins over child failure",
      protocol: { kind: "coordinator", maxTurns: 1 },
      tier: "fast",
      model: provider
    });
    handle.cancel();

    await expect(handle.result).rejects.toMatchObject({
      code: "aborted",
      detail: {
        status: "cancelled",
        reason: "parent-aborted"
      }
    });
  });

  it("depth overflow throws the depth-overflow error verbatim", async () => {
    const provider = createThrowMatrixProvider({
      firstPlan: delegateBlock({ protocol: "sequential", intent: "too deep" }),
      followUpPlan: participateBlock("unused"),
      finalResponse: "unused",
      failures: {}
    });

    await expect(run({
      intent: "depth overflow verbatim",
      protocol: { kind: "coordinator", maxTurns: 1 },
      tier: "fast",
      model: provider,
      maxDepth: 0
    })).rejects.toMatchObject({
      code: "invalid-configuration",
      detail: {
        kind: "delegate-validation",
        reason: "depth-overflow"
      }
    });
  });

  it("degenerate plan turn with no real failures keeps the existing fallback behavior", async () => {
    const provider: ConfiguredModelProvider = {
      id: "degenerate-no-failure-provider",
      async generate(request) {
        if (request.metadata?.phase === "final-synthesis") {
          return { text: "degenerate fallback final" };
        }
        return { text: "not a parseable decision" };
      }
    };

    const result = await run({
      intent: "degenerate no failure",
      protocol: { kind: "coordinator", maxTurns: 1 },
      tier: "fast",
      model: provider
    });

    expect(result.output).toBe("degenerate fallback final");
  });
});

function classifyDogpileError(error: DogpileErrorUnion): "caller-cancelled" | "retryable-provider" | "other" {
  switch (error.code) {
    case "invalid-configuration":
      return "other";
    case "aborted":
      return "caller-cancelled";
    case "provider-rate-limited":
    case "provider-timeout":
    case "provider-unavailable":
      return "retryable-provider";
    case "timeout":
    case "provider-authentication":
    case "provider-invalid-request":
    case "provider-invalid-response":
    case "provider-not-found":
    case "provider-unsupported":
    case "provider-error":
    case "unknown":
      return "other";
  }

  const exhaustive: never = error;
  return exhaustive;
}

function expectNoUndocumentedDogpileErrorCodes(value: UndocumentedDogpileErrorCode extends never ? true : never): void {
  expect(value).toBe(true);
}

function delegateBlock(payload: unknown): string {
  return ["delegate:", "```json", JSON.stringify(payload), "```", ""].join("\n");
}

function participateBlock(output: string): string {
  return [
    "selectedRole: coordinator",
    "participation: active",
    "rationale: failure handled",
    `contribution: ${output}`
  ].join("\n");
}

function createThrowMatrixProvider(opts: {
  readonly firstPlan: string;
  readonly followUpPlan: string;
  readonly finalResponse: string;
  readonly failures: Readonly<Record<string, DogpileErrorUnion>>;
}): ConfiguredModelProvider {
  let parentPlanCalls = 0;
  return {
    id: "throw-matrix-provider",
    async generate(request: ModelRequest) {
      const phase = request.metadata?.phase;
      const prompt = request.messages.map((message) => message.content).join("\n");
      const failure = Object.entries(opts.failures).find(([intent]) => prompt.includes(`Mission: ${intent}`))?.[1];
      if (phase !== "plan" && phase !== "final-synthesis" && failure) {
        throw failure;
      }
      if (phase === "plan") {
        parentPlanCalls += 1;
        return { text: parentPlanCalls === 1 ? opts.firstPlan : opts.followUpPlan };
      }
      if (phase === "final-synthesis") {
        return { text: opts.finalResponse };
      }
      return { text: "worker output" };
    }
  };
}

function traceWithBudgetTermination(trace: Trace): Trace {
  const events = trace.events.map((event, index): RunEvent => {
    if (index !== trace.events.length - 1 || event.type !== "final") {
      return event;
    }
    return {
      ...event,
      termination: {
        kind: "termination-stop",
        rootCondition: { kind: "budget", maxIterations: 1 },
        firedCondition: { kind: "budget", maxIterations: 1 },
        reason: "budget",
        normalizedReason: "budget:iterations",
        budgetReason: "iterations"
      }
    };
  });
  const finalEvent = events.at(-1);
  if (finalEvent?.type !== "final") {
    throw new Error("expected trace to end in final");
  }
  return {
    ...trace,
    events,
    finalOutput: {
      ...trace.finalOutput,
      output: finalEvent.output,
      cost: finalEvent.cost,
      transcript: finalEvent.transcript
    }
  };
}
