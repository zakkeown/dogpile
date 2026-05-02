import { describe, expect, it } from "vitest";
import {
  type MetricsHook,
  type RunMetricsSnapshot
} from "./metrics.js";

describe("RunMetricsSnapshot structural type", () => {
  it("a complete snapshot satisfies the interface (compile-time)", () => {
    const snapshot: RunMetricsSnapshot = {
      outcome: "completed",
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
      totalInputTokens: 10,
      totalOutputTokens: 5,
      totalCostUsd: 0.001,
      turns: 2,
      durationMs: 1500
    };
    expect(typeof snapshot.outcome).toBe("string");
    expect(typeof snapshot.durationMs).toBe("number");
    expect(typeof snapshot.turns).toBe("number");
  });

  it("outcome accepts all three terminal values", () => {
    const outcomes: RunMetricsSnapshot["outcome"][] = [
      "completed",
      "budget-stopped",
      "aborted"
    ];
    expect(outcomes).toHaveLength(3);
  });
});

describe("MetricsHook structural type", () => {
  it("a MetricsHook with both callbacks satisfies the interface (compile-time)", () => {
    const hook: MetricsHook = {
      onRunComplete(_snapshot: RunMetricsSnapshot): void {},
      onSubRunComplete(_snapshot: RunMetricsSnapshot): void {}
    };
    expect(typeof hook.onRunComplete).toBe("function");
    expect(typeof hook.onSubRunComplete).toBe("function");
  });

  it("a MetricsHook with no callbacks satisfies the interface (compile-time)", () => {
    const hook: MetricsHook = {};
    expect(hook.onRunComplete).toBeUndefined();
    expect(hook.onSubRunComplete).toBeUndefined();
  });

  it("a MetricsHook with only onRunComplete satisfies the interface", () => {
    const hook: MetricsHook = {
      onRunComplete(_s: RunMetricsSnapshot): void {}
    };
    expect(typeof hook.onRunComplete).toBe("function");
    expect(hook.onSubRunComplete).toBeUndefined();
  });
});
