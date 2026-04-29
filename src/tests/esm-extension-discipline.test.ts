import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const srcRoot = join(repoRoot, "src");

async function walkTs(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkTs(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("ESM extension discipline", () => {
  it("every relative import in src/**/*.ts ends with .js", async () => {
    const files = await walkTs(srcRoot);
    const offenders: string[] = [];
    const importRegex = /\b(?:import|export)\s+(?:[^"';]+?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g;
    const dynamicRegex = /\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const re of [importRegex, dynamicRegex]) {
        let match: RegExpExecArray | null;
        while ((match = re.exec(text)) !== null) {
          const spec = match[1];
          if (!spec) continue;
          // Allow JSON imports and explicit .ts (rare); require .js for everything else.
          if (spec.endsWith(".js") || spec.endsWith(".json")) continue;
          offenders.push(`${relative(repoRoot, file)}: relative import "${spec}" missing .js extension`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
