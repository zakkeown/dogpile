import type {
  JsonObject,
  JsonValue,
  RuntimeTool,
  RuntimeToolAdapterContract,
  RuntimeToolAdapterError,
  RuntimeToolExecutionContext,
  RuntimeToolExecutionRequest,
  RuntimeToolExecutor,
  RuntimeToolIdentity,
  RuntimeToolInputSchema,
  RuntimeToolPermission,
  RuntimeToolResult,
  TranscriptToolCall,
  RuntimeToolTraceContext,
  RuntimeToolValidationIssue,
  RuntimeToolValidationResult,
  RunEvent,
  ModelMessage,
  ModelResponse
} from "../types.js";
import { DogpileError } from "../types.js";
import { validateRuntimeToolRegistrations } from "./validation.js";

type VercelAIToolExecuteOptions = {
  readonly toolCallId: string;
  readonly messages: ModelMessage[];
  readonly abortSignal?: AbortSignal;
  readonly experimental_context: RuntimeToolExecutionContext;
};

type VercelAIToolExecuteFunction<Input, Output> = (
  input: Input,
  options: VercelAIToolExecuteOptions
) => Output | PromiseLike<Output> | AsyncIterable<Output>;

type VercelAICompatibleSchema<Input> = unknown;

/**
 * Built-in Dogpile tool names with stable protocol-facing semantics.
 */
export type DogpileBuiltInToolName = "webSearch" | "codeExec";

/**
 * Input accepted by the built-in web search tool contract.
 */
export interface WebSearchToolInput extends JsonObject {
  readonly query: string;
  readonly maxResults?: number;
}

/**
 * One normalized web search result.
 */
export interface WebSearchToolResult extends JsonObject {
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
  readonly metadata?: JsonObject;
}

/**
 * Output returned by the built-in web search tool contract.
 */
export interface WebSearchToolOutput extends JsonObject {
  readonly results: WebSearchToolResult[];
}

/**
 * Fetch implementation accepted by the built-in web search adapter.
 */
export type WebSearchFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Request data produced before the built-in web search adapter calls `fetch`.
 */
export interface WebSearchFetchRequest {
  readonly url: string | URL;
  readonly init?: RequestInit;
}

/**
 * Build a search backend request from normalized web search input.
 */
export type WebSearchFetchRequestBuilder = (
  input: Readonly<WebSearchToolInput>,
  context: RuntimeToolExecutionContext
) => WebSearchFetchRequest;

/**
 * Parse a search backend response into Dogpile's stable web search output.
 */
export type WebSearchFetchResponseParser = (
  response: Response,
  input: Readonly<WebSearchToolInput>,
  context: RuntimeToolExecutionContext
) => WebSearchToolOutput | Promise<WebSearchToolOutput>;

/**
 * Options for the built-in fetch-based web search adapter.
 */
export interface WebSearchToolAdapterOptions {
  readonly endpoint: string | URL;
  readonly fetch?: WebSearchFetch;
  readonly headers?: HeadersInit;
  readonly defaultMaxResults?: number;
  readonly identity?: BuiltInDogpileToolIdentityOptions;
  readonly permissions?: readonly RuntimeToolPermission[];
  readonly buildRequest?: WebSearchFetchRequestBuilder;
  readonly parseResponse?: WebSearchFetchResponseParser;
}

/**
 * Options for the built-in code execution adapter.
 */
export interface CodeExecToolAdapterOptions {
  readonly execute: CodeExecSandboxExecutor;
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly languages?: readonly CodeExecToolLanguage[];
  readonly allowNetwork?: boolean;
  readonly identity?: BuiltInDogpileToolIdentityOptions;
  readonly permissions?: readonly RuntimeToolPermission[];
}

/**
 * Input accepted by the built-in code execution tool contract.
 *
 * @remarks
 * Dogpile core does not provide a sandbox implementation. Callers supply the
 * executor while Dogpile normalizes the public tool identity and schema.
 */
export interface CodeExecToolInput extends JsonObject {
  readonly language: "javascript" | "typescript" | "python" | "bash" | "shell";
  readonly code: string;
  readonly timeoutMs?: number;
}

/**
 * Output returned by the built-in code execution tool contract.
 */
export interface CodeExecToolOutput extends JsonObject {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly metadata?: JsonObject;
}

/**
 * Language identifiers accepted by Dogpile's built-in code execution contract.
 */
export type CodeExecToolLanguage = CodeExecToolInput["language"];

/**
 * Executor signature for the built-in web search contract.
 */
export type WebSearchToolExecutor = (
  input: Readonly<WebSearchToolInput>,
  context: RuntimeToolExecutionContext
) => RuntimeToolResult<WebSearchToolOutput> | Promise<RuntimeToolResult<WebSearchToolOutput>>;

/**
 * Executor signature for the built-in code execution contract.
 */
export type CodeExecToolExecutor = (
  input: Readonly<CodeExecToolInput>,
  context: RuntimeToolExecutionContext
) => RuntimeToolResult<CodeExecToolOutput> | Promise<RuntimeToolResult<CodeExecToolOutput>>;

/**
 * Caller-owned sandbox implementation used by Dogpile's built-in code execution adapter.
 */
export type CodeExecSandboxExecutor = (
  input: Readonly<CodeExecToolInput>,
  context: RuntimeToolExecutionContext
) => CodeExecToolOutput | Promise<CodeExecToolOutput>;

/**
 * Optional identity fields callers may layer onto built-in Dogpile tools.
 */
export interface BuiltInDogpileToolIdentityOptions {
  readonly namespace?: string;
  readonly version?: string;
  readonly description?: string;
}

/**
 * Definition used to normalize Dogpile's built-in web search tool.
 */
export interface WebSearchDogpileToolDefinition {
  readonly name: "webSearch";
  readonly execute: WebSearchToolExecutor;
  readonly identity?: BuiltInDogpileToolIdentityOptions;
  readonly inputSchema?: RuntimeToolInputSchema;
  readonly permissions?: readonly RuntimeToolPermission[];
}

/**
 * Definition used to normalize Dogpile's built-in code execution tool.
 */
export interface CodeExecDogpileToolDefinition {
  readonly name: "codeExec";
  readonly execute: CodeExecToolExecutor;
  readonly identity?: BuiltInDogpileToolIdentityOptions;
  readonly inputSchema?: RuntimeToolInputSchema;
  readonly permissions?: readonly RuntimeToolPermission[];
}

/**
 * Built-in Dogpile tool definitions accepted by the normalization helper.
 */
export type BuiltInDogpileToolDefinition = WebSearchDogpileToolDefinition | CodeExecDogpileToolDefinition;

/**
 * Caller-supplied built-in tool executors keyed by Dogpile's stable built-in names.
 */
export interface BuiltInDogpileToolExecutors {
  readonly webSearch?: WebSearchToolExecutor | WebSearchDogpileToolDefinition;
  readonly codeExec?: CodeExecToolExecutor | CodeExecDogpileToolDefinition;
}

export type BuiltInDogpileRuntimeTool =
  | RuntimeToolAdapterContract<WebSearchToolInput, WebSearchToolOutput>
  | RuntimeToolAdapterContract<CodeExecToolInput, CodeExecToolOutput>;

/**
 * Vercel AI SDK tool shape accepted by Dogpile's normalization adapter.
 */
export interface VercelAITool<Input extends JsonObject = JsonObject, Output extends JsonValue = JsonValue> {
  readonly description?: string;
  readonly inputSchema: VercelAICompatibleSchema<Input>;
  readonly execute?: VercelAIToolExecuteFunction<Input, Output>;
}

/**
 * Optional identity fields callers may layer onto normalized Vercel AI tools.
 */
export interface VercelAIToolIdentityOptions {
  readonly id?: string;
  readonly namespace?: string;
  readonly version?: string;
  readonly description?: string;
}

/**
 * Definition used to normalize one Vercel AI SDK tool into Dogpile's runtime tool interface.
 */
export interface VercelAIToolDefinition<
  Name extends string = string,
  Input extends JsonObject = JsonObject,
  Output extends JsonValue = JsonValue
> {
  readonly name: Name;
  readonly tool: VercelAITool<Input, Output>;
  readonly identity?: VercelAIToolIdentityOptions;
  readonly inputSchema?: RuntimeToolInputSchema;
  readonly messages?: readonly ModelMessage[];
}

/**
 * Caller-supplied Vercel AI SDK tool set keyed by model-visible tool name.
 */
export interface VercelAIToolSetEntry {
  readonly description?: string;
  readonly inputSchema: VercelAICompatibleSchema<unknown>;
  readonly execute?: VercelAIToolExecuteFunction<never, JsonValue>;
}

/**
 * Caller-supplied Vercel AI SDK tool set keyed by model-visible tool name.
 */
export type VercelAIToolSet = Readonly<Record<string, VercelAIToolSetEntry>>;

/**
 * Options shared while normalizing a Vercel AI SDK tool set.
 */
export interface VercelAIToolSetNormalizationOptions {
  readonly namespace?: string;
  readonly version?: string;
  readonly messages?: readonly ModelMessage[];
  readonly identity?: Readonly<Record<string, VercelAIToolIdentityOptions>>;
}

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

const webSearchIdentity: RuntimeToolIdentity = {
  id: "dogpile.tools.webSearch",
  namespace: "dogpile",
  name: "webSearch",
  version: "1.0.0",
  description: "Search the web through a caller-provided fetch-compatible search adapter."
};

const codeExecIdentity: RuntimeToolIdentity = {
  id: "dogpile.tools.codeExec",
  namespace: "dogpile",
  name: "codeExec",
  version: "1.0.0",
  description: "Execute code through a caller-provided sandbox adapter."
};

const webSearchInputSchema: RuntimeToolInputSchema = {
  kind: "json-schema",
  description: "Web search query and optional result cap.",
  schema: {
    type: "object",
    properties: {
      query: { type: "string" },
      maxResults: { type: "number", minimum: 1 }
    },
    required: ["query"],
    additionalProperties: false
  }
};

const codeExecInputSchema: RuntimeToolInputSchema = {
  kind: "json-schema",
  description: "Code snippet plus language and optional timeout.",
  schema: {
    type: "object",
    properties: {
      language: {
        type: "string",
        enum: ["javascript", "typescript", "python", "bash", "shell"]
      },
      code: { type: "string" },
      timeoutMs: { type: "number", minimum: 1 }
    },
    required: ["language", "code"],
    additionalProperties: false
  }
};

const webSearchPermissions: readonly RuntimeToolPermission[] = [
  {
    kind: "network",
    allowPrivateNetwork: false
  }
];

const codeExecPermissions: readonly RuntimeToolPermission[] = [
  {
    kind: "code-execution",
    sandbox: "caller-provided",
    languages: ["javascript", "typescript", "python", "bash", "shell"],
    allowNetwork: false
  }
];

const codeExecLanguages: readonly CodeExecToolLanguage[] = ["javascript", "typescript", "python", "bash", "shell"];

/**
 * Return the default Dogpile identity for one built-in tool name.
 */
export function builtInDogpileToolIdentity(name: "webSearch"): RuntimeToolIdentity;
export function builtInDogpileToolIdentity(name: "codeExec"): RuntimeToolIdentity;
export function builtInDogpileToolIdentity(name: DogpileBuiltInToolName): RuntimeToolIdentity {
  return name === "webSearch" ? webSearchIdentity : codeExecIdentity;
}

/**
 * Return the default Dogpile input schema for one built-in tool name.
 */
export function builtInDogpileToolInputSchema(name: "webSearch"): RuntimeToolInputSchema;
export function builtInDogpileToolInputSchema(name: "codeExec"): RuntimeToolInputSchema;
export function builtInDogpileToolInputSchema(name: DogpileBuiltInToolName): RuntimeToolInputSchema {
  return name === "webSearch" ? webSearchInputSchema : codeExecInputSchema;
}

/**
 * Return the default permission declarations for one built-in tool name.
 */
export function builtInDogpileToolPermissions(name: DogpileBuiltInToolName): readonly RuntimeToolPermission[] {
  return name === "webSearch" ? webSearchPermissions : codeExecPermissions;
}

/**
 * Validate one built-in Dogpile tool input before adapter execution.
 */
export function validateBuiltInDogpileToolInput(
  name: "webSearch",
  input: Readonly<Partial<WebSearchToolInput>>
): RuntimeToolValidationResult;
export function validateBuiltInDogpileToolInput(
  name: "codeExec",
  input: Readonly<Partial<CodeExecToolInput>>
): RuntimeToolValidationResult;
export function validateBuiltInDogpileToolInput(
  name: DogpileBuiltInToolName,
  input: Readonly<Partial<WebSearchToolInput> | Partial<CodeExecToolInput>>
): RuntimeToolValidationResult;
export function validateBuiltInDogpileToolInput(
  name: DogpileBuiltInToolName,
  input: Readonly<Partial<WebSearchToolInput> | Partial<CodeExecToolInput>>
): RuntimeToolValidationResult {
  const issues =
    name === "webSearch"
      ? validateWebSearchInput(input as Readonly<Partial<WebSearchToolInput>>)
      : validateCodeExecInput(input as Readonly<Partial<CodeExecToolInput>>);

  return issues.length === 0 ? { type: "valid" } : { type: "invalid", issues };
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

function validateCodeExecAdapterInput(
  input: Readonly<Partial<CodeExecToolInput>>,
  options: Pick<CodeExecToolAdapterOptions, "languages" | "maxTimeoutMs" | "defaultTimeoutMs">
): RuntimeToolValidationResult {
  const issues = [...validateCodeExecInput(input)];
  const languages = options.languages ?? codeExecLanguages;

  if (typeof input.language === "string" && isCodeExecLanguage(input.language) && !languages.includes(input.language)) {
    issues.push({
      code: "invalid-value",
      path: "language",
      message: "codeExec.language is not enabled for this adapter.",
      detail: {
        allowed: Array.from(languages)
      }
    });
  }

  const effectiveTimeoutMs = input.timeoutMs ?? options.defaultTimeoutMs;
  if (
    effectiveTimeoutMs !== undefined &&
    options.maxTimeoutMs !== undefined &&
    Number.isFinite(effectiveTimeoutMs) &&
    Number.isFinite(options.maxTimeoutMs) &&
    effectiveTimeoutMs > options.maxTimeoutMs
  ) {
    issues.push({
      code: "out-of-range",
      path: input.timeoutMs === undefined ? "defaultTimeoutMs" : "timeoutMs",
      message: `codeExec.timeoutMs must be less than or equal to ${options.maxTimeoutMs}.`,
      detail: {
        maximum: options.maxTimeoutMs
      }
    });
  }

  return issues.length === 0 ? { type: "valid" } : { type: "invalid", issues };
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

  const validation = validateRuntimeToolInput(tool, input);
  if (validation.type === "invalid") {
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

function validateRuntimeToolInput(
  tool: RuntimeTool<JsonObject, JsonValue>,
  input: JsonObject
): RuntimeToolValidationResult {
  if (typeof tool.validateInput !== "function") {
    return { type: "valid" };
  }

  return tool.validateInput(input);
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

/**
 * Convert an unknown adapter failure into Dogpile's serializable error data.
 */
export function normalizeRuntimeToolAdapterError(error: unknown): RuntimeToolAdapterError {
  if (isRuntimeToolAdapterError(error)) {
    return error;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      code: "aborted",
      message: error.message || "Tool execution was aborted.",
      retryable: true,
      detail: {
        name: error.name
      }
    };
  }

  if (error instanceof Error) {
    return {
      code: "backend-error",
      message: error.message,
      retryable: false,
      detail: {
        name: error.name
      }
    };
  }

  return {
    code: "unknown",
    message: "Tool execution failed with a non-Error value.",
    retryable: false,
    detail: {
      valueType: typeof error
    }
  };
}

/**
 * Create Dogpile's built-in fetch-based web search adapter.
 *
 * @remarks
 * The adapter is backend-neutral: by default it sends a GET request with
 * `q` and `limit` query parameters, then accepts either `{ results: [...] }`
 * or a bare array of result objects from the response JSON. Callers can replace
 * request construction or response parsing for a specific search API while
 * keeping Dogpile's shared runtime tool contract, identity, permissions, input
 * validation, and serializable errors.
 */
export function createWebSearchToolAdapter(
  options: WebSearchToolAdapterOptions
): RuntimeToolAdapterContract<WebSearchToolInput, WebSearchToolOutput> {
  const identity = mergeIdentity(webSearchIdentity, options.identity);

  return normalizeBuiltInDogpileTool({
    name: "webSearch",
    ...(options.identity ? { identity: options.identity } : {}),
    ...(options.permissions ? { permissions: options.permissions } : {}),
    async execute(input, context): Promise<RuntimeToolResult<WebSearchToolOutput>> {
      const fetchImplementation = options.fetch ?? globalThis.fetch;

      if (!fetchImplementation) {
        return {
          type: "error",
          toolCallId: context.toolCallId,
          tool: identity,
          error: {
            code: "unavailable",
            message: "No fetch implementation is available for webSearch.",
            retryable: false
          }
        };
      }

      const request = options.buildRequest
        ? options.buildRequest(input, context)
        : defaultWebSearchRequest(options, input, context);
      const response = await fetchImplementation(request.url, {
        ...request.init,
        ...(context.abortSignal ? { signal: context.abortSignal } : {})
      });

      if (!response.ok) {
        throw {
          code: response.status >= 500 ? "unavailable" : "backend-error",
          message: `Web search backend returned HTTP ${response.status}.`,
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
          detail: {
            status: response.status,
            statusText: response.statusText
          }
        } satisfies RuntimeToolAdapterError;
      }

      const output = options.parseResponse
        ? await options.parseResponse(response, input, context)
        : await defaultWebSearchResponseParser(response);

      return {
        type: "success",
        toolCallId: context.toolCallId,
        tool: identity,
        output
      };
    }
  });
}

/**
 * Create Dogpile's built-in code execution adapter around a caller-owned sandbox.
 *
 * @remarks
 * Dogpile core stays runtime-portable and never evaluates code itself. This
 * adapter supplies the stable `codeExec` identity, schema, permissions,
 * validation, timeout defaults, abort handling, and serializable errors while
 * the host application owns the sandbox boundary.
 */
export function createCodeExecToolAdapter(
  options: CodeExecToolAdapterOptions
): RuntimeToolAdapterContract<CodeExecToolInput, CodeExecToolOutput> {
  const identity = mergeIdentity(codeExecIdentity, options.identity);
  const permissions =
    options.permissions ??
    codeExecPermissionsFor(options.languages ?? codeExecLanguages, options.allowNetwork ?? false);
  const inputSchema = codeExecInputSchemaFor(options.languages ?? codeExecLanguages);

  return {
    identity,
    inputSchema,
    permissions,
    validateInput: (input: Readonly<CodeExecToolInput>) => validateCodeExecAdapterInput(input, options),
    async execute(input, context): Promise<RuntimeToolResult<CodeExecToolOutput>> {
      const validation = validateCodeExecAdapterInput(input, options);

      if (validation.type === "invalid") {
        return {
          type: "error",
          toolCallId: context.toolCallId,
          tool: identity,
          error: {
            code: "invalid-input",
            message: "Invalid codeExec tool input.",
            retryable: false,
            detail: {
              issues: serializeValidationIssues(validation.issues)
            }
          }
        };
      }

      const timeoutMs = input.timeoutMs ?? options.defaultTimeoutMs;
      const executionInput: CodeExecToolInput =
        timeoutMs === undefined
          ? input
          : {
              ...input,
              timeoutMs
            };

      try {
        const output = await executeSandboxWithPolicy(options.execute, executionInput, context, timeoutMs);

        return {
          type: "success",
          toolCallId: context.toolCallId,
          tool: identity,
          output
        };
      } catch (error) {
        return {
          type: "error",
          toolCallId: context.toolCallId,
          tool: identity,
          error: normalizeRuntimeToolAdapterError(error)
        };
      }
    }
  };
}

/**
 * Normalize one built-in Dogpile tool definition into the shared runtime tool interface.
 */
export function normalizeBuiltInDogpileTool(
  definition: WebSearchDogpileToolDefinition
): RuntimeToolAdapterContract<WebSearchToolInput, WebSearchToolOutput>;
export function normalizeBuiltInDogpileTool(
  definition: CodeExecDogpileToolDefinition
): RuntimeToolAdapterContract<CodeExecToolInput, CodeExecToolOutput>;
export function normalizeBuiltInDogpileTool(definition: BuiltInDogpileToolDefinition): BuiltInDogpileRuntimeTool {
  switch (definition.name) {
    case "webSearch": {
      const identity = mergeIdentity(webSearchIdentity, definition.identity);
      const permissions = definition.permissions ?? webSearchPermissions;
      const tool: RuntimeToolAdapterContract<WebSearchToolInput, WebSearchToolOutput> = {
        identity,
        inputSchema: definition.inputSchema ?? webSearchInputSchema,
        permissions,
        validateInput: (input: Readonly<WebSearchToolInput>) => validateBuiltInDogpileToolInput("webSearch", input),
        execute: (input: Readonly<WebSearchToolInput>, context: RuntimeToolExecutionContext) =>
          executeBuiltInTool(identity, definition.execute, input, context, "webSearch")
      };
      return tool;
    }
    case "codeExec": {
      const identity = mergeIdentity(codeExecIdentity, definition.identity);
      const permissions = definition.permissions ?? codeExecPermissions;
      const tool: RuntimeToolAdapterContract<CodeExecToolInput, CodeExecToolOutput> = {
        identity,
        inputSchema: definition.inputSchema ?? codeExecInputSchema,
        permissions,
        validateInput: (input: Readonly<CodeExecToolInput>) => validateBuiltInDogpileToolInput("codeExec", input),
        execute: (input: Readonly<CodeExecToolInput>, context: RuntimeToolExecutionContext) =>
          executeBuiltInTool(identity, definition.execute, input, context, "codeExec")
      };
      return tool;
    }
  }
}

/**
 * Normalize configured built-in Dogpile tool executors into runtime tools.
 */
export function normalizeBuiltInDogpileTools(tools: BuiltInDogpileToolExecutors): readonly BuiltInDogpileRuntimeTool[] {
  const normalized: BuiltInDogpileRuntimeTool[] = [];

  if (tools.webSearch) {
    normalized.push(normalizeBuiltInDogpileTool(asWebSearchDefinition(tools.webSearch)));
  }

  if (tools.codeExec) {
    normalized.push(normalizeBuiltInDogpileTool(asCodeExecDefinition(tools.codeExec)));
  }

  return normalized;
}

/**
 * Normalize one Vercel AI SDK tool into Dogpile's shared runtime tool interface.
 */
export async function normalizeVercelAITool<
  Name extends string,
  Input extends JsonObject,
  Output extends JsonValue
>(definition: VercelAIToolDefinition<Name, Input, Output>): Promise<RuntimeTool<Input, Output>> {
  if (!definition.tool.execute) {
    throw new DogpileError({
      code: "invalid-configuration",
      message: `Vercel AI tool "${definition.name}" must define execute() to run inside Dogpile.`,
      detail: { toolName: definition.name }
    });
  }

  const identity = vercelAIToolIdentity(definition);
  const inputSchema = definition.inputSchema ?? (await vercelAIInputSchema(definition.tool, definition.name));
  const execute = definition.tool.execute;

  return {
    identity,
    inputSchema,
    async execute(input, context): Promise<RuntimeToolResult<Output>> {
      try {
        const output = await resolveVercelAIToolOutput(
          execute(input, {
            toolCallId: context.toolCallId,
            messages: Array.from(definition.messages ?? []),
            ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
            experimental_context: context
          })
        );

        return {
          type: "success",
          toolCallId: context.toolCallId,
          tool: identity,
          output
        };
      } catch (error) {
        return {
          type: "error",
          toolCallId: context.toolCallId,
          tool: identity,
          error: {
            code: "vercel-ai-tool-error",
            message: error instanceof Error ? error.message : "Vercel AI tool execution failed.",
            retryable: false,
            detail: errorDetail(error)
          }
        };
      }
    }
  };
}

/**
 * Normalize a Vercel AI SDK tool set into runtime tools in caller-defined key order.
 */
export async function normalizeVercelAITools(
  tools: VercelAIToolSet,
  options: VercelAIToolSetNormalizationOptions = {}
): Promise<readonly RuntimeTool<JsonObject, JsonValue>[]> {
  return Promise.all(
    Object.entries(tools).map(([name, tool]) => {
      const identity = removeUndefinedIdentityFields({
        ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
        ...(options.version !== undefined ? { version: options.version } : {}),
        ...options.identity?.[name]
      });
      return normalizeVercelAITool({
        name,
        tool: asJsonRuntimeVercelAITool(tool),
        ...(options.messages ? { messages: options.messages } : {}),
        ...(identity ? { identity } : {})
      });
    })
  );
}

async function executeBuiltInTool<Input extends object, Output>(
  identity: RuntimeToolIdentity,
  execute: (
    input: Readonly<Input>,
    context: RuntimeToolExecutionContext
  ) => RuntimeToolResult<Output> | Promise<RuntimeToolResult<Output>>,
  input: Readonly<Input>,
  context: RuntimeToolExecutionContext,
  name: DogpileBuiltInToolName
): Promise<RuntimeToolResult<Output>> {
  const validation = validateBuiltInDogpileToolInput(
    name,
    input as Readonly<Partial<WebSearchToolInput> | Partial<CodeExecToolInput>>
  );

  if (validation.type === "invalid") {
    return {
      type: "error",
      toolCallId: context.toolCallId,
      tool: identity,
      error: {
        code: "invalid-input",
        message: `Invalid ${name} tool input.`,
        retryable: false,
        detail: {
          issues: serializeValidationIssues(validation.issues)
        }
      }
    };
  }

  try {
    return await execute(input, context);
  } catch (error) {
    return {
      type: "error",
      toolCallId: context.toolCallId,
      tool: identity,
      error: normalizeRuntimeToolAdapterError(error)
    };
  }
}

function asWebSearchDefinition(
  tool: WebSearchToolExecutor | WebSearchDogpileToolDefinition
): WebSearchDogpileToolDefinition {
  return typeof tool === "function" ? { name: "webSearch", execute: tool } : tool;
}

function asCodeExecDefinition(tool: CodeExecToolExecutor | CodeExecDogpileToolDefinition): CodeExecDogpileToolDefinition {
  return typeof tool === "function" ? { name: "codeExec", execute: tool } : tool;
}

function mergeIdentity(
  defaultIdentity: RuntimeToolIdentity,
  options: BuiltInDogpileToolIdentityOptions | undefined
): RuntimeToolIdentity {
  if (!options) {
    return defaultIdentity;
  }

  return {
    ...defaultIdentity,
    ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
    ...(options.version !== undefined ? { version: options.version } : {}),
    ...(options.description !== undefined ? { description: options.description } : {})
  };
}

async function vercelAIInputSchema<Input extends JsonObject, Output extends JsonValue>(
  tool: VercelAITool<Input, Output>,
  name: string
): Promise<RuntimeToolInputSchema> {
  const schema = await resolveCompatibleSchema(tool.inputSchema);
  const jsonSchema = asJsonObject(schema, `Vercel AI tool "${name}" input schema`);

  return {
    kind: "json-schema",
    schema: jsonSchema,
    ...(tool.description ? { description: tool.description } : {})
  };
}

async function resolveCompatibleSchema<Input>(schema: VercelAICompatibleSchema<Input>): Promise<unknown> {
  if (isJsonSchemaWrapper(schema)) {
    return await schema.jsonSchema;
  }

  return schema;
}

function isJsonSchemaWrapper<Input>(
  schema: VercelAICompatibleSchema<Input>
): schema is { readonly jsonSchema: unknown | PromiseLike<unknown> } {
  return typeof schema === "object" && schema !== null && "jsonSchema" in schema;
}

function vercelAIToolIdentity<Name extends string, Input extends JsonObject, Output extends JsonValue>(
  definition: VercelAIToolDefinition<Name, Input, Output>
): RuntimeToolIdentity {
  return {
    id: definition.identity?.id ?? `vercel-ai.tools.${definition.name}`,
    name: definition.name,
    namespace: definition.identity?.namespace ?? "vercel-ai",
    ...(definition.identity?.version ? { version: definition.identity.version } : {}),
    ...(definition.identity?.description ?? definition.tool.description
      ? { description: definition.identity?.description ?? definition.tool.description }
      : {})
  };
}

async function resolveVercelAIToolOutput<Output extends JsonValue>(
  output: AsyncIterable<Output> | PromiseLike<Output> | Output
): Promise<Output> {
  if (isAsyncIterable(output)) {
    let lastOutput: Output | undefined;

    for await (const chunk of output) {
      lastOutput = chunk;
    }

    if (lastOutput === undefined) {
      throw new DogpileError({
        code: "provider-invalid-response",
        message: "Vercel AI tool async iterable completed without an output."
      });
    }

    return lastOutput;
  }

  return await output;
}

function isAsyncIterable<Output extends JsonValue>(
  value: AsyncIterable<Output> | PromiseLike<Output> | Output
): value is AsyncIterable<Output> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function serializeValidationIssues(
  issues: readonly RuntimeToolValidationIssue[]
): JsonValue {
  return issues.map((issue): JsonObject => ({
    code: issue.code,
    path: issue.path,
    message: issue.message,
    ...(issue.detail !== undefined ? { detail: issue.detail } : {})
  }));
}

function asJsonObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DogpileError({
      code: "provider-invalid-response",
      message: `${label} must resolve to a JSON object.`,
      detail: { label }
    });
  }

  return value as JsonObject;
}

function errorDetail(error: unknown): JsonObject {
  if (error instanceof Error) {
    return {
      name: error.name
    };
  }

  return {
    valueType: typeof error
  };
}

function defaultWebSearchRequest(
  options: WebSearchToolAdapterOptions,
  input: Readonly<WebSearchToolInput>,
  _context: RuntimeToolExecutionContext
): WebSearchFetchRequest {
  const url = new URL(String(options.endpoint));
  url.searchParams.set("q", input.query);
  url.searchParams.set("limit", String(input.maxResults ?? options.defaultMaxResults ?? 10));

  return {
    url,
    init: {
      method: "GET",
      ...(options.headers ? { headers: options.headers } : {})
    }
  };
}

async function defaultWebSearchResponseParser(response: Response): Promise<WebSearchToolOutput> {
  const payload: unknown = await response.json();
  const resultValues = Array.isArray(payload)
    ? payload
    : isJsonObject(payload) && Array.isArray(payload.results)
      ? payload.results
      : undefined;

  if (!resultValues) {
    throw {
      code: "backend-error",
      message: "Web search backend response must contain a results array.",
      retryable: false
    } satisfies RuntimeToolAdapterError;
  }

  return {
    results: resultValues.map(normalizeWebSearchResult)
  };
}

function codeExecPermissionsFor(
  languages: readonly CodeExecToolLanguage[],
  allowNetwork: boolean
): readonly RuntimeToolPermission[] {
  return [
    {
      kind: "code-execution",
      sandbox: "caller-provided",
      languages,
      allowNetwork
    }
  ];
}

function codeExecInputSchemaFor(languages: readonly CodeExecToolLanguage[]): RuntimeToolInputSchema {
  return {
    kind: "json-schema",
    ...(codeExecInputSchema.description ? { description: codeExecInputSchema.description } : {}),
    schema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          enum: Array.from(languages)
        },
        code: { type: "string" },
        timeoutMs: { type: "number", minimum: 1 }
      },
      required: ["language", "code"],
      additionalProperties: false
    }
  };
}

async function executeSandboxWithPolicy(
  execute: CodeExecSandboxExecutor,
  input: Readonly<CodeExecToolInput>,
  context: RuntimeToolExecutionContext,
  timeoutMs: number | undefined
): Promise<CodeExecToolOutput> {
  if (context.abortSignal?.aborted) {
    throw {
      code: "aborted",
      message: "Code execution was aborted before the sandbox started.",
      retryable: true
    } satisfies RuntimeToolAdapterError;
  }

  const execution = Promise.resolve().then(() => execute(input, context));

  if (timeoutMs === undefined && context.abortSignal === undefined) {
    return await execution;
  }

  return await new Promise<CodeExecToolOutput>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      context.abortSignal?.removeEventListener("abort", abortHandler);
    };

    const abortHandler = (): void => {
      cleanup();
      reject({
        code: "aborted",
        message: "Code execution was aborted.",
        retryable: true
      } satisfies RuntimeToolAdapterError);
    };

    if (context.abortSignal) {
      context.abortSignal.addEventListener("abort", abortHandler, { once: true });
    }

    if (timeoutMs !== undefined) {
      timeoutId = setTimeout(() => {
        cleanup();
        reject({
          code: "timeout",
          message: `Code execution exceeded timeout of ${timeoutMs}ms.`,
          retryable: true,
          detail: {
            timeoutMs
          }
        } satisfies RuntimeToolAdapterError);
      }, timeoutMs);
    }

    execution.then(
      (output) => {
        cleanup();
        resolve(output);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function normalizeWebSearchResult(value: unknown): WebSearchToolResult {
  if (!isJsonObject(value)) {
    throw {
      code: "backend-error",
      message: "Web search result must be a JSON object.",
      retryable: false
    } satisfies RuntimeToolAdapterError;
  }

  const title = jsonString(value.title, "title");
  const url = jsonString(value.url, "url");
  const snippet = optionalJsonString(value.snippet, "snippet");
  const metadata = optionalJsonObject(value.metadata, "metadata");

  return {
    title,
    url,
    ...(snippet !== undefined ? { snippet } : {}),
    ...(metadata !== undefined ? { metadata } : {})
  };
}

function jsonString(value: JsonValue | undefined, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw {
      code: "backend-error",
      message: `Web search result ${fieldName} must be a non-empty string.`,
      retryable: false
    } satisfies RuntimeToolAdapterError;
  }

  return value;
}

function optionalJsonString(value: JsonValue | undefined, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw {
      code: "backend-error",
      message: `Web search result ${fieldName} must be a string when present.`,
      retryable: false
    } satisfies RuntimeToolAdapterError;
  }

  return value;
}

function optionalJsonObject(value: JsonValue | undefined, fieldName: string): JsonObject | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isJsonObject(value)) {
    throw {
      code: "backend-error",
      message: `Web search result ${fieldName} must be a JSON object when present.`,
      retryable: false
    } satisfies RuntimeToolAdapterError;
  }

  return value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateWebSearchInput(input: Readonly<Partial<WebSearchToolInput>>): readonly RuntimeToolValidationIssue[] {
  const issues: RuntimeToolValidationIssue[] = [];

  if (typeof input.query !== "string") {
    issues.push({
      code: input.query === undefined ? "missing-field" : "invalid-type",
      path: "query",
      message: "webSearch.query must be a string."
    });
  } else if (input.query.trim().length === 0) {
    issues.push({
      code: "invalid-value",
      path: "query",
      message: "webSearch.query must not be empty."
    });
  }

  if (input.maxResults !== undefined) {
    if (typeof input.maxResults !== "number" || !Number.isFinite(input.maxResults)) {
      issues.push({
        code: "invalid-type",
        path: "maxResults",
        message: "webSearch.maxResults must be a finite number."
      });
    } else if (input.maxResults < 1) {
      issues.push({
        code: "out-of-range",
        path: "maxResults",
        message: "webSearch.maxResults must be greater than or equal to 1.",
        detail: {
          minimum: 1
        }
      });
    }
  }

  return issues;
}

function validateCodeExecInput(input: Readonly<Partial<CodeExecToolInput>>): readonly RuntimeToolValidationIssue[] {
  const issues: RuntimeToolValidationIssue[] = [];

  if (typeof input.language !== "string") {
    issues.push({
      code: input.language === undefined ? "missing-field" : "invalid-type",
      path: "language",
      message: "codeExec.language must be a string."
    });
  } else if (!isCodeExecLanguage(input.language)) {
    issues.push({
      code: "invalid-value",
      path: "language",
      message: "codeExec.language must be one of javascript, typescript, python, bash, or shell.",
      detail: {
        allowed: ["javascript", "typescript", "python", "bash", "shell"]
      }
    });
  }

  if (typeof input.code !== "string") {
    issues.push({
      code: input.code === undefined ? "missing-field" : "invalid-type",
      path: "code",
      message: "codeExec.code must be a string."
    });
  }

  if (input.timeoutMs !== undefined) {
    if (typeof input.timeoutMs !== "number" || !Number.isFinite(input.timeoutMs)) {
      issues.push({
        code: "invalid-type",
        path: "timeoutMs",
        message: "codeExec.timeoutMs must be a finite number."
      });
    } else if (input.timeoutMs < 1) {
      issues.push({
        code: "out-of-range",
        path: "timeoutMs",
        message: "codeExec.timeoutMs must be greater than or equal to 1.",
        detail: {
          minimum: 1
        }
      });
    }
  }

  return issues;
}

function isCodeExecLanguage(value: string): value is CodeExecToolInput["language"] {
  return value === "javascript" || value === "typescript" || value === "python" || value === "bash" || value === "shell";
}

function isRuntimeToolAdapterError(error: unknown): error is RuntimeToolAdapterError {
  if (typeof error !== "object" || error === null || !("code" in error) || !("message" in error)) {
    return false;
  }

  const candidate = error as { readonly code: unknown; readonly message: unknown };
  return isRuntimeToolAdapterErrorCode(candidate.code) && typeof candidate.message === "string";
}

function isRuntimeToolAdapterErrorCode(value: unknown): value is RuntimeToolAdapterError["code"] {
  return (
    value === "invalid-input" ||
    value === "permission-denied" ||
    value === "timeout" ||
    value === "aborted" ||
    value === "unavailable" ||
    value === "backend-error" ||
    value === "unknown"
  );
}

function removeUndefinedIdentityFields(
  identity: VercelAIToolIdentityOptions
): VercelAIToolIdentityOptions | undefined {
  const normalized: VercelAIToolIdentityOptions = {
    ...(identity.id !== undefined ? { id: identity.id } : {}),
    ...(identity.namespace !== undefined ? { namespace: identity.namespace } : {}),
    ...(identity.version !== undefined ? { version: identity.version } : {}),
    ...(identity.description !== undefined ? { description: identity.description } : {})
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function asJsonRuntimeVercelAITool(tool: VercelAIToolSetEntry): VercelAITool<JsonObject, JsonValue> {
  // Structural narrowing: the runtime treats every Vercel-AI tool as having a
  // JSON-shaped (input, output) pair — the upstream `ai` generics are nominal
  // and don't survive without an unsafe widening. Pinned here as the single
  // bridge point so future provider migrations only touch one cast.
  return tool as unknown as VercelAITool<JsonObject, JsonValue>;
}
