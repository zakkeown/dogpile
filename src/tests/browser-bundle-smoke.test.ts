import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const execFileAsync = promisify(execFile);

type BrowserBundleSmoke = {
  readonly resolved: string;
  readonly output: string;
  readonly eventTypes: readonly string[];
  readonly providerCalls: number;
  readonly transcriptEntries: number;
  readonly cost: {
    readonly usd: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
};

describe("browser ESM bundle smoke", () => {
  it("loads the built browser bundle and completes a minimal run path", async () => {
    const smokeScript = String.raw`
      const resolved = await import.meta.resolve("@dogpile/sdk");
      const sdk = await import("@dogpile/sdk");
      const requests = [];
      const model = {
        id: "browser-esm-smoke-model",
        async generate(request) {
          requests.push(request);
          const role = typeof request.metadata.role === "string" ? request.metadata.role : "unknown-role";
          const agentId = typeof request.metadata.agentId === "string" ? request.metadata.agentId : "unknown-agent";

          return {
            text: role + ":" + agentId + " loaded the built browser ESM bundle.",
            usage: {
              inputTokens: 3,
              outputTokens: 5,
              totalTokens: 8
            },
            costUsd: 0.0001
          };
        }
      };
      const result = await sdk.run({
        intent: "Verify the browser ESM bundle can run a minimal Dogpile mission.",
        protocol: { kind: "sequential", maxTurns: 1 },
        tier: "fast",
        model,
        agents: [
          {
            id: "browser-agent",
            role: "browser-smoke"
          }
        ]
      });

      console.log(JSON.stringify({
        resolved,
        output: result.output,
        eventTypes: result.trace.events.map((event) => event.type),
        providerCalls: requests.length,
        transcriptEntries: result.transcript.length,
        cost: result.cost
      }));
    `;

    const { stderr, stdout } = await execFileAsync(
      "node",
      ["--conditions=browser", "--input-type=module", "--eval", smokeScript],
      { cwd: rootDir }
    );
    const smoke = JSON.parse(stdout) as BrowserBundleSmoke;

    expect(stderr).toBe("");
    expect(fileURLToPath(smoke.resolved)).toBe(join(rootDir, "dist", "browser", "index.js"));
    expect(smoke.output).toBe("browser-smoke:browser-agent loaded the built browser ESM bundle.");
    expect(smoke.eventTypes).toEqual(["role-assignment", "agent-turn", "final"]);
    expect(smoke.providerCalls).toBe(1);
    expect(smoke.transcriptEntries).toBe(1);
    expect(smoke.cost).toEqual({
      usd: 0.0001,
      inputTokens: 3,
      outputTokens: 5,
      totalTokens: 8
    });
  });
});
