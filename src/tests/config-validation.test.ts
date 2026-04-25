import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { createEngine, createRuntimeToolExecutor, DogpileError, run, stream } from "../index.js";
import { createVercelAIProvider } from "../providers/vercel-ai.js";
import type {
  ConfiguredModelProvider,
  DogpileOptions,
  EngineOptions,
  JsonObject,
  JsonValue,
  ModelResponse,
  RuntimeTool,
  RuntimeToolExecutionContext
} from "../index.js";

const validModelProvider: ConfiguredModelProvider = {
  id: "config-validation-model",
  async generate(): Promise<ModelResponse> {
    return { text: "ok" };
  }
};

const validDogpileOptions: DogpileOptions = {
  intent: "Validate caller config.",
  protocol: { kind: "sequential", maxTurns: 1 },
  tier: "fast",
  model: validModelProvider,
  agents: [{ id: "validator", role: "tester" }]
};

const vercelModel = "openai/gpt-4.1-mini" as LanguageModel;
const runtimeToolIdentity = {
  id: "fixture.lookup",
  name: "lookup"
} as const;

const invalidDogpileOptionCases = [
  {
    name: "missing options object",
    options: undefined,
    path: "options"
  },
  {
    name: "blank high-level intent",
    options: optionsWith({ intent: " " }),
    path: "intent"
  },
  {
    name: "unknown protocol name",
    options: optionsWith({ protocol: "ring" }),
    path: "protocol"
  },
  {
    name: "non-positive protocol turn limit",
    options: optionsWith({ protocol: { kind: "sequential", maxTurns: 0 } }),
    path: "protocol.maxTurns"
  },
  {
    name: "unknown budget tier",
    options: optionsWith({ tier: "cheap" }),
    path: "tier"
  },
  {
    name: "missing model generate function",
    options: optionsWith({ model: { id: "missing-generate" } }),
    path: "model.generate"
  },
  {
    name: "empty explicit agent roster",
    options: optionsWith({ agents: [] }),
    path: "agents"
  },
  {
    name: "blank agent id",
    options: optionsWith({ agents: [{ id: "", role: "critic" }] }),
    path: "agents[0].id"
  },
  {
    name: "temperature outside provider-neutral range",
    options: optionsWith({ temperature: 3 }),
    path: "temperature"
  },
  {
    name: "negative dollar budget cap",
    options: optionsWith({ budget: { maxUsd: -1 } }),
    path: "budget.maxUsd"
  },
  {
    name: "quality weight outside normalized range",
    options: optionsWith({ budget: { qualityWeight: 1.5 } }),
    path: "budget.qualityWeight"
  },
  {
    name: "unknown termination kind",
    options: optionsWith({ terminate: { kind: "forever" } }),
    path: "terminate.kind"
  },
  {
    name: "invalid convergence stable turn count",
    options: optionsWith({ terminate: { kind: "convergence", stableTurns: 0, minSimilarity: 0.8 } }),
    path: "terminate.stableTurns"
  },
  {
    name: "empty firstOf condition set",
    options: optionsWith({ terminate: { kind: "firstOf", conditions: [] } }),
    path: "terminate.conditions"
  },
  {
    name: "malformed abort signal",
    options: optionsWith({ signal: { aborted: false } }),
    path: "signal"
  },
  {
    name: "non-finite seed",
    options: optionsWith({ seed: Number.NaN }),
    path: "seed"
  },
  {
    name: "runtime tool without executor",
    options: optionsWith({
      tools: [
        {
          identity: { id: "lookup", name: "Lookup" },
          inputSchema: { kind: "json-schema", schema: {} }
        }
      ]
    }),
    path: "tools[0].execute"
  },
  {
    name: "runtime tool with non-function validateInput",
    options: optionsWith({
      tools: [
        runtimeToolWith({
          validateInput: "not-callable"
        })
      ]
    }),
    path: "tools[0].validateInput"
  }
] as const;

const invalidRuntimeToolRegistrationCases = [
  {
    name: "missing executor",
    tools: [
      {
        identity: { id: "fixture.lookup", name: "lookup" },
        inputSchema: { kind: "json-schema", schema: {} }
      }
    ],
    path: "tools[0].execute"
  },
  {
    name: "blank identity id",
    tools: [runtimeToolWith({ identity: { id: "", name: "lookup" } })],
    path: "tools[0].identity.id"
  },
  {
    name: "non-JSON input schema",
    tools: [
      runtimeToolWith({
        inputSchema: {
          kind: "json-schema",
          schema: { maximum: Number.NaN }
        }
      })
    ],
    path: "tools[0].inputSchema.schema"
  },
  {
    name: "non-function validateInput",
    tools: [runtimeToolWith({ validateInput: "not-callable" })],
    path: "tools[0].validateInput"
  }
] as const;

const invalidModelProviderRegistrationCases = [
  {
    name: "missing provider object",
    model: undefined,
    path: "model"
  },
  {
    name: "array provider definition",
    model: [],
    path: "model"
  },
  {
    name: "blank provider id",
    model: providerWith({ id: " " }),
    path: "model.id"
  },
  {
    name: "missing generate function",
    model: { id: "missing-generate" },
    path: "model.generate"
  },
  {
    name: "non-function stream implementation",
    model: providerWith({ stream: "not-callable" }),
    path: "model.stream"
  }
] as const;

const invalidVercelLanguageModelObjectCases = [
  {
    name: "empty model object",
    options: { model: {} },
    path: "model.specificationVersion"
  },
  {
    name: "unsupported language model specification version",
    options: {
      model: {
        specificationVersion: "v1",
        provider: "fixture",
        modelId: "fixture-model",
        doGenerate() {},
        doStream() {}
      }
    },
    path: "model.specificationVersion"
  },
  {
    name: "blank model provider id",
    options: {
      model: {
        specificationVersion: "v3",
        provider: " ",
        modelId: "fixture-model",
        doGenerate() {},
        doStream() {}
      }
    },
    path: "model.provider"
  },
  {
    name: "blank model id",
    options: {
      model: {
        specificationVersion: "v3",
        provider: "fixture",
        modelId: "",
        doGenerate() {},
        doStream() {}
      }
    },
    path: "model.modelId"
  },
  {
    name: "missing non-streaming generator",
    options: {
      model: {
        specificationVersion: "v3",
        provider: "fixture",
        modelId: "fixture-model",
        doStream() {}
      }
    },
    path: "model.doGenerate"
  },
  {
    name: "missing streaming generator",
    options: {
      model: {
        specificationVersion: "v3",
        provider: "fixture",
        modelId: "fixture-model",
        doGenerate() {}
      }
    },
    path: "model.doStream"
  }
] as const;

describe("caller configuration validation", () => {
  it.each(invalidDogpileOptionCases)("maps invalid run() config to DogpileError invalid-configuration: $name", ({ options, path }) => {
    expectInvalidConfiguration(() => run(options as DogpileOptions), path);
  });

  it.each(invalidDogpileOptionCases)(
    "maps invalid stream() config to DogpileError invalid-configuration before returning a handle: $name",
    ({ options, path }) => {
      expectInvalidConfiguration(() => stream(options as DogpileOptions), path);
    }
  );

  it("validates run config before orchestration can call the model provider", () => {
    let providerCalls = 0;
    const sideEffectProvider: ConfiguredModelProvider = {
      id: "config-validation-side-effect-model",
      async generate(): Promise<ModelResponse> {
        providerCalls += 1;
        return { text: "should not be called" };
      }
    };

    expectInvalidConfiguration(
      () =>
        run({
          ...validDogpileOptions,
          protocol: { kind: "sequential", maxTurns: 0 },
          model: sideEffectProvider
        }),
      "protocol.maxTurns"
    );
    expect(providerCalls).toBe(0);
  });

  it("validates stream config before creating a live stream handle", () => {
    let providerCalls = 0;
    const sideEffectProvider: ConfiguredModelProvider = {
      id: "stream-config-validation-side-effect-model",
      async generate(): Promise<ModelResponse> {
        providerCalls += 1;
        return { text: "should not be called" };
      }
    };

    expectInvalidConfiguration(
      () =>
        stream({
          ...validDogpileOptions,
          protocol: { kind: "sequential", maxTurns: 0 },
          model: sideEffectProvider
        }),
      "protocol.maxTurns"
    );
    expect(providerCalls).toBe(0);
  });

  it("validates createEngine config before normalizing reusable protocol controls", () => {
    expectInvalidConfiguration(
      () =>
        createEngine({
          ...validDogpileOptions,
          protocol: { kind: "broadcast", maxRounds: 0 }
        } as unknown as EngineOptions),
      "protocol.maxRounds"
    );
  });

  it.each(invalidModelProviderRegistrationCases)(
    "validates run() model provider registrations before protocol execution: $name",
    ({ model, path }) => {
      expectInvalidConfiguration(
        () =>
          run({
            ...validDogpileOptions,
            model: model as ConfiguredModelProvider
          }),
        path
      );
    }
  );

  it.each(invalidModelProviderRegistrationCases)(
    "validates stream() model provider registrations before returning a handle: $name",
    ({ model, path }) => {
      expectInvalidConfiguration(
        () =>
          stream({
            ...validDogpileOptions,
            model: model as ConfiguredModelProvider
          }),
        path
      );
    }
  );

  it.each(invalidModelProviderRegistrationCases)(
    "validates createEngine() model provider registrations at construction time: $name",
    ({ model, path }) => {
      expectInvalidConfiguration(
        () =>
          createEngine({
            ...validDogpileOptions,
            model: model as ConfiguredModelProvider
          } as EngineOptions),
        path
      );
    }
  );

  it.each(invalidRuntimeToolRegistrationCases)(
    "maps invalid createRuntimeToolExecutor registration to DogpileError invalid-configuration: $name",
    ({ tools, path }) => {
      expectInvalidConfiguration(
        () =>
          createRuntimeToolExecutor({
            runId: "run-invalid-tool-registration",
            protocol: "sequential",
            tier: "fast",
            tools: tools as unknown as readonly RuntimeTool<JsonObject, JsonValue>[]
          }),
        path
      );
    }
  );

  it("accepts optional tool-level validateInput and applies it before execution", async () => {
    let executions = 0;
    const tool = runtimeToolWith({
      validateInput(input: Readonly<JsonObject>) {
        return input.query === "valid"
          ? { type: "valid" }
          : {
              type: "invalid",
              issues: [
                {
                  code: "invalid-value",
                  path: "query",
                  message: "query must be valid."
                }
              ]
            };
      },
      execute(input: Readonly<JsonObject>, context: RuntimeToolExecutionContext) {
        executions += 1;
        return {
          type: "success",
          toolCallId: context.toolCallId,
          tool: runtimeToolIdentity,
          output: {
            observed: input.query ?? null
          }
        };
      }
    });
    const executor = createRuntimeToolExecutor({
      runId: "run-valid-tool-registration",
      protocol: "sequential",
      tier: "fast",
      tools: [tool]
    });

    await expect(executor.execute({ toolId: "fixture.lookup", input: { query: "invalid" } })).resolves.toMatchObject({
      type: "error",
      error: {
        code: "invalid-input",
        detail: {
          issues: [
            {
              code: "invalid-value",
              path: "query"
            }
          ]
        }
      }
    });
    expect(executions).toBe(0);

    await expect(executor.execute({ toolId: "fixture.lookup", input: { query: "valid" } })).resolves.toMatchObject({
      type: "success",
      output: {
        observed: "valid"
      }
    });
    expect(executions).toBe(1);
  });

  it("validates engine stream intent before streaming begins", () => {
    let providerCalls = 0;
    const sideEffectProvider: ConfiguredModelProvider = {
      id: "engine-stream-intent-validation-model",
      async generate(): Promise<ModelResponse> {
        providerCalls += 1;
        return { text: "should not be called" };
      }
    };
    const engine = createEngine({
      protocol: "sequential",
      tier: "fast",
      model: sideEffectProvider,
      agents: [{ id: "validator", role: "tester" }]
    });

    expectInvalidConfiguration(() => engine.stream(" "), "intent");
    expect(providerCalls).toBe(0);
  });

  it.each([
    {
      name: "missing adapter options object",
      options: undefined,
      path: "options"
    },
    {
      name: "missing Vercel model",
      options: {},
      path: "model"
    },
    {
      name: "empty registered Vercel model id",
      options: { model: " " },
      path: "model"
    },
    {
      name: "empty provider id",
      options: { model: vercelModel, id: "" },
      path: "id"
    },
    {
      name: "non-function generateText override",
      options: { model: vercelModel, generateText: "nope" },
      path: "generateText"
    },
    {
      name: "non-function cost estimator",
      options: { model: vercelModel, costEstimator: 1 },
      path: "costEstimator"
    },
    {
      name: "topP outside normalized range",
      options: { model: vercelModel, topP: 2 },
      path: "topP"
    },
    {
      name: "negative retry count",
      options: { model: vercelModel, maxRetries: -1 },
      path: "maxRetries"
    },
    {
      name: "non-string stop sequence",
      options: { model: vercelModel, stopSequences: ["ok", 42] },
      path: "stopSequences[1]"
    },
    {
      name: "non-JSON provider option",
      options: { model: vercelModel, providerOptions: { openai: { temperature: Number.NaN } } },
      path: "providerOptions.openai"
    }
  ])("maps invalid Vercel AI adapter config to DogpileError invalid-configuration: $name", ({ options, path }) => {
    expectInvalidConfiguration(() => createVercelAIProvider(options as Parameters<typeof createVercelAIProvider>[0]), path);
  });

  it.each(invalidVercelLanguageModelObjectCases)(
    "rejects malformed Vercel AI language model objects at adapter registration: $name",
    ({ options, path }) => {
      expectInvalidConfiguration(() => createVercelAIProvider(options as Parameters<typeof createVercelAIProvider>[0]), path);
    }
  );

  it("keeps zero budget caps valid so callers can intentionally stop before spend", () => {
    expect(() =>
      createEngine({
        protocol: "sequential",
        tier: "fast",
        model: validModelProvider,
        budget: {
          maxUsd: 0,
          maxTokens: 0,
          maxIterations: 0,
          timeoutMs: 0,
          qualityWeight: 0
        }
      })
    ).not.toThrow();
  });
});

function optionsWith(overrides: Record<string, unknown>): DogpileOptions {
  return {
    ...validDogpileOptions,
    ...overrides
  } as unknown as DogpileOptions;
}

function runtimeToolWith(overrides: Record<string, unknown>): RuntimeTool<JsonObject, JsonValue> {
  return {
    identity: runtimeToolIdentity,
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
    execute(input: Readonly<JsonObject>, context: RuntimeToolExecutionContext) {
      return {
        type: "success",
        toolCallId: context.toolCallId,
        tool: runtimeToolIdentity,
        output: input
      };
    },
    ...overrides
  } as RuntimeTool<JsonObject, JsonValue>;
}

function providerWith(overrides: Record<string, unknown>): ConfiguredModelProvider {
  return {
    id: "valid-provider",
    async generate(): Promise<ModelResponse> {
      return { text: "ok" };
    },
    ...overrides
  } as ConfiguredModelProvider;
}

function expectInvalidConfiguration(operation: () => unknown, path: string): void {
  let thrown: unknown;

  try {
    operation();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(DogpileError);
  expect(DogpileError.isInstance(thrown)).toBe(true);
  if (!DogpileError.isInstance(thrown)) {
    throw new Error("expected DogpileError");
  }

  expect(thrown.code).toBe("invalid-configuration");
  expect(thrown.retryable).toBe(false);
  expect(thrown.detail).toMatchObject({
    kind: "configuration-validation",
    path
  });
}
