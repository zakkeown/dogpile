import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const guardedRoots = ["src/runtime", "src/browser", "src/providers"] as const;

const NODE_BUILTINS = [
  "fs", "fs/promises", "path", "os", "child_process", "crypto",
  "http", "https", "net", "tls", "dgram", "dns", "stream", "zlib",
  "url", "util", "buffer", "process", "module", "vm", "worker_threads",
  "cluster", "perf_hooks", "readline", "tty", "v8", "async_hooks",
  "node:fs", "node:fs/promises", "node:path", "node:os", "node:child_process",
  "node:crypto", "node:http", "node:https", "node:net", "node:tls",
  "node:dgram", "node:dns", "node:stream", "node:zlib", "node:url",
  "node:util", "node:buffer", "node:process", "node:module", "node:vm",
  "node:worker_threads", "node:cluster", "node:perf_hooks", "node:readline",
  "node:tty", "node:v8", "node:async_hooks"
];

async function walkTs(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkTs(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("pure-runtime invariant: no Node-only imports", () => {
  it("src/runtime, src/browser, src/providers must not import Node builtins", async () => {
    const offenders: string[] = [];
    for (const root of guardedRoots) {
      const absRoot = join(repoRoot, root);
      const files = await walkTs(absRoot);
      for (const file of files) {
        const text = await readFile(file, "utf8");
        const importRegex = /\b(?:import|export)\s+(?:[^"';]+?\s+from\s+)?["']([^"']+)["']/g;
        const dynamicImportRegex = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
        const requireRegex = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
        for (const re of [importRegex, dynamicImportRegex, requireRegex]) {
          let match: RegExpExecArray | null;
          while ((match = re.exec(text)) !== null) {
            const spec = match[1];
            if (spec && NODE_BUILTINS.includes(spec)) {
              offenders.push(`${relative(repoRoot, file)}: imports "${spec}"`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
