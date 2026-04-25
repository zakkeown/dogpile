# Changelog

## 0.1.2

- Cleaned up the README release verification section so the npm package page has readable gate descriptions instead of a single dense paragraph.
- Prepared the patch release identity for `@dogpile/sdk@0.1.2` and `dogpile-sdk-0.1.2.tgz`.

## 0.1.1

- Updated npm package metadata after the GitHub repository transfer from `zakkeown/dogpile` to `bubstack/dogpile`.
- Updated package identity guards and publish documentation for `@dogpile/sdk@0.1.1` and `dogpile-sdk-0.1.1.tgz`.
- Updated npm Trusted Publisher documentation to use the GitHub organization `bubstack`.

## 0.1.0

### Production-Readiness Gaps Closed

- Gap 1 - Cost accounting proof: `costUsd` is computed from caller-supplied `costEstimator` pricing, including the packed quickstart smoke, and Dogpile does not bundle a model pricing table.
- Gap 2 - End-to-end cancellation: caller `AbortSignal`, `StreamHandle.cancel()`, and `budget.timeoutMs` abort active provider requests and surface stable `DogpileError` cancellation/timeout codes.
- Gap 3 - Runtime support proof: Node.js LTS 22 / 24, Bun latest, and browser ESM each have documented validation, and no other runtime targets are claimed for this release.
- Gap 4 - Intentional public surface: `@dogpile/sdk` exports only the documented root, browser, runtime, type, and OpenAI-compatible provider entrypoints, with demo, benchmark, deterministic testing, and internal helpers kept repository-only.
- Gap 5 - Stable typed errors: public validation, registration, provider, abort, timeout, and unknown-failure paths normalize to documented `DogpileError` string codes.
- Gap 6 - Reproducible release: local and CI gates build, pack, install the tarball, import every public subpath, verify downstream TypeScript type resolution, reject local `workspace:` / `link:` installs, and publish source maps plus original TypeScript sources.
- Gap 7 - Scope discipline: the SDK ships a dependency-free provider interface plus direct OpenAI-compatible HTTP adapter, avoids bundled pricing data, and keeps protocol hot loops trusting.

- Published the initial SDK under the scoped npm package name `@dogpile/sdk`; there is no bare `dogpile` package alias.
- Documented the scoped release identity as `@dogpile/sdk@0.1.0` and the local pack tarball name as `dogpile-sdk-0.1.0.tgz`.
- Added local and CI package identity validation that rejects stale unscoped package install/import references before release.
- Added a browser ESM bundle at `@dogpile/sdk/browser` and wired the package root `browser` condition to the same `dist/browser/index.js` artifact.
- Removed demo, benchmark, deterministic testing, and internal helper files from the publishable tarball and from the package export map; use the documented root, browser, runtime, type, and OpenAI-compatible provider entrypoints as the supported public surface. Repository-only helper docs now point to the source-only `../src/internal.js` import path.
- Added the required `Release Validation / Required browser bundle smoke` CI check for the browser bundle build and focused smoke test.
- Added the required `Release Validation / Required packed-tarball quickstart smoke` CI check for the fresh consumer project import and documented quickstart smoke script on pull requests, `main`, and `release/**` branches.
- Added the packed-tarball quickstart smoke to `pnpm run verify` and `pnpm run pack:check` through the explicit `pnpm run quickstart:smoke` command so local verification and Node.js CI full-suite jobs install and execute the packed SDK before publish.
- Hardened the fresh consumer tarball smoke to reject `workspace:` / `link:` SDK installs and installed package entrypoints or `dist` imports that resolve through local source files.
- Extended the fresh consumer tarball smoke to import every public package subpath and run downstream TypeScript type resolution against the installed package root and public subpaths.
- Added a consumer tarball check that verifies private helper files are absent from the installed package and that private helper subpaths remain blocked by package exports.
- Added JavaScript source maps, declaration maps, and original TypeScript sources to the publishable tarball payload.
- Added a package artifact guard that fails release checks when package metadata references runtime JavaScript or TypeScript declaration files that the build did not emit before pack or publish dry runs.
- Strengthened `pack:check` so the packaged source-map guard extracts the tarball, resolves packaged JavaScript and declaration `sourceMappingURL` references to map files in the tarball, and verifies package-owned sources referenced by JavaScript source maps and declaration maps are present in the package payload.
- Added a dependency-free OpenAI-compatible provider adapter that maps chat-completion response metadata into `ModelResponse.metadata.openAICompatible` and normalizes provider failures into stable `DogpileError` codes.
- Added front-door caller configuration validation for `run()`, `stream()`, `createEngine()`, and `createOpenAICompatibleProvider()` with stable `DogpileError` code `invalid-configuration` and `detail.path` diagnostics.
- Added registration-time validation for configured model providers and direct provider adapter options, including stable `DogpileError` diagnostics for malformed provider ids, missing generation functions, and invalid OpenAI-compatible adapter fields.
- Added `StreamHandle.cancel()` and `StreamHandle.status` so live streams abort provider-facing requests, close consumers, and record cancelled runs with stable `DogpileError` code `aborted`.
- Added SDK-enforced `budget.timeoutMs` lifecycle handling for `run()` and `stream()`, including provider-facing request aborts, `DogpileError` code `timeout`, and timer cleanup after completion.
- Documented optional runtime tool `validateInput` behavior, including registration validation, per-call timing before `execute()`, invalid-input result semantics, and expected side-effect-free tool author usage.
- Documented required `Release Validation` status checks for Node.js 22, Node.js 24, Bun latest, browser bundle smoke, packed-tarball quickstart smoke, and the `pack:check` package artifact job before publish.
- Added Dependabot version-update configuration for npm dependencies and GitHub Actions.
- Added a GitHub Actions npm publish workflow for `@dogpile/sdk` using npm Trusted Publishing/OIDC, release-triggered publishing, manual dry runs, and the existing `publish:check` package gate before publish.
