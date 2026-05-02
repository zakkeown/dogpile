import { describe, expect, it, vi } from "vitest";
import { generateModelTurn } from "./model.js";
import type { AgentSpec, ConfiguredModelProvider, ModelRequest, ReplayTraceProviderCall, RunEvent } from "../types.js";

const agent: AgentSpec = { id: "agent-1", role: "planner" };

const baseRequest: ModelRequest = {
  messages: [{ role: "user", content: "Hello" }],
  temperature: 0.2,
  metadata: { runId: "run-1", agentId: "agent-1", protocol: "sequential", role: "planner", tier: "balanced", turn: 1 }
};

function makeProvider(overrides: Partial<ConfiguredModelProvider> = {}): ConfiguredModelProvider {
  return {
    id: "test-provider",
    async generate() {
      return { text: "response text", usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } };
    },
    ...overrides
  };
}

describe("generateModelTurn", () => {
  it("emits model-request before the provider call with all provenance fields", async () => {
    const events: RunEvent[] = [];
    const provider = makeProvider();

    await generateModelTurn({
      model: provider,
      request: baseRequest,
      runId: "run-1",
      agent,
      input: "Hello",
      emit: (e) => events.push(e),
      callId: "run-1:provider-call:1"
    });

    const req = events.find((e) => e.type === "model-request");
    expect(req).toBeDefined();
    expect(req).toMatchObject({
      type: "model-request",
      runId: "run-1",
      callId: "run-1:provider-call:1",
      providerId: "test-provider",
      modelId: "test-provider",
      agentId: "agent-1",
      role: "planner"
    });
    expect(typeof (req as { startedAt: string }).startedAt).toBe("string");
  });

  it("emits model-response after the provider call with completedAt", async () => {
    const events: RunEvent[] = [];

    await generateModelTurn({
      model: makeProvider(),
      request: baseRequest,
      runId: "run-1",
      agent,
      input: "Hello",
      emit: (e) => events.push(e),
      callId: "run-1:provider-call:1"
    });

    const res = events.find((e) => e.type === "model-response");
    expect(res).toBeDefined();
    expect(res).toMatchObject({
      type: "model-response",
      runId: "run-1",
      callId: "run-1:provider-call:1",
      providerId: "test-provider",
      modelId: "test-provider",
      agentId: "agent-1",
      role: "planner"
    });
    expect(typeof (res as { startedAt: string }).startedAt).toBe("string");
    expect(typeof (res as { completedAt: string }).completedAt).toBe("string");
  });

  it("resolves modelId from provider.modelId when present", async () => {
    const events: RunEvent[] = [];
    const provider = makeProvider({ id: "provider-id", modelId: "explicit-model-id" });

    await generateModelTurn({
      model: provider,
      request: baseRequest,
      runId: "run-1",
      agent,
      input: "Hello",
      emit: (e) => events.push(e),
      callId: "run-1:provider-call:1"
    });

    const req = events.find((e) => e.type === "model-request") as { modelId: string; providerId: string } | undefined;
    expect(req?.modelId).toBe("explicit-model-id");
    expect(req?.providerId).toBe("provider-id");
  });

  it("falls back to provider.id when modelId is absent", async () => {
    const events: RunEvent[] = [];
    const provider = makeProvider({ id: "fallback-id" });

    await generateModelTurn({
      model: provider,
      request: baseRequest,
      runId: "run-1",
      agent,
      input: "Hello",
      emit: (e) => events.push(e),
      callId: "run-1:provider-call:1"
    });

    const req = events.find((e) => e.type === "model-request") as { modelId: string } | undefined;
    expect(req?.modelId).toBe("fallback-id");
  });

  it("emits model-request before model-response", async () => {
    const types: string[] = [];

    await generateModelTurn({
      model: makeProvider(),
      request: baseRequest,
      runId: "run-1",
      agent,
      input: "Hello",
      emit: (e) => types.push(e.type),
      callId: "run-1:provider-call:1"
    });

    const reqIdx = types.indexOf("model-request");
    const resIdx = types.indexOf("model-response");
    expect(reqIdx).toBeGreaterThanOrEqual(0);
    expect(resIdx).toBeGreaterThan(reqIdx);
  });

  it("invokes onProviderCall with ReplayTraceProviderCall shape", async () => {
    const calls: ReplayTraceProviderCall[] = [];
    const provider = makeProvider({ id: "prov", modelId: "my-model" });

    await generateModelTurn({
      model: provider,
      request: baseRequest,
      runId: "run-1",
      agent,
      input: "Hello",
      emit: () => {},
      callId: "run-1:provider-call:1",
      onProviderCall: (c) => calls.push(c)
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      kind: "replay-trace-provider-call",
      callId: "run-1:provider-call:1",
      providerId: "prov",
      modelId: "my-model",
      agentId: "agent-1",
      role: "planner"
    });
    expect(typeof calls[0]?.startedAt).toBe("string");
    expect(typeof calls[0]?.completedAt).toBe("string");
  });

  it("emits model-request and model-response for streaming provider", async () => {
    const events: RunEvent[] = [];
    const streamProvider = makeProvider({
      id: "stream-prov",
      modelId: "stream-model",
      generate: undefined as unknown as ConfiguredModelProvider["generate"],
      async *stream() {
        yield { text: "chunk1" };
        yield { text: "chunk2", usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 } };
      }
    });

    await generateModelTurn({
      model: streamProvider,
      request: baseRequest,
      runId: "run-2",
      agent,
      input: "stream test",
      emit: (e) => events.push(e),
      callId: "run-2:provider-call:1"
    });

    expect(events.some((e) => e.type === "model-request")).toBe(true);
    expect(events.some((e) => e.type === "model-response")).toBe(true);
    const req = events.find((e) => e.type === "model-request");
    const res = events.find((e) => e.type === "model-response");
    expect((req as { modelId: string } | undefined)?.modelId).toBe("stream-model");
    expect((res as { modelId: string } | undefined)?.modelId).toBe("stream-model");
  });

  it("callId matches across model-request and model-response events", async () => {
    const events: RunEvent[] = [];

    await generateModelTurn({
      model: makeProvider(),
      request: baseRequest,
      runId: "run-1",
      agent,
      input: "Hello",
      emit: (e) => events.push(e),
      callId: "run-1:provider-call:42"
    });

    const req = events.find((e) => e.type === "model-request") as { callId: string } | undefined;
    const res = events.find((e) => e.type === "model-response") as { callId: string } | undefined;
    expect(req?.callId).toBe("run-1:provider-call:42");
    expect(res?.callId).toBe("run-1:provider-call:42");
  });
});
