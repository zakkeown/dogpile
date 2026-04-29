import { jsonSchema, tool } from "ai";
import { describe, expect, it } from "vitest";
import {
  builtInDogpileToolPermissions,
  createCodeExecToolAdapter,
  createWebSearchToolAdapter,
  normalizeRuntimeToolAdapterError,
  validateBuiltInDogpileToolInput,
  type CodeExecToolOutput,
  type JsonObject,
  type RuntimeToolAdapterError,
  type RuntimeToolExecutionContext,
  type RuntimeToolPermission,
  type WebSearchFetch
} from "../index.js";
import { normalizeVercelAITool } from "../runtime/tools.js";

const context: RuntimeToolExecutionContext = {
  runId: "run-runtime-tool-adapter-focused",
  toolCallId: "tool-call-1",
  protocol: "shared",
  tier: "quality",
  agentId: "agent-1",
  role: "tool-user",
  turn: 2,
  trace: {
    events: [],
    transcript: []
  }
};

interface LookupInput extends JsonObject {
  readonly query: string;
}

interface LookupOutput extends JsonObject {
  readonly answer: string;
}

describe("runtime tool adapter focused coverage", () => {
  it("applies shared built-in validation before adapter execution", () => {
    expect(validateBuiltInDogpileToolInput("webSearch", {})).toEqual({
      type: "invalid",
      issues: [
        {
          code: "missing-field",
          path: "query",
          message: "webSearch.query must be a string."
        }
      ]
    });
    expect(validateBuiltInDogpileToolInput("webSearch", { query: "portable replay", maxResults: Number.NaN })).toEqual({
      type: "invalid",
      issues: [
        {
          code: "invalid-type",
          path: "maxResults",
          message: "webSearch.maxResults must be a finite number."
        }
      ]
    });
    expect(validateBuiltInDogpileToolInput("codeExec", { language: "ruby", code: 123 } as never)).toEqual({
      type: "invalid",
      issues: [
        {
          code: "invalid-value",
          path: "language",
          message: "codeExec.language must be one of javascript, typescript, python, bash, or shell.",
          detail: {
            allowed: ["javascript", "typescript", "python", "bash", "shell"]
          }
        },
        {
          code: "invalid-type",
          path: "code",
          message: "codeExec.code must be a string."
        }
      ]
    });
  });

  it("keeps permission declarations serializable and adapter-specific", () => {
    const permissions: readonly RuntimeToolPermission[] = [
      {
        kind: "network",
        allowHosts: ["search.example.test"],
        allowPrivateNetwork: false
      },
      {
        kind: "custom",
        name: "tenant-search-api-key",
        metadata: {
          credentialScope: "tenant"
        }
      }
    ];
    const webSearch = createWebSearchToolAdapter({
      endpoint: "https://search.example.test/api",
      fetch: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
      permissions
    });
    const codeExec = createCodeExecToolAdapter({
      execute: () => ({
        stdout: "",
        stderr: "",
        exitCode: 0
      }),
      languages: ["typescript"],
      allowNetwork: true
    });

    expect(webSearch.permissions).toEqual(permissions);
    expect(codeExec.permissions).toEqual([
      {
        kind: "code-execution",
        sandbox: "caller-provided",
        languages: ["typescript"],
        allowNetwork: true
      }
    ]);
    expect(JSON.parse(JSON.stringify({ webSearch: webSearch.permissions, codeExec: codeExec.permissions }))).toEqual({
      webSearch: permissions,
      codeExec: codeExec.permissions
    });
    expect(builtInDogpileToolPermissions("webSearch")).toEqual([
      {
        kind: "network",
        allowPrivateNetwork: false
      }
    ]);
  });

  it("normalizes adapter errors without losing common permission and cancellation codes", () => {
    const permissionDenied: RuntimeToolAdapterError = {
      code: "permission-denied",
      message: "Search API credential is missing.",
      retryable: false,
      detail: {
        permission: "tenant-search-api-key"
      }
    };

    expect(normalizeRuntimeToolAdapterError(permissionDenied)).toEqual(permissionDenied);
    expect(normalizeRuntimeToolAdapterError(new DOMException("Caller aborted lookup.", "AbortError"))).toEqual({
      code: "aborted",
      message: "Caller aborted lookup.",
      retryable: true,
      detail: {
        name: "AbortError"
      }
    });
    expect(normalizeRuntimeToolAdapterError(new TypeError("backend refused request"))).toEqual({
      code: "backend-error",
      message: "backend refused request",
      retryable: false,
      detail: {
        name: "TypeError"
      }
    });
    expect(normalizeRuntimeToolAdapterError("plain failure")).toEqual({
      code: "unknown",
      message: "Tool execution failed with a non-Error value.",
      retryable: false,
      detail: {
        valueType: "string"
      }
    });
  });

  it("covers webSearch success, backend status failure, and malformed payload failure", async () => {
    const successfulFetch: WebSearchFetch = async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Portable replay",
              url: "https://example.test/replay"
            }
          ]
        }),
        { status: 200 }
      );
    const serverFailureFetch: WebSearchFetch = async () =>
      new Response(JSON.stringify({ error: "down" }), {
        status: 503,
        statusText: "Service Unavailable"
      });
    const malformedFetch: WebSearchFetch = async () =>
      new Response(JSON.stringify({ results: [{ title: "Missing URL" }] }), { status: 200 });

    const successfulTool = createWebSearchToolAdapter({
      endpoint: "https://search.example.test/api",
      fetch: successfulFetch
    });
    const serverFailureTool = createWebSearchToolAdapter({
      endpoint: "https://search.example.test/api",
      fetch: serverFailureFetch
    });
    const malformedTool = createWebSearchToolAdapter({
      endpoint: "https://search.example.test/api",
      fetch: malformedFetch
    });

    await expect(successfulTool.execute({ query: "portable replay" }, context)).resolves.toEqual({
      type: "success",
      toolCallId: "tool-call-1",
      tool: successfulTool.identity,
      output: {
        results: [
          {
            title: "Portable replay",
            url: "https://example.test/replay"
          }
        ]
      }
    });
    await expect(serverFailureTool.execute({ query: "portable replay" }, context)).resolves.toEqual({
      type: "error",
      toolCallId: "tool-call-1",
      tool: serverFailureTool.identity,
      error: {
        code: "unavailable",
        message: "Web search backend returned HTTP 503.",
        retryable: true,
        detail: {
          status: 503,
          statusText: "Service Unavailable"
        }
      }
    });
    await expect(malformedTool.execute({ query: "portable replay" }, context)).resolves.toEqual({
      type: "error",
      toolCallId: "tool-call-1",
      tool: malformedTool.identity,
      error: {
        code: "backend-error",
        message: "Web search result url must be a non-empty string.",
        retryable: false
      }
    });
  });

  it("covers codeExec success and policy failure before sandbox execution", async () => {
    let sandboxCalls = 0;
    const tool = createCodeExecToolAdapter({
      execute(input): CodeExecToolOutput {
        sandboxCalls += 1;
        return {
          stdout: `ran:${input.language}:${input.timeoutMs}`,
          stderr: "",
          exitCode: 0
        };
      },
      defaultTimeoutMs: 75,
      maxTimeoutMs: 100,
      languages: ["typescript"]
    });

    await expect(tool.execute({ language: "typescript", code: "export const ok = true;" }, context)).resolves.toEqual({
      type: "success",
      toolCallId: "tool-call-1",
      tool: tool.identity,
      output: {
        stdout: "ran:typescript:75",
        stderr: "",
        exitCode: 0
      }
    });
    expect(sandboxCalls).toBe(1);

    await expect(tool.execute({ language: "typescript", code: "export const slow = true;", timeoutMs: 250 }, context))
      .resolves.toEqual({
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
    expect(sandboxCalls).toBe(1);
  });

  it("covers Vercel AI adapter success and definition/output failures", async () => {
    const successfulTool = await normalizeVercelAITool({
      name: "lookup",
      tool: tool<LookupInput, LookupOutput>({
        inputSchema: jsonSchema<LookupInput>({
          type: "object",
          properties: {
            query: { type: "string" }
          },
          required: ["query"],
          additionalProperties: false
        }),
        execute(input) {
          return {
            answer: `found:${input.query}`
          };
        }
      })
    });
    const emptyIterableTool = await normalizeVercelAITool({
      name: "emptyLookup",
      tool: tool<LookupInput, LookupOutput>({
        inputSchema: jsonSchema<LookupInput>({
          type: "object",
          properties: {
            query: { type: "string" }
          },
          required: ["query"],
          additionalProperties: false
        }),
        async *execute() {
          return;
        }
      })
    });

    await expect(successfulTool.execute({ query: "tools" }, context)).resolves.toEqual({
      type: "success",
      toolCallId: "tool-call-1",
      tool: successfulTool.identity,
      output: {
        answer: "found:tools"
      }
    });
    await expect(emptyIterableTool.execute({ query: "tools" }, context)).resolves.toEqual({
      type: "error",
      toolCallId: "tool-call-1",
      tool: emptyIterableTool.identity,
      error: {
        code: "vercel-ai-tool-error",
        message: "Vercel AI tool async iterable completed without an output.",
        retryable: false,
        detail: {
          name: "DogpileError"
        }
      }
    });
    await expect(
      normalizeVercelAITool({
        name: "missingExecute",
        tool: {
          inputSchema: jsonSchema<LookupInput>({
            type: "object",
            properties: {
              query: { type: "string" }
            },
            required: ["query"],
            additionalProperties: false
          })
        }
      })
    ).rejects.toThrow('Vercel AI tool "missingExecute" must define execute() to run inside Dogpile.');
  });
});
