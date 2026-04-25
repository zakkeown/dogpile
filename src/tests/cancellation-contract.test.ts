import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  type ConfiguredModelProvider,
  type ModelRequest,
  type ModelResponse,
  run,
  stream,
  type StreamEvent
} from "../index.js";
import {
  createVercelAIProvider,
  type VercelAIGenerateTextFunction,
  type VercelAIStreamTextFunction
} from "../providers/vercel-ai.js";

const model = "openai/gpt-4.1-mini" as LanguageModel;

describe("caller cancellation contract", () => {
  it("propagates run() caller AbortSignal into the in-flight provider fetch", async () => {
    const abortController = new AbortController();
    const fetchProbe = createAbortableFetchProbe();
    const generateText: VercelAIGenerateTextFunction = async (options) => {
      await fetchProbe.fetch(options.abortSignal);
      return { text: "unreachable after abort" };
    };
    const provider = createVercelAIProvider({
      id: "vercel-ai:run-cancellation-contract",
      model,
      generateText
    });

    const result = run({
      intent: "Verify run() cancellation reaches the provider HTTP layer.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "balanced",
      model: provider,
      agents: [{ id: "writer", role: "writer" }],
      signal: abortController.signal
    });
    const rejection = expect(result).rejects.toMatchObject({
      name: "DogpileError",
      code: "aborted",
      message: "The operation was aborted.",
      providerId: "vercel-ai:run-cancellation-contract",
      retryable: false
    });

    await expect(fetchProbe.receivedSignal).resolves.toBe(abortController.signal);
    expect(abortController.signal.aborted).toBe(false);
    expect(fetchProbe.callCount()).toBe(1);

    abortController.abort();

    await expect(fetchProbe.aborted).resolves.toBeUndefined();
    expect(fetchProbe.abortCount()).toBe(1);
    await rejection;
  });

  it("aborts run() provider fetch when the orchestration timeout expires", async () => {
    vi.useFakeTimers();

    try {
      const fetchProbe = createAbortableFetchProbe();
      const generateText: VercelAIGenerateTextFunction = async (options) => {
        await fetchProbe.fetch(options.abortSignal);
        return { text: "unreachable after timeout" };
      };
      const provider = createVercelAIProvider({
        id: "vercel-ai:run-timeout-contract",
        model,
        generateText
      });

      const result = run({
        intent: "Verify run() timeout reaches the provider HTTP layer.",
        protocol: { kind: "sequential", maxTurns: 1 },
        tier: "balanced",
        model: provider,
        agents: [{ id: "writer", role: "writer" }],
        budget: { timeoutMs: 5 }
      });
      const rejection = expect(result).rejects.toMatchObject({
        name: "DogpileError",
        code: "timeout",
        message: "The operation timed out after 5ms.",
        providerId: "vercel-ai:run-timeout-contract",
        retryable: true,
        detail: {
          timeoutMs: 5
        }
      });

      const signal = await fetchProbe.receivedSignal;
      expect(signal).toBeDefined();
      expect(signal?.aborted).toBe(false);
      expect(fetchProbe.callCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(5);

      await expect(fetchProbe.aborted).resolves.toBeUndefined();
      expect(fetchProbe.abortCount()).toBe(1);
      expect(signal?.aborted).toBe(true);
      expect(signal?.reason).toMatchObject({
        name: "DogpileError",
        code: "timeout",
        providerId: "vercel-ai:run-timeout-contract",
        detail: {
          timeoutMs: 5
        }
      });
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("composes run() caller cancellation with the orchestration timeout and preserves the caller reason", async () => {
    vi.useFakeTimers();

    try {
      const abortController = new AbortController();
      const callerReason = new Error("caller cancelled the composed run");
      const fetchProbe = createAbortableFetchProbe();
      const generateText: VercelAIGenerateTextFunction = async (options) => {
        await fetchProbe.fetch(options.abortSignal);
        return { text: "unreachable after caller abort" };
      };
      const provider = createVercelAIProvider({
        id: "vercel-ai:run-composed-caller-contract",
        model,
        generateText
      });

      const result = run({
        intent: "Verify caller cancellation wins over the run timeout.",
        protocol: { kind: "sequential", maxTurns: 1 },
        tier: "balanced",
        model: provider,
        agents: [{ id: "writer", role: "writer" }],
        signal: abortController.signal,
        budget: { timeoutMs: 25 }
      });
      const rejection = expect(result).rejects.toMatchObject({
        name: "DogpileError",
        code: "aborted",
        providerId: "vercel-ai:run-composed-caller-contract",
        retryable: false,
        cause: callerReason
      });

      const signal = await fetchProbe.receivedSignal;
      expect(signal).toBeDefined();
      expect(signal).not.toBe(abortController.signal);
      expect(signal?.aborted).toBe(false);

      abortController.abort(callerReason);

      await expect(fetchProbe.aborted).resolves.toBeUndefined();
      expect(fetchProbe.abortCount()).toBe(1);
      expect(signal?.aborted).toBe(true);
      expect(signal?.reason).toBe(callerReason);
      await rejection;

      await vi.advanceTimersByTimeAsync(25);

      expect(fetchProbe.abortCount()).toBe(1);
      expect(signal?.reason).toBe(callerReason);
    } finally {
      vi.useRealTimers();
    }
  });

  it("composes run() timeout cancellation with the caller signal and keeps the timeout as the first reason", async () => {
    vi.useFakeTimers();

    try {
      const abortController = new AbortController();
      const fetchProbe = createAbortableFetchProbe();
      const generateText: VercelAIGenerateTextFunction = async (options) => {
        await fetchProbe.fetch(options.abortSignal);
        return { text: "unreachable after timeout abort" };
      };
      const provider = createVercelAIProvider({
        id: "vercel-ai:run-composed-timeout-contract",
        model,
        generateText
      });

      const result = run({
        intent: "Verify timeout cancellation wins over later caller cancellation.",
        protocol: { kind: "sequential", maxTurns: 1 },
        tier: "balanced",
        model: provider,
        agents: [{ id: "writer", role: "writer" }],
        signal: abortController.signal,
        budget: { timeoutMs: 5 }
      });
      const rejection = expect(result).rejects.toMatchObject({
        name: "DogpileError",
        code: "timeout",
        message: "The operation timed out after 5ms.",
        providerId: "vercel-ai:run-composed-timeout-contract",
        retryable: true,
        detail: {
          timeoutMs: 5
        }
      });

      const signal = await fetchProbe.receivedSignal;
      expect(signal).toBeDefined();
      expect(signal).not.toBe(abortController.signal);
      expect(signal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(5);

      await expect(fetchProbe.aborted).resolves.toBeUndefined();
      expect(fetchProbe.abortCount()).toBe(1);
      expect(signal?.aborted).toBe(true);
      expect(signal?.reason).toMatchObject({
        name: "DogpileError",
        code: "timeout",
        providerId: "vercel-ai:run-composed-timeout-contract",
        detail: {
          timeoutMs: 5
        }
      });

      abortController.abort(new Error("late caller abort"));

      expect(fetchProbe.abortCount()).toBe(1);
      expect(signal?.reason).toMatchObject({
        name: "DogpileError",
        code: "timeout",
        providerId: "vercel-ai:run-composed-timeout-contract"
      });
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up the run() timeout timer after a successful completion", async () => {
    vi.useFakeTimers();

    try {
      const requests: ModelRequest[] = [];
      const provider: ConfiguredModelProvider = {
        id: "successful-timeout-cleanup-contract",
        async generate(request: ModelRequest): Promise<ModelResponse> {
          requests.push(request);
          return { text: "completed before timeout" };
        }
      };

      const result = await run({
        intent: "Verify timeout timer cleanup after success.",
        protocol: { kind: "sequential", maxTurns: 1 },
        tier: "balanced",
        model: provider,
        agents: [{ id: "writer", role: "writer" }],
        budget: { timeoutMs: 25 }
      });

      expect(result.output).toBe("completed before timeout");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.signal).toBeDefined();
      expect(requests[0]?.signal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(25);

      expect(requests[0]?.signal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts the underlying fetch when caller cancellation stops the public run stream", async () => {
    const abortController = new AbortController();
    const fetchProbe = createAbortableFetchProbe();
    const streamText: VercelAIStreamTextFunction = (options) => ({
      textStream: streamFromFetch(fetchProbe, options.abortSignal)
    });
    const provider = createVercelAIProvider({
      id: "vercel-ai:stream-cancellation-contract",
      model,
      streaming: true,
      streamText
    });

    const handle = stream({
      intent: "Verify stream() cancellation reaches the provider HTTP layer.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "balanced",
      model: provider,
      agents: [{ id: "writer", role: "writer" }],
      signal: abortController.signal
    });
    const resultRejection = expect(handle.result).rejects.toMatchObject({
      name: "DogpileError",
      code: "aborted",
      message: "The operation was aborted.",
      providerId: "vercel-ai:stream-cancellation-contract",
      retryable: false
    });
    const eventsPromise = collectStreamEvents(handle);

    const providerSignal = await fetchProbe.receivedSignal;
    expect(providerSignal).toBeDefined();
    expect(providerSignal).not.toBe(abortController.signal);
    expect(providerSignal?.aborted).toBe(false);
    expect(abortController.signal.aborted).toBe(false);
    expect(fetchProbe.callCount()).toBe(1);

    abortController.abort();

    await expect(fetchProbe.aborted).resolves.toBeUndefined();
    expect(fetchProbe.abortCount()).toBe(1);
    expect(providerSignal?.aborted).toBe(true);
    expect(providerSignal?.reason).toMatchObject({
      name: "DogpileError",
      code: "aborted",
      providerId: "vercel-ai:stream-cancellation-contract",
      retryable: false,
      detail: {
        status: "cancelled"
      }
    });
    await resultRejection;
    await expect(eventsPromise).resolves.toMatchObject([
      { type: "role-assignment" },
      {
        type: "error",
        name: "DogpileError",
        message: "The operation was aborted."
      }
    ]);
    expect(handle.status).toBe("cancelled");
  });

  it("aborts stream() provider fetch when the orchestration timeout expires", async () => {
    vi.useFakeTimers();

    try {
      const fetchProbe = createAbortableFetchProbe();
      const streamText: VercelAIStreamTextFunction = (options) => ({
        textStream: streamFromFetch(fetchProbe, options.abortSignal)
      });
      const provider = createVercelAIProvider({
        id: "vercel-ai:stream-timeout-contract",
        model,
        streaming: true,
        streamText
      });

      const handle = stream({
        intent: "Verify stream() timeout reaches the provider HTTP layer.",
        protocol: { kind: "sequential", maxTurns: 1 },
        tier: "balanced",
        model: provider,
        agents: [{ id: "writer", role: "writer" }],
        budget: { timeoutMs: 5 }
      });
      const resultRejection = expect(handle.result).rejects.toMatchObject({
        name: "DogpileError",
        code: "timeout",
        message: "The operation timed out after 5ms.",
        providerId: "vercel-ai:stream-timeout-contract",
        retryable: true,
        detail: {
          timeoutMs: 5
        }
      });
      const eventsPromise = collectStreamEvents(handle);

      const signal = await fetchProbe.receivedSignal;
      expect(signal).toBeDefined();
      expect(signal?.aborted).toBe(false);
      expect(fetchProbe.callCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(5);

      await expect(fetchProbe.aborted).resolves.toBeUndefined();
      expect(fetchProbe.abortCount()).toBe(1);
      expect(signal?.aborted).toBe(true);
      expect(signal?.reason).toMatchObject({
        name: "DogpileError",
        code: "timeout",
        providerId: "vercel-ai:stream-timeout-contract",
        detail: {
          timeoutMs: 5
        }
      });
      await resultRejection;
      await expect(eventsPromise).resolves.toMatchObject([
        { type: "role-assignment" },
        {
          type: "error",
          name: "DogpileError",
          message: "The operation timed out after 5ms.",
          detail: {
            code: "timeout",
            providerId: "vercel-ai:stream-timeout-contract",
            retryable: true,
            timeoutMs: 5
          }
        }
      ]);
      expect(handle.status).toBe("failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("composes stream() caller cancellation with the orchestration timeout and preserves the caller reason", async () => {
    vi.useFakeTimers();

    try {
      const abortController = new AbortController();
      const callerReason = new Error("caller cancelled the composed stream");
      const fetchProbe = createAbortableFetchProbe();
      const streamText: VercelAIStreamTextFunction = (options) => ({
        textStream: streamFromFetch(fetchProbe, options.abortSignal)
      });
      const provider = createVercelAIProvider({
        id: "vercel-ai:stream-composed-caller-contract",
        model,
        streaming: true,
        streamText
      });

      const handle = stream({
        intent: "Verify caller cancellation wins over the stream timeout.",
        protocol: { kind: "sequential", maxTurns: 1 },
        tier: "balanced",
        model: provider,
        agents: [{ id: "writer", role: "writer" }],
        signal: abortController.signal,
        budget: { timeoutMs: 25 }
      });
      const resultRejection = expect(handle.result).rejects.toMatchObject({
        name: "DogpileError",
        code: "aborted",
        providerId: "vercel-ai:stream-composed-caller-contract",
        retryable: false,
        cause: callerReason,
        detail: {
          status: "cancelled"
        }
      });
      const eventsPromise = collectStreamEvents(handle);

      const signal = await fetchProbe.receivedSignal;
      expect(signal).toBeDefined();
      expect(signal).not.toBe(abortController.signal);
      expect(signal?.aborted).toBe(false);

      abortController.abort(callerReason);

      await expect(fetchProbe.aborted).resolves.toBeUndefined();
      expect(fetchProbe.abortCount()).toBe(1);
      expect(signal?.aborted).toBe(true);
      expect(signal?.reason).toMatchObject({
        name: "DogpileError",
        code: "aborted",
        cause: callerReason,
        detail: {
          status: "cancelled"
        }
      });
      await resultRejection;
      await expect(eventsPromise).resolves.toMatchObject([
        { type: "role-assignment" },
        {
          type: "error",
          name: "DogpileError",
          message: "The operation was aborted.",
          detail: {
            code: "aborted",
            providerId: "vercel-ai:stream-composed-caller-contract",
            retryable: false,
            status: "cancelled"
          }
        }
      ]);

      await vi.advanceTimersByTimeAsync(25);

      expect(fetchProbe.abortCount()).toBe(1);
      expect(signal?.reason).toMatchObject({
        name: "DogpileError",
        code: "aborted",
        cause: callerReason
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops streamed orchestration before the next model turn when the active provider ignores abort", async () => {
    const abortController = new AbortController();
    const firstResponse = createDeferred<ModelResponse>();
    const firstRequestReceived = createDeferred<void>();
    const requests: ModelRequest[] = [];
    const provider: ConfiguredModelProvider = {
      id: "ignore-abort-stream-orchestration-contract",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        requests.push(request);
        if (requests.length === 1) {
          firstRequestReceived.resolve();
          return firstResponse.promise;
        }
        throw new Error("stream() started another model turn after cancellation.");
      }
    };

    const handle = stream({
      intent: "Verify stream cancellation stops protocol work after the active request.",
      protocol: { kind: "sequential", maxTurns: 2 },
      tier: "balanced",
      model: provider,
      agents: [
        { id: "writer", role: "writer" },
        { id: "critic", role: "critic" }
      ],
      signal: abortController.signal
    });
    const resultRejection = expect(handle.result).rejects.toMatchObject({
      name: "DogpileError",
      code: "aborted",
      message: "The operation was aborted.",
      providerId: "ignore-abort-stream-orchestration-contract",
      retryable: false,
      detail: {
        status: "cancelled"
      }
    });
    const eventsPromise = collectStreamEvents(handle);

    await firstRequestReceived.promise;
    expect(requests).toHaveLength(1);
    expect(requests[0]?.signal?.aborted).toBe(false);

    abortController.abort();
    expect(requests[0]?.signal?.aborted).toBe(true);
    firstResponse.resolve({ text: "late ignored abort response" });

    await resultRejection;
    await flushAsyncWork();
    expect(requests).toHaveLength(1);
    await expect(eventsPromise).resolves.toMatchObject([
      { type: "role-assignment", agentId: "writer" },
      { type: "role-assignment", agentId: "critic" },
      {
        type: "error",
        name: "DogpileError",
        message: "The operation was aborted.",
        detail: {
          code: "aborted",
          providerId: "ignore-abort-stream-orchestration-contract",
          status: "cancelled"
        }
      }
    ]);
    expect(handle.status).toBe("cancelled");
  });

  it("aborts the underlying fetch when StreamHandle.cancel() stops the run stream", async () => {
    const fetchProbe = createAbortableFetchProbe();
    const streamText: VercelAIStreamTextFunction = (options) => ({
      textStream: streamFromFetch(fetchProbe, options.abortSignal)
    });
    const provider = createVercelAIProvider({
      id: "vercel-ai:handle-cancel-contract",
      model,
      streaming: true,
      streamText
    });

    const handle = stream({
      intent: "Verify StreamHandle.cancel() reaches the provider HTTP layer.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "balanced",
      model: provider,
      agents: [{ id: "writer", role: "writer" }]
    });
    const resultRejection = expect(handle.result).rejects.toMatchObject({
      name: "DogpileError",
      code: "aborted",
      message: "The operation was aborted.",
      providerId: "vercel-ai:handle-cancel-contract",
      retryable: false,
      detail: {
        status: "cancelled"
      }
    });
    const iterator = handle[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "role-assignment" }
    });
    const providerSignal = await fetchProbe.receivedSignal;
    expect(providerSignal).toBeDefined();
    expect(providerSignal?.aborted).toBe(false);
    expect(fetchProbe.callCount()).toBe(1);
    expect(handle.status).toBe("running");

    handle.cancel();

    await expect(fetchProbe.aborted).resolves.toBeUndefined();
    expect(fetchProbe.abortCount()).toBe(1);
    expect(providerSignal?.aborted).toBe(true);
    expect(providerSignal?.reason).toMatchObject({
      name: "DogpileError",
      code: "aborted",
      providerId: "vercel-ai:handle-cancel-contract",
      retryable: false,
      detail: {
        status: "cancelled"
      }
    });
    expect(handle.status).toBe("cancelled");
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: "error",
        name: "DogpileError",
        message: "The operation was aborted.",
        detail: {
          code: "aborted",
          providerId: "vercel-ai:handle-cancel-contract",
          retryable: false,
          status: "cancelled"
        }
      }
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });

    handle.cancel();

    expect(fetchProbe.abortCount()).toBe(1);
    await resultRejection;
  });

  it("suppresses late provider stream events after StreamHandle.cancel()", async () => {
    const requestReceived = createDeferred<ModelRequest>();
    const releaseLateChunks = createDeferred<void>();
    const providerFinished = createDeferred<void>();
    const subscribedEvents: StreamEvent[] = [];
    const provider: ConfiguredModelProvider = {
      id: "late-provider-events-after-handle-cancel",
      async generate(): Promise<ModelResponse> {
        throw new Error("stream() should consume the provider stream in this cancellation test.");
      },
      async *stream(request: ModelRequest): AsyncIterable<{ readonly text: string }> {
        requestReceived.resolve(request);

        try {
          await releaseLateChunks.promise;
          yield { text: "late chunk after cancellation" };
          yield { text: "another late chunk after cancellation" };
        } finally {
          providerFinished.resolve();
        }
      }
    };

    const handle = stream({
      intent: "Verify StreamHandle.cancel() closes stream consumers before late provider chunks.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "balanced",
      model: provider,
      agents: [{ id: "writer", role: "writer" }]
    });
    handle.subscribe((event) => {
      subscribedEvents.push(event);
    });
    const resultRejection = expect(handle.result).rejects.toMatchObject({
      name: "DogpileError",
      code: "aborted",
      message: "The operation was aborted.",
      providerId: "late-provider-events-after-handle-cancel",
      retryable: false,
      detail: {
        status: "cancelled"
      }
    });
    const eventsPromise = collectStreamEvents(handle);

    const request = await requestReceived.promise;
    expect(request.signal?.aborted).toBe(false);
    expect(handle.status).toBe("running");

    handle.cancel();

    expect(request.signal?.aborted).toBe(true);
    expect(handle.status).toBe("cancelled");
    releaseLateChunks.resolve();

    await providerFinished.promise;
    await resultRejection;
    await expect(eventsPromise).resolves.toMatchObject([
      { type: "role-assignment" },
      {
        type: "error",
        name: "DogpileError",
        message: "The operation was aborted.",
        detail: {
          code: "aborted",
          providerId: "late-provider-events-after-handle-cancel",
          retryable: false,
          status: "cancelled"
        }
      }
    ]);
    expect((await eventsPromise).map((event) => event.type)).toEqual(["role-assignment", "error"]);
    expect(subscribedEvents.map((event) => event.type)).toEqual(["role-assignment", "error"]);
  });
});

interface AbortableFetchProbe {
  readonly receivedSignal: Promise<AbortSignal | undefined>;
  readonly aborted: Promise<void>;
  fetch(signal: AbortSignal | undefined): Promise<never>;
  callCount(): number;
  abortCount(): number;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve(value: T): void {
      resolvePromise(value);
    },
    reject(error: unknown): void {
      rejectPromise(error);
    }
  };
}

function createAbortableFetchProbe(): AbortableFetchProbe {
  let calls = 0;
  let aborts = 0;
  let resolveReceivedSignal!: (signal: AbortSignal | undefined) => void;
  let resolveAborted!: () => void;
  const receivedSignal = new Promise<AbortSignal | undefined>((resolve) => {
    resolveReceivedSignal = resolve;
  });
  const aborted = new Promise<void>((resolve) => {
    resolveAborted = resolve;
  });

  return {
    receivedSignal,
    aborted,
    fetch(signal: AbortSignal | undefined): Promise<never> {
      calls += 1;
      resolveReceivedSignal(signal);

      return new Promise<never>((_, reject) => {
        if (!signal) {
          reject(new Error("Expected Dogpile to pass the caller AbortSignal into the provider fetch."));
          return;
        }

        const abort = (): void => {
          signal.removeEventListener("abort", abort);
          aborts += 1;
          resolveAborted();
          reject(createAbortError());
        };

        if (signal.aborted) {
          abort();
          return;
        }

        signal.addEventListener("abort", abort, { once: true });
      });
    },
    callCount(): number {
      return calls;
    },
    abortCount(): number {
      return aborts;
    }
  };
}

async function* streamFromFetch(
  fetchProbe: AbortableFetchProbe,
  signal: AbortSignal | undefined
): AsyncIterable<string> {
  await fetchProbe.fetch(signal);
  yield "unreachable after abort";
}

async function collectStreamEvents(events: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const collectedEvents: StreamEvent[] = [];

  for await (const event of events) {
    collectedEvents.push(event);
  }

  return collectedEvents;
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
