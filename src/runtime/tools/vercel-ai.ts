import type {
  JsonObject,
  JsonValue,
  ModelMessage,
  RuntimeTool,
  RuntimeToolExecutionContext,
  RuntimeToolIdentity,
  RuntimeToolInputSchema,
  RuntimeToolResult
} from "../../types.js";
import { DogpileError } from "../../types.js";

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type VercelAICompatibleSchema<Input> = unknown;

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
    return { name: error.name };
  }
  return { valueType: typeof error };
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
