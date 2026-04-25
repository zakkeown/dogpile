import {
  Dogpile,
  createEngine,
  run,
  stream
} from "@dogpile/sdk";
import { createEngine as createEngineFromSubpath } from "@dogpile/sdk/runtime/engine";
import type {
  Budget,
  BudgetTier,
  ConfiguredModelProvider,
  DogpileOptions,
  Engine,
  ProtocolConfig,
  ProtocolName,
  RunEvent,
  RunResult,
  StreamHandle,
  Trace
} from "@dogpile/sdk";
import type { ProtocolConfig as ProtocolConfigFromTypesSubpath } from "@dogpile/sdk/types";

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

  return result.trace;
}
