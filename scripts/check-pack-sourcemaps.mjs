#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = readRootDir(process.argv.slice(2));
const cacheDir = readCacheDir(process.argv.slice(2), rootDir);

async function main() {
  const packDir = await mkdtemp(join(tmpdir(), "dogpile-pack-sourcemaps-"));

  try {
    const packManifest = await packPackage(rootDir, packDir, cacheDir);
    const extractedPackageDir = await extractPackage(packManifest.tarballPath, packDir);
    const packedPaths = packManifest.files.map((file) => file.path);
    const packedPathSet = new Set(packedPaths);
    const javaScriptOutputs = packedPaths.filter(isDistJavaScriptOutput);
    const declarationOutputs = packedPaths.filter(isDistDeclarationOutput);

    if (javaScriptOutputs.length === 0) {
      console.error("Pack sourcemap check failed. Expected the packed artifact to contain dist/**/*.js outputs.");
      process.exitCode = 1;
      return;
    }

    if (declarationOutputs.length === 0) {
      console.error("Pack sourcemap check failed. Expected the packed artifact to contain dist/**/*.d.ts outputs.");
      process.exitCode = 1;
      return;
    }

    const missingMapFiles = javaScriptOutputs
      .map((javaScriptPath) => ({
        javaScriptPath,
        mapPath: `${javaScriptPath}.map`
      }))
      .filter(({ mapPath }) => !packedPathSet.has(mapPath));

    if (missingMapFiles.length > 0) {
      console.error("Pack sourcemap check failed. Every packaged dist JavaScript output must include its .js.map file.");

      for (const { javaScriptPath, mapPath } of missingMapFiles) {
        console.error(`- ${javaScriptPath} is missing ${mapPath}`);
      }

      process.exitCode = 1;
      return;
    }

    const javaScriptSourceMappingUrlCheck = await checkJavaScriptSourceMappingUrlReferences({
      extractedPackageDir,
      javaScriptPaths: javaScriptOutputs,
      packedPathSet
    });

    if (javaScriptSourceMappingUrlCheck.missingSourceMappingUrlReferences.length > 0) {
      console.error(
        "Pack sourcemap check failed. Every packaged dist JavaScript sourceMappingURL reference must resolve to a source map file in the packed tarball."
      );

      for (const finding of javaScriptSourceMappingUrlCheck.missingSourceMappingUrlReferences) {
        if (finding.sourceMappingUrl === null) {
          console.error(`- ${finding.javaScriptPath} does not declare a sourceMappingURL comment`);
          continue;
        }

        console.error(
          `- ${finding.javaScriptPath} references ${finding.sourceMappingUrl} (${finding.resolvedPath}) but that source map is not in the packed tarball`
        );
      }

      process.exitCode = 1;
      return;
    }

    const missingDeclarationMapFiles = declarationOutputs
      .map((declarationPath) => ({
        declarationPath,
        mapPath: `${declarationPath}.map`
      }))
      .filter(({ mapPath }) => !packedPathSet.has(mapPath));

    if (missingDeclarationMapFiles.length > 0) {
      console.error("Pack sourcemap check failed. Every packaged dist declaration output must include its .d.ts.map file.");

      for (const { declarationPath, mapPath } of missingDeclarationMapFiles) {
        console.error(`- ${declarationPath} is missing ${mapPath}`);
      }

      process.exitCode = 1;
      return;
    }

    const declarationSourceMappingUrlCheck = await checkDeclarationSourceMappingUrlReferences({
      extractedPackageDir,
      declarationPaths: declarationOutputs,
      packedPathSet
    });

    if (declarationSourceMappingUrlCheck.missingDeclarationSourceMappingUrlReferences.length > 0) {
      console.error(
        "Pack sourcemap check failed. Every packaged dist declaration sourceMappingURL reference must resolve to a declaration map file in the packed tarball."
      );

      for (const finding of declarationSourceMappingUrlCheck.missingDeclarationSourceMappingUrlReferences) {
        if (finding.sourceMappingUrl === null) {
          console.error(`- ${finding.declarationPath} does not declare a sourceMappingURL comment`);
          continue;
        }

        console.error(
          `- ${finding.declarationPath} references ${finding.sourceMappingUrl} (${finding.resolvedPath}) but that declaration map is not in the packed tarball`
        );
      }

      process.exitCode = 1;
      return;
    }

    const mapSourceCheck = await checkMapSourceReferences({
      extractedPackageDir,
      mapPaths: [
        ...javaScriptSourceMappingUrlCheck.resolvedSourceMapPaths,
        ...declarationSourceMappingUrlCheck.resolvedDeclarationMapPaths
      ],
      packedPathSet
    });

    if (mapSourceCheck.missingSourceReferences.length > 0) {
      console.error(
        [
          "Pack sourcemap check failed.",
          "Every packaged JavaScript source-map and declaration-map source reference must resolve to a file in the packed tarball,",
          "except bundled third-party sources with embedded sourcesContent."
        ].join(" ")
      );

      for (const finding of mapSourceCheck.missingSourceReferences) {
        console.error(
          `- ${finding.mapPath} references ${finding.source} (${finding.resolvedPath}) but that source is not in the packed tarball`
        );
      }

      process.exitCode = 1;
      return;
    }

    console.log(
      [
        "Pack sourcemap check passed:",
        `${javaScriptOutputs.length} packaged dist JavaScript outputs include .js.map files;`,
        `${javaScriptSourceMappingUrlCheck.resolvedSourceMapPaths.length} sourceMappingURL references resolve to packed source maps;`,
        `${declarationOutputs.length} packaged dist declaration outputs include .d.ts.map files;`,
        `${declarationSourceMappingUrlCheck.resolvedDeclarationMapPaths.length} declaration sourceMappingURL references resolve to packed declaration maps;`,
        `${mapSourceCheck.packagedSourceReferenceCount} source references resolve to packed files;`,
        `${mapSourceCheck.embeddedExternalSourceReferenceCount} bundled third-party source references include embedded sourcesContent.`
      ].join(" ")
    );
  } finally {
    await rm(packDir, { force: true, recursive: true });
  }
}

async function packPackage(packageRoot, packDir, npmCacheDir) {
  const { stdout } = await execFileAsync("npm", [
    "pack",
    "--json",
    "--pack-destination",
    packDir,
    "--cache",
    npmCacheDir
  ], {
    cwd: packageRoot,
    maxBuffer: 20 * 1024 * 1024
  });
  const parsed = JSON.parse(stdout);

  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("Expected npm pack --json to report exactly one package manifest.");
  }

  const [packManifest] = parsed;

  if (typeof packManifest !== "object" || packManifest === null || !Array.isArray(packManifest.files)) {
    throw new Error("Expected npm pack --json manifest to contain a files array.");
  }

  const filename = readStringProperty(packManifest, "filename");

  return {
    files: packManifest.files.map((file) => {
      if (typeof file !== "object" || file === null || typeof file.path !== "string") {
        throw new Error("Expected npm pack file entries to contain string paths.");
      }

      return { path: file.path };
    }),
    tarballPath: resolve(packDir, filename)
  };
}

async function extractPackage(tarballPath, packDir) {
  const extractDir = join(packDir, "extract");

  await mkdir(extractDir, { recursive: true });
  await execFileAsync("tar", ["-xzf", tarballPath, "-C", extractDir], {
    maxBuffer: 20 * 1024 * 1024
  });

  return join(extractDir, "package");
}

async function checkJavaScriptSourceMappingUrlReferences({ extractedPackageDir, javaScriptPaths, packedPathSet }) {
  const missingSourceMappingUrlReferences = [];
  const resolvedSourceMapPathSet = new Set();

  for (const javaScriptPath of javaScriptPaths) {
    const sourceMappingUrl = readSourceMappingUrl(
      await readFile(join(extractedPackageDir, javaScriptPath), "utf8")
    );

    if (sourceMappingUrl === null) {
      missingSourceMappingUrlReferences.push({
        javaScriptPath,
        resolvedPath: "missing",
        sourceMappingUrl: null
      });
      continue;
    }

    const resolvedPath = resolvePackageRelativeReferencePath(javaScriptPath, sourceMappingUrl);

    if (resolvedPath === null || !packedPathSet.has(resolvedPath)) {
      missingSourceMappingUrlReferences.push({
        javaScriptPath,
        resolvedPath: resolvedPath ?? "outside the package",
        sourceMappingUrl
      });
      continue;
    }

    resolvedSourceMapPathSet.add(resolvedPath);
  }

  return {
    missingSourceMappingUrlReferences,
    resolvedSourceMapPaths: [...resolvedSourceMapPathSet]
  };
}

async function checkDeclarationSourceMappingUrlReferences({ extractedPackageDir, declarationPaths, packedPathSet }) {
  const missingDeclarationSourceMappingUrlReferences = [];
  const resolvedDeclarationMapPathSet = new Set();

  for (const declarationPath of declarationPaths) {
    const sourceMappingUrl = readSourceMappingUrl(
      await readFile(join(extractedPackageDir, declarationPath), "utf8")
    );

    if (sourceMappingUrl === null) {
      missingDeclarationSourceMappingUrlReferences.push({
        declarationPath,
        resolvedPath: "missing",
        sourceMappingUrl: null
      });
      continue;
    }

    const resolvedPath = resolvePackageRelativeReferencePath(declarationPath, sourceMappingUrl);

    if (resolvedPath === null || !packedPathSet.has(resolvedPath)) {
      missingDeclarationSourceMappingUrlReferences.push({
        declarationPath,
        resolvedPath: resolvedPath ?? "outside the package",
        sourceMappingUrl
      });
      continue;
    }

    resolvedDeclarationMapPathSet.add(resolvedPath);
  }

  return {
    missingDeclarationSourceMappingUrlReferences,
    resolvedDeclarationMapPaths: [...resolvedDeclarationMapPathSet]
  };
}

async function checkMapSourceReferences({ extractedPackageDir, mapPaths, packedPathSet }) {
  const missingSourceReferences = [];
  let embeddedExternalSourceReferenceCount = 0;
  let packagedSourceReferenceCount = 0;

  for (const mapPath of mapPaths) {
    const sourceMap = parseSourceMap(
      mapPath,
      await readFile(join(extractedPackageDir, mapPath), "utf8")
    );

    for (const [index, source] of sourceMap.sources.entries()) {
      const resolvedPath = resolveMapSourcePath(mapPath, sourceMap.sourceRoot, source);

      if (resolvedPath !== null && packedPathSet.has(resolvedPath)) {
        packagedSourceReferenceCount += 1;
        continue;
      }

      if (isThirdPartySourceReference(resolvedPath, source) && hasEmbeddedSourceContent(sourceMap.sourcesContent, index)) {
        embeddedExternalSourceReferenceCount += 1;
        continue;
      }

      missingSourceReferences.push({
        mapPath,
        source,
        resolvedPath: resolvedPath ?? "outside the package"
      });
    }
  }

  return {
    embeddedExternalSourceReferenceCount,
    missingSourceReferences,
    packagedSourceReferenceCount
  };
}

function parseSourceMap(mapPath, contents) {
  let parsed;

  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Expected ${mapPath} to contain valid JSON source map data.`, { cause: error });
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Expected ${mapPath} to contain a source map object.`);
  }

  const sourceMap = parsed;
  const sources = sourceMap.sources;
  const sourceRoot = sourceMap.sourceRoot;
  const sourcesContent = sourceMap.sourcesContent;

  if (sources !== undefined && (!Array.isArray(sources) || sources.some((source) => typeof source !== "string"))) {
    throw new Error(`Expected ${mapPath} sources to be an array of strings.`);
  }

  if (sourceRoot !== undefined && typeof sourceRoot !== "string") {
    throw new Error(`Expected ${mapPath} sourceRoot to be a string when present.`);
  }

  return {
    sourceRoot: sourceRoot ?? "",
    sources: sources ?? [],
    sourcesContent: Array.isArray(sourcesContent) ? sourcesContent : []
  };
}

function readSourceMappingUrl(contents) {
  const sourceMappingUrlPattern = /(?:\/\/[#@]\s*sourceMappingURL=([^\s]+)|\/\*[#@]\s*sourceMappingURL=([^\s*]+)\s*\*\/)/g;
  let sourceMappingUrl = null;
  let match;

  while ((match = sourceMappingUrlPattern.exec(contents)) !== null) {
    sourceMappingUrl = match[1] ?? match[2] ?? null;
  }

  return sourceMappingUrl;
}

function resolveMapSourcePath(mapPath, sourceRoot, source) {
  const sourceWithRoot = sourceRoot ? posix.join(sourceRoot, source) : source;

  return resolvePackageRelativeReferencePath(mapPath, sourceWithRoot);
}

function resolvePackageRelativeReferencePath(fromPath, reference) {
  if (isUrlLikeSource(reference) || reference.startsWith("//") || reference.includes("?") || reference.includes("#")) {
    return null;
  }

  const resolvedPath = posix.normalize(posix.join(posix.dirname(fromPath), reference));

  if (resolvedPath === "." || resolvedPath.startsWith("../") || posix.isAbsolute(resolvedPath)) {
    return null;
  }

  return resolvedPath;
}

function isThirdPartySourceReference(resolvedPath, source) {
  return source.includes("node_modules/") || resolvedPath?.startsWith("node_modules/") === true;
}

function hasEmbeddedSourceContent(sourcesContent, index) {
  return typeof sourcesContent[index] === "string" && sourcesContent[index].length > 0;
}

function isUrlLikeSource(source) {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(source);
}

function readStringProperty(entry, propertyName) {
  const value = entry[propertyName];

  if (typeof value !== "string") {
    throw new Error(`Expected npm pack manifest ${propertyName} to be a string.`);
  }

  return value;
}

function isDistJavaScriptOutput(path) {
  return path.startsWith("dist/") && path.endsWith(".js");
}

function isDistDeclarationOutput(path) {
  return path.startsWith("dist/") && path.endsWith(".d.ts");
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

function readCacheDir(args, packageRoot) {
  const cacheFlagIndex = args.indexOf("--cache");

  if (cacheFlagIndex === -1) {
    return join(packageRoot, ".npm-cache");
  }

  const cache = args[cacheFlagIndex + 1];

  if (!cache) {
    throw new Error("Expected --cache to be followed by a directory.");
  }

  return resolve(cache);
}

await main();
