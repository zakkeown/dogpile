import { jsonSchema, tool } from "ai";
import { describe, expect, it } from "vitest";
import type { JsonObject, RuntimeToolExecutionContext } from "../index.js";
import { normalizeVercelAITool, normalizeVercelAITools } from "../runtime/tools.js";

const context: RuntimeToolExecutionContext = {
  runId: "run-vercel-ai-tools",
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

interface LookupInput extends JsonObject {
  readonly query: string;
  readonly limit?: number;
}

interface LookupOutput extends JsonObject {
  readonly answer: string;
  readonly seenContextRunId: string;
}

describe("Vercel AI tool normalization", () => {
  it("normalizes a user-supplied AI SDK tool into the shared runtime tool interface", async () => {
    const lookupTool = tool<LookupInput, LookupOutput>({
      description: "Look up a fact for the current mission.",
      inputSchema: jsonSchema<LookupInput>({
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", minimum: 1 }
        },
        required: ["query"],
        additionalProperties: false
      }),
      execute(input, options) {
        const dogpileContext = options.experimental_context as RuntimeToolExecutionContext;

        return {
          answer: `${input.query}:${input.limit ?? 10}`,
          seenContextRunId: dogpileContext.runId
        };
      }
    });

    const runtimeTool = await normalizeVercelAITool({
      name: "lookup",
      tool: lookupTool,
      identity: {
        namespace: "fixture",
        version: "2026-04-24"
      }
    });

    expect(runtimeTool.identity).toEqual({
      id: "vercel-ai.tools.lookup",
      namespace: "fixture",
      name: "lookup",
      version: "2026-04-24",
      description: "Look up a fact for the current mission."
    });
    expect(runtimeTool.inputSchema).toEqual({
      kind: "json-schema",
      description: "Look up a fact for the current mission.",
      schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", minimum: 1 }
        },
        required: ["query"],
        additionalProperties: false
      }
    });

    const result = await runtimeTool.execute({ query: "drop the hierarchy", limit: 2 }, context);

    expect(result).toEqual({
      type: "success",
      toolCallId: "tool-call-1",
      tool: runtimeTool.identity,
      output: {
        answer: "drop the hierarchy:2",
        seenContextRunId: "run-vercel-ai-tools"
      }
    });
    expect(JSON.parse(JSON.stringify({ identity: runtimeTool.identity, inputSchema: runtimeTool.inputSchema, result }))).toEqual({
      identity: runtimeTool.identity,
      inputSchema: runtimeTool.inputSchema,
      result
    });
  });

  it("uses the final value from Vercel AI async iterable tool outputs", async () => {
    const runtimeTool = await normalizeVercelAITool({
      name: "progressiveLookup",
      tool: tool<LookupInput, LookupOutput>({
        inputSchema: jsonSchema<LookupInput>({
          type: "object",
          properties: {
            query: { type: "string" }
          },
          required: ["query"],
          additionalProperties: false
        }),
        async *execute(input) {
          yield { answer: `draft:${input.query}`, seenContextRunId: "draft" };
          yield { answer: `final:${input.query}`, seenContextRunId: "final" };
        }
      })
    });

    await expect(runtimeTool.execute({ query: "tools" }, context)).resolves.toEqual({
      type: "success",
      toolCallId: "tool-call-1",
      tool: runtimeTool.identity,
      output: {
        answer: "final:tools",
        seenContextRunId: "final"
      }
    });
  });

  it("normalizes thrown Vercel AI tool failures into serializable runtime errors", async () => {
    const runtimeTool = await normalizeVercelAITool({
      name: "failingLookup",
      tool: tool<LookupInput, LookupOutput>({
        inputSchema: jsonSchema<LookupInput>({
          type: "object",
          properties: {
            query: { type: "string" }
          },
          required: ["query"],
          additionalProperties: false
        }),
        execute() {
          throw new Error("lookup backend unavailable");
        }
      })
    });

    await expect(runtimeTool.execute({ query: "tools" }, context)).resolves.toEqual({
      type: "error",
      toolCallId: "tool-call-1",
      tool: runtimeTool.identity,
      error: {
        code: "vercel-ai-tool-error",
        message: "lookup backend unavailable",
        retryable: false,
        detail: {
          name: "Error"
        }
      }
    });
  });

  it("normalizes Vercel AI tool sets in caller-defined key order", async () => {
    const tools = await normalizeVercelAITools(
      {
        first: tool({
          inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }),
          execute: () => ({ ok: true })
        }),
        second: tool({
          inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }),
          execute: () => ({ ok: true })
        })
      },
      {
        namespace: "fixture"
      }
    );

    expect(tools.map((runtimeTool) => runtimeTool.identity)).toEqual([
      {
        id: "vercel-ai.tools.first",
        name: "first",
        namespace: "fixture"
      },
      {
        id: "vercel-ai.tools.second",
        name: "second",
        namespace: "fixture"
      }
    ]);
  });

  it("accepts Vercel AI tool sets with distinct input shapes", async () => {
    const tools = await normalizeVercelAITools({
      byLocation: tool<{ readonly location: string }, JsonObject>({
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            location: { type: "string" }
          },
          required: ["location"],
          additionalProperties: false
        }),
        execute: (input) => ({ value: input.location })
      }),
      byId: tool<{ readonly id: string }, JsonObject>({
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            id: { type: "string" }
          },
          required: ["id"],
          additionalProperties: false
        }),
        execute: (input) => ({ value: input.id })
      })
    });

    expect(tools.map((runtimeTool) => runtimeTool.identity.name)).toEqual(["byLocation", "byId"]);
  });
});
