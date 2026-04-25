import { describe, expect, it } from "vitest";
import type {
  RuntimeTool,
  RuntimeToolAdapterContract,
  RuntimeToolAdapterError,
  RuntimeToolPermission,
  RuntimeToolValidationResult,
  RuntimeToolError,
  RuntimeToolErrorResult,
  RuntimeToolExecutionContext,
  RuntimeToolIdentity,
  RuntimeToolInputSchema,
  RuntimeToolResult,
  RuntimeToolSuccessResult
} from "../index.js";

type LookupInput = {
  readonly query: string;
  readonly limit: number;
};

type LookupOutput = {
  readonly matches: string[];
};

describe("runtime tool type contracts", () => {
  it("defines protocol-agnostic tool identity, input schema, execution context, result, and error shapes", async () => {
    const identity: RuntimeToolIdentity = {
      id: "search.lookup",
      namespace: "dogpile.test",
      name: "Lookup",
      version: "1.0.0",
      description: "Search a caller-owned index."
    };
    const inputSchema: RuntimeToolInputSchema = {
      kind: "json-schema",
      description: "Lookup query.",
      schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" }
        },
        required: ["query", "limit"],
        additionalProperties: false
      }
    };
    const context: RuntimeToolExecutionContext = {
      runId: "run-tool-contract",
      toolCallId: "tool-call-1",
      protocol: "sequential",
      tier: "fast",
      agentId: "agent-1",
      role: "researcher",
      turn: 1,
      trace: {
        events: [],
        transcript: []
      },
      metadata: {
        fixture: "runtime-tool-types"
      }
    };
    const tool: RuntimeTool<LookupInput, LookupOutput> = {
      identity,
      inputSchema,
      execute(input, executionContext): RuntimeToolSuccessResult<LookupOutput> {
        return {
          type: "success",
          toolCallId: executionContext.toolCallId,
          tool: identity,
          output: {
            matches: [`${input.query}:${input.limit}`]
          },
          metadata: {
            protocol: executionContext.protocol
          }
        };
      }
    };

    const result: RuntimeToolResult<LookupOutput> = await tool.execute({ query: "paper", limit: 2 }, context);

    expect(result).toEqual({
      type: "success",
      toolCallId: "tool-call-1",
      tool: identity,
      output: {
        matches: ["paper:2"]
      },
      metadata: {
        protocol: "sequential"
      }
    });
    expect(JSON.parse(JSON.stringify({ identity, inputSchema, context, result }))).toEqual({
      identity,
      inputSchema,
      context,
      result
    });
  });

  it("defines a serializable runtime tool error result shape", () => {
    const identity: RuntimeToolIdentity = {
      id: "search.lookup",
      name: "Lookup"
    };
    const error: RuntimeToolError = {
      code: "timeout",
      message: "Lookup exceeded the caller budget.",
      retryable: true,
      detail: {
        timeoutMs: 250
      }
    };
    const result: RuntimeToolErrorResult = {
      type: "error",
      toolCallId: "tool-call-timeout",
      tool: identity,
      error,
      metadata: {
        haltedBeforeCapBreach: true
      }
    };

    expect(result.error.code).toBe("timeout");
    expect(result.error.retryable).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("defines shared adapter permissions, validation, and common adapter error types", () => {
    const permissions: readonly RuntimeToolPermission[] = [
      {
        kind: "network",
        allowHosts: ["api.example.test"],
        allowPrivateNetwork: false
      },
      {
        kind: "code-execution",
        sandbox: "caller-provided",
        languages: ["typescript"],
        allowNetwork: false
      }
    ];
    const validation: RuntimeToolValidationResult = {
      type: "invalid",
      issues: [
        {
          code: "missing-field",
          path: "query",
          message: "query is required"
        }
      ]
    };
    const adapterError: RuntimeToolAdapterError = {
      code: "permission-denied",
      message: "Tool permission was not granted.",
      retryable: false
    };
    const adapter: RuntimeToolAdapterContract<LookupInput, LookupOutput> = {
      identity: {
        id: "search.lookup",
        name: "Lookup"
      },
      inputSchema: {
        kind: "json-schema",
        schema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" }
          },
          required: ["query", "limit"],
          additionalProperties: false
        }
      },
      permissions,
      validateInput(input) {
        return input.query.length > 0 ? { type: "valid" } : validation;
      },
      execute(input, executionContext): RuntimeToolSuccessResult<LookupOutput> {
        return {
          type: "success",
          toolCallId: executionContext.toolCallId,
          tool: this.identity,
          output: {
            matches: [input.query]
          }
        };
      }
    };

    expect(adapter.permissions).toEqual(permissions);
    expect(adapter.validateInput({ query: "", limit: 1 })).toEqual(validation);
    expect(JSON.parse(JSON.stringify({ permissions, validation, adapterError }))).toEqual({
      permissions,
      validation,
      adapterError
    });
  });
});
