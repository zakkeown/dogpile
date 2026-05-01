import { describe, expect, it } from "vitest";
import { replayStream, run, stream } from "../index.js";
import type { ConfiguredModelProvider, ModelOutputChunk, ModelRequest, ModelResponse, RunResult, StreamEvent } from "../index.js";

describe("SDK streaming API", () => {
  it("returns the same final output value as the equivalent non-streaming call", async () => {
    const nonStreamingResult = await run({
      intent: "Compare final outputs for equivalent execution modes.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "balanced",
      model: createResolvedModelProvider("non-streaming-equivalence-model", [
        "planner equivalent output",
        "critic equivalent final output"
      ]),
      agents: [
        { id: "planner", role: "planner" },
        { id: "critic", role: "critic" }
      ]
    });
    const handle = stream({
      intent: "Compare final outputs for equivalent execution modes.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "balanced",
      model: createResolvedModelProvider("streaming-equivalence-model", [
        "planner equivalent output",
        "critic equivalent final output"
      ]),
      agents: [
        { id: "planner", role: "planner" },
        { id: "critic", role: "critic" }
      ]
    });
    const streamedEvents: StreamEvent[] = [];

    for await (const event of handle) {
      streamedEvents.push(event);
    }

    const streamingResult = await handle.result;
    const finalEvent = streamedEvents.at(-1);

    expect(nonStreamingResult.output).toBe("critic equivalent final output");
    expect(streamingResult.output).toBe(nonStreamingResult.output);
    expect(finalEvent).toMatchObject({
      type: "final",
      output: nonStreamingResult.output
    });
    expect(streamingResult.trace.events.at(-1)).toEqual(finalEvent);
  });

  it("records the same completed trace and transcript data as the equivalent non-streaming call", async () => {
    const options = {
      intent: "Verify trace and transcript parity for equivalent execution modes.",
      protocol: { kind: "sequential", maxTurns: 2 } as const,
      tier: "balanced" as const,
      agents: [
        { id: "planner", role: "planner" },
        { id: "critic", role: "critic" }
      ]
    };
    const responses = ["planner trace contribution", "critic trace conclusion"];
    const nonStreamingResult = await run({
      ...options,
      model: createResolvedModelProvider("trace-parity-model", responses)
    });
    const handle = stream({
      ...options,
      model: createResolvedModelProvider("trace-parity-model", responses)
    });
    const streamedEvents: StreamEvent[] = [];

    for await (const event of handle) {
      streamedEvents.push(event);
    }

    const streamingResult = await handle.result;

    expect(streamedEvents).toEqual(streamingResult.trace.events);
    expect(streamingResult.transcript).toEqual(nonStreamingResult.transcript);
    expect(streamingResult.trace.transcript).toEqual(nonStreamingResult.trace.transcript);
    expect(streamingResult.eventLog).toEqual({
      kind: "run-event-log",
      runId: streamingResult.trace.runId,
      protocol: "sequential",
      eventTypes: streamingResult.trace.events.map((event) => event.type),
      eventCount: streamingResult.trace.events.length,
      events: streamingResult.trace.events
    });
    expect(withoutDynamicTraceFields(streamingResult.trace)).toEqual(
      withoutDynamicTraceFields(nonStreamingResult.trace)
    );
    expect(withoutDynamicTraceFields(streamingResult.eventLog)).toEqual(
      withoutDynamicTraceFields(nonStreamingResult.eventLog)
    );
  });

  it("reports the same cost and budget accounting data as the equivalent non-streaming call", async () => {
    const options = {
      intent: "Verify cost and budget accounting parity for equivalent execution modes.",
      protocol: { kind: "sequential", maxTurns: 3 } as const,
      tier: "fast" as const,
      budget: { maxIterations: 2, maxUsd: 1, maxTokens: 100 },
      agents: [
        { id: "planner", role: "planner" },
        { id: "critic", role: "critic" },
        { id: "synthesizer", role: "synthesizer" }
      ]
    };
    const responses = ["planner budget output", "critic budget output", "unused synthesizer output"];
    const nonStreamingResult = await run({
      ...options,
      model: createResolvedModelProvider("budget-accounting-parity-model", responses)
    });
    const handle = stream({
      ...options,
      model: createResolvedModelProvider("budget-accounting-parity-model", responses)
    });
    const streamedEvents: StreamEvent[] = [];

    for await (const event of handle) {
      streamedEvents.push(event);
    }

    const streamingResult = await handle.result;
    const streamingFinalEvent = streamingResult.trace.events.at(-1);
    const nonStreamingFinalEvent = nonStreamingResult.trace.events.at(-1);
    const streamingBudgetStop = streamingResult.trace.events.find((event) => event.type === "budget-stop");
    const nonStreamingBudgetStop = nonStreamingResult.trace.events.find((event) => event.type === "budget-stop");

    expect(streamingResult.cost).toEqual(nonStreamingResult.cost);
    expect(streamingResult.usage).toEqual(nonStreamingResult.usage);
    expect(streamingFinalEvent?.type).toBe("final");
    expect(nonStreamingFinalEvent?.type).toBe("final");
    expect(streamingFinalEvent).toMatchObject({
      type: "final",
      cost: nonStreamingResult.cost
    });
    expect(withoutDynamicTraceFields(streamingFinalEvent)).toEqual(
      withoutDynamicTraceFields(nonStreamingFinalEvent)
    );
    expect(streamingBudgetStop).toMatchObject({
      type: "budget-stop",
      reason: "iterations",
      cost: nonStreamingResult.cost,
      iteration: 2,
      detail: {
        cap: "maxIterations",
        limit: 2,
        observed: 2
      }
    });
    expect(withoutDynamicTraceFields(streamingBudgetStop)).toEqual(
      withoutDynamicTraceFields(nonStreamingBudgetStop)
    );
    expect(streamingResult.metadata).toEqual({
      ...nonStreamingResult.metadata,
      runId: streamingResult.trace.runId,
      startedAt: streamingResult.trace.events[0]?.at,
      completedAt: streamingFinalEvent?.at
    });
    expect(withoutDynamicTraceFields(streamingResult.eventLog)).toEqual(
      withoutDynamicTraceFields(nonStreamingResult.eventLog)
    );
    expect(streamedEvents).toEqual(streamingResult.trace.events);
  });

  it("reports the same quality and evaluation data as the equivalent non-streaming call", async () => {
    const options = {
      intent: "Verify judged quality parity for equivalent execution modes.",
      protocol: { kind: "sequential", maxTurns: 2 } as const,
      tier: "quality" as const,
      agents: [
        { id: "planner", role: "planner" },
        { id: "critic", role: "critic" }
      ],
      evaluate(result: Omit<RunResult, "quality" | "evaluation">) {
        return {
          quality: 0.87,
          rationale: `Judged ${result.trace.protocol} output from ${result.transcript.length} turns.`,
          metadata: {
            evaluator: "streaming-parity-fixture",
            output,
            eventCount: result.trace.events.length
          }
        };
      }
    };
    const responses = ["planner judged output", output];
    const nonStreamingResult = await run({
      ...options,
      model: createResolvedModelProvider("quality-parity-model", responses)
    });
    const handle = stream({
      ...options,
      model: createResolvedModelProvider("quality-parity-model", responses)
    });
    const streamedEvents: StreamEvent[] = [];

    for await (const event of handle) {
      streamedEvents.push(event);
    }

    const streamingResult = await handle.result;
    const streamingFinalEvent = streamedEvents.at(-1);
    const nonStreamingFinalEvent = nonStreamingResult.trace.events.at(-1);

    expect(streamingResult.quality).toBe(nonStreamingResult.quality);
    expect(streamingResult.evaluation).toEqual(nonStreamingResult.evaluation);
    expect(streamingFinalEvent).toMatchObject({
      type: "final",
      output,
      quality: nonStreamingResult.quality,
      evaluation: nonStreamingResult.evaluation
    });
    expect(withoutDynamicTraceFields(streamingFinalEvent)).toEqual(
      withoutDynamicTraceFields(nonStreamingFinalEvent)
    );
    expect(streamingResult.trace.events.at(-1)).toEqual(streamingFinalEvent);
    expect(streamedEvents).toEqual(streamingResult.trace.events);
    expect(withoutDynamicTraceFields(streamingResult.eventLog)).toEqual(
      withoutDynamicTraceFields(nonStreamingResult.eventLog)
    );
  });

  it("preserves event order across the iterator, subscribers, and completed trace", async () => {
    const gates = createResponseGates(["first ordered turn", "second ordered turn"]);
    const model = createGatedModelProvider("ordered-stream-model", gates);
    const handle = stream({
      intent: "Preserve the same stream event order across every observer.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "balanced",
      model,
      agents: [
        { id: "alpha", role: "planner" },
        { id: "beta", role: "critic" }
      ]
    });
    const subscriberEvents: StreamEvent[] = [];
    handle.subscribe((event) => {
      subscriberEvents.push(event);
    });

    const iterator = handle[Symbol.asyncIterator]();

    const firstRole = await iterator.next();
    const secondRole = await iterator.next();
    expect([firstRole.value?.type, secondRole.value?.type]).toEqual(["role-assignment", "role-assignment"]);

    const firstGate = requireGate(gates, 0);
    await waitForRequest(firstGate);
    firstGate.resolve("alpha ordered output");

    const firstTurn = await iterator.next();
    expect(firstTurn.value).toMatchObject({
      type: "agent-turn",
      agentId: "alpha",
      output: "alpha ordered output"
    });

    const secondGate = requireGate(gates, 1);
    await waitForRequest(secondGate);
    secondGate.resolve("beta ordered output");

    const secondTurn = await iterator.next();
    const finalEvent = await iterator.next();
    const result = await handle.result;

    expect(secondTurn.value).toMatchObject({
      type: "agent-turn",
      agentId: "beta",
      output: "beta ordered output"
    });
    expect(finalEvent.value).toMatchObject({
      type: "final",
      output: "beta ordered output"
    });

    const iteratorEvents = [firstRole.value, secondRole.value, firstTurn.value, secondTurn.value, finalEvent.value];
    expect(iteratorEvents.map((event) => event?.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(subscriberEvents).toEqual(iteratorEvents);
    expect(result.trace.events).toEqual(iteratorEvents);
    expect(new Set(result.trace.events.map((event) => event.runId))).toEqual(new Set([result.trace.runId]));
  });

  it("closes the async iterator after successful completion and replays completed events to late subscribers", async () => {
    const handle = stream({
      intent: "Close the stream after final output.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: createGatedModelProvider("completion-stream-model", createResolvedResponseGates(["complete output"])),
      agents: [{ id: "closer", role: "synthesizer" }]
    });
    const iterator = handle[Symbol.asyncIterator]();

    expect((await iterator.next()).value?.type).toBe("role-assignment");
    const turn = await iterator.next();
    const finalEvent = await iterator.next();
    const result = await handle.result;
    const afterCompletion = await iterator.next();
    const lateSubscriberEvents: StreamEvent[] = [];

    handle.subscribe((event) => {
      lateSubscriberEvents.push(event);
    });

    expect(turn.value).toMatchObject({
      type: "agent-turn",
      output: "complete output"
    });
    expect(finalEvent.value).toMatchObject({
      type: "final",
      output: result.output,
      transcript: {
        kind: "trace-transcript",
        entryCount: result.transcript.length,
        lastEntryIndex: result.transcript.length - 1
      }
    });
    expect(afterCompletion).toEqual({ done: true, value: undefined });
    expect(lateSubscriberEvents).toEqual(result.trace.events);
  });

  it("emits one error event and rejects result with the original model error", async () => {
    const modelError = new TypeError("model provider failed during stream()");
    const handle = stream({
      intent: "Propagate stream failures.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "balanced",
      model: createFailingModelProvider("failing-stream-model", modelError),
      agents: [{ id: "failing-agent", role: "writer" }]
    });
    const resultRejection = handle.result.catch((error: unknown) => error);
    const iterator = handle[Symbol.asyncIterator]();

    const roleAssignment = await iterator.next();
    const errorEvent = await iterator.next();
    const afterError = await iterator.next();
    const rejectedError = await resultRejection;

    expect(roleAssignment.value).toMatchObject({
      type: "role-assignment",
      agentId: "failing-agent",
      role: "writer"
    });
    expect(errorEvent.value).toMatchObject({
      type: "error",
      runId: roleAssignment.value?.runId,
      name: "TypeError",
      message: "model provider failed during stream()"
    });
    expect(afterError).toEqual({ done: true, value: undefined });
    expect(rejectedError).toBe(modelError);
  });

  it("yields model output chunks before the completed turn and final result", async () => {
    const chunkStream = createChunkStreamController();
    const model = createStreamingModelProvider("streaming-chunk-model", chunkStream);
    const handle = stream({
      intent: "Stream raw model output chunks while the turn is still generating.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "balanced",
      model,
      agents: [{ id: "writer", role: "writer" }]
    });
    const iterator = handle[Symbol.asyncIterator]();
    const resultState = observeResult(handle.result);

    expect((await iterator.next()).value?.type).toBe("role-assignment");
    await chunkStream.started;
    expect(resultState.settled).toBe(false);

    chunkStream.resolveFirst("partial ");
    const firstChunk = await iterator.next();
    expect(firstChunk.done).toBe(false);
    expect(firstChunk.value).toMatchObject({
      type: "model-output-chunk",
      agentId: "writer",
      role: "writer",
      chunkIndex: 0,
      text: "partial ",
      output: "partial "
    });
    expect(resultState.settled).toBe(false);

    chunkStream.resolveSecond("done");
    const secondChunk = await iterator.next();
    expect(secondChunk.value).toMatchObject({
      type: "model-output-chunk",
      agentId: "writer",
      role: "writer",
      chunkIndex: 1,
      text: "done",
      output: "partial done"
    });

    const completedTurn = await iterator.next();
    expect(completedTurn.value).toMatchObject({
      type: "agent-turn",
      agentId: "writer",
      role: "writer",
      output: "partial done"
    });
    expect(resultState.settled).toBe(false);

    const finalEvent = await iterator.next();
    expect(finalEvent.value?.type).toBe("final");
    const result = await handle.result;
    expect(result.output).toBe("partial done");
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "model-output-chunk",
      "model-output-chunk",
      "agent-turn",
      "final"
    ]);
    expect(result.trace.events.at(1)).toEqual(firstChunk.value);
    expect(result.trace.events.at(2)).toEqual(secondChunk.value);
  });

  it("passes a caller AbortSignal through streamed model requests", async () => {
    const abortController = new AbortController();
    const requests: ModelRequest[] = [];
    const model: ConfiguredModelProvider = {
      id: "stream-abort-signal-model",
      async generate(): Promise<ModelResponse> {
        throw new Error("streaming provider should be consumed through stream()");
      },
      async *stream(request: ModelRequest): AsyncIterable<ModelOutputChunk> {
        requests.push(request);
        yield { text: "streamed with signal" };
      }
    };

    const handle = stream({
      intent: "Verify caller cancellation plumbing reaches streamed model requests.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "balanced",
      model,
      agents: [{ id: "writer", role: "writer" }],
      signal: abortController.signal
    });

    const streamedEvents: StreamEvent[] = [];
    for await (const event of handle) {
      streamedEvents.push(event);
    }

    const result = await handle.result;

    expect(requests).toHaveLength(1);
    expect(requests[0]?.signal).toBeDefined();
    expect(requests[0]?.signal?.aborted).toBe(false);
    expect(result.output).toBe("streamed with signal");
    expect(result.trace.providerCalls).toHaveLength(1);
    expect(result.trace.providerCalls[0]?.request.signal).toBeUndefined();
    expect(streamedEvents.map((event) => event.type)).toEqual([
      "role-assignment",
      "model-output-chunk",
      "agent-turn",
      "final"
    ]);
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
  });

  it("STREAM-01 wraps bubbled child events with parentRunIds while parent events remain root-level", async () => {
    const handle = stream({
      intent: "Wrap direct child stream events.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: createDelegatingProvider("stream-wrap-depth-1-model", [
        delegateBlock({ protocol: "sequential", intent: "direct child" }),
        PARTICIPATE_OUTPUT
      ]),
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });

    const streamedEvents = await collectEvents(handle);
    const result = await handle.result;
    const childRunId = childRunIds(result)[0];
    if (!childRunId) {
      throw new Error("missing child run id");
    }
    const childEvents = streamedEvents.filter((event) => event.runId === childRunId);
    const parentEvents = streamedEvents.filter((event) => event.runId === result.trace.runId);

    expect(childEvents.length).toBeGreaterThan(0);
    expect(childEvents.every((event) => parentRunIdsOf(event)?.join("/") === result.trace.runId)).toBe(true);
    expect(parentEvents.every((event) => parentRunIdsOf(event) === undefined)).toBe(true);
  });

  it("STREAM-01 wraps grandchild events with root-first parentRunIds", async () => {
    const handle = stream({
      intent: "Wrap grandchild stream events.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: createDelegatingProvider("stream-wrap-depth-2-model", [
        delegateBlock({ protocol: "coordinator", intent: "child coordinator" }),
        delegateBlock({ protocol: "sequential", intent: "grandchild worker" }),
        PARTICIPATE_OUTPUT,
        PARTICIPATE_OUTPUT
      ]),
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });

    const streamedEvents = await collectEvents(handle);
    const result = await handle.result;
    const rootChildRunId = childRunIds(result)[0];
    if (!rootChildRunId) {
      throw new Error("missing child coordinator run id");
    }
    const childCompleted = result.trace.events.find((event) => event.type === "sub-run-completed");
    if (childCompleted?.type !== "sub-run-completed") {
      throw new Error("missing child coordinator result");
    }
    const grandchildRunId = childRunIds(childCompleted.subResult)[0];
    if (!grandchildRunId) {
      throw new Error("missing grandchild run id");
    }
    const grandchildEvents = streamedEvents.filter((event) => event.runId === grandchildRunId);

    expect(grandchildEvents.length).toBeGreaterThan(0);
    expect(grandchildEvents.every((event) => sameIds(parentRunIdsOf(event), [result.trace.runId, rootChildRunId]))).toBe(
      true
    );
  });

  it("STREAM-02 preserves per-child event order across setImmediate interleaves", async () => {
    const observedOrder: string[] = [];
    const handle = stream({
      intent: "Preserve direct child chunk order.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: createChunkingDelegateProvider({
        id: "stream-child-order-model",
        planResponses: [
          delegateBlock({ protocol: "sequential", intent: "chunking child", budget: { maxIterations: 1 } }),
          PARTICIPATE_OUTPUT
        ],
        chunksPerChild: 20,
        observedOrder
      }),
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });

    const streamedEvents = await collectEvents(handle);
    const result = await handle.result;
    const childRunId = childRunIds(result)[0];
    if (!childRunId) {
      throw new Error("missing child run id");
    }
    const streamedOrder = streamedEvents
      .filter(isModelOutputChunk)
      .filter((event) => event.runId === childRunId)
      .map((event) => event.text);

    expect(streamedOrder).toEqual(observedOrder);
    expect(streamedOrder).toHaveLength(20);
  });

  it("STREAM-02 preserves each parallel child's order without constraining cross-child interleave", async () => {
    const observedByRunId = new Map<string, string[]>();
    const handle = stream({
      intent: "Preserve parallel child subsequences.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      maxConcurrentChildren: 2,
      model: createChunkingDelegateProvider({
        id: "stream-parallel-child-order-model",
        planResponses: [
          delegateBlock([
            { protocol: "sequential", intent: "parallel child A", budget: { maxIterations: 1 } },
            { protocol: "sequential", intent: "parallel child B", budget: { maxIterations: 1 } }
          ]),
          PARTICIPATE_OUTPUT
        ],
        chunksPerChild: 3,
        observedByRunId
      }),
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });

    const streamedEvents = await collectEvents(handle);
    const result = await handle.result;
    const children = childRunIds(result);

    expect(children).toHaveLength(2);
    for (const childRunId of children) {
      const streamedOrder = streamedEvents
        .filter(isModelOutputChunk)
        .filter((event) => event.runId === childRunId)
        .map((event) => event.text);
      expect(streamedOrder).toEqual(observedByRunId.get(childRunId));
    }
  });

  it("D-04 isolation keeps parent and child traces free of parentRunIds after streaming", async () => {
    const handle = stream({
      intent: "Keep persisted traces chain-free after live bubbling.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: createDelegatingProvider("stream-d04-isolation-model", [
        delegateBlock({ protocol: "sequential", intent: "chain-free child trace" }),
        PARTICIPATE_OUTPUT
      ]),
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });

    await collectEvents(handle);
    const result = await handle.result;
    const completed = result.trace.events.find((event) => event.type === "sub-run-completed");

    expect(hasPersistedParentRunIds(result.trace.events)).toBe(false);
    expect(completed?.type).toBe("sub-run-completed");
    if (completed?.type !== "sub-run-completed") {
      throw new Error("missing sub-run-completed event");
    }
    expect(hasPersistedParentRunIds(completed.subResult.trace.events)).toBe(false);
  });

  it("replayStream reconstructs parentRunIds for delegated grandchild stream events", async () => {
    const handle = stream({
      intent: "Replay grandchild ancestry.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      model: createDelegatingProvider("stream-replay-parentRunIds-model", [
        delegateBlock({ protocol: "coordinator", intent: "child coordinator for replay" }),
        delegateBlock({ protocol: "sequential", intent: "grandchild worker for replay" }),
        PARTICIPATE_OUTPUT,
        PARTICIPATE_OUTPUT
      ]),
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });
    const liveEvents = await collectEvents(handle);
    const result = await handle.result;
    const replayedEvents = await collectEvents(replayStream(result.trace));
    const liveGrandchild = liveEvents.find((event) => parentRunIdsOf(event)?.length === 2);
    const replayedGrandchild = replayedEvents.find((event) => event.runId === liveGrandchild?.runId);

    expect(liveGrandchild).toBeDefined();
    expect(replayedGrandchild).toBeDefined();
    expect(parentRunIdsOf(replayedGrandchild)).toEqual(parentRunIdsOf(liveGrandchild));
  });

  it("STREAM-03 late-event suppression emits in-flight parent-aborted failures before aborted and terminal error on cancel", async () => {
    const provider = createAbortableFanOutProvider("stream-03-cancel-fan-out-model");
    const handle = stream({
      intent: "Cancel during child fan-out.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      maxConcurrentChildren: 2,
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });
    const events: StreamEvent[] = [];
    handle.subscribe((event) => {
      events.push(event);
    });
    const result = handle.result.catch((error: unknown) => error);

    await provider.waitForStartedChildren(2);
    handle.cancel();
    await result;

    const failed = events.filter((event) => event.type === "sub-run-failed");
    const parentAborted = failed.filter(
      (event) => event.error.code === "aborted" && event.error.detail?.["reason"] === "parent-aborted"
    );
    const siblingFailed = failed.filter(
      (event) => event.error.code === "aborted" && event.error.detail?.["reason"] === "sibling-failed"
    );
    const abortedIndex = events.findIndex((event) => event.type === "aborted");
    const errorIndex = events.findIndex((event) => event.type === "error");

    expect(parentAborted).toHaveLength(2);
    expect(parentAborted.every((event) => event.partialTrace.events.length > 0)).toBe(true);
    expect(parentAborted.every((event) => event.partialCost.usd === 0)).toBe(true);
    expect(siblingFailed).toHaveLength(1);
    expect(abortedIndex).toBeGreaterThan(-1);
    expect(errorIndex).toBeGreaterThan(abortedIndex);
    expect(Math.max(...parentAborted.map((event) => events.indexOf(event)))).toBeLessThan(abortedIndex);
    expect(events[errorIndex]).toMatchObject({
      type: "error",
      detail: {
        code: "aborted"
      }
    });
  });

  it("status reflects cancelled after StreamHandle.cancel() resolves the abort path", async () => {
    const provider = createAbortableFanOutProvider("stream-status-cancelled-model");
    const handle = stream({
      intent: "Reflect cancelled stream status.",
      protocol: { kind: "coordinator", maxTurns: 2 },
      tier: "fast",
      maxConcurrentChildren: 2,
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ]
    });
    const result = handle.result.catch((error: unknown) => error);

    await provider.waitForStartedChildren(2);
    handle.cancel();
    await result;

    expect(handle.status).toBe("cancelled");
  });

  it("yields agent-turn events during sequential protocol execution before the result resolves", async () => {
    const gates = createResponseGates(["first turn", "second turn"]);
    const model = createGatedModelProvider("gated-sequential-model", gates);
    const firstGate = requireGate(gates, 0);
    const secondGate = requireGate(gates, 1);
    const handle = stream({
      intent: "Stream sequential turns while the run is still executing.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "balanced",
      model,
      agents: [
        { id: "planner", role: "planner" },
        { id: "critic", role: "critic" }
      ]
    });
    const iterator = handle[Symbol.asyncIterator]();
    const resultState = observeResult(handle.result);

    expect((await iterator.next()).value?.type).toBe("role-assignment");
    expect((await iterator.next()).value?.type).toBe("role-assignment");
    await waitForRequest(firstGate);
    expect(resultState.settled).toBe(false);

    firstGate.resolve("planner output");
    const firstTurn = await iterator.next();
    expect(firstTurn.done).toBe(false);
    expect(firstTurn.value).toMatchObject({
      type: "agent-turn",
      agentId: "planner",
      role: "planner",
      output: "planner output"
    });
    expect(resultState.settled).toBe(false);

    await waitForRequest(secondGate);
    secondGate.resolve("critic output");
    const secondTurn = await iterator.next();
    expect(secondTurn.done).toBe(false);
    expect(secondTurn.value).toMatchObject({
      type: "agent-turn",
      agentId: "critic",
      role: "critic",
      output: "critic output"
    });
    expect(resultState.settled).toBe(false);

    const finalEvent = await iterator.next();
    expect(finalEvent.value?.type).toBe("final");
    const result = await handle.result;
    expect(result.output).toBe("critic output");
    expect(finalEvent.value).toMatchObject({
      type: "final",
      output: result.output,
      transcript: {
        kind: "trace-transcript",
        entryCount: result.transcript.length,
        lastEntryIndex: result.transcript.length - 1
      }
    });
    expect(result.trace.events.at(-1)).toEqual(finalEvent.value);
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
  });

  it("yields per-agent turns and the grouped broadcast event before broadcast results settle", async () => {
    const gates = createResponseGates(["release turn", "paper turn"]);
    const model = createGatedModelProvider("gated-broadcast-model", gates);
    const releaseGate = requireGate(gates, 0);
    const paperGate = requireGate(gates, 1);
    const handle = stream({
      intent: "Stream broadcast round events while the run is still executing.",
      protocol: { kind: "broadcast", maxRounds: 1 },
      tier: "balanced",
      model,
      agents: [
        { id: "release", role: "release" },
        { id: "paper", role: "paper" }
      ]
    });
    const iterator = handle[Symbol.asyncIterator]();
    const resultState = observeResult(handle.result);

    expect((await iterator.next()).value?.type).toBe("role-assignment");
    expect((await iterator.next()).value?.type).toBe("role-assignment");

    await waitForRequest(releaseGate);
    await waitForRequest(paperGate);
    expect(resultState.settled).toBe(false);

    releaseGate.resolve("release output");
    paperGate.resolve("paper output");
    const releaseTurn = await iterator.next();
    expect(releaseTurn.value).toMatchObject({
      type: "agent-turn",
      agentId: "release",
      output: "release output"
    });
    expect(resultState.settled).toBe(false);

    const paperTurn = await iterator.next();
    expect(paperTurn.value).toMatchObject({
      type: "agent-turn",
      agentId: "paper",
      output: "paper output"
    });
    expect(resultState.settled).toBe(false);

    const broadcastEvent = await iterator.next();
    expect(broadcastEvent.done).toBe(false);
    expect(broadcastEvent.value).toMatchObject({
      type: "broadcast",
      round: 1,
      contributions: [
        { agentId: "release", role: "release", output: "release output" },
        { agentId: "paper", role: "paper", output: "paper output" }
      ]
    });
    expect(resultState.settled).toBe(false);

    const finalEvent = await iterator.next();
    expect(finalEvent.value?.type).toBe("final");
    const result = await handle.result;
    expect(finalEvent.value).toMatchObject({
      type: "final",
      output: result.output,
      transcript: {
        kind: "trace-transcript",
        entryCount: result.transcript.length,
        lastEntryIndex: result.transcript.length - 1
      }
    });
    expect(result.trace.events.at(-1)).toEqual(finalEvent.value);
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "broadcast",
      "final"
    ]);
  });
});

const output = "critic judged final output";
const PARTICIPATE_OUTPUT = [
  "role_selected: coordinator",
  "participation: contribute",
  "rationale: synthesize after sub-run",
  "contribution:",
  "synthesized after sub-run"
].join("\n");

function delegateBlock(payload: unknown): string {
  return ["delegate:", "```json", JSON.stringify(payload), "```", ""].join("\n");
}

async function collectEvents(handle: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of handle) {
    events.push(event);
  }
  return events;
}

function childRunIds(result: RunResult): string[] {
  return result.trace.events
    .filter((event) => event.type === "sub-run-completed")
    .map((event) => event.subResult.trace.runId);
}

function parentRunIdsOf(event: StreamEvent | undefined): readonly string[] | undefined {
  return (event as { readonly parentRunIds?: readonly string[] } | undefined)?.parentRunIds;
}

function sameIds(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return actual !== undefined && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function hasPersistedParentRunIds(events: readonly StreamEvent[]): boolean {
  return events.some((event) => parentRunIdsOf(event) !== undefined);
}

function isModelOutputChunk(event: StreamEvent): event is Extract<StreamEvent, { readonly type: "model-output-chunk" }> {
  return event.type === "model-output-chunk";
}

function createDelegatingProvider(id: string, planResponses: readonly string[]): ConfiguredModelProvider {
  let planIndex = 0;

  return {
    id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const phase = String(request.metadata.phase);
      const protocol = String(request.metadata.protocol);
      const text =
        protocol === "coordinator" && phase === "plan"
          ? (planResponses[planIndex++] ?? PARTICIPATE_OUTPUT)
          : protocol === "coordinator"
            ? "parent final output"
            : "child worker output";

      return response(text);
    }
  };
}

interface AbortableFanOutProvider extends ConfiguredModelProvider {
  waitForStartedChildren(count: number): Promise<void>;
}

function createAbortableFanOutProvider(id: string): AbortableFanOutProvider {
  let planIndex = 0;
  const childSignals: AbortSignal[] = [];
  const waiters: Array<{ readonly count: number; readonly resolve: () => void }> = [];
  const notify = (): void => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter && childSignals.length >= waiter.count) {
        waiters.splice(index, 1);
        waiter.resolve();
      }
    }
  };

  return {
    id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const phase = String(request.metadata.phase);
      const protocol = String(request.metadata.protocol);
      if (protocol === "coordinator" && phase === "plan") {
        const text =
          planIndex === 0
            ? delegateBlock([
              { protocol: "sequential", intent: "cancel child 0" },
              { protocol: "sequential", intent: "cancel child 1" },
              { protocol: "sequential", intent: "queued child 2" }
            ])
            : PARTICIPATE_OUTPUT;
        planIndex += 1;
        return response(text);
      }
      if (protocol === "coordinator") {
        return response("parent final output");
      }

      if (!request.signal) {
        throw new Error("child request missing abort signal");
      }
      childSignals.push(request.signal);
      notify();
      await waitForAbort(request.signal);
      throw request.signal.reason;
    },
    waitForStartedChildren(count: number): Promise<void> {
      if (childSignals.length >= count) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        waiters.push({ count, resolve });
      });
    }
  };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function createChunkingDelegateProvider(options: {
  readonly id: string;
  readonly planResponses: readonly string[];
  readonly chunksPerChild: number;
  readonly observedOrder?: string[];
  readonly observedByRunId?: Map<string, string[]>;
}): ConfiguredModelProvider {
  let planIndex = 0;
  const streamedChildRunIds = new Set<string>();

  return {
    id: options.id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const phase = String(request.metadata.phase);
      const protocol = String(request.metadata.protocol);
      const text =
        protocol === "coordinator" && phase === "plan"
          ? (options.planResponses[planIndex++] ?? PARTICIPATE_OUTPUT)
          : protocol === "coordinator"
            ? "parent final output"
            : "child worker output";

      return response(text);
    },
    async *stream(request: ModelRequest): AsyncIterable<ModelOutputChunk> {
      const phase = String(request.metadata.phase);
      const protocol = String(request.metadata.protocol);
      if (protocol === "coordinator") {
        const text =
          phase === "plan"
            ? (options.planResponses[planIndex++] ?? PARTICIPATE_OUTPUT)
            : "parent final output";
        yield { text };
        return;
      }

      const runId = String(request.metadata.runId);
      if (streamedChildRunIds.has(runId)) {
        return;
      }
      streamedChildRunIds.add(runId);
      const order = options.observedByRunId?.get(runId) ?? [];
      options.observedByRunId?.set(runId, order);

      for (let index = 0; index < options.chunksPerChild; index += 1) {
        await immediate();
        const text = `${runId}:chunk:${index}`;
        order.push(text);
        options.observedOrder?.push(text);
        yield { text };
      }
    }
  };
}

function response(text: string): ModelResponse {
  return {
    text,
    usage: {
      inputTokens: countWords(text),
      outputTokens: countWords(text),
      totalTokens: countWords(text) * 2
    },
    costUsd: 0.001
  };
}

function immediate(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

interface ResponseGate {
  readonly label: string;
  readonly requested: Promise<void>;
  resolve(text: string): void;
}

interface GatedResponseGate extends ResponseGate {
  text(): Promise<string>;
}

interface ChunkStreamController extends AsyncIterable<ModelOutputChunk> {
  readonly started: Promise<void>;
  resolveFirst(text: string): void;
  resolveSecond(text: string): void;
}

function createChunkStreamController(): ChunkStreamController {
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let releaseFirst: ((text: string) => void) | undefined;
  const first = new Promise<string>((resolve) => {
    releaseFirst = resolve;
  });
  let releaseSecond: ((text: string) => void) | undefined;
  const second = new Promise<string>((resolve) => {
    releaseSecond = resolve;
  });

  return {
    started,
    resolveFirst(text: string): void {
      releaseFirst?.(text);
    },
    resolveSecond(text: string): void {
      releaseSecond?.(text);
    },
    async *[Symbol.asyncIterator](): AsyncIterator<ModelOutputChunk> {
      markStarted?.();
      yield { text: await first };
      yield {
        text: await second,
        usage: {
          inputTokens: 2,
          outputTokens: 2,
          totalTokens: 4
        },
        costUsd: 0.002
      };
    }
  };
}

function createStreamingModelProvider(
  id: string,
  chunks: ChunkStreamController
): ConfiguredModelProvider {
  return {
    id,
    async generate(): Promise<ModelResponse> {
      throw new Error("streaming provider should be consumed through stream()");
    },
    stream(): AsyncIterable<ModelOutputChunk> {
      return chunks;
    }
  };
}

function createResponseGates(labels: readonly string[]): GatedResponseGate[] {
  return labels.map((label) => {
    let markRequested: (() => void) | undefined;
    const requested = new Promise<void>((resolve) => {
      markRequested = resolve;
    });
    let releaseResponse: ((text: string) => void) | undefined;
    const response = new Promise<string>((resolve) => {
      releaseResponse = resolve;
    });

    return {
      label,
      requested,
      resolve(text: string): void {
        releaseResponse?.(text);
      },
      async text(): Promise<string> {
        markRequested?.();
        return response;
      }
    };
  });
}

function createResolvedResponseGates(responses: readonly string[]): GatedResponseGate[] {
  return responses.map((response, index) => ({
    label: `resolved-${index}`,
    requested: Promise.resolve(),
    resolve(): void {},
    async text(): Promise<string> {
      return response;
    }
  }));
}

function createGatedModelProvider(
  id: string,
  gates: readonly GatedResponseGate[]
): ConfiguredModelProvider {
  let index = 0;

  return {
    id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const gate = gates[index];
      index += 1;
      if (!gate) {
        throw new Error(`unexpected model request for ${id}`);
      }
      const text = await gate.text();
      const input = request.messages.find((message) => message.role === "user")?.content ?? "";

      return {
        text,
        usage: {
          inputTokens: countWords(input),
          outputTokens: countWords(text),
          totalTokens: countWords(input) + countWords(text)
        },
        costUsd: 0.001
      };
    }
  };
}

function createResolvedModelProvider(id: string, responses: readonly string[]): ConfiguredModelProvider {
  let index = 0;

  return {
    id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const text = responses[index];
      index += 1;
      if (text === undefined) {
        throw new Error(`unexpected model request for ${id}`);
      }
      const input = request.messages.find((message) => message.role === "user")?.content ?? "";

      return {
        text,
        usage: {
          inputTokens: countWords(input),
          outputTokens: countWords(text),
          totalTokens: countWords(input) + countWords(text)
        },
        costUsd: 0.001
      };
    }
  };
}

function createFailingModelProvider(id: string, error: Error): ConfiguredModelProvider {
  return {
    id,
    async generate(): Promise<ModelResponse> {
      throw error;
    }
  };
}

function requireGate(gates: readonly GatedResponseGate[], index: number): GatedResponseGate {
  const gate = gates[index];
  if (!gate) {
    throw new Error(`missing response gate ${index}`);
  }
  return gate;
}

async function waitForRequest(gate: ResponseGate): Promise<void> {
  await gate.requested;
}

function observeResult(result: Promise<RunResult>): { readonly settled: boolean } {
  const state = { settled: false };
  result.finally(() => {
    state.settled = true;
  });
  return state;
}

function countWords(text: string): number {
  return Math.max(1, text.split(/\s+/u).filter(Boolean).length);
}

function withoutDynamicTraceFields(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key: string, nestedValue: unknown) => {
      if (key === "runId" || key === "at" || key === "elapsedMs" || key === "startedAt" || key === "completedAt") {
        return "<dynamic>";
      }
      if (key === "callId") {
        return "<dynamic>";
      }
      return nestedValue;
    })
  );
}
