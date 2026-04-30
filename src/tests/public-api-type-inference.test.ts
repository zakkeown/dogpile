import { describe, expect, it } from "vitest";
import {
  Dogpile,
  DogpileError,
  createEngine,
  createOpenAICompatibleProvider,
  replay,
  replayStream,
  run,
  stream
} from "../index.js";
import {
  benchmarkRunOptions,
  createProtocolBenchmarkRunConfig,
  runBenchmarkWithStreamingEventLog
} from "../internal.js";
import type {
  AgentSpec,
  AgentDecision,
  AgentParticipation,
  BroadcastProtocolConfig,
  ConfiguredModelProvider,
  CoordinationProtocolSelection,
  CoordinatorProtocolConfig,
  DogpileErrorCode,
  DogpileErrorOptions,
  DogpileOptions,
  Engine,
  EngineOptions,
  FinalEvent,
  JsonObject,
  JsonValue,
  ModelOutputChunk,
  ModelRequest,
  ModelResponse,
  Protocol,
  ProtocolConfig,
  ProtocolName,
  ProtocolSelection,
  RunEvent,
  RunEventLog,
  RunEvaluation,
  RunEvaluator,
  RunResult,
  RuntimeTool,
  RuntimeToolAdapterContract,
  RuntimeToolExecutionContext,
  RuntimeToolExecutionRequest,
  RuntimeToolExecutor,
  RuntimeToolResult,
  RuntimeToolSuccessResult,
  SequentialProtocolConfig,
  SharedProtocolConfig,
  StreamEvent,
  StreamEventSubscriber,
  StreamHandle,
  StreamHandleStatus,
  Tier,
  Trace,
  TranscriptEntry,
  OpenAICompatibleProviderCostContext,
  OpenAICompatibleProviderCostEstimator,
  OpenAICompatibleProviderOptions
} from "../index.js";
import type {
  BenchmarkCostAccounting,
  BenchmarkModelSettings,
  BenchmarkRunnerConfig,
  BenchmarkStreamingEventLog,
  ProtocolBenchmarkRunConfig
} from "../types.js";

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsEqual<Actual, Expected> =
  (<T>() => T extends Actual ? 1 : 2) extends <T>() => T extends Expected ? 1 : 2
    ? (<T>() => T extends Expected ? 1 : 2) extends <T>() => T extends Actual ? 1 : 2
      ? true
      : false
    : false;
type ExpectFalse<T extends false> = T;
type ExpectTrue<T extends true> = T;
type AwaitedReturn<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;
type ArrayElement<T> = T extends readonly (infer Element)[] ? Element : never;
type IsOptionalProperty<T, Key extends keyof T> = {} extends Pick<T, Key> ? true : false;

type RunOptionsParameter = Parameters<typeof run>[0];
type RunResolvedResult = AwaitedReturn<typeof run>;
type PileOptionsParameter = Parameters<typeof Dogpile.pile>[0];
type PileResolvedResult = AwaitedReturn<typeof Dogpile.pile>;
type StreamOptionsParameter = Parameters<typeof stream>[0];
type StreamReturn = ReturnType<typeof stream>;
type DogpileStreamOptionsParameter = Parameters<typeof Dogpile.stream>[0];
type DogpileStreamReturn = ReturnType<typeof Dogpile.stream>;
type CreateEngineOptionsParameter = Parameters<typeof createEngine>[0];
type CreateEngineReturn = ReturnType<typeof createEngine>;
type CreateOpenAICompatibleProviderParameter = Parameters<typeof createOpenAICompatibleProvider>[0];
type CreateOpenAICompatibleProviderReturn = ReturnType<typeof createOpenAICompatibleProvider>;
type EngineRunIntentParameter = Parameters<Engine["run"]>[0];
type EngineRunResolvedResult = Awaited<ReturnType<Engine["run"]>>;
type EngineStreamIntentParameter = Parameters<Engine["stream"]>[0];
type EngineStreamReturn = ReturnType<Engine["stream"]>;
type ReplayTraceParameter = Parameters<typeof replay>[0];
type ReplayReturn = ReturnType<typeof replay>;
type ReplayStreamTraceParameter = Parameters<typeof replayStream>[0];
type ReplayStreamReturn = ReturnType<typeof replayStream>;
type StreamSubscriberParameter = Parameters<StreamHandle["subscribe"]>[0];
type StreamCancelReturn = ReturnType<StreamHandle["cancel"]>;
type StreamStatus = StreamHandle["status"];
type StreamSubscriberEventParameter = Parameters<StreamEventSubscriber>[0];
type StreamIterableEvent = StreamHandle extends AsyncIterable<infer Event> ? Event : never;
type ResultEventLog = RunResult["eventLog"];
type ResultEvent = ArrayElement<RunResult["eventLog"]["events"]>;
type TraceEvent = ArrayElement<RunResult["trace"]["events"]>;
type TraceTranscriptEntry = ArrayElement<RunResult["trace"]["transcript"]>;
type ResultTranscriptEntry = ArrayElement<RunResult["transcript"]>;
type FinalEventTranscript = FinalEvent["transcript"];
type FinalTraceEvent = Extract<RunResult["trace"]["events"][number], { readonly type: "final" }>;
type AgentTurnTraceEvent = Extract<RunResult["trace"]["events"][number], { readonly type: "agent-turn" }>;
type AgentTurnDecision = NonNullable<AgentTurnTraceEvent["decision"]>;
type TranscriptDecision = NonNullable<TranscriptEntry["decision"]>;
type SharedOrganizationalMemory = SharedProtocolConfig["organizationalMemory"];
type ErrorStreamEvent = Extract<StreamEvent, { readonly type: "error" }>;
type DogpileErrorConstructorParameter = ConstructorParameters<typeof DogpileError>[0];
type DogpileErrorCodeProperty = DogpileError["code"];
type DogpileErrorInvalidConfigurationBranch = Extract<DogpileError, { readonly code: "invalid-configuration" }>;
type DogpileErrorAbortedBranch = Extract<DogpileError, { readonly code: "aborted" }>;
type DogpileErrorTimeoutBranch = Extract<DogpileError, { readonly code: "timeout" }>;
type DogpileErrorProviderRateLimitedBranch = Extract<DogpileError, { readonly code: "provider-rate-limited" }>;
type DogpileErrorUnknownBranch = Extract<DogpileError, { readonly code: "unknown" }>;
type ConfiguredProviderGenerateParameter = Parameters<ConfiguredModelProvider["generate"]>[0];
type ConfiguredProviderGenerateReturn = ReturnType<ConfiguredModelProvider["generate"]>;
type ConfiguredProviderGenerateResolved = Awaited<ConfiguredProviderGenerateReturn>;
type ConfiguredProviderStream = NonNullable<ConfiguredModelProvider["stream"]>;
type ConfiguredProviderStreamParameter = Parameters<ConfiguredProviderStream>[0];
type ConfiguredProviderStreamReturn = ReturnType<ConfiguredProviderStream>;
type ConfiguredProviderStreamChunk = ConfiguredProviderStreamReturn extends AsyncIterable<infer Chunk> ? Chunk : never;
type ModelRequestMessage = ArrayElement<ModelRequest["messages"]>;
type ModelRequestSignal = ModelRequest["signal"];
type ModelRequestMetadata = ModelRequest["metadata"];
type ModelResponseUsage = NonNullable<ModelResponse["usage"]>;
type ModelResponseMetadata = NonNullable<ModelResponse["metadata"]>;
type ModelOutputChunkUsage = NonNullable<ModelOutputChunk["usage"]>;
type ModelOutputChunkMetadata = NonNullable<ModelOutputChunk["metadata"]>;
type ProtocolConfigKind = ProtocolConfig["kind"];
type ProtocolSelectionConfigBranch = Extract<ProtocolSelection, { readonly kind: Protocol }>;
type ProtocolSelectionNameBranch = Extract<ProtocolSelection, string>;
type CoordinationProtocolSelectionConfigBranch = Extract<CoordinationProtocolSelection, { readonly kind: Protocol }>;
type EngineProtocolSelection = EngineOptions["protocol"];
type EngineTier = EngineOptions["tier"];
type EngineModel = EngineOptions["model"];
type EngineAgents = NonNullable<EngineOptions["agents"]>;
type EngineAgent = ArrayElement<EngineAgents>;
type EngineTools = NonNullable<EngineOptions["tools"]>;
type EngineTool = ArrayElement<EngineTools>;
type EngineEvaluate = NonNullable<EngineOptions["evaluate"]>;
type EvaluatorParameter = Parameters<RunEvaluator>[0];
type EvaluatorReturn = ReturnType<RunEvaluator>;
type EvaluatorResolved = Awaited<EvaluatorReturn>;
type RuntimeToolDefaultInput = Parameters<RuntimeTool["execute"]>[0];
type RuntimeToolDefaultContext = Parameters<RuntimeTool["execute"]>[1];
type RuntimeToolDefaultReturn = ReturnType<RuntimeTool["execute"]>;
type RuntimeToolDefaultResolved = Awaited<RuntimeToolDefaultReturn>;
type RuntimeToolTypedInput = Parameters<RuntimeTool<{ readonly query: string }, { readonly answer: string }>["execute"]>[0];
type RuntimeToolTypedReturn = ReturnType<RuntimeTool<{ readonly query: string }, { readonly answer: string }>["execute"]>;
type RuntimeToolTypedResolved = Awaited<RuntimeToolTypedReturn>;
type RuntimeToolSuccessOutput = RuntimeToolSuccessResult<{ readonly answer: string }>["output"];
type RuntimeToolResultSuccess = Extract<RuntimeToolResult<{ readonly answer: string }>, { readonly type: "success" }>;
type RuntimeToolAdapterValidateInput =
  Parameters<RuntimeToolAdapterContract<{ readonly query: string }, { readonly answer: string }>["validateInput"]>[0];
type RuntimeToolExecutorTools = RuntimeToolExecutor["tools"];
type RuntimeToolExecutorTool = ArrayElement<RuntimeToolExecutorTools>;
type RuntimeToolExecutorExecuteParameter = Parameters<RuntimeToolExecutor["execute"]>[0];
type RuntimeToolExecutorExecuteReturn = ReturnType<RuntimeToolExecutor["execute"]>;
type RuntimeToolExecutorExecuteResolved = Awaited<RuntimeToolExecutorExecuteReturn>;
type ToolExecutionRequestInput = RuntimeToolExecutionRequest["input"];
type ToolExecutionContextProtocol = RuntimeToolExecutionContext["protocol"];
type ToolExecutionContextTier = RuntimeToolExecutionContext["tier"];
type BenchmarkModelProvider = BenchmarkModelSettings["provider"];
type BenchmarkModelMetadata = NonNullable<BenchmarkModelSettings["metadata"]>;
type BenchmarkRunnerProvider = BenchmarkRunnerConfig["model"]["provider"];
type BenchmarkRunnerAgents = NonNullable<BenchmarkRunnerConfig["agents"]>;
type BenchmarkRunnerAgent = ArrayElement<BenchmarkRunnerAgents>;
type CreateProtocolBenchmarkConfigParameter = Parameters<typeof createProtocolBenchmarkRunConfig>[0];
type CreateProtocolBenchmarkProtocolParameter = Parameters<typeof createProtocolBenchmarkRunConfig>[1];
type CreateProtocolBenchmarkReturn = ReturnType<typeof createProtocolBenchmarkRunConfig>;
type BenchmarkRunOptionsParameter = Parameters<typeof benchmarkRunOptions>[0];
type BenchmarkRunOptionsReturn = ReturnType<typeof benchmarkRunOptions>;
type RunBenchmarkStreamingParameter = Parameters<typeof runBenchmarkWithStreamingEventLog>[0];
type RunBenchmarkStreamingReturn = Awaited<ReturnType<typeof runBenchmarkWithStreamingEventLog>>;
type RunBenchmarkStreamingResult = RunBenchmarkStreamingReturn["result"];
type RunBenchmarkStreamingEventLog = RunBenchmarkStreamingReturn["eventLog"];
type RunBenchmarkStreamingAccounting = RunBenchmarkStreamingReturn["accounting"];
type DogpileOptionsSignal = DogpileOptions["signal"];
type EngineOptionsSignal = EngineOptions["signal"];
type OpenAICompatibleProviderModel = OpenAICompatibleProviderOptions["model"];
type OpenAICompatibleProviderFetch = NonNullable<OpenAICompatibleProviderOptions["fetch"]>;
type OpenAICompatibleProviderFetchParameter = Parameters<OpenAICompatibleProviderFetch>[0];
type OpenAICompatibleProviderFetchReturn = ReturnType<OpenAICompatibleProviderFetch>;
type OpenAICompatibleProviderCostEstimatorParameter = Parameters<OpenAICompatibleProviderCostEstimator>[0];

type _RunOptionsParameterIsNotAny = ExpectFalse<IsAny<RunOptionsParameter>>;
type _RunOptionsParameterIsExact = ExpectTrue<IsEqual<RunOptionsParameter, DogpileOptions>>;
type _RunReturnIsNotAny = ExpectFalse<IsAny<ReturnType<typeof run>>>;
type _RunResolvedResultIsNotAny = ExpectFalse<IsAny<RunResolvedResult>>;
type _RunResolvedResultIsExact = ExpectTrue<IsEqual<RunResolvedResult, RunResult>>;
type _DogpileOptionsSignalIsOptional = ExpectTrue<IsOptionalProperty<DogpileOptions, "signal">>;
type _DogpileOptionsSignalIsExact = ExpectTrue<IsEqual<DogpileOptionsSignal, AbortSignal | undefined>>;

type _PileOptionsParameterIsNotAny = ExpectFalse<IsAny<PileOptionsParameter>>;
type _PileOptionsParameterIsExact = ExpectTrue<IsEqual<PileOptionsParameter, DogpileOptions>>;
type _PileReturnIsNotAny = ExpectFalse<IsAny<ReturnType<typeof Dogpile.pile>>>;
type _PileResolvedResultIsNotAny = ExpectFalse<IsAny<PileResolvedResult>>;
type _PileResolvedResultIsExact = ExpectTrue<IsEqual<PileResolvedResult, RunResult>>;

type _StreamOptionsParameterIsNotAny = ExpectFalse<IsAny<StreamOptionsParameter>>;
type _StreamOptionsParameterIsExact = ExpectTrue<IsEqual<StreamOptionsParameter, DogpileOptions>>;
type _StreamReturnIsNotAny = ExpectFalse<IsAny<StreamReturn>>;
type _StreamReturnIsExact = ExpectTrue<IsEqual<StreamReturn, StreamHandle>>;
type _DogpileStreamOptionsParameterIsNotAny = ExpectFalse<IsAny<DogpileStreamOptionsParameter>>;
type _DogpileStreamOptionsParameterIsExact = ExpectTrue<IsEqual<DogpileStreamOptionsParameter, DogpileOptions>>;
type _DogpileStreamReturnIsNotAny = ExpectFalse<IsAny<DogpileStreamReturn>>;
type _DogpileStreamReturnIsExact = ExpectTrue<IsEqual<DogpileStreamReturn, StreamHandle>>;

type _CreateEngineOptionsParameterIsNotAny = ExpectFalse<IsAny<CreateEngineOptionsParameter>>;
type _CreateEngineOptionsParameterIsExact = ExpectTrue<IsEqual<CreateEngineOptionsParameter, EngineOptions>>;
type _CreateEngineReturnIsNotAny = ExpectFalse<IsAny<CreateEngineReturn>>;
type _CreateEngineReturnIsExact = ExpectTrue<IsEqual<CreateEngineReturn, Engine>>;
type _EngineOptionsSignalIsOptional = ExpectTrue<IsOptionalProperty<EngineOptions, "signal">>;
type _EngineOptionsSignalIsExact = ExpectTrue<IsEqual<EngineOptionsSignal, AbortSignal | undefined>>;
type _CreateOpenAICompatibleProviderParameterIsNotAny =
  ExpectFalse<IsAny<CreateOpenAICompatibleProviderParameter>>;
type _CreateOpenAICompatibleProviderParameterIsExact =
  ExpectTrue<IsEqual<CreateOpenAICompatibleProviderParameter, OpenAICompatibleProviderOptions>>;
type _CreateOpenAICompatibleProviderReturnIsNotAny = ExpectFalse<IsAny<CreateOpenAICompatibleProviderReturn>>;
type _CreateOpenAICompatibleProviderReturnIsExact =
  ExpectTrue<IsEqual<CreateOpenAICompatibleProviderReturn, ConfiguredModelProvider>>;
type _EngineRunIntentParameterIsNotAny = ExpectFalse<IsAny<EngineRunIntentParameter>>;
type _EngineRunIntentParameterIsString = ExpectTrue<IsEqual<EngineRunIntentParameter, string>>;
type _EngineRunResolvedResultIsNotAny = ExpectFalse<IsAny<EngineRunResolvedResult>>;
type _EngineRunResolvedResultIsExact = ExpectTrue<IsEqual<EngineRunResolvedResult, RunResult>>;
type _EngineStreamIntentParameterIsNotAny = ExpectFalse<IsAny<EngineStreamIntentParameter>>;
type _EngineStreamIntentParameterIsString = ExpectTrue<IsEqual<EngineStreamIntentParameter, string>>;
type _EngineStreamReturnIsNotAny = ExpectFalse<IsAny<EngineStreamReturn>>;
type _EngineStreamReturnIsExact = ExpectTrue<IsEqual<EngineStreamReturn, StreamHandle>>;

type _ReplayTraceParameterIsNotAny = ExpectFalse<IsAny<ReplayTraceParameter>>;
type _ReplayTraceParameterIsExact = ExpectTrue<IsEqual<ReplayTraceParameter, Trace>>;
type _ReplayReturnIsNotAny = ExpectFalse<IsAny<ReplayReturn>>;
type _ReplayReturnIsExact = ExpectTrue<IsEqual<ReplayReturn, RunResult>>;
type _ReplayStreamTraceParameterIsNotAny = ExpectFalse<IsAny<ReplayStreamTraceParameter>>;
type _ReplayStreamTraceParameterIsExact = ExpectTrue<IsEqual<ReplayStreamTraceParameter, Trace>>;
type _ReplayStreamReturnIsNotAny = ExpectFalse<IsAny<ReplayStreamReturn>>;
type _ReplayStreamReturnIsExact = ExpectTrue<IsEqual<ReplayStreamReturn, StreamHandle>>;

type _StreamSubscriberParameterIsNotAny = ExpectFalse<IsAny<StreamSubscriberParameter>>;
type _StreamSubscriberParameterIsExact = ExpectTrue<IsEqual<StreamSubscriberParameter, StreamEventSubscriber>>;
type _StreamCancelReturnIsVoid = ExpectTrue<IsEqual<StreamCancelReturn, void>>;
type _StreamStatusIsExact = ExpectTrue<IsEqual<StreamStatus, StreamHandleStatus>>;
type _StreamSubscriberEventParameterIsNotAny = ExpectFalse<IsAny<StreamSubscriberEventParameter>>;
type _StreamSubscriberEventParameterIsExact = ExpectTrue<IsEqual<StreamSubscriberEventParameter, StreamEvent>>;
type _StreamIterableEventIsNotAny = ExpectFalse<IsAny<StreamIterableEvent>>;
type _StreamIterableEventIsExact = ExpectTrue<IsEqual<StreamIterableEvent, StreamEvent>>;

type _ResultEventLogIsNotAny = ExpectFalse<IsAny<ResultEventLog>>;
type _ResultEventLogIsExact = ExpectTrue<IsEqual<ResultEventLog, RunEventLog>>;
type _ResultEventIsNotAny = ExpectFalse<IsAny<ResultEvent>>;
type _ResultEventIsExact = ExpectTrue<IsEqual<ResultEvent, RunEvent>>;
type _TraceEventIsNotAny = ExpectFalse<IsAny<TraceEvent>>;
type _TraceEventIsExact = ExpectTrue<IsEqual<TraceEvent, RunEvent>>;
type _TraceTranscriptEntryIsNotAny = ExpectFalse<IsAny<TraceTranscriptEntry>>;
type _TraceTranscriptEntryIsExact = ExpectTrue<IsEqual<TraceTranscriptEntry, TranscriptEntry>>;
type _ResultTranscriptEntryIsNotAny = ExpectFalse<IsAny<ResultTranscriptEntry>>;
type _ResultTranscriptEntryIsExact = ExpectTrue<IsEqual<ResultTranscriptEntry, TranscriptEntry>>;
type _FinalEventTranscriptIsNotAny = ExpectFalse<IsAny<FinalEventTranscript>>;
type _FinalTraceEventIsNotAny = ExpectFalse<IsAny<FinalTraceEvent>>;
type _FinalTraceEventIsExact = ExpectTrue<IsEqual<FinalTraceEvent, FinalEvent>>;
type _AgentTurnTraceEventIsNotAny = ExpectFalse<IsAny<AgentTurnTraceEvent>>;
type _AgentTurnOutputIsNotAny = ExpectFalse<IsAny<AgentTurnTraceEvent["output"]>>;
type _AgentTurnOutputIsString = ExpectTrue<IsEqual<AgentTurnTraceEvent["output"], string>>;
type _AgentTurnDecisionIsExact = ExpectTrue<IsEqual<AgentTurnDecision, AgentDecision>>;
type _TranscriptDecisionIsExact = ExpectTrue<IsEqual<TranscriptDecision, AgentDecision>>;
type _AgentDecisionParticipateBranchParticipationIsExact = ExpectTrue<
  IsEqual<Extract<AgentDecision, { type: "participate" }>["participation"], AgentParticipation>
>;
type _AgentDecisionDelegateBranchProtocolIsExact = ExpectTrue<
  IsEqual<Extract<AgentDecision, { type: "delegate" }>["protocol"], ProtocolName>
>;
type _ErrorStreamEventIsNotAny = ExpectFalse<IsAny<ErrorStreamEvent>>;
type _ErrorStreamEventMessageIsNotAny = ExpectFalse<IsAny<ErrorStreamEvent["message"]>>;
type _ErrorStreamEventMessageIsString = ExpectTrue<IsEqual<ErrorStreamEvent["message"], string>>;
type _DogpileErrorConstructorParameterIsExact = ExpectTrue<IsEqual<DogpileErrorConstructorParameter, DogpileErrorOptions>>;
type _DogpileErrorCodePropertyIsExact = ExpectTrue<IsEqual<DogpileErrorCodeProperty, DogpileErrorCode>>;
type _DogpileErrorInvalidConfigurationBranchIsDiscriminated =
  ExpectTrue<IsEqual<DogpileErrorInvalidConfigurationBranch["code"], "invalid-configuration">>;
type _DogpileErrorAbortedBranchIsDiscriminated =
  ExpectTrue<IsEqual<DogpileErrorAbortedBranch["code"], "aborted">>;
type _DogpileErrorTimeoutBranchIsDiscriminated =
  ExpectTrue<IsEqual<DogpileErrorTimeoutBranch["code"], "timeout">>;
type _DogpileErrorProviderRateLimitedBranchIsDiscriminated =
  ExpectTrue<IsEqual<DogpileErrorProviderRateLimitedBranch["code"], "provider-rate-limited">>;
type _DogpileErrorUnknownBranchIsDiscriminated =
  ExpectTrue<IsEqual<DogpileErrorUnknownBranch["code"], "unknown">>;

type _ConfiguredProviderGenerateParameterIsNotAny = ExpectFalse<IsAny<ConfiguredProviderGenerateParameter>>;
type _ConfiguredProviderGenerateParameterIsExact = ExpectTrue<IsEqual<ConfiguredProviderGenerateParameter, ModelRequest>>;
type _ConfiguredProviderGenerateReturnIsNotAny = ExpectFalse<IsAny<ConfiguredProviderGenerateReturn>>;
type _ConfiguredProviderGenerateResolvedIsNotAny = ExpectFalse<IsAny<ConfiguredProviderGenerateResolved>>;
type _ConfiguredProviderGenerateResolvedIsExact = ExpectTrue<IsEqual<ConfiguredProviderGenerateResolved, ModelResponse>>;
type _ConfiguredProviderStreamParameterIsNotAny = ExpectFalse<IsAny<ConfiguredProviderStreamParameter>>;
type _ConfiguredProviderStreamParameterIsExact = ExpectTrue<IsEqual<ConfiguredProviderStreamParameter, ModelRequest>>;
type _ConfiguredProviderStreamReturnIsNotAny = ExpectFalse<IsAny<ConfiguredProviderStreamReturn>>;
type _ConfiguredProviderStreamChunkIsNotAny = ExpectFalse<IsAny<ConfiguredProviderStreamChunk>>;
type _ConfiguredProviderStreamChunkIsExact = ExpectTrue<IsEqual<ConfiguredProviderStreamChunk, ModelOutputChunk>>;
type _ModelRequestMessageIsNotAny = ExpectFalse<IsAny<ModelRequestMessage>>;
type _ModelRequestMessageRoleIsNotAny = ExpectFalse<IsAny<ModelRequestMessage["role"]>>;
type _ModelRequestSignalIsNotAny = ExpectFalse<IsAny<ModelRequestSignal>>;
type _ModelRequestSignalIsOptional = ExpectTrue<IsOptionalProperty<ModelRequest, "signal">>;
type _ModelRequestSignalIsExact = ExpectTrue<IsEqual<ModelRequestSignal, AbortSignal | undefined>>;
type _ModelRequestMetadataIsNotAny = ExpectFalse<IsAny<ModelRequestMetadata>>;
type _ModelRequestMetadataIsExact = ExpectTrue<IsEqual<ModelRequestMetadata, JsonObject>>;
type _ModelResponseUsageIsNotAny = ExpectFalse<IsAny<ModelResponseUsage>>;
type _ModelResponseMetadataIsNotAny = ExpectFalse<IsAny<ModelResponseMetadata>>;
type _ModelResponseMetadataIsExact = ExpectTrue<IsEqual<ModelResponseMetadata, JsonObject>>;
type _ModelOutputChunkUsageIsNotAny = ExpectFalse<IsAny<ModelOutputChunkUsage>>;
type _ModelOutputChunkUsageMatchesResponseUsage = ExpectTrue<IsEqual<ModelOutputChunkUsage, ModelResponseUsage>>;
type _ModelOutputChunkMetadataIsNotAny = ExpectFalse<IsAny<ModelOutputChunkMetadata>>;
type _ModelOutputChunkMetadataMatchesResponseMetadata =
  ExpectTrue<IsEqual<ModelOutputChunkMetadata, ModelResponseMetadata>>;

type _ProtocolConfigIsNotAny = ExpectFalse<IsAny<ProtocolConfig>>;
type _ProtocolConfigKindIsNotAny = ExpectFalse<IsAny<ProtocolConfigKind>>;
type _ProtocolConfigKindIsExact = ExpectTrue<IsEqual<ProtocolConfigKind, Protocol>>;
type _ProtocolConfigIncludesSequential = ExpectTrue<IsEqual<Extract<ProtocolConfig, { readonly kind: "sequential" }>, SequentialProtocolConfig>>;
type _ProtocolConfigIncludesCoordinator = ExpectTrue<IsEqual<Extract<ProtocolConfig, { readonly kind: "coordinator" }>, CoordinatorProtocolConfig>>;
type _ProtocolConfigIncludesBroadcast = ExpectTrue<IsEqual<Extract<ProtocolConfig, { readonly kind: "broadcast" }>, BroadcastProtocolConfig>>;
type _ProtocolConfigIncludesShared = ExpectTrue<IsEqual<Extract<ProtocolConfig, { readonly kind: "shared" }>, SharedProtocolConfig>>;
type _SharedOrganizationalMemoryIsOptional = ExpectTrue<IsOptionalProperty<SharedProtocolConfig, "organizationalMemory">>;
type _SharedOrganizationalMemoryIsExact = ExpectTrue<IsEqual<SharedOrganizationalMemory, string | undefined>>;
type _ProtocolSelectionIsNotAny = ExpectFalse<IsAny<ProtocolSelection>>;
type _ProtocolSelectionNameBranchIsNotAny = ExpectFalse<IsAny<ProtocolSelectionNameBranch>>;
type _ProtocolSelectionNameBranchIsProtocol = ExpectTrue<IsEqual<ProtocolSelectionNameBranch, Protocol>>;
type _ProtocolSelectionConfigBranchIsNotAny = ExpectFalse<IsAny<ProtocolSelectionConfigBranch>>;
type _ProtocolSelectionConfigBranchIsProtocolConfig = ExpectTrue<IsEqual<ProtocolSelectionConfigBranch, ProtocolConfig>>;
type _CoordinationProtocolSelectionIsNotAny = ExpectFalse<IsAny<CoordinationProtocolSelection>>;
type _CoordinationProtocolSelectionConfigBranchIsProtocolConfig =
  ExpectTrue<IsEqual<CoordinationProtocolSelectionConfigBranch, ProtocolConfig>>;

type _EngineProtocolSelectionIsNotAny = ExpectFalse<IsAny<EngineProtocolSelection>>;
type _EngineProtocolSelectionIsExact = ExpectTrue<IsEqual<EngineProtocolSelection, ProtocolSelection>>;
type _EngineTierIsNotAny = ExpectFalse<IsAny<EngineTier>>;
type _EngineTierIsExact = ExpectTrue<IsEqual<EngineTier, Tier>>;
type _EngineModelIsNotAny = ExpectFalse<IsAny<EngineModel>>;
type _EngineModelIsExact = ExpectTrue<IsEqual<EngineModel, ConfiguredModelProvider>>;
type _EngineAgentsIsNotAny = ExpectFalse<IsAny<EngineAgents>>;
type _EngineAgentIsNotAny = ExpectFalse<IsAny<EngineAgent>>;
type _EngineAgentIsExact = ExpectTrue<IsEqual<EngineAgent, AgentSpec>>;
type _EngineToolsIsNotAny = ExpectFalse<IsAny<EngineTools>>;
type _EngineToolIsNotAny = ExpectFalse<IsAny<EngineTool>>;
type _EngineToolIsExact = ExpectTrue<IsEqual<EngineTool, RuntimeTool<JsonObject, JsonValue>>>;
type _EngineEvaluateIsNotAny = ExpectFalse<IsAny<EngineEvaluate>>;
type _EngineEvaluateIsExact = ExpectTrue<IsEqual<EngineEvaluate, RunEvaluator>>;
type _EvaluatorParameterIsNotAny = ExpectFalse<IsAny<EvaluatorParameter>>;
type _EvaluatorReturnIsNotAny = ExpectFalse<IsAny<EvaluatorReturn>>;
type _EvaluatorResolvedIsNotAny = ExpectFalse<IsAny<EvaluatorResolved>>;
type _EvaluatorResolvedIsExact = ExpectTrue<IsEqual<EvaluatorResolved, RunEvaluation>>;

type _RuntimeToolDefaultInputIsNotAny = ExpectFalse<IsAny<RuntimeToolDefaultInput>>;
type _RuntimeToolDefaultContextIsNotAny = ExpectFalse<IsAny<RuntimeToolDefaultContext>>;
type _RuntimeToolDefaultContextIsExact = ExpectTrue<IsEqual<RuntimeToolDefaultContext, RuntimeToolExecutionContext>>;
type _RuntimeToolDefaultReturnIsNotAny = ExpectFalse<IsAny<RuntimeToolDefaultReturn>>;
type _RuntimeToolDefaultResolvedIsNotAny = ExpectFalse<IsAny<RuntimeToolDefaultResolved>>;
type _RuntimeToolDefaultResolvedIsExact = ExpectTrue<IsEqual<RuntimeToolDefaultResolved, RuntimeToolResult<JsonValue>>>;
type _RuntimeToolTypedInputIsNotAny = ExpectFalse<IsAny<RuntimeToolTypedInput>>;
type _RuntimeToolTypedInputIsExact = ExpectTrue<IsEqual<RuntimeToolTypedInput, Readonly<{ readonly query: string }>>>;
type _RuntimeToolTypedReturnIsNotAny = ExpectFalse<IsAny<RuntimeToolTypedReturn>>;
type _RuntimeToolTypedResolvedIsNotAny = ExpectFalse<IsAny<RuntimeToolTypedResolved>>;
type _RuntimeToolTypedResolvedIsExact =
  ExpectTrue<IsEqual<RuntimeToolTypedResolved, RuntimeToolResult<{ readonly answer: string }>>>;
type _RuntimeToolSuccessOutputIsNotAny = ExpectFalse<IsAny<RuntimeToolSuccessOutput>>;
type _RuntimeToolSuccessOutputIsExact = ExpectTrue<IsEqual<RuntimeToolSuccessOutput, { readonly answer: string }>>;
type _RuntimeToolResultSuccessIsNotAny = ExpectFalse<IsAny<RuntimeToolResultSuccess>>;
type _RuntimeToolResultSuccessIsExact =
  ExpectTrue<IsEqual<RuntimeToolResultSuccess, RuntimeToolSuccessResult<{ readonly answer: string }>>>;
type _RuntimeToolAdapterValidateInputIsNotAny = ExpectFalse<IsAny<RuntimeToolAdapterValidateInput>>;
type _RuntimeToolAdapterValidateInputIsExact =
  ExpectTrue<IsEqual<RuntimeToolAdapterValidateInput, Readonly<{ readonly query: string }>>>;
type _RuntimeToolExecutorToolsIsNotAny = ExpectFalse<IsAny<RuntimeToolExecutorTools>>;
type _RuntimeToolExecutorToolIsNotAny = ExpectFalse<IsAny<RuntimeToolExecutorTool>>;
type _RuntimeToolExecutorToolIsExact = ExpectTrue<IsEqual<RuntimeToolExecutorTool, RuntimeTool<JsonObject, JsonValue>>>;
type _RuntimeToolExecutorExecuteParameterIsNotAny = ExpectFalse<IsAny<RuntimeToolExecutorExecuteParameter>>;
type _RuntimeToolExecutorExecuteParameterIsExact =
  ExpectTrue<IsEqual<RuntimeToolExecutorExecuteParameter, RuntimeToolExecutionRequest>>;
type _RuntimeToolExecutorExecuteReturnIsNotAny = ExpectFalse<IsAny<RuntimeToolExecutorExecuteReturn>>;
type _RuntimeToolExecutorExecuteResolvedIsNotAny = ExpectFalse<IsAny<RuntimeToolExecutorExecuteResolved>>;
type _RuntimeToolExecutorExecuteResolvedIsExact = ExpectTrue<IsEqual<RuntimeToolExecutorExecuteResolved, RuntimeToolResult>>;
type _ToolExecutionRequestInputIsNotAny = ExpectFalse<IsAny<ToolExecutionRequestInput>>;
type _ToolExecutionRequestInputIsExact = ExpectTrue<IsEqual<ToolExecutionRequestInput, JsonObject>>;
type _ToolExecutionContextProtocolIsNotAny = ExpectFalse<IsAny<ToolExecutionContextProtocol>>;
type _ToolExecutionContextProtocolIsExact = ExpectTrue<IsEqual<ToolExecutionContextProtocol, Protocol>>;
type _ToolExecutionContextTierIsNotAny = ExpectFalse<IsAny<ToolExecutionContextTier>>;
type _ToolExecutionContextTierIsExact = ExpectTrue<IsEqual<ToolExecutionContextTier, Tier>>;

type _BenchmarkModelProviderIsNotAny = ExpectFalse<IsAny<BenchmarkModelProvider>>;
type _BenchmarkModelProviderIsExact = ExpectTrue<IsEqual<BenchmarkModelProvider, ConfiguredModelProvider>>;
type _BenchmarkModelMetadataIsNotAny = ExpectFalse<IsAny<BenchmarkModelMetadata>>;
type _BenchmarkModelMetadataIsExact = ExpectTrue<IsEqual<BenchmarkModelMetadata, JsonObject>>;
type _BenchmarkRunnerProviderIsNotAny = ExpectFalse<IsAny<BenchmarkRunnerProvider>>;
type _BenchmarkRunnerProviderIsExact = ExpectTrue<IsEqual<BenchmarkRunnerProvider, ConfiguredModelProvider>>;
type _BenchmarkRunnerAgentIsNotAny = ExpectFalse<IsAny<BenchmarkRunnerAgent>>;
type _BenchmarkRunnerAgentIsExact = ExpectTrue<IsEqual<BenchmarkRunnerAgent, AgentSpec>>;
type _CreateProtocolBenchmarkConfigParameterIsNotAny = ExpectFalse<IsAny<CreateProtocolBenchmarkConfigParameter>>;
type _CreateProtocolBenchmarkConfigParameterIsExact =
  ExpectTrue<IsEqual<CreateProtocolBenchmarkConfigParameter, BenchmarkRunnerConfig>>;
type _CreateProtocolBenchmarkProtocolParameterIsNotAny = ExpectFalse<IsAny<CreateProtocolBenchmarkProtocolParameter>>;
type _CreateProtocolBenchmarkProtocolParameterIsExact =
  ExpectTrue<IsEqual<CreateProtocolBenchmarkProtocolParameter, Protocol | ProtocolConfig>>;
type _CreateProtocolBenchmarkReturnIsNotAny = ExpectFalse<IsAny<CreateProtocolBenchmarkReturn>>;
type _CreateProtocolBenchmarkReturnIsExact =
  ExpectTrue<IsEqual<CreateProtocolBenchmarkReturn, ProtocolBenchmarkRunConfig>>;
type _BenchmarkRunOptionsParameterIsNotAny = ExpectFalse<IsAny<BenchmarkRunOptionsParameter>>;
type _BenchmarkRunOptionsParameterIsExact = ExpectTrue<IsEqual<BenchmarkRunOptionsParameter, ProtocolBenchmarkRunConfig>>;
type _BenchmarkRunOptionsReturnIsNotAny = ExpectFalse<IsAny<BenchmarkRunOptionsReturn>>;
type _BenchmarkRunOptionsReturnIsExact = ExpectTrue<IsEqual<BenchmarkRunOptionsReturn, DogpileOptions>>;
type _RunBenchmarkStreamingParameterIsNotAny = ExpectFalse<IsAny<RunBenchmarkStreamingParameter>>;
type _RunBenchmarkStreamingParameterIsExact =
  ExpectTrue<IsEqual<RunBenchmarkStreamingParameter, ProtocolBenchmarkRunConfig>>;
type _RunBenchmarkStreamingReturnIsNotAny = ExpectFalse<IsAny<RunBenchmarkStreamingReturn>>;
type _RunBenchmarkStreamingResultIsNotAny = ExpectFalse<IsAny<RunBenchmarkStreamingResult>>;
type _RunBenchmarkStreamingResultIsExact = ExpectTrue<IsEqual<RunBenchmarkStreamingResult, RunResult>>;
type _RunBenchmarkStreamingEventLogIsNotAny = ExpectFalse<IsAny<RunBenchmarkStreamingEventLog>>;
type _RunBenchmarkStreamingEventLogIsExact =
  ExpectTrue<IsEqual<RunBenchmarkStreamingEventLog, BenchmarkStreamingEventLog>>;
type _RunBenchmarkStreamingAccountingIsNotAny = ExpectFalse<IsAny<RunBenchmarkStreamingAccounting>>;
type _RunBenchmarkStreamingAccountingIsExact =
  ExpectTrue<IsEqual<RunBenchmarkStreamingAccounting, BenchmarkCostAccounting>>;
type _OpenAICompatibleProviderModelIsNotAny = ExpectFalse<IsAny<OpenAICompatibleProviderModel>>;
type _OpenAICompatibleProviderModelIsString = ExpectTrue<IsEqual<OpenAICompatibleProviderModel, string>>;
type _OpenAICompatibleProviderFetchIsNotAny = ExpectFalse<IsAny<OpenAICompatibleProviderFetch>>;
type _OpenAICompatibleProviderFetchParameterIsExact =
  ExpectTrue<IsEqual<OpenAICompatibleProviderFetchParameter, RequestInfo | URL>>;
type _OpenAICompatibleProviderFetchReturnIsExact =
  ExpectTrue<IsEqual<OpenAICompatibleProviderFetchReturn, Promise<Response>>>;
type _OpenAICompatibleProviderCostEstimatorParameterIsExact =
  ExpectTrue<IsEqual<OpenAICompatibleProviderCostEstimatorParameter, OpenAICompatibleProviderCostContext>>;

describe("public API type inference", () => {
  it("keeps high-level API parameters, returns, events, and transcripts from inferring any", () => {
    expect(true).toBe(true);
  });

  it("keeps low-level protocol, provider, tool, and benchmark escape hatches from inferring any", () => {
    expect(true).toBe(true);
  });
});
