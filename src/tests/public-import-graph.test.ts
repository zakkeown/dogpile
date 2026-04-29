import { readFile } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const srcRoot = join(repoRoot, "src");

const PUBLIC_ENTRYPOINTS = [
  "src/index.ts",
  "src/types.ts",
  "src/browser/index.ts",
  "src/providers/openai-compatible.ts",
  "src/runtime/broadcast.ts",
  "src/runtime/coordinator.ts",
  "src/runtime/defaults.ts",
  "src/runtime/engine.ts",
  "src/runtime/model.ts",
  "src/runtime/sequential.ts",
  "src/runtime/shared.ts",
  "src/runtime/termination.ts",
  "src/runtime/tools.ts"
];

const FORBIDDEN = [
  "src/internal.ts",
  "src/demo.ts",
  "src/benchmark/",
  "src/testing/",
  "src/providers/vercel-ai.ts"
];

function isForbidden(absPath: string): string | null {
  const rel = relative(repoRoot, absPath).replace(/\\/g, "/");
  for (const pattern of FORBIDDEN) {
    if (pattern.endsWith("/")) {
      if (rel.startsWith(pattern)) return pattern;
    } else if (rel === pattern) {
      return pattern;
    }
  }
  return null;
}

async function resolveImport(fromFile: string, spec: string): Promise<string | null> {
  if (!spec.startsWith(".")) return null; // skip bare specifiers
  const fromDir = dirname(fromFile);
  // Strip trailing .js (TS source uses .js for ESM-resolution).
  const noExt = spec.replace(/\.js$/, "");
  const candidates = [
    `${noExt}.ts`,
    `${noExt}.tsx`,
    join(noExt, "index.ts"),
    `${noExt}.json`
  ];
  for (const cand of candidates) {
    const abs = normalize(resolve(fromDir, cand));
    try {
      await readFile(abs, "utf8");
      return abs;
    } catch {
      // try next
    }
  }
  return null;
}

async function collectImports(file: string): Promise<string[]> {
  const text = await readFile(file, "utf8");
  const specs: string[] = [];
  // Strip line and block comments to avoid catching imports referenced in JSDoc/comments.
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const importRegex = /\b(?:import|export)\s+(?:[^"';]+?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicRegex = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [importRegex, dynamicRegex]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(stripped)) !== null) {
      if (match[1]) specs.push(match[1]);
    }
  }
  return specs;
}

describe("public import graph isolation", () => {
  it("no public entry transitively imports internal/demo/benchmark/testing/vercel-ai", async () => {
    const visited = new Set<string>();
    const queue: string[] = PUBLIC_ENTRYPOINTS.map((p) => join(repoRoot, p));
    const offenders: string[] = [];
    const trace = new Map<string, string>(); // absPath -> importer

    while (queue.length > 0) {
      const file = queue.shift()!;
      if (visited.has(file)) continue;
      visited.add(file);
      const forbidden = isForbidden(file);
      if (forbidden) {
        const path: string[] = [relative(repoRoot, file)];
        let cur = trace.get(file);
        while (cur) {
          path.unshift(relative(repoRoot, cur));
          cur = trace.get(cur);
        }
        offenders.push(`reached forbidden "${forbidden}" via: ${path.join(" -> ")}`);
        continue;
      }
      let specs: string[];
      try {
        specs = await collectImports(file);
      } catch {
        continue;
      }
      for (const spec of specs) {
        const resolved = await resolveImport(file, spec);
        if (resolved && !visited.has(resolved) && resolved.startsWith(srcRoot)) {
          if (!trace.has(resolved)) trace.set(resolved, file);
          queue.push(resolved);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
