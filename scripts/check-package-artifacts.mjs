#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = readRootDir(process.argv.slice(2));

async function main() {
  const manifest = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
  const allPackageFiles = await collectFiles(rootDir);
  const filesEntries = readFilesEntries(manifest);
  const referencedArtifacts = collectReferencedArtifacts(manifest);
  const packagedArtifactPatterns = collectPackagedArtifactPatterns(filesEntries);
  const packagedArtifacts = expandPackagedArtifactPatterns(packagedArtifactPatterns, allPackageFiles);
  const artifacts = mergeArtifacts(referencedArtifacts, packagedArtifacts.artifacts);
  const findings = [];

  findings.push(...packagedArtifacts.findings);

  for (const artifact of artifacts.values()) {
    const filePath = join(rootDir, artifact.path);

    try {
      const fileStat = await stat(filePath);

      if (!fileStat.isFile()) {
        findings.push(`${formatSources(artifact.sources)} references ${artifact.path}, but it is not a file.`);
      } else if (fileStat.size === 0) {
        findings.push(`${formatSources(artifact.sources)} references ${artifact.path}, but the emitted file is empty.`);
      }
    } catch (error) {
      if (isMissingFileError(error)) {
        findings.push(`${formatSources(artifact.sources)} references ${artifact.path}, but the file was not emitted.`);
      } else {
        throw error;
      }
    }
  }

  for (const artifact of referencedArtifacts.values()) {
    if (filesEntries !== null && !matchesAnyFilesEntry(artifact.path, filesEntries)) {
      findings.push(
        `${formatSources(artifact.sources)} references ${artifact.path}, but package.json files would not include it in the tarball.`
      );
    }
  }

  if (findings.length > 0) {
    console.error("Package artifact check failed. Run pnpm run build before pnpm pack.");

    for (const finding of findings) {
      console.error(`- ${finding}`);
    }

    process.exitCode = 1;
    return;
  }

  const artifactCounts = countArtifactKinds(artifacts.values());

  console.log(
    [
      "Package artifact check passed:",
      `${artifactCounts.javascript} runtime JavaScript artifacts and`,
      `${artifactCounts.declarations} TypeScript declaration artifacts referenced by package metadata`,
      "exist before pack and are covered by package.json files."
    ].join(" ")
  );
}

function collectReferencedArtifacts(manifest) {
  const artifacts = new Map();

  for (const fieldName of ["main", "module", "browser", "types"]) {
    addPackagePathArtifact({
      artifacts,
      source: `package.json ${fieldName}`,
      value: manifest[fieldName]
    });
  }

  collectExportArtifacts({
    artifacts,
    label: "package.json exports",
    value: manifest.exports
  });

  return artifacts;
}

function collectExportArtifacts({ artifacts, label, value }) {
  if (typeof value === "string") {
    addPackagePathArtifact({ artifacts, source: label, value });
    return;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedLabel = isPackageSubpathKey(key)
      ? `${label}[${JSON.stringify(key)}]`
      : `${label}.${key}`;
    collectExportArtifacts({ artifacts, label: nestedLabel, value: nestedValue });
  }
}

function collectPackagedArtifactPatterns(filesEntries) {
  if (filesEntries === null) {
    return [];
  }

  return filesEntries
    .map((entry) => normalizePackagePath(entry))
    .filter((entry) => entry !== null && isArtifactPattern(entry))
    .map((pattern) => ({
      pattern,
      source: "package.json files"
    }));
}

function expandPackagedArtifactPatterns(patterns, allPackageFiles) {
  const artifacts = new Map();
  const findings = [];

  for (const { pattern, source } of patterns) {
    if (!pattern.includes("*")) {
      addArtifact(artifacts, pattern, `${source} ${JSON.stringify(pattern)}`);
      continue;
    }

    const matches = allPackageFiles.filter((file) => matchesGlobPattern(file, pattern));

    if (matches.length === 0) {
      findings.push(`${source} ${JSON.stringify(pattern)} did not match any emitted runtime or declaration artifacts.`);
      continue;
    }

    for (const match of matches) {
      addArtifact(artifacts, match, `${source} ${JSON.stringify(pattern)}`);
    }
  }

  return { artifacts, findings };
}

function addPackagePathArtifact({ artifacts, source, value }) {
  const packagePath = normalizePackagePath(value);

  if (packagePath === null || !isRuntimeOrDeclarationArtifact(packagePath)) {
    return;
  }

  if (packagePath.includes("*")) {
    addArtifact(artifacts, packagePath, source);
    return;
  }

  addArtifact(artifacts, packagePath, source);
}

function addArtifact(artifacts, packagePath, source) {
  const existing = artifacts.get(packagePath);

  if (existing) {
    existing.sources.add(source);
    return;
  }

  artifacts.set(packagePath, {
    kind: packagePath.match(/\.d\.[cm]?ts$/) ? "declaration" : "javascript",
    path: packagePath,
    sources: new Set([source])
  });
}

function mergeArtifacts(...artifactMaps) {
  const merged = new Map();

  for (const artifactMap of artifactMaps) {
    for (const artifact of artifactMap.values()) {
      for (const source of artifact.sources) {
        addArtifact(merged, artifact.path, source);
      }
    }
  }

  return merged;
}

async function collectFiles(directory, baseDirectory = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".npm-cache") {
      continue;
    }

    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectFiles(path, baseDirectory));
      continue;
    }

    if (entry.isFile()) {
      files.push(toPackagePath(path, baseDirectory));
    }
  }

  return files;
}

function matchesAnyFilesEntry(packagePath, filesEntries) {
  return filesEntries
    .map((entry) => normalizePackagePath(entry))
    .filter((entry) => entry !== null)
    .some((entry) => entry.includes("*") ? matchesGlobPattern(packagePath, entry) : packagePath === entry);
}

function matchesGlobPattern(packagePath, pattern) {
  return globPatternToRegExp(pattern).test(packagePath);
}

function globPatternToRegExp(pattern) {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (character === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }

    source += escapeRegExp(character);
  }

  source += "$";

  return new RegExp(source);
}

function escapeRegExp(value) {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function normalizePackagePath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const withoutDotPrefix = value.startsWith("./") ? value.slice(2) : value;
  const normalized = posix.normalize(withoutDotPrefix);

  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function toPackagePath(path, baseDirectory) {
  return posix.normalize(relative(baseDirectory, path).split(/[\\/]/).join("/"));
}

function isArtifactPattern(packagePath) {
  return packagePath.includes("*") && isRuntimeOrDeclarationArtifact(packagePath);
}

function isRuntimeOrDeclarationArtifact(packagePath) {
  return /\.(?:mjs|cjs|js)$/.test(packagePath) || /\.d\.[cm]?ts$/.test(packagePath);
}

function isPackageSubpathKey(key) {
  return key === "." || key.startsWith("./");
}

function readFilesEntries(manifest) {
  if (manifest.files === undefined) {
    return null;
  }

  if (!Array.isArray(manifest.files) || manifest.files.some((entry) => typeof entry !== "string")) {
    throw new Error("Expected package.json files to be an array of strings when present.");
  }

  return manifest.files;
}

function countArtifactKinds(artifacts) {
  const counts = {
    declarations: 0,
    javascript: 0
  };

  for (const artifact of artifacts) {
    if (artifact.kind === "declaration") {
      counts.declarations += 1;
    } else {
      counts.javascript += 1;
    }
  }

  return counts;
}

function formatSources(sources) {
  return [...sources].sort().join(", ");
}

function isMissingFileError(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function readRootDir(args) {
  const rootFlagIndex = args.indexOf("--root");

  if (rootFlagIndex === -1) {
    return resolve(fileURLToPath(new URL("..", import.meta.url)));
  }

  const root = args[rootFlagIndex + 1];

  if (!root) {
    throw new Error("Expected --root to be followed by a directory.");
  }

  return resolve(root);
}

await main();
