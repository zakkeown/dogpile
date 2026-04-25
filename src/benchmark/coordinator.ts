import type {
  BenchmarkRunnerConfig,
  BenchmarkRunArtifact,
  CoordinatorProtocolConfig,
  RunResult
} from "../types.js";
import { run } from "../runtime/engine.js";
import {
  benchmarkRunOptions,
  createBenchmarkRunArtifact,
  createProtocolBenchmarkRunConfig,
  runBenchmarkWithStreamingEventLog
} from "../internal.js";

const defaultCoordinatorBenchmarkProtocol: CoordinatorProtocolConfig = {
  kind: "coordinator"
};

/**
 * Execute the Coordinator protocol using the shared benchmark configuration.
 *
 * Benchmark comparisons keep task, budget, model, and agent settings grouped
 * in {@link BenchmarkRunnerConfig}. This runner attaches the Coordinator
 * protocol and then delegates to the same high-level runtime path used by
 * application callers.
 */
export function runCoordinatorBenchmark(
  config: BenchmarkRunnerConfig,
  protocol: CoordinatorProtocolConfig = defaultCoordinatorBenchmarkProtocol
): Promise<RunResult> {
  return run(benchmarkRunOptions(createProtocolBenchmarkRunConfig(config, protocol)));
}

/**
 * Execute the Coordinator protocol and return a reproducible benchmark artifact.
 */
export async function runCoordinatorBenchmarkArtifact(
  config: BenchmarkRunnerConfig,
  protocol: CoordinatorProtocolConfig = defaultCoordinatorBenchmarkProtocol
): Promise<BenchmarkRunArtifact> {
  const runConfig = createProtocolBenchmarkRunConfig(config, protocol);
  const { result, eventLog } = await runBenchmarkWithStreamingEventLog(runConfig);
  return createBenchmarkRunArtifact(runConfig, result, eventLog.events);
}
