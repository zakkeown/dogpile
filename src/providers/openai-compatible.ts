import { DogpileError } from "../types.js";
import type {
  ConfiguredModelProvider,
  DogpileErrorCode,
  JsonObject,
  JsonValue,
  ModelFinishReason,
  ModelMessage,
  ModelRequest,
  ModelResponse
} from "../types.js";

const defaultBaseURL = "https://api.openai.com/v1";
const defaultPath = "/chat/completions";

export type OpenAICompatibleFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleProviderCostContext {
  readonly providerId: string;
  readonly request: ModelRequest;
  readonly response: OpenAICompatibleChatCompletionResponse;
  readonly usage?: ModelResponse["usage"];
}

export type OpenAICompatibleProviderCostEstimator = (
  context: OpenAICompatibleProviderCostContext
) => number | undefined;

export interface OpenAICompatibleProviderOptions {
  readonly model: string;
  readonly apiKey?: string;
  readonly baseURL?: string | URL;
  readonly path?: string;
  readonly id?: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: OpenAICompatibleFetch;
  readonly maxOutputTokens?: number;
  readonly extraBody?: JsonObject;
  readonly costEstimator?: OpenAICompatibleProviderCostEstimator;
}

export interface OpenAICompatibleChatCompletionResponse {
  readonly id?: string;
  readonly object?: string;
  readonly created?: number;
  readonly model?: string;
  readonly choices?: readonly OpenAICompatibleChatCompletionChoice[];
  readonly usage?: OpenAICompatibleUsage;
}

export interface OpenAICompatibleChatCompletionChoice {
  readonly finish_reason?: string | null;
  readonly message?: {
    readonly content?: unknown;
  };
}

export interface OpenAICompatibleUsage extends JsonObject {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
}

export function createOpenAICompatibleProvider(options: OpenAICompatibleProviderOptions): ConfiguredModelProvider {
  validateOptions(options);

  const providerId = options.id ?? `openai-compatible:${options.model}`;
  const fetchImplementation = options.fetch ?? globalThis.fetch?.bind(globalThis);

  if (!fetchImplementation) {
    throw new DogpileError({
      code: "invalid-configuration",
      message: "createOpenAICompatibleProvider() requires a fetch implementation in this runtime.",
      retryable: false,
      providerId,
      detail: {
        kind: "configuration-validation",
        path: "fetch",
        expected: "a fetch-compatible function"
      }
    });
  }

  return {
    id: providerId,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      let response: Response;

      try {
        response = await fetchImplementation(createURL(options), {
          method: "POST",
          headers: createHeaders(options),
          body: JSON.stringify(createBody(options, request)),
          ...(request.signal !== undefined ? { signal: request.signal } : {})
        });
      } catch (error) {
        throw normalizeFetchError(error, providerId);
      }

      const payload = await readJson(response, providerId);

      if (!response.ok) {
        throw createProviderError(response, payload, providerId);
      }

      const completion = asChatCompletionResponse(payload, providerId);
      const text = readAssistantText(completion, providerId);
      const usage = normalizeUsage(completion.usage);
      const finishReason = normalizeFinishReason(completion.choices?.[0]?.finish_reason);
      const costUsd = options.costEstimator?.({
        providerId,
        request,
        response: completion,
        ...(usage ? { usage } : {})
      });

      return {
        text,
        ...(finishReason !== undefined ? { finishReason } : {}),
        ...(usage ? { usage } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
        metadata: {
          openAICompatible: responseMetadata(completion)
        }
      };
    }
  };
}

function validateOptions(options: OpenAICompatibleProviderOptions): void {
  if (!isRecord(options)) {
    throwInvalid("options", "an options object");
  }
  if (!isNonEmptyString(options.model)) {
    throwInvalid("model", "a non-empty model id");
  }
  if (options.apiKey !== undefined && !isNonEmptyString(options.apiKey)) {
    throwInvalid("apiKey", "a non-empty API key when provided");
  }
  if (options.id !== undefined && !isNonEmptyString(options.id)) {
    throwInvalid("id", "a non-empty provider id when provided");
  }
  if (options.path !== undefined && !isNonEmptyString(options.path)) {
    throwInvalid("path", "a non-empty request path when provided");
  }
  if (options.fetch !== undefined && typeof options.fetch !== "function") {
    throwInvalid("fetch", "a fetch-compatible function when provided");
  }
  if (options.maxOutputTokens !== undefined && (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens <= 0)) {
    throwInvalid("maxOutputTokens", "a positive integer when provided");
  }
  if (options.costEstimator !== undefined && typeof options.costEstimator !== "function") {
    throwInvalid("costEstimator", "a function when provided");
  }
}

function throwInvalid(path: string, expected: string): never {
  throw new DogpileError({
    code: "invalid-configuration",
    message: `Invalid OpenAI-compatible provider option at ${path}.`,
    retryable: false,
    detail: {
      kind: "configuration-validation",
      path,
      expected
    }
  });
}

function createURL(options: OpenAICompatibleProviderOptions): URL {
  const baseURL = new URL(String(options.baseURL ?? defaultBaseURL));
  const path = options.path ?? defaultPath;
  return new URL(path.startsWith("/") ? path.slice(1) : path, ensureTrailingSlash(baseURL));
}

function ensureTrailingSlash(url: URL): URL {
  const next = new URL(url);
  if (!next.pathname.endsWith("/")) {
    next.pathname = `${next.pathname}/`;
  }
  return next;
}

function createHeaders(options: OpenAICompatibleProviderOptions): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (value !== undefined) {
      headers.set(key, value);
    }
  }
  headers.set("content-type", "application/json");
  if (options.apiKey !== undefined && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${options.apiKey}`);
  }
  return headers;
}

function createBody(options: OpenAICompatibleProviderOptions, request: ModelRequest): JsonObject {
  return {
    ...(options.extraBody ?? {}),
    model: options.model,
    messages: request.messages.map(toChatMessage),
    temperature: request.temperature,
    ...(options.maxOutputTokens !== undefined ? { max_tokens: options.maxOutputTokens } : {})
  };
}

function toChatMessage(message: ModelMessage): JsonObject {
  return {
    role: message.role,
    content: message.content
  };
}

async function readJson(response: Response, providerId: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new DogpileError({
      code: "provider-invalid-response",
      message: "OpenAI-compatible provider returned a non-JSON response.",
      cause: error,
      retryable: response.status >= 500,
      providerId,
      detail: {
        statusCode: response.status,
        statusText: response.statusText
      }
    });
  }
}

function asChatCompletionResponse(payload: unknown, providerId: string): OpenAICompatibleChatCompletionResponse {
  if (!isRecord(payload)) {
    throw new DogpileError({
      code: "provider-invalid-response",
      message: "OpenAI-compatible provider response must be a JSON object.",
      retryable: true,
      providerId
    });
  }

  return payload as OpenAICompatibleChatCompletionResponse;
}

function readAssistantText(response: OpenAICompatibleChatCompletionResponse, providerId: string): string {
  const content = response.choices?.[0]?.message?.content;
  const text = normalizeContent(content);

  if (!text) {
    throw new DogpileError({
      code: "provider-invalid-response",
      message: "OpenAI-compatible provider response did not include assistant text.",
      retryable: true,
      providerId
    });
  }

  return text;
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!isRecord(part)) {
        return "";
      }
      const text = part.text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("");
}

function normalizeUsage(usage: OpenAICompatibleUsage | undefined): ModelResponse["usage"] | undefined {
  if (!usage) {
    return undefined;
  }

  const inputTokens = readTokenCount(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = readTokenCount(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = readTokenCount(usage.total_tokens) ?? sumIfPresent(inputTokens, outputTokens);

  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens
  };
}

function readTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function sumIfPresent(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined || right === undefined ? undefined : left + right;
}

function normalizeFinishReason(reason: string | null | undefined): ModelFinishReason | undefined {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
    case "content-filter":
      return "content-filter";
    case "tool_calls":
    case "tool-calls":
      return "tool-calls";
    case undefined:
    case null:
      return undefined;
    default:
      return "other";
  }
}

function responseMetadata(response: OpenAICompatibleChatCompletionResponse): JsonObject {
  return removeUndefined({
    id: response.id,
    object: response.object,
    created: response.created,
    model: response.model,
    usage: isJsonValue(response.usage) ? response.usage : undefined
  });
}

function createProviderError(response: Response, payload: unknown, providerId: string): DogpileError {
  return new DogpileError({
    code: codeForStatus(response.status),
    message: providerResponseErrorMessage(response, payload),
    retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    providerId,
    detail: removeUndefined({
      statusCode: response.status,
      statusText: response.statusText,
      response: isJsonValue(payload) ? payload : undefined
    })
  });
}

function normalizeFetchError(error: unknown, providerId: string): DogpileError {
  if (DogpileError.isInstance(error)) {
    return error;
  }

  if (errorName(error) === "AbortError") {
    return new DogpileError({
      code: "aborted",
      message: providerTransportErrorMessage(error, "OpenAI-compatible provider request was aborted."),
      cause: error,
      retryable: false,
      providerId,
      detail: errorDetail(error)
    });
  }

  return new DogpileError({
    code: "provider-error",
    message: providerTransportErrorMessage(
      error,
      "OpenAI-compatible provider request failed before receiving a response."
    ),
    cause: error,
    retryable: true,
    providerId,
    detail: errorDetail(error)
  });
}

function codeForStatus(status: number): DogpileErrorCode {
  if (status === 401 || status === 403) {
    return "provider-authentication";
  }
  if (status === 404) {
    return "provider-not-found";
  }
  if (status === 408 || status === 504) {
    return "provider-timeout";
  }
  if (status === 429) {
    return "provider-rate-limited";
  }
  if (status >= 500) {
    return "provider-unavailable";
  }
  if (status >= 400) {
    return "provider-invalid-request";
  }
  return "provider-error";
}

function providerResponseErrorMessage(response: Response, payload: unknown): string {
  const providerMessage = isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
    ? payload.error.message
    : undefined;
  return providerMessage ?? `OpenAI-compatible provider request failed with HTTP ${response.status}.`;
}

function errorDetail(error: unknown): JsonObject {
  const detail: Record<string, JsonValue> = {};
  const name = errorName(error);

  if (name !== undefined) {
    detail.name = name;
  }

  return detail;
}

function errorName(error: unknown): string | undefined {
  return isRecord(error) && typeof error.name === "string" ? error.name : undefined;
}

function providerTransportErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function removeUndefined(values: Record<string, JsonValue | undefined>): JsonObject {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as JsonObject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value !== "number" || Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}
