import { describe, expect, it } from "vitest";
import {
  benchmarkRunOptions,
  createBenchmarkRunArtifact,
  createProtocolBenchmarkRunConfig,
  createDeterministicModelProvider,
  runCoordinatorBenchmark,
  runCoordinatorBenchmarkArtifact,
  runSequentialBenchmark,
  runSequentialBenchmarkArtifact,
  runBenchmarkWithStreamingEventLog
} from "../internal.js";
import type {
  BenchmarkRunnerConfig,
  DogpileOptions,
  ModelRequest,
  ModelResponse
} from "../types.js";

describe("benchmark runner configuration", () => {
  const provider = createDeterministicModelProvider("benchmark-model");
  const config: BenchmarkRunnerConfig = {
    task: {
      id: "l3-release-readiness-triage",
      intent: "Produce a release-readiness memo from the evidence packet.",
      title: "Release readiness triage",
      level: "L3",
      requiredArtifacts: [
        {
          name: "release_decision",
          type: "enum",
          allowedValues: ["ship_v1", "ship_rc", "block_release"]
        }
      ],
      metadata: {
        paperRef: "arXiv:2603.28990v1"
      }
    },
    budget: {
      tier: "fast",
      maxUsd: 1,
      maxOutputTokens: 2500,
      maxTotalTokens: 12000,
      qualityWeight: 0.7
    },
    model: {
      provider,
      temperature: 0,
      seed: 260328990,
      metadata: {
        sameModelRequired: true
      }
    },
    agents: [
      { id: "agent-1", role: "planner" },
      { id: "agent-2", role: "critic" },
      { id: "agent-3", role: "synthesizer" },
      { id: "agent-4", role: "verifier" }
    ]
  };

  it("carries shared task, budget, and model settings into protocol runner options", () => {
    const runConfig = createProtocolBenchmarkRunConfig(config, {
      kind: "sequential",
      maxTurns: 4
    });
    const options = benchmarkRunOptions(runConfig);

    expect(runConfig.task).toBe(config.task);
    expect(runConfig.budget).toBe(config.budget);
    expect(runConfig.model).toBe(config.model);
    expect(options).toEqual({
      intent: "Produce a release-readiness memo from the evidence packet.",
      protocol: { kind: "sequential", maxTurns: 4 },
      tier: "fast",
      model: provider,
      agents: config.agents,
      temperature: 0,
      budget: {
        maxUsd: 1,
        maxTokens: 12000,
        qualityWeight: 0.7
      }
    });
  });

  it("runs Sequential through the shared benchmark configuration contract", async () => {
    const result = await runSequentialBenchmark(config, {
      kind: "sequential",
      maxTurns: 4
    });

    expect(result.output).toContain("verifier:agent-4");
    expect(result.transcript).toHaveLength(4);
    expect(result.trace.protocol).toBe("sequential");
    expect(result.trace.tier).toBe("fast");
    expect(result.trace.modelProviderId).toBe("benchmark-model");
    expect(result.trace.agentsUsed).toEqual(config.agents);
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(result.transcript[0]?.input).toContain(config.task.intent);
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
  });

  it("runs Coordinator through the shared benchmark configuration contract", async () => {
    const result = await runCoordinatorBenchmark(config, {
      kind: "coordinator",
      maxTurns: 4
    });

    expect(result.output).toContain("planner:agent-1");
    expect(result.transcript).toHaveLength(5);
    expect(result.trace.protocol).toBe("coordinator");
    expect(result.trace.tier).toBe("fast");
    expect(result.trace.modelProviderId).toBe("benchmark-model");
    expect(result.trace.agentsUsed).toEqual(config.agents);
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(result.transcript[0]?.input).toContain(config.task.intent);
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
  });

  it("packages benchmark output, event log, controls, and full transcript as a serializable artifact", async () => {
    const protocol = { kind: "sequential", maxTurns: 4 } as const;
    const runConfig = createProtocolBenchmarkRunConfig(config, protocol);
    const result = await runSequentialBenchmark(config, protocol);
    const artifact = createBenchmarkRunArtifact(runConfig, result);

    expect(artifact.kind).toBe("benchmark-run");
    expect(artifact.schemaVersion).toBe("1.0");
    expect(artifact.runId).toBe(result.trace.runId);
    expect(artifact.startedAt).toBe(result.trace.events[0]?.at);
    expect(artifact.completedAt).toBe(result.trace.events.at(-1)?.at);
    expect(artifact.output).toBe(result.output);
    expect(artifact.cost).toEqual(result.cost);
    expect(artifact.accounting).toEqual({
      kind: "benchmark-cost-accounting",
      tier: "fast",
      budget: config.budget,
      cost: result.cost,
      usdCapUtilization: result.cost.usd / 1,
      totalTokenCapUtilization: result.cost.totalTokens / 12000
    });
    expect(artifact.score).toEqual({
      kind: "benchmark-protocol-score",
      protocol: "sequential",
      score: 100,
      normalizedScore: 1,
      maxScore: 100,
      source: "artifact-completeness",
      dimensions: [
        {
          name: "output_captured",
          score: 20,
          maxScore: 20
        },
        {
          name: "transcript_captured",
          score: 20,
          maxScore: 20
        },
        {
          name: "event_log_captured",
          score: 40,
          maxScore: 40
        },
        {
          name: "budget_respected",
          score: 20,
          maxScore: 20
        }
      ]
    });
    expect(artifact.transcript).toEqual(result.transcript);
    expect(artifact.eventLog).toEqual({
      kind: "benchmark-streaming-event-log",
      runId: result.trace.runId,
      protocol: "sequential",
      eventTypes: result.trace.events.map((event) => event.type),
      eventCount: result.trace.events.length,
      events: result.trace.events
    });
    expect(artifact.trace.transcript).toEqual(result.transcript);
    expect(artifact.reproducibility).toEqual({
      task: config.task,
      budget: config.budget,
      protocol: {
        kind: "sequential",
        config: protocol
      },
      modelProviderId: "benchmark-model",
      temperature: 0,
      seed: 260328990,
      modelMetadata: {
        sameModelRequired: true
      },
      agents: config.agents
    });
    expect(JSON.parse(JSON.stringify(artifact))).toEqual(artifact);
  });

  it("returns reproducible artifacts from protocol benchmark runners", async () => {
    const [sequentialArtifact, coordinatorArtifact] = await Promise.all([
      runSequentialBenchmarkArtifact(config, { kind: "sequential", maxTurns: 4 }),
      runCoordinatorBenchmarkArtifact(config, { kind: "coordinator", maxTurns: 4 })
    ]);

    expect(sequentialArtifact.reproducibility.protocol.kind).toBe("sequential");
    expect(coordinatorArtifact.reproducibility.protocol.kind).toBe("coordinator");
    expect(sequentialArtifact.transcript).toHaveLength(4);
    expect(coordinatorArtifact.transcript).toHaveLength(5);
    expect(sequentialArtifact.trace.events.at(-1)?.type).toBe("final");
    expect(coordinatorArtifact.trace.events.at(-1)?.type).toBe("final");
    expect(sequentialArtifact.eventLog.events).toEqual(sequentialArtifact.trace.events);
    expect(coordinatorArtifact.eventLog.events).toEqual(coordinatorArtifact.trace.events);
    expect(sequentialArtifact.accounting.tier).toBe("fast");
    expect(coordinatorArtifact.accounting.tier).toBe("fast");
    expect(sequentialArtifact.accounting.budget).toEqual(config.budget);
    expect(coordinatorArtifact.accounting.budget).toEqual(config.budget);
    expect(sequentialArtifact.accounting.cost).toEqual(sequentialArtifact.cost);
    expect(coordinatorArtifact.accounting.cost).toEqual(coordinatorArtifact.cost);
    expect(sequentialArtifact.score.protocol).toBe("sequential");
    expect(coordinatorArtifact.score.protocol).toBe("coordinator");
    expect(sequentialArtifact.score.source).toBe("artifact-completeness");
    expect(coordinatorArtifact.score.source).toBe("artifact-completeness");
    expect(sequentialArtifact.score.score).toBe(100);
    expect(coordinatorArtifact.score.score).toBe(100);
    expect(sequentialArtifact.eventLog.eventTypes).toEqual(
      sequentialArtifact.trace.events.map((event) => event.type)
    );
    expect(coordinatorArtifact.eventLog.eventTypes).toEqual(
      coordinatorArtifact.trace.events.map((event) => event.type)
    );
    expect(sequentialArtifact.transcript.every((entry) => entry.input.includes(config.task.intent))).toBe(true);
    expect(coordinatorArtifact.transcript.every((entry) => entry.input.includes(config.task.intent))).toBe(true);
  });

  it("captures a structured streaming event log for a benchmark run", async () => {
    const runConfig = createProtocolBenchmarkRunConfig(config, {
      kind: "sequential",
      maxTurns: 4
    });

    const { result, eventLog, accounting } = await runBenchmarkWithStreamingEventLog(runConfig);

    expect(eventLog.kind).toBe("benchmark-streaming-event-log");
    expect(eventLog.runId).toBe(result.trace.runId);
    expect(eventLog.protocol).toBe("sequential");
    expect(eventLog.events).toEqual(result.trace.events);
    expect(eventLog.eventTypes).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "agent-turn",
      "final"
    ]);
    expect(eventLog.eventCount).toBe(eventLog.events.length);
    expect(accounting).toEqual({
      kind: "benchmark-cost-accounting",
      tier: "fast",
      budget: config.budget,
      cost: result.cost,
      usdCapUtilization: result.cost.usd / 1,
      totalTokenCapUtilization: result.cost.totalTokens / 12000
    });
    expect(JSON.parse(JSON.stringify(eventLog))).toEqual(eventLog);
    expect(JSON.parse(JSON.stringify(accounting))).toEqual(accounting);
  });

  it("executes Sequential and Coordinator against the same task, budget, and model configuration", async () => {
    const sequentialRequests: ModelRequest[] = [];
    const coordinatorRequests: ModelRequest[] = [];
    const sequentialConfig: BenchmarkRunnerConfig = {
      ...config,
      model: {
        ...config.model,
        provider: createRecordingBenchmarkProvider("benchmark-model", sequentialRequests)
      }
    };
    const coordinatorConfig: BenchmarkRunnerConfig = {
      ...config,
      model: {
        ...config.model,
        provider: createRecordingBenchmarkProvider("benchmark-model", coordinatorRequests)
      }
    };
    const sequentialProtocol = { kind: "sequential", maxTurns: 4 } as const;
    const coordinatorProtocol = { kind: "coordinator", maxTurns: 4 } as const;
    const sequentialOptions = benchmarkRunOptions(
      createProtocolBenchmarkRunConfig(sequentialConfig, sequentialProtocol)
    );
    const coordinatorOptions = benchmarkRunOptions(
      createProtocolBenchmarkRunConfig(coordinatorConfig, coordinatorProtocol)
    );

    expect(sharedBenchmarkControls(sequentialOptions)).toEqual(sharedBenchmarkControls(coordinatorOptions));
    expect(sequentialOptions.protocol).toEqual(sequentialProtocol);
    expect(coordinatorOptions.protocol).toEqual(coordinatorProtocol);

    const [sequentialResult, coordinatorResult] = await Promise.all([
      runSequentialBenchmark(sequentialConfig, sequentialProtocol),
      runCoordinatorBenchmark(coordinatorConfig, coordinatorProtocol)
    ]);

    expect(sequentialResult.transcript).toHaveLength(4);
    expect(coordinatorResult.transcript).toHaveLength(5);
    expect(sequentialResult.trace.agentsUsed).toEqual(coordinatorResult.trace.agentsUsed);
    expect(sequentialResult.trace.tier).toBe(coordinatorResult.trace.tier);
    expect(sequentialResult.trace.modelProviderId).toBe(coordinatorResult.trace.modelProviderId);
    expect(sequentialResult.transcript.every((entry) => entry.input.includes(config.task.intent))).toBe(true);
    expect(coordinatorResult.transcript.every((entry) => entry.input.includes(config.task.intent))).toBe(true);
    expect(sequentialRequests.map(modelRequestControls)).toEqual(
      coordinatorRequests.slice(0, sequentialRequests.length).map(modelRequestControls)
    );
    const finalCoordinatorRequest = coordinatorRequests[4];
    if (!finalCoordinatorRequest) {
      throw new Error("missing final coordinator synthesis request");
    }
    expect(modelRequestControls(finalCoordinatorRequest)).toEqual({
      providerTemperature: 0,
      agentId: "agent-1",
      role: "planner",
      tier: "fast"
    });
  });

  it("stores judge-provided run quality as the per-protocol benchmark score", async () => {
    const protocol = { kind: "sequential", maxTurns: 4 } as const;
    const runConfig = createProtocolBenchmarkRunConfig(config, protocol);
    const result = await runSequentialBenchmark(config, protocol);
    const artifact = createBenchmarkRunArtifact(runConfig, {
      ...result,
      quality: 0.82
    });

    expect(artifact.quality).toBe(0.82);
    expect(artifact.score).toEqual({
      kind: "benchmark-protocol-score",
      protocol: "sequential",
      score: 82,
      normalizedScore: 0.82,
      maxScore: 100,
      source: "run-quality",
      dimensions: [
        {
          name: "run_quality",
          score: 82,
          maxScore: 100
        }
      ]
    });
    expect(JSON.parse(JSON.stringify(artifact.score))).toEqual(artifact.score);
  });

  it("asserts Sequential outperforms Coordinator on the selected release-readiness benchmark", async () => {
    const sequentialProtocol = { kind: "sequential", maxTurns: 4 } as const;
    const coordinatorProtocol = { kind: "coordinator", maxTurns: 4 } as const;
    const benchmarkConfig: BenchmarkRunnerConfig = {
      ...config,
      task: {
        ...config.task,
        intent: releaseReadinessBenchmarkIntent,
        rubric: {
          maxScore: 100,
          expectedFloor: {
            coordinatorScore: 70,
            sequentialScore: 80,
            sequentialMarginOverCoordinator: 5
          }
        },
        metadata: {
          paperRef: "arXiv:2603.28990v1",
          fixture: "benchmark-fixtures/l3-release-readiness-triage.yaml",
          primaryComparison: "sequential_score_minus_coordinator_score"
        }
      },
      model: {
        ...config.model,
        provider: createReleaseReadinessBenchmarkProvider()
      }
    };

    const [sequentialResult, coordinatorResult] = await Promise.all([
      runSequentialBenchmark(benchmarkConfig, sequentialProtocol),
      runCoordinatorBenchmark(benchmarkConfig, coordinatorProtocol)
    ]);
    const sequentialScore = scoreReleaseReadinessOutput(sequentialResult.output);
    const coordinatorScore = scoreReleaseReadinessOutput(coordinatorResult.output);
    const sequentialArtifact = createBenchmarkRunArtifact(
      createProtocolBenchmarkRunConfig(benchmarkConfig, sequentialProtocol),
      {
        ...sequentialResult,
        quality: sequentialScore / 100
      }
    );
    const coordinatorArtifact = createBenchmarkRunArtifact(
      createProtocolBenchmarkRunConfig(benchmarkConfig, coordinatorProtocol),
      {
        ...coordinatorResult,
        quality: coordinatorScore / 100
      }
    );

    expect(coordinatorArtifact.score.source).toBe("run-quality");
    expect(sequentialArtifact.score.source).toBe("run-quality");
    expect(coordinatorArtifact.score.score).toBeGreaterThanOrEqual(70);
    expect(sequentialArtifact.score.score).toBeGreaterThanOrEqual(80);
    expect(sequentialArtifact.score.score - coordinatorArtifact.score.score).toBeGreaterThanOrEqual(5);
    expect(sequentialArtifact.score.score).toBeGreaterThan(coordinatorArtifact.score.score);
    expect(sequentialArtifact.score.dimensions).toEqual([
      {
        name: "run_quality",
        score: sequentialScore,
        maxScore: 100
      }
    ]);
    expect(coordinatorArtifact.score.dimensions).toEqual([
      {
        name: "run_quality",
        score: coordinatorScore,
        maxScore: 100
      }
    ]);
    expect(sequentialArtifact.reproducibility.task.id).toBe("l3-release-readiness-triage");
    expect(coordinatorArtifact.reproducibility.task.id).toBe("l3-release-readiness-triage");
    expect(sequentialArtifact.trace.protocol).toBe("sequential");
    expect(coordinatorArtifact.trace.protocol).toBe("coordinator");
    expect(JSON.parse(JSON.stringify(sequentialArtifact))).toEqual(sequentialArtifact);
    expect(JSON.parse(JSON.stringify(coordinatorArtifact))).toEqual(coordinatorArtifact);
  });
});

interface SharedBenchmarkControls {
  readonly intent: DogpileOptions["intent"];
  readonly tier: DogpileOptions["tier"];
  readonly agents: DogpileOptions["agents"] | undefined;
  readonly temperature: DogpileOptions["temperature"] | undefined;
  readonly budget: DogpileOptions["budget"] | undefined;
  readonly modelProviderId: string;
}

function sharedBenchmarkControls(options: DogpileOptions): SharedBenchmarkControls {
  return {
    intent: options.intent,
    tier: options.tier,
    agents: options.agents,
    temperature: options.temperature,
    budget: options.budget,
    modelProviderId: options.model.id
  };
}

function createRecordingBenchmarkProvider(
  id: string,
  requests: ModelRequest[]
): { readonly id: string; generate(request: ModelRequest): Promise<ModelResponse> } {
  return {
    id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      requests.push(request);
      const role = readStringMetadata(request, "role");
      const agentId = readStringMetadata(request, "agentId");
      return {
        text: `${role}:${agentId} benchmark parity response.`,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15
        },
        costUsd: 0.0001
      };
    }
  };
}

function modelRequestControls(request: ModelRequest): {
  readonly providerTemperature: number;
  readonly agentId: string;
  readonly role: string;
  readonly tier: string;
} {
  return {
    providerTemperature: request.temperature,
    agentId: readStringMetadata(request, "agentId"),
    role: readStringMetadata(request, "role"),
    tier: readStringMetadata(request, "tier")
  };
}

function readStringMetadata(request: ModelRequest, key: string): string {
  const value = request.metadata[key];
  return typeof value === "string" ? value : "unknown";
}

const releaseReadinessBenchmarkIntent = `You are reviewing whether a TypeScript SDK is ready for a public v1 release.
Use only the evidence packet. Produce release_decision, evidence_table,
contradiction_analysis, remediation_plan, and final_memo.

Evidence packet:
- README claims all four protocols are production ready.
- Public API exports run(), stream(), createEngine(), and benchmark().
- Trace contract requires role-assignment, agent-turn, broadcast, tool-call, tool-result, judge-score, budget-stop, and final events when those moments occur.
- Unit tests cover Sequential and Broadcast happy paths.
- No tests currently cover Coordinator budget-stop behavior.
- Shared protocol tests use a mock memory object and do not prove JSON-serializable replay.
- Browser bundle imports no fs, child_process, net, or path modules.
- Package is licensed Apache-2.0.
- package.json declares Node >=22.
- Paper reproduction report compares Sequential and Coordinator on one smoke task with one model and one seed.
- Cost estimator stops before maxUsd in synthetic tests, but live provider token accounting is TODO.
- README includes three usage examples, but none show custom tools.`;

function createReleaseReadinessBenchmarkProvider(): {
  readonly id: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
} {
  return {
    id: "release-readiness-rubric-model",
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const protocol = readStringMetadata(request, "protocol");
      const role = readStringMetadata(request, "role");
      const agentId = readStringMetadata(request, "agentId");
      const phase = readStringMetadata(request, "phase");

      const text =
        protocol === "sequential" && role === "verifier"
          ? sequentialReleaseReadinessMemo
          : protocol === "coordinator" && phase === "final-synthesis"
            ? coordinatorReleaseReadinessMemo
            : `${role}:${agentId} reviewed the release-readiness evidence for ${protocol}.`;

      return {
        text,
        usage: {
          inputTokens: 100,
          outputTokens: tokenEstimate(text),
          totalTokens: 100 + tokenEstimate(text)
        },
        costUsd: 0.0001
      };
    }
  };
}

function scoreReleaseReadinessOutput(output: string): number {
  return (
    scoreEvidenceCoverage(output) +
    scoreContradictionHandling(output) +
    scoreReleaseJudgment(output) +
    scoreActionability(output) +
    scoreFormatCompliance(output)
  );
}

function scoreEvidenceCoverage(output: string): number {
  const facts = [
    "production ready",
    "run()",
    "stream()",
    "createEngine()",
    "benchmark()",
    "trace contract",
    "Unit tests cover Sequential",
    "Broadcast",
    "Coordinator budget-stop",
    "Shared",
    "JSON-serializable replay",
    "fs",
    "child_process",
    "Apache-2.0",
    "Node >=22",
    "one smoke task",
    "live provider token accounting",
    "custom tools"
  ];
  const references = countIncluded(output, facts);

  if (references >= 10) {
    return 25;
  }
  if (references >= 6) {
    return 18;
  }
  if (references > 0) {
    return 8;
  }
  return 0;
}

function scoreContradictionHandling(output: string): number {
  const contradictions = countIncluded(output, [
    "production-ready claim versus missing Coordinator",
    "Shared replay",
    "reproduction report",
    "custom tools",
    "live provider token accounting"
  ]);

  if (contradictions >= 2 && output.includes("contradiction_analysis")) {
    return 25;
  }
  if (contradictions >= 2) {
    return 18;
  }
  if (contradictions === 1) {
    return 8;
  }
  return 0;
}

function scoreReleaseJudgment(output: string): number {
  if (output.includes("release_decision: ship_rc") || output.includes("release_decision: block_release")) {
    return output.includes("Coordinator budget-stop") && output.includes("Shared replay") ? 20 : 14;
  }
  if (output.includes("release_decision: ship_v1")) {
    return 0;
  }
  return 4;
}

function scoreActionability(output: string): number {
  const actions = countIncluded(output, [
    "Coordinator budget-stop coverage",
    "Shared replay proof",
    "reproduction report expansion",
    "live provider token accounting"
  ]);

  if (actions === 4 && output.includes("remediation_plan")) {
    return 20;
  }
  if (actions >= 3) {
    return 15;
  }
  if (actions > 0) {
    return 7;
  }
  return 0;
}

function scoreFormatCompliance(output: string): number {
  const requiredArtifacts = countIncluded(output, [
    "release_decision:",
    "evidence_table:",
    "contradiction_analysis:",
    "remediation_plan:",
    "final_memo:"
  ]);

  if (requiredArtifacts === 5 && countMarkdownTableRows(output) >= 6) {
    return 10;
  }
  if (requiredArtifacts === 5) {
    return 7;
  }
  if (requiredArtifacts >= 3) {
    return 4;
  }
  return 0;
}

function countIncluded(output: string, needles: readonly string[]): number {
  const normalizedOutput = output.toLowerCase();
  return needles.filter((needle) => normalizedOutput.includes(needle.toLowerCase())).length;
}

function countMarkdownTableRows(output: string): number {
  return output
    .split("\n")
    .filter((line) => line.trim().startsWith("|") && !line.includes("---"))
    .length;
}

function tokenEstimate(text: string): number {
  return Math.max(1, text.split(/\s+/u).filter(Boolean).length);
}

const coordinatorReleaseReadinessMemo = `release_decision: ship_rc

evidence_table:
| Evidence | Classification |
| README claims all protocols production ready | requires follow-up |
| Public API exports run(), stream(), createEngine(), and benchmark() | supports release |
| Unit tests cover Sequential and Broadcast happy paths | supports release |
| No tests cover Coordinator budget-stop behavior | blocks release |
| Browser bundle imports no fs or child_process | supports release |
| Apache-2.0 and Node >=22 are declared | supports release |

contradiction_analysis:
The production-ready claim versus missing Coordinator budget-stop verification is the main contradiction.

remediation_plan:
1. Add Coordinator budget-stop coverage.
2. Add Shared replay proof.
3. Expand the reproduction report.

final_memo:
Ship an explicit release candidate while closing the Coordinator and Shared verification gaps.`;

const sequentialReleaseReadinessMemo = `release_decision: ship_rc

evidence_table:
| Evidence | Classification |
| README claims all four protocols are production ready | requires follow-up |
| Public API exports run(), stream(), createEngine(), and benchmark() | supports release |
| Trace contract includes role-assignment, agent-turn, judge-score, budget-stop, and final moments | requires follow-up |
| Unit tests cover Sequential and Broadcast happy paths | supports release |
| No tests currently cover Coordinator budget-stop behavior | blocks release |
| Shared protocol tests use mock memory and do not prove JSON-serializable replay | blocks release |
| Browser bundle imports no fs or child_process modules | supports release |
| Package is Apache-2.0 and declares Node >=22 | supports release |
| Paper reproduction report has only one smoke task, one model, and one seed | requires follow-up |
| Cost estimator stops before maxUsd, but live provider token accounting is TODO | requires follow-up |
| README examples omit custom tools | requires follow-up |

contradiction_analysis:
The production-ready claim versus missing Coordinator budget-stop coverage means the release claim outruns verification.
The Shared replay story is also incomplete because mock memory coverage does not prove JSON-serializable replay.
The reproduction report and live provider token accounting gaps make the evidence useful but too narrow for a v1 claim.

remediation_plan:
1. Add Coordinator budget-stop coverage.
2. Add a Shared replay proof using a JSON-serializable trace.
3. Add reproduction report expansion across more tasks, models, and seeds.
4. Finish live provider token accounting.
5. Add a custom tools example before broad v1 messaging.

final_memo:
Ship an explicit release candidate, not v1. The SDK has strong API, portability, license, and Node >=22 signals, but v1 should wait for Coordinator budget-stop coverage, Shared replay proof, reproduction expansion, and live provider token accounting.`;
