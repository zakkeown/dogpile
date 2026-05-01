#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const keepTemp = process.argv.includes("--keep-temp") || process.env.DOGPILE_KEEP_CONSUMER_SMOKE === "1";
const skipBuild = process.argv.includes("--skip-build");
const quickstartStartMarker = "<!-- dogpile-consumer-quickstart-smoke:start -->";
const quickstartEndMarker = "<!-- dogpile-consumer-quickstart-smoke:end -->";
const privateHelperRootExports = [
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
];
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
];
const privateHelperPackedFiles = [
  "dist/internal.js",
  "dist/internal.js.map",
  "dist/internal.d.ts",
  "dist/internal.d.ts.map",
  "dist/demo.js",
  "dist/demo.js.map",
  "dist/demo.d.ts",
  "dist/demo.d.ts.map",
  "dist/benchmark/config.js",
  "dist/benchmark/config.js.map",
  "dist/benchmark/config.d.ts",
  "dist/benchmark/config.d.ts.map",
  "dist/benchmark/coordinator.js",
  "dist/benchmark/coordinator.js.map",
  "dist/benchmark/coordinator.d.ts",
  "dist/benchmark/coordinator.d.ts.map",
  "dist/benchmark/sequential.js",
  "dist/benchmark/sequential.js.map",
  "dist/benchmark/sequential.d.ts",
  "dist/benchmark/sequential.d.ts.map",
  "dist/testing/deterministic-provider.js",
  "dist/testing/deterministic-provider.js.map",
  "dist/testing/deterministic-provider.d.ts",
  "dist/testing/deterministic-provider.d.ts.map",
  "src/internal.ts",
  "src/demo.ts",
  "src/benchmark/config.ts",
  "src/benchmark/coordinator.ts",
  "src/benchmark/sequential.ts",
  "src/testing/deterministic-provider.ts"
];
const privateHelperExportTargetPrefixes = [
  "./internal",
  "./demo",
  "./benchmark",
  "./testing",
  "./dist/internal",
  "./dist/demo",
  "./dist/benchmark",
  "./dist/testing",
  "./src/internal",
  "./src/demo",
  "./src/benchmark",
  "./src/testing"
];
const publicSubpathRuntimeExports = {
  browser: ["Dogpile", "createEngine", "createOpenAICompatibleProvider", "run", "stream"],
  types: ["DogpileError"],
  "providers/openai-compatible": ["createOpenAICompatibleProvider"],
  "runtime/broadcast": ["runBroadcast"],
  "runtime/coordinator": ["runCoordinator"],
  "runtime/defaults": ["normalizeProtocol", "defaultAgents", "tierTemperature", "createRunUsage"],
  "runtime/engine": ["Dogpile", "createEngine", "run", "stream", "replay", "replayStream"],
  "runtime/model": ["generateModelTurn"],
  "runtime/sequential": ["runSequential"],
  "runtime/shared": ["runShared"],
  "runtime/termination": ["budget", "convergence", "judge", "firstOf", "evaluateTermination"],
  "runtime/tools": ["runtimeToolManifest", "normalizeRuntimeToolAdapterError", "createRuntimeToolExecutor"]
};

async function main() {
  const manifest = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
  const tempDir = await mkdtemp(join(tmpdir(), "dogpile-consumer-quickstart-smoke-"));
  const packDir = join(tempDir, "pack");
  const consumerDir = join(tempDir, "consumer");

  await Promise.all([
    mkdir(packDir),
    mkdir(consumerDir)
  ]);

  try {
    if (skipBuild) {
      console.log(`Using existing ${manifest.name}@${manifest.version} build before packing.`);
    } else {
      console.log(`Building ${manifest.name}@${manifest.version} before packing.`);
      await run("pnpm", ["run", "build"], { cwd: rootDir });
    }

    await run("pnpm", ["run", "package:artifacts"], { cwd: rootDir });

    const sdkTarball = await packSdk(packDir);
    await writeConsumerProject(consumerDir);

    console.log(`Installing ${sdkTarball} into a fresh consumer project without provider SDK peer fixtures.`);
    await run("pnpm", [
      "add",
      "--ignore-scripts",
      "--offline",
      "--config.auto-install-peers=false",
      sdkTarball
    ], {
      cwd: consumerDir
    });
    await assertConsumerDependencyUsesPackedTarball({
      consumerDir,
      packageName: manifest.name,
      tarballPath: sdkTarball
    });

    const documentedQuickstart = await readInstalledDocumentedQuickstart(consumerDir, manifest.name);
    const smokeFile = join(consumerDir, "quickstart-smoke.mjs");
    await writeFile(smokeFile, createSmokeSource(manifest.name, documentedQuickstart), "utf8");
    const typeSmokeFile = join(consumerDir, "consumer-type-resolution-smoke.ts");
    await writeFile(typeSmokeFile, createTypeSmokeSource(manifest.name), "utf8");

    const { stdout } = await run("node", [smokeFile], { cwd: consumerDir });
    process.stdout.write(stdout);
    await runConsumerTypecheck(typeSmokeFile, consumerDir);
    console.log(`Consumer quickstart smoke passed for ${manifest.name}@${manifest.version}.`);
  } finally {
    if (keepTemp) {
      console.log(`Kept consumer quickstart smoke temp directory: ${tempDir}`);
    } else {
      await rm(tempDir, { force: true, recursive: true });
    }
  }
}

async function readInstalledDocumentedQuickstart(consumerDir, packageName) {
  const readmePath = join(consumerDir, "node_modules", ...packageName.split("/"), "README.md");
  const readme = await readFile(readmePath, "utf8");
  const source = extractMarkedTypescriptBlock(readme, readmePath);

  if (!source.includes(`from ${JSON.stringify(packageName)}`)) {
    throw new Error(`Documented quickstart must import the installed SDK package ${packageName}.`);
  }

  return source;
}

function extractMarkedTypescriptBlock(markdown, sourcePath) {
  const start = markdown.indexOf(quickstartStartMarker);
  const end = markdown.indexOf(quickstartEndMarker);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Expected ${sourcePath} to contain one marked consumer quickstart smoke block.`);
  }

  const blockStart = markdown.indexOf("```ts", start);
  const sourceStart = blockStart === -1 ? -1 : markdown.indexOf("\n", blockStart) + 1;
  const sourceEnd = sourceStart === 0 ? -1 : markdown.indexOf("\n```", sourceStart);

  if (blockStart === -1 || sourceStart === 0 || sourceEnd === -1 || sourceEnd > end) {
    throw new Error(`Expected ${sourcePath} quickstart smoke markers to wrap one TypeScript code block.`);
  }

  return markdown.slice(sourceStart, sourceEnd).trim();
}

async function packSdk(packDir) {
  const { stdout } = await run("pnpm", [
    "pack",
    "--json",
    "--pack-destination",
    packDir
  ], {
    cwd: rootDir
  });
  const packManifest = JSON.parse(stdout);

  if (packManifest.name !== "@dogpile/sdk") {
    throw new Error(`Expected pnpm pack to produce @dogpile/sdk; found ${JSON.stringify(packManifest.name)}.`);
  }

  if (typeof packManifest.filename !== "string") {
    throw new Error("Expected pnpm pack --json to report a tarball filename.");
  }

  return isAbsolute(packManifest.filename)
    ? packManifest.filename
    : resolve(rootDir, packManifest.filename);
}

async function assertConsumerDependencyUsesPackedTarball({ consumerDir, packageName, tarballPath }) {
  const [consumerManifest, consumerLockfile, installedPackageRealPath, consumerRealPath] = await Promise.all([
    readJson(join(consumerDir, "package.json")),
    readFile(join(consumerDir, "pnpm-lock.yaml"), "utf8"),
    realpath(join(consumerDir, "node_modules", ...packageName.split("/"))),
    realpath(consumerDir)
  ]);
  const dependencySpec = consumerManifest.dependencies?.[packageName];
  const normalizedTarballPath = resolve(tarballPath);
  const expectedTarballName = normalizedTarballPath.split("/").at(-1);
  const findings = [];

  if (typeof dependencySpec !== "string") {
    findings.push(`consumer package.json does not declare ${packageName} as a dependency.`);
  } else {
    if (!dependencySpec.startsWith("file:") || !dependencySpec.endsWith(".tgz")) {
      findings.push(
        `consumer package.json installs ${packageName} from ${JSON.stringify(dependencySpec)} instead of a packed .tgz tarball.`
      );
    }

    if (hasWorkspaceOrLinkSpecifier(dependencySpec)) {
      findings.push(`consumer package.json installs ${packageName} through a workspace/link specifier.`);
    }
  }

  if (typeof expectedTarballName !== "string" || !consumerLockfile.includes(expectedTarballName)) {
    findings.push(`consumer pnpm-lock.yaml does not reference the packed ${packageName} tarball ${expectedTarballName}.`);
  }

  const sdkLockfileEntries = consumerLockfile
    .split("\n")
    .filter((line) => line.includes(packageName) || line.includes(expectedTarballName ?? ""));

  if (!sdkLockfileEntries.some((line) => line.includes(".tgz"))) {
    findings.push(`consumer pnpm-lock.yaml does not resolve ${packageName} from a tarball.`);
  }

  if (hasWorkspaceOrLinkSpecifier(consumerLockfile)) {
    findings.push(`consumer pnpm-lock.yaml contains workspace/link dependency metadata.`);
  }

  for (const line of sdkLockfileEntries) {
    if (hasWorkspaceOrLinkSpecifier(line)) {
      findings.push(`consumer pnpm-lock.yaml resolves ${packageName} through workspace/link metadata: ${line.trim()}`);
    }
  }

  if (!isInsideDirectory(installedPackageRealPath, consumerRealPath)) {
    findings.push(
      `installed ${packageName} resolves outside the fresh consumer project: ${installedPackageRealPath}`
    );
  }

  if (findings.length > 0) {
    throw new Error(
      [
        `Fresh consumer install must use the packed ${packageName} tarball without workspace links.`,
        ...findings.map((finding) => `- ${finding}`)
      ].join("\n")
    );
  }

  console.log(`Consumer dependency install uses packed ${packageName} tarball without workspace links.`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function hasWorkspaceOrLinkSpecifier(value) {
  return /\b(?:workspace|link):/.test(value);
}

function isInsideDirectory(candidatePath, directoryPath) {
  const normalizedDirectory = directoryPath.endsWith("/") ? directoryPath : `${directoryPath}/`;

  return candidatePath === directoryPath || candidatePath.startsWith(normalizedDirectory);
}

async function writeConsumerProject(consumerDir) {
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify({
      name: "dogpile-consumer-quickstart-smoke",
      private: true,
      type: "module",
      version: "0.0.0"
    }, null, 2)}\n`,
    "utf8"
  );
}

function createSmokeSource(packageName, documentedQuickstart) {
  return `import { access, readFile, readdir } from "node:fs/promises";

const sdk = await import(${JSON.stringify(packageName)});
const packageName = ${JSON.stringify(packageName)};

const requiredExports = [
  "Dogpile",
  "createEngine",
  "createOpenAICompatibleProvider",
  "run",
  "stream"
];
const missingExports = requiredExports.filter((name) => !(name in sdk));

if (missingExports.length > 0) {
  throw new Error(\`Missing expected exports from ${packageName}: \${missingExports.join(", ")}\`);
}

const forbiddenRootExports = ${JSON.stringify(privateHelperRootExports, null, 2)};
const unexpectedRootExports = forbiddenRootExports.filter((name) => name in sdk);

if (unexpectedRootExports.length > 0) {
  throw new Error(\`Unexpected private helper exports from ${packageName} root entrypoint: \${unexpectedRootExports.join(", ")}\`);
}

const forbiddenHelperPackageSubpaths = ${JSON.stringify(privateHelperPackageSubpaths, null, 2)};
const forbiddenHelperPackedFiles = ${JSON.stringify(privateHelperPackedFiles, null, 2)};
const forbiddenHelperExportTargetPrefixes = ${JSON.stringify(privateHelperExportTargetPrefixes, null, 2)};
const publicSubpathRuntimeExports = ${JSON.stringify(publicSubpathRuntimeExports, null, 2)};
const installedManifest = JSON.parse(
  await readFile(new URL(\`./node_modules/\${packageName}/package.json\`, import.meta.url), "utf8")
);

assertInstalledPackageUsesTarballEntrypoints(packageName, installedManifest);
await assertPackedDistDoesNotImportLocalSources(packageName);
assertPackageJsonDoesNotExposePrivateHelpers(installedManifest, forbiddenHelperExportTargetPrefixes);
await assertPackedPrivateHelperFilesAbsent(packageName, forbiddenHelperPackedFiles);
await assertPrivateHelperSubpathsBlocked(packageName, forbiddenHelperPackageSubpaths);
await assertPublicSubpathsImportable(packageName, installedManifest, publicSubpathRuntimeExports);

if (typeof sdk.Dogpile?.pile !== "function") {
  throw new Error("Expected Dogpile.pile to be importable from ${packageName}.");
}

${documentedQuickstart}

assertEqual(result.output, "quickstart turn 3 completed", "quickstart final output");
assertEqual(result.metadata.protocol, "sequential", "quickstart default protocol");
assertEqual(result.metadata.tier, "balanced", "quickstart default tier");
assertEqual(result.metadata.modelProviderId, "quickstart-provider", "quickstart model provider id");
assertEqual(result.trace.inputs.intent, "Draft a migration plan for an SDK release.", "quickstart trace intent");
assertEqual(result.trace.providerCalls.length, result.transcript.length, "quickstart transcript/provider call parity");
assertEqual(result.eventLog.eventTypes.at(-1), "final", "quickstart terminal event");
assertEqual(result.usage.inputTokens, 30, "quickstart accumulated input tokens");
assertEqual(result.usage.outputTokens, 12, "quickstart accumulated output tokens");
assertEqual(result.usage.totalTokens, 42, "quickstart accumulated total tokens");

if (!result.eventLog.eventTypes.includes("role-assignment") || !result.eventLog.eventTypes.includes("agent-turn")) {
  throw new Error("Expected quickstart run to emit role-assignment and agent-turn events.");
}

if (!(result.usage.usd > 0)) {
  throw new Error("Expected quickstart run to compute usage.usd from the supplied pricing table.");
}

console.log("${packageName} imported and executed the documented quickstart from a fresh consumer project.");

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(\`Expected \${label} to be \${JSON.stringify(expected)}, received \${JSON.stringify(actual)}.\`);
  }
}

function assertInstalledPackageUsesTarballEntrypoints(packageName, manifest) {
  const findings = [];

  for (const { source, target } of collectPackageRuntimeTargets(manifest)) {
    if (!isRuntimeOrDeclarationTarget(target)) {
      continue;
    }

    if (!target.startsWith("./dist/") || isLocalSourceEntrypoint(target)) {
      findings.push(source + " -> " + JSON.stringify(target));
    }
  }

  if (findings.length > 0) {
    throw new Error(
      "Installed " + packageName + " package metadata must resolve consumers through packaged dist artifacts, not local source entrypoints: " +
        findings.join(", ")
    );
  }
}

function collectPackageRuntimeTargets(manifest) {
  const targets = [];

  for (const fieldName of ["main", "module", "browser", "types"]) {
    if (typeof manifest[fieldName] === "string") {
      targets.push({
        source: "package.json " + fieldName,
        target: manifest[fieldName]
      });
    }
  }

  targets.push(...collectPackageExportTargetsWithSources("package.json exports", manifest.exports));

  return targets;
}

function collectPackageExportTargetsWithSources(source, value) {
  if (typeof value === "string") {
    return [{ source, target: value }];
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const nestedSource = key.startsWith(".")
      ? source + "[" + JSON.stringify(key) + "]"
      : source + "." + key;

    return collectPackageExportTargetsWithSources(nestedSource, nestedValue);
  });
}

function isRuntimeOrDeclarationTarget(target) {
  return target.endsWith(".js") || /\\.d\\.[cm]?ts$/.test(target);
}

function isLocalSourceEntrypoint(target) {
  return target.startsWith("/") ||
    target.startsWith("file:") ||
    target.startsWith("./src/") ||
    target.includes("/src/") ||
    target.includes("workspace:") ||
    target.includes("link:") ||
    isTypeScriptSourceSpecifier(target);
}

async function assertPackedDistDoesNotImportLocalSources(packageName) {
  const distFiles = await collectInstalledPackageFiles(
    new URL("./node_modules/" + packageName + "/dist/", import.meta.url),
    "dist"
  );
  const codeFiles = distFiles.filter((file) => file.endsWith(".js") || file.endsWith(".d.ts"));
  const findings = [];

  for (const file of codeFiles) {
    const contents = await readFile(new URL("./node_modules/" + packageName + "/" + file, import.meta.url), "utf8");

    for (const specifier of findStaticModuleSpecifiers(contents)) {
      if (isLocalSourceImportSpecifier(specifier)) {
        findings.push(file + " imports " + JSON.stringify(specifier));
      }
    }
  }

  if (findings.length > 0) {
    throw new Error(
      "Installed " + packageName + " dist artifacts must not import workspace links or local source files: " +
        findings.join(", ")
    );
  }
}

async function collectInstalledPackageFiles(directoryUrl, packageRelativeDirectory) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const childRelativePath = packageRelativeDirectory + "/" + entry.name;

    if (entry.isDirectory()) {
      files.push(...await collectInstalledPackageFiles(
        new URL(entry.name + "/", directoryUrl),
        childRelativePath
      ));
      continue;
    }

    if (entry.isFile()) {
      files.push(childRelativePath);
    }
  }

  return files;
}

function findStaticModuleSpecifiers(contents) {
  const specifiers = [];
  const moduleSpecifierPattern = /\\b(?:import|export)\\s+(?:type\\s+)?(?:[^"'()]*?\\s+from\\s+)?["']([^"']+)["']|\\bimport\\s*\\(\\s*["']([^"']+)["']\\s*\\)/g;

  for (const match of contents.matchAll(moduleSpecifierPattern)) {
    const specifier = match[1] ?? match[2];

    if (typeof specifier === "string") {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function isLocalSourceImportSpecifier(specifier) {
  return specifier.startsWith("/") ||
    specifier.startsWith("file:") ||
    specifier.startsWith("./src/") ||
    specifier.startsWith("../src/") ||
    specifier.includes("/src/") ||
    specifier.includes("workspace:") ||
    specifier.includes("link:") ||
    isTypeScriptSourceSpecifier(specifier);
}

function isTypeScriptSourceSpecifier(specifier) {
  return (specifier.endsWith(".ts") || specifier.endsWith(".tsx")) && !specifier.endsWith(".d.ts");
}

function assertPackageJsonDoesNotExposePrivateHelpers(manifest, forbiddenPrefixes) {
  if (typeof manifest.exports !== "object" || manifest.exports === null || Array.isArray(manifest.exports)) {
    throw new Error(\`Expected \${packageName} package.json exports to be an object that blocks private helper subpaths.\`);
  }

  const findings = [];

  for (const [exportKey, condition] of Object.entries(manifest.exports)) {
    if (exportKey.includes("*")) {
      findings.push(\`\${exportKey} uses a wildcard export\`);
    }

    if (matchesForbiddenHelperPrefix(exportKey, forbiddenPrefixes)) {
      findings.push(exportKey);
    }

    for (const target of collectPackageExportTargets(condition)) {
      if (target.includes("*")) {
        findings.push(\`\${exportKey} -> \${target} uses a wildcard export target\`);
      }

      if (matchesForbiddenHelperPrefix(target, forbiddenPrefixes)) {
        findings.push(\`\${exportKey} -> \${target}\`);
      }
    }
  }

  if (findings.length > 0) {
    throw new Error(\`Unexpected private helper package.json exports from \${packageName}: \${findings.join(", ")}\`);
  }
}

function collectPackageExportTargets(condition) {
  if (typeof condition === "string") {
    return [condition];
  }

  if (typeof condition !== "object" || condition === null || Array.isArray(condition)) {
    return [];
  }

  return Object.values(condition).flatMap(collectPackageExportTargets);
}

function matchesForbiddenHelperPrefix(value, forbiddenPrefixes) {
  return forbiddenPrefixes.some((prefix) => value === prefix || value.startsWith(\`\${prefix}/\`) || value.startsWith(\`\${prefix}.\`));
}

async function assertPackedPrivateHelperFilesAbsent(packageName, forbiddenFiles) {
  const packedPrivateFiles = [];

  for (const file of forbiddenFiles) {
    const fileUrl = new URL(\`./node_modules/\${packageName}/\${file}\`, import.meta.url);

    try {
      await access(fileUrl);
      packedPrivateFiles.push(file);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw new Error(
          \`Expected private helper file check for \${file} to resolve as absent; received \${formatImportError(error)}.\`
        );
      }
    }
  }

  if (packedPrivateFiles.length > 0) {
    throw new Error(\`Unexpected private helper files packed in \${packageName}: \${packedPrivateFiles.join(", ")}\`);
  }
}

async function assertPrivateHelperSubpathsBlocked(packageName, forbiddenSubpaths) {
  const exposedSubpaths = [];

  for (const subpath of forbiddenSubpaths) {
    const specifier = \`\${packageName}/\${subpath}\`;

    try {
      await import(specifier);
      exposedSubpaths.push(specifier);
    } catch (error) {
      if (!isBlockedPackageSubpathError(error)) {
        throw new Error(
          \`Expected private helper subpath import \${specifier} to be blocked by package exports; received \${formatImportError(error)}.\`
        );
      }
    }
  }

  if (exposedSubpaths.length > 0) {
    throw new Error(\`Unexpected private helper subpath imports from \${packageName}: \${exposedSubpaths.join(", ")}\`);
  }
}

async function assertPublicSubpathsImportable(packageName, manifest, expectedSubpathExports) {
  const exportKeys = Object.keys(manifest.exports).filter((key) => key !== ".");
  const missingSubpaths = Object.keys(expectedSubpathExports)
    .map((subpath) => \`./\${subpath}\`)
    .filter((exportKey) => !exportKeys.includes(exportKey));

  if (missingSubpaths.length > 0) {
    throw new Error(\`Expected public subpaths to be present in \${packageName} package exports: \${missingSubpaths.join(", ")}\`);
  }

  for (const exportKey of exportKeys) {
    const subpath = exportKey.slice(2);
    const specifier = \`\${packageName}/\${subpath}\`;
    const imported = await import(specifier);
    const expectedExports = expectedSubpathExports[subpath] ?? [];
    const missingExports = expectedExports.filter((name) => !(name in imported));

    if (missingExports.length > 0) {
      throw new Error(\`Expected \${specifier} to export \${missingExports.join(", ")}.\`);
    }
  }
}

function isBlockedPackageSubpathError(error) {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);

  return code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
    code === "ERR_MODULE_NOT_FOUND" ||
    code === "MODULE_NOT_FOUND" ||
    /not exported|Cannot find module|Failed to resolve|Missing ".+" specifier/.test(message);
}

function isMissingFileError(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function formatImportError(error) {
  if (error instanceof Error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;

    return code === undefined ? error.message : \`\${String(code)}: \${error.message}\`;
  }

  return String(error);
}
`;
}

function createTypeSmokeSource(packageName) {
  return `import {
  Dogpile,
  DogpileError,
  createEngine,
  createOpenAICompatibleProvider,
  replay,
  replayStream,
  run,
  stream,
  type AgentDecision,
  type AgentParticipation,
  type ConfiguredModelProvider,
  type DogpileOptions,
  type Engine,
  type EngineOptions,
  type ProtocolConfig,
  type RunEvent,
  type RunResult,
  type SharedProtocolConfig,
  type StreamHandle,
  type Trace
} from ${JSON.stringify(packageName)};
import {
  Dogpile as BrowserDogpile,
  createEngine as createBrowserEngine,
  createOpenAICompatibleProvider as createBrowserOpenAICompatibleProvider,
  run as browserRun,
  stream as browserStream
} from ${JSON.stringify(`${packageName}/browser`)};
import {
  DogpileError as TypesDogpileError,
  type AgentDecision as TypesAgentDecision,
  type JsonPrimitive,
  type ProtocolConfig as TypesProtocolConfig
} from ${JSON.stringify(`${packageName}/types`)};
import { createOpenAICompatibleProvider as createOpenAICompatibleProviderFromSubpath } from ${JSON.stringify(`${packageName}/providers/openai-compatible`)};
import { runBroadcast } from ${JSON.stringify(`${packageName}/runtime/broadcast`)};
import { runCoordinator } from ${JSON.stringify(`${packageName}/runtime/coordinator`)};
import {
  createRunUsage,
  defaultAgents,
  normalizeProtocol,
  tierTemperature
} from ${JSON.stringify(`${packageName}/runtime/defaults`)};
import {
  Dogpile as EngineDogpile,
  createEngine as createEngineFromSubpath,
  replay as replayFromSubpath,
  replayStream as replayStreamFromSubpath,
  run as runFromSubpath,
  stream as streamFromSubpath
} from ${JSON.stringify(`${packageName}/runtime/engine`)};
import { generateModelTurn } from ${JSON.stringify(`${packageName}/runtime/model`)};
import { runSequential } from ${JSON.stringify(`${packageName}/runtime/sequential`)};
import { runShared } from ${JSON.stringify(`${packageName}/runtime/shared`)};
import {
  budget,
  convergence,
  evaluateTermination,
  firstOf,
  judge
} from ${JSON.stringify(`${packageName}/runtime/termination`)};
import {
  createRuntimeToolExecutor,
  normalizeRuntimeToolAdapterError,
  runtimeToolManifest,
  type RuntimeToolExecutorOptions
} from ${JSON.stringify(`${packageName}/runtime/tools`)};

const provider: ConfiguredModelProvider = {
  id: "consumer-type-provider",
  async generate() {
    return {
      text: "consumer type resolution completed",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    };
  }
};
const protocol: ProtocolConfig = { kind: "sequential", maxTurns: 1 };
const protocolFromTypesSubpath: TypesProtocolConfig = { kind: "broadcast", maxRounds: 1 };
const sharedProtocol: SharedProtocolConfig = {
  kind: "shared",
  maxTurns: 2,
  organizationalMemory: "prior organizational memory"
};
const agentDecision: AgentDecision = {
  type: "participate",
  selectedRole: "consumer smoke reviewer",
  participation: "contribute",
  rationale: "The public package should expose structured agent decisions.",
  contribution: "Verify AgentDecision resolves from the package root."
};
const participation: AgentParticipation =
  agentDecision.type === "participate" ? agentDecision.participation : "abstain";
const agentDecisionFromTypesSubpath: TypesAgentDecision = agentDecision;
const primitiveFromTypesSubpath: JsonPrimitive = "consumer-type-resolution";
const options: DogpileOptions = {
  intent: "Verify the packed SDK resolves from a clean consumer project.",
  protocol,
  tier: "fast",
  model: provider
};
const engineOptions: EngineOptions = {
  protocol,
  tier: "fast",
  model: provider
};
const engine: Engine = createEngine(engineOptions);
const subpathEngine: Engine = createEngineFromSubpath({
  protocol: protocolFromTypesSubpath,
  tier: "fast",
  model: provider
});
const directProvider: ConfiguredModelProvider = createOpenAICompatibleProvider({
  id: "consumer-type-openai-compatible-root",
  model: "gpt-4.1-mini",
  apiKey: "test-key"
});
const directProviderFromSubpath: ConfiguredModelProvider = createOpenAICompatibleProviderFromSubpath({
  id: "consumer-type-openai-compatible-subpath",
  model: "gpt-4.1-mini",
  apiKey: "test-key"
});
const browserDirectProvider: ConfiguredModelProvider = createBrowserOpenAICompatibleProvider({
  id: "consumer-type-openai-compatible-browser",
  model: "gpt-4.1-mini",
  apiKey: "test-key"
});

const runResult: Promise<RunResult> = run(options);
const runResultFromNamespace: Promise<RunResult> = Dogpile.pile(options);
const runResultFromSubpath: Promise<RunResult> = runFromSubpath(options);
const runResultFromEngineNamespace: Promise<RunResult> = EngineDogpile.pile(options);
const runResultFromBrowser: Promise<RunResult> = browserRun(options);
const streamHandle: StreamHandle = stream(options);
const streamHandleFromNamespace: StreamHandle = Dogpile.stream(options);
const streamHandleFromSubpath: StreamHandle = streamFromSubpath(options);
const streamHandleFromBrowser: StreamHandle = browserStream(options);
const engineRunResult: Promise<RunResult> = engine.run(options.intent);
const subpathEngineRunResult: Promise<RunResult> = subpathEngine.run(options.intent);
const browserEngineRunResult: Promise<RunResult> = createBrowserEngine(engineOptions).run(options.intent);
const agents = defaultAgents();
const usage = createRunUsage({ inputTokens: 1, outputTokens: 1, totalTokens: 2, usd: 0.01 });
const normalized = normalizeProtocol("sequential");
const fastTemperature: number = tierTemperature("fast");
const stopOnBudget = budget({ maxTokens: 2 });
const stopOnConvergence = convergence({ stableTurns: 1, minSimilarity: 0.9 });
const stopOnJudge = judge({ rubric: "accept" });
const stopOnFirst = firstOf(stopOnBudget, stopOnConvergence);
const toolManifest = runtimeToolManifest([]);
const adapterError = normalizeRuntimeToolAdapterError(new Error("tool failed"));
const executorOptions = {
  runId: "consumer-type-run",
  protocol: "sequential",
  tier: "fast",
  tools: [],
  emit() {},
  getTrace() {
    return { events: [], transcript: [] };
  }
} satisfies RuntimeToolExecutorOptions;
const toolExecutor = createRuntimeToolExecutor(executorOptions);
const runners = [
  runBroadcast,
  runCoordinator,
  runSequential,
  runShared,
  generateModelTurn
] satisfies readonly unknown[];

function recordEvent(event: RunEvent): string {
  switch (event.type) {
    case "role-assignment":
    case "model-request":
    case "model-response":
    case "model-output-chunk":
    case "agent-turn":
    case "broadcast":
    case "tool-call":
    case "tool-result":
    case "budget-stop":
    case "sub-run-started":
    case "sub-run-completed":
    case "sub-run-failed":
    case "sub-run-parent-aborted":
    case "final":
      return event.type;
  }
}

export async function consumerTypeResolutionSmoke(): Promise<Trace> {
  const [result] = await Promise.all([
    runResult,
    runResultFromNamespace,
    runResultFromSubpath,
    runResultFromEngineNamespace,
    runResultFromBrowser,
    streamHandle.result,
    streamHandleFromNamespace.result,
    streamHandleFromSubpath.result,
    streamHandleFromBrowser.result,
    engineRunResult,
    subpathEngineRunResult,
    browserEngineRunResult
  ]);
  const [event] = result.eventLog.events;

  if (event) {
    recordEvent(event);
  }

  const roundTrip = replay(result.trace);
  const roundTripFromSubpath = replayFromSubpath(result.trace);
  const roundTripStream = replayStream(result.trace);
  const roundTripStreamFromSubpath = replayStreamFromSubpath(result.trace);

  if (
    !(DogpileError === TypesDogpileError) ||
    !(BrowserDogpile.pile === Dogpile.pile) ||
    !(directProvider.id === "consumer-type-openai-compatible-root") ||
    !(directProviderFromSubpath.id === "consumer-type-openai-compatible-subpath") ||
    !(browserDirectProvider.id === "consumer-type-openai-compatible-browser") ||
    normalized.kind !== "sequential" ||
    primitiveFromTypesSubpath !== "consumer-type-resolution" ||
    sharedProtocol.organizationalMemory !== "prior organizational memory" ||
    participation !== "contribute" ||
    agentDecision.type !== "participate" ||
    agentDecisionFromTypesSubpath.type !== "participate" ||
    agentDecisionFromTypesSubpath.selectedRole !== agentDecision.selectedRole ||
    usage.totalTokens !== 2 ||
    fastTemperature < 0 ||
    stopOnFirst.kind !== "firstOf" ||
    stopOnJudge.kind !== "judge" ||
    toolManifest.length !== 0 ||
    adapterError.code.length === 0 ||
    !toolExecutor ||
    runners.length !== 5 ||
    agents.length === 0 ||
    evaluateTermination(stopOnBudget, {
      runId: result.metadata.runId,
      protocol: result.metadata.protocol,
      tier: result.metadata.tier,
      events: result.eventLog.events,
      transcript: result.transcript,
      cost: result.cost
    }).type !== "continue" ||
    roundTrip.output !== result.output ||
    roundTripFromSubpath.output !== result.output ||
    roundTripStream.status !== "completed" ||
    roundTripStreamFromSubpath.status !== "completed"
  ) {
    throw new Error("Consumer type resolution smoke should remain type-safe and runtime coherent.");
  }

  return result.trace;
}
`;
}

async function runConsumerTypecheck(typeSmokeFile, consumerDir) {
  await run("node", [
    join(rootDir, "node_modules", "typescript", "bin", "tsc"),
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
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--skipLibCheck",
    "--verbatimModuleSyntax",
    typeSmokeFile
  ], {
    cwd: consumerDir
  });
  console.log("Consumer type resolution smoke passed for installed package root and public subpaths.");
}

async function run(command, args, options) {
  try {
    return await execFileAsync(command, args, {
      ...options,
      maxBuffer: 20 * 1024 * 1024
    });
  } catch (error) {
    const execError = error;
    const output = [
      execError.stdout ? `stdout:\n${execError.stdout}` : "",
      execError.stderr ? `stderr:\n${execError.stderr}` : ""
    ].filter(Boolean).join("\n\n");

    throw new Error(`Command failed: ${command} ${args.join(" ")}${output ? `\n${output}` : ""}`);
  }
}

await main();
