import { describe, expect, it } from "vitest";
import { createDeterministicModelProvider } from "../internal.js";
import { replay, replayStream, run } from "../index.js";
import type { AgentSpec, DogpileOptions, ProtocolConfig, RunEvent, StreamEvent, Trace } from "../index.js";

describe("temperature zero stable ordering", () => {
  const shuffledAgents: readonly AgentSpec[] = [
    { id: "agent-3", role: "synthesizer", instructions: "Third by stable id." },
    { id: "agent-1", role: "planner", instructions: "First by stable id." },
    { id: "agent-2", role: "critic", instructions: "Second by stable id." }
  ];
  const reverseShuffledAgents: readonly AgentSpec[] = [
    { id: "agent-2", role: "critic", instructions: "Second by stable id." },
    { id: "agent-3", role: "synthesizer", instructions: "Third by stable id." },
    { id: "agent-1", role: "planner", instructions: "First by stable id." }
  ];

  const cases: readonly {
    readonly name: string;
    readonly protocol: ProtocolConfig;
    readonly expectedTranscriptAgents: readonly string[];
  }[] = [
    {
      name: "sequential",
      protocol: { kind: "sequential", maxTurns: 3 },
      expectedTranscriptAgents: ["agent-1", "agent-2", "agent-3"]
    },
    {
      name: "broadcast",
      protocol: { kind: "broadcast", maxRounds: 1 },
      expectedTranscriptAgents: ["agent-1", "agent-2", "agent-3"]
    },
    {
      name: "shared",
      protocol: { kind: "shared", maxTurns: 3 },
      expectedTranscriptAgents: ["agent-1", "agent-2", "agent-3"]
    },
    {
      name: "coordinator",
      protocol: { kind: "coordinator", maxTurns: 3 },
      expectedTranscriptAgents: ["agent-1", "agent-2", "agent-3", "agent-1"]
    }
  ];

  it.each(cases)(
    "orders agents, protocol decisions, events, and transcript entries for $name at temperature=0",
    async ({ name, protocol, expectedTranscriptAgents }) => {
      const result = await run({
        intent: `Verify deterministic ordering for ${name}.`,
        protocol,
        tier: "balanced",
        temperature: 0,
        model: createDeterministicModelProvider(`deterministic-${name}-ordering-model`),
        agents: shuffledAgents
      });

      expect(result.trace.inputs.temperature).toBe(0);
      expect(result.trace.agentsUsed.map((agent) => agent.id)).toEqual(["agent-1", "agent-2", "agent-3"]);

      const roleAssignmentAgents = result.trace.events
        .filter((event): event is Extract<RunEvent, { readonly type: "role-assignment" }> => {
          return event.type === "role-assignment";
        })
        .map((event) => event.agentId);
      expect(roleAssignmentAgents).toEqual(["agent-1", "agent-2", "agent-3"]);

      const turnAgents = result.trace.events
        .filter((event): event is Extract<RunEvent, { readonly type: "agent-turn" }> => {
          return event.type === "agent-turn";
        })
        .map((event) => event.agentId);
      expect(turnAgents).toEqual(expectedTranscriptAgents);
      expect(result.transcript.map((entry) => entry.agentId)).toEqual(expectedTranscriptAgents);
      expect(result.trace.transcript).toEqual(result.transcript);

      expect(result.eventLog.eventTypes).toEqual(result.trace.events.map((event) => event.type));
      expect(result.trace.protocolDecisions.map((decision) => decision.eventIndex)).toEqual(
        result.trace.events.map((_, index) => index)
      );
      expect(result.trace.protocolDecisions.map((decision) => decision.eventType)).toEqual(
        result.trace.events.map((event) => event.type)
      );

      const broadcastEvent = result.trace.events.find((event) => event.type === "broadcast");
      if (broadcastEvent?.type === "broadcast") {
        expect(broadcastEvent.contributions.map((contribution) => contribution.agentId)).toEqual([
          "agent-1",
          "agent-2",
          "agent-3"
        ]);
      }
    }
  );

  it.each(cases)(
    "serializes $name trace artifacts with deterministic key order and normalized JSON values at temperature=0",
    async ({ name, protocol }) => {
      const result = await run({
        intent: `Verify deterministic serialization for ${name}.`,
        protocol,
        tier: "balanced",
        temperature: 0,
        model: createDeterministicModelProvider(`deterministic-${name}-serialization-model`),
        agents: shuffledAgents
      });

      expectStableJsonArtifact(result.trace);
      expectStableJsonArtifact(result.trace.events);
      expectStableJsonArtifact(result.eventLog);
      expectStableJsonArtifact(result.transcript);
      expectStableJsonArtifact(result.metadata);

      expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
      expect(JSON.parse(JSON.stringify(result.eventLog))).toEqual(result.eventLog);
      expect(JSON.parse(JSON.stringify(result.transcript))).toEqual(result.transcript);
      expect(JSON.parse(JSON.stringify(result.metadata))).toEqual(result.metadata);
    }
  );

  it.each(cases)(
    "routes $name temperature=0 decisions through seed-stable agent selection independent of insertion order",
    async ({ name, protocol }) => {
      const first = await run({
        intent: `Verify seeded deterministic selection for ${name}.`,
        protocol,
        tier: "balanced",
        temperature: 0,
        seed: "seeded-selection-contract",
        model: createDeterministicModelProvider(`seeded-${name}-first-ordering-model`),
        agents: shuffledAgents
      });
      const second = await run({
        intent: `Verify seeded deterministic selection for ${name}.`,
        protocol,
        tier: "balanced",
        temperature: 0,
        seed: "seeded-selection-contract",
        model: createDeterministicModelProvider(`seeded-${name}-second-ordering-model`),
        agents: reverseShuffledAgents
      });

      expect(first.trace.seed).toEqual({
        kind: "replay-trace-seed",
        source: "caller",
        value: "seeded-selection-contract"
      });
      expect(second.trace.seed).toEqual(first.trace.seed);

      const firstAgentOrder = first.trace.agentsUsed.map((agent) => agent.id);
      const secondAgentOrder = second.trace.agentsUsed.map((agent) => agent.id);
      expect(secondAgentOrder).toEqual(firstAgentOrder);
      expect(firstAgentOrder).not.toEqual(shuffledAgents.map((agent) => agent.id));
      expect(firstAgentOrder).not.toEqual(reverseShuffledAgents.map((agent) => agent.id));

      expect(first.transcript.map((entry) => entry.agentId)).toEqual(second.transcript.map((entry) => entry.agentId));
      expect(first.trace.protocolDecisions.map(decisionAgentScope)).toEqual(
        second.trace.protocolDecisions.map(decisionAgentScope)
      );
    }
  );

  it.each(cases)(
    "produces equivalent $name traces across repeated temperature=0 runs with the same inputs",
    async ({ name, protocol }) => {
      const options: DogpileOptions = {
        intent: `Verify repeated deterministic trace equivalence for ${name}.`,
        protocol,
        tier: "balanced",
        temperature: 0,
        seed: "repeated-trace-equivalence",
        model: createDeterministicModelProvider(`deterministic-${name}-repeated-trace-model`),
        agents: shuffledAgents
      };

      const traces = await Promise.all(
        Array.from({ length: 5 }, async () => {
          const result = await run(options);
          return normalizeTraceForEquivalence(result.trace);
        })
      );
      const [baseline, ...repeated] = traces;

      expect(baseline).toBeDefined();
      for (const trace of repeated) {
        expect(trace).toEqual(baseline);
      }
    }
  );

  it.each(cases)(
    "replays a persisted $name temperature=0 trace to the same final output, event log, and transcript",
    async ({ name, protocol }) => {
      const original = await run({
        intent: `Verify persisted trace replay for ${name}.`,
        protocol,
        tier: "balanced",
        temperature: 0,
        seed: "persisted-trace-replay",
        model: createDeterministicModelProvider(`deterministic-${name}-replay-model`),
        agents: shuffledAgents
      });
      const persistedTrace = JSON.parse(JSON.stringify(original.trace)) as Trace;

      const replayed = replay(persistedTrace);

      expect(replayed.output).toBe(original.output);
      expect(replayed.trace.finalOutput).toEqual(original.trace.finalOutput);
      expect(replayed.eventLog).toEqual(original.eventLog);
      expect(replayed.transcript).toEqual(original.transcript);

      const streamed = replayStream(persistedTrace);
      const streamedEvents: StreamEvent[] = [];
      for await (const event of streamed) {
        streamedEvents.push(event);
      }
      const streamedResult = await streamed.result;

      expect(streamedEvents).toEqual(original.eventLog.events);
      expect(streamedResult.output).toBe(original.output);
      expect(streamedResult.eventLog).toEqual(original.eventLog);
      expect(streamedResult.transcript).toEqual(original.transcript);
    }
  );
});

function decisionAgentScope(decision: {
  readonly decision: string;
  readonly agentId?: string;
  readonly role?: string;
  readonly phase?: string;
  readonly round?: number;
}): string {
  return [
    decision.decision,
    decision.agentId ?? "",
    decision.role ?? "",
    decision.phase ?? "",
    decision.round?.toString() ?? ""
  ].join(":");
}

function expectStableJsonArtifact(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      expectStableJsonArtifact(entry);
    }
    return;
  }

  if (typeof value === "number") {
    expect(Number.isFinite(value)).toBe(true);
    expect(Object.is(value, -0)).toBe(false);
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  const keys = Object.keys(value);
  expect(keys).toEqual([...keys].sort());
  for (const key of keys) {
    expectStableJsonArtifact((value as Record<string, unknown>)[key]);
  }
}

function normalizeTraceForEquivalence(trace: Trace): unknown {
  return normalizeTraceValue(trace);
}

function normalizeTraceValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeTraceValue(entry));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isVolatileTraceKey(key)) {
      normalized[key] = `<${key}>`;
      continue;
    }

    if (key === "callId" && typeof child === "string") {
      normalized[key] = child.replace(/^.*(:provider-call:\d+)$/u, "<runId>$1");
      continue;
    }

    normalized[key] = normalizeTraceValue(child);
  }

  return normalized;
}

function isVolatileTraceKey(key: string): boolean {
  return key === "runId" || key === "at" || key === "startedAt" || key === "completedAt";
}
