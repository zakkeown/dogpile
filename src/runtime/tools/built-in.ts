import type {
  JsonObject,
  JsonValue,
  RuntimeToolAdapterContract,
  RuntimeToolAdapterError,
  RuntimeToolExecutionContext,
  RuntimeToolIdentity,
  RuntimeToolInputSchema,
  RuntimeToolPermission,
  RuntimeToolResult,
  RuntimeToolValidationIssue,
  RuntimeToolValidationResult
} from "../../types.js";

/**
 * Built-in Dogpile tool names with stable protocol-facing semantics.
 */
export type DogpileBuiltInToolName = "webSearch" | "codeExec";

// ---------------------------------------------------------------------------
// Web search types
// ---------------------------------------------------------------------------

export interface WebSearchToolInput extends JsonObject {
  readonly query: string;
  readonly maxResults?: number;
}

export interface WebSearchToolResult extends JsonObject {
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
  readonly metadata?: JsonObject;
}

export interface WebSearchToolOutput extends JsonObject {
  readonly results: WebSearchToolResult[];
}

export type WebSearchFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface WebSearchFetchRequest {
  readonly url: string | URL;
  readonly init?: RequestInit;
}

export type WebSearchFetchRequestBuilder = (
  input: Readonly<WebSearchToolInput>,
  context: RuntimeToolExecutionContext
) => WebSearchFetchRequest;

export type WebSearchFetchResponseParser = (
  response: Response,
  input: Readonly<WebSearchToolInput>,
  context: RuntimeToolExecutionContext
) => WebSearchToolOutput | Promise<WebSearchToolOutput>;

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

export type WebSearchToolExecutor = (
  input: Readonly<WebSearchToolInput>,
  context: RuntimeToolExecutionContext
) => RuntimeToolResult<WebSearchToolOutput> | Promise<RuntimeToolResult<WebSearchToolOutput>>;

// ---------------------------------------------------------------------------
// Code exec types
// ---------------------------------------------------------------------------

export interface CodeExecToolAdapterOptions {
  readonly execute: CodeExecSandboxExecutor;
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly languages?: readonly CodeExecToolLanguage[];
  readonly allowNetwork?: boolean;
  readonly identity?: BuiltInDogpileToolIdentityOptions;
  readonly permissions?: readonly RuntimeToolPermission[];
}

export interface CodeExecToolInput extends JsonObject {
  readonly language: "javascript" | "typescript" | "python" | "bash" | "shell";
  readonly code: string;
  readonly timeoutMs?: number;
}

export interface CodeExecToolOutput extends JsonObject {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly metadata?: JsonObject;
}

export type CodeExecToolLanguage = CodeExecToolInput["language"];

export type CodeExecToolExecutor = (
  input: Readonly<CodeExecToolInput>,
  context: RuntimeToolExecutionContext
) => RuntimeToolResult<CodeExecToolOutput> | Promise<RuntimeToolResult<CodeExecToolOutput>>;

export type CodeExecSandboxExecutor = (
  input: Readonly<CodeExecToolInput>,
  context: RuntimeToolExecutionContext
) => CodeExecToolOutput | Promise<CodeExecToolOutput>;

// ---------------------------------------------------------------------------
// Built-in identity / definition shapes
// ---------------------------------------------------------------------------

export interface BuiltInDogpileToolIdentityOptions {
  readonly namespace?: string;
  readonly version?: string;
  readonly description?: string;
}

export interface WebSearchDogpileToolDefinition {
  readonly name: "webSearch";
  readonly execute: WebSearchToolExecutor;
  readonly identity?: BuiltInDogpileToolIdentityOptions;
  readonly inputSchema?: RuntimeToolInputSchema;
  readonly permissions?: readonly RuntimeToolPermission[];
}

export interface CodeExecDogpileToolDefinition {
  readonly name: "codeExec";
  readonly execute: CodeExecToolExecutor;
  readonly identity?: BuiltInDogpileToolIdentityOptions;
  readonly inputSchema?: RuntimeToolInputSchema;
  readonly permissions?: readonly RuntimeToolPermission[];
}

export type BuiltInDogpileToolDefinition = WebSearchDogpileToolDefinition | CodeExecDogpileToolDefinition;

export interface BuiltInDogpileToolExecutors {
  readonly webSearch?: WebSearchToolExecutor | WebSearchDogpileToolDefinition;
  readonly codeExec?: CodeExecToolExecutor | CodeExecDogpileToolDefinition;
}

export type BuiltInDogpileRuntimeTool =
  | RuntimeToolAdapterContract<WebSearchToolInput, WebSearchToolOutput>
  | RuntimeToolAdapterContract<CodeExecToolInput, CodeExecToolOutput>;

// ---------------------------------------------------------------------------
// Built-in tool identity / schema / permission constants
// ---------------------------------------------------------------------------

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
  { kind: "network", allowPrivateNetwork: false }
];

const codeExecPermissions: readonly RuntimeToolPermission[] = [
  {
    kind: "code-execution",
    sandbox: "caller-provided",
    languages: ["javascript", "typescript", "python", "bash", "shell"],
    allowNetwork: false
  }
];

const codeExecLanguages: readonly CodeExecToolLanguage[] = [
  "javascript",
  "typescript",
  "python",
  "bash",
  "shell"
];

// ---------------------------------------------------------------------------
// Public dispatch helpers (per-built-in identity / schema / permissions / validation)
// ---------------------------------------------------------------------------

export function builtInDogpileToolIdentity(name: "webSearch"): RuntimeToolIdentity;
export function builtInDogpileToolIdentity(name: "codeExec"): RuntimeToolIdentity;
export function builtInDogpileToolIdentity(name: DogpileBuiltInToolName): RuntimeToolIdentity {
  return name === "webSearch" ? webSearchIdentity : codeExecIdentity;
}

export function builtInDogpileToolInputSchema(name: "webSearch"): RuntimeToolInputSchema;
export function builtInDogpileToolInputSchema(name: "codeExec"): RuntimeToolInputSchema;
export function builtInDogpileToolInputSchema(name: DogpileBuiltInToolName): RuntimeToolInputSchema {
  return name === "webSearch" ? webSearchInputSchema : codeExecInputSchema;
}

export function builtInDogpileToolPermissions(name: DogpileBuiltInToolName): readonly RuntimeToolPermission[] {
  return name === "webSearch" ? webSearchPermissions : codeExecPermissions;
}

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

// ---------------------------------------------------------------------------
// Web search adapter
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Code exec adapter
// ---------------------------------------------------------------------------

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
            detail: { issues: serializeValidationIssues(validation.issues) }
          }
        };
      }

      const timeoutMs = input.timeoutMs ?? options.defaultTimeoutMs;
      const executionInput: CodeExecToolInput =
        timeoutMs === undefined ? input : { ...input, timeoutMs };

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

// ---------------------------------------------------------------------------
// Built-in normalizers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
        detail: { issues: serializeValidationIssues(validation.issues) }
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
  if (!options) return defaultIdentity;
  return {
    ...defaultIdentity,
    ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
    ...(options.version !== undefined ? { version: options.version } : {}),
    ...(options.description !== undefined ? { description: options.description } : {})
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
      detail: { allowed: Array.from(languages) }
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
      detail: { maximum: options.maxTimeoutMs }
    });
  }

  return issues.length === 0 ? { type: "valid" } : { type: "invalid", issues };
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

  return { results: resultValues.map(normalizeWebSearchResult) };
}

function codeExecPermissionsFor(
  languages: readonly CodeExecToolLanguage[],
  allowNetwork: boolean
): readonly RuntimeToolPermission[] {
  return [
    { kind: "code-execution", sandbox: "caller-provided", languages, allowNetwork }
  ];
}

function codeExecInputSchemaFor(languages: readonly CodeExecToolLanguage[]): RuntimeToolInputSchema {
  return {
    kind: "json-schema",
    ...(codeExecInputSchema.description ? { description: codeExecInputSchema.description } : {}),
    schema: {
      type: "object",
      properties: {
        language: { type: "string", enum: Array.from(languages) },
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
      if (timeoutId !== undefined) clearTimeout(timeoutId);
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
          detail: { timeoutMs }
        } satisfies RuntimeToolAdapterError);
      }, timeoutMs);
    }

    execution.then(
      (output) => { cleanup(); resolve(output); },
      (error: unknown) => { cleanup(); reject(error); }
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
  if (value === undefined) return undefined;
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
  if (value === undefined) return undefined;
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
        detail: { minimum: 1 }
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
      detail: { allowed: ["javascript", "typescript", "python", "bash", "shell"] }
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
        detail: { minimum: 1 }
      });
    }
  }

  return issues;
}

function isCodeExecLanguage(value: string): value is CodeExecToolInput["language"] {
  return value === "javascript" || value === "typescript" || value === "python" || value === "bash" || value === "shell";
}

// ---------------------------------------------------------------------------
// Adapter error normalization (shared with the executor in tools.ts)
// ---------------------------------------------------------------------------

export function normalizeRuntimeToolAdapterError(error: unknown): RuntimeToolAdapterError {
  if (isRuntimeToolAdapterError(error)) return error;

  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      code: "aborted",
      message: error.message || "Tool execution was aborted.",
      retryable: true,
      detail: { name: error.name }
    };
  }

  if (error instanceof Error) {
    return {
      code: "backend-error",
      message: error.message,
      retryable: false,
      detail: { name: error.name }
    };
  }

  return {
    code: "unknown",
    message: "Tool execution failed with a non-Error value.",
    retryable: false,
    detail: { valueType: typeof error }
  };
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
