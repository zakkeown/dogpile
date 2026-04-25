import type {
  BenchmarkRunnerConfig,
  BenchmarkRunArtifact,
  RunResult,
  SequentialProtocolConfig
} from "../types.js";
import { run } from "../runtime/engine.js";
import {
  benchmarkRunOptions,
  createBenchmarkRunArtifact,
  createProtocolBenchmarkRunConfig,
  runBenchmarkWithStreamingEventLog
} from "../internal.js";

const defaultSequentialBenchmarkProtocol: SequentialProtocolConfig = {
  kind: "sequential"
};

/**
 * Execute the Sequential protocol using the shared benchmark configuration.
 *
 * Benchmark comparisons keep task, budget, model, and agent settings grouped
 * in {@link BenchmarkRunnerConfig}. This runner attaches the Sequential
 * protocol and then delegates to the same high-level runtime path used by
 * application callers.
 */
export function runSequentialBenchmark(
  config: BenchmarkRunnerConfig,
  protocol: SequentialProtocolConfig = defaultSequentialBenchmarkProtocol
): Promise<RunResult> {
  return run(benchmarkRunOptions(createProtocolBenchmarkRunConfig(config, protocol)));
}

/**
 * Execute the Sequential protocol and return a reproducible benchmark artifact.
 */
export async function runSequentialBenchmarkArtifact(
  config: BenchmarkRunnerConfig,
  protocol: SequentialProtocolConfig = defaultSequentialBenchmarkProtocol
): Promise<BenchmarkRunArtifact> {
  const runConfig = createProtocolBenchmarkRunConfig(config, protocol);
  const { result, eventLog } = await runBenchmarkWithStreamingEventLog(runConfig);
  return createBenchmarkRunArtifact(runConfig, result, eventLog.events);
}
