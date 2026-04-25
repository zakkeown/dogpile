import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import {
  Dogpile,
  run,
  type ConfiguredModelProvider,
  type ModelRequest,
  type ModelResponse
} from "../index.js";
import { createVercelAIProvider, type VercelAIGenerateTextFunction } from "../providers/vercel-ai.js";

const model = "openai/gpt-4.1-mini" as LanguageModel;

describe("v1 release focused coverage", () => {
  it("runs a successful high-level Dogpile.pile call to completion", async () => {
    const requests: ModelRequest[] = [];
    const provider: ConfiguredModelProvider = {
      id: "v1-focused-success-model",
      async generate(request): Promise<ModelResponse> {
        requests.push(request);

        return {
          text: `release answer from ${String(request.metadata.role)}`,
          usage: {
            inputTokens: 5,
            outputTokens: 7,
            totalTokens: 12
          },
          costUsd: 0.00012
        };
      }
    };

    const result = await Dogpile.pile({
      intent: "Prove the v1 high-level call succeeds.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: provider,
      agents: [{ id: "shipper", role: "release-checker" }]
    });

    expect(requests).toHaveLength(1);
    expect(result.output).toBe("release answer from release-checker");
    expect(result.trace.modelProviderId).toBe("v1-focused-success-model");
    expect(result.trace.events.map((event) => event.type)).toEqual(["role-assignment", "agent-turn", "final"]);
    expect(result.usage).toEqual({
      inputTokens: 5,
      outputTokens: 7,
      totalTokens: 12,
      usd: 0.00012
    });
    expect(result.cost.usd).toBe(0.00012);
  });

  it("propagates provider errors from the high-level call without resolving a partial result", async () => {
    const failure = new Error("focused provider failure");
    let calls = 0;
    const provider: ConfiguredModelProvider = {
      id: "v1-focused-error-model",
      async generate(): Promise<ModelResponse> {
        calls += 1;
        throw failure;
      }
    };

    await expect(
      Dogpile.pile({
        intent: "Prove the v1 high-level call surfaces provider errors.",
        protocol: { kind: "sequential", maxTurns: 1 },
        tier: "fast",
        model: provider,
        agents: [{ id: "shipper", role: "release-checker" }]
      })
    ).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

  it("passes caller abort through to the in-flight Vercel AI provider request", async () => {
    const abortController = new AbortController();
    const fetchProbe = createAbortableFetchProbe();
    const generateText: VercelAIGenerateTextFunction = async (options) => {
      await fetchProbe.fetch(options.abortSignal);
      return { text: "unreachable after abort" };
    };
    const provider = createVercelAIProvider({
      id: "v1-focused-abort-model",
      model,
      generateText
    });

    const result = run({
      intent: "Prove v1 cancellation reaches the provider request.",
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: provider,
      agents: [{ id: "shipper", role: "release-checker" }],
      signal: abortController.signal
    });
    const rejection = expect(result).rejects.toMatchObject({
      name: "DogpileError",
      code: "aborted",
      providerId: "v1-focused-abort-model",
      retryable: false
    });

    await expect(fetchProbe.receivedSignal).resolves.toBe(abortController.signal);
    abortController.abort();

    await expect(fetchProbe.aborted).resolves.toBeUndefined();
    expect(fetchProbe.abortCount()).toBe(1);
    await rejection;
  });

  it("makes the documented public package exports available from built package entrypoints", async () => {
    const [root, browser, provider] = await Promise.all([
      import("@dogpile/sdk"),
      import("@dogpile/sdk/browser"),
      import("@dogpile/sdk/providers/openai-compatible")
    ]);

    expect(root.Dogpile).toEqual(
      expect.objectContaining({
        pile: expect.any(Function),
        stream: expect.any(Function),
        createEngine: expect.any(Function)
      })
    );
    expect(root).toEqual(
      expect.objectContaining({
        DogpileError: expect.any(Function),
        createEngine: expect.any(Function),
        createOpenAICompatibleProvider: expect.any(Function),
        run: expect.any(Function),
        stream: expect.any(Function)
      })
    );
    expect(provider.createOpenAICompatibleProvider).toBe(root.createOpenAICompatibleProvider);
    expect(browser).toEqual(
      expect.objectContaining({
        Dogpile: expect.any(Object),
        createEngine: expect.any(Function),
        createOpenAICompatibleProvider: expect.any(Function),
        run: expect.any(Function),
        stream: expect.any(Function)
      })
    );
  });
});

interface AbortableFetchProbe {
  readonly receivedSignal: Promise<AbortSignal | undefined>;
  readonly aborted: Promise<void>;
  fetch(signal: AbortSignal | undefined): Promise<never>;
  abortCount(): number;
}

function createAbortableFetchProbe(): AbortableFetchProbe {
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
    fetch(signal): Promise<never> {
      resolveReceivedSignal(signal);

      return new Promise<never>((_, reject) => {
        if (!signal) {
          reject(new Error("Expected Dogpile to pass the caller AbortSignal into the provider request."));
          return;
        }

        const abort = (): void => {
          signal.removeEventListener("abort", abort);
          aborts += 1;
          resolveAborted();
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        };

        if (signal.aborted) {
          abort();
          return;
        }

        signal.addEventListener("abort", abort, { once: true });
      });
    },
    abortCount(): number {
      return aborts;
    }
  };
}
