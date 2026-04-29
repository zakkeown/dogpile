import { APICallError, jsonSchema, tool, type FinishReason, type LanguageModel, type LanguageModelUsage } from "ai";
import { describe, expect, it } from "vitest";
import {
  DogpileError,
  type ModelFinishReason,
  type ModelResponse,
  type ModelRequest
} from "../index.js";
import {
  createVercelAIProvider,
  type VercelAIGenerateTextFunction,
  type VercelAIStreamTextFunction,
  type VercelAITextGenerationOptions,
  type VercelAIToolCall
} from "./vercel-ai.js";

const model = "openai/gpt-4.1-mini" as LanguageModel;
const responseTimestamp = new Date("2026-04-24T12:00:00.000Z");
const finishReasonCases = [
  ["stop", "stop_sequence", "stop"],
  ["length", "max_tokens", "length"],
  ["content-filter", "content_filter", "content-filter"],
  ["tool-calls", "tool_calls", "tool-calls"],
  ["error", "provider_error", "error"],
  ["other", "provider_specific", "other"]
] as const satisfies readonly (readonly [FinishReason, string, ModelFinishReason])[];

const request: ModelRequest = {
  messages: [
    { role: "system", content: "Answer tersely." },
    { role: "user", content: "Ship the release adapter." }
  ],
  temperature: 0.2,
  metadata: {
    protocol: "sequential",
    runId: "run-vercel-ai-provider"
  }
};

describe("createVercelAIProvider", () => {
  it("maps mocked Vercel AI assistant text output into Dogpile model responses", async () => {
    const calls: VercelAITextGenerationOptions[] = [];
    const generateText: VercelAIGenerateTextFunction = async (options) => {
      calls.push(options);

      return {
        text: "The assistant text output is mapped.",
        finishReason: "stop",
        usage: usage(7, 6),
        response: {
          id: "resp-assistant-text",
          timestamp: responseTimestamp,
          modelId: "gpt-4.1-mini",
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "The assistant text output is mapped."
                }
              ]
            }
          ]
        }
      };
    };

    const provider = createVercelAIProvider({
      id: "vercel-ai:assistant-text-test",
      model,
      generateText
    });

    const response = await provider.generate(request);

    expect(response).toEqual({
      text: "The assistant text output is mapped.",
      finishReason: "stop",
      usage: {
        inputTokens: 7,
        outputTokens: 6,
        totalTokens: 13
      },
      metadata: {
        vercelAi: {
          response: {
            id: "resp-assistant-text",
            timestamp: "2026-04-24T12:00:00.000Z",
            modelId: "gpt-4.1-mini"
          }
        }
      }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model,
      messages: request.messages,
      temperature: request.temperature
    });
  });

  it("maps mocked Vercel AI response token usage into Dogpile input and output usage", async () => {
    const observedCostUsage: Array<NonNullable<ModelResponse["usage"]>> = [];
    const generateText: VercelAIGenerateTextFunction = async () => ({
      text: "usage mapping ready",
      finishReason: "stop",
      usage: usage(23, 31)
    });
    const provider = createVercelAIProvider({
      id: "vercel-ai:usage-mapping-test",
      model,
      generateText,
      costEstimator({ usage: reportedUsage }) {
        if (reportedUsage) {
          observedCostUsage.push(reportedUsage);
        }

        return undefined;
      }
    });

    const response = await provider.generate(request);

    expect(response.usage).toEqual({
      inputTokens: 23,
      outputTokens: 31,
      totalTokens: 54
    });
    expect(response.costUsd).toBeUndefined();
    expect(observedCostUsage).toEqual([
      {
        inputTokens: 23,
        outputTokens: 31,
        totalTokens: 54
      }
    ]);
  });

  it.each(finishReasonCases)(
    "normalizes mocked Vercel AI finish reason %s into Dogpile responses",
    async (finishReason, rawFinishReason, expectedFinishReason) => {
      const generateText: VercelAIGenerateTextFunction = async () => ({
        text: `finish reason: ${finishReason}`,
        finishReason,
        rawFinishReason
      });
      const provider = createVercelAIProvider({
        id: `vercel-ai:finish-reason-${finishReason}`,
        model,
        generateText
      });

      const response = await provider.generate(request);

      expect(response).toEqual({
        text: `finish reason: ${finishReason}`,
        finishReason: expectedFinishReason,
        metadata: {
          vercelAi: {
            rawFinishReason
          }
        }
      });
    }
  );

  it("maps mocked Vercel AI response tool calls into Dogpile runtime tool requests", async () => {
    const generateText: VercelAIGenerateTextFunction = async () => ({
      text: "tool call mapping ready",
      finishReason: "tool-calls",
      toolCalls: [
        {
          type: "tool-call",
          toolCallId: "tool-call-lookup-release",
          toolName: "lookup",
          input: {
            query: "release readiness",
            limit: 3
          },
          providerExecuted: false,
          dynamic: true,
          invalid: false,
          title: "Lookup release evidence"
        }
      ] as VercelAIToolCall[]
    });
    const provider = createVercelAIProvider({
      id: "vercel-ai:tool-call-mapping-test",
      model,
      generateText
    });

    const response = await provider.generate(request);

    expect(response).toEqual({
      text: "tool call mapping ready",
      finishReason: "tool-calls",
      toolRequests: [
        {
          toolId: "vercel-ai.tools.lookup",
          toolCallId: "tool-call-lookup-release",
          input: {
            query: "release readiness",
            limit: 3
          },
          metadata: {
            vercelAiToolName: "lookup",
            providerExecuted: false,
            dynamic: true,
            invalid: false,
            title: "Lookup release evidence"
          }
        }
      ]
    });
  });

  it("adapts generateText into Dogpile's configured model provider contract", async () => {
    const calls: VercelAITextGenerationOptions[] = [];
    const abortController = new AbortController();
    const generateText: VercelAIGenerateTextFunction = async (options) => {
      calls.push(options);

      return {
        text: "release adapter ready",
        finishReason: "tool-calls",
        toolCalls: [
          {
            type: "tool-call",
            toolCallId: "tool-call-release-lookup",
            toolName: "lookup",
            input: {
              query: "release adapter",
              limit: 2
            }
          }
        ] as VercelAIToolCall[],
        rawFinishReason: "tool_calls",
        totalUsage: usage(8, 13),
        warnings: [
          {
            type: "other",
            message: "fixture warning"
          }
        ],
        request: {
          body: {
            requestId: "req-release-adapter"
          }
        },
        response: {
          id: "resp-release-adapter",
          timestamp: responseTimestamp,
          modelId: "gpt-4.1-mini",
          headers: {
            "x-request-id": "provider-request-1"
          },
          body: {
            cached: false
          },
          messages: []
        },
        providerMetadata: {
          openai: {
            serviceTier: "default"
          }
        }
      };
    };

    const provider = createVercelAIProvider({
      id: "vercel-ai:test-model",
      model,
      generateText,
      headers: {
        "x-release": "v1"
      },
      providerOptions: {
        openai: {
          reasoningEffort: "low"
        }
      },
      maxRetries: 0,
      maxOutputTokens: 400,
      abortSignal: abortController.signal,
      runtimeToolIdForName: (toolName) => `fixture.tools.${toolName}`,
      costEstimator({ usage: reportedUsage }) {
        return reportedUsage ? (reportedUsage.inputTokens * 0.01 + reportedUsage.outputTokens * 0.03) / 1_000 : undefined;
      }
    });

    const response = await provider.generate(request);

    expect(response).toEqual({
      text: "release adapter ready",
      finishReason: "tool-calls",
      toolRequests: [
        {
          toolId: "fixture.tools.lookup",
          toolCallId: "tool-call-release-lookup",
          input: {
            query: "release adapter",
            limit: 2
          },
          metadata: {
            vercelAiToolName: "lookup"
          }
        }
      ],
      usage: {
        inputTokens: 8,
        outputTokens: 13,
        totalTokens: 21
      },
      costUsd: response.costUsd,
      metadata: {
        vercelAi: {
          rawFinishReason: "tool_calls",
          request: {
            body: {
              requestId: "req-release-adapter"
            }
          },
          response: {
            id: "resp-release-adapter",
            timestamp: "2026-04-24T12:00:00.000Z",
            modelId: "gpt-4.1-mini",
            headers: {
              "x-request-id": "provider-request-1"
            },
            body: {
              cached: false
            }
          },
          providerMetadata: {
            openai: {
              serviceTier: "default"
            }
          },
          warnings: [
            {
              type: "other",
              message: "fixture warning"
            }
          ]
        }
      }
    });
    expect(response.costUsd).toBeCloseTo(0.00047);

    expect(provider.id).toBe("vercel-ai:test-model");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model,
      messages: request.messages,
      temperature: 0.2,
      maxRetries: 0,
      maxOutputTokens: 400,
      headers: {
        "x-release": "v1"
      },
      providerOptions: {
        openai: {
          reasoningEffort: "low"
        }
      },
      abortSignal: abortController.signal
    });
  });

  it("invokes the real Vercel AI SDK generateText path with mapped Dogpile request options", async () => {
    const calls: RecordedVercelAIModelCall[] = [];
    const abortController = new AbortController();
    const provider = createVercelAIProvider({
      model: createRecordingLanguageModel(calls),
      maxRetries: 0,
      maxOutputTokens: 128,
      tools: {
        lookup: tool({
          description: "Lookup release facts.",
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              query: { type: "string" }
            },
            required: ["query"],
            additionalProperties: false
          })
        })
      }
    });

    const response = await provider.generate({
      ...request,
      signal: abortController.signal
    });

    expect(provider.id).toBe("vercel-ai:fixture:dogpile-vercel-integration");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      temperature: request.temperature,
      maxOutputTokens: 128,
      abortSignal: abortController.signal
    });
    expect(calls[0]?.prompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system"
        }),
        expect.objectContaining({
          role: "user"
        })
      ])
    );
    expect(calls[0]?.tools).toHaveLength(1);
    expect(response).toEqual({
      text: "integration path ready",
      finishReason: "tool-calls",
      toolRequests: [
        {
          toolId: "vercel-ai.tools.lookup",
          toolCallId: "tool-call-integration-lookup",
          input: {
            query: "release adapter"
          },
          metadata: {
            vercelAiToolName: "lookup"
          }
        }
      ],
      usage: {
        inputTokens: 11,
        outputTokens: 17,
        totalTokens: 28
      },
      metadata: {
        vercelAi: {
          rawFinishReason: "tool_calls",
          response: {
            id: expect.any(String),
            timestamp: expect.any(String),
            modelId: "dogpile-vercel-integration"
          },
          warnings: []
        }
      }
    });
  });

  it("uses the request AbortSignal when Dogpile supplies one to the provider", async () => {
    const calls: VercelAITextGenerationOptions[] = [];
    const adapterAbortController = new AbortController();
    const requestAbortController = new AbortController();
    const generateText: VercelAIGenerateTextFunction = async (options) => {
      calls.push(options);

      return { text: "request signal wins" };
    };

    const provider = createVercelAIProvider({
      model,
      generateText,
      abortSignal: adapterAbortController.signal
    });

    await provider.generate({
      ...request,
      signal: requestAbortController.signal
    });

    expect(calls[0]?.abortSignal).toBe(requestAbortController.signal);
  });

  it("enables streamText only when requested and preserves final usage and caller-priced cost", async () => {
    const calls: VercelAITextGenerationOptions[] = [];
    const streamText: VercelAIStreamTextFunction = (options) => {
      calls.push(options);

      return {
        textStream: textStreamFrom(["ship", " it"]),
        finishReason: Promise.resolve("stop"),
        toolCalls: Promise.resolve([
          {
            type: "tool-call",
            toolCallId: "tool-call-stream-lookup",
            toolName: "streamLookup",
            input: {
              query: "streaming adapter"
            }
          }
        ] as VercelAIToolCall[]),
        rawFinishReason: Promise.resolve("stop"),
        totalUsage: Promise.resolve(usage(3, 5)),
        response: Promise.resolve({
          id: "resp-stream-adapter",
          timestamp: responseTimestamp,
          modelId: "gpt-4.1-mini-stream",
          headers: {
            "x-stream-request-id": "provider-stream-1"
          },
          messages: []
        }),
        providerMetadata: Promise.resolve({
          openai: {
            stream: true
          }
        })
      };
    };

    const provider = createVercelAIProvider({
      id: "vercel-ai:streaming-test",
      model,
      streaming: true,
      streamText,
      costEstimator({ mode, usage: reportedUsage }) {
        expect(mode).toBe("stream");
        return reportedUsage ? reportedUsage.totalTokens / 1_000_000 : undefined;
      }
    });

    if (!provider.stream) {
      throw new Error("expected createVercelAIProvider({ streaming: true }) to expose stream()");
    }

    const chunks = [];
    for await (const chunk of provider.stream(request)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { text: "ship" },
      { text: " it" },
      {
        text: "",
        finishReason: "stop",
        toolRequests: [
          {
            toolId: "vercel-ai.tools.streamLookup",
            toolCallId: "tool-call-stream-lookup",
            input: {
              query: "streaming adapter"
            },
            metadata: {
              vercelAiToolName: "streamLookup"
            }
          }
        ],
        usage: {
          inputTokens: 3,
          outputTokens: 5,
          totalTokens: 8
        },
        costUsd: 0.000008,
        metadata: {
          vercelAi: {
            rawFinishReason: "stop",
            response: {
              id: "resp-stream-adapter",
              timestamp: "2026-04-24T12:00:00.000Z",
              modelId: "gpt-4.1-mini-stream",
              headers: {
                "x-stream-request-id": "provider-stream-1"
              }
            },
            providerMetadata: {
              openai: {
                stream: true
              }
            }
          }
        }
      }
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model,
      messages: request.messages,
      temperature: request.temperature
    });
  });

  it("uses the request AbortSignal for streamText when Dogpile streams through the adapter", async () => {
    const calls: VercelAITextGenerationOptions[] = [];
    const adapterAbortController = new AbortController();
    const requestAbortController = new AbortController();
    const streamText: VercelAIStreamTextFunction = (options) => {
      calls.push(options);

      return {
        textStream: textStreamFrom(["request signal streams"])
      };
    };

    const provider = createVercelAIProvider({
      model,
      streaming: true,
      streamText,
      abortSignal: adapterAbortController.signal
    });

    if (!provider.stream) {
      throw new Error("expected createVercelAIProvider({ streaming: true }) to expose stream()");
    }

    const chunks = [];
    for await (const chunk of provider.stream({
      ...request,
      signal: requestAbortController.signal
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ text: "request signal streams" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.abortSignal).toBe(requestAbortController.signal);
  });

  it("keeps the default provider non-streaming unless the adapter option opts in", () => {
    const provider = createVercelAIProvider({
      model,
      generateText: async () => ({ text: "ok" })
    });

    expect(provider.id).toBe("vercel-ai:openai/gpt-4.1-mini");
    expect(provider.stream).toBeUndefined();
  });

  it("normalizes Vercel AI SDK provider failures into DogpileError codes", async () => {
    const provider = createVercelAIProvider({
      id: "vercel-ai:error-test",
      model,
      generateText: async () => {
        throw new APICallError({
          message: "rate limited by provider",
          url: "https://api.example.test/v1/responses",
          requestBodyValues: {
            model: "gpt-4.1-mini"
          },
          statusCode: 429,
          responseHeaders: {
            "retry-after": "2"
          },
          responseBody: "{\"error\":\"rate_limited\"}",
          isRetryable: true,
          data: {
            type: "rate_limit"
          }
        });
      }
    });

    await expect(provider.generate(request)).rejects.toBeInstanceOf(DogpileError);

    try {
      await provider.generate(request);
      throw new Error("Expected provider.generate() to reject.");
    } catch (error) {
      expect(DogpileError.isInstance(error)).toBe(true);
      expect(error).toMatchObject({
        name: "DogpileError",
        code: "provider-rate-limited",
        message: "rate limited by provider",
        providerId: "vercel-ai:error-test",
        retryable: true,
        detail: {
          name: "AI_APICallError",
          aiSdkErrorName: "AI_APICallError",
          statusCode: 429,
          url: "https://api.example.test/v1/responses",
          responseHeaders: {
            "retry-after": "2"
          },
          responseBody: "{\"error\":\"rate_limited\"}",
          data: {
            type: "rate_limit"
          }
        }
      });
    }
  });

  it("normalizes provider abort failures into the stable aborted DogpileError code", async () => {
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    const provider = createVercelAIProvider({
      id: "vercel-ai:abort-error-test",
      model,
      generateText: async () => {
        throw abortError;
      }
    });

    await expect(provider.generate(request)).rejects.toMatchObject({
      name: "DogpileError",
      code: "aborted",
      message: "The operation was aborted.",
      providerId: "vercel-ai:abort-error-test",
      retryable: false,
      cause: abortError
    });
  });
});

function usage(inputTokens: number, outputTokens: number): LanguageModelUsage {
  return {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: inputTokens,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined
    },
    outputTokens,
    outputTokenDetails: {
      textTokens: outputTokens,
      reasoningTokens: undefined
    },
    totalTokens: inputTokens + outputTokens
  };
}

interface RecordedVercelAIModelCall {
  readonly prompt?: unknown;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly abortSignal?: AbortSignal;
  readonly tools?: readonly unknown[];
}

function createRecordingLanguageModel(calls: RecordedVercelAIModelCall[]): LanguageModel {
  return {
    specificationVersion: "v3",
    provider: "fixture",
    modelId: "dogpile-vercel-integration",
    supportedUrls: {},
    async doGenerate(options: RecordedVercelAIModelCall) {
      calls.push(options);

      return {
        content: [
          {
            type: "text",
            text: "integration path ready"
          },
          {
            type: "tool-call",
            toolCallId: "tool-call-integration-lookup",
            toolName: "lookup",
            input: JSON.stringify({
              query: "release adapter"
            })
          }
        ],
        finishReason: {
          unified: "tool-calls",
          raw: "tool_calls"
        },
        usage: {
          inputTokens: {
            total: 11,
            noCache: 11,
            cacheRead: undefined,
            cacheWrite: undefined
          },
          outputTokens: {
            total: 17,
            text: 17,
            reasoning: undefined
          }
        },
        warnings: []
      };
    },
    async doStream() {
      throw new Error("streaming is not used by this Vercel AI integration fixture.");
    }
  } as LanguageModel;
}

async function* textStreamFrom(chunks: readonly string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}
