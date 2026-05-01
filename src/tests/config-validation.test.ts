import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { createEngine, createRuntimeToolExecutor, Dogpile, DogpileError, run, stream } from "../index.js";
import { createVercelAIProvider } from "../internal/vercel-ai.js";
import { assertDepthWithinLimit } from "../runtime/decisions.js";
import type {
  ConfiguredModelProvider,
  DogpileOptions,
  EngineOptions,
  JsonObject,
  JsonValue,
  ModelRequest,
  ModelResponse,
  RunCallOptions,
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
    name: "invalid locality string on user-implemented model provider",
    options: optionsWith({
      model: {
        id: "invalid-locality-model",
        async generate(): Promise<ModelResponse> {
          return { text: "ok" };
        },
        metadata: { locality: "BOGUS" as "local" }
      }
    }),
    path: "model.metadata.locality"
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
    name: "maxConcurrentChildren zero",
    options: optionsWith({ maxConcurrentChildren: 0 }),
    path: "maxConcurrentChildren"
  },
  {
    name: "maxConcurrentChildren negative",
    options: optionsWith({ maxConcurrentChildren: -1 }),
    path: "maxConcurrentChildren"
  },
  {
    name: "maxConcurrentChildren non-integer",
    options: optionsWith({ maxConcurrentChildren: 1.5 }),
    path: "maxConcurrentChildren"
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

  it("validates provider metadata.locality when a reusable engine run starts", () => {
    const engine = createEngine({
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: {
        id: "engine-invalid-locality-model",
        async generate(): Promise<ModelResponse> {
          return { text: "ok" };
        },
        metadata: { locality: "BOGUS" as "local" }
      },
      agents: [{ id: "validator", role: "tester" }]
    });

    expectInvalidConfiguration(() => engine.run("validate locality"), "model.metadata.locality");
  });

  it("validates provider metadata.locality before Dogpile.pile starts protocol execution", () => {
    expectInvalidConfiguration(
      () =>
        Dogpile.pile({
          ...validDogpileOptions,
          model: {
            id: "pile-invalid-locality-model",
            async generate(): Promise<ModelResponse> {
              return { text: "ok" };
            },
            metadata: { locality: "BOGUS" as "local" }
          }
        }),
      "model.metadata.locality"
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

describe("maxDepth option", () => {
  it("rejects negative maxDepth on createEngine with invalid-configuration at path maxDepth", () => {
    expectInvalidConfiguration(
      () =>
        createEngine({
          ...validDogpileOptions,
          maxDepth: -1
        } as EngineOptions),
      "maxDepth"
    );
  });

  it("rejects non-integer maxDepth", () => {
    expectInvalidConfiguration(
      () =>
        createEngine({
          ...validDogpileOptions,
          maxDepth: 1.5
        } as EngineOptions),
      "maxDepth"
    );
  });

  it("rejects non-number maxDepth", () => {
    expectInvalidConfiguration(
      () =>
        createEngine({
          ...validDogpileOptions,
          maxDepth: "4" as unknown as number
        } as EngineOptions),
      "maxDepth"
    );
  });

  it("rejects negative maxDepth on Dogpile.run at the high-level surface", () => {
    expectInvalidConfiguration(
      () =>
        run({
          ...validDogpileOptions,
          maxDepth: -1
        }),
      "maxDepth"
    );
  });

  it("uses engine value when per-run maxDepth lowers the ceiling (engine 4, run 2 -> effective 2)", async () => {
    const provider = createDelegateChainProvider("lower-ok-model");
    const engine = createEngine({
      ...validDogpileOptions,
      tier: "fast",
      protocol: { kind: "coordinator", maxTurns: 2 },
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ],
      maxDepth: 4
    });

    // Per-run lowers to 2 — second-level dispatch must throw at depth 2 -> 3.
    await expect(engine.run("Run a chain.", { maxDepth: 2 })).rejects.toMatchObject({
      code: "invalid-configuration",
      detail: { kind: "delegate-validation", reason: "depth-overflow", maxDepth: 2 }
    });
  });

  it("clamps per-run maxDepth that tries to raise the engine ceiling (engine 2, run 5 -> effective 2)", async () => {
    const provider = createDelegateChainProvider("raise-clamped-model");
    const engine = createEngine({
      ...validDogpileOptions,
      tier: "fast",
      protocol: { kind: "coordinator", maxTurns: 2 },
      model: provider,
      agents: [
        { id: "lead", role: "coordinator" },
        { id: "worker-a", role: "worker" }
      ],
      maxDepth: 2
    });

    // Per-run claims 5, but engine ceiling 2 wins — overflow at depth 2 -> 3.
    await expect(engine.run("Run a chain.", { maxDepth: 5 })).rejects.toMatchObject({
      code: "invalid-configuration",
      detail: { kind: "delegate-validation", reason: "depth-overflow", maxDepth: 2 }
    });
  });

  it("end-to-end depth 1 throws when coordinator at depth 1 tries to delegate again", async () => {
    const provider = createDelegateChainProvider("end-to-end-depth-1-model");

    await expect(
      run({
        ...validDogpileOptions,
        intent: "Recurse once.",
        protocol: { kind: "coordinator", maxTurns: 2 },
        model: provider,
        agents: [
          { id: "lead", role: "coordinator" },
          { id: "worker-a", role: "worker" }
        ],
        maxDepth: 1
      })
    ).rejects.toMatchObject({
      code: "invalid-configuration",
      detail: {
        kind: "delegate-validation",
        path: "decision.protocol",
        reason: "depth-overflow",
        currentDepth: 1,
        maxDepth: 1
      }
    });
  });

  it("default maxDepth = 4: 4 nested coordinator delegates succeed; the 5th throws", async () => {
    const provider = createDelegateChainProvider("default-depth-4-model");

    await expect(
      run({
        ...validDogpileOptions,
        intent: "Recurse to the default cap.",
        protocol: { kind: "coordinator", maxTurns: 2 },
        model: provider,
        agents: [
          { id: "lead", role: "coordinator" },
          { id: "worker-a", role: "worker" }
        ]
        // no maxDepth — should default to 4
      })
    ).rejects.toMatchObject({
      code: "invalid-configuration",
      detail: {
        kind: "delegate-validation",
        reason: "depth-overflow",
        currentDepth: 4,
        maxDepth: 4
      }
    });
  });

  // Behavioral dual-gate test (D-14 TOCTOU defense). Drives the extracted
  // assertDepthWithinLimit helper directly so a regression in the dispatcher
  // call site (or the parser call site) is detected by this test rather than
  // by `grep`.
  it("assertDepthWithinLimit throws depth-overflow when currentDepth + 1 > maxDepth", () => {
    let thrown: unknown;
    try {
      assertDepthWithinLimit(2, 2);
    } catch (error) {
      thrown = error;
    }
    expect(DogpileError.isInstance(thrown)).toBe(true);
    if (!DogpileError.isInstance(thrown)) throw new Error("expected DogpileError");
    expect(thrown.code).toBe("invalid-configuration");
    expect(thrown.detail).toMatchObject({
      kind: "delegate-validation",
      path: "decision.protocol",
      reason: "depth-overflow",
      currentDepth: 2,
      maxDepth: 2
    });
  });

  it("assertDepthWithinLimit accepts currentDepth + 1 <= maxDepth (boundary)", () => {
    expect(() => assertDepthWithinLimit(0, 1)).not.toThrow();
    expect(() => assertDepthWithinLimit(3, 4)).not.toThrow();
  });
});

describe("maxConcurrentChildren option", () => {
  it("rejects zero maxConcurrentChildren on createEngine with invalid-configuration at path maxConcurrentChildren", () => {
    expectInvalidConfiguration(
      () =>
        createEngine({
          ...validEngineOptions(),
          maxConcurrentChildren: 0
        }),
      "maxConcurrentChildren"
    );
  });

  it("rejects negative maxConcurrentChildren on createEngine", () => {
    expectInvalidConfiguration(
      () =>
        createEngine({
          ...validEngineOptions(),
          maxConcurrentChildren: -1
        }),
      "maxConcurrentChildren"
    );
  });

  it("rejects non-integer maxConcurrentChildren on createEngine", () => {
    expectInvalidConfiguration(
      () =>
        createEngine({
          ...validEngineOptions(),
          maxConcurrentChildren: 1.5
        }),
      "maxConcurrentChildren"
    );
  });

  it("rejects per-run maxConcurrentChildren that raises the engine ceiling", () => {
    const engine = createEngine({
      ...validEngineOptions(),
      protocol: { kind: "sequential", maxTurns: 1 },
      maxConcurrentChildren: 2
    });

    expectInvalidConfiguration(
      () => engine.run("Validate bounded children.", { maxConcurrentChildren: 5 }),
      "maxConcurrentChildren"
    );
  });

  it("accepts per-run maxConcurrentChildren that lowers the engine ceiling", async () => {
    const engine = createEngine({
      ...validEngineOptions(),
      protocol: { kind: "sequential", maxTurns: 1 },
      maxConcurrentChildren: 4
    });

    await expect(engine.run("Validate bounded children.", { maxConcurrentChildren: 2 })).resolves.toMatchObject({
      output: expect.any(String)
    });
  });
});

describe("onChildFailure option", () => {
  it("accepts continue and abort on createEngine", () => {
    expect(() =>
      createEngine({
        ...validEngineOptions(),
        onChildFailure: "continue"
      })
    ).not.toThrow();
    expect(() =>
      createEngine({
        ...validEngineOptions(),
        onChildFailure: "abort"
      })
    ).not.toThrow();
  });

  it("rejects invalid onChildFailure on createEngine with invalid-configuration", () => {
    expectInvalidConfiguration(
      () =>
        createEngine({
          ...validEngineOptions(),
          onChildFailure: "explode" as "continue"
        }),
      "onChildFailure"
    );
  });

  it("rejects invalid per-run onChildFailure with invalid-configuration", () => {
    const engine = createEngine(validEngineOptions());
    expectInvalidConfiguration(
      () => engine.run("Validate child failure mode.", { onChildFailure: "explode" as "continue" }),
      "options.onChildFailure"
    );
  });

  it("resolves onChildFailure with per-run overriding engine overriding default", async () => {
    const engineAbort = createEngine({
      ...validEngineOptions(),
      protocol: { kind: "sequential", maxTurns: 1 },
      onChildFailure: "abort"
    });
    const engineDefault = createEngine({
      ...validEngineOptions(),
      protocol: { kind: "sequential", maxTurns: 1 }
    });

    await expect(engineAbort.run("Run with per-run continue.", { onChildFailure: "continue" })).resolves.toMatchObject({
      output: expect.any(String)
    });
    await expect(engineAbort.run("Run with engine abort.")).resolves.toMatchObject({
      output: expect.any(String)
    });
    await expect(engineDefault.run("Run with default continue.")).resolves.toMatchObject({
      output: expect.any(String)
    });
  });

  it("locks onChildFailure as a public engine and per-run option", () => {
    const _engineOptionsLock: EngineOptions = {
      ...validEngineOptions(),
      onChildFailure: "abort"
    };
    const _runOptionsLock: RunCallOptions = {
      onChildFailure: "continue"
    };
    expect(_engineOptionsLock.onChildFailure).toBe("abort");
    expect(_runOptionsLock.onChildFailure).toBe("continue");
  });
});

describe("BUDGET-02 defaultSubRunTimeoutMs validation + public-surface lock", () => {
  it.each([
    { name: "negative", value: -1 },
    { name: "zero", value: 0 },
    { name: "NaN", value: Number.NaN },
    { name: "Infinity", value: Number.POSITIVE_INFINITY },
    { name: "non-number string", value: "1000" }
  ] as const)(
    "createEngine rejects defaultSubRunTimeoutMs=$name with invalid-configuration on path=defaultSubRunTimeoutMs",
    ({ value }) => {
      expectInvalidConfiguration(
        () =>
          createEngine({
            protocol: { kind: "sequential", maxTurns: 1 },
            tier: "fast",
            model: validModelProvider,
            defaultSubRunTimeoutMs: value as number
          } as unknown as EngineOptions),
        "defaultSubRunTimeoutMs"
      );
    }
  );

  it.each([
    { name: "negative", value: -1 },
    { name: "zero", value: 0 },
    { name: "NaN", value: Number.NaN }
  ] as const)(
    "run() rejects defaultSubRunTimeoutMs=$name before any provider call: $name",
    ({ value }) => {
      expectInvalidConfiguration(
        () =>
          run({
            ...validDogpileOptions,
            defaultSubRunTimeoutMs: value as number
          } as DogpileOptions),
        "defaultSubRunTimeoutMs"
      );
    }
  );

  it("createEngine accepts a valid positive finite defaultSubRunTimeoutMs", () => {
    expect(() =>
      createEngine({
        protocol: { kind: "sequential", maxTurns: 1 },
        tier: "fast",
        model: validModelProvider,
        defaultSubRunTimeoutMs: 1000
      })
    ).not.toThrow();
  });

  // BLOCKER 2 unambiguous typed-field lock: if `defaultSubRunTimeoutMs` is
  // removed from the public `EngineOptions` type re-exported through
  // src/index.ts, this file fails compile (typecheck exits non-zero).
  // Note (deviation from plan): the plan example included `intent` on the
  // lock object, but `intent` lives on `DogpileOptions`, NOT `EngineOptions`.
  // Dropped it here as an inline correction.
  it("locks defaultSubRunTimeoutMs as a public field on the engine-options type union", () => {
    const _engineOptionsLock: EngineOptions = {
      protocol: { kind: "sequential", maxTurns: 1 },
      tier: "fast",
      model: { id: "lock", generate: async () => ({ text: "" }) },
      defaultSubRunTimeoutMs: 1000
    };
    void _engineOptionsLock;
    expect(_engineOptionsLock.defaultSubRunTimeoutMs).toBe(1000);
  });
});

/**
 * Coordinator provider that always returns a delegate-to-coordinator decision
 * on the plan turn, producing a chain of nested sub-runs until the depth gate
 * trips. Worker and final-synthesis turns return safe text.
 */
function createDelegateChainProvider(id: string): ConfiguredModelProvider {
  return {
    id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const phase = String(request.metadata.phase);
      if (phase === "plan") {
        return {
          text: [
            "delegate:",
            "```json",
            JSON.stringify({ protocol: "coordinator", intent: "go deeper" }),
            "```",
            ""
          ].join("\n"),
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          costUsd: 0
        };
      }
      return {
        text: phase === "worker" ? "worker output" : "final output",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        costUsd: 0
      };
    }
  };
}

function optionsWith(overrides: Record<string, unknown>): DogpileOptions {
  return {
    ...validDogpileOptions,
    ...overrides
  } as unknown as DogpileOptions;
}

function validEngineOptions(): EngineOptions {
  return {
    protocol: { kind: "sequential", maxTurns: 1 },
    tier: "fast",
    model: validModelProvider,
    agents: [{ id: "validator", role: "tester" }]
  };
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
