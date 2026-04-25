import { jsonSchema, tool } from "ai";
import { describe, expect, it } from "vitest";
import {
  builtInDogpileToolIdentity,
  createRuntimeToolExecutor,
  normalizeBuiltInDogpileTool,
  run,
  runtimeToolManifest,
  type ConfiguredModelProvider,
  type JsonObject,
  type ModelRequest,
  type ProtocolConfig,
  type RunEvent,
  type RuntimeTool,
  type RuntimeToolExecutionContext,
  type RuntimeToolResult,
  type RuntimeToolSuccessResult,
  type WebSearchToolOutput
} from "../index.js";
import { normalizeVercelAITool } from "../runtime/tools.js";

interface LookupInput extends JsonObject {
  readonly query: string;
}

interface LookupOutput extends JsonObject {
  readonly answer: string;
  readonly contextRunId: string;
  readonly contextProtocol: string;
}

const runtimeContext: RuntimeToolExecutionContext = {
  runId: "run-runtime-interface-contract",
  toolCallId: "tool-call-shared-interface",
  protocol: "sequential",
  tier: "balanced",
  agentId: "agent-researcher",
  role: "researcher",
  turn: 2,
  trace: {
    events: [],
    transcript: []
  },
  metadata: {
    fixture: "same-runtime-interface"
  }
};

async function executeThroughRuntimeInterface<Input extends object, Output>(
  runtimeTool: RuntimeTool<Input, Output>,
  input: Input,
  context: RuntimeToolExecutionContext
): Promise<RuntimeToolResult<Output>> {
  return await runtimeTool.execute(input, context);
}

describe("runtime tool interface contract", () => {
  it("executes built-in and Vercel AI tools through the same runtime interface", async () => {
    const builtInTool = normalizeBuiltInDogpileTool({
      name: "webSearch",
      execute(input, context): RuntimeToolSuccessResult<WebSearchToolOutput> {
        return {
          type: "success",
          toolCallId: context.toolCallId,
          tool: builtInDogpileToolIdentity("webSearch"),
          output: {
            results: [
              {
                title: `built-in:${input.query}`,
                url: "https://example.test/runtime-contract",
                snippet: `${context.runId}:${context.protocol}:${context.metadata?.fixture ?? "missing"}`
              }
            ]
          }
        };
      }
    });
    const vercelAITool = await normalizeVercelAITool({
      name: "lookup",
      tool: tool<LookupInput, LookupOutput>({
        description: "Lookup through the Vercel AI SDK tool adapter.",
        inputSchema: jsonSchema<LookupInput>({
          type: "object",
          properties: {
            query: { type: "string" }
          },
          required: ["query"],
          additionalProperties: false
        }),
        execute(input, options) {
          const context = options.experimental_context as RuntimeToolExecutionContext;

          return {
            answer: `vercel-ai:${input.query}`,
            contextRunId: context.runId,
            contextProtocol: context.protocol
          };
        }
      })
    });

    const builtInResult = await executeThroughRuntimeInterface(
      builtInTool,
      { query: "drop hierarchy", maxResults: 1 },
      runtimeContext
    );
    const vercelAIResult = await executeThroughRuntimeInterface(vercelAITool, { query: "drop hierarchy" }, runtimeContext);

    expect(builtInResult).toEqual({
      type: "success",
      toolCallId: runtimeContext.toolCallId,
      tool: builtInDogpileToolIdentity("webSearch"),
      output: {
        results: [
          {
            title: "built-in:drop hierarchy",
            url: "https://example.test/runtime-contract",
            snippet: "run-runtime-interface-contract:sequential:same-runtime-interface"
          }
        ]
      }
    });
    expect(vercelAIResult).toEqual({
      type: "success",
      toolCallId: runtimeContext.toolCallId,
      tool: vercelAITool.identity,
      output: {
        answer: "vercel-ai:drop hierarchy",
        contextRunId: "run-runtime-interface-contract",
        contextProtocol: "sequential"
      }
    });
    expect(
      JSON.parse(
        JSON.stringify({
          tools: [
            { identity: builtInTool.identity, inputSchema: builtInTool.inputSchema },
            { identity: vercelAITool.identity, inputSchema: vercelAITool.inputSchema }
          ],
          results: [builtInResult, vercelAIResult]
        })
      )
    ).toEqual({
      tools: [
        { identity: builtInTool.identity, inputSchema: builtInTool.inputSchema },
        { identity: vercelAITool.identity, inputSchema: vercelAITool.inputSchema }
      ],
      results: [builtInResult, vercelAIResult]
    });
  });

  it("executes tools through one protocol-agnostic executor and emits matched tool events", async () => {
    const events: RunEvent[] = [];
    const lookupTool: RuntimeTool<LookupInput, LookupOutput> = {
      identity: {
        id: "fixture.lookup",
        name: "lookup"
      },
      inputSchema: {
        kind: "json-schema",
        schema: {
          type: "object",
          properties: {
            query: { type: "string" }
          },
          required: ["query"],
          additionalProperties: false
        }
      },
      execute(input, context) {
        return {
          type: "success",
          toolCallId: context.toolCallId,
          tool: this.identity,
          output: {
            answer: `tool:${input.query}`,
            contextRunId: context.runId,
            contextProtocol: context.protocol
          }
        };
      }
    };

    const executor = createRuntimeToolExecutor({
      runId: "run-shared-tool-executor",
      protocol: "broadcast",
      tier: "fast",
      tools: [lookupTool],
      emit: (event) => events.push(event),
      getTrace: () => ({ events, transcript: [] })
    });

    const result = await executor.execute({
      toolId: "fixture.lookup",
      input: { query: "portable tools" },
      agentId: "agent-tool-user",
      role: "researcher",
      turn: 1
    });

    expect(result).toEqual({
      type: "success",
      toolCallId: "run-shared-tool-executor:tool-1",
      tool: lookupTool.identity,
      output: {
        answer: "tool:portable tools",
        contextRunId: "run-shared-tool-executor",
        contextProtocol: "broadcast"
      }
    });
    expect(events.map((event) => event.type)).toEqual(["tool-call", "tool-result"]);
    expect(JSON.parse(JSON.stringify({ manifest: runtimeToolManifest([lookupTool]), events, result }))).toEqual({
      manifest: [
        {
          identity: lookupTool.identity,
          inputSchema: lookupTool.inputSchema,
          permissions: []
        }
      ],
      events,
      result
    });
  });

  it("keeps runtime tool invocation behavior consistent across every first-party protocol", async () => {
    const protocols = [
      { name: "sequential", config: { kind: "sequential", maxTurns: 1 } },
      { name: "coordinator", config: { kind: "coordinator", maxTurns: 1 } },
      { name: "broadcast", config: { kind: "broadcast", maxRounds: 1 } },
      { name: "shared", config: { kind: "shared", maxTurns: 1 } }
    ] satisfies readonly { readonly name: RuntimeToolExecutionContext["protocol"]; readonly config: ProtocolConfig }[];
    const summaries: Array<{
      readonly protocol: RuntimeToolExecutionContext["protocol"];
      readonly eventTypes: readonly RunEvent["type"][];
      readonly successType: RuntimeToolResult["type"];
      readonly missingType: RuntimeToolResult["type"];
      readonly missingCode: string | undefined;
      readonly successToolCallId: string;
      readonly missingToolCallId: string;
    }> = [];

    for (const protocol of protocols) {
      const events: RunEvent[] = [];
      const observedContexts: RuntimeToolExecutionContext[] = [];
      const lookupTool: RuntimeTool<LookupInput, LookupOutput> = {
        identity: {
          id: "fixture.lookup",
          namespace: "dogpile.test",
          name: "lookup",
          version: "1.0.0"
        },
        inputSchema: {
          kind: "json-schema",
          schema: {
            type: "object",
            properties: {
              query: { type: "string" }
            },
            required: ["query"],
            additionalProperties: false
          }
        },
        execute(input, context) {
          observedContexts.push(context);

          return {
            type: "success",
            toolCallId: context.toolCallId,
            tool: this.identity,
            output: {
              answer: `tool:${input.query}`,
              contextRunId: context.runId,
              contextProtocol: context.protocol
            }
          };
        }
      };
      const executor = createRuntimeToolExecutor({
        runId: `run-${protocol.name}-tool-invocation`,
        protocol: protocol.name,
        tier: "quality",
        tools: [lookupTool],
        emit: (event) => events.push(event),
        getTrace: () => ({
          events,
          transcript: [
            {
              agentId: "prior-agent",
              role: "observer",
              input: "record context before tool use",
              output: `${protocol.name}:prior-output`
            }
          ]
        }),
        metadata: {
          fixture: "cross-protocol-tool-invocation"
        },
        makeToolCallId: (toolIdentity, index) => `${protocol.name}:${toolIdentity.name}:${index + 1}`
      });

      const success = await executor.execute({
        toolId: "fixture.lookup",
        input: { query: `${protocol.name} evidence` },
        agentId: `${protocol.name}-agent`,
        role: "researcher",
        turn: 2,
        metadata: {
          requestProtocol: protocol.name
        }
      });
      const missing = await executor.execute({
        toolId: "fixture.missing",
        input: { query: "unregistered lookup" },
        agentId: `${protocol.name}-agent`,
        role: "researcher",
        turn: 3
      });

      expect(success).toEqual({
        type: "success",
        toolCallId: `${protocol.name}:lookup:1`,
        tool: lookupTool.identity,
        output: {
          answer: `tool:${protocol.name} evidence`,
          contextRunId: `run-${protocol.name}-tool-invocation`,
          contextProtocol: protocol.name
        }
      });
      expect(missing).toEqual({
        type: "error",
        toolCallId: `${protocol.name}:fixture.missing:2`,
        tool: {
          id: "fixture.missing",
          name: "fixture.missing"
        },
        error: {
          code: "unavailable",
          message: 'Runtime tool "fixture.missing" is not registered.',
          retryable: false
        }
      });
      expect(events).toEqual([
        expect.objectContaining({
          type: "tool-call",
          runId: `run-${protocol.name}-tool-invocation`,
          toolCallId: `${protocol.name}:lookup:1`,
          tool: lookupTool.identity,
          input: { query: `${protocol.name} evidence` },
          agentId: `${protocol.name}-agent`,
          role: "researcher"
        }),
        expect.objectContaining({
          type: "tool-result",
          runId: `run-${protocol.name}-tool-invocation`,
          toolCallId: `${protocol.name}:lookup:1`,
          tool: lookupTool.identity,
          result: success,
          agentId: `${protocol.name}-agent`,
          role: "researcher"
        }),
        expect.objectContaining({
          type: "tool-call",
          runId: `run-${protocol.name}-tool-invocation`,
          toolCallId: `${protocol.name}:fixture.missing:2`,
          tool: {
            id: "fixture.missing",
            name: "fixture.missing"
          },
          input: { query: "unregistered lookup" },
          agentId: `${protocol.name}-agent`,
          role: "researcher"
        }),
        expect.objectContaining({
          type: "tool-result",
          runId: `run-${protocol.name}-tool-invocation`,
          toolCallId: `${protocol.name}:fixture.missing:2`,
          tool: {
            id: "fixture.missing",
            name: "fixture.missing"
          },
          result: missing,
          agentId: `${protocol.name}-agent`,
          role: "researcher"
        })
      ]);
      expect(observedContexts).toEqual([
        expect.objectContaining({
          runId: `run-${protocol.name}-tool-invocation`,
          toolCallId: `${protocol.name}:lookup:1`,
          protocol: protocol.name,
          tier: "quality",
          agentId: `${protocol.name}-agent`,
          role: "researcher",
          turn: 2,
          metadata: {
            fixture: "cross-protocol-tool-invocation",
            requestProtocol: protocol.name
          }
        })
      ]);
      expect(observedContexts[0]?.trace?.transcript).toEqual([
        {
          agentId: "prior-agent",
          role: "observer",
          input: "record context before tool use",
          output: `${protocol.name}:prior-output`
        }
      ]);
      expect(JSON.parse(JSON.stringify({ events, success, missing }))).toEqual({ events, success, missing });

      summaries.push({
        protocol: protocol.name,
        eventTypes: events.map((event) => event.type),
        successType: success.type,
        missingType: missing.type,
        missingCode: missing.type === "error" ? missing.error.code : undefined,
        successToolCallId: success.toolCallId,
        missingToolCallId: missing.toolCallId
      });
    }

    expect(summaries).toEqual(
      protocols.map((protocol) => ({
        protocol: protocol.name,
        eventTypes: ["tool-call", "tool-result", "tool-call", "tool-result"],
        successType: "success",
        missingType: "error",
        missingCode: "unavailable",
        successToolCallId: `${protocol.name}:lookup:1`,
        missingToolCallId: `${protocol.name}:fixture.missing:2`
      }))
    );
  });

  it("makes the same runtime tool manifest visible to every first-party protocol", async () => {
    const protocols: readonly ProtocolConfig[] = [
      { kind: "sequential", maxTurns: 1 },
      { kind: "coordinator", maxTurns: 1 },
      { kind: "broadcast", maxRounds: 1 },
      { kind: "shared", maxTurns: 1 }
    ];
    const runtimeTool: RuntimeTool<LookupInput, LookupOutput> = {
      identity: {
        id: "fixture.lookup",
        namespace: "dogpile.test",
        name: "lookup",
        version: "1.0.0"
      },
      inputSchema: {
        kind: "json-schema",
        schema: {
          type: "object",
          properties: {
            query: { type: "string" }
          },
          required: ["query"],
          additionalProperties: false
        }
      },
      execute(input, context) {
        return {
          type: "success",
          toolCallId: context.toolCallId,
          tool: this.identity,
          output: {
            answer: input.query,
            contextRunId: context.runId,
            contextProtocol: context.protocol
          }
        };
      }
    };
    const expectedManifest = runtimeToolManifest([runtimeTool]);

    for (const protocol of protocols) {
      const requests: ModelRequest[] = [];
      const model: ConfiguredModelProvider = {
        id: `tool-manifest-${protocol.kind}`,
        async generate(request) {
          requests.push(request);
          return { text: `${protocol.kind}:ok` };
        }
      };

      await run({
        intent: `Expose tools for ${protocol.kind}.`,
        protocol,
        tier: "fast",
        model,
        agents: [{ id: "agent-1", role: "researcher" }],
        tools: [runtimeTool]
      });

      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((request) => request.metadata.tools !== undefined)).toBe(true);
      expect(requests.map((request) => request.metadata.tools)).toEqual(requests.map(() => expectedManifest));
    }
  });
});
