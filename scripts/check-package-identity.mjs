#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedPackageName = "@dogpile/sdk";
const expectedVersion = "1.0.0";
const expectedPackFilename = "dogpile-sdk-1.0.0.tgz";
const expectedPackageMetadata = {
  license: "Apache-2.0",
  repository: {
    type: "git",
    url: "git+https://github.com/zakkeown/dogpile.git"
  },
  bugs: {
    url: "https://github.com/zakkeown/dogpile/issues"
  },
  homepage: "https://github.com/zakkeown/dogpile#readme",
  keywords: [
    "ai",
    "agents",
    "llm",
    "multi-agent",
    "protocols",
    "openai-compatible",
    "provider-neutral",
    "typescript"
  ],
  packageManager: "pnpm@10.33.0",
  publishConfig: {
    access: "public"
  }
};
const rootDir = readRootDir(process.argv.slice(2));

const ignoredDirectories = new Set([
  ".git",
  ".npm-cache",
  "dist",
  "node_modules"
]);

const ignoredFiles = new Set([
  "tsconfig.tsbuildinfo",
  "pnpm-lock.yaml"
]);

const staleReferencePatterns = [
  {
    label: "bare package.json name",
    pattern: /"name"\s*:\s*"dogpile"/g
  },
  {
    label: "bare package import",
    pattern: /\b(?:from|import)\s+["']dogpile(?:\/[^"']*)?["']/g
  },
  {
    label: "bare dynamic import",
    pattern: /\bimport\s*\(\s*["']dogpile(?:\/[^"']*)?["']\s*\)/g
  },
  {
    label: "bare require import",
    pattern: /\brequire\s*\(\s*["']dogpile(?:\/[^"']*)?["']\s*\)/g
  },
  {
    label: "bare npm install command",
    pattern: /\bnpm\s+(?:install|i)\s+(?:--?[A-Za-z0-9-]+(?:[=\s][^\s]+)?\s+)*dogpile(?:@[^\s]+)?(?=\s|$)/g
  },
  {
    label: "bare pnpm add command",
    pattern: /\bpnpm\s+add\s+(?:--?[A-Za-z0-9-]+(?:[=\s][^\s]+)?\s+)*dogpile(?:@[^\s]+)?(?=\s|$)/g
  },
  {
    label: "bare yarn add command",
    pattern: /\byarn\s+add\s+(?:--?[A-Za-z0-9-]+(?:[=\s][^\s]+)?\s+)*dogpile(?:@[^\s]+)?(?=\s|$)/g
  },
  {
    label: "bare bun add command",
    pattern: /\bbun\s+add\s+(?:--?[A-Za-z0-9-]+(?:[=\s][^\s]+)?\s+)*dogpile(?:@[^\s]+)?(?=\s|$)/g
  }
];

async function main() {
  const manifest = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
  const findings = [];

  if (manifest.name !== expectedPackageName) {
    findings.push(`package.json name must be ${expectedPackageName}; found ${JSON.stringify(manifest.name)}.`);
  }

  if (manifest.version !== expectedVersion) {
    findings.push(`package.json version must be ${expectedVersion}; found ${JSON.stringify(manifest.version)}.`);
  }

  for (const [field, expectedValue] of Object.entries(expectedPackageMetadata)) {
    const actualValue = manifest[field];

    if (!sameJsonValue(actualValue, expectedValue)) {
      findings.push(
        `package.json ${field} must be ${JSON.stringify(expectedValue)}; found ${JSON.stringify(actualValue)}.`
      );
    }
  }

  const files = await collectFiles(rootDir);

  for (const file of files) {
    const contents = await readFile(file, "utf8");
    const relativePath = relative(rootDir, file);

    for (const { label, pattern } of staleReferencePatterns) {
      pattern.lastIndex = 0;

      for (const match of contents.matchAll(pattern)) {
        const location = getLocation(contents, match.index ?? 0);
        findings.push(`${relativePath}:${location.line}:${location.column} uses stale unscoped ${label}: ${match[0]}`);
      }
    }
  }

  if (findings.length > 0) {
    console.error(`Package identity check failed. Use ${expectedPackageName} for public package references.`);
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Package identity check passed for ${expectedPackageName}@${expectedVersion} (${expectedPackFilename}).`);
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }

      files.push(...await collectFiles(path));
      continue;
    }

    if (entry.isFile() && shouldScanFile(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

function shouldScanFile(fileName) {
  if (ignoredFiles.has(fileName)) {
    return false;
  }

  return /\.(?:c?js|mjs|ts|tsx|json|md|ya?ml)$/.test(fileName);
}

function getLocation(contents, index) {
  const lines = contents.slice(0, index).split("\n");

  return {
    line: lines.length,
    column: lines.at(-1).length + 1
  };
}

function sameJsonValue(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function readRootDir(args) {
  const rootFlagIndex = args.indexOf("--root");

  if (rootFlagIndex === -1) {
    return fileURLToPath(new URL("..", import.meta.url));
  }

  const root = args[rootFlagIndex + 1];

  if (!root) {
    throw new Error("Expected --root to be followed by a directory.");
  }

  return resolve(root);
}

await main();
