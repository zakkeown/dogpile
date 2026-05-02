import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { replay, run, stream } from "../runtime/engine.js";
import type { Logger } from "../runtime/logger.js";
import type { RunMetricsSnapshot } from "../runtime/metrics.js";
import {
  createDelegatingDeterministicProvider,
  createDeterministicModelProvider
} from "../testing/deterministic-provider.js";
import type { ConfiguredModelProvider, ModelRequest, ModelResponse } from "../types.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixturePath = join(repoRoot, "src/tests/fixtures/metrics-snapshot-v1.json");
const requiredSnapshotFields = [
  "outcome",
  "inputTokens",
  "outputTokens",
  "costUsd",
  "totalInputTokens",
  "totalOutputTokens",
  "totalCostUsd",
  "turns",
  "durationMs"
] as const;

describe("MetricsHook public contract (METR-01)", () => {
  it("calls onRunComplete with outcome=completed and numeric counters", async () => {
    const snapshots: RunMetricsSnapshot[] = [];

    const result = await run({
      intent: "Collect metrics for a completed run.",
      model: createDeterministicModelProvider("metrics-contract-completed"),
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      metricsHook: {
        onRunComplete(snapshot): void {
          snapshots.push(snapshot);
        }
      }
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      outcome: "completed",
      inputTokens: result.cost.inputTokens,
      outputTokens: result.cost.outputTokens,
      costUsd: result.cost.usd,
      totalInputTokens: result.cost.inputTokens,
      totalOutputTokens: result.cost.outputTokens,
      totalCostUsd: result.cost.usd,
      turns: result.trace.events.filter((event) => event.type === "agent-turn").length
    });
    expect(snapshots[0]!.durationMs).toBeTypeOf("number");
    expect(snapshots[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("calls onSubRunComplete for coordinator-dispatched child runs", async () => {
    const subRunSnapshots: RunMetricsSnapshot[] = [];

    const result = await run({
      intent: "Collect metrics for a delegated child run.",
      model: createDelegatingDeterministicProvider({ id: "metrics-contract-sub-run" }),
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      metricsHook: {
        onSubRunComplete(snapshot): void {
          subRunSnapshots.push(snapshot);
        }
      }
    });

    const completedSubRuns = result.trace.events.filter(
      (event): event is Extract<typeof event, { readonly type: "sub-run-completed" }> =>
        event.type === "sub-run-completed"
    );

    expect(completedSubRuns.length).toBeGreaterThanOrEqual(1);
    expect(subRunSnapshots).toHaveLength(completedSubRuns.length);
    expect(subRunSnapshots[0]).toMatchObject({
      outcome: "completed",
      totalInputTokens: completedSubRuns[0]!.subResult.cost.inputTokens,
      totalOutputTokens: completedSubRuns[0]!.subResult.cost.outputTokens,
      totalCostUsd: completedSubRuns[0]!.subResult.cost.usd,
      turns: completedSubRuns[0]!.subResult.trace.events.filter((event) => event.type === "agent-turn").length
    });
    expect(subRunSnapshots[0]!.durationMs).toBeTypeOf("number");
  });

  it("leaves the RunResult shape unchanged with and without metricsHook", async () => {
    const withoutHook = await run({
      intent: "Result shape without a metrics hook.",
      model: createDeterministicModelProvider("metrics-contract-without-hook"),
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast"
    });
    const withHook = await run({
      intent: "Result shape with a metrics hook.",
      model: createDeterministicModelProvider("metrics-contract-with-hook"),
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      metricsHook: {
        onRunComplete(): void {}
      }
    });

    expect(withoutHook.trace.runId).toBeTypeOf("string");
    expect(withoutHook.health).toBeDefined();
    expect(Object.keys(withHook).sort()).toEqual(Object.keys(withoutHook).sort());
  });

  it("calls onRunComplete with outcome=budget-stopped when budget terminates the run", async () => {
    const snapshots: RunMetricsSnapshot[] = [];

    await run({
      intent: "Stop before spending model budget.",
      model: createDeterministicModelProvider("metrics-contract-budget"),
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      budget: { maxIterations: 0 },
      metricsHook: {
        onRunComplete(snapshot): void {
          snapshots.push(snapshot);
        }
      }
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      outcome: "budget-stopped",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      turns: 0
    });
  });

  it("calls onRunComplete with outcome=aborted when a streaming run is cancelled", async () => {
    const snapshots: RunMetricsSnapshot[] = [];
    const requestReceived = createDeferred<ModelRequest>();
    const providerFinished = createDeferred<void>();
    const model: ConfiguredModelProvider = {
      id: "metrics-contract-cancelled",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        requestReceived.resolve(request);
        await waitForAbort(request.signal);
        providerFinished.resolve();
        throw new Error("provider observed cancellation");
      }
    };

    const handle = stream({
      intent: "Cancel a streaming metrics run.",
      model,
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      metricsHook: {
        onRunComplete(snapshot): void {
          snapshots.push(snapshot);
        }
      }
    });

    await requestReceived.promise;
    handle.cancel();
    await expect(handle.result).rejects.toMatchObject({ code: "aborted" });
    await providerFinished.promise;
    await waitForCondition(() => snapshots.length === 1);

    expect(snapshots[0]).toMatchObject({
      outcome: "aborted",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      turns: 0
    });
  });
});

describe("MetricsHook replay exclusion (METR-02)", () => {
  it("does not fire metricsHook when replay() is called on a completed trace", async () => {
    let callCount = 0;
    const result = await run({
      intent: "replay metrics exclusion guard",
      model: createDeterministicModelProvider("replay-metrics-exclusion"),
      protocol: { kind: "sequential", maxTurns: 1 },
      metricsHook: {
        onRunComplete(): void {
          callCount++;
        }
      }
    });

    // Live run must have fired the hook exactly once.
    expect(callCount).toBe(1);

    // replay() is a standalone function; it does not accept engine options and
    // must not fire any metricsHook callback.
    replay(result.trace);
    expect(callCount).toBe(1);
  });
});

describe("MetricsHook error isolation (METR-02)", () => {
  it("swallows a synchronously throwing hook without propagating to the run result", async () => {
    let hookFired = false;

    const result = await run({
      intent: "Swallow synchronous metrics hook errors.",
      model: createDeterministicModelProvider("metrics-contract-sync-throw"),
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      logger: noopTestLogger(),
      metricsHook: {
        onRunComplete(): void {
          hookFired = true;
          throw new Error("sync hook failed");
        }
      }
    });

    expect(hookFired).toBe(true);
    expect(result.trace.runId).toBeTypeOf("string");
  });

  it("routes synchronous hook errors to logger.error and completes normally", async () => {
    const errorSpy = vi.fn();
    const logger = testLoggerWithErrorSpy(errorSpy);

    const result = await run({
      intent: "Route metrics hook errors to a caller logger.",
      model: createDeterministicModelProvider("metrics-contract-logger-route"),
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      logger,
      metricsHook: {
        onRunComplete(): void {
          throw new Error("sync hook route");
        }
      }
    });

    expect(result.trace.runId).toBeTypeOf("string");
    expect(errorSpy).toHaveBeenCalledWith("dogpile:metricsHook threw", { error: "sync hook route" });
  });

  it("swallows an async-rejecting hook without propagating to the run result", async () => {
    const errorSpy = vi.fn();
    const logger = testLoggerWithErrorSpy(errorSpy);

    const result = await run({
      intent: "Swallow asynchronous metrics hook errors.",
      model: createDeterministicModelProvider("metrics-contract-async-throw"),
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      logger,
      metricsHook: {
        async onRunComplete(): Promise<void> {
          await Promise.resolve();
          throw new Error("async hook failed");
        }
      }
    });

    expect(result.trace.runId).toBeTypeOf("string");
    await waitForCondition(() => errorSpy.mock.calls.length === 1);
    expect(errorSpy).toHaveBeenCalledWith("dogpile:metricsHook threw", { error: "async hook failed" });
  });
});

describe("metrics-snapshot-v1.json fixture", () => {
  it("freezes the 9-field RunMetricsSnapshot shape", async () => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;

    expect(Object.keys(fixture)).toEqual(requiredSnapshotFields);
    expect(fixture["outcome"]).toBe("completed");
    for (const field of requiredSnapshotFields.filter((field) => field !== "outcome")) {
      expect(fixture[field]).toBeTypeOf("number");
      expect(fixture[field]).toBeGreaterThan(0);
    }
  });
});

function noopTestLogger(): Logger {
  return {
    debug(): void {},
    info(): void {},
    warn(): void {},
    error(): void {}
  };
}

function testLoggerWithErrorSpy(errorSpy: (message: string, fields?: Parameters<Logger["error"]>[1]) => void): Logger {
  return {
    debug(): void {},
    info(): void {},
    warn(): void {},
    error(message, fields): void {
      errorSpy(message, fields);
    }
  };
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}
