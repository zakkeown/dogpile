import { describe, expect, it } from "vitest";
import {
  builtInDogpileToolIdentity,
  builtInDogpileToolInputSchema,
  builtInDogpileToolPermissions,
  createCodeExecToolAdapter,
  createRuntimeToolExecutor,
  createWebSearchToolAdapter,
  normalizeBuiltInDogpileTool,
  normalizeBuiltInDogpileTools,
  normalizeRuntimeToolAdapterError,
  validateBuiltInDogpileToolInput,
  type CodeExecSandboxExecutor,
  type CodeExecToolOutput,
  type RunEvent,
  type RuntimeToolExecutionContext,
  type RuntimeToolSuccessResult,
  type WebSearchFetch,
  type WebSearchToolOutput
} from "../index.js";

const context: RuntimeToolExecutionContext = {
  runId: "run-built-in-tools",
  toolCallId: "tool-call-1",
  protocol: "sequential",
  tier: "balanced",
  agentId: "agent-1",
  role: "researcher",
  turn: 1,
  trace: {
    events: [],
    transcript: []
  }
};

describe("built-in Dogpile tool normalization", () => {
  it("creates the built-in fetch-based webSearch adapter against the shared contract", async () => {
    const calls: Array<{ readonly input: RequestInfo | URL; readonly init?: RequestInit }> = [];
    const abortController = new AbortController();
    const fetchSearch: WebSearchFetch = async (input, init) => {
      if (init === undefined) {
        calls.push({ input });
      } else {
        calls.push({ input, init });
      }

      return new Response(
        JSON.stringify({
          results: [
            {
              title: "Drop the Hierarchy and Roles",
              url: "https://arxiv.org/abs/2603.28990",
              snippet: "Multi-agent collaboration without fixed hierarchy.",
              metadata: {
                source: "fixture"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    };
    const tool = createWebSearchToolAdapter({
      endpoint: "https://search.example.test/api",
      fetch: fetchSearch,
      headers: {
        authorization: "Bearer fixture"
      },
      defaultMaxResults: 4
    });
    const result = await tool.execute(
      { query: "drop the hierarchy" },
      {
        ...context,
        abortSignal: abortController.signal
      }
    );

    expect(tool.identity).toEqual(builtInDogpileToolIdentity("webSearch"));
    expect(tool.inputSchema).toEqual(builtInDogpileToolInputSchema("webSearch"));
    expect(tool.permissions).toEqual(builtInDogpileToolPermissions("webSearch"));
    expect(tool.validateInput({ query: "paper", maxResults: 1 })).toEqual({ type: "valid" });
    expect(result).toEqual({
      type: "success",
      toolCallId: "tool-call-1",
      tool: builtInDogpileToolIdentity("webSearch"),
      output: {
        results: [
          {
            title: "Drop the Hierarchy and Roles",
            url: "https://arxiv.org/abs/2603.28990",
            snippet: "Multi-agent collaboration without fixed hierarchy.",
            metadata: {
              source: "fixture"
            }
          }
        ]
      }
    });
    expect(calls).toHaveLength(1);

    const requestUrl = new URL(String(calls[0]?.input));
    expect(requestUrl.origin).toBe("https://search.example.test");
    expect(requestUrl.pathname).toBe("/api");
    expect(requestUrl.searchParams.get("q")).toBe("drop the hierarchy");
    expect(requestUrl.searchParams.get("limit")).toBe("4");
    expect(calls[0]?.init).toMatchObject({
      method: "GET",
      headers: {
        authorization: "Bearer fixture"
      },
      signal: abortController.signal
    });
    expect(JSON.parse(JSON.stringify({ identity: tool.identity, inputSchema: tool.inputSchema, result }))).toEqual({
      identity: tool.identity,
      inputSchema: tool.inputSchema,
      result
    });
  });

  it("lets the webSearch adapter customize request building and response parsing", async () => {
    const fetchSearch: WebSearchFetch = async (input, init) => {
      expect(String(input)).toBe("https://custom-search.example.test/query");
      expect(init).toMatchObject({
        method: "POST",
        body: JSON.stringify({ q: "agent workflow", k: 2 })
      });

      return new Response(JSON.stringify({ answer: "ok" }), { status: 200 });
    };
    const tool = createWebSearchToolAdapter({
      endpoint: "https://unused.example.test",
      fetch: fetchSearch,
      identity: {
        version: "fixture-search"
      },
      buildRequest(input) {
        return {
          url: "https://custom-search.example.test/query",
          init: {
            method: "POST",
            body: JSON.stringify({ q: input.query, k: input.maxResults ?? 1 })
          }
        };
      },
      async parseResponse(response, input) {
        expect(response.status).toBe(200);
        return {
          results: [
            {
              title: input.query,
              url: "https://custom-search.example.test/result"
            }
          ]
        };
      }
    });

    await expect(tool.execute({ query: "agent workflow", maxResults: 2 }, context)).resolves.toEqual({
      type: "success",
      toolCallId: "tool-call-1",
      tool: {
        ...builtInDogpileToolIdentity("webSearch"),
        version: "fixture-search"
      },
      output: {
        results: [
          {
            title: "agent workflow",
            url: "https://custom-search.example.test/result"
          }
        ]
      }
    });
  });

  it("normalizes webSearch adapter validation and backend failures", async () => {
    let fetchCalls = 0;
    const tool = createWebSearchToolAdapter({
      endpoint: "https://search.example.test/api",
      fetch: async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          statusText: "Too Many Requests"
        });
      }
    });

    await expect(tool.execute({ query: "", maxResults: 0 }, context)).resolves.toEqual({
      type: "error",
      toolCallId: "tool-call-1",
      tool: tool.identity,
      error: {
        code: "invalid-input",
        message: "Invalid webSearch tool input.",
        retryable: false,
        detail: {
          issues: [
            {
              code: "invalid-value",
              path: "query",
              message: "webSearch.query must not be empty."
            },
            {
              code: "out-of-range",
              path: "maxResults",
              message: "webSearch.maxResults must be greater than or equal to 1.",
              detail: {
                minimum: 1
              }
            }
          ]
        }
      }
    });
    expect(fetchCalls).toBe(0);

    await expect(tool.execute({ query: "tools" }, context)).resolves.toEqual({
      type: "error",
      toolCallId: "tool-call-1",
      tool: tool.identity,
      error: {
        code: "backend-error",
        message: "Web search backend returned HTTP 429.",
        retryable: true,
        detail: {
          status: 429,
          statusText: "Too Many Requests"
        }
      }
    });
    expect(fetchCalls).toBe(1);
  });

  it("normalizes webSearch into the shared runtime tool interface", async () => {
    const tool = normalizeBuiltInDogpileTool({
      name: "webSearch",
      execute(input, executionContext): RuntimeToolSuccessResult<WebSearchToolOutput> {
        return {
          type: "success",
          toolCallId: executionContext.toolCallId,
          tool: builtInDogpileToolIdentity("webSearch"),
          output: {
            results: [
              {
                title: `Result for ${input.query}`,
                url: "https://example.test/search",
                snippet: `limit:${input.maxResults ?? 10}`
              }
            ]
          }
        };
      }
    });

    expect(tool.identity).toEqual({
      id: "dogpile.tools.webSearch",
      namespace: "dogpile",
      name: "webSearch",
      version: "1.0.0",
      description: "Search the web through a caller-provided fetch-compatible search adapter."
    });
    expect(tool.inputSchema).toEqual(builtInDogpileToolInputSchema("webSearch"));
    expect(tool.permissions).toEqual(builtInDogpileToolPermissions("webSearch"));
    expect(tool.validateInput({ query: "drop the hierarchy", maxResults: 2 })).toEqual({ type: "valid" });

    const result = await tool.execute({ query: "drop the hierarchy", maxResults: 2 }, context);

    expect(result).toEqual({
      type: "success",
      toolCallId: "tool-call-1",
      tool: builtInDogpileToolIdentity("webSearch"),
      output: {
        results: [
          {
            title: "Result for drop the hierarchy",
            url: "https://example.test/search",
            snippet: "limit:2"
          }
        ]
      }
    });
    expect(JSON.parse(JSON.stringify({ identity: tool.identity, inputSchema: tool.inputSchema, result }))).toEqual({
      identity: tool.identity,
      inputSchema: tool.inputSchema,
      result
    });
  });

  it("normalizes codeExec with caller-owned identity metadata and a portable executor", async () => {
    const tool = normalizeBuiltInDogpileTool({
      name: "codeExec",
      identity: {
        version: "sandbox-fixture",
        description: "Execute code in the test sandbox."
      },
      execute(input, executionContext): RuntimeToolSuccessResult<CodeExecToolOutput> {
        return {
          type: "success",
          toolCallId: executionContext.toolCallId,
          tool: tool.identity,
          output: {
            stdout: `${input.language}:${input.code.length}`,
            stderr: "",
            exitCode: 0,
            metadata: {
              timeoutMs: input.timeoutMs ?? null
            }
          }
        };
      }
    });

    expect(tool.identity).toEqual({
      id: "dogpile.tools.codeExec",
      namespace: "dogpile",
      name: "codeExec",
      version: "sandbox-fixture",
      description: "Execute code in the test sandbox."
    });
    expect(tool.inputSchema.schema).toMatchObject({
      required: ["language", "code"],
      additionalProperties: false
    });
    expect(tool.permissions).toEqual([
      {
        kind: "code-execution",
        sandbox: "caller-provided",
        languages: ["javascript", "typescript", "python", "bash", "shell"],
        allowNetwork: false
      }
    ]);
    expect(tool.validateInput({ language: "typescript", code: "const ok = true;" })).toEqual({ type: "valid" });

    const result = await tool.execute({ language: "typescript", code: "const ok = true;", timeoutMs: 100 }, context);

    expect(result).toEqual({
      type: "success",
      toolCallId: "tool-call-1",
      tool: tool.identity,
      output: {
        stdout: "typescript:16",
        stderr: "",
        exitCode: 0,
        metadata: {
          timeoutMs: 100
        }
      }
    });
  });

  it("creates the built-in codeExec adapter against the shared contract", async () => {
    const calls: Array<{
      readonly input: Readonly<{ readonly language: string; readonly code: string; readonly timeoutMs?: number }>;
      readonly runId: string;
    }> = [];
    const execute: CodeExecSandboxExecutor = async (input, executionContext) => {
      calls.push({
        input,
        runId: executionContext.runId
      });

      return {
        stdout: `ran:${input.language}:${input.timeoutMs}`,
        stderr: "",
        exitCode: 0,
        metadata: {
          protocol: executionContext.protocol
        }
      };
    };
    const tool = createCodeExecToolAdapter({
      execute,
      defaultTimeoutMs: 250,
      maxTimeoutMs: 500,
      languages: ["javascript", "typescript"],
      allowNetwork: true
    });
    const result = await tool.execute({ language: "typescript", code: "export const ok = true;" }, context);

    expect(tool.identity).toEqual(builtInDogpileToolIdentity("codeExec"));
    expect(tool.inputSchema.schema).toMatchObject({
      properties: {
        language: {
          enum: ["javascript", "typescript"]
        }
      }
    });
    expect(tool.permissions).toEqual([
      {
        kind: "code-execution",
        sandbox: "caller-provided",
        languages: ["javascript", "typescript"],
        allowNetwork: true
      }
    ]);
    expect(tool.validateInput({ language: "javascript", code: "1 + 1", timeoutMs: 25 })).toEqual({ type: "valid" });
    expect(result).toEqual({
      type: "success",
      toolCallId: "tool-call-1",
      tool: builtInDogpileToolIdentity("codeExec"),
      output: {
        stdout: "ran:typescript:250",
        stderr: "",
        exitCode: 0,
        metadata: {
          protocol: "sequential"
        }
      }
    });
    expect(calls).toEqual([
      {
        input: {
          language: "typescript",
          code: "export const ok = true;",
          timeoutMs: 250
        },
        runId: "run-built-in-tools"
      }
    ]);
    expect(JSON.parse(JSON.stringify({ identity: tool.identity, inputSchema: tool.inputSchema, result }))).toEqual({
      identity: tool.identity,
      inputSchema: tool.inputSchema,
      result
    });
  });

  it("validates codeExec adapter policy before executing the sandbox", async () => {
    let sandboxCalls = 0;
    const tool = createCodeExecToolAdapter({
      execute() {
        sandboxCalls += 1;
        return {
          stdout: "",
          stderr: "",
          exitCode: 0
        };
      },
      languages: ["javascript"],
      maxTimeoutMs: 100
    });

    await expect(tool.execute({ language: "python", code: "print('nope')", timeoutMs: 250 }, context)).resolves.toEqual({
      type: "error",
      toolCallId: "tool-call-1",
      tool: tool.identity,
      error: {
        code: "invalid-input",
        message: "Invalid codeExec tool input.",
        retryable: false,
        detail: {
          issues: [
            {
              code: "invalid-value",
              path: "language",
              message: "codeExec.language is not enabled for this adapter.",
              detail: {
                allowed: ["javascript"]
              }
            },
            {
              code: "out-of-range",
              path: "timeoutMs",
              message: "codeExec.timeoutMs must be less than or equal to 100.",
              detail: {
                maximum: 100
              }
            }
          ]
        }
      }
    });
    expect(sandboxCalls).toBe(0);
  });

  it("normalizes codeExec adapter timeout and abort failures", async () => {
    const timeoutTool = createCodeExecToolAdapter({
      execute: () => new Promise<CodeExecToolOutput>(() => {}),
      defaultTimeoutMs: 1
    });
    const abortController = new AbortController();
    abortController.abort();
    const abortTool = createCodeExecToolAdapter({
      execute: () => ({
        stdout: "",
        stderr: "",
        exitCode: 0
      })
    });

    await expect(timeoutTool.execute({ language: "javascript", code: "await never" }, context)).resolves.toEqual({
      type: "error",
      toolCallId: "tool-call-1",
      tool: timeoutTool.identity,
      error: {
        code: "timeout",
        message: "Code execution exceeded timeout of 1ms.",
        retryable: true,
        detail: {
          timeoutMs: 1
        }
      }
    });
    await expect(
      abortTool.execute(
        { language: "javascript", code: "1 + 1" },
        {
          ...context,
          abortSignal: abortController.signal
        }
      )
    ).resolves.toEqual({
      type: "error",
      toolCallId: "tool-call-1",
      tool: abortTool.identity,
      error: {
        code: "aborted",
        message: "Code execution was aborted before the sandbox started.",
        retryable: true
      }
    });
  });

  it("normalizes built-in tool executor maps in stable built-in order", () => {
    const tools = normalizeBuiltInDogpileTools({
      codeExec(input, executionContext) {
        return {
          type: "success",
          toolCallId: executionContext.toolCallId,
          tool: builtInDogpileToolIdentity("codeExec"),
          output: {
            stdout: input.code,
            stderr: "",
            exitCode: 0
          }
        };
      },
      webSearch(input, executionContext) {
        return {
          type: "success",
          toolCallId: executionContext.toolCallId,
          tool: builtInDogpileToolIdentity("webSearch"),
          output: {
            results: [{ title: input.query, url: "https://example.test" }]
          }
        };
      }
    });

    expect(tools.map((tool) => tool.identity.name)).toEqual(["webSearch", "codeExec"]);
  });

  it("executes built-in tools successfully through every first-party protocol executor", async () => {
    const protocols = ["sequential", "broadcast", "shared", "coordinator"] satisfies readonly RuntimeToolExecutionContext["protocol"][];
    const summaries: Array<{
      readonly protocol: RuntimeToolExecutionContext["protocol"];
      readonly eventTypes: readonly RunEvent["type"][];
      readonly resultTypes: readonly string[];
      readonly observedProtocols: readonly RuntimeToolExecutionContext["protocol"][];
    }> = [];

    for (const protocol of protocols) {
      const events: RunEvent[] = [];
      const observedContexts: RuntimeToolExecutionContext[] = [];
      const tools = normalizeBuiltInDogpileTools({
        webSearch(input, executionContext) {
          observedContexts.push(executionContext);

          return {
            type: "success",
            toolCallId: executionContext.toolCallId,
            tool: builtInDogpileToolIdentity("webSearch"),
            output: {
              results: [
                {
                  title: `search:${input.query}`,
                  url: `https://example.test/${protocol}/search`,
                  metadata: {
                    protocol: executionContext.protocol,
                    agentId: executionContext.agentId ?? "missing-agent"
                  }
                }
              ]
            }
          };
        },
        codeExec(input, executionContext) {
          observedContexts.push(executionContext);

          return {
            type: "success",
            toolCallId: executionContext.toolCallId,
            tool: builtInDogpileToolIdentity("codeExec"),
            output: {
              stdout: `${executionContext.protocol}:${input.language}:${input.code}`,
              stderr: "",
              exitCode: 0,
              metadata: {
                protocol: executionContext.protocol,
                turn: executionContext.turn ?? -1
              }
            }
          };
        }
      });
      const executor = createRuntimeToolExecutor({
        runId: `run-${protocol}-built-in-tools`,
        protocol,
        tier: "balanced",
        tools,
        emit: (event) => events.push(event),
        getTrace: () => ({
          events,
          transcript: []
        }),
        makeToolCallId: (tool, index) => `${protocol}:${tool.name}:${index + 1}`
      });

      const searchResult = await executor.execute({
        toolId: "dogpile.tools.webSearch",
        input: { query: `${protocol} release evidence`, maxResults: 1 },
        agentId: `${protocol}-agent`,
        role: "researcher",
        turn: 1
      });
      const codeResult = await executor.execute({
        toolId: "dogpile.tools.codeExec",
        input: { language: "typescript", code: "export const ok = true;" },
        agentId: `${protocol}-agent`,
        role: "builder",
        turn: 2
      });

      expect(searchResult).toEqual({
        type: "success",
        toolCallId: `${protocol}:webSearch:1`,
        tool: builtInDogpileToolIdentity("webSearch"),
        output: {
          results: [
            {
              title: `search:${protocol} release evidence`,
              url: `https://example.test/${protocol}/search`,
              metadata: {
                protocol,
                agentId: `${protocol}-agent`
              }
            }
          ]
        }
      });
      expect(codeResult).toEqual({
        type: "success",
        toolCallId: `${protocol}:codeExec:2`,
        tool: builtInDogpileToolIdentity("codeExec"),
        output: {
          stdout: `${protocol}:typescript:export const ok = true;`,
          stderr: "",
          exitCode: 0,
          metadata: {
            protocol,
            turn: 2
          }
        }
      });
      expect(events).toEqual([
        expect.objectContaining({
          type: "tool-call",
          runId: `run-${protocol}-built-in-tools`,
          toolCallId: `${protocol}:webSearch:1`,
          tool: builtInDogpileToolIdentity("webSearch"),
          input: { query: `${protocol} release evidence`, maxResults: 1 },
          agentId: `${protocol}-agent`,
          role: "researcher"
        }),
        expect.objectContaining({
          type: "tool-result",
          runId: `run-${protocol}-built-in-tools`,
          toolCallId: `${protocol}:webSearch:1`,
          tool: builtInDogpileToolIdentity("webSearch"),
          result: searchResult,
          agentId: `${protocol}-agent`,
          role: "researcher"
        }),
        expect.objectContaining({
          type: "tool-call",
          runId: `run-${protocol}-built-in-tools`,
          toolCallId: `${protocol}:codeExec:2`,
          tool: builtInDogpileToolIdentity("codeExec"),
          input: { language: "typescript", code: "export const ok = true;" },
          agentId: `${protocol}-agent`,
          role: "builder"
        }),
        expect.objectContaining({
          type: "tool-result",
          runId: `run-${protocol}-built-in-tools`,
          toolCallId: `${protocol}:codeExec:2`,
          tool: builtInDogpileToolIdentity("codeExec"),
          result: codeResult,
          agentId: `${protocol}-agent`,
          role: "builder"
        })
      ]);
      expect(observedContexts).toEqual([
        expect.objectContaining({
          runId: `run-${protocol}-built-in-tools`,
          toolCallId: `${protocol}:webSearch:1`,
          protocol,
          tier: "balanced",
          agentId: `${protocol}-agent`,
          role: "researcher",
          turn: 1
        }),
        expect.objectContaining({
          runId: `run-${protocol}-built-in-tools`,
          toolCallId: `${protocol}:codeExec:2`,
          protocol,
          tier: "balanced",
          agentId: `${protocol}-agent`,
          role: "builder",
          turn: 2
        })
      ]);
      expect(JSON.parse(JSON.stringify({ events, searchResult, codeResult }))).toEqual({
        events,
        searchResult,
        codeResult
      });

      summaries.push({
        protocol,
        eventTypes: events.map((event) => event.type),
        resultTypes: [searchResult.type, codeResult.type],
        observedProtocols: observedContexts.map((executionContext) => executionContext.protocol)
      });
    }

    expect(summaries).toEqual(
      protocols.map((protocol) => ({
        protocol,
        eventTypes: ["tool-call", "tool-result", "tool-call", "tool-result"],
        resultTypes: ["success", "success"],
        observedProtocols: [protocol, protocol]
      }))
    );
  });

  it("validates built-in adapter inputs before executing caller adapters", async () => {
    const tool = normalizeBuiltInDogpileTool({
      name: "webSearch",
      execute() {
        throw new Error("executor should not run for invalid input");
      }
    });

    expect(validateBuiltInDogpileToolInput("webSearch", { query: "", maxResults: 0 })).toEqual({
      type: "invalid",
      issues: [
        {
          code: "invalid-value",
          path: "query",
          message: "webSearch.query must not be empty."
        },
        {
          code: "out-of-range",
          path: "maxResults",
          message: "webSearch.maxResults must be greater than or equal to 1.",
          detail: {
            minimum: 1
          }
        }
      ]
    });

    await expect(tool.execute({ query: "", maxResults: 0 }, context)).resolves.toEqual({
      type: "error",
      toolCallId: "tool-call-1",
      tool: tool.identity,
      error: {
        code: "invalid-input",
        message: "Invalid webSearch tool input.",
        retryable: false,
        detail: {
          issues: [
            {
              code: "invalid-value",
              path: "query",
              message: "webSearch.query must not be empty."
            },
            {
              code: "out-of-range",
              path: "maxResults",
              message: "webSearch.maxResults must be greater than or equal to 1.",
              detail: {
                minimum: 1
              }
            }
          ]
        }
      }
    });
  });

  it("normalizes thrown built-in adapter failures into common adapter errors", async () => {
    const timeoutError = {
      code: "timeout",
      message: "Search backend timed out.",
      retryable: true,
      detail: {
        timeoutMs: 250
      }
    } as const;
    const tool = normalizeBuiltInDogpileTool({
      name: "webSearch",
      execute() {
        throw timeoutError;
      }
    });

    expect(normalizeRuntimeToolAdapterError(timeoutError)).toEqual(timeoutError);
    await expect(tool.execute({ query: "drop hierarchy" }, context)).resolves.toEqual({
      type: "error",
      toolCallId: "tool-call-1",
      tool: tool.identity,
      error: timeoutError
    });
  });
});
