import { describe, expect, it } from "vitest";
import { createDeterministicCoordinatorTestMission } from "../internal.js";
import { Dogpile, DogpileError, run, runtimeToolManifest, stream } from "../index.js";
import type {
  AgentSpec,
  ConfiguredModelProvider,
  JsonObject,
  JsonValue,
  ModelRequest,
  ModelResponse,
  RunEvent,
  RuntimeTool
} from "../index.js";

describe("coordinator protocol", () => {
  it("plans, dispatches workers, and synthesizes through the configured model provider", async () => {
    const intent = "Decide whether the coordinator path is wired to the configured provider.";
    const agents: readonly AgentSpec[] = [
      {
        id: "seat-coordinator",
        role: "coordinator",
        instructions: "Assign work and synthesize the final answer."
      },
      {
        id: "seat-research",
        role: "researcher",
        instructions: "Inspect provider wiring evidence."
      },
      {
        id: "seat-review",
        role: "reviewer",
        instructions: "Check the final path for hidden shortcuts."
      }
    ];
    const requests: ModelRequest[] = [];
    const model: ConfiguredModelProvider = {
      id: "capturing-coordinator-model",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        requests.push(request);
        const phase = String(request.metadata.phase);
        const role = String(request.metadata.role);
        const agentId = String(request.metadata.agentId);

        return {
          text: `${phase}:${role}:${agentId}`,
          usage: {
            inputTokens: 11,
            outputTokens: 7,
            totalTokens: 18
          },
          costUsd: 0.001
        };
      }
    };

    const result = await run({
      intent,
      protocol: { kind: "coordinator", maxTurns: 3 },
      tier: "balanced",
      model,
      agents
    });

    expect(requests).toHaveLength(4);
    expect(requests.map((request) => request.metadata)).toEqual([
      expect.objectContaining({
        protocol: "coordinator",
        agentId: "seat-coordinator",
        role: "coordinator",
        coordinatorAgentId: "seat-coordinator",
        tier: "balanced",
        phase: "plan"
      }),
      expect.objectContaining({
        protocol: "coordinator",
        agentId: "seat-research",
        role: "researcher",
        coordinatorAgentId: "seat-coordinator",
        tier: "balanced",
        phase: "worker"
      }),
      expect.objectContaining({
        protocol: "coordinator",
        agentId: "seat-review",
        role: "reviewer",
        coordinatorAgentId: "seat-coordinator",
        tier: "balanced",
        phase: "worker"
      }),
      expect.objectContaining({
        protocol: "coordinator",
        agentId: "seat-coordinator",
        role: "coordinator",
        coordinatorAgentId: "seat-coordinator",
        tier: "balanced",
        phase: "final-synthesis"
      })
    ]);
    expect(requests[0]?.messages.find((message) => message.role === "user")?.content).toContain(intent);
    expect(requests[1]?.messages.find((message) => message.role === "user")?.content).toContain(
      "plan:coordinator:seat-coordinator"
    );
    expect(requests[3]?.messages.find((message) => message.role === "user")?.content).toContain(
      "Synthesize the final answer as the coordinator."
    );
    expect(result.output).toBe("final-synthesis:coordinator:seat-coordinator");
    expect(result.transcript).toHaveLength(4);
    expect(result.trace.protocol).toBe("coordinator");
    expect(result.trace.modelProviderId).toBe("capturing-coordinator-model");
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
    expect(result.cost).toEqual({
      usd: 0.004,
      inputTokens: 44,
      outputTokens: 28,
      totalTokens: 72
    });
  });

  it("starts coordinator workers in parallel from the same coordinator plan", async () => {
    const requests: ModelRequest[] = [];
    const workerRequests: ModelRequest[] = [];
    let resolveWorkersStarted!: () => void;
    let releaseWorkers!: () => void;
    const workersStarted = new Promise<void>((resolve) => {
      resolveWorkersStarted = resolve;
    });
    const workersReleased = new Promise<void>((resolve) => {
      releaseWorkers = resolve;
    });
    const model: ConfiguredModelProvider = {
      id: "parallel-coordinator-model",
      async generate(request) {
        requests.push(request);
        const phase = String(request.metadata.phase);
        const agentId = String(request.metadata.agentId);
        if (phase === "plan") {
          return { text: "coordinator plan output" };
        }
        if (phase === "worker") {
          workerRequests.push(request);
          if (workerRequests.length === 2) {
            resolveWorkersStarted();
          }
          await workersReleased;
          return { text: `worker output from ${agentId}` };
        }
        return { text: "final synthesis output" };
      }
    };

    const resultPromise = run({
      intent: "Verify coordinator worker parallelism.",
      protocol: { kind: "coordinator", maxTurns: 3 },
      tier: "fast",
      model,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" },
        { id: "worker-b", role: "worker" }
      ]
    });

    await expect(Promise.race([workersStarted, rejectAfter(100, "workers did not start in parallel")])).resolves.toBeUndefined();
    expect(workerRequests).toHaveLength(2);
    expect(workerRequests[0]?.messages.find((message) => message.role === "user")?.content).toContain(
      "coordinator plan output"
    );
    expect(workerRequests[1]?.messages.find((message) => message.role === "user")?.content).toContain(
      "coordinator plan output"
    );
    expect(workerRequests[1]?.messages.find((message) => message.role === "user")?.content).not.toContain(
      "worker output from worker-a"
    );

    releaseWorkers();
    const result = await resultPromise;
    const finalRequest = requests.at(-1);
    expect(finalRequest?.metadata.phase).toBe("final-synthesis");
    expect(finalRequest?.messages.find((message) => message.role === "user")?.content).toContain(
      "worker output from worker-a"
    );
    expect(finalRequest?.messages.find((message) => message.role === "user")?.content).toContain(
      "worker output from worker-b"
    );
    expect(result.output).toBe("final synthesis output");
  });

  it("threads shared runtime tool availability through every coordinator phase", async () => {
    const requests: ModelRequest[] = [];
    const lookupTool: RuntimeTool<JsonObject, JsonValue> = {
      identity: {
        id: "fixture.lookup",
        namespace: "dogpile.test",
        name: "lookup",
        version: "1.0.0",
        description: "Lookup release-readiness evidence."
      },
      inputSchema: {
        kind: "json-schema",
        description: "Release evidence lookup input.",
        schema: {
          type: "object",
          properties: {
            query: { type: "string" }
          },
          required: ["query"],
          additionalProperties: false
        }
      },
      permissions: [
        {
          kind: "custom",
          name: "release-evidence",
          description: "Reads caller-owned release evidence."
        }
      ],
      execute(input, context) {
        return {
          type: "success",
          toolCallId: context.toolCallId,
          tool: this.identity,
          output: {
            protocol: context.protocol
          }
        };
      }
    };
    const model: ConfiguredModelProvider = {
      id: "coordinator-tool-availability-model",
      async generate(request) {
        requests.push(request);
        return { text: `${String(request.metadata.phase)}:${String(request.metadata.agentId)}` };
      }
    };

    await run({
      intent: "Use available tools while coordinating a release decision.",
      protocol: { kind: "coordinator", maxTurns: 3 },
      tier: "fast",
      model,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "risk", role: "risk-reviewer" },
        { id: "runtime", role: "runtime-reviewer" }
      ],
      tools: [lookupTool]
    });

    expect(requests).toHaveLength(4);
    expect(requests.map((request) => request.metadata.phase)).toEqual([
      "plan",
      "worker",
      "worker",
      "final-synthesis"
    ]);
    expect(requests.map((request) => request.metadata.tools)).toEqual([
      runtimeToolManifest([lookupTool]),
      runtimeToolManifest([lookupTool]),
      runtimeToolManifest([lookupTool]),
      runtimeToolManifest([lookupTool])
    ]);
  });

  it("streams coordinator provider-backed turns before the final result", async () => {
    const model = createPhaseEchoProvider("streaming-coordinator-model");
    const handle = stream({
      intent: "Stream a coordinator run.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model,
      agents: [
        { id: "agent-1", role: "coordinator" },
        { id: "agent-2", role: "worker" }
      ]
    });

    const events: string[] = [];
    for await (const event of handle) {
      events.push(event.type);
    }
    const result = await handle.result;

    expect(events).toEqual([
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(result.output).toBe("final-synthesis:coordinator:agent-1");
    expect(result.trace.events.map((event) => event.type)).toEqual(events);
  });

  it("runs coordinator end to end with the configured provider and produces output, event log, and transcript", async () => {
    const requests: ModelRequest[] = [];
    const model = createPhaseEchoProvider("coordinator-e2e-provider", requests);
    const handle = Dogpile.stream({
      intent: "Produce an end-to-end coordinator release decision.",
      protocol: { kind: "coordinator", maxTurns: 3 },
      tier: "quality",
      model,
      agents: [
        { id: "lead", role: "release-coordinator" },
        { id: "risk", role: "risk-reviewer" },
        { id: "runtime", role: "runtime-reviewer" }
      ]
    });

    const eventLog: RunEvent[] = [];
    for await (const event of handle) {
      if (event.type !== "error") {
        eventLog.push(event as RunEvent);
      }
    }
    const result = await handle.result;

    expect(requests).toHaveLength(4);
    expect(result.output).toBe("final-synthesis:release-coordinator:lead");
    expect(result.trace.protocol).toBe("coordinator");
    expect(result.trace.modelProviderId).toBe("coordinator-e2e-provider");
    expect(eventLog).toHaveLength(8);
    expect(eventLog).toEqual(result.trace.events);
    expect(eventLog.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(result.transcript).toHaveLength(4);
    expect(result.trace.transcript).toEqual(result.transcript);
    expect(result.transcript.every((entry) => entry.input.length > 0 && entry.output.length > 0)).toBe(true);

    const finalEvent = eventLog.at(-1);
    expect(finalEvent?.type).toBe("final");
    if (finalEvent?.type !== "final") {
      throw new Error("expected final event in coordinator e2e event log");
    }
    expect(finalEvent.output).toBe(result.output);
  });

  it("runs a deterministic coordinator mission end to end through the branded SDK call", async () => {
    const result = await Dogpile.pile(createDeterministicCoordinatorTestMission());
    const intent = "Decide whether the coordinator protocol can run a portable release triage end to end.";
    const expectedTranscript = [
      {
        agentId: "agent-1",
        role: "release-coordinator",
        input: `Mission: ${intent}\nCoordinator agent-1: assign the work, name the plan, and provide the first contribution.`,
        output: "release-coordinator:agent-1 planned the coordinator-managed mission."
      },
      {
        agentId: "agent-2",
        role: "evidence-reviewer",
        input: [
          `Mission: ${intent}`,
          "",
          "Coordinator: agent-1",
          "Prior contributions:",
          "release-coordinator (agent-1): release-coordinator:agent-1 planned the coordinator-managed mission.",
          "",
          "Follow the coordinator-managed plan and provide your assigned contribution."
        ].join("\n"),
        output: "evidence-reviewer:agent-2 completed the coordinator-assigned work."
      },
      {
        agentId: "agent-3",
        role: "portability-reviewer",
        input: [
          `Mission: ${intent}`,
          "",
          "Coordinator: agent-1",
          "Prior contributions:",
          "release-coordinator (agent-1): release-coordinator:agent-1 planned the coordinator-managed mission.",
          "",
          "Follow the coordinator-managed plan and provide your assigned contribution."
        ].join("\n"),
        output: "portability-reviewer:agent-3 completed the coordinator-assigned work."
      },
      {
        agentId: "agent-1",
        role: "release-coordinator",
        input: [
          `Mission: ${intent}`,
          "",
          "Coordinator: agent-1",
          "Prior contributions:",
          "release-coordinator (agent-1): release-coordinator:agent-1 planned the coordinator-managed mission.",
          "",
          "evidence-reviewer (agent-2): evidence-reviewer:agent-2 completed the coordinator-assigned work.",
          "",
          "portability-reviewer (agent-3): portability-reviewer:agent-3 completed the coordinator-assigned work.",
          "",
          "Synthesize the final answer as the coordinator."
        ].join("\n"),
        output: "release-coordinator:agent-1 synthesized the coordinator-managed mission."
      }
    ] as const;

    expect(result.output).toBe("release-coordinator:agent-1 synthesized the coordinator-managed mission.");
    expect(result.transcript).toEqual(expectedTranscript);
    expect(result.trace.transcript).toEqual(expectedTranscript);
    expect(result.trace.transcript).toEqual(result.transcript);
    expect(result.trace.protocol).toBe("coordinator");
    expect(result.trace.modelProviderId).toBe("deterministic-coordinator-model");
    expect(result.trace.agentsUsed.map((agent) => agent.id)).toEqual(["agent-1", "agent-2", "agent-3"]);
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);

    const finalEvent = result.trace.events.at(-1);
    expect(finalEvent?.type).toBe("final");
    if (finalEvent?.type !== "final") {
      throw new Error("expected final event");
    }
    expect(finalEvent.output).toBe(result.output);
    expect(finalEvent.cost).toEqual(result.cost);
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
    expect(result.cost.totalTokens).toBeGreaterThan(0);
  });
});

function createPhaseEchoProvider(id: string, requests: ModelRequest[] = []): ConfiguredModelProvider {
  return {
    id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      requests.push(request);
      return {
        text: `${String(request.metadata.phase)}:${String(request.metadata.role)}:${String(
          request.metadata.agentId
        )}`,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        },
        costUsd: 0
      };
    }
  };
}

function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

const PARTICIPATE_OUTPUT = [
  "role_selected: coordinator",
  "participation: contribute",
  "rationale: synthesize after sub-run",
  "contribution:",
  "synthesized after sub-run"
].join("\n");

function delegateBlock(payload: { protocol: string; intent: string; model?: string; budget?: { timeoutMs?: number } }): string {
  return [
    "delegate:",
    "```json",
    JSON.stringify(payload),
    "```",
    ""
  ].join("\n");
}

interface ScriptedProviderOptions {
  readonly id?: string;
  readonly planResponses: readonly string[];
  readonly workerResponse?: string;
  readonly finalResponse?: string;
  readonly recordedRequests?: ModelRequest[];
  readonly providerSpy?: { received?: ConfiguredModelProvider };
}

/**
 * Provider whose plan-phase responses are scripted in order. Worker and
 * final-synthesis phases return a fixed safe text. Used by the delegate
 * scenario tests.
 */
function createScriptedCoordinatorProvider(opts: ScriptedProviderOptions): ConfiguredModelProvider {
  let planIndex = 0;
  const provider: ConfiguredModelProvider = {
    id: opts.id ?? "scripted-coordinator-model",
    async generate(request: ModelRequest): Promise<ModelResponse> {
      opts.recordedRequests?.push(request);
      const phase = String(request.metadata.phase);
      let text: string;
      if (phase === "plan") {
        text = opts.planResponses[planIndex] ?? PARTICIPATE_OUTPUT;
        planIndex += 1;
      } else if (phase === "worker") {
        text = opts.workerResponse ?? "worker output";
      } else {
        text = opts.finalResponse ?? "final output";
      }
      return {
        text,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        costUsd: 0
      };
    }
  };
  return provider;
}

describe("coordinator delegate dispatch", () => {
  it("dispatches a delegate to sequential and threads result back into the next coordinator prompt", async () => {
    const planRequests: ModelRequest[] = [];
    const childProtocolSeen: string[] = [];
    const provider = createScriptedCoordinatorProvider({
      id: "delegate-happy-path-model",
      planResponses: [
        delegateBlock({ protocol: "sequential", intent: "investigate the slow path" }),
        PARTICIPATE_OUTPUT
      ],
      recordedRequests: planRequests
    });

    // Wrap so we can observe child requests too.
    const originalGenerate = provider.generate.bind(provider);
    const trackedProvider: ConfiguredModelProvider = {
      id: provider.id,
      async generate(request) {
        const protocol = String(request.metadata.protocol);
        childProtocolSeen.push(protocol);
        return originalGenerate(request);
      }
    };

    const result = await run({
      intent: "Run a coordinator that delegates once.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: trackedProvider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });

    const subRunStarted = result.trace.events.filter((event) => event.type === "sub-run-started");
    const subRunCompleted = result.trace.events.filter((event) => event.type === "sub-run-completed");
    expect(subRunStarted).toHaveLength(1);
    expect(subRunCompleted).toHaveLength(1);

    const startEvent = subRunStarted[0];
    if (startEvent?.type !== "sub-run-started") throw new Error("expected sub-run-started");
    expect(startEvent.protocol).toBe("sequential");
    expect(startEvent.intent).toBe("investigate the slow path");
    expect(startEvent.depth).toBe(1);
    // D-16: NOT recursive when child protocol is sequential.
    expect("recursive" in startEvent).toBe(false);

    // Sub-run-started precedes sub-run-completed in event order.
    const startIndex = result.trace.events.indexOf(startEvent);
    const completedIndex = result.trace.events.findIndex((event) => event.type === "sub-run-completed");
    expect(startIndex).toBeLessThan(completedIndex);

    // Synthetic D-18 transcript entry exists.
    const subRunEntry = result.transcript.find((entry) => entry.role === "delegate-result");
    expect(subRunEntry).toBeDefined();
    expect(subRunEntry?.agentId).toMatch(/^sub-run:/u);

    // D-17 tagged text appeared in a follow-up plan request.
    const followUpPlanRequest = planRequests.filter((request) => String(request.metadata.phase) === "plan")[1];
    const userMessage = followUpPlanRequest?.messages.find((message) => message.role === "user")?.content ?? "";
    expect(userMessage).toContain(`[sub-run ${startEvent.childRunId}]`);
    expect(userMessage).toContain(`[sub-run ${startEvent.childRunId} stats]`);

    // Child invoked through the same provider id (D-11).
    expect(childProtocolSeen).toContain("sequential");

    // Trace round-trips through JSON.
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
  });

  it("emits sub-run-failed with a partialTrace built from the child emit buffer", async () => {
    const provider: ConfiguredModelProvider = {
      id: "delegate-failure-model",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        const phase = String(request.metadata.phase);
        const protocol = String(request.metadata.protocol);
        if (protocol === "sequential") {
          // Child run path. After role-assignment events fire, throw.
          throw new DogpileError({
            code: "provider-timeout",
            message: "Child sequential run timed out for the test.",
            providerId: "delegate-failure-model",
            retryable: false
          });
        }
        if (phase === "plan") {
          return {
            text: delegateBlock({ protocol: "sequential", intent: "force a child failure" }),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            costUsd: 0
          };
        }
        return {
          text: "should not reach",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          costUsd: 0
        };
      }
    };

    const failure = await run({
      intent: "Run a coordinator whose delegate child fails.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    }).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error })
    );

    expect(failure.ok).toBe(false);
    if (failure.ok) throw new Error("expected failure");
    expect(DogpileError.isInstance(failure.error)).toBe(true);
    if (!DogpileError.isInstance(failure.error)) throw new Error("not a DogpileError");
    expect(failure.error.code).toBe("provider-timeout");
  });

  it("captures partialTrace from buffered tee for sub-run-failed events", async () => {
    const subRunFailedEvents: RunEvent[] = [];
    const provider: ConfiguredModelProvider = {
      id: "delegate-failure-tee-model",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        const phase = String(request.metadata.phase);
        const protocol = String(request.metadata.protocol);
        if (protocol === "sequential") {
          throw new DogpileError({
            code: "provider-timeout",
            message: "Child sequential run timed out for the test.",
            providerId: "delegate-failure-tee-model",
            retryable: false
          });
        }
        if (phase === "plan") {
          return {
            text: delegateBlock({ protocol: "sequential", intent: "force a child failure" }),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            costUsd: 0
          };
        }
        return { text: "should not reach", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, costUsd: 0 };
      }
    };

    const handle = stream({
      intent: "Stream a coordinator whose delegate child fails so we can inspect the failure event.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });
    handle.subscribe((event) => {
      if ((event as RunEvent).type === "sub-run-failed") {
        subRunFailedEvents.push(event as RunEvent);
      }
    });

    await handle.result.catch(() => {});

    expect(subRunFailedEvents).toHaveLength(1);
    const failEvent = subRunFailedEvents[0];
    if (failEvent?.type !== "sub-run-failed") throw new Error("expected sub-run-failed");
    expect(failEvent.error.code).toBe("provider-timeout");
    const failedDecision = failEvent.error.detail?.["failedDecision"] as JsonObject | undefined;
    expect(failedDecision).toBeDefined();
    expect(failedDecision?.["protocol"]).toBe("sequential");
    expect(failedDecision?.["intent"]).toBe("force a child failure");
    // partialTrace contains the child events emitted before the throw (the
    // child emits role-assignment events before invoking the model).
    expect(failEvent.partialTrace.events.length).toBeGreaterThan(0);
    expect(failEvent.partialTrace.runId).toBe(failEvent.childRunId);
    // Every buffered child event shares the same internal runId (one child run).
    const childInternalRunIds = new Set(failEvent.partialTrace.events.map((event) => event.runId));
    expect(childInternalRunIds.size).toBe(1);
  });

  it("sets recursive: true when the child protocol is also coordinator", async () => {
    const provider = createScriptedCoordinatorProvider({
      id: "delegate-recursive-model",
      planResponses: [
        delegateBlock({ protocol: "coordinator", intent: "delegate to a child coordinator" }),
        PARTICIPATE_OUTPUT,
        // The recursive child coordinator's plan turn — also needs a response.
        PARTICIPATE_OUTPUT
      ]
    });

    const result = await run({
      intent: "Recursive coordinator delegate.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });

    const subRunStarted = result.trace.events.find((event) => event.type === "sub-run-started");
    if (subRunStarted?.type !== "sub-run-started") throw new Error("expected sub-run-started");
    expect(subRunStarted.protocol).toBe("coordinator");
    expect(subRunStarted.recursive).toBe(true);
  });

  it("inherits parent provider object reference verbatim into the child run", async () => {
    const seenProviders: ConfiguredModelProvider[] = [];
    let planIndex = 0;
    const planResponses = [
      delegateBlock({ protocol: "sequential", intent: "child reuses parent provider" }),
      PARTICIPATE_OUTPUT
    ];
    const provider: ConfiguredModelProvider = {
      id: "delegate-provider-inheritance-model",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        seenProviders.push(provider);
        const phase = String(request.metadata.phase);
        const text =
          phase === "plan" ? (planResponses[planIndex++] ?? PARTICIPATE_OUTPUT)
          : phase === "worker" ? "worker output"
          : "final output";
        return { text, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, costUsd: 0 };
      }
    };

    const result = await run({
      intent: "Provider inheritance.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });

    expect(seenProviders.length).toBeGreaterThan(0);
    expect(seenProviders.every((seen) => Object.is(seen, provider))).toBe(true);
    // Child runs were observed (sub-run-completed exists).
    expect(result.trace.events.some((event) => event.type === "sub-run-completed")).toBe(true);
  });

  it("rejects delegate decisions with a model id that does not match the parent provider before any sub-run-started event is emitted", async () => {
    const provider = createScriptedCoordinatorProvider({
      id: "delegate-model-mismatch-model",
      planResponses: [
        delegateBlock({
          protocol: "sequential",
          intent: "wrong model id",
          model: "different-id"
        })
      ]
    });

    const observedEvents: string[] = [];
    const handle = stream({
      intent: "Model-id mismatch should throw before sub-run-started.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });
    handle.subscribe((event) => observedEvents.push(event.type));

    const outcome = await handle.result.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected throw");
    expect(DogpileError.isInstance(outcome.error)).toBe(true);
    if (!DogpileError.isInstance(outcome.error)) throw new Error("not DogpileError");
    expect(outcome.error.code).toBe("invalid-configuration");
    expect(outcome.error.detail?.["path"]).toBe("decision.model");
    // Crucially: sub-run-started never fired.
    expect(observedEvents).not.toContain("sub-run-started");
  });

  it("rejects delegate decisions emitted by workers", async () => {
    let planIndex = 0;
    const provider: ConfiguredModelProvider = {
      id: "worker-delegate-rejection-model",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        const phase = String(request.metadata.phase);
        if (phase === "plan") {
          const text =
            planIndex === 0
              ? PARTICIPATE_OUTPUT
              : PARTICIPATE_OUTPUT;
          planIndex += 1;
          return { text, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, costUsd: 0 };
        }
        if (phase === "worker") {
          return {
            text: delegateBlock({ protocol: "sequential", intent: "worker tries to delegate" }),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            costUsd: 0
          };
        }
        return { text: "final", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, costUsd: 0 };
      }
    };

    const outcome = await run({
      intent: "Worker delegate rejection.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error })
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected throw");
    expect(DogpileError.isInstance(outcome.error)).toBe(true);
    if (!DogpileError.isInstance(outcome.error)) throw new Error("not DogpileError");
    expect(outcome.error.code).toBe("invalid-configuration");
    expect(outcome.error.message).toContain("Phase 1");
  });

  it("trips the loop guard after MAX_DISPATCH_PER_TURN consecutive delegate decisions", async () => {
    const provider: ConfiguredModelProvider = {
      id: "delegate-loop-guard-model",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        const phase = String(request.metadata.phase);
        const protocol = String(request.metadata.protocol);
        if (protocol === "sequential") {
          // Child sequential run — return a plain participate response.
          return {
            text: PARTICIPATE_OUTPUT,
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            costUsd: 0
          };
        }
        if (phase === "plan") {
          return {
            text: delegateBlock({ protocol: "sequential", intent: "loop forever" }),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            costUsd: 0
          };
        }
        return { text: "noop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, costUsd: 0 };
      }
    };

    const observedEvents: RunEvent[] = [];
    const handle = stream({
      intent: "Loop-guard exceeded.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });
    handle.subscribe((event) => observedEvents.push(event as RunEvent));

    const outcome = await handle.result.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected loop-guard throw");
    expect(DogpileError.isInstance(outcome.error)).toBe(true);
    if (!DogpileError.isInstance(outcome.error)) throw new Error("not DogpileError");
    expect(outcome.error.code).toBe("invalid-configuration");
    expect(outcome.error.detail?.["reason"]).toBe("loop-guard-exceeded");

    // Event log shows 8 successful sub-run-started/completed pairs before the
    // guard fired (the 9th attempt throws before sub-run-started is emitted).
    const startedCount = observedEvents.filter((event) => event.type === "sub-run-started").length;
    const completedCount = observedEvents.filter((event) => event.type === "sub-run-completed").length;
    expect(startedCount).toBe(8);
    expect(completedCount).toBe(8);
  });
});

describe("BUDGET-02 sub-run timeout / deadline propagation", () => {
  it("clamps decision.budget.timeoutMs that exceeds parent's remaining and emits sub-run-budget-clamped before sub-run-started", async () => {
    // Parent has a 1000ms tree-wide deadline. Child decision asks for 5000ms.
    // Even when dispatch happens immediately (remainingMs ≈ 1000), the
    // decision exceeds the parent's remaining and must be clamped to ≤ 1000ms,
    // with `sub-run-budget-clamped` emitted on the parent trace BEFORE
    // `sub-run-started`. The clamp event captures requestedTimeoutMs=5000 and
    // clampedTimeoutMs <= 1000.
    const provider = createScriptedCoordinatorProvider({
      id: "budget-02-clamp-event-model",
      planResponses: [
        delegateBlock({
          protocol: "sequential",
          intent: "child whose decision-level timeout exceeds parent remaining",
          budget: { timeoutMs: 5000 }
        }),
        PARTICIPATE_OUTPUT
      ]
    });

    const result = await run({
      intent: "Verify clamp emits sub-run-budget-clamped before sub-run-started.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ],
      budget: { timeoutMs: 1000 }
    });

    const clampEvents = result.trace.events.filter((event) => event.type === "sub-run-budget-clamped");
    const startedEvents = result.trace.events.filter((event) => event.type === "sub-run-started");
    expect(clampEvents).toHaveLength(1);
    expect(startedEvents).toHaveLength(1);

    const clampEvent = clampEvents[0];
    if (clampEvent?.type !== "sub-run-budget-clamped") throw new Error("expected sub-run-budget-clamped");
    expect(clampEvent.requestedTimeoutMs).toBe(5000);
    expect(clampEvent.clampedTimeoutMs).toBeLessThanOrEqual(1000);
    expect(clampEvent.clampedTimeoutMs).toBeGreaterThan(0);
    expect(clampEvent.reason).toBe("exceeded-parent-remaining");

    // Ordering: the clamp event must appear BEFORE sub-run-started in the trace.
    const clampIndex = result.trace.events.indexOf(clampEvent);
    const startedIndex = result.trace.events.findIndex((event) => event.type === "sub-run-started");
    expect(clampIndex).toBeGreaterThanOrEqual(0);
    expect(startedIndex).toBeGreaterThan(clampIndex);

    // Sub-run-started must reference the same childRunId as the clamp event.
    const startedEvent = startedEvents[0];
    if (startedEvent?.type !== "sub-run-started") throw new Error("expected sub-run-started");
    expect(clampEvent.childRunId).toBe(startedEvent.childRunId);

    // Trace round-trips through JSON (locks the variant on a real run shape).
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
  });

  it("does NOT emit sub-run-budget-clamped on the happy path (decision within parent remaining)", async () => {
    const provider = createScriptedCoordinatorProvider({
      id: "budget-02-no-clamp-model",
      planResponses: [
        delegateBlock({
          protocol: "sequential",
          intent: "child whose decision-level timeout fits parent remaining",
          budget: { timeoutMs: 100 }
        }),
        PARTICIPATE_OUTPUT
      ]
    });

    const result = await run({
      intent: "Verify happy path skips sub-run-budget-clamped.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ],
      budget: { timeoutMs: 5000 }
    });

    expect(result.trace.events.some((event) => event.type === "sub-run-budget-clamped")).toBe(false);
    expect(result.trace.events.some((event) => event.type === "sub-run-started")).toBe(true);
  });

  it("zero-remaining gate throws code: aborted with detail.reason 'timeout' BEFORE sub-run-started", async () => {
    // Drive `runCoordinator` directly with `parentDeadlineMs` set in the past
    // so the zero-remaining gate fires deterministically. This exercises the
    // gate without entanglement with the engine-level setTimeout(timeoutMs)
    // path that would otherwise abort the whole tree first.
    const { runCoordinator } = await import("../runtime/coordinator.js");
    const observedEvents: RunEvent[] = [];
    const provider: ConfiguredModelProvider = {
      id: "budget-02-zero-remaining-direct",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        const phase = String(request.metadata.phase);
        if (phase === "plan") {
          return {
            text: delegateBlock({ protocol: "sequential", intent: "should not start" }),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            costUsd: 0
          };
        }
        return {
          text: phase === "worker" ? "worker output" : "final output",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          costUsd: 0
        };
      }
    };

    const outcome = await runCoordinator({
      intent: "Direct coordinator run with already-elapsed parentDeadlineMs.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ],
      tools: [],
      temperature: 0.5,
      parentDeadlineMs: Date.now() - 10_000,
      runProtocol: async () => {
        throw new Error("runProtocol must NOT be called when zero-remaining gate fires");
      },
      emit(event: RunEvent): void {
        observedEvents.push(event);
      }
    }).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error })
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected zero-remaining gate to throw");
    expect(DogpileError.isInstance(outcome.error)).toBe(true);
    if (!DogpileError.isInstance(outcome.error)) throw new Error("not DogpileError");
    expect(outcome.error.code).toBe("aborted");
    expect(outcome.error.detail?.["reason"]).toBe("timeout");
    expect(outcome.error.message).toContain("Parent deadline elapsed");
    // Crucially: sub-run-started never fired.
    expect(observedEvents.some((event) => event.type === "sub-run-started")).toBe(false);
    expect(observedEvents.some((event) => event.type === "sub-run-budget-clamped")).toBe(false);
  });

  it("defaultSubRunTimeoutMs precedence: applies when neither parent nor decision specifies a timeout", async () => {
    const childBudgetsSeen: Array<number | undefined> = [];
    const provider = createScriptedCoordinatorProvider({
      id: "budget-02-default-precedence-model",
      planResponses: [
        delegateBlock({ protocol: "sequential", intent: "no decision-level budget" }),
        PARTICIPATE_OUTPUT
      ]
    });
    // Spy on child sub-run-completed events to inspect the actual budget the
    // child run executed under (via the embedded child trace).
    const result = await run({
      intent: "Verify defaultSubRunTimeoutMs is applied when neither parent nor decision specifies.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ],
      defaultSubRunTimeoutMs: 7777
    });

    for (const event of result.trace.events) {
      if (event.type === "sub-run-completed") {
        childBudgetsSeen.push(event.subResult.trace.budget.caps?.timeoutMs);
      }
    }
    expect(childBudgetsSeen).toHaveLength(1);
    expect(childBudgetsSeen[0]).toBe(7777);
  });

  it("defaultSubRunTimeoutMs is IGNORED when the parent has a budget.timeoutMs (parent's remaining wins)", async () => {
    const provider = createScriptedCoordinatorProvider({
      id: "budget-02-default-ignored-model",
      planResponses: [
        delegateBlock({ protocol: "sequential", intent: "parent budget wins" }),
        PARTICIPATE_OUTPUT
      ]
    });

    const result = await run({
      intent: "Verify defaultSubRunTimeoutMs is ignored when parent has a budget.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ],
      budget: { timeoutMs: 2000 },
      defaultSubRunTimeoutMs: 99_999
    });

    const completed = result.trace.events.find((event) => event.type === "sub-run-completed");
    if (completed?.type !== "sub-run-completed") throw new Error("expected sub-run-completed");
    const childTimeoutMs = completed.subResult.trace.budget.caps?.timeoutMs;
    // Parent's remaining (≤ 2000ms) wins; engine default of 99_999 must not leak through.
    expect(childTimeoutMs).toBeDefined();
    expect(childTimeoutMs).toBeLessThanOrEqual(2000);
    expect(childTimeoutMs).not.toBe(99_999);
  });
});
