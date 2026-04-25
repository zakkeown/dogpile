import { describe, expect, it } from "vitest";
import { builtInDogpileToolIdentity, normalizeBuiltInDogpileTool, run } from "../index.js";
import type {
  ConfiguredModelProvider,
  CodeExecToolOutput,
  JsonObject,
  ModelRequest,
  ModelResponse,
  ProtocolConfig,
  RuntimeTool,
  RuntimeToolExecutionContext
} from "../index.js";

interface LookupInput extends JsonObject {
  readonly query: string;
}

interface LookupOutput extends JsonObject {
  readonly answer: string;
  readonly protocol: string;
  readonly agentId: string;
  readonly turn: number;
}

describe("protocol user tool execution", () => {
  it("preserves built-in and caller-supplied tool calls and results in transcripts for every protocol", async () => {
    const protocols = [
      { kind: "sequential", maxTurns: 1 },
      { kind: "broadcast", maxRounds: 1 },
      { kind: "shared", maxTurns: 1 },
      { kind: "coordinator", maxTurns: 1 }
    ] satisfies readonly ProtocolConfig[];
    const userToolIdentity = {
      id: "fixture.lookup",
      namespace: "dogpile.test",
      name: "lookup",
      version: "1.0.0",
      description: "User-supplied lookup tool for transcript coverage."
    };
    const builtInToolIdentity = builtInDogpileToolIdentity("codeExec");

    for (const protocol of protocols) {
      const lookupTool: RuntimeTool<LookupInput, LookupOutput> = {
        identity: userToolIdentity,
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
              answer: `lookup:${input.query}`,
              protocol: context.protocol,
              agentId: context.agentId ?? "missing-agent",
              turn: context.turn ?? -1
            }
          };
        }
      };
      const codeExecTool = normalizeBuiltInDogpileTool({
        name: "codeExec",
        execute(input, context) {
          return {
            type: "success",
            toolCallId: context.toolCallId,
            tool: builtInToolIdentity,
            output: {
              stdout: `executed:${input.code}`,
              stderr: "",
              exitCode: 0,
              metadata: {
                protocol: context.protocol,
                turn: context.turn ?? -1
              }
            } satisfies CodeExecToolOutput
          };
        }
      });
      let modelTurn = 0;
      const model: ConfiguredModelProvider = {
        id: `transcript-tools-${protocol.kind}-model`,
        async generate(): Promise<ModelResponse> {
          modelTurn += 1;
          const turn = modelTurn;

          return {
            text: `${protocol.kind}:turn-${turn}`,
            toolRequests: [
              {
                toolId: userToolIdentity.id,
                input: {
                  query: `user:${protocol.kind}:${turn}`
                }
              },
              {
                toolId: builtInToolIdentity.id,
                input: {
                  language: "typescript",
                  code: `built-in:${protocol.kind}:${turn}`
                }
              }
            ],
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2
            },
            costUsd: 0.0001
          };
        }
      };

      const result = await run({
        intent: `Preserve tools in the ${protocol.kind} transcript.`,
        protocol,
        tier: "fast",
        model,
        agents: [{ id: `${protocol.kind}-agent`, role: "researcher" }],
        tools: [lookupTool, codeExecTool]
      });
      const transcriptToolCalls = result.transcript.flatMap((entry) => entry.toolCalls ?? []);
      const toolCallEvents = result.trace.events.filter((event) => event.type === "tool-call");
      const toolResultEvents = result.trace.events.filter((event) => event.type === "tool-result");

      expect(result.trace.transcript).toEqual(result.transcript);
      expect(result.transcript.every((entry) => entry.toolCalls?.length === 2)).toBe(true);
      expect(transcriptToolCalls).toHaveLength(toolResultEvents.length);
      expect(transcriptToolCalls.map((toolCall) => toolCall.toolCallId)).toEqual(
        toolResultEvents.map((event) => event.toolCallId)
      );
      expect(transcriptToolCalls.map((toolCall) => toolCall.input)).toEqual(toolCallEvents.map((event) => event.input));

      for (const [entryIndex, entry] of result.transcript.entries()) {
        const turn = entryIndex + 1;
        const [userToolCall, builtInToolCall] = entry.toolCalls ?? [];

        expect(userToolCall).toEqual(
          expect.objectContaining({
            tool: userToolIdentity,
            input: {
              query: `user:${protocol.kind}:${turn}`
            },
            result: {
              type: "success",
              toolCallId: userToolCall?.toolCallId,
              tool: userToolIdentity,
              output: {
                answer: `lookup:user:${protocol.kind}:${turn}`,
                protocol: protocol.kind,
                agentId: `${protocol.kind}-agent`,
                turn
              }
            }
          })
        );
        expect(builtInToolCall).toEqual(
          expect.objectContaining({
            tool: builtInToolIdentity,
            input: {
              language: "typescript",
              code: `built-in:${protocol.kind}:${turn}`
            },
            result: {
              type: "success",
              toolCallId: builtInToolCall?.toolCallId,
              tool: builtInToolIdentity,
              output: {
                stdout: `executed:built-in:${protocol.kind}:${turn}`,
                stderr: "",
                exitCode: 0,
                metadata: {
                  protocol: protocol.kind,
                  turn
                }
              }
            }
          })
        );
      }
    }
  });

  it("executes caller-supplied tools successfully across every first-party protocol", async () => {
    const protocols = [
      { kind: "sequential", maxTurns: 1 },
      { kind: "broadcast", maxRounds: 1 },
      { kind: "shared", maxTurns: 1 },
      { kind: "coordinator", maxTurns: 1 }
    ] satisfies readonly ProtocolConfig[];
    const summaries: Array<{
      readonly protocol: ProtocolConfig["kind"];
      readonly toolResultCount: number;
      readonly resultTypes: readonly string[];
      readonly observedProtocols: readonly string[];
      readonly observedQueries: readonly string[];
    }> = [];

    for (const protocol of protocols) {
      const observedContexts: RuntimeToolExecutionContext[] = [];
      const requests: ModelRequest[] = [];
      const lookupTool: RuntimeTool<LookupInput, LookupOutput> = {
        identity: {
          id: "fixture.lookup",
          namespace: "dogpile.test",
          name: "lookup",
          version: "1.0.0",
          description: "User-supplied lookup tool for protocol coverage."
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
              answer: `lookup:${input.query}`,
              protocol: context.protocol,
              agentId: context.agentId ?? "missing-agent",
              turn: context.turn ?? -1
            }
          };
        }
      };
      const model: ConfiguredModelProvider = {
        id: `user-tool-${protocol.kind}-model`,
        async generate(request): Promise<ModelResponse> {
          requests.push(request);

          return {
            text: `${protocol.kind}:model-turn-${requests.length}`,
            toolRequests: [
              {
                toolId: "fixture.lookup",
                input: {
                  query: `${protocol.kind}:${String(request.metadata.agentId)}:${requests.length}`
                }
              }
            ],
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2
            },
            costUsd: 0.0001
          };
        }
      };

      const result = await run({
        intent: `Use the caller lookup tool during a ${protocol.kind} run.`,
        protocol,
        tier: "fast",
        model,
        agents: [{ id: `${protocol.kind}-agent`, role: "researcher" }],
        tools: [lookupTool]
      });
      const toolCallEvents = result.trace.events.filter((event) => event.type === "tool-call");
      const toolResultEvents = result.trace.events.filter((event) => event.type === "tool-result");

      expect(result.trace.protocol).toBe(protocol.kind);
      expect(result.eventLog.protocol).toBe(protocol.kind);
      expect(toolCallEvents.length).toBeGreaterThan(0);
      expect(toolResultEvents).toHaveLength(toolCallEvents.length);
      expect(toolResultEvents.every((event) => event.result.type === "success")).toBe(true);
      expect(toolResultEvents.map((event) => event.tool)).toEqual(toolResultEvents.map(() => lookupTool.identity));
      for (const [index, toolCallEvent] of toolCallEvents.entries()) {
        const toolResultEvent = toolResultEvents[index];
        const expectedQuery = `${protocol.kind}:${protocol.kind}-agent:${index + 1}`;
        const expectedToolCallId = toolCallEvent.toolCallId;

        if (toolResultEvent === undefined) {
          throw new Error(`missing tool-result event for ${expectedToolCallId}`);
        }
        if (toolResultEvent.result.type !== "success") {
          throw new Error(`expected successful tool-result event for ${expectedToolCallId}`);
        }

        expect(toolCallEvent).toEqual(
          expect.objectContaining({
            runId: result.trace.runId,
            toolCallId: expectedToolCallId,
            tool: lookupTool.identity,
            input: {
              query: expectedQuery
            },
            agentId: `${protocol.kind}-agent`,
            role: "researcher"
          })
        );
        expect(toolResultEvent).toEqual(
          expect.objectContaining({
            runId: result.trace.runId,
            toolCallId: expectedToolCallId,
            tool: lookupTool.identity,
            agentId: `${protocol.kind}-agent`,
            role: "researcher",
            result: {
              type: "success",
              toolCallId: expectedToolCallId,
              tool: lookupTool.identity,
              output: {
                answer: `lookup:${expectedQuery}`,
                protocol: protocol.kind,
                agentId: `${protocol.kind}-agent`,
                turn: index + 1
              }
            }
          })
        );
      }
      expect(observedContexts.map((context) => context.protocol)).toEqual(observedContexts.map(() => protocol.kind));
      expect(observedContexts.every((context) => context.agentId === `${protocol.kind}-agent`)).toBe(true);
      expect(result.eventLog.eventTypes).toContain("tool-call");
      expect(result.eventLog.eventTypes).toContain("tool-result");
      expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);

      summaries.push({
        protocol: protocol.kind,
        toolResultCount: toolResultEvents.length,
        resultTypes: toolResultEvents.map((event) => event.result.type),
        observedProtocols: observedContexts.map((context) => context.protocol),
        observedQueries: toolCallEvents.map((event) => String(event.input.query))
      });
    }

    expect(summaries).toEqual([
      {
        protocol: "sequential",
        toolResultCount: 1,
        resultTypes: ["success"],
        observedProtocols: ["sequential"],
        observedQueries: ["sequential:sequential-agent:1"]
      },
      {
        protocol: "broadcast",
        toolResultCount: 1,
        resultTypes: ["success"],
        observedProtocols: ["broadcast"],
        observedQueries: ["broadcast:broadcast-agent:1"]
      },
      {
        protocol: "shared",
        toolResultCount: 1,
        resultTypes: ["success"],
        observedProtocols: ["shared"],
        observedQueries: ["shared:shared-agent:1"]
      },
      {
        protocol: "coordinator",
        toolResultCount: 2,
        resultTypes: ["success", "success"],
        observedProtocols: ["coordinator", "coordinator"],
        observedQueries: ["coordinator:coordinator-agent:1", "coordinator:coordinator-agent:2"]
      }
    ]);
  });
});
