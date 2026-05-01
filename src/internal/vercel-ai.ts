/**
 * Repo-internal Vercel AI adapter. NOT a published surface.
 *
 * This module is intentionally located under `src/internal/` and is not
 * referenced by `package.json#exports` or `package.json#files`. It exists
 * solely so the test suite can exercise the broader runtime against a
 * representative non-OpenAI provider shape. Adding it to the public exports
 * would force `ai` to become a peer dependency, contradicting the
 * provider-neutral, no-required-peer-SDK promise in CLAUDE.md.
 */
import { generateText as defaultGenerateText, streamText as defaultStreamText } from "ai";
import type {
  CallWarning,
  FinishReason,
  LanguageModel,
  LanguageModelRequestMetadata,
  LanguageModelResponseMetadata,
  LanguageModelUsage,
  ModelMessage as VercelAIModelMessage,
  ProviderMetadata,
  TimeoutConfiguration,
  ToolChoice,
  ToolSet,
  TypedToolCall
} from "ai";
import { DogpileError } from "../types.js";
import type {
  ConfiguredModelProvider,
  JsonObject,
  JsonValue,
  ModelFinishReason,
  ModelRequest,
  ModelResponse,
  ModelOutputChunk,
  RuntimeToolExecutionRequest
} from "../types.js";
import { validateVercelAIProviderOptions } from "../runtime/validation.js";

/**
 * Cost-estimator input for Vercel AI provider calls.
 *
 * @remarks
 * Dogpile does not bundle model pricing. Provide a cost estimator backed by
 * your own pricing table when you want `costUsd` populated on model responses.
 */
export interface VercelAIProviderCostContext {
  /** Stable Dogpile provider id assigned to the adapter. */
  readonly providerId: string;
  /** Whether the call used `generateText` or `streamText`. */
  readonly mode: "generate" | "stream";
  /** Provider-neutral request Dogpile passed into the adapter. */
  readonly request: ModelRequest;
  /** Normalized usage reported by the Vercel AI SDK, when available. */
  readonly usage?: ModelResponse["usage"];
}

/**
 * Caller-supplied function used to compute `costUsd` from reported usage.
 */
export type VercelAIProviderCostEstimator = (context: VercelAIProviderCostContext) => number | undefined;

/**
 * Provider-specific Vercel AI SDK options keyed by provider name.
 */
export type VercelAIProviderOptionsMap = Readonly<Record<string, JsonObject>>;

/**
 * Vercel AI SDK tool call shape surfaced by text generation.
 */
export type VercelAIToolCall<TOOLS extends ToolSet = ToolSet> = TypedToolCall<TOOLS>;

/**
 * Map a Vercel AI model-visible tool name to a Dogpile runtime tool id.
 *
 * @remarks
 * The default maps `lookup` to `vercel-ai.tools.lookup`, matching
 * `normalizeVercelAITool()` and `normalizeVercelAITools()`.
 */
export type VercelAIToolIdMapper<TOOLS extends ToolSet = ToolSet> = (
  toolName: string,
  toolCall: VercelAIToolCall<TOOLS>
) => string;

/**
 * Minimal call shape Dogpile passes to Vercel AI SDK text generation.
 */
export interface VercelAITextGenerationOptions<TOOLS extends ToolSet = ToolSet> {
  readonly model: LanguageModel;
  readonly messages: VercelAIModelMessage[];
  readonly temperature: number;
  readonly maxOutputTokens?: number;
  readonly topP?: number;
  readonly topK?: number;
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly stopSequences?: string[];
  readonly seed?: number;
  readonly maxRetries?: number;
  readonly abortSignal?: AbortSignal;
  readonly timeout?: TimeoutConfiguration;
  readonly headers?: Record<string, string | undefined>;
  readonly providerOptions?: VercelAIProviderOptionsMap;
  readonly tools?: TOOLS;
  readonly toolChoice?: ToolChoice<TOOLS>;
  readonly activeTools?: Array<keyof TOOLS>;
  readonly experimental_context?: unknown;
}

/**
 * Minimal result shape Dogpile reads from `generateText`.
 */
export interface VercelAITextGenerationResult<TOOLS extends ToolSet = ToolSet> {
  readonly text: string;
  readonly finishReason?: FinishReason;
  readonly rawFinishReason?: string;
  readonly toolCalls?: readonly VercelAIToolCall<TOOLS>[];
  readonly usage?: LanguageModelUsage;
  readonly totalUsage?: LanguageModelUsage;
  readonly warnings?: readonly CallWarning[];
  readonly request?: LanguageModelRequestMetadata;
  readonly response?: LanguageModelResponseMetadata & {
    readonly body?: unknown;
    readonly messages?: readonly unknown[];
  };
  readonly providerMetadata?: ProviderMetadata;
}

/**
 * Minimal result shape Dogpile reads from `streamText`.
 */
export interface VercelAITextStreamResult<TOOLS extends ToolSet = ToolSet> {
  readonly textStream: AsyncIterable<string>;
  readonly finishReason?: PromiseLike<FinishReason>;
  readonly rawFinishReason?: PromiseLike<string | undefined>;
  readonly toolCalls?: PromiseLike<readonly VercelAIToolCall<TOOLS>[]>;
  readonly usage?: PromiseLike<LanguageModelUsage>;
  readonly totalUsage?: PromiseLike<LanguageModelUsage>;
  readonly warnings?: PromiseLike<readonly CallWarning[] | undefined>;
  readonly request?: PromiseLike<LanguageModelRequestMetadata | undefined>;
  readonly response?: PromiseLike<
    | (LanguageModelResponseMetadata & {
        readonly body?: unknown;
        readonly messages?: readonly unknown[];
      })
    | undefined
  >;
  readonly providerMetadata?: PromiseLike<ProviderMetadata | undefined>;
}

/**
 * Injectable `generateText`-compatible function used by the adapter.
 */
export type VercelAIGenerateTextFunction<TOOLS extends ToolSet = ToolSet> = (
  options: VercelAITextGenerationOptions<TOOLS>
) => Promise<VercelAITextGenerationResult<TOOLS>>;

/**
 * Injectable `streamText`-compatible function used by the adapter.
 */
export type VercelAIStreamTextFunction<TOOLS extends ToolSet = ToolSet> = (
  options: VercelAITextGenerationOptions<TOOLS>
) => VercelAITextStreamResult<TOOLS>;

/**
 * Options for adapting a Vercel AI SDK language model into Dogpile's provider interface.
 */
export interface VercelAIProviderOptions<TOOLS extends ToolSet = ToolSet> {
  /** Vercel AI SDK language model instance or registered model id. */
  readonly model: LanguageModel;
  /** Stable provider id recorded in Dogpile traces; inferred from the model when omitted. */
  readonly id?: string;
  /** Enable Dogpile streaming through Vercel AI SDK `streamText`. */
  readonly streaming?: boolean;
  /** Optional `generateText` replacement for instrumentation or tests. */
  readonly generateText?: VercelAIGenerateTextFunction<TOOLS>;
  /** Optional `streamText` replacement for instrumentation or tests. */
  readonly streamText?: VercelAIStreamTextFunction<TOOLS>;
  /** Caller-supplied usage-to-cost estimator. Dogpile ships no pricing table. */
  readonly costEstimator?: VercelAIProviderCostEstimator;
  readonly maxOutputTokens?: number;
  readonly topP?: number;
  readonly topK?: number;
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly stopSequences?: readonly string[];
  readonly seed?: number;
  readonly maxRetries?: number;
  readonly abortSignal?: AbortSignal;
  readonly timeout?: TimeoutConfiguration;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly providerOptions?: VercelAIProviderOptionsMap;
  readonly tools?: TOOLS;
  readonly toolChoice?: ToolChoice<TOOLS>;
  readonly activeTools?: readonly (keyof TOOLS)[];
  /** Map model-visible Vercel AI tool names to Dogpile runtime tool ids. */
  readonly runtimeToolIdForName?: VercelAIToolIdMapper<TOOLS>;
  /** Context forwarded to Vercel AI SDK tool execution as `experimental_context`. */
  readonly context?: unknown;
}

/**
 * Adapt a Vercel AI SDK language model into Dogpile's `ConfiguredModelProvider`.
 */
export function createVercelAIProvider<TOOLS extends ToolSet = ToolSet>(
  options: VercelAIProviderOptions<TOOLS>
): ConfiguredModelProvider {
  validateVercelAIProviderOptions(options);

  const providerId = options.id ?? inferProviderId(options.model);
  const generateText = options.generateText ?? defaultGenerateText;
  const streamText = options.streamText ?? defaultStreamText;

  return {
    id: providerId,
    modelId: typeof options.model === "string" ? options.model : options.model.modelId,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      try {
        const result = await generateText(createTextOptions(options, request));
        const usage = normalizeUsage(result.totalUsage ?? result.usage);
        const toolRequests = result.toolCalls ? normalizeToolCalls(result.toolCalls, options) : undefined;
        const metadata = normalizeVercelAIResponseMetadata({
          ...(result.rawFinishReason !== undefined ? { rawFinishReason: result.rawFinishReason } : {}),
          ...(result.warnings !== undefined ? { warnings: result.warnings } : {}),
          ...(result.request !== undefined ? { requestMetadata: result.request } : {}),
          ...(result.response !== undefined ? { responseMetadata: result.response } : {}),
          ...(result.providerMetadata !== undefined ? { providerMetadata: result.providerMetadata } : {})
        });

        return toModelResponse({
          text: result.text,
          ...(result.finishReason !== undefined ? { finishReason: result.finishReason } : {}),
          ...(toolRequests ? { toolRequests } : {}),
          mode: "generate",
          providerId,
          request,
          ...(usage ? { usage } : {}),
          ...(metadata ? { metadata } : {}),
          ...(options.costEstimator ? { costEstimator: options.costEstimator } : {})
        });
      } catch (error) {
        throw normalizeVercelAIProviderError(error, providerId);
      }
    },
    ...(options.streaming
      ? {
          async *stream(request: ModelRequest): AsyncIterable<ModelOutputChunk> {
            try {
              const result = streamText(createTextOptions(options, request));

              for await (const text of result.textStream) {
                yield { text };
              }

              const usage = normalizeUsage(await (result.totalUsage ?? result.usage));
              const finishReason = result.finishReason ? normalizeFinishReason(await result.finishReason) : undefined;
              const toolRequests = result.toolCalls
                ? normalizeToolCalls(await result.toolCalls, options)
                : undefined;
              const rawFinishReason = result.rawFinishReason ? await result.rawFinishReason : undefined;
              const warnings = result.warnings ? await result.warnings : undefined;
              const requestMetadata = result.request ? await result.request : undefined;
              const responseMetadata = result.response ? await result.response : undefined;
              const providerMetadata = result.providerMetadata ? await result.providerMetadata : undefined;
              const metadata = normalizeVercelAIResponseMetadata({
                ...(rawFinishReason !== undefined ? { rawFinishReason } : {}),
                ...(warnings !== undefined ? { warnings } : {}),
                ...(requestMetadata !== undefined ? { requestMetadata } : {}),
                ...(responseMetadata !== undefined ? { responseMetadata } : {}),
                ...(providerMetadata !== undefined ? { providerMetadata } : {})
              });
              const costUsd = options.costEstimator?.({
                providerId,
                mode: "stream",
                request,
                ...(usage ? { usage } : {})
              });

              if (
                usage ||
                costUsd !== undefined ||
                finishReason !== undefined ||
                toolRequests !== undefined ||
                metadata !== undefined
              ) {
                yield {
                  text: "",
                  ...(finishReason !== undefined ? { finishReason } : {}),
                  ...(toolRequests ? { toolRequests } : {}),
                  ...(usage ? { usage } : {}),
                  ...(costUsd !== undefined ? { costUsd } : {}),
                  ...(metadata !== undefined ? { metadata } : {})
                };
              }
            } catch (error) {
              throw normalizeVercelAIProviderError(error, providerId);
            }
          }
        }
      : {})
  };
}

function createTextOptions<TOOLS extends ToolSet>(
  options: VercelAIProviderOptions<TOOLS>,
  request: ModelRequest
): VercelAITextGenerationOptions<TOOLS> {
  return {
    model: options.model,
    messages: request.messages.map(toVercelAIMessage),
    temperature: request.temperature,
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.topP !== undefined ? { topP: options.topP } : {}),
    ...(options.topK !== undefined ? { topK: options.topK } : {}),
    ...(options.presencePenalty !== undefined ? { presencePenalty: options.presencePenalty } : {}),
    ...(options.frequencyPenalty !== undefined ? { frequencyPenalty: options.frequencyPenalty } : {}),
    ...(options.stopSequences ? { stopSequences: Array.from(options.stopSequences) } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    ...(request.signal ?? options.abortSignal ? { abortSignal: request.signal ?? options.abortSignal } : {}),
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    ...(options.headers ? { headers: { ...options.headers } } : {}),
    ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.toolChoice ? { toolChoice: options.toolChoice } : {}),
    ...(options.activeTools ? { activeTools: Array.from(options.activeTools) } : {}),
    ...(options.context !== undefined ? { experimental_context: options.context } : {})
  };
}

function toVercelAIMessage(message: ModelRequest["messages"][number]): VercelAIModelMessage {
  return {
    role: message.role,
    content: message.content
  };
}

function normalizeUsage(usage: LanguageModelUsage | undefined): ModelResponse["usage"] | undefined {
  if (
    !usage ||
    (usage.inputTokens === undefined && usage.outputTokens === undefined && usage.totalTokens === undefined)
  ) {
    return undefined;
  }

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens
  };
}

function toModelResponse(options: {
  readonly text: string;
  readonly finishReason?: FinishReason;
  readonly toolRequests?: readonly RuntimeToolExecutionRequest[];
  readonly mode: VercelAIProviderCostContext["mode"];
  readonly providerId: string;
  readonly request: ModelRequest;
  readonly usage?: ModelResponse["usage"];
  readonly metadata?: JsonObject;
  readonly costEstimator?: VercelAIProviderCostEstimator;
}): ModelResponse {
  const costUsd = options.costEstimator?.({
    providerId: options.providerId,
    mode: options.mode,
    request: options.request,
    ...(options.usage ? { usage: options.usage } : {})
  });

  return {
    text: options.text,
    ...(options.finishReason !== undefined ? { finishReason: normalizeFinishReason(options.finishReason) } : {}),
    ...(options.toolRequests && options.toolRequests.length > 0 ? { toolRequests: options.toolRequests } : {}),
    ...(options.usage ? { usage: options.usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(options.metadata !== undefined ? { metadata: options.metadata } : {})
  };
}

function normalizeFinishReason(finishReason: FinishReason): ModelFinishReason {
  return finishReason;
}

function normalizeToolCalls<TOOLS extends ToolSet>(
  toolCalls: readonly VercelAIToolCall<TOOLS>[],
  options: Pick<VercelAIProviderOptions<TOOLS>, "runtimeToolIdForName">
): readonly RuntimeToolExecutionRequest[] | undefined {
  if (toolCalls.length === 0) {
    return undefined;
  }

  return toolCalls.map((toolCall) => {
    const metadata = vercelAIToolCallMetadata(toolCall);

    return {
      toolId: options.runtimeToolIdForName?.(toolCall.toolName, toolCall) ?? defaultRuntimeToolId(toolCall.toolName),
      toolCallId: toolCall.toolCallId,
      input: toJsonObject(toolCall.input),
      ...(metadata ? { metadata } : {})
    };
  });
}

function defaultRuntimeToolId(toolName: string): string {
  return `vercel-ai.tools.${toolName}`;
}

function vercelAIToolCallMetadata<TOOLS extends ToolSet>(
  toolCall: VercelAIToolCall<TOOLS>
): JsonObject | undefined {
  const metadata: Record<string, JsonValue> = {
    vercelAiToolName: toolCall.toolName
  };

  if (toolCall.providerExecuted !== undefined) {
    metadata.providerExecuted = toolCall.providerExecuted;
  }
  if (toolCall.dynamic !== undefined) {
    metadata.dynamic = toolCall.dynamic;
  }
  if (toolCall.invalid !== undefined) {
    metadata.invalid = toolCall.invalid;
  }
  if (toolCall.title !== undefined) {
    metadata.title = toolCall.title;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function normalizeVercelAIResponseMetadata(options: {
  readonly rawFinishReason?: string;
  readonly warnings?: readonly CallWarning[];
  readonly requestMetadata?: LanguageModelRequestMetadata;
  readonly responseMetadata?: LanguageModelResponseMetadata & {
    readonly body?: unknown;
    readonly messages?: readonly unknown[];
  };
  readonly providerMetadata?: ProviderMetadata;
}): JsonObject | undefined {
  const metadata: Record<string, JsonValue> = {};

  if (options.rawFinishReason !== undefined) {
    metadata.rawFinishReason = options.rawFinishReason;
  }

  const requestMetadata = normalizeRequestMetadata(options.requestMetadata);
  if (requestMetadata !== undefined) {
    metadata.request = requestMetadata;
  }

  const responseMetadata = normalizeResponseMetadata(options.responseMetadata);
  if (responseMetadata !== undefined) {
    metadata.response = responseMetadata;
  }

  const providerMetadata = toJsonValue(options.providerMetadata);
  if (providerMetadata !== undefined) {
    metadata.providerMetadata = providerMetadata;
  }

  const warnings = toJsonValue(options.warnings);
  if (warnings !== undefined) {
    metadata.warnings = warnings;
  }

  return Object.keys(metadata).length > 0
    ? {
        vercelAi: metadata
      }
    : undefined;
}

function normalizeRequestMetadata(metadata: LanguageModelRequestMetadata | undefined): JsonObject | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  const result: Record<string, JsonValue> = {};
  const body = toJsonValue(metadata.body);
  if (body !== undefined) {
    result.body = body;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeResponseMetadata(
  metadata:
    | (LanguageModelResponseMetadata & {
        readonly body?: unknown;
        readonly messages?: readonly unknown[];
      })
    | undefined
): JsonObject | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  const result: Record<string, JsonValue> = {
    id: metadata.id,
    timestamp: metadata.timestamp instanceof Date ? metadata.timestamp.toISOString() : String(metadata.timestamp),
    modelId: metadata.modelId
  };

  const headers = toJsonValue(metadata.headers);
  if (headers !== undefined) {
    result.headers = headers;
  }

  const body = toJsonValue(metadata.body);
  if (body !== undefined) {
    result.body = body;
  }

  return result;
}

function normalizeVercelAIProviderError(error: unknown, providerId: string): DogpileError {
  if (DogpileError.isInstance(error)) {
    return error;
  }

  if (
    isAbortError(error) ||
    (aiSdkErrorName(error) === "AI_RetryError" && readStringProperty(error, "reason") === "abort")
  ) {
    return new DogpileError({
      code: "aborted",
      message: errorMessage(error, "The provider request was aborted."),
      cause: error,
      retryable: false,
      providerId,
      detail: errorDetail(error)
    });
  }

  const statusCode = readNumberProperty(error, "statusCode");
  const aiErrorName = aiSdkErrorName(error);
  const code = providerErrorCode(aiErrorName, statusCode);
  const retryable = providerErrorRetryable(error, code);

  return new DogpileError({
    code,
    message: errorMessage(error, "The provider request failed."),
    cause: error,
    ...(retryable !== undefined ? { retryable } : {}),
    providerId,
    detail: errorDetail(error)
  });
}

function providerErrorCode(errorName: string | undefined, statusCode: number | undefined): DogpileError["code"] {
  if (statusCode === 401 || statusCode === 403) {
    return "provider-authentication";
  }
  if (statusCode === 404) {
    return "provider-not-found";
  }
  if (statusCode === 408 || statusCode === 504) {
    return "provider-timeout";
  }
  if (statusCode === 409 || statusCode === 429) {
    return "provider-rate-limited";
  }
  if (statusCode !== undefined && statusCode >= 500) {
    return "provider-unavailable";
  }

  switch (errorName) {
    case "AI_LoadAPIKeyError":
      return "provider-authentication";
    case "AI_NoSuchModelError":
    case "AI_NoSuchProviderError":
      return "provider-not-found";
    case "AI_InvalidArgumentError":
    case "AI_InvalidPromptError":
    case "AI_InvalidToolInputError":
    case "AI_NoSuchToolError":
    case "AI_TypeValidationError":
      return "provider-invalid-request";
    case "AI_EmptyResponseBodyError":
    case "AI_InvalidResponseDataError":
    case "AI_JSONParseError":
    case "AI_NoContentGeneratedError":
    case "AI_NoOutputGeneratedError":
      return "provider-invalid-response";
    case "AI_RetryError":
      return "provider-unavailable";
    case "AI_UnsupportedFunctionalityError":
    case "AI_UnsupportedModelVersionError":
      return "provider-unsupported";
    case "AI_APICallError":
      return "provider-error";
    default:
      return "unknown";
  }
}

function providerErrorRetryable(error: unknown, code: DogpileError["code"]): boolean | undefined {
  const retryable = readBooleanProperty(error, "isRetryable");
  if (retryable !== undefined) {
    return retryable;
  }

  if (code === "provider-rate-limited" || code === "provider-timeout" || code === "provider-unavailable") {
    return true;
  }
  if (code === "provider-authentication" || code === "provider-invalid-request" || code === "provider-not-found") {
    return false;
  }

  return undefined;
}

function errorDetail(error: unknown): JsonObject {
  const detail: Record<string, JsonValue> = {};
  const name = errorName(error);
  const aiName = aiSdkErrorName(error);
  const statusCode = readNumberProperty(error, "statusCode");
  const url = readStringProperty(error, "url");
  const responseHeaders = toJsonValue(readUnknownProperty(error, "responseHeaders"));
  const responseBody = readStringProperty(error, "responseBody");
  const data = toJsonValue(readUnknownProperty(error, "data"));
  const reason = readStringProperty(error, "reason");

  if (name !== undefined) {
    detail.name = name;
  }
  if (aiName !== undefined) {
    detail.aiSdkErrorName = aiName;
  }
  if (statusCode !== undefined) {
    detail.statusCode = statusCode;
  }
  if (url !== undefined) {
    detail.url = url;
  }
  if (responseHeaders !== undefined) {
    detail.responseHeaders = responseHeaders;
  }
  if (responseBody !== undefined) {
    detail.responseBody = responseBody;
  }
  if (data !== undefined) {
    detail.data = data;
  }
  if (reason !== undefined) {
    detail.reason = reason;
  }

  return detail;
}

function toJsonObject(value: unknown): JsonObject {
  if (isRecord(value)) {
    const result: Record<string, JsonValue> = {};

    for (const [key, child] of Object.entries(value)) {
      const jsonValue = toJsonValue(child);
      if (jsonValue !== undefined) {
        result[key] = jsonValue;
      }
    }

    return result;
  }

  return {
    value: toJsonValue(value) ?? null
  };
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((child) => toJsonValue(child) ?? null);
  }

  if (isRecord(value)) {
    return toJsonObject(value);
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isAbortError(error: unknown): boolean {
  return errorName(error) === "AbortError";
}

function aiSdkErrorName(error: unknown): string | undefined {
  const name = errorName(error);
  return name?.startsWith("AI_") ? name : undefined;
}

function errorName(error: unknown): string | undefined {
  return readStringProperty(error, "name");
}

function readStringProperty(value: unknown, key: string): string | undefined {
  const property = readUnknownProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

function readNumberProperty(value: unknown, key: string): number | undefined {
  const property = readUnknownProperty(value, key);
  return typeof property === "number" && Number.isFinite(property) ? property : undefined;
}

function readBooleanProperty(value: unknown, key: string): boolean | undefined {
  const property = readUnknownProperty(value, key);
  return typeof property === "boolean" ? property : undefined;
}

function readUnknownProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function inferProviderId(model: LanguageModel): string {
  if (typeof model === "string") {
    return `vercel-ai:${model}`;
  }

  const modelRecord = model as Readonly<Record<string, unknown>>;
  const provider = typeof modelRecord.provider === "string" ? modelRecord.provider : undefined;
  const modelId = typeof modelRecord.modelId === "string" ? modelRecord.modelId : undefined;

  if (provider && modelId) {
    return `vercel-ai:${provider}:${modelId}`;
  }

  return modelId ? `vercel-ai:${modelId}` : "vercel-ai:model";
}
