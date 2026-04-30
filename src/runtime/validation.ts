import { DogpileError } from "../types.js";
import type {
  AgentSpec,
  BudgetCaps,
  BudgetTier,
  ConfiguredModelProvider,
  DogpileOptions,
  EngineOptions,
  JsonObject,
  JsonValue,
  ProtocolConfig,
  ProtocolName,
  ProtocolSelection,
  RuntimeTool,
  TerminationCondition
} from "../types.js";

const protocolNames = ["coordinator", "sequential", "broadcast", "shared"] as const;
const budgetTiers = ["fast", "balanced", "quality"] as const;

type ValidationRule =
  | "required"
  | "non-empty-string"
  | "finite-number"
  | "non-negative-number"
  | "positive-integer"
  | "non-negative-integer"
  | "range"
  | "enum"
  | "object"
  | "array"
  | "boolean"
  | "function"
  | "json-object"
  | "abort-signal"
  | "model-provider"
  | "runtime-tool"
  | "termination-condition";

interface ValidationFailureOptions {
  readonly path: string;
  readonly rule: ValidationRule;
  readonly message: string;
  readonly expected: string;
  readonly actual: unknown;
}

/**
 * Validate high-level caller options before any protocol execution starts.
 */
export function validateDogpileOptions(options: DogpileOptions): void {
  requireRecord(options, "options");
  validateMissionIntent(options.intent);

  if (options.protocol !== undefined) {
    validateProtocolSelection(options.protocol, "protocol");
  }
  if (options.tier !== undefined) {
    validateBudgetTier(options.tier, "tier");
  }

  validateModelProviderRegistration(options.model, "model");
  validateOptionalAgents(options.agents, "agents");
  validateOptionalRuntimeTools(options.tools, "tools");
  validateOptionalTemperature(options.temperature, "temperature");
  validateOptionalBudgetCaps(options.budget, "budget");
  validateOptionalTerminationCondition(options.terminate, "terminate");
  validateOptionalWrapUpHint(options.wrapUpHint, "wrapUpHint");
  validateOptionalFunction(options.evaluate, "evaluate");
  validateOptionalSeed(options.seed, "seed");
  validateOptionalAbortSignal(options.signal, "signal");
  validateOptionalNonNegativeInteger(options.maxDepth, "maxDepth");
}

export function validateMissionIntent(intent: unknown, path = "intent"): void {
  validateNonEmptyString(intent, path, "intent is required.");
}

/**
 * Validate per-call run/stream options (`Engine.run(intent, options)` / `Engine.stream(...)`).
 */
export function validateRunCallOptions(options: unknown, path = "options"): void {
  if (options === undefined) {
    return;
  }
  const record = requireRecord(options, path);
  validateOptionalNonNegativeInteger(record.maxDepth, `${path}.maxDepth`);
}

/**
 * Validate low-level engine configuration before normalizing reusable controls.
 */
export function validateEngineOptions(options: EngineOptions): void {
  requireRecord(options, "options");
  validateProtocolSelection(options.protocol, "protocol");
  validateBudgetTier(options.tier, "tier");
  validateModelProviderRegistration(options.model, "model");
  validateOptionalAgents(options.agents, "agents");
  validateOptionalRuntimeTools(options.tools, "tools");
  validateOptionalTemperature(options.temperature, "temperature");
  validateOptionalBudgetCaps(options.budget, "budget");
  validateOptionalTerminationCondition(options.terminate, "terminate");
  validateOptionalWrapUpHint(options.wrapUpHint, "wrapUpHint");
  validateOptionalFunction(options.evaluate, "evaluate");
  validateOptionalSeed(options.seed, "seed");
  validateOptionalAbortSignal(options.signal, "signal");
  validateOptionalNonNegativeInteger(options.maxDepth, "maxDepth");
}

/**
 * Validate Vercel AI adapter factory options at construction time.
 */
export function validateVercelAIProviderOptions(options: unknown): void {
  const record = requireRecord(options, "options");

  if (record.model === undefined) {
    invalidConfiguration({
      path: "model",
      rule: "required",
      message: "model is required.",
      expected: "a Vercel AI language model",
      actual: record.model
    });
  }
  if (typeof record.model === "string") {
    validateNonEmptyString(record.model, "model", "model must not be empty.");
  } else {
    validateVercelAILanguageModel(record.model, "model");
  }

  validateOptionalNonEmptyString(record.id, "id");
  validateOptionalBoolean(record.streaming, "streaming");
  validateOptionalFunction(record.generateText, "generateText");
  validateOptionalFunction(record.streamText, "streamText");
  validateOptionalFunction(record.costEstimator, "costEstimator");
  validateOptionalPositiveInteger(record.maxOutputTokens, "maxOutputTokens");
  validateOptionalNumberInRange(record.topP, "topP", 0, 1);
  validateOptionalPositiveInteger(record.topK, "topK");
  validateOptionalNumberInRange(record.presencePenalty, "presencePenalty", -2, 2);
  validateOptionalNumberInRange(record.frequencyPenalty, "frequencyPenalty", -2, 2);
  validateOptionalStringArray(record.stopSequences, "stopSequences");
  validateOptionalInteger(record.seed, "seed");
  validateOptionalNonNegativeInteger(record.maxRetries, "maxRetries");
  validateOptionalAbortSignal(record.abortSignal, "abortSignal");
  validateOptionalHeaders(record.headers, "headers");
  validateOptionalProviderOptions(record.providerOptions, "providerOptions");
  validateOptionalArray(record.activeTools, "activeTools");
  validateOptionalFunction(record.runtimeToolIdForName, "runtimeToolIdForName");
}

function validateProtocolSelection(value: ProtocolSelection, path: string): void {
  if (typeof value === "string") {
    if (!isProtocolName(value)) {
      invalidConfiguration({
        path,
        rule: "enum",
        message: "protocol must be one of coordinator, sequential, broadcast, or shared.",
        expected: protocolNames.join(" | "),
        actual: value
      });
    }
    return;
  }

  validateProtocolConfig(value, path);
}

function validateProtocolConfig(value: ProtocolConfig, path: string): void {
  const record = requireRecord(value, path);
  const kind = record.kind;

  if (!isProtocolName(kind)) {
    invalidConfiguration({
      path: `${path}.kind`,
      rule: "enum",
      message: "protocol config kind must be one of coordinator, sequential, broadcast, or shared.",
      expected: protocolNames.join(" | "),
      actual: kind
    });
  }

  switch (kind) {
    case "coordinator":
    case "sequential":
    case "shared":
      validateOptionalPositiveInteger(record.maxTurns, `${path}.maxTurns`);
      validateOptionalNonNegativeInteger(record.minTurns, `${path}.minTurns`);
      if (kind === "shared") {
        validateOptionalString(record.organizationalMemory, `${path}.organizationalMemory`);
      }
      return;
    case "broadcast":
      validateOptionalPositiveInteger(record.maxRounds, `${path}.maxRounds`);
      validateOptionalNonNegativeInteger(record.minRounds, `${path}.minRounds`);
      return;
  }
}

function validateBudgetTier(value: BudgetTier, path: string): void {
  if (!isBudgetTier(value)) {
    invalidConfiguration({
      path,
      rule: "enum",
      message: "tier must be one of fast, balanced, or quality.",
      expected: budgetTiers.join(" | "),
      actual: value
    });
  }
}

/**
 * Validate configured model provider definitions at registration boundaries.
 */
export function validateModelProviderRegistration(value: unknown, path = "model"): asserts value is ConfiguredModelProvider {
  const record = requireRecord(value, path);
  validateNonEmptyString(record.id, `${path}.id`, "model.id is required.");
  validateFunction(record.generate, `${path}.generate`);
  validateOptionalFunction(record.stream, `${path}.stream`);
}

function validateVercelAILanguageModel(value: unknown, path: string): void {
  const record = requireRecord(value, path);

  if (record.specificationVersion !== "v2" && record.specificationVersion !== "v3") {
    invalidConfiguration({
      path: `${path}.specificationVersion`,
      rule: "model-provider",
      message: "model.specificationVersion must be v2 or v3.",
      expected: "v2 | v3",
      actual: record.specificationVersion
    });
  }

  validateNonEmptyString(record.provider, `${path}.provider`, "model.provider is required.");
  validateNonEmptyString(record.modelId, `${path}.modelId`, "model.modelId is required.");
  validateFunction(record.doGenerate, `${path}.doGenerate`);
  validateFunction(record.doStream, `${path}.doStream`);
}

function validateOptionalAgents(value: readonly AgentSpec[] | undefined, path: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    invalidConfiguration({
      path,
      rule: "array",
      message: "agents must be an array when provided.",
      expected: "readonly AgentSpec[]",
      actual: value
    });
  }
  if (value.length === 0) {
    invalidConfiguration({
      path,
      rule: "array",
      message: "agents must contain at least one participant when provided.",
      expected: "non-empty readonly AgentSpec[]",
      actual: value
    });
  }

  value.forEach((agent, index) => {
    const agentPath = `${path}[${index}]`;
    const record = requireRecord(agent, agentPath);
    validateNonEmptyString(record.id, `${agentPath}.id`, "agent.id is required.");
    validateNonEmptyString(record.role, `${agentPath}.role`, "agent.role is required.");
    validateOptionalString(record.instructions, `${agentPath}.instructions`);
  });
}

function validateOptionalRuntimeTools(value: readonly RuntimeTool<JsonObject, JsonValue>[] | undefined, path: string): void {
  if (value === undefined) {
    return;
  }

  validateRuntimeToolRegistrations(value, path);
}

/**
 * Validate runtime tool definitions at registration boundaries.
 */
export function validateRuntimeToolRegistrations(value: unknown, path = "tools"): void {
  if (!Array.isArray(value)) {
    invalidConfiguration({
      path,
      rule: "array",
      message: "tools must be an array when provided.",
      expected: "readonly RuntimeTool[]",
      actual: value
    });
  }

  value.forEach((tool, index) => validateRuntimeTool(tool, `${path}[${index}]`));
}

function validateRuntimeTool(value: RuntimeTool<JsonObject, JsonValue>, path: string): void {
  const record = requireRecord(value, path);
  const identity = requireRecord(record.identity, `${path}.identity`);
  validateNonEmptyString(identity.id, `${path}.identity.id`, "tool identity id is required.");
  validateNonEmptyString(identity.name, `${path}.identity.name`, "tool identity name is required.");
  validateOptionalString(identity.namespace, `${path}.identity.namespace`);
  validateOptionalString(identity.version, `${path}.identity.version`);
  validateOptionalString(identity.description, `${path}.identity.description`);

  const inputSchema = requireRecord(record.inputSchema, `${path}.inputSchema`);
  if (inputSchema.kind !== "json-schema") {
    invalidConfiguration({
      path: `${path}.inputSchema.kind`,
      rule: "runtime-tool",
      message: "tool inputSchema.kind must be json-schema.",
      expected: "json-schema",
      actual: inputSchema.kind
    });
  }
  validateJsonObject(inputSchema.schema, `${path}.inputSchema.schema`);
  validateOptionalString(inputSchema.description, `${path}.inputSchema.description`);
  validateOptionalArray(record.permissions, `${path}.permissions`);
  validateOptionalFunction(record.validateInput, `${path}.validateInput`);
  validateFunction(record.execute, `${path}.execute`);
}

function validateOptionalBudgetCaps(value: BudgetCaps | undefined, path: string): void {
  if (value === undefined) {
    return;
  }

  validateBudgetCaps(value, path);
}

function validateBudgetCaps(value: BudgetCaps, path: string): void {
  const record = requireRecord(value, path);
  validateOptionalNonNegativeNumber(record.maxUsd, `${path}.maxUsd`);
  validateOptionalNonNegativeInteger(record.maxTokens, `${path}.maxTokens`);
  validateOptionalNonNegativeInteger(record.maxIterations, `${path}.maxIterations`);
  validateOptionalNonNegativeInteger(record.timeoutMs, `${path}.timeoutMs`);
  validateOptionalNumberInRange(record.qualityWeight, `${path}.qualityWeight`, 0, 1);
}

function validateOptionalTerminationCondition(value: TerminationCondition | undefined, path: string): void {
  if (value === undefined) {
    return;
  }

  validateTerminationCondition(value, path, new Set<object>());
}

function validateTerminationCondition(value: TerminationCondition, path: string, stack: Set<object>): void {
  const record = requireRecord(value, path);
  if (stack.has(record)) {
    invalidConfiguration({
      path,
      rule: "termination-condition",
      message: "termination conditions must not contain cycles.",
      expected: "acyclic termination condition",
      actual: value
    });
  }

  stack.add(record);
  try {
    switch (record.kind) {
      case "budget":
        validateBudgetCaps(record, path);
        return;
      case "convergence":
        validatePositiveInteger(record.stableTurns, `${path}.stableTurns`);
        validateNumberInRange(record.minSimilarity, `${path}.minSimilarity`, 0, 1);
        return;
      case "judge":
        validateJudgeRubric(record.rubric, `${path}.rubric`);
        validateOptionalNumberInRange(record.minScore, `${path}.minScore`, 0, 1);
        return;
      case "firstOf":
        validateFirstOfConditions(record.conditions, `${path}.conditions`, stack);
        return;
      default:
        invalidConfiguration({
          path: `${path}.kind`,
          rule: "termination-condition",
          message: "termination condition kind must be budget, convergence, judge, or firstOf.",
          expected: "budget | convergence | judge | firstOf",
          actual: record.kind
        });
    }
  } finally {
    stack.delete(record);
  }
}

function validateFirstOfConditions(value: unknown, path: string, stack: Set<object>): void {
  if (!Array.isArray(value)) {
    invalidConfiguration({
      path,
      rule: "array",
      message: "firstOf conditions must be a non-empty array.",
      expected: "non-empty termination condition array",
      actual: value
    });
  }
  if (value.length === 0) {
    invalidConfiguration({
      path,
      rule: "array",
      message: "firstOf conditions must contain at least one condition.",
      expected: "non-empty termination condition array",
      actual: value
    });
  }

  value.forEach((condition, index) => {
    validateTerminationCondition(condition as TerminationCondition, `${path}[${index}]`, stack);
  });
}

function validateJudgeRubric(value: unknown, path: string): void {
  if (typeof value === "string") {
    validateNonEmptyString(value, path, "judge rubric must not be empty.");
    return;
  }

  validateJsonObject(value, path);
}

function validateOptionalTemperature(value: number | undefined, path: string): void {
  validateOptionalNumberInRange(value, path, 0, 2);
}

function validateOptionalWrapUpHint(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }

  const record = requireRecord(value, path);
  validateOptionalNonNegativeInteger(record.atIteration, `${path}.atIteration`);
  validateOptionalNumberInRange(record.atFraction, `${path}.atFraction`, 0, 1);
  validateOptionalFunction(record.inject, `${path}.inject`);

  if (record.atIteration === undefined && record.atFraction === undefined) {
    invalidConfiguration({
      path,
      rule: "object",
      message: "wrapUpHint must configure atIteration or atFraction.",
      expected: "WrapUpHintConfig with atIteration or atFraction",
      actual: value
    });
  }
}

function validateOptionalSeed(value: string | number | undefined, path: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value === "string") {
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return;
  }

  invalidConfiguration({
    path,
    rule: "finite-number",
    message: "seed must be a string or finite number when provided.",
    expected: "string or finite number",
    actual: value
  });
}

function validateOptionalHeaders(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }

  const record = requireRecord(value, path);
  for (const [key, headerValue] of Object.entries(record)) {
    if (headerValue !== undefined && typeof headerValue !== "string") {
      invalidConfiguration({
        path: `${path}.${key}`,
        rule: "non-empty-string",
        message: "headers values must be strings or undefined.",
        expected: "string | undefined",
        actual: headerValue
      });
    }
  }
}

function validateOptionalProviderOptions(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }

  const record = requireRecord(value, path);
  for (const [key, providerOptions] of Object.entries(record)) {
    validateJsonObject(providerOptions, `${path}.${key}`);
  }
}

function validateJsonObject(value: unknown, path: string): void {
  if (!isJsonValue(value, new Set<object>()) || !isRecord(value)) {
    invalidConfiguration({
      path,
      rule: "json-object",
      message: "value must be a JSON-compatible object.",
      expected: "JSON-compatible object",
      actual: value
    });
  }
}

function isJsonValue(value: unknown, stack: Set<object>): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    if (stack.has(value)) {
      return false;
    }
    stack.add(value);
    const valid = value.every((child) => isJsonValue(child, stack));
    stack.delete(value);
    return valid;
  }
  if (isRecord(value)) {
    if (stack.has(value)) {
      return false;
    }
    stack.add(value);
    const valid = Object.values(value).every((child) => isJsonValue(child, stack));
    stack.delete(value);
    return valid;
  }

  return false;
}

function validateOptionalString(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string") {
    invalidConfiguration({
      path,
      rule: "non-empty-string",
      message: "value must be a string when provided.",
      expected: "string",
      actual: value
    });
  }
}

function validateOptionalNonEmptyString(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  validateNonEmptyString(value, path, `${path} must not be empty.`);
}

function validateNonEmptyString(value: unknown, path: string, message: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalidConfiguration({
      path,
      rule: "non-empty-string",
      message,
      expected: "non-empty string",
      actual: value
    });
  }
}

function validateOptionalBoolean(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "boolean") {
    invalidConfiguration({
      path,
      rule: "boolean",
      message: "value must be a boolean when provided.",
      expected: "boolean",
      actual: value
    });
  }
}

function validateOptionalFunction(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  validateFunction(value, path);
}

function validateFunction(value: unknown, path: string): void {
  if (typeof value !== "function") {
    invalidConfiguration({
      path,
      rule: "function",
      message: "value must be a function.",
      expected: "function",
      actual: value
    });
  }
}

function validateOptionalArray(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    invalidConfiguration({
      path,
      rule: "array",
      message: "value must be an array when provided.",
      expected: "array",
      actual: value
    });
  }
}

function validateOptionalStringArray(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    invalidConfiguration({
      path,
      rule: "array",
      message: "value must be an array of strings when provided.",
      expected: "string[]",
      actual: value
    });
  }
  value.forEach((item, index) => validateNonEmptyString(item, `${path}[${index}]`, "array item must be a string."));
}

function validateOptionalAbortSignal(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (!isAbortSignalLike(value)) {
    invalidConfiguration({
      path,
      rule: "abort-signal",
      message: "value must be an AbortSignal when provided.",
      expected: "AbortSignal",
      actual: value
    });
  }
}

function isAbortSignalLike(value: unknown): value is AbortSignal {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.aborted === "boolean" &&
    typeof value.addEventListener === "function" &&
    typeof value.removeEventListener === "function"
  );
}

function validateOptionalInteger(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  validateInteger(value, path);
}

function validateInteger(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    invalidConfiguration({
      path,
      rule: "finite-number",
      message: "value must be a finite integer.",
      expected: "finite integer",
      actual: value
    });
  }
}

function validateOptionalPositiveInteger(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  validatePositiveInteger(value, path);
}

function validatePositiveInteger(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    invalidConfiguration({
      path,
      rule: "positive-integer",
      message: "value must be a positive integer.",
      expected: "integer >= 1",
      actual: value
    });
  }
}

function validateOptionalNonNegativeInteger(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    invalidConfiguration({
      path,
      rule: "non-negative-integer",
      message: "value must be a non-negative integer.",
      expected: "integer >= 0",
      actual: value
    });
  }
}

function validateOptionalNonNegativeNumber(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    invalidConfiguration({
      path,
      rule: "non-negative-number",
      message: "value must be a non-negative finite number.",
      expected: "finite number >= 0",
      actual: value
    });
  }
}

function validateOptionalNumberInRange(value: unknown, path: string, min: number, max: number): void {
  if (value === undefined) {
    return;
  }
  validateNumberInRange(value, path, min, max);
}

function validateNumberInRange(value: unknown, path: string, min: number, max: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    invalidConfiguration({
      path,
      rule: "range",
      message: `value must be a finite number in the inclusive range ${min}..${max}.`,
      expected: `finite number in ${min}..${max}`,
      actual: value
    });
  }
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    invalidConfiguration({
      path,
      rule: "object",
      message: "value must be an object.",
      expected: "object",
      actual: value
    });
  }

  return value;
}

function invalidConfiguration(options: ValidationFailureOptions): never {
  throw new DogpileError({
    code: "invalid-configuration",
    message: `Invalid Dogpile configuration at ${options.path}: ${options.message}`,
    retryable: false,
    detail: {
      kind: "configuration-validation",
      path: options.path,
      rule: options.rule,
      expected: options.expected,
      received: describeValue(options.actual)
    }
  });
}

function isProtocolName(value: unknown): value is ProtocolName {
  return typeof value === "string" && protocolNames.includes(value as ProtocolName);
}

function isBudgetTier(value: unknown): value is BudgetTier {
  return typeof value === "string" && budgetTiers.includes(value as BudgetTier);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return String(value);
  }
  return typeof value;
}
