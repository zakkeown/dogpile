import type {
  JsonObject,
  JsonValue,
  ModelResponse,
  RuntimeTool,
  RuntimeToolExecutionContext,
  RuntimeToolExecutionRequest,
  RuntimeToolExecutor,
  RuntimeToolIdentity,
  RuntimeToolPermission,
  RuntimeToolResult,
  RuntimeToolTraceContext,
  TranscriptToolCall,
  RunEvent
} from "../types.js";
import { validateRuntimeToolRegistrations } from "./validation.js";
import { normalizeRuntimeToolAdapterError } from "./tools/built-in.js";

// Re-export the public surface from the split modules so the
// `@dogpile/sdk/runtime/tools` subpath stays stable.
export {
  builtInDogpileToolIdentity,
  builtInDogpileToolInputSchema,
  builtInDogpileToolPermissions,
  createCodeExecToolAdapter,
  createWebSearchToolAdapter,
  normalizeBuiltInDogpileTool,
  normalizeBuiltInDogpileTools,
  normalizeRuntimeToolAdapterError,
  validateBuiltInDogpileToolInput
} from "./tools/built-in.js";
export type {
  BuiltInDogpileRuntimeTool,
  BuiltInDogpileToolDefinition,
  BuiltInDogpileToolExecutors,
  BuiltInDogpileToolIdentityOptions,
  CodeExecDogpileToolDefinition,
  CodeExecSandboxExecutor,
  CodeExecToolAdapterOptions,
  CodeExecToolExecutor,
  CodeExecToolInput,
  CodeExecToolLanguage,
  CodeExecToolOutput,
  DogpileBuiltInToolName,
  WebSearchDogpileToolDefinition,
  WebSearchFetch,
  WebSearchFetchRequest,
  WebSearchFetchRequestBuilder,
  WebSearchFetchResponseParser,
  WebSearchToolAdapterOptions,
  WebSearchToolExecutor,
  WebSearchToolInput,
  WebSearchToolOutput,
  WebSearchToolResult
} from "./tools/built-in.js";

export { normalizeVercelAITool, normalizeVercelAITools } from "./tools/vercel-ai.js";
export type {
  VercelAITool,
  VercelAIToolDefinition,
  VercelAIToolIdentityOptions,
  VercelAIToolSet,
  VercelAIToolSetEntry,
  VercelAIToolSetNormalizationOptions
} from "./tools/vercel-ai.js";

// ---------------------------------------------------------------------------
// Runtime tool executor — the protocol-agnostic entry point used by every
// first-party protocol. Stays in tools.ts because it is the central glue
// between adapters and event emission.
// ---------------------------------------------------------------------------

/**
 * Options for the shared protocol-agnostic runtime tool executor.
 */
export interface RuntimeToolExecutorOptions {
  readonly runId: string;
  readonly protocol: RuntimeToolExecutionContext["protocol"];
  readonly tier: RuntimeToolExecutionContext["tier"];
  readonly tools: readonly RuntimeTool<JsonObject, JsonValue>[];
  readonly emit?: (event: RunEvent) => void;
  readonly getTrace?: () => RuntimeToolTraceContext;
  readonly metadata?: JsonObject;
  readonly abortSignal?: AbortSignal;
  readonly makeToolCallId?: (tool: RuntimeToolIdentity, callIndex: number) => string;
}

/**
 * Create the shared runtime tool executor used by every first-party protocol.
 *
 * @remarks
 * The executor owns call id generation, read-only trace context construction,
 * adapter validation, error normalization, and matched `tool-call` /
 * `tool-result` events. Protocols only supply a normalized
 * {@link RuntimeToolExecutionRequest}, which keeps tool execution independent
 * of Coordinator, Sequential, Broadcast, or Shared control flow.
 */
export function createRuntimeToolExecutor(options: RuntimeToolExecutorOptions): RuntimeToolExecutor {
  validateRuntimeToolRegistrations(options.tools);
  const tools = Array.from(options.tools);
  let callCount = 0;

  return {
    tools,
    async execute(request: RuntimeToolExecutionRequest): Promise<RuntimeToolResult> {
      const tool = tools.find((candidate) => candidate.identity.id === request.toolId);
      const identity = tool?.identity ?? {
        id: request.toolId,
        name: request.toolId
      };
      const callIndex = callCount;
      callCount += 1;
      const toolCallId =
        request.toolCallId ?? options.makeToolCallId?.(identity, callIndex) ?? defaultToolCallId(options.runId, callIndex);
      const context = createExecutionContext(options, request, toolCallId);

      options.emit?.({
        type: "tool-call",
        runId: options.runId,
        at: new Date().toISOString(),
        toolCallId,
        tool: identity,
        input: request.input,
        ...(request.agentId ? { agentId: request.agentId } : {}),
        ...(request.role ? { role: request.role } : {})
      });

      const result = await executeRuntimeTool(tool, identity, request.input, context);

      options.emit?.({
        type: "tool-result",
        runId: options.runId,
        at: new Date().toISOString(),
        toolCallId,
        tool: identity,
        result,
        ...(request.agentId ? { agentId: request.agentId } : {}),
        ...(request.role ? { role: request.role } : {})
      });

      return result;
    }
  };
}

/**
 * Return a JSON-serializable manifest for tools visible to a protocol run.
 */
export function runtimeToolManifest(tools: readonly RuntimeTool<JsonObject, JsonValue>[]): JsonObject[] {
  return tools.map((tool) => {
    const inputSchema: JsonObject = {
      kind: tool.inputSchema.kind,
      schema: tool.inputSchema.schema,
      ...(tool.inputSchema.description ? { description: tool.inputSchema.description } : {})
    };

    return {
      identity: runtimeToolIdentityManifest(tool.identity),
      inputSchema,
      permissions: Array.from(tool.permissions ?? []).map(runtimeToolPermissionManifest)
    };
  });
}

/**
 * Return request metadata that makes runtime tools visible to provider
 * adapters, or an empty object when no tools are available.
 */
export function runtimeToolAvailability(tools: readonly RuntimeTool<JsonObject, JsonValue>[]): JsonObject {
  const manifest = runtimeToolManifest(tools);
  return manifest.length > 0 ? { tools: manifest } : {};
}

/**
 * Execute normalized tool requests returned by a provider response.
 */
export async function executeModelResponseToolRequests(options: {
  readonly response: ModelResponse;
  readonly executor: RuntimeToolExecutor;
  readonly agentId: string;
  readonly role: string;
  readonly turn: number;
  readonly metadata?: JsonObject;
}): Promise<readonly TranscriptToolCall[]> {
  const toolCalls: TranscriptToolCall[] = [];

  for (const request of options.response.toolRequests ?? []) {
    const result = await options.executor.execute({
      ...request,
      agentId: request.agentId ?? options.agentId,
      role: request.role ?? options.role,
      turn: request.turn ?? options.turn,
      metadata: mergeToolMetadata(options.metadata, request.metadata)
    });
    toolCalls.push({
      toolCallId: result.toolCallId,
      tool: result.tool,
      input: request.input,
      result
    });
  }

  return toolCalls;
}

function runtimeToolIdentityManifest(identity: RuntimeToolIdentity): JsonObject {
  return {
    id: identity.id,
    name: identity.name,
    ...(identity.namespace ? { namespace: identity.namespace } : {}),
    ...(identity.version ? { version: identity.version } : {}),
    ...(identity.description ? { description: identity.description } : {})
  };
}

function runtimeToolPermissionManifest(permission: RuntimeToolPermission): JsonObject {
  if (permission.kind === "network") {
    return {
      kind: permission.kind,
      ...(permission.allowHosts ? { allowHosts: Array.from(permission.allowHosts) } : {}),
      ...(permission.allowPrivateNetwork === undefined ? {} : { allowPrivateNetwork: permission.allowPrivateNetwork })
    };
  }

  if (permission.kind === "code-execution") {
    return {
      kind: permission.kind,
      sandbox: permission.sandbox,
      ...(permission.languages ? { languages: Array.from(permission.languages) } : {}),
      ...(permission.allowNetwork === undefined ? {} : { allowNetwork: permission.allowNetwork })
    };
  }

  return {
    kind: permission.kind,
    name: permission.name,
    ...(permission.description ? { description: permission.description } : {}),
    ...(permission.metadata ? { metadata: permission.metadata } : {})
  };
}

function createExecutionContext(
  options: RuntimeToolExecutorOptions,
  request: RuntimeToolExecutionRequest,
  toolCallId: string
): RuntimeToolExecutionContext {
  return {
    runId: options.runId,
    toolCallId,
    protocol: options.protocol,
    tier: options.tier,
    ...(request.agentId ? { agentId: request.agentId } : {}),
    ...(request.role ? { role: request.role } : {}),
    ...(request.turn !== undefined ? { turn: request.turn } : {}),
    ...(options.getTrace ? { trace: options.getTrace() } : {}),
    ...(request.abortSignal ?? options.abortSignal ? { abortSignal: request.abortSignal ?? options.abortSignal } : {}),
    ...(options.metadata || request.metadata ? { metadata: mergeToolMetadata(options.metadata, request.metadata) } : {})
  };
}

async function executeRuntimeTool(
  tool: RuntimeTool<JsonObject, JsonValue> | undefined,
  identity: RuntimeToolIdentity,
  input: JsonObject,
  context: RuntimeToolExecutionContext
): Promise<RuntimeToolResult> {
  if (!tool) {
    return {
      type: "error",
      toolCallId: context.toolCallId,
      tool: identity,
      error: {
        code: "unavailable",
        message: `Runtime tool "${identity.id}" is not registered.`,
        retryable: false
      }
    };
  }

  const validation = tool.validateInput?.(input);
  if (validation?.type === "invalid") {
    return {
      type: "error",
      toolCallId: context.toolCallId,
      tool: identity,
      error: {
        code: "invalid-input",
        message: "Runtime tool input failed validation.",
        retryable: false,
        detail: {
          issues: validation.issues.map((issue) => ({
            code: issue.code,
            path: issue.path,
            message: issue.message,
            ...(issue.detail ? { detail: issue.detail } : {})
          }))
        }
      }
    };
  }

  try {
    return await tool.execute(input, context);
  } catch (error) {
    return {
      type: "error",
      toolCallId: context.toolCallId,
      tool: identity,
      error: normalizeRuntimeToolAdapterError(error)
    };
  }
}

function mergeToolMetadata(base: JsonObject | undefined, request: JsonObject | undefined): JsonObject {
  return {
    ...(base ?? {}),
    ...(request ?? {})
  };
}

function defaultToolCallId(runId: string, callIndex: number): string {
  return `${runId}:tool-${callIndex + 1}`;
}
