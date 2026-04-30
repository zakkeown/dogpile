import {
  Dogpile,
  createEngine,
  run,
  stream
} from "@dogpile/sdk";
import { createEngine as createEngineFromSubpath } from "@dogpile/sdk/runtime/engine";
import type {
  AgentDecision,
  AgentParticipation,
  Budget,
  BudgetTier,
  ConfiguredModelProvider,
  DogpileOptions,
  Engine,
  ProtocolConfig,
  ProtocolName,
  RunEvent,
  RunResult,
  SharedProtocolConfig,
  StreamHandle,
  Trace
} from "@dogpile/sdk";
import type {
  AgentDecision as AgentDecisionFromTypesSubpath,
  ProtocolConfig as ProtocolConfigFromTypesSubpath
} from "@dogpile/sdk/types";

function createConsumerSmokeProvider(id: string): ConfiguredModelProvider {
  return {
    id,
    async generate() {
      return {
        text: `${id} completed`,
        finishReason: "stop",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        }
      };
    }
  };
}

const provider: ConfiguredModelProvider = createConsumerSmokeProvider("consumer-smoke-model");
const providerFromSubpath: ConfiguredModelProvider = createConsumerSmokeProvider("consumer-smoke-subpath-model");
const protocolName: ProtocolName = "sequential";
const tier: BudgetTier = "fast";
const budget: Budget = { tier, maxTokens: 1_000, qualityWeight: 0.2 };
const protocol: ProtocolConfig = { kind: protocolName, maxTurns: 1 };
const protocolFromTypesSubpath: ProtocolConfigFromTypesSubpath = { kind: "broadcast", maxRounds: 1 };
const sharedProtocol: SharedProtocolConfig = {
  kind: "shared",
  maxTurns: 2,
  organizationalMemory: "prior organizational memory"
};
const agentDecision: AgentDecision = {
  type: "participate" as const,
  selectedRole: "consumer smoke reviewer",
  participation: "contribute",
  rationale: "The public package should expose structured agent decisions.",
  contribution: "Verify AgentDecision resolves from the package root."
};
const participation: AgentParticipation =
  agentDecision.type === "participate" ? agentDecision.participation : "contribute";
const agentDecisionFromTypesSubpath: AgentDecisionFromTypesSubpath = agentDecision;

const options: DogpileOptions = {
  intent: "Verify Dogpile consumer package types resolve.",
  protocol,
  tier,
  budget,
  model: provider
};

const rootEngine: Engine = createEngine({
  protocol,
  tier,
  model: providerFromSubpath
});

const subpathEngine: Engine = createEngineFromSubpath({
  protocol: protocolFromTypesSubpath,
  tier,
  model: provider
});

const runResultPromise: Promise<RunResult> = run(options);
const pileResultPromise: Promise<RunResult> = Dogpile.pile(options);
const streamHandle: StreamHandle = stream(options);
const namespacedStreamHandle: StreamHandle = Dogpile.stream(options);
const engineRunResultPromise: Promise<RunResult> = rootEngine.run(options.intent);
const subpathEngineRunResultPromise: Promise<RunResult> = subpathEngine.run(options.intent);

function recordEvent(event: RunEvent): string {
  switch (event.type) {
    case "role-assignment":
    case "agent-turn":
    case "broadcast":
    case "tool-call":
    case "tool-result":
    case "model-request":
    case "model-response":
    case "model-output-chunk":
    case "budget-stop":
    case "final":
    case "sub-run-started":
    case "sub-run-completed":
    case "sub-run-failed":
      return event.type;
  }
}

export async function consumerTypeResolutionSmoke(): Promise<Trace> {
  const [result] = await Promise.all([
    runResultPromise,
    pileResultPromise,
    engineRunResultPromise,
    subpathEngineRunResultPromise,
    streamHandle.result,
    namespacedStreamHandle.result
  ]);
  const [firstEvent] = result.eventLog.events;

  if (firstEvent) {
    recordEvent(firstEvent);
  }
  if (
    sharedProtocol.organizationalMemory !== "prior organizational memory" ||
    participation !== "contribute" ||
    (agentDecisionFromTypesSubpath.type === "participate" &&
      agentDecision.type === "participate" &&
      agentDecisionFromTypesSubpath.selectedRole !== agentDecision.selectedRole)
  ) {
    throw new Error("Consumer type smoke should expose public structured decision types.");
  }

  return result.trace;
}
