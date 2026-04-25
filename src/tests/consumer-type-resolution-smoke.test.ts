import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const execFileAsync = promisify(execFile);

describe("consumer type resolution", () => {
  it("typechecks a downstream import smoke through package exports", async () => {
    const smokeFile = join(rootDir, "tests", "fixtures", "consumer-type-resolution-smoke.ts");
    const { stderr } = await execFileAsync(
      "pnpm",
      [
        "exec",
        "tsc",
        "--noEmit",
        "--ignoreConfig",
        "--strict",
        "--exactOptionalPropertyTypes",
        "--noUncheckedIndexedAccess",
        "--target",
        "ES2022",
        "--lib",
        "ES2022,DOM,DOM.Iterable",
        "--module",
        "ESNext",
        "--moduleResolution",
        "Bundler",
        "--skipLibCheck",
        "--verbatimModuleSyntax",
        smokeFile
      ],
      { cwd: rootDir }
    );

    expect(stderr).toBe("");
  });
});
