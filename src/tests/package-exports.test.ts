import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createOpenAICompatibleProvider } from "@dogpile/sdk";
import {
  Dogpile as BrowserDogpile,
  createEngine as createBrowserEngine,
  createOpenAICompatibleProvider as createBrowserOpenAICompatibleProvider,
  run as browserRun
} from "@dogpile/sdk/browser";
import { createOpenAICompatibleProvider as createOpenAICompatibleProviderSubpath } from "@dogpile/sdk/providers/openai-compatible";
import { createEngine } from "@dogpile/sdk/runtime/engine";
import * as internalHelpers from "../internal.js";
import type {
  BroadcastProtocolConfig,
  JsonPrimitive,
  ProtocolConfig,
  RunEvent,
  SequentialProtocolConfig
} from "@dogpile/sdk";

type ExportCondition = {
  readonly types: string;
  readonly browser?: string;
  readonly import: string;
  readonly default: string;
};

type PackageManifest = {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly repository: {
    readonly type: string;
    readonly url: string;
  };
  readonly bugs: {
    readonly url: string;
  };
  readonly homepage: string;
  readonly keywords: readonly string[];
  readonly packageManager: string;
  readonly browser: string;
  readonly exports: Record<string, ExportCondition>;
  readonly files: readonly string[];
  readonly publishConfig: {
    readonly access: string;
  };
  readonly scripts: Record<string, string>;
};

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const execFileAsync = promisify(execFile);
const privateHelperExportNames = [
  "attachDemoApp",
  "defineDemoWorkflowEntrypoint",
  "requiredDemoTraceEventTypes",
  "sampleDemoWorkflowControls",
  "startDemoRun",
  "startSampleWorkflow",
  "benchmarkRunOptions",
  "createBenchmarkRunArtifact",
  "createProtocolBenchmarkRunConfig",
  "runBenchmarkWithStreamingEventLog",
  "runCoordinatorBenchmark",
  "runCoordinatorBenchmarkArtifact",
  "runSequentialBenchmark",
  "runSequentialBenchmarkArtifact",
  "createDeterministicBroadcastTestMission",
  "createDeterministicCoordinatorTestMission",
  "createDeterministicSharedTestMission",
  "createDeterministicModelProvider"
] as const;
const privateHelperPackageSubpaths = [
  "internal",
  "demo",
  "benchmark/config",
  "benchmark/coordinator",
  "benchmark/sequential",
  "testing/deterministic-provider",
  "dist/internal.js",
  "dist/demo.js",
  "dist/benchmark/config.js",
  "dist/benchmark/coordinator.js",
  "dist/benchmark/sequential.js",
  "dist/testing/deterministic-provider.js",
  "src/internal.ts",
  "src/demo.ts",
  "src/benchmark/config.ts",
  "src/benchmark/coordinator.ts",
  "src/benchmark/sequential.ts",
  "src/testing/deterministic-provider.ts"
] as const;

async function readManifest(): Promise<PackageManifest> {
  return JSON.parse(await readFile(join(rootDir, "package.json"), "utf8")) as PackageManifest;
}

type PackFile = {
  readonly path: string;
};

type PackManifest = {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly files: readonly PackFile[];
};

type ExplicitAnyFinding = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
};

function readPackManifests(stdout: string): readonly PackManifest[] {
  const parsed: unknown = JSON.parse(stdout);

  if (!Array.isArray(parsed)) {
    throw new Error("Expected npm pack --json output to be an array.");
  }

  return parsed.map((entry) => {
    if (typeof entry !== "object" || entry === null || !("files" in entry)) {
      throw new Error("Expected npm pack entry to contain files.");
    }

    const packEntry = entry as Record<string, unknown>;
    const files = packEntry.files;
    if (!Array.isArray(files)) {
      throw new Error("Expected npm pack entry files to be an array.");
    }

    return {
      id: readStringProperty(packEntry, "id"),
      name: readStringProperty(packEntry, "name"),
      version: readStringProperty(packEntry, "version"),
      filename: readStringProperty(packEntry, "filename"),
      files: files.map((file) => {
        if (typeof file !== "object" || file === null || !("path" in file)) {
          throw new Error("Expected npm pack file entry to contain a path.");
        }

        const path = (file as { readonly path: unknown }).path;
        if (typeof path !== "string") {
          throw new Error("Expected npm pack file path to be a string.");
        }

        return { path };
      })
    };
  });
}

function readStringProperty(entry: Record<string, unknown>, propertyName: string): string {
  const value = entry[propertyName];

  if (typeof value !== "string") {
    throw new Error(`Expected npm pack entry ${propertyName} to be a string.`);
  }

  return value;
}

function findExplicitAnyTypes(declarationFile: string, contents: string): readonly ExplicitAnyFinding[] {
  const sourceFile = ts.createSourceFile(
    declarationFile,
    contents,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const findings: ExplicitAnyFinding[] = [];

  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      findings.push({
        file: declarationFile,
        line: line + 1,
        column: character + 1
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return findings;
}

function findStaticModuleSpecifiers(javaScriptFile: string, contents: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    javaScriptFile,
    contents,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return specifiers;
}

function importPackageSubpath(specifier: string): Promise<unknown> {
  return import(specifier);
}

describe("package exports", () => {
  it("declares the public scoped v1 npm package identity", async () => {
    const manifest = await readManifest();

    expect(manifest.name).toBe("@dogpile/sdk");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.license).toBe("Apache-2.0");
    expect(manifest.repository).toEqual({
      type: "git",
      url: "git+https://github.com/zakkeown/dogpile.git"
    });
    expect(manifest.bugs).toEqual({
      url: "https://github.com/zakkeown/dogpile/issues"
    });
    expect(manifest.homepage).toBe("https://github.com/zakkeown/dogpile#readme");
    expect(manifest.keywords).toEqual([
      "ai",
      "agents",
      "llm",
      "multi-agent",
      "protocols",
      "openai-compatible",
      "provider-neutral",
      "typescript"
    ]);
    expect(manifest.packageManager).toBe("pnpm@10.33.0");
    expect(manifest.publishConfig).toEqual({ access: "public" });
  });

  it("runs the local package identity guard against stale unscoped references", async () => {
    const { stderr, stdout } = await execFileAsync("node", [
      join(rootDir, "scripts", "check-package-identity.mjs")
    ], {
      cwd: rootDir
    });

    expect(stderr).toBe("");
    expect(stdout).toContain("Package identity check passed for @dogpile/sdk@1.0.0");
  });

  it("wires pack:check to the packed JavaScript and declaration map guard", async () => {
    const manifest = await readManifest();

    expect(manifest.scripts["package:sourcemaps"]).toBe("node scripts/check-pack-sourcemaps.mjs");
    expect(manifest.scripts["pack:check"]).toContain("pnpm run package:sourcemaps");
  });

  it("wires build artifact validation before pack and publish dry runs", async () => {
    const manifest = await readManifest();
    const smokeScript = await readFile(join(rootDir, "scripts", "consumer-import-smoke.mjs"), "utf8");

    expect(manifest.scripts["package:artifacts"]).toBe("node scripts/check-package-artifacts.mjs");
    expect(manifest.scripts["quickstart:smoke"]).toBe("node scripts/consumer-import-smoke.mjs");
    expect(manifest.scripts["consumer:smoke"]).toBe("node scripts/consumer-import-smoke.mjs");
    expect(manifest.scripts.verify).toContain("pnpm run build && pnpm run package:artifacts");
    expect(manifest.scripts.verify).toContain(
      "pnpm run package:artifacts && pnpm run quickstart:smoke -- --skip-build"
    );
    expect(manifest.scripts["pack:check"]).toContain(
      "pnpm run build && pnpm run package:artifacts && pnpm run quickstart:smoke -- --skip-build"
    );
    expect(manifest.scripts["publish:check"]).toContain("pnpm run package:artifacts && npm publish --dry-run");
    expect(smokeScript).toContain('const skipBuild = process.argv.includes("--skip-build")');
    expect(smokeScript).toContain('["run", "package:artifacts"]');
  });

  it("wires pack:check to reject private helper package.json exports and packed subpath imports", async () => {
    const manifest = await readManifest();
    const smokeScript = await readFile(join(rootDir, "scripts", "consumer-import-smoke.mjs"), "utf8");

    expect(manifest.scripts["pack:check"]).toContain("pnpm run quickstart:smoke");
    expect(smokeScript).toContain("unexpectedRootExports");
    expect(smokeScript).toContain("Unexpected private helper exports from");
    expect(smokeScript).toContain("assertPackageJsonDoesNotExposePrivateHelpers");
    expect(smokeScript).toContain("Unexpected private helper package.json exports from");
    expect(smokeScript).toContain("assertPrivateHelperSubpathsBlocked");
    expect(smokeScript).toContain("Unexpected private helper subpath imports from");

    for (const helperName of privateHelperExportNames) {
      expect(smokeScript).toContain(JSON.stringify(helperName));
    }

    for (const subpath of privateHelperPackageSubpaths) {
      expect(smokeScript).toContain(JSON.stringify(subpath));
    }
  });

  it("wires the fresh consumer tarball smoke to verify public subpath imports and type resolution", async () => {
    const [manifest, smokeScript, readme, changelog] = await Promise.all([
      readManifest(),
      readFile(join(rootDir, "scripts", "consumer-import-smoke.mjs"), "utf8"),
      readFile(join(rootDir, "README.md"), "utf8"),
      readFile(join(rootDir, "CHANGELOG.md"), "utf8")
    ]);

    expect(manifest.scripts["pack:check"]).toContain("pnpm run quickstart:smoke");
    expect(manifest.scripts.verify).toContain("pnpm run quickstart:smoke -- --skip-build");
    expect(smokeScript).toContain("publicSubpathRuntimeExports");
    expect(smokeScript).toContain("assertPublicSubpathsImportable");
    expect(smokeScript).toContain("Expected public subpaths to be present");
    expect(smokeScript).toContain("createTypeSmokeSource");
    expect(smokeScript).toContain("runConsumerTypecheck");
    expect(smokeScript).toContain("consumer-type-resolution-smoke.ts");
    expect(smokeScript).toContain("moduleResolution");
    expect(smokeScript).toContain("NodeNext");
    expect(smokeScript).toContain("assertConsumerDependencyUsesPackedTarball");
    expect(smokeScript).toContain("Fresh consumer install must use the packed");
    expect(smokeScript).toContain("without workspace links");
    expect(smokeScript).toContain("assertInstalledPackageUsesTarballEntrypoints");
    expect(smokeScript).toContain("assertPackedDistDoesNotImportLocalSources");
    expect(smokeScript).toContain("must not import workspace links or local source files");
    expect(smokeScript).toContain("runtime/engine");
    expect(smokeScript).toContain("providers/openai-compatible");
    expect(smokeScript).toContain("browser");
    expect(readme).toContain("resolve `@dogpile/sdk` from the `.tgz` instead of `workspace:` or `link:` metadata");
    expect(readme).toContain("do not resolve through local source imports");
    expect(changelog).toContain("reject `workspace:` / `link:` SDK installs");
    expect(changelog).toContain("local source files");
    expect(readme).toContain("imports every public package subpath from the installed tarball");
    expect(readme).toContain("runs `tsc --noEmit` from the consumer project");
    expect(changelog).toContain("import every public package subpath");
    expect(changelog).toContain("downstream TypeScript type resolution");
  });

  it("wires pack:check to reject packed private helper files", async () => {
    const manifest = await readManifest();
    const [smokeScript, readme, changelog] = await Promise.all([
      readFile(join(rootDir, "scripts", "consumer-import-smoke.mjs"), "utf8"),
      readFile(join(rootDir, "README.md"), "utf8"),
      readFile(join(rootDir, "CHANGELOG.md"), "utf8")
    ]);

    expect(manifest.scripts["pack:check"]).toContain("pnpm run quickstart:smoke");
    expect(smokeScript).toContain("assertPackedPrivateHelperFilesAbsent");
    expect(smokeScript).toContain("Unexpected private helper files packed in");
    expect(smokeScript).toContain("forbiddenHelperPackedFiles");
    expect(smokeScript).toContain("dist/benchmark/sequential.js");
    expect(smokeScript).toContain("src/testing/deterministic-provider.ts");
    expect(readme).toContain("verifies private helper files are absent from the installed tarball");
    expect(changelog).toContain("Removed demo, benchmark, deterministic testing, and internal helper files from the publishable tarball");
  });

  it("runs the local packed JavaScript and declaration map guard", async () => {
    const { stderr, stdout } = await execFileAsync("node", [
      join(rootDir, "scripts", "check-pack-sourcemaps.mjs")
    ], {
      cwd: rootDir
    });

    expect(stderr).toBe("");
    expect(stdout).toContain("Pack sourcemap check passed");
    expect(stdout).toContain("packaged dist JavaScript outputs include .js.map files");
    expect(stdout).toContain("sourceMappingURL references resolve to packed source maps");
    expect(stdout).toContain("packaged dist declaration outputs include .d.ts.map files");
    expect(stdout).toContain("declaration sourceMappingURL references resolve to packed declaration maps");
  });

  it("runs the local package artifact guard for package metadata entrypoints", async () => {
    const { stderr, stdout } = await execFileAsync("node", [
      join(rootDir, "scripts", "check-package-artifacts.mjs")
    ], {
      cwd: rootDir
    });

    expect(stderr).toBe("");
    expect(stdout).toContain("Package artifact check passed");
    expect(stdout).toContain("runtime JavaScript artifacts");
    expect(stdout).toContain("TypeScript declaration artifacts referenced by package metadata");
  });

  it("rejects package metadata runtime and declaration targets that were not emitted", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "dogpile-package-artifacts-fixture-"));

    try {
      await mkdir(join(tempDir, "dist"));
      await Promise.all([
        writeFile(join(tempDir, "dist", "index.js"), "export const value = 1;\n", "utf8"),
        writeFile(join(tempDir, "dist", "index.d.ts"), "export declare const value = 1;\n", "utf8"),
        writeFile(join(tempDir, "package.json"), JSON.stringify({
          name: "dogpile-package-artifacts-fixture",
          version: "1.0.0",
          type: "module",
          main: "./dist/index.js",
          types: "./dist/index.d.ts",
          exports: {
            ".": {
              types: "./dist/index.d.ts",
              import: "./dist/index.js"
            },
            "./missing": {
              types: "./dist/missing.d.ts",
              import: "./dist/missing.js"
            }
          },
          files: [
            "dist/*.js",
            "dist/*.d.ts"
          ]
        }, null, 2), "utf8")
      ]);

      try {
        await execFileAsync("node", [
          join(rootDir, "scripts", "check-package-artifacts.mjs"),
          "--root",
          tempDir
        ], {
          cwd: rootDir
        });
        throw new Error("Expected package artifact check to fail.");
      } catch (error) {
        const execError = error as { readonly code?: number; readonly stderr?: string };

        expect(execError.code).toBe(1);
        expect(execError.stderr).toContain("Package artifact check failed");
        expect(execError.stderr).toContain(
          'package.json exports["./missing"].import references dist/missing.js, but the file was not emitted.'
        );
        expect(execError.stderr).toContain(
          'package.json exports["./missing"].types references dist/missing.d.ts, but the file was not emitted.'
        );
      }
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects packaged dist JavaScript outputs without matching source map files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "dogpile-pack-sourcemap-fixture-"));

    try {
      await mkdir(join(tempDir, "dist"));
      await Promise.all([
        writeFile(join(tempDir, "dist", "index.js"), "export const value = 1;\n", "utf8"),
        writeFile(
          join(tempDir, "dist", "index.d.ts"),
          "export declare const value = 1;\n//# sourceMappingURL=index.d.ts.map\n",
          "utf8"
        ),
        writeFile(join(tempDir, "dist", "index.d.ts.map"), "{}\n", "utf8"),
        writeFile(join(tempDir, "package.json"), JSON.stringify({
          name: "dogpile-pack-sourcemap-fixture",
          version: "1.0.0",
          type: "module",
          files: [
            "dist/**/*.js",
            "dist/**/*.js.map",
            "dist/**/*.d.ts",
            "dist/**/*.d.ts.map"
          ]
        }, null, 2), "utf8")
      ]);

      try {
        await execFileAsync("node", [
          join(rootDir, "scripts", "check-pack-sourcemaps.mjs"),
          "--root",
          tempDir,
          "--cache",
          join(tempDir, ".npm-cache")
        ], {
          cwd: rootDir
        });
        throw new Error("Expected pack sourcemap check to fail.");
      } catch (error) {
        const execError = error as { readonly code?: number; readonly stderr?: string };

        expect(execError.code).toBe(1);
        expect(execError.stderr).toContain("Pack sourcemap check failed");
        expect(execError.stderr).toContain("dist/index.js is missing dist/index.js.map");
      }
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects packaged dist JavaScript sourceMappingURL references to unpacked source map files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "dogpile-pack-js-sourcemapping-url-fixture-"));

    try {
      await mkdir(join(tempDir, "dist"));
      await Promise.all([
        writeFile(
          join(tempDir, "dist", "index.js"),
          "export const value = 1;\n//# sourceMappingURL=missing/index.js.map\n",
          "utf8"
        ),
        writeFile(join(tempDir, "dist", "index.js.map"), JSON.stringify({
          version: 3,
          file: "index.js",
          sourceRoot: "",
          sources: [],
          names: [],
          mappings: ""
        }), "utf8"),
        writeFile(
          join(tempDir, "dist", "index.d.ts"),
          "export declare const value = 1;\n//# sourceMappingURL=index.d.ts.map\n",
          "utf8"
        ),
        writeFile(join(tempDir, "dist", "index.d.ts.map"), JSON.stringify({
          version: 3,
          file: "index.d.ts",
          sourceRoot: "",
          sources: [],
          names: [],
          mappings: ""
        }), "utf8"),
        writeFile(join(tempDir, "package.json"), JSON.stringify({
          name: "dogpile-pack-js-sourcemapping-url-fixture",
          version: "1.0.0",
          type: "module",
          files: [
            "dist/**/*.js",
            "dist/**/*.js.map",
            "dist/**/*.d.ts",
            "dist/**/*.d.ts.map"
          ]
        }, null, 2), "utf8")
      ]);

      try {
        await execFileAsync("node", [
          join(rootDir, "scripts", "check-pack-sourcemaps.mjs"),
          "--root",
          tempDir,
          "--cache",
          join(tempDir, ".npm-cache")
        ], {
          cwd: rootDir
        });
        throw new Error("Expected pack sourcemap check to fail.");
      } catch (error) {
        const execError = error as { readonly code?: number; readonly stderr?: string };

        expect(execError.code).toBe(1);
        expect(execError.stderr).toContain("Pack sourcemap check failed");
        expect(execError.stderr).toContain(
          "dist/index.js references missing/index.js.map (dist/missing/index.js.map) but that source map is not in the packed tarball"
        );
      }
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects packaged dist declaration outputs without matching declaration map files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "dogpile-pack-declaration-map-fixture-"));

    try {
      await mkdir(join(tempDir, "dist"));
      await Promise.all([
        writeFile(
          join(tempDir, "dist", "index.js"),
          "export const value = 1;\n//# sourceMappingURL=index.js.map\n",
          "utf8"
        ),
        writeFile(join(tempDir, "dist", "index.js.map"), "{}\n", "utf8"),
        writeFile(
          join(tempDir, "dist", "index.d.ts"),
          "export declare const value = 1;\n//# sourceMappingURL=index.d.ts.map\n",
          "utf8"
        ),
        writeFile(join(tempDir, "package.json"), JSON.stringify({
          name: "dogpile-pack-declaration-map-fixture",
          version: "1.0.0",
          type: "module",
          files: [
            "dist/**/*.js",
            "dist/**/*.js.map",
            "dist/**/*.d.ts",
            "dist/**/*.d.ts.map"
          ]
        }, null, 2), "utf8")
      ]);

      try {
        await execFileAsync("node", [
          join(rootDir, "scripts", "check-pack-sourcemaps.mjs"),
          "--root",
          tempDir,
          "--cache",
          join(tempDir, ".npm-cache")
        ], {
          cwd: rootDir
        });
        throw new Error("Expected pack sourcemap check to fail.");
      } catch (error) {
        const execError = error as { readonly code?: number; readonly stderr?: string };

        expect(execError.code).toBe(1);
        expect(execError.stderr).toContain("Pack sourcemap check failed");
        expect(execError.stderr).toContain("dist/index.d.ts is missing dist/index.d.ts.map");
      }
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects packaged dist declaration sourceMappingURL references to unpacked declaration map files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "dogpile-pack-declaration-sourcemapping-url-fixture-"));

    try {
      await mkdir(join(tempDir, "dist"));
      await Promise.all([
        writeFile(
          join(tempDir, "dist", "index.js"),
          "export const value = 1;\n//# sourceMappingURL=index.js.map\n",
          "utf8"
        ),
        writeFile(join(tempDir, "dist", "index.js.map"), JSON.stringify({
          version: 3,
          file: "index.js",
          sourceRoot: "",
          sources: [],
          names: [],
          mappings: ""
        }), "utf8"),
        writeFile(
          join(tempDir, "dist", "index.d.ts"),
          "export declare const value = 1;\n//# sourceMappingURL=missing/index.d.ts.map\n",
          "utf8"
        ),
        writeFile(join(tempDir, "dist", "index.d.ts.map"), JSON.stringify({
          version: 3,
          file: "index.d.ts",
          sourceRoot: "",
          sources: [],
          names: [],
          mappings: ""
        }), "utf8"),
        writeFile(join(tempDir, "package.json"), JSON.stringify({
          name: "dogpile-pack-declaration-sourcemapping-url-fixture",
          version: "1.0.0",
          type: "module",
          files: [
            "dist/**/*.js",
            "dist/**/*.js.map",
            "dist/**/*.d.ts",
            "dist/**/*.d.ts.map"
          ]
        }, null, 2), "utf8")
      ]);

      try {
        await execFileAsync("node", [
          join(rootDir, "scripts", "check-pack-sourcemaps.mjs"),
          "--root",
          tempDir,
          "--cache",
          join(tempDir, ".npm-cache")
        ], {
          cwd: rootDir
        });
        throw new Error("Expected pack sourcemap check to fail.");
      } catch (error) {
        const execError = error as { readonly code?: number; readonly stderr?: string };

        expect(execError.code).toBe(1);
        expect(execError.stderr).toContain("Pack sourcemap check failed");
        expect(execError.stderr).toContain(
          "dist/index.d.ts references missing/index.d.ts.map (dist/missing/index.d.ts.map) but that declaration map is not in the packed tarball"
        );
      }
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects packaged JavaScript source maps that reference unpacked source files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "dogpile-pack-js-source-reference-fixture-"));

    try {
      await mkdir(join(tempDir, "dist"));
      await Promise.all([
        writeFile(
          join(tempDir, "dist", "index.js"),
          "export const value = 1;\n//# sourceMappingURL=index.js.map\n",
          "utf8"
        ),
        writeFile(join(tempDir, "dist", "index.js.map"), JSON.stringify({
          version: 3,
          file: "index.js",
          sourceRoot: "",
          sources: ["../index.ts"],
          names: [],
          mappings: ""
        }), "utf8"),
        writeFile(
          join(tempDir, "dist", "index.d.ts"),
          "export declare const value = 1;\n//# sourceMappingURL=index.d.ts.map\n",
          "utf8"
        ),
        writeFile(join(tempDir, "dist", "index.d.ts.map"), JSON.stringify({
          version: 3,
          file: "index.d.ts",
          sourceRoot: "",
          sources: [],
          names: [],
          mappings: ""
        }), "utf8"),
        writeFile(join(tempDir, "package.json"), JSON.stringify({
          name: "dogpile-pack-js-source-reference-fixture",
          version: "1.0.0",
          type: "module",
          files: [
            "dist/**/*.js",
            "dist/**/*.js.map",
            "dist/**/*.d.ts",
            "dist/**/*.d.ts.map"
          ]
        }, null, 2), "utf8")
      ]);

      try {
        await execFileAsync("node", [
          join(rootDir, "scripts", "check-pack-sourcemaps.mjs"),
          "--root",
          tempDir,
          "--cache",
          join(tempDir, ".npm-cache")
        ], {
          cwd: rootDir
        });
        throw new Error("Expected pack sourcemap check to fail.");
      } catch (error) {
        const execError = error as { readonly code?: number; readonly stderr?: string };

        expect(execError.code).toBe(1);
        expect(execError.stderr).toContain("Pack sourcemap check failed");
        expect(execError.stderr).toContain(
          "dist/index.js.map references ../index.ts (index.ts) but that source is not in the packed tarball"
        );
      }
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects packaged declaration maps that reference unpacked source files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "dogpile-pack-declaration-source-reference-fixture-"));

    try {
      await mkdir(join(tempDir, "dist"));
      await Promise.all([
        writeFile(
          join(tempDir, "dist", "index.js"),
          "export const value = 1;\n//# sourceMappingURL=index.js.map\n",
          "utf8"
        ),
        writeFile(join(tempDir, "dist", "index.js.map"), JSON.stringify({
          version: 3,
          file: "index.js",
          sourceRoot: "",
          sources: [],
          names: [],
          mappings: ""
        }), "utf8"),
        writeFile(
          join(tempDir, "dist", "index.d.ts"),
          "export declare const value = 1;\n//# sourceMappingURL=index.d.ts.map\n",
          "utf8"
        ),
        writeFile(join(tempDir, "dist", "index.d.ts.map"), JSON.stringify({
          version: 3,
          file: "index.d.ts",
          sourceRoot: "",
          sources: ["../index.ts"],
          names: [],
          mappings: ""
        }), "utf8"),
        writeFile(join(tempDir, "package.json"), JSON.stringify({
          name: "dogpile-pack-declaration-source-reference-fixture",
          version: "1.0.0",
          type: "module",
          files: [
            "dist/**/*.js",
            "dist/**/*.js.map",
            "dist/**/*.d.ts",
            "dist/**/*.d.ts.map"
          ]
        }, null, 2), "utf8")
      ]);

      try {
        await execFileAsync("node", [
          join(rootDir, "scripts", "check-pack-sourcemaps.mjs"),
          "--root",
          tempDir,
          "--cache",
          join(tempDir, ".npm-cache")
        ], {
          cwd: rootDir
        });
        throw new Error("Expected pack sourcemap check to fail.");
      } catch (error) {
        const execError = error as { readonly code?: number; readonly stderr?: string };

        expect(execError.code).toBe(1);
        expect(execError.stderr).toContain("Pack sourcemap check failed");
        expect(execError.stderr).toContain(
          "dist/index.d.ts.map references ../index.ts (index.ts) but that source is not in the packed tarball"
        );
      }
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects stale unscoped package references", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "dogpile-package-identity-"));

    try {
      await Promise.all([
        writeFile(join(tempDir, "package.json"), JSON.stringify({
          name: "@dogpile/sdk",
          version: "1.0.0"
        }), "utf8"),
        writeFile(join(tempDir, "README.md"), ["npm install", "dogpile ai\n"].join(" "), "utf8")
      ]);

      try {
        await execFileAsync("node", [
          join(rootDir, "scripts", "check-package-identity.mjs"),
          "--root",
          tempDir
        ], {
          cwd: rootDir
        });
        throw new Error("Expected package identity check to fail.");
      } catch (error) {
        const execError = error as { readonly code?: number; readonly stderr?: string };

        expect(execError.code).toBe(1);
        expect(execError.stderr).toContain("Package identity check failed");
        expect(execError.stderr).toContain("README.md:1:1 uses stale unscoped bare npm install command");
      }
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("wires required release validation jobs into CI", async () => {
    const workflow = await readFile(
      join(rootDir, ".github", "workflows", "release-validation.yml"),
      "utf8"
    );

    expect(workflow).toContain("pnpm run package:identity");
    expect(workflow).toContain("pnpm run verify");
    expect(workflow).toContain("pnpm run browser:smoke");
    expect(workflow).toContain("pnpm run quickstart:smoke");
    expect(workflow).toContain("pnpm run pack:check");
    expect(workflow).toMatch(/push:[\s\S]*branches:[\s\S]*- main[\s\S]*- "release\/\*\*"/);
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).toMatch(
      /required-node-suite:[\s\S]*node-version:[\s\S]*- 22[\s\S]*- 24/
    );
    expect(workflow).toContain("required-bun-latest-suite:");
    expect(workflow).toContain("name: Required Bun latest full suite");
    expect(workflow).toContain("uses: oven-sh/setup-bun@v2");
    expect(workflow).toContain("bun-version: latest");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toMatch(
      /required-bun-latest-suite:[\s\S]*bun run package:identity[\s\S]*bun run build[\s\S]*bun run typecheck[\s\S]*bun run test/
    );
    expect(workflow).toContain("required-browser-bundle-smoke:");
    expect(workflow).toContain("name: Required browser bundle smoke");
    expect(workflow).toMatch(
      /required-browser-bundle-smoke:[\s\S]*node-version: 22[\s\S]*pnpm install --frozen-lockfile[\s\S]*pnpm run browser:smoke/
    );
    expect(workflow).toContain("required-packed-tarball-quickstart-smoke:");
    expect(workflow).toContain("name: Required packed-tarball quickstart smoke");
    expect(workflow).toMatch(
      /required-packed-tarball-quickstart-smoke:[\s\S]*node-version: 22[\s\S]*pnpm install --frozen-lockfile[\s\S]*pnpm run quickstart:smoke/
    );
    expect(workflow).toContain("required-pack-check:");
    expect(workflow).toContain("name: Required pack:check package artifact");
    expect(workflow).toMatch(/required-pack-check:[\s\S]*needs:[\s\S]*- required-node-suite/);
    expect(workflow).toMatch(/required-pack-check:[\s\S]*needs:[\s\S]*- required-bun-latest-suite/);
    expect(workflow).toMatch(/required-pack-check:[\s\S]*needs:[\s\S]*- required-browser-bundle-smoke/);
    expect(workflow).toMatch(/required-pack-check:[\s\S]*needs:[\s\S]*- required-packed-tarball-quickstart-smoke/);
  });

  it("keeps the packaged README quickstart as the consumer smoke fixture source", async () => {
    const [readme, smokeScript] = await Promise.all([
      readFile(join(rootDir, "README.md"), "utf8"),
      readFile(join(rootDir, "scripts", "consumer-import-smoke.mjs"), "utf8")
    ]);
    const startMarker = "<!-- dogpile-consumer-quickstart-smoke:start -->";
    const endMarker = "<!-- dogpile-consumer-quickstart-smoke:end -->";
    const startIndex = readme.indexOf(startMarker);
    const endIndex = readme.indexOf(endMarker);
    const markedBlock = readme.slice(startIndex, endIndex);

    expect(readme.split(startMarker).length - 1).toBe(1);
    expect(readme.split(endMarker).length - 1).toBe(1);
    expect(startIndex).toBeGreaterThan(-1);
    expect(endIndex).toBeGreaterThan(startIndex);
    expect(markedBlock).toContain('```ts');
    expect(markedBlock).toContain('import { Dogpile } from "@dogpile/sdk";');
    expect(markedBlock).toContain('id: "quickstart-provider"');
    expect(markedBlock).toContain("const result = await Dogpile.pile({");
    expect(markedBlock).toContain('console.log("Dogpile quickstart complete");');
    expect(markedBlock).toContain("console.log(`protocol=${result.metadata.protocol}`);");
    expect(markedBlock).toContain("console.log(`costUsd=${result.usage.usd}`);");
    expect(readme).toContain("save this complete script as\n`quickstart.mjs`");
    expect(readme).toContain("node quickstart.mjs");
    expect(readme).toContain("Expected observable output:");
    expect(readme).toContain("costUsd=<estimated from provider token usage and your pricing table>");
    expect(readme).toContain("output=<model response text>");
    expect(smokeScript).toContain("readInstalledDocumentedQuickstart");
    expect(smokeScript).toContain("extractMarkedTypescriptBlock");
    expect(smokeScript).toContain('join(consumerDir, "node_modules", ...packageName.split("/"), "README.md")');
  });

  it("documents release-blocking Node, Bun, browser, and package GitHub status checks", async () => {
    const readme = await readFile(join(rootDir, "README.md"), "utf8");

    expect(readme).toContain("Required CI Status Checks");
    expect(readme).toContain("Release Validation / Required Node.js 22 full suite");
    expect(readme).toContain("Release Validation / Required Node.js 24 full suite");
    expect(readme).toContain("Release Validation / Required Bun latest full suite");
    expect(readme).toContain("Release Validation / Required browser bundle smoke");
    expect(readme).toContain("Release Validation / Required packed-tarball quickstart smoke");
    expect(readme).toContain("Release Validation / Required pack:check package artifact");
    expect(readme).toContain("Do not publish");
  });

  it("scopes README runtime support to Node, Bun, and browser ESM only", async () => {
    const readme = await readFile(join(rootDir, "README.md"), "utf8");

    expect(readme).toContain("supports only Node.js LTS 22 / 24, Bun latest, and browser ESM runtimes");
    expect(readme).toContain(
      "runtime portability guarantees for Node.js LTS 22 / 24, Bun latest, and browser ESM runtimes"
    );
    expect(readme).toContain("supported Node.js, Bun, and browser ESM runtimes");
    expect(readme).not.toMatch(/\b(?:Cloudflare|Workers?|Vercel Edge|Edge Runtime|Deno|serverless)\b/i);
  });

  it("documents the scoped npm install and release tarball identity", async () => {
    const [readme, changelog] = await Promise.all([
      readFile(join(rootDir, "README.md"), "utf8"),
      readFile(join(rootDir, "CHANGELOG.md"), "utf8")
    ]);

    expect(readme).toContain("pnpm add @dogpile/sdk");
    expect(readme).toContain("npm install @dogpile/sdk");
    expect(readme).toContain("yarn add @dogpile/sdk");
    expect(readme).toContain("@dogpile/sdk@1.0.0");
    expect(readme).toContain("dogpile-sdk-1.0.0.tgz");
    expect(changelog).toContain("## 1.0.0");
    expect(changelog).toContain("@dogpile/sdk");
    expect(changelog).toContain("dogpile-sdk-1.0.0.tgz");
  });

  it("does not document private demo, benchmark, deterministic testing, or internal helper package imports", async () => {
    const docs = await Promise.all([
      readFile(join(rootDir, "README.md"), "utf8"),
      readFile(join(rootDir, "CHANGELOG.md"), "utf8"),
      readFile(join(rootDir, "benchmark-fixtures/paper-reproduction.md"), "utf8")
    ]);

    for (const doc of docs) {
      expect(doc).not.toMatch(/@dogpile\/sdk\/(?:demo|benchmark|testing|internal)\b/);
    }

    expect(docs.join("\n")).toContain("../internal.js");
  });

  it("publishes built JavaScript, declarations, source maps, original sources, and required package metadata", async () => {
    const manifest = await readManifest();

    expect(manifest.files).toEqual([
      "dist/index.js",
      "dist/index.js.map",
      "dist/index.d.ts",
      "dist/index.d.ts.map",
      "dist/types.js",
      "dist/types.js.map",
      "dist/types.d.ts",
      "dist/types.d.ts.map",
      "dist/browser/index.js",
      "dist/browser/index.js.map",
      "dist/browser/index.d.ts",
      "dist/browser/index.d.ts.map",
      "dist/providers/openai-compatible.js",
      "dist/providers/openai-compatible.js.map",
      "dist/providers/openai-compatible.d.ts",
      "dist/providers/openai-compatible.d.ts.map",
      "dist/runtime/*.js",
      "dist/runtime/*.js.map",
      "dist/runtime/*.d.ts",
      "dist/runtime/*.d.ts.map",
      "src/index.ts",
      "src/types.ts",
      "src/browser/index.ts",
      "src/providers/openai-compatible.ts",
      "src/runtime/*.ts",
      "README.md",
      "CHANGELOG.md",
      "LICENSE"
    ]);

    expect(manifest.files).not.toContain("test");
    expect(manifest.files).not.toContain("benchmark-fixtures");
    expect(manifest.files).not.toContain("dist");
    expect(manifest.files).not.toContain("dist/**/*.js");
    expect(manifest.files).not.toContain("src/**/*.ts");
    expect(manifest.files).not.toContain("pnpm-lock.yaml");
    expect(manifest.files).not.toContain("seed.yaml");
    expect(manifest.files).not.toContain("CLAUDE.md");
  });

  it("packs built artifacts, declarations, and metadata without source-only or local files", async () => {
    const { stdout } = await execFileAsync("npm", [
      "pack",
      "--dry-run",
      "--json",
      "--cache",
      join(rootDir, ".npm-cache")
    ], {
      cwd: rootDir
    });
    const [packManifest] = readPackManifests(stdout);

    if (!packManifest) {
      throw new Error("Expected npm pack to report one package manifest.");
    }

    const packedPaths = packManifest.files.map((file) => file.path);
    const packedPathSet = new Set(packedPaths);

    expect(packedPathSet.has("package.json")).toBe(true);
    expect(packedPathSet.has("README.md")).toBe(true);
    expect(packedPathSet.has("CHANGELOG.md")).toBe(true);
    expect(packedPathSet.has("LICENSE")).toBe(true);
    expect(packManifest.id).toBe("@dogpile/sdk@1.0.0");
    expect(packManifest.name).toBe("@dogpile/sdk");
    expect(packManifest.version).toBe("1.0.0");
    expect(packManifest.filename).toBe("dogpile-sdk-1.0.0.tgz");
    expect(packedPaths.some((path) => path.startsWith("dist/") && path.endsWith(".js"))).toBe(true);
    expect(packedPaths.some((path) => path.startsWith("dist/") && path.endsWith(".d.ts"))).toBe(true);
    expect(packedPaths.some((path) => path.startsWith("dist/") && path.endsWith(".map"))).toBe(true);
    const packedDistJavaScriptFiles = packedPaths.filter((path) => path.startsWith("dist/") && path.endsWith(".js"));
    const packedDistDeclarationFiles = packedPaths.filter((path) => path.startsWith("dist/") && path.endsWith(".d.ts"));

    expect(packedDistJavaScriptFiles.length).toBeGreaterThan(0);
    expect(packedDistDeclarationFiles.length).toBeGreaterThan(0);

    for (const javaScriptFile of packedDistJavaScriptFiles) {
      expect(packedPathSet.has(`${javaScriptFile}.map`)).toBe(true);
    }

    for (const declarationFile of packedDistDeclarationFiles) {
      expect(packedPathSet.has(`${declarationFile}.map`)).toBe(true);
    }

    expect(packedPathSet.has("dist/browser/index.js")).toBe(true);
    expect(packedPathSet.has("dist/browser/index.js.map")).toBe(true);
    expect(packedPathSet.has("dist/browser/index.d.ts")).toBe(true);
    expect(packedPathSet.has("dist/browser/index.d.ts.map")).toBe(true);
    expect(packedPaths.some((path) => path.startsWith("src/") && path.endsWith(".ts"))).toBe(true);
    expect(packedPathSet.has("src/browser/index.ts")).toBe(true);
    expect(packedPathSet.has("dist/runtime/cancellation.js")).toBe(true);
    expect(packedPathSet.has("dist/runtime/validation.js")).toBe(true);
    expect(packedPathSet.has("src/runtime/cancellation.ts")).toBe(true);
    expect(packedPathSet.has("src/runtime/validation.ts")).toBe(true);
    expect(packedPaths.every((path) => !path.startsWith("test/"))).toBe(true);
    expect(packedPaths.every((path) => !path.startsWith("benchmark-fixtures/"))).toBe(true);
    expect(packedPathSet.has("dist/internal.js")).toBe(false);
    expect(packedPathSet.has("dist/demo.js")).toBe(false);
    expect(packedPaths.every((path) => !path.startsWith("dist/benchmark/"))).toBe(true);
    expect(packedPaths.every((path) => !path.startsWith("dist/testing/"))).toBe(true);
    expect(packedPathSet.has("src/internal.ts")).toBe(false);
    expect(packedPathSet.has("src/demo.ts")).toBe(false);
    expect(packedPaths.every((path) => !path.startsWith("src/benchmark/"))).toBe(true);
    expect(packedPaths.every((path) => !path.startsWith("src/testing/"))).toBe(true);
    expect(packedPathSet.has("pnpm-lock.yaml")).toBe(false);
    expect(packedPathSet.has("seed.yaml")).toBe(false);
    expect(packedPathSet.has("CLAUDE.md")).toBe(false);
  });

  it("maps public runtime and type entrypoints to built declaration and JavaScript files", async () => {
    const manifest = await readManifest();

    expect(manifest.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        browser: "./dist/browser/index.js",
        import: "./dist/index.js",
        default: "./dist/index.js"
      },
      "./browser": {
        types: "./dist/browser/index.d.ts",
        import: "./dist/browser/index.js",
        default: "./dist/browser/index.js"
      },
      "./types": {
        types: "./dist/types.d.ts",
        import: "./dist/types.js",
        default: "./dist/types.js"
      },
      "./runtime/broadcast": {
        types: "./dist/runtime/broadcast.d.ts",
        import: "./dist/runtime/broadcast.js",
        default: "./dist/runtime/broadcast.js"
      },
      "./runtime/coordinator": {
        types: "./dist/runtime/coordinator.d.ts",
        import: "./dist/runtime/coordinator.js",
        default: "./dist/runtime/coordinator.js"
      },
      "./runtime/defaults": {
        types: "./dist/runtime/defaults.d.ts",
        import: "./dist/runtime/defaults.js",
        default: "./dist/runtime/defaults.js"
      },
      "./runtime/engine": {
        types: "./dist/runtime/engine.d.ts",
        import: "./dist/runtime/engine.js",
        default: "./dist/runtime/engine.js"
      },
      "./runtime/model": {
        types: "./dist/runtime/model.d.ts",
        import: "./dist/runtime/model.js",
        default: "./dist/runtime/model.js"
      },
      "./providers/openai-compatible": {
        types: "./dist/providers/openai-compatible.d.ts",
        import: "./dist/providers/openai-compatible.js",
        default: "./dist/providers/openai-compatible.js"
      },
      "./runtime/sequential": {
        types: "./dist/runtime/sequential.d.ts",
        import: "./dist/runtime/sequential.js",
        default: "./dist/runtime/sequential.js"
      },
      "./runtime/shared": {
        types: "./dist/runtime/shared.d.ts",
        import: "./dist/runtime/shared.js",
        default: "./dist/runtime/shared.js"
      },
      "./runtime/termination": {
        types: "./dist/runtime/termination.d.ts",
        import: "./dist/runtime/termination.js",
        default: "./dist/runtime/termination.js"
      },
      "./runtime/tools": {
        types: "./dist/runtime/tools.d.ts",
        import: "./dist/runtime/tools.js",
        default: "./dist/runtime/tools.js"
      }
    });
  });

  it("keeps demo, benchmark, and deterministic testing helpers out of the package export map", async () => {
    const manifest = await readManifest();
    const privateSubpaths = privateHelperPackageSubpaths.map((subpath) => `./${subpath}`);

    for (const subpath of privateSubpaths) {
      expect(manifest.exports[subpath]).toBeUndefined();
      await expect(importPackageSubpath(`@dogpile/sdk/${subpath.slice(2)}`)).rejects.toThrow(
        /not exported|Cannot find module|Failed to resolve|Missing ".+" specifier/
      );
    }
  });

  it("resolves every supported public entrypoint through the package export map", async () => {
    const manifest = await readManifest();

    for (const subpath of Object.keys(manifest.exports)) {
      const specifier = subpath === "." ? "@dogpile/sdk" : `@dogpile/sdk/${subpath.slice(2)}`;

      await expect(importPackageSubpath(specifier)).resolves.toBeDefined();
    }
  });

  it("emits a browser-loadable ESM bundle behind package browser exports", async () => {
    const manifest = await readManifest();
    const rootExport = manifest.exports["."];
    const browserExport = manifest.exports["./browser"];

    expect(manifest.browser).toBe("./dist/browser/index.js");
    expect(manifest.scripts.build).toContain("vite build --config vite.browser.config.ts");
    expect(rootExport?.browser).toBe("./dist/browser/index.js");
    expect(browserExport).toEqual({
      types: "./dist/browser/index.d.ts",
      import: "./dist/browser/index.js",
      default: "./dist/browser/index.js"
    });

    const browserBundle = await readFile(join(rootDir, "dist", "browser", "index.js"), "utf8");
    const browserMap = JSON.parse(
      await readFile(join(rootDir, "dist", "browser", "index.js.map"), "utf8")
    ) as {
      readonly sources?: readonly string[];
      readonly sourcesContent?: readonly string[];
    };
    const staticImports = findStaticModuleSpecifiers("dist/browser/index.js", browserBundle);

    expect(browserBundle).toContain("//# sourceMappingURL=index.js.map");
    expect(staticImports).toEqual([]);
    expect(browserBundle).not.toMatch(/\b(?:node:fs|node:path|node:child_process|node:net|node:tls)\b/);
    expect(browserBundle).not.toMatch(/\b(?:from|import)\s*["'](?:fs|path|child_process|net|tls|http|https)["']/);
    expect(browserMap.sources?.some((source) => source.endsWith("src/runtime/engine.ts"))).toBe(true);
    expect(browserMap.sourcesContent?.some((source) => source.includes("export function createEngine"))).toBe(true);
  });

  it("emits declaration files for every public export entrypoint", async () => {
    const manifest = await readManifest();
    const exportedJavaScriptFiles = new Set<string>();
    const exportedDeclarationFiles = new Set<string>();

    for (const [subpath, condition] of Object.entries(manifest.exports)) {
      expect(subpath).not.toContain("*");
      expect(condition.types).toMatch(/\.d\.ts$/);
      expect(condition.types).not.toContain("*");
      expect(condition.import).not.toContain("*");
      expect(condition.default).not.toContain("*");
      exportedJavaScriptFiles.add(condition.import.slice(2));
      exportedDeclarationFiles.add(condition.types.slice(2));
    }

    const emittedDeclarationFiles = new Set<string>();

    for (const declarationFile of exportedDeclarationFiles) {
      const contents = await readFile(join(rootDir, declarationFile), "utf8");
      emittedDeclarationFiles.add(declarationFile);
      expect(contents.trim()).not.toBe("");
    }

    for (const javaScriptFile of exportedJavaScriptFiles) {
      expect(emittedDeclarationFiles.has(javaScriptFile.replace(/\.js$/, ".d.ts"))).toBe(true);
    }
  });

  it("does not expose explicit any in public declaration entrypoints", async () => {
    const manifest = await readManifest();
    const exportedDeclarationFiles = new Set(
      Object.values(manifest.exports).map((condition) => condition.types.slice(2))
    );
    const findings: ExplicitAnyFinding[] = [];

    for (const declarationFile of exportedDeclarationFiles) {
      const contents = await readFile(join(rootDir, declarationFile), "utf8");
      findings.push(...findExplicitAnyTypes(declarationFile, contents));
    }

    expect(findings).toEqual([]);
  });

  it("does not leak demo, benchmark, or deterministic testing helpers from package root entrypoints", async () => {
    const [root, browser] = await Promise.all([
      import("@dogpile/sdk"),
      import("@dogpile/sdk/browser")
    ]);
    const modules = [
      root as Record<string, unknown>,
      browser as Record<string, unknown>
    ];

    for (const moduleExports of modules) {
      expect(privateHelperExportNames.filter((name) => name in moduleExports)).toEqual([]);
    }
  });

  it("exposes demo, benchmark, and deterministic testing helpers through the source-only internal entrypoint", () => {
    expect(internalHelpers).toEqual(
      expect.objectContaining({
        attachDemoApp: expect.any(Function),
        benchmarkRunOptions: expect.any(Function),
        createBenchmarkRunArtifact: expect.any(Function),
        createDeterministicBroadcastTestMission: expect.any(Function),
        createDeterministicCoordinatorTestMission: expect.any(Function),
        createDeterministicModelProvider: expect.any(Function),
        createDeterministicSharedTestMission: expect.any(Function),
        createProtocolBenchmarkRunConfig: expect.any(Function),
        defineDemoWorkflowEntrypoint: expect.any(Function),
        requiredDemoTraceEventTypes: expect.any(Array),
        runBenchmarkWithStreamingEventLog: expect.any(Function),
        runCoordinatorBenchmark: expect.any(Function),
        runCoordinatorBenchmarkArtifact: expect.any(Function),
        runSequentialBenchmark: expect.any(Function),
        runSequentialBenchmarkArtifact: expect.any(Function),
        sampleDemoWorkflowControls: expect.any(Object),
        startDemoRun: expect.any(Function),
        startSampleWorkflow: expect.any(Function)
      })
    );
  });

  it("resolves public runtime and type subpaths through the package export map", () => {
    const protocol: ProtocolConfig = { kind: "sequential", maxTurns: 1 };
    const sequentialProtocol: SequentialProtocolConfig = { kind: "sequential", maxTurns: 1 };
    const broadcastProtocol: BroadcastProtocolConfig = { kind: "broadcast", maxRounds: 1 };
    const tracePrimitive: JsonPrimitive = "exports-smoke";
    const eventType: RunEvent["type"] = "final";

    expect(typeof createEngine).toBe("function");
    expect(typeof createOpenAICompatibleProvider).toBe("function");
    expect(createOpenAICompatibleProviderSubpath).toBe(createOpenAICompatibleProvider);
    expect(typeof BrowserDogpile.pile).toBe("function");
    expect(typeof browserRun).toBe("function");
    expect(typeof createBrowserEngine).toBe("function");
    expect(typeof createBrowserOpenAICompatibleProvider).toBe("function");
    expect(sequentialProtocol.kind).toBe("sequential");
    expect(broadcastProtocol.kind).toBe("broadcast");
    expect(tracePrimitive).toBe("exports-smoke");
    expect(eventType).toBe("final");
  });
});
