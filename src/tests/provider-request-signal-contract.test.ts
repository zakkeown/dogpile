import { describe, expect, it } from "vitest";
import { run } from "../index.js";
import type { AgentSpec, ConfiguredModelProvider, JsonObject, ModelRequest, ProtocolSelection } from "../index.js";

const intent = "Verify the active cancellation signal does not alter provider request payloads.";
const agents: readonly AgentSpec[] = [
  { id: "planner", role: "planner" },
  { id: "critic", role: "critic" }
];

describe("provider request signal contract", () => {
  it.each([
    ["sequential", { kind: "sequential", maxTurns: 2 }],
    ["broadcast", { kind: "broadcast", maxRounds: 1 }],
    ["shared", { kind: "shared", maxTurns: 2 }],
    ["coordinator", { kind: "coordinator", maxTurns: 2 }]
  ] as const)("carries the active AbortSignal through %s requests without changing payload semantics", async (name, protocol) => {
    const abortController = new AbortController();
    const withoutSignal = await captureProviderRequests(name, protocol);
    const withSignal = await captureProviderRequests(name, protocol, abortController.signal);

    expect(withSignal.requests.length).toBeGreaterThan(0);
    expect(withSignal.requests).toHaveLength(withoutSignal.requests.length);
    expect(withSignal.requests.map((request) => request.signal)).toEqual(
      withSignal.requests.map(() => abortController.signal)
    );
    expect(withoutSignal.requests.map((request) => request.signal)).toEqual(
      withoutSignal.requests.map(() => undefined)
    );
    expect(withSignal.requests.map(requestPayload)).toEqual(withoutSignal.requests.map(requestPayload));
    expect(withSignal.result.trace.providerCalls).toHaveLength(withSignal.requests.length);
    expect(withSignal.result.trace.providerCalls.map((call) => call.request.signal)).toEqual(
      withSignal.requests.map(() => undefined)
    );
    expect(JSON.parse(JSON.stringify(withSignal.result.trace))).toEqual(withSignal.result.trace);
  });
});

async function captureProviderRequests(
  name: string,
  protocol: ProtocolSelection,
  signal?: AbortSignal
): Promise<{
  readonly requests: readonly ModelRequest[];
  readonly result: Awaited<ReturnType<typeof run>>;
}> {
  const requests: ModelRequest[] = [];
  const model: ConfiguredModelProvider = {
    id: `signal-contract-${name}`,
    async generate(request: ModelRequest) {
      requests.push(request);
      return { text: `${name} response` };
    }
  };

  const result = await run({
    intent,
    protocol,
    tier: "fast",
    model,
    agents,
    ...(signal !== undefined ? { signal } : {})
  });

  return { requests, result };
}

function requestPayload(request: ModelRequest): Pick<ModelRequest, "messages" | "temperature"> & {
  readonly metadata: JsonObject;
} {
  return {
    messages: request.messages,
    temperature: request.temperature,
    metadata: normalizeRunMetadata(request.metadata)
  };
}

function normalizeRunMetadata(metadata: JsonObject): JsonObject {
  return {
    ...metadata,
    runId: "<run>"
  };
}
