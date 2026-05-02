# Dogpile Release and Package Guide

This guide keeps maintainer and package validation details out of the README.

## Versioning and Stability

Dogpile follows semantic versioning for published packages:

- Patch releases fix bugs, tighten docs, or add tests without changing public
  behavior.
- Minor releases add backward-compatible APIs, protocols, event fields, or
  runtime support.
- Major releases may change public contracts, remove deprecated APIs, or alter
  protocol semantics.

The current public surface includes the package root exports, high-level
`Dogpile.pile()`, `run()`, `stream()`, `createEngine()`, the dependency-free
OpenAI-compatible provider adapter, protocol and tier discriminated unions,
event unions, trace/result types, and runtime portability guarantees for Node.js LTS 22 / 24, Bun latest, and browser ESM runtimes.

Dogpile treats documented `dist` entrypoints, their runtime implementation
dependencies, JavaScript source maps, declaration maps, original TypeScript
sources for shipped runtime/browser/provider files, `README.md`,
`CHANGELOG.md`, and `LICENSE` as the publishable package payload. Demo,
benchmark, deterministic testing, and internal helper files are repository-only
and stay out of the npm tarball. Core runtime code must remain pure TypeScript,
storage-free, and free of Node-only dependencies so the same package can run across the supported Node.js, Bun, and browser ESM runtimes.

## Packed Tarball Quickstart Setup

Use the packed-tarball path when validating the exact package that will be
published. Packing from this repository requires Node.js LTS 22 or 24 and
pnpm 10.33.0. Running the quickstart from a consumer project requires one of
the supported runtimes: Node.js LTS 22 / 24 or Bun latest.

From the Dogpile repository, build and pack the SDK:

```sh
pnpm install
pnpm run build
pnpm pack --pack-destination ./packed
```

The local tarball is named `dogpile-sdk-0.5.0.tgz` for the scoped package
`@dogpile/sdk@0.5.0`. Install that tarball into a fresh consumer project:

```sh
mkdir ../dogpile-quickstart
cd ../dogpile-quickstart
pnpm init
pnpm add ../dogpile/packed/dogpile-sdk-0.5.0.tgz
```

Equivalent install commands for other supported package managers are:

```sh
npm install ../dogpile/packed/dogpile-sdk-0.5.0.tgz
yarn add ../dogpile/packed/dogpile-sdk-0.5.0.tgz
bun add ../dogpile/packed/dogpile-sdk-0.5.0.tgz
```

## Release Verification

Before publishing, run the local package gates:

```sh
pnpm run package:identity
pnpm run package:artifacts
pnpm run browser:smoke
pnpm run benchmark:baseline
pnpm run quickstart:smoke
pnpm run verify
pnpm run pack:check
pnpm run publish:check
```

What each gate proves:

- `package:identity` asserts the scoped npm package name `@dogpile/sdk`, the
  current release identity, required package metadata, and release-facing
  references in source, docs, tests, and CI.
- `package:artifacts` verifies that package metadata references only emitted
  runtime JavaScript and TypeScript declaration files covered by `package.json`
  `files`.
- `browser:smoke` rebuilds the browser ESM bundle and imports `@dogpile/sdk`
  through the package root `browser` condition.
- `benchmark:baseline` rebuilds `dist`, runs the deterministic protocol-loop
  timing harness, and prints repeatable JSON for local before/after
  comparisons.
- `quickstart:smoke` creates a real `pnpm pack` tarball, installs it into a
  fresh consumer project, and asserts the dependency and lockfile resolve `@dogpile/sdk` from the `.tgz` instead of `workspace:` or `link:` metadata.
- `quickstart:smoke` also verifies installed entrypoints and `dist` imports do not resolve through local source imports, imports every public package subpath from the installed tarball, runs the marked README quickstart, runs `tsc --noEmit` from the consumer project, verifies private helper files are absent from the installed tarball, and proves private helper subpaths remain blocked by package exports.
- `consumer:smoke` is kept as the same packed-tarball quickstart smoke command
  for compatibility.
- `verify` rebuilds `dist`, runs the package artifact guard, runs the
  packed-tarball quickstart smoke, runs strict typecheck, and then runs the test
  suite.
- `pack:check` runs package identity, rebuilds `dist`, verifies package
  artifacts, runs the packed-tarball quickstart smoke, checks packed JavaScript
  source maps and declaration maps, and finishes with `npm pack --dry-run`.
- `publish:check` runs `verify`, reruns the package artifact guard, and then
  runs `npm publish --dry-run` so the package metadata, export map, and
  publishable files are checked without publishing.

The release identity is `@dogpile/sdk@0.5.0`. A real `pnpm pack` or `npm pack`
for this scoped package produces the local tarball `dogpile-sdk-0.5.0.tgz`;
the dry-run package gate must report that tarball filename and the scoped npm
package name before publish. See `CHANGELOG.md` for release notes and
breaking-change documentation.

The browser ESM target is emitted at `dist/browser/index.js` with
`dist/browser/index.js.map`; both the package root `browser` condition and the
explicit `@dogpile/sdk/browser` subpath resolve to that bundled artifact.

### Required CI Status Checks

Before publishing from `main` or a `release/**` branch, GitHub branch
protection or release review must require these `Release Validation` workflow
checks to pass:

- `Release Validation / Required Node.js 22 full suite`
- `Release Validation / Required Node.js 24 full suite`
- `Release Validation / Required Bun latest full suite`
- `Release Validation / Required browser bundle smoke`
- `Release Validation / Required packed-tarball quickstart smoke`
- `Release Validation / Required pack:check package artifact`

Do not publish `@dogpile/sdk` unless all Node LTS matrix entries, the Bun
latest suite, the browser bundle smoke job, the packed-tarball quickstart smoke
job, and the dependent `pack:check` package artifact job are green.

### Automated npm Publishing

`.github/workflows/npm-publish.yml` publishes `@dogpile/sdk` from GitHub
Actions when a GitHub Release is published. It can also be started manually
with `workflow_dispatch`; the manual path defaults to a dry run.

The publish workflow uses npm Trusted Publishing/OIDC rather than a long-lived
npm automation token. Configure the package's trusted publisher on npmjs.com
with:

- Organization or user: `bubstack`
- Repository: `dogpile`
- Workflow filename: `npm-publish.yml`
- Environment name: `npm`

Before the first automated release, publish the initial package version from an
npm account with owner access to the `@dogpile` scope:

```sh
npm publish --access public
```

That first manual publish creates the `@dogpile/sdk` package settings page on
npmjs.com. After it exists, add the Trusted Publisher fields above, then use
GitHub Releases or the manual workflow dry-run path for future releases. The
local safety check for the first publish is:

```sh
pnpm run publish:check
```

The workflow grants `id-token: write`, runs on a GitHub-hosted Node.js 24
runner, installs the latest npm CLI, runs `pnpm run publish:check`, verifies
the target version is not already published, and then runs
`npm publish --access public`. Keep the `npm` GitHub environment protected for
release review if this repository should require human approval before a
published GitHub Release can reach the npm registry.
