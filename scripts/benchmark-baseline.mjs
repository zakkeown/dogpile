#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../dist/index.js";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const iterations = readIterations(process.argv.slice(2));

async function main() {
  const manifest = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
  const measurement = await measureSequentialProtocolLoop(iterations);
  const artifact = {
    kind: "dogpile-performance-baseline",
    schemaVersion: "1.0",
    packageName: manifest.name,
    packageVersion: manifest.version,
    node: process.version,
    command: "pnpm run benchmark:baseline",
    measurements: [measurement]
  };

  console.log(JSON.stringify(artifact, null, 2));
}

async function measureSequentialProtocolLoop(iterationCount) {
  const durations = [];
  let eventsPerRun = 0;
  let transcriptEntriesPerRun = 0;

  for (let index = 0; index < iterationCount; index += 1) {
    const startedAt = performance.now();
    const result = await run({
      intent: "Measure deterministic protocol-loop runtime for release hardening.",
      protocol: { kind: "sequential", maxTurns: 3 },
      tier: "fast",
      temperature: 0,
      model: createDeterministicProvider(),
      agents: [
        { id: "planner", role: "planner" },
        { id: "critic", role: "critic" },
        { id: "synthesizer", role: "synthesizer" }
      ]
    });
    durations.push(performance.now() - startedAt);
    eventsPerRun = result.trace.events.length;
    transcriptEntriesPerRun = result.transcript.length;
  }

  const totalMs = durations.reduce((total, duration) => total + duration, 0);

  return {
    name: "sequential-protocol-loop",
    iterations: iterationCount,
    totalMs: roundMs(totalMs),
    meanMs: roundMs(totalMs / iterationCount),
    minMs: roundMs(Math.min(...durations)),
    maxMs: roundMs(Math.max(...durations)),
    eventsPerRun,
    transcriptEntriesPerRun
  };
}

function createDeterministicProvider() {
  return {
    id: "baseline-deterministic-provider",
    async generate(request) {
      const role = typeof request.metadata.role === "string" ? request.metadata.role : "unknown";
      const agentId = typeof request.metadata.agentId === "string" ? request.metadata.agentId : "unknown";
      const text = `${role}:${agentId} baseline contribution`;

      return {
        text,
        usage: {
          inputTokens: 8,
          outputTokens: 4,
          totalTokens: 12
        },
        costUsd: 0.0000012
      };
    }
  };
}

function readIterations(args) {
  const flagIndex = args.indexOf("--iterations");
  const rawValue = flagIndex === -1 ? "25" : args[flagIndex + 1];
  const parsed = Number(rawValue);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--iterations must be a positive integer.");
  }

  return parsed;
}

function roundMs(value) {
  return Math.round(value * 1000) / 1000;
}

await main();
