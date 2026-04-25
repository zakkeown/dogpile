import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

type BaselineArtifact = {
  readonly kind: "dogpile-performance-baseline";
  readonly schemaVersion: "1.0";
  readonly packageName: string;
  readonly packageVersion: string;
  readonly node: string;
  readonly command: string;
  readonly measurements: readonly [{
    readonly name: "sequential-protocol-loop";
    readonly iterations: number;
    readonly totalMs: number;
    readonly meanMs: number;
    readonly minMs: number;
    readonly maxMs: number;
    readonly eventsPerRun: number;
    readonly transcriptEntriesPerRun: number;
  }];
};

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const execFileAsync = promisify(execFile);

describe("performance baseline harness", () => {
  it("prints a repeatable protocol-loop timing artifact", async () => {
    const { stderr, stdout } = await execFileAsync("node", [
      join(rootDir, "scripts", "benchmark-baseline.mjs"),
      "--iterations",
      "2"
    ], {
      cwd: rootDir
    });
    const artifact = JSON.parse(stdout) as BaselineArtifact;

    expect(stderr).toBe("");
    expect(artifact.kind).toBe("dogpile-performance-baseline");
    expect(artifact.schemaVersion).toBe("1.0");
    expect(artifact.packageName).toBe("@dogpile/sdk");
    expect(artifact.packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(artifact.node).toMatch(/^v/);
    expect(artifact.command).toBe("pnpm run benchmark:baseline");
    expect(artifact.measurements).toHaveLength(1);
    expect(artifact.measurements[0]).toMatchObject({
      name: "sequential-protocol-loop",
      iterations: 2,
      eventsPerRun: 7,
      transcriptEntriesPerRun: 3
    });
    expect(artifact.measurements[0]?.totalMs).toBeGreaterThanOrEqual(0);
    expect(artifact.measurements[0]?.meanMs).toBeGreaterThanOrEqual(0);
    expect(artifact.measurements[0]?.maxMs).toBeGreaterThanOrEqual(artifact.measurements[0]?.minMs ?? 0);
  });
});
