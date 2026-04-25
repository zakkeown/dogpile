import { describe, expect, it } from "vitest";
import { DogpileError, run, stream } from "../index.js";
import type {
  ConfiguredModelProvider,
  DogpileErrorCode,
  DogpileOptions,
  JsonObject,
  JsonValue,
  ModelResponse,
  RuntimeTool,
  RuntimeToolExecutionContext,
  StreamHandle
} from "../index.js";

type DogpileBadInputCase = {
  readonly name: string;
  readonly makeOptions: (provider: ConfiguredModelProvider) => unknown;
  readonly expectedCode: DogpileErrorCode;
  readonly expectedPath?: string;
};

const dogpileBadInputCases: readonly DogpileBadInputCase[] = [
  {
    name: "missing options object",
    makeOptions: () => undefined,
    expectedCode: "invalid-configuration",
    expectedPath: "options"
  },
  {
    name: "blank intent",
    makeOptions: (provider) => optionsWith(provider, { intent: " " }),
    expectedCode: "invalid-configuration",
    expectedPath: "intent"
  },
  {
    name: "unknown protocol string",
    makeOptions: (provider) => optionsWith(provider, { protocol: "ring" }),
    expectedCode: "invalid-configuration",
    expectedPath: "protocol"
  },
  {
    name: "unknown protocol config kind",
    makeOptions: (provider) => optionsWith(provider, { protocol: { kind: "ring", maxTurns: 1 } }),
    expectedCode: "invalid-configuration",
    expectedPath: "protocol.kind"
  },
  {
    name: "non-positive protocol turn limit",
    makeOptions: (provider) => optionsWith(provider, { protocol: { kind: "sequential", maxTurns: 0 } }),
    expectedCode: "invalid-configuration",
    expectedPath: "protocol.maxTurns"
  },
  {
    name: "unknown tier",
    makeOptions: (provider) => optionsWith(provider, { tier: "cheap" }),
    expectedCode: "invalid-configuration",
    expectedPath: "tier"
  },
  {
    name: "missing model",
    makeOptions: (provider) => optionsWith(provider, { model: undefined }),
    expectedCode: "invalid-configuration",
    expectedPath: "model"
  },
  {
    name: "model provider registration is not an object",
    makeOptions: (provider) => optionsWith(provider, { model: [provider] }),
    expectedCode: "invalid-configuration",
    expectedPath: "model"
  },
  {
    name: "model provider registration with blank id",
    makeOptions: (provider) => optionsWith(provider, { model: { ...provider, id: " " } }),
    expectedCode: "invalid-configuration",
    expectedPath: "model.id"
  },
  {
    name: "model without generate",
    makeOptions: (provider) => optionsWith(provider, { model: { id: provider.id } }),
    expectedCode: "invalid-configuration",
    expectedPath: "model.generate"
  },
  {
    name: "model provider registration with non-function generate",
    makeOptions: (provider) => optionsWith(provider, { model: { ...provider, generate: "not-callable" } }),
    expectedCode: "invalid-configuration",
    expectedPath: "model.generate"
  },
  {
    name: "model provider registration with non-function stream",
    makeOptions: (provider) => optionsWith(provider, { model: { ...provider, stream: "not-callable" } }),
    expectedCode: "invalid-configuration",
    expectedPath: "model.stream"
  },
  {
    name: "empty agent roster",
    makeOptions: (provider) => optionsWith(provider, { agents: [] }),
    expectedCode: "invalid-configuration",
    expectedPath: "agents"
  },
  {
    name: "blank agent id",
    makeOptions: (provider) => optionsWith(provider, { agents: [{ id: "", role: "critic" }] }),
    expectedCode: "invalid-configuration",
    expectedPath: "agents[0].id"
  },
  {
    name: "temperature outside provider-neutral range",
    makeOptions: (provider) => optionsWith(provider, { temperature: 3 }),
    expectedCode: "invalid-configuration",
    expectedPath: "temperature"
  },
  {
    name: "negative dollar budget cap",
    makeOptions: (provider) => optionsWith(provider, { budget: { maxUsd: -1 } }),
    expectedCode: "invalid-configuration",
    expectedPath: "budget.maxUsd"
  },
  {
    name: "negative token budget cap",
    makeOptions: (provider) => optionsWith(provider, { budget: { maxTokens: -1 } }),
    expectedCode: "invalid-configuration",
    expectedPath: "budget.maxTokens"
  },
  {
    name: "quality weight outside normalized range",
    makeOptions: (provider) => optionsWith(provider, { budget: { qualityWeight: 1.5 } }),
    expectedCode: "invalid-configuration",
    expectedPath: "budget.qualityWeight"
  },
  {
    name: "unknown termination kind",
    makeOptions: (provider) => optionsWith(provider, { terminate: { kind: "forever" } }),
    expectedCode: "invalid-configuration",
    expectedPath: "terminate.kind"
  },
  {
    name: "invalid convergence stable turn count",
    makeOptions: (provider) =>
      optionsWith(provider, { terminate: { kind: "convergence", stableTurns: 0, minSimilarity: 0.8 } }),
    expectedCode: "invalid-configuration",
    expectedPath: "terminate.stableTurns"
  },
  {
    name: "empty firstOf condition set",
    makeOptions: (provider) => optionsWith(provider, { terminate: { kind: "firstOf", conditions: [] } }),
    expectedCode: "invalid-configuration",
    expectedPath: "terminate.conditions"
  },
  {
    name: "non-function evaluation hook",
    makeOptions: (provider) => optionsWith(provider, { evaluate: "not-callable" }),
    expectedCode: "invalid-configuration",
    expectedPath: "evaluate"
  },
  {
    name: "malformed abort signal",
    makeOptions: (provider) => optionsWith(provider, { signal: { aborted: false } }),
    expectedCode: "invalid-configuration",
    expectedPath: "signal"
  },
  {
    name: "already-aborted caller signal",
    makeOptions: (provider) => {
      const abortController = new AbortController();
      abortController.abort();

      return optionsWith(provider, { signal: abortController.signal });
    },
    expectedCode: "aborted"
  },
  {
    name: "non-finite seed",
    makeOptions: (provider) => optionsWith(provider, { seed: Number.NaN }),
    expectedCode: "invalid-configuration",
    expectedPath: "seed"
  },
  {
    name: "tool registration set is not an array",
    makeOptions: (provider) => optionsWith(provider, { tools: "not-an-array" }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools"
  },
  {
    name: "tool registration entry is not an object",
    makeOptions: (provider) => optionsWith(provider, { tools: ["not-a-tool"] }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0]"
  },
  {
    name: "tool registration without identity",
    makeOptions: (provider) =>
      optionsWith(provider, {
        tools: [runtimeToolWith({ identity: undefined })]
      }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0].identity"
  },
  {
    name: "tool registration with blank identity id",
    makeOptions: (provider) =>
      optionsWith(provider, {
        tools: [runtimeToolWith({ identity: { id: " ", name: "Lookup" } })]
      }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0].identity.id"
  },
  {
    name: "tool registration with blank identity name",
    makeOptions: (provider) =>
      optionsWith(provider, {
        tools: [runtimeToolWith({ identity: { id: "lookup", name: "" } })]
      }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0].identity.name"
  },
  {
    name: "tool registration with non-string identity namespace",
    makeOptions: (provider) =>
      optionsWith(provider, {
        tools: [runtimeToolWith({ identity: { id: "lookup", name: "Lookup", namespace: 42 } })]
      }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0].identity.namespace"
  },
  {
    name: "tool registration with non-string identity version",
    makeOptions: (provider) =>
      optionsWith(provider, {
        tools: [runtimeToolWith({ identity: { id: "lookup", name: "Lookup", version: false } })]
      }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0].identity.version"
  },
  {
    name: "tool registration with non-string identity description",
    makeOptions: (provider) =>
      optionsWith(provider, {
        tools: [runtimeToolWith({ identity: { id: "lookup", name: "Lookup", description: ["search"] } })]
      }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0].identity.description"
  },
  {
    name: "tool registration without input schema",
    makeOptions: (provider) =>
      optionsWith(provider, {
        tools: [runtimeToolWith({ inputSchema: undefined })]
      }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0].inputSchema"
  },
  {
    name: "tool registration with unsupported input schema kind",
    makeOptions: (provider) =>
      optionsWith(provider, {
        tools: [runtimeToolWith({ inputSchema: { kind: "zod", schema: {} } })]
      }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0].inputSchema.kind"
  },
  {
    name: "tool registration with non-JSON input schema",
    makeOptions: (provider) =>
      optionsWith(provider, {
        tools: [runtimeToolWith({ inputSchema: { kind: "json-schema", schema: { maximum: Number.NaN } } })]
      }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0].inputSchema.schema"
  },
  {
    name: "tool registration with non-string input schema description",
    makeOptions: (provider) =>
      optionsWith(provider, {
        tools: [runtimeToolWith({ inputSchema: { kind: "json-schema", schema: {}, description: 123 } })]
      }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0].inputSchema.description"
  },
  {
    name: "tool registration with non-array permissions",
    makeOptions: (provider) =>
      optionsWith(provider, {
        tools: [runtimeToolWith({ permissions: "read-everything" })]
      }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0].permissions"
  },
  {
    name: "tool registration with non-function validateInput",
    makeOptions: (provider) =>
      optionsWith(provider, {
        tools: [runtimeToolWith({ validateInput: "not-callable" })]
      }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0].validateInput"
  },
  {
    name: "tool registration without executor",
    makeOptions: (provider) =>
      optionsWith(provider, {
        tools: [
          {
            identity: { id: "lookup", name: "Lookup" },
            inputSchema: { kind: "json-schema", schema: {} }
          }
        ]
      }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0].execute"
  },
  {
    name: "tool registration with non-function executor",
    makeOptions: (provider) =>
      optionsWith(provider, {
        tools: [runtimeToolWith({ execute: "not-callable" })]
      }),
    expectedCode: "invalid-configuration",
    expectedPath: "tools[0].execute"
  }
];

describe("run() bad input error contract", () => {
  it.each(dogpileBadInputCases)(
    "throws DogpileError code $expectedCode for $name",
    async ({ makeOptions, expectedCode, expectedPath }) => {
      let providerCalls = 0;
      const provider: ConfiguredModelProvider = {
        id: "run-bad-input-provider",
        async generate(): Promise<ModelResponse> {
          providerCalls += 1;

          return { text: "provider should not be called for bad run input" };
        }
      };

      await expectRunDogpileError(() => run(makeOptions(provider) as DogpileOptions), expectedCode, expectedPath);
      expect(providerCalls).toBe(0);
    }
  );
});

describe("stream() bad input error contract", () => {
  it.each(dogpileBadInputCases)(
    "reports DogpileError code $expectedCode for $name",
    async ({ makeOptions, expectedCode, expectedPath }) => {
      let providerCalls = 0;
      const provider: ConfiguredModelProvider = {
        id: "stream-bad-input-provider",
        async generate(): Promise<ModelResponse> {
          providerCalls += 1;

          return { text: "provider should not be called for bad stream input" };
        }
      };

      await expectStreamDogpileError(() => stream(makeOptions(provider) as DogpileOptions), expectedCode, expectedPath);
      expect(providerCalls).toBe(0);
    }
  );
});

function optionsWith(provider: ConfiguredModelProvider, overrides: Record<string, unknown>): DogpileOptions {
  return {
    intent: "Validate run bad-input error codes.",
    protocol: { kind: "sequential", maxTurns: 1 },
    tier: "fast",
    model: provider,
    agents: [{ id: "validator", role: "tester" }],
    ...overrides
  } as unknown as DogpileOptions;
}

function runtimeToolWith(overrides: Record<string, unknown>): RuntimeTool<JsonObject, JsonValue> {
  return {
    identity: {
      id: "lookup",
      name: "Lookup"
    },
    inputSchema: {
      kind: "json-schema",
      schema: {}
    },
    execute(input: Readonly<JsonObject>, context: RuntimeToolExecutionContext) {
      return {
        type: "success",
        toolCallId: context.toolCallId,
        tool: {
          id: "lookup",
          name: "Lookup"
        },
        output: input
      };
    },
    ...overrides
  } as RuntimeTool<JsonObject, JsonValue>;
}

async function expectRunDogpileError(
  operation: () => Promise<unknown>,
  expectedCode: DogpileErrorCode,
  expectedPath: string | undefined
): Promise<void> {
  let thrown: unknown;

  try {
    await operation();
  } catch (error) {
    thrown = error;
  }

  assertDogpileError(thrown, expectedCode, expectedPath);
}

async function expectStreamDogpileError(
  operation: () => StreamHandle,
  expectedCode: DogpileErrorCode,
  expectedPath: string | undefined
): Promise<void> {
  let thrown: unknown;
  let handle: StreamHandle | undefined;

  try {
    handle = operation();
  } catch (error) {
    thrown = error;
  }

  if (thrown !== undefined) {
    assertDogpileError(thrown, expectedCode, expectedPath);
    return;
  }

  expect(handle).toBeDefined();
  if (handle === undefined) {
    throw new Error("expected stream handle");
  }

  const resultError = handle.result.catch((error: unknown) => error);
  const iterator = handle[Symbol.asyncIterator]();
  const errorEvent = await iterator.next();
  const afterError = await iterator.next();
  const rejectedError = await resultError;

  expect(errorEvent.value).toMatchObject({
    type: "error",
    detail: {
      code: expectedCode
    }
  });
  expect(afterError).toEqual({ done: true, value: undefined });
  assertDogpileError(rejectedError, expectedCode, expectedPath);
}

function assertDogpileError(
  thrown: unknown,
  expectedCode: DogpileErrorCode,
  expectedPath: string | undefined
): void {
  expect(thrown).toBeInstanceOf(DogpileError);
  expect(DogpileError.isInstance(thrown)).toBe(true);
  if (!DogpileError.isInstance(thrown)) {
    throw new Error("expected DogpileError");
  }

  expect(thrown.code).toBe(expectedCode);
  if (expectedPath !== undefined) {
    expect(thrown.retryable).toBe(false);
    expect(thrown.detail).toMatchObject({
      kind: "configuration-validation",
      path: expectedPath
    });
  }
}
