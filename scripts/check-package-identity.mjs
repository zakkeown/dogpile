#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedPackageMetadata = {
  license: "Apache-2.0",
  repository: {
    type: "git",
    url: "git+https://github.com/bubstack/dogpile.git"
  },
  bugs: {
    url: "https://github.com/bubstack/dogpile/issues"
  },
  homepage: "https://github.com/bubstack/dogpile#readme",
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
const scriptDir = dirname(fileURLToPath(import.meta.url));
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
  }
];

const staleCommandReferences = [
  {
    label: "bare npm install command",
    command: "npm",
    verbs: new Set(["install", "i"])
  },
  {
    label: "bare pnpm add command",
    command: "pnpm",
    verbs: new Set(["add"])
  },
  {
    label: "bare yarn add command",
    command: "yarn",
    verbs: new Set(["add"])
  },
  {
    label: "bare bun add command",
    command: "bun",
    verbs: new Set(["add"])
  }
];

async function main() {
  const releaseIdentity = await readReleaseIdentity();
  const expectedPackageName = releaseIdentity.packageName;
  const expectedVersion = releaseIdentity.version;
  const expectedPackFilename = releaseIdentity.packFilename;
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

  findings.push(...await checkReleaseReferences({
    expectedPackageName,
    expectedVersion,
    expectedPackFilename
  }));

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

    findings.push(...findStaleCommandReferences(contents, relativePath));
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

async function readReleaseIdentity() {
  const identity = JSON.parse(await readFile(join(scriptDir, "release-identity.json"), "utf8"));

  if (
    typeof identity !== "object" ||
    identity === null ||
    typeof identity.packageName !== "string" ||
    typeof identity.version !== "string" ||
    typeof identity.packFilename !== "string"
  ) {
    throw new Error("scripts/release-identity.json must declare packageName, version, and packFilename strings.");
  }

  return identity;
}

async function checkReleaseReferences({ expectedPackageName, expectedVersion, expectedPackFilename }) {
  const checks = [
    {
      path: "README.md",
      snippets: [
        `${expectedPackageName}@${expectedVersion}`,
        expectedPackFilename
      ]
    },
    {
      path: "CHANGELOG.md",
      snippets: [
        `## ${expectedVersion}`,
        `${expectedPackageName}@${expectedVersion}`,
        expectedPackFilename
      ]
    }
  ];
  const findings = [];

  for (const check of checks) {
    const filePath = join(rootDir, check.path);
    let contents = "";

    try {
      contents = await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        findings.push(`${check.path} must exist and include the current release identity.`);
        continue;
      }
      throw error;
    }

    for (const snippet of check.snippets) {
      if (!contents.includes(snippet)) {
        findings.push(`${check.path} must include current release identity snippet ${JSON.stringify(snippet)}.`);
      }
    }
  }

  return findings;
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

function findStaleCommandReferences(contents, relativePath) {
  const findings = [];
  const lines = contents.split("\n");

  for (const [lineIndex, line] of lines.entries()) {
    const tokens = tokenizeShellLine(line);

    for (const { label, command, verbs } of staleCommandReferences) {
      for (let tokenIndex = 0; tokenIndex < tokens.length - 1; tokenIndex += 1) {
        if (tokens[tokenIndex].value !== command || !verbs.has(tokens[tokenIndex + 1].value)) {
          continue;
        }

        for (const token of tokens.slice(tokenIndex + 2)) {
          const value = trimTokenPunctuation(token.value);

          if (isBareDogpilePackage(value)) {
            findings.push(
              `${relativePath}:${lineIndex + 1}:${token.column} uses stale unscoped ${label}: ${value}`
            );
          }
        }
      }
    }
  }

  return findings;
}

function tokenizeShellLine(line) {
  const tokens = [];
  let token = "";
  let tokenColumn = 1;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === " " || char === "\t") {
      if (token) {
        tokens.push({ value: token, column: tokenColumn });
        token = "";
      }
      continue;
    }

    if (!token) {
      tokenColumn = index + 1;
    }

    token += char;
  }

  if (token) {
    tokens.push({ value: token, column: tokenColumn });
  }

  return tokens;
}

function trimTokenPunctuation(token) {
  let start = 0;
  let end = token.length;

  while (start < end && isTokenPunctuation(token[start])) {
    start += 1;
  }

  while (end > start && isTokenPunctuation(token[end - 1])) {
    end -= 1;
  }

  return token.slice(start, end);
}

function isTokenPunctuation(char) {
  return char === "`" ||
    char === "\"" ||
    char === "'" ||
    char === "," ||
    char === "." ||
    char === ";" ||
    char === ")";
}

function isBareDogpilePackage(token) {
  return token === "dogpile" ||
    token.startsWith("dogpile@") ||
    token.startsWith("dogpile/");
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

function isMissingFileError(error) {
  return typeof error === "object" && error !== null && error.code === "ENOENT";
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
