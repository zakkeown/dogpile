import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Dogpile, replay, run } from "../index.js";
import { createDeterministicModelProvider } from "../internal.js";
import type { Trace } from "../index.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixturePath = join(repoRoot, "src/tests/fixtures/replay-trace-v0_3.json");

async function regenerateFixture(): Promise<Trace> {
  const result = await run({
    intent: "Frozen replay-version-skew fixture.",
    protocol: { kind: "sequential", maxTurns: 2 },
    tier: "balanced",
    model: createDeterministicModelProvider("v0_3-replay-fixture"),
    agents: [
      { id: "agent-1", role: "planner" },
      { id: "agent-2", role: "critic" }
    ],
    budget: { maxUsd: 1, maxTokens: 500, qualityWeight: 0.8 }
  });
  return JSON.parse(JSON.stringify(result.trace)) as Trace;
}

describe("replay version-skew contract", () => {
  it("frozen v0.3 trace fixture round-trips through current replay()", async () => {
    if (!existsSync(fixturePath)) {
      // Bootstrap: generate the fixture on first run, then commit it.
      const seed = await regenerateFixture();
      await writeFile(fixturePath, JSON.stringify(seed, null, 2) + "\n", "utf8");
    }
    const raw = await readFile(fixturePath, "utf8");
    const savedTrace = JSON.parse(raw) as Trace;

    const replayed = replay(savedTrace);
    const namespaced = Dogpile.replay(savedTrace);

    expect(replayed.output).toBe(savedTrace.finalOutput.output);
    expect(replayed.transcript).toBe(savedTrace.transcript);
    expect(replayed.eventLog.events).toBe(savedTrace.events);
    expect(replayed.trace).toBe(savedTrace);
    expect(namespaced).toEqual(replayed);
    // JSON round-trip determinism — guards against non-JSON values sneaking into trace.
    expect(JSON.parse(JSON.stringify(replayed))).toEqual(replayed);
  });
});
