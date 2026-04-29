import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { createEngine, createRuntimeToolExecutor, DogpileError, run, stream } from "../index.js";
import { createVercelAIProvider } from "../internal/vercel-ai.js";
import type {
  ConfiguredModelProvider,
  DogpileOptions,
  JsonObject,
  JsonValue,
  ModelResponse,
  RuntimeTool,
  RuntimeToolExecutionContext,
  RuntimeToolValidationResult
} from "../index.js";

const runtimeToolIdentity = {
  id: "fixture.lookup",
  name: "lookup"
} as const;

const validModelProvider: ConfiguredModelProvider = {
  id: "registration-contract-model",
  async generate(): Promise<ModelResponse> {
    return { text: "ok" };
  }
};

const validDogpileOptions: DogpileOptions = {
  intent: "Validate registration error contracts.",
  protocol: { kind: "sequential", maxTurns: 1 },
  tier: "fast",
  model: validModelProvider,
  agents: [{ id: "validator", role: "tester" }]
};

describe("registration error contract", () => {
  it.each([
    {
      name: "run() model provider without generate",
      operation: () =>
        run({
          ...validDogpileOptions,
          model: { id: "missing-generate" } as ConfiguredModelProvider
        }),
      path: "model.generate"
    },
    {
      name: "stream() model provider with blank id",
      operation: () =>
        stream({
          ...validDogpileOptions,
          model: modelProviderWith({ id: " " })
        }),
      path: "model.id"
    },
    {
      name: "createEngine() model provider with invalid stream",
      operation: () =>
        createEngine({
          protocol: { kind: "sequential", maxTurns: 1 },
          tier: "fast",
          model: modelProviderWith({ stream: "not-callable" })
        }),
      path: "model.stream"
    },
    {
      name: "createVercelAIProvider() language model with blank provider",
      operation: () =>
        createVercelAIProvider({
          model: vercelLanguageModelWith({ provider: "" })
        }),
      path: "model.provider"
    }
  ])("throws DogpileError invalid-configuration for invalid provider registration: $name", ({ operation, path }) => {
    expectInvalidConfiguration(operation, path);
  });

  it.each([
    {
      name: "runtime tool without execute",
      tools: [
        {
          identity: runtimeToolIdentity,
          inputSchema: { kind: "json-schema", schema: {} }
        }
      ],
      path: "tools[0].execute"
    },
    {
      name: "runtime tool with blank identity",
      tools: [runtimeToolWith({ identity: { id: "", name: "lookup" } })],
      path: "tools[0].identity.id"
    },
    {
      name: "runtime tool with non-callable validateInput",
      tools: [runtimeToolWith({ validateInput: "not-callable" })],
      path: "tools[0].validateInput"
    }
  ])("throws DogpileError invalid-configuration for invalid tool registration: $name", ({ tools, path }) => {
    expectInvalidConfiguration(
      () =>
        createRuntimeToolExecutor({
          runId: "run-invalid-registration-contract",
          protocol: "sequential",
          tier: "fast",
          tools: tools as unknown as readonly RuntimeTool<JsonObject, JsonValue>[]
        }),
      path
    );
  });

  it("preserves valid tool validateInput behavior through registration", async () => {
    const validationInputs: JsonObject[] = [];
    let executions = 0;
    const validateInput = (input: Readonly<JsonObject>): RuntimeToolValidationResult => {
      validationInputs.push({ ...input });

      return input.query === "ship"
        ? { type: "valid" }
        : {
            type: "invalid",
            issues: [
              {
                code: "invalid-value",
                path: "query",
                message: "query must equal ship."
              }
            ]
          };
    };
    const tool = runtimeToolWith({
      validateInput,
      execute(input: Readonly<JsonObject>, context: RuntimeToolExecutionContext) {
        executions += 1;

        return {
          type: "success",
          toolCallId: context.toolCallId,
          tool: runtimeToolIdentity,
          output: {
            accepted: input.query
          }
        };
      }
    });

    const executor = createRuntimeToolExecutor({
      runId: "run-valid-registration-contract",
      protocol: "sequential",
      tier: "fast",
      tools: [tool]
    });

    expect(executor.tools[0]?.validateInput).toBe(validateInput);
    await expect(executor.execute({ toolId: "fixture.lookup", input: { query: "hold" } })).resolves.toMatchObject({
      type: "error",
      error: {
        code: "invalid-input",
        detail: {
          issues: [
            {
              code: "invalid-value",
              path: "query",
              message: "query must equal ship."
            }
          ]
        }
      }
    });
    expect(executions).toBe(0);

    await expect(executor.execute({ toolId: "fixture.lookup", input: { query: "ship" } })).resolves.toMatchObject({
      type: "success",
      output: {
        accepted: "ship"
      }
    });
    expect(validationInputs).toEqual([{ query: "hold" }, { query: "ship" }]);
    expect(executions).toBe(1);
  });
});

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

function modelProviderWith(overrides: Record<string, unknown>): ConfiguredModelProvider {
  return {
    ...validModelProvider,
    ...overrides
  } as ConfiguredModelProvider;
}

function vercelLanguageModelWith(overrides: Record<string, unknown>): LanguageModel {
  return {
    specificationVersion: "v3",
    provider: "fixture",
    modelId: "fixture-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("doGenerate should not be called during registration validation.");
    },
    async doStream() {
      throw new Error("doStream should not be called during registration validation.");
    },
    ...overrides
  } as unknown as LanguageModel;
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
