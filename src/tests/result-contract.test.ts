import { describe, expect, it } from "vitest";
import { createDeterministicModelProvider } from "../internal.js";
import { Dogpile, replay, replayStream, run } from "../index.js";
import type {
  ConfiguredModelProvider,
  BudgetCaps,
  BudgetCostTierOptions,
  BudgetTier,
  CoordinationProtocolSelection,
  CostSummary,
  DogpileOptions,
  EngineOptions,
  MissionIntent,
  ModelRequest,
  ModelResponse,
  NormalizedQualityScore,
  ProtocolName,
  ProtocolSelection,
  ProtocolConfig,
  ReplayTraceBudget,
  ReplayTraceBudgetStateChange,
  ReplayTraceFinalOutput,
  ReplayTraceProtocolDecision,
  ReplayTraceProtocolDecisionType,
  ReplayTraceProviderCall,
  ReplayTraceRunInputs,
  ReplayTraceSeed,
  RunAccounting,
  RunEventLog,
  RunEvent,
  RunMetadata,
  RunResult,
  RunUsage,
  StreamEvent,
  SubRunCompletedEvent,
  Trace,
  TranscriptEntry
} from "../index.js";

describe("single-call result contract", () => {
  it("exports named high-level input contracts for mission, protocol selection, and budget tier controls", () => {
    const intent: MissionIntent = "Define the high-level SDK call input contract.";
    const protocolName: ProtocolName = "broadcast";
    const protocol: ProtocolSelection = { kind: protocolName, maxRounds: 1 };
    const highLevelProtocol: CoordinationProtocolSelection = protocol;
    const tier: BudgetTier = "balanced";
    const budget: BudgetCaps = {
      maxUsd: 0.25,
      maxTokens: 500,
      qualityWeight: 0.6
    };
    const costControls: BudgetCostTierOptions = {
      tier,
      budget
    };
    const options: DogpileOptions = {
      intent,
      protocol: highLevelProtocol,
      ...costControls,
      model: createDeterministicModelProvider("input-contract-model")
    };
    const engineOptions: EngineOptions = {
      protocol,
      tier,
      model: options.model,
      budget
    };

    expect(options.intent).toBe(intent);
    expect(options.protocol).toEqual(protocol);
    expect(options.tier).toBe("balanced");
    expect(options.budget).toEqual(budget);
    expect(engineOptions.protocol).toEqual(protocol);
    expect(engineOptions.tier).toBe(tier);
    expect(engineOptions.budget).toEqual(budget);
  });

  it("returns output, event log, transcript, usage, metadata, trace, cost, and optional quality in one typed contract", async () => {
    const result = await run({
      intent: "Define the public single-call result artifact.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: createDeterministicModelProvider("result-contract-model")
    });

    const output: string = result.output;
    const trace: Trace = result.trace;
    const eventLog: RunEventLog = result.eventLog;
    const transcript: readonly TranscriptEntry[] = result.transcript;
    const usage: RunUsage = result.usage;
    const metadata: RunMetadata = result.metadata;
    const accounting: RunAccounting = result.accounting;
    const cost: CostSummary = result.cost;
    const quality: NormalizedQualityScore = 0.91;
    const judgedResult: RunResult = { ...result, quality };
    const finalEvent = trace.events.at(-1);

    expect(sortedKeys(result)).toEqual([
      "accounting",
      "cost",
      "eventLog",
      "metadata",
      "output",
      "trace",
      "transcript",
      "usage"
    ]);
    expect(sortedKeys(judgedResult)).toEqual([
      "accounting",
      "cost",
      "eventLog",
      "metadata",
      "output",
      "quality",
      "trace",
      "transcript",
      "usage"
    ]);
    expect(output).toBeTruthy();
    expect(finalEvent?.type).toBe("final");
    if (finalEvent?.type !== "final") {
      throw new Error("missing final event");
    }
    expect(eventLog).toEqual({
      kind: "run-event-log",
      runId: trace.runId,
      protocol: "sequential",
      eventTypes: trace.events.map((event) => event.type),
      eventCount: trace.events.length,
      events: trace.events
    });
    expect(transcript).toEqual(trace.transcript);
    expect(usage).toEqual(cost);
    expect(cost).toEqual(finalEvent.cost);
    expect(accounting).toEqual({
      kind: "run-accounting",
      tier: "fast",
      usage,
      cost,
      budgetStateChanges: trace.budgetStateChanges
    });
    expect(metadata).toEqual({
      runId: trace.runId,
      protocol: "sequential",
      tier: "fast",
      modelProviderId: "result-contract-model",
      agentsUsed: trace.agentsUsed,
      startedAt: trace.events[0]?.at,
      completedAt: finalEvent.at
    });
    expect(finalEvent.transcript).toEqual({
      kind: "trace-transcript",
      entryCount: trace.transcript.length,
      lastEntryIndex: trace.transcript.length - 1
    });
    expect(judgedResult.quality).toBe(0.91);
    expect(JSON.parse(JSON.stringify(judgedResult))).toEqual(judgedResult);
  });

  it("defines a versioned replay trace artifact with inputs, budget, seed, protocol decisions, provider calls, and final output", async () => {
    const model: ConfiguredModelProvider = {
      id: "trace-artifact-provider",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        const role = String(request.metadata.role);
        return {
          text: `${role} replay response`,
          usage: {
            inputTokens: 5,
            outputTokens: 3,
            totalTokens: 8
          },
          costUsd: 0.002
        };
      }
    };

    const result = await run({
      intent: "Capture the replay trace schema.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "quality",
      model,
      agents: [
        { id: "agent-1", role: "planner" },
        { id: "agent-2", role: "critic" }
      ],
      budget: { maxUsd: 0.5, maxTokens: 100, qualityWeight: 0.8 },
      seed: 2603289901
    });

    const inputs: ReplayTraceRunInputs = result.trace.inputs;
    const budget: ReplayTraceBudget = result.trace.budget;
    const budgetStateChanges: readonly ReplayTraceBudgetStateChange[] = result.trace.budgetStateChanges;
    const seed: ReplayTraceSeed = result.trace.seed;
    const decisions: readonly ReplayTraceProtocolDecision[] = result.trace.protocolDecisions;
    const providerCalls: readonly ReplayTraceProviderCall[] = result.trace.providerCalls;
    const finalOutput: ReplayTraceFinalOutput = result.trace.finalOutput;

    expect(result.trace.schemaVersion).toBe("1.0");
    expect(inputs).toEqual({
      kind: "replay-trace-run-inputs",
      intent: "Capture the replay trace schema.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "quality",
      modelProviderId: "trace-artifact-provider",
      agents: [
        { id: "agent-1", role: "planner" },
        { id: "agent-2", role: "critic" }
      ],
      temperature: 0.4
    });
    expect(budget).toEqual({
      kind: "replay-trace-budget",
      tier: "quality",
      caps: { maxUsd: 0.5, maxTokens: 100, qualityWeight: 0.8 },
      termination: { kind: "budget", maxUsd: 0.5, maxTokens: 100 }
    });
    expect(result.accounting).toEqual({
      kind: "run-accounting",
      tier: "quality",
      budget: { maxUsd: 0.5, maxTokens: 100, qualityWeight: 0.8 },
      termination: { kind: "budget", maxUsd: 0.5, maxTokens: 100 },
      usage: result.usage,
      cost: result.cost,
      budgetStateChanges,
      usdCapUtilization: 0.008,
      totalTokenCapUtilization: 0.16
    });
    expect(budgetStateChanges).toEqual([
      {
        kind: "replay-trace-budget-state-change",
        eventIndex: 2,
        eventType: "agent-turn",
        at: result.trace.events[2]?.at,
        cost: {
          usd: 0.002,
          inputTokens: 5,
          outputTokens: 3,
          totalTokens: 8
        }
      },
      {
        kind: "replay-trace-budget-state-change",
        eventIndex: 3,
        eventType: "agent-turn",
        at: result.trace.events[3]?.at,
        cost: {
          usd: 0.004,
          inputTokens: 10,
          outputTokens: 6,
          totalTokens: 16
        }
      },
      {
        kind: "replay-trace-budget-state-change",
        eventIndex: 4,
        eventType: "final",
        at: result.trace.events[4]?.at,
        cost: result.cost
      }
    ]);
    expect(seed).toEqual({
      kind: "replay-trace-seed",
      source: "caller",
      value: 2603289901
    });
    expect(decisions.map((decision) => decision.eventType)).toEqual(result.trace.events.map((event) => event.type));
    expect(decisions.at(-1)).toMatchObject({
      kind: "replay-trace-protocol-decision",
      eventIndex: result.trace.events.length - 1,
      eventType: "final",
      protocol: "sequential",
      output: result.output,
      cost: result.cost
    });
    expect(providerCalls).toHaveLength(2);
    expect(providerCalls[0]).toMatchObject({
      kind: "replay-trace-provider-call",
      callId: `${result.trace.runId}:provider-call:1`,
      providerId: "trace-artifact-provider",
      agentId: "agent-1",
      role: "planner",
      request: {
        temperature: 0.4,
        metadata: {
          runId: result.trace.runId,
          protocol: "sequential",
          agentId: "agent-1",
          role: "planner",
          tier: "quality"
        }
      },
      response: {
        text: "planner replay response",
        usage: {
          inputTokens: 5,
          outputTokens: 3,
          totalTokens: 8
        },
        costUsd: 0.002
      }
    });
    expect(providerCalls.map((call) => call.response.text)).toEqual([
      "planner replay response",
      "critic replay response"
    ]);
    expect(finalOutput).toEqual({
      kind: "replay-trace-final-output",
      output: result.output,
      cost: result.cost,
      completedAt: result.metadata.completedAt,
      transcript: {
        kind: "trace-transcript",
        entryCount: result.transcript.length,
        lastEntryIndex: result.transcript.length - 1
      }
    });
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
  });

  it("completed run emits a complete replay trace artifact with all required sections populated", async () => {
    const result = await Dogpile.pile({
      intent: "Produce a completed replay artifact for persistence.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "balanced",
      model: createDeterministicModelProvider("complete-replay-artifact-model"),
      agents: [
        { id: "agent-1", role: "planner" },
        { id: "agent-2", role: "reviewer" }
      ],
      budget: { maxUsd: 1, maxTokens: 500, qualityWeight: 0.7 },
      seed: "complete-replay-artifact-seed"
    });

    const trace: Trace = result.trace;
    const expectedSections = [
      "schemaVersion",
      "runId",
      "protocol",
      "tier",
      "modelProviderId",
      "agentsUsed",
      "inputs",
      "budget",
      "budgetStateChanges",
      "seed",
      "protocolDecisions",
      "providerCalls",
      "finalOutput",
      "events",
      "transcript"
    ];

    expect(Object.keys(trace).sort()).toEqual(expectedSections.sort());
    expect(trace.schemaVersion).toBe("1.0");
    expect(trace.runId).toBeTruthy();
    expect(trace.protocol).toBe("sequential");
    expect(trace.tier).toBe("balanced");
    expect(trace.modelProviderId).toBe("complete-replay-artifact-model");
    expect(trace.agentsUsed).toEqual([
      { id: "agent-1", role: "planner" },
      { id: "agent-2", role: "reviewer" }
    ]);
    expect(trace.inputs).toEqual({
      kind: "replay-trace-run-inputs",
      intent: "Produce a completed replay artifact for persistence.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "balanced",
      modelProviderId: "complete-replay-artifact-model",
      agents: trace.agentsUsed,
      temperature: 0.2
    });
    expect(trace.budget).toEqual({
      kind: "replay-trace-budget",
      tier: "balanced",
      caps: { maxUsd: 1, maxTokens: 500, qualityWeight: 0.7 },
      termination: { kind: "budget", maxUsd: 1, maxTokens: 500 }
    });
    expect(trace.seed).toEqual({
      kind: "replay-trace-seed",
      source: "caller",
      value: "complete-replay-artifact-seed"
    });

    expect(trace.events).toHaveLength(5);
    expect(trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(trace.transcript).toHaveLength(2);
    expect(trace.protocolDecisions).toHaveLength(trace.events.length);
    expect(trace.providerCalls).toHaveLength(trace.transcript.length);
    expect(trace.budgetStateChanges).toHaveLength(3);

    expect(result.eventLog.events).toBe(trace.events);
    expect(result.transcript).toBe(trace.transcript);
    expect(result.output).toBe(trace.finalOutput.output);
    expect(result.cost).toEqual(trace.finalOutput.cost);
    expect(trace.finalOutput).toEqual({
      kind: "replay-trace-final-output",
      output: result.output,
      cost: result.cost,
      completedAt: result.metadata.completedAt,
      transcript: {
        kind: "trace-transcript",
        entryCount: trace.transcript.length,
        lastEntryIndex: trace.transcript.length - 1
      }
    });
    expect(trace.budgetStateChanges.at(-1)).toMatchObject({
      kind: "replay-trace-budget-state-change",
      eventIndex: trace.events.length - 1,
      eventType: "final",
      cost: result.cost
    });
    expect(trace.protocolDecisions.at(-1)).toMatchObject({
      kind: "replay-trace-protocol-decision",
      eventIndex: trace.events.length - 1,
      eventType: "final",
      decision: "finalize-output",
      protocol: "sequential",
      transcriptEntryCount: trace.transcript.length,
      output: result.output,
      cost: result.cost
    });
    expect(trace.providerCalls.map((call) => call.response.text)).toEqual(
      trace.transcript.map((entry) => entry.output)
    );
    expect(trace.providerCalls.map((call) => call.request.messages.at(-1)?.content)).toEqual(
      trace.transcript.map((entry) => entry.input)
    );
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
  });

  it("rehydrates the public result contract from a saved replay trace artifact", async () => {
    const result = await run({
      intent: "Persist and reload a completed replay trace.",
      protocol: { kind: "broadcast", maxRounds: 1 },
      tier: "quality",
      model: createDeterministicModelProvider("saved-trace-replay-model"),
      agents: [
        { id: "agent-1", role: "planner" },
        { id: "agent-2", role: "critic" }
      ],
      budget: { maxUsd: 1, maxTokens: 500, qualityWeight: 0.8 }
    });
    const savedTrace = JSON.parse(JSON.stringify(result.trace)) as Trace;

    const replayed = replay(savedTrace);
    const namespacedReplay = Dogpile.replay(savedTrace);

    expect(replayed).toEqual({
      output: result.output,
      eventLog: result.eventLog,
      trace: savedTrace,
      transcript: result.transcript,
      usage: result.usage,
      metadata: result.metadata,
      accounting: result.accounting,
      cost: result.cost
    });
    expect(namespacedReplay).toEqual(replayed);
    expect(replayed.eventLog.events).toBe(savedTrace.events);
    expect(replayed.transcript).toBe(savedTrace.transcript);
    expect(replayed.output).toBe(savedTrace.finalOutput.output);
    expect(JSON.parse(JSON.stringify(replayed))).toEqual(replayed);
  });

  it("replays a saved trace as streaming events, final output, and transcript while failing on any live provider call", async () => {
    let providerCalls = 0;
    let replayingSavedTrace = false;
    const model: ConfiguredModelProvider = {
      id: "provider-free-replay-model",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        if (replayingSavedTrace) {
          throw new Error("replay attempted a live provider call");
        }

        providerCalls += 1;
        const role = String(request.metadata.role);
        return {
          text: `${role} saved replay output`,
          usage: {
            inputTokens: 2,
            outputTokens: 3,
            totalTokens: 5
          },
          costUsd: 0.001
        };
      }
    };
    const result = await run({
      intent: "Replay execution must not call the model provider.",
      protocol: { kind: "shared", maxTurns: 2 },
      tier: "fast",
      model,
      agents: [
        { id: "agent-1", role: "state-initializer" },
        { id: "agent-2", role: "state-reviewer" }
      ]
    });
    const callsAfterOriginalRun = providerCalls;
    const savedTrace = JSON.parse(JSON.stringify(result.trace)) as Trace;
    replayingSavedTrace = true;
    const handle = replayStream(savedTrace);
    const subscriberEvents: StreamEvent[] = [];
    const streamedEvents: StreamEvent[] = [];

    handle.subscribe((event) => {
      subscriberEvents.push(event);
    });

    for await (const event of handle) {
      streamedEvents.push(event);
    }

    const replayed = await handle.result;
    const namespacedHandle = Dogpile.replayStream(savedTrace);
    const namespacedResult = await namespacedHandle.result;
    const recordedOutputs = savedTrace.providerCalls.map((call) => call.response.text);

    expect(providerCalls).toBe(callsAfterOriginalRun);
    expect(recordedOutputs).toEqual(savedTrace.transcript.map((entry) => entry.output));
    expect(streamedEvents).toEqual(savedTrace.events);
    expect(subscriberEvents).toEqual(savedTrace.events);
    expect(replayed.output).toBe(savedTrace.finalOutput.output);
    expect(replayed.transcript).toBe(savedTrace.transcript);
    expect(replayed.eventLog.events).toBe(savedTrace.events);
    expect(replayed.trace).toBe(savedTrace);
    expect(replayed).toEqual(replay(savedTrace));
    expect(namespacedResult).toEqual(replayed);
    expect(JSON.parse(JSON.stringify(replayed))).toEqual(replayed);
  });

  it("preserves the replay ordering contract across events, protocol decisions, provider responses, and transcript entries", async () => {
    const result = await run({
      intent: "Verify replay trace ordering and provider response capture.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "balanced",
      model: createDeterministicModelProvider("ordering-contract-model"),
      agents: [
        { id: "agent-1", role: "planner" },
        { id: "agent-2", role: "critic" }
      ]
    });

    const trace: Trace = result.trace;
    const turnEvents = trace.events.filter((event) => event.type === "agent-turn");

    expect(result.eventLog.events).toBe(trace.events);
    expect(result.eventLog.eventTypes).toEqual(trace.events.map((event) => event.type));
    expect(trace.events.at(-1)?.type).toBe("final");
    expect(trace.finalOutput.output).toBe(result.output);
    expect(trace.protocolDecisions).toHaveLength(trace.events.length);
    expect(trace.protocolDecisions.map((decision) => decision.eventIndex)).toEqual(
      trace.events.map((_event, index) => index)
    );
    expect(trace.protocolDecisions.map((decision) => decision.eventType)).toEqual(
      trace.events.map((event) => event.type)
    );

    expect(trace.providerCalls).toHaveLength(trace.transcript.length);
    expect(trace.providerCalls).toHaveLength(turnEvents.length);
    expect(trace.providerCalls.map((call) => call.callId)).toEqual(
      trace.providerCalls.map((_call, index) => `${trace.runId}:provider-call:${index + 1}`)
    );

    for (const [index, call] of trace.providerCalls.entries()) {
      const transcript = trace.transcript[index];
      const turnEvent = turnEvents[index];
      if (!transcript || turnEvent?.type !== "agent-turn") {
        throw new Error("missing replay ordering fixture entry");
      }

      expect(call.providerId).toBe(trace.modelProviderId);
      expect(call.agentId).toBe(transcript.agentId);
      expect(call.role).toBe(transcript.role);
      expect(call.request.messages.at(-1)?.content).toBe(transcript.input);
      expect(call.response.text).toBe(transcript.output);
      expect(turnEvent.output).toBe(call.response.text);
      expect(Date.parse(call.startedAt)).toBeLessThanOrEqual(Date.parse(call.completedAt));
      expect(Date.parse(call.completedAt)).toBeLessThanOrEqual(Date.parse(turnEvent.at));
    }
  });

  it("executes each selected protocol through the non-streaming orchestration path and returns the collected event log and transcript", async () => {
    const cases: readonly {
      readonly protocol: ProtocolConfig;
      readonly expectedEventTypes: readonly string[];
      readonly transcriptLength: number;
    }[] = [
      {
        protocol: { kind: "sequential", maxTurns: 2 },
        expectedEventTypes: ["role-assignment", "role-assignment", "agent-turn", "agent-turn", "final"],
        transcriptLength: 2
      },
      {
        protocol: { kind: "coordinator", maxTurns: 2 },
        expectedEventTypes: ["role-assignment", "role-assignment", "agent-turn", "agent-turn", "agent-turn", "final"],
        transcriptLength: 3
      },
      {
        protocol: { kind: "broadcast", maxRounds: 1 },
        expectedEventTypes: [
          "role-assignment",
          "role-assignment",
          "agent-turn",
          "agent-turn",
          "broadcast",
          "final"
        ],
        transcriptLength: 2
      },
      {
        protocol: { kind: "shared", maxTurns: 2 },
        expectedEventTypes: ["role-assignment", "role-assignment", "agent-turn", "agent-turn", "final"],
        transcriptLength: 2
      }
    ];

    for (const testCase of cases) {
      const result = await run({
        intent: `Collect events and transcript for ${testCase.protocol.kind}.`,
        protocol: testCase.protocol,
        tier: "fast",
        model: createDeterministicModelProvider(`non-streaming-${testCase.protocol.kind}-model`),
        agents: [
          { id: "agent-1", role: "planner" },
          { id: "agent-2", role: "critic" }
        ]
      });

      expect(result.trace.protocol).toBe(testCase.protocol.kind);
      expect(result.eventLog).toEqual({
        kind: "run-event-log",
        runId: result.trace.runId,
        protocol: testCase.protocol.kind,
        eventTypes: testCase.expectedEventTypes,
        eventCount: testCase.expectedEventTypes.length,
        events: result.trace.events
      });
      expect(result.trace.events.map((event) => event.type)).toEqual(testCase.expectedEventTypes);
      expect(result.transcript).toHaveLength(testCase.transcriptLength);
      expect(result.trace.transcript).toEqual(result.transcript);
      expect(result.trace.providerCalls).toHaveLength(result.transcript.length);
      expect(result.trace.providerCalls.map((call) => call.callId)).toEqual(
        result.transcript.map((_entry, index) => `${result.trace.runId}:provider-call:${index + 1}`)
      );
      expect(
        result.trace.providerCalls.every((call) => call.providerId === `non-streaming-${testCase.protocol.kind}-model`)
      ).toBe(true);
      expect(result.trace.providerCalls.map((call) => call.agentId)).toEqual(
        result.transcript.map((entry) => entry.agentId)
      );
      expect(result.trace.providerCalls.map((call) => call.role)).toEqual(result.transcript.map((entry) => entry.role));
      expect(result.trace.providerCalls.map((call) => call.request.messages.at(-1)?.content)).toEqual(
        result.transcript.map((entry) => entry.input)
      );
      expect(result.trace.providerCalls.map((call) => call.response.text)).toEqual(
        result.transcript.map((entry) => entry.output)
      );
      for (const call of result.trace.providerCalls) {
        expect(call.kind).toBe("replay-trace-provider-call");
        expect(call.request.temperature).toBe(0);
        expect(call.request.metadata).toMatchObject({
          runId: result.trace.runId,
          protocol: testCase.protocol.kind,
          agentId: call.agentId,
          role: call.role,
          tier: "fast"
        });
        expect(call.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
        expect(call.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
        expect(JSON.parse(JSON.stringify(call))).toEqual(call);
      }
      expect(result.eventLog.events.at(-1)).toMatchObject({
        type: "final",
        output: result.output,
        transcript: {
          kind: "trace-transcript",
          entryCount: result.transcript.length,
          lastEntryIndex: result.transcript.length - 1
        }
      });
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    }
  });

  it("records provider-neutral replay decisions for protocol coordination moments", async () => {
    const expectedDecisions: readonly {
      readonly protocol: ProtocolConfig;
      readonly decisions: readonly ReplayTraceProtocolDecisionType[];
      readonly phaseDecisions?: readonly string[];
    }[] = [
      {
        protocol: { kind: "sequential", maxTurns: 2 },
        decisions: ["assign-role", "assign-role", "select-agent-turn", "select-agent-turn", "finalize-output"]
      },
      {
        protocol: { kind: "coordinator", maxTurns: 2 },
        decisions: [
          "assign-role",
          "assign-role",
          "select-agent-turn",
          "select-agent-turn",
          "select-agent-turn",
          "finalize-output"
        ],
        phaseDecisions: ["plan", "worker", "final-synthesis"]
      },
      {
        protocol: { kind: "broadcast", maxRounds: 1 },
        decisions: [
          "assign-role",
          "assign-role",
          "select-agent-turn",
          "select-agent-turn",
          "collect-broadcast-round",
          "finalize-output"
        ]
      },
      {
        protocol: { kind: "shared", maxTurns: 2 },
        decisions: ["assign-role", "assign-role", "select-agent-turn", "select-agent-turn", "finalize-output"]
      }
    ];

    for (const testCase of expectedDecisions) {
      const result = await run({
        intent: `Record replay decisions for ${testCase.protocol.kind}.`,
        protocol: testCase.protocol,
        tier: "fast",
        model: createDeterministicModelProvider(`decision-${testCase.protocol.kind}-model`),
        agents: [
          { id: "agent-1", role: "planner" },
          { id: "agent-2", role: "critic" }
        ]
      });

      expect(result.trace.protocolDecisions.map((decision) => decision.decision)).toEqual(testCase.decisions);
      expect(result.trace.protocolDecisions.map((decision) => decision.eventIndex)).toEqual(
        result.trace.protocolDecisions.map((_decision, index) => index)
      );
      expect(result.trace.protocolDecisions.map((decision) => decision.eventType)).toEqual(
        result.trace.events.map((event) => event.type)
      );
      expect(result.trace.protocolDecisions.every((decision) => decision.protocol === testCase.protocol.kind)).toBe(
        true
      );
      expect(
        result.trace.protocolDecisions.every(
          (decision) => !Object.hasOwn(decision, "providerId") && !Object.hasOwn(decision, "modelProviderId")
        )
      ).toBe(true);
      expect(result.trace.protocolDecisions.at(-1)).toMatchObject({
        decision: "finalize-output",
        transcriptEntryCount: result.transcript.length,
        output: result.output,
        cost: result.cost
      });
      expect(JSON.parse(JSON.stringify(result.trace.protocolDecisions))).toEqual(result.trace.protocolDecisions);

      if (testCase.phaseDecisions) {
        expect(
          result.trace.protocolDecisions
            .filter((decision) => decision.decision === "select-agent-turn")
            .map((decision) => decision.phase)
        ).toEqual(testCase.phaseDecisions);
      }
    }
  });

  it("keeps Dogpile.pile on the non-streaming path and resolves only after completion", async () => {
    let startGeneration: () => void = () => {};
    let releaseGeneration: () => void = () => {};
    const generationStarted = new Promise<void>((resolve) => {
      startGeneration = resolve;
    });
    const generationRelease = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const model: ConfiguredModelProvider = {
      id: "delayed-pile-model",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        startGeneration();
        await generationRelease;

        return {
          text: `completed ${String(request.metadata.role)} turn`,
          usage: {
            inputTokens: 4,
            outputTokens: 3,
            totalTokens: 7
          },
          costUsd: 0.0007
        };
      }
    };

    const resultPromise = Dogpile.pile({
      intent: "Resolve the high-level entrypoint only after protocol completion.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model,
      agents: [{ id: "agent-1", role: "finisher" }]
    });
    let resolvedBeforeModelCompleted = false;
    resultPromise.then(() => {
      resolvedBeforeModelCompleted = true;
    });

    await generationStarted;
    await Promise.resolve();

    expect(resolvedBeforeModelCompleted).toBe(false);

    releaseGeneration();
    const result = await resultPromise;

    expect(result.trace.events.map((event) => event.type)).toEqual(["role-assignment", "agent-turn", "final"]);
    expect(result.eventLog.events).toEqual(result.trace.events);
    expect(result.transcript).toEqual(result.trace.transcript);
    expect(result.output).toContain("completed finisher turn");
    expect(result).not.toHaveProperty("result");
    expect(Symbol.asyncIterator in result).toBe(false);
  });

  it("propagates model execution failures from run without wrapping or resolving a partial result", async () => {
    const failure = new Error("provider unavailable during single-call run");
    let calls = 0;
    const model: ConfiguredModelProvider = {
      id: "failing-run-model",
      async generate(): Promise<ModelResponse> {
        calls += 1;
        throw failure;
      }
    };

    await expect(
      run({
        intent: "Surface provider failures to the caller.",
        protocol: { kind: "sequential", maxTurns: 1 },
        tier: "fast",
        model,
        agents: [{ id: "agent-1", role: "planner" }]
      })
    ).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

  it("propagates model execution failures from Dogpile.pile through the single-call path", async () => {
    const failure = new Error("provider unavailable during Dogpile.pile");
    let calls = 0;
    const model: ConfiguredModelProvider = {
      id: "failing-pile-model",
      async generate(): Promise<ModelResponse> {
        calls += 1;
        throw failure;
      }
    };

    await expect(
      Dogpile.pile({
        intent: "Surface branded entrypoint provider failures to the caller.",
        protocol: { kind: "sequential", maxTurns: 1 },
        tier: "fast",
        model,
        agents: [{ id: "agent-1", role: "planner" }]
      })
    ).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

  it("embeds a sub-run-completed event with a full child RunResult that round-trips through JSON", async () => {
    const child = await run({
      intent: "Produce an embeddable child RunResult for the parent trace.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: createDeterministicModelProvider("result-contract-sub-run-child")
    });
    const parent = await run({
      intent: "Wrap a sub-run-completed event in the parent trace.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: createDeterministicModelProvider("result-contract-sub-run-parent")
    });

    const subRunCompleted: SubRunCompletedEvent = {
      type: "sub-run-completed",
      runId: parent.trace.runId,
      at: "2026-04-30T00:00:00.000Z",
      childRunId: child.trace.runId,
      parentRunId: parent.trace.runId,
      parentDecisionId: `${parent.trace.runId}:decision:1`,
      subResult: child
    };
    const parentEvents: readonly RunEvent[] = [...parent.trace.events, subRunCompleted];
    const parentResult: RunResult = {
      ...parent,
      trace: { ...parent.trace, events: parentEvents }
    };

    const roundTripped = JSON.parse(JSON.stringify(parentResult)) as RunResult;
    const embedded = roundTripped.trace.events.find((event) => event.type === "sub-run-completed");

    expect(embedded?.type).toBe("sub-run-completed");
    if (embedded?.type !== "sub-run-completed") {
      throw new Error("missing embedded sub-run-completed event");
    }
    expect(embedded.subResult.trace.events).toEqual(child.trace.events);
    expect(embedded.subResult.accounting).toEqual(child.accounting);
    expect(embedded.subResult.output).toBe(child.output);
    expect(embedded.subResult.transcript).toEqual(child.transcript);
    expect(embedded.parentRunId).toBe(parent.trace.runId);
    expect(embedded.childRunId).toBe(child.trace.runId);
  });

  it("replay round-trip preserves parent event sequence verbatim for a parent-trace-with-one-child fixture", async () => {
    // Build a small parent-with-one-child fixture by running a coordinator
    // mission scripted to delegate exactly once before participating.
    const planResponses = [
      [
        "delegate:",
        "```json",
        JSON.stringify({ protocol: "sequential", intent: "single child for verbatim event-sequence test" }),
        "```",
        ""
      ].join("\n"),
      [
        "role_selected: coordinator",
        "participation: contribute",
        "rationale: synthesize after sub-run",
        "contribution:",
        "synthesized after sub-run"
      ].join("\n")
    ];
    let planIndex = 0;
    const provider: ConfiguredModelProvider = {
      id: "result-contract-replay-verbatim",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        const phase = String(request.metadata.phase);
        const text =
          phase === "plan"
            ? (planResponses[planIndex++] ?? planResponses[planResponses.length - 1]!)
            : phase === "worker"
              ? "worker output"
              : "final output";
        return { text, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, costUsd: 0 };
      }
    };

    const result = await run({
      intent: "Verbatim event sequence after replay.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });

    // Confirm the fixture really has one sub-run in the parent event stream.
    expect(result.trace.events.filter((event) => event.type === "sub-run-completed")).toHaveLength(1);

    const replayed = replay(result.trace);
    expect(replayed.trace.events.map((event) => event.type)).toEqual(
      result.trace.events.map((event) => event.type)
    );
    // Full event-array equality, not just type sequence.
    expect(replayed.trace.events).toEqual(result.trace.events);
  });
});

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}
