# Repository Guidelines

## Project Structure & Module Organization

Dogpile is a strict TypeScript SDK published as `@dogpile/sdk`. Source lives in `src/`, with core coordination logic in `src/runtime/`, provider adapters in `src/providers/`, browser entrypoints in `src/browser/`, deterministic helpers in `src/testing/`, and benchmark code in `src/benchmark/`. Tests are colocated as `*.test.ts` beside modules or grouped under `src/tests/` for package, API, and smoke coverage. Generated build output goes to `dist/`; do not edit it by hand. Supporting scripts are in `scripts/`, examples in `examples/`, and release or usage docs in `docs/`.

## Build, Test, and Development Commands

Use Node.js 22+ and pnpm 10.33.0.

- `pnpm install` installs dependencies from the lockfile.
- `pnpm run build` compiles TypeScript and builds the browser bundle.
- `pnpm run test` runs the Vitest suite.
- `pnpm run typecheck` runs strict TypeScript checks without emitting files.
- `pnpm run verify` runs the main release-quality gate: identity, build, artifact checks, packed quickstart smoke, typecheck, and tests.
- `pnpm run pack:check` validates the publishable tarball shape with `npm pack --dry-run`.

## Coding Style & Naming Conventions

Write ESM TypeScript with explicit `.js` extensions in relative imports. Preserve strict typing: `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess` are enabled. Prefer immutable inputs with `readonly` where existing APIs do. Use two-space indentation, double quotes, semicolons, `camelCase` for functions and variables, `PascalCase` for exported types/classes, and kebab-case file names such as `openai-compatible.ts`.

## Testing Guidelines

Vitest is the test framework. Name tests `*.test.ts`, keep focused unit tests near their modules, and use `src/tests/` for cross-cutting API, packaging, browser, and smoke contracts. Add or update tests for behavior changes, public API changes, package export changes, and termination or trace semantics. Run `pnpm run test` for normal changes and `pnpm run verify` before release-facing work.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style subjects such as `fix: ...`, `feat: ...`, `chore: ...`, `docs: ...`, and `ci: ...`; follow that pattern and keep subjects imperative and concise. Pull requests should describe the change, list verification commands run, link related issues, and call out public API, packaging, or browser bundle impact. Include screenshots only for UI-facing example changes.

## Security & Configuration Tips

Dogpile does not own credentials or environment variables; provider objects handle keys, routing, retries, and pricing. Keep runtime code storage-free and portable across Node.js, Bun, and browser ESM. Never commit secrets, generated tarballs, or local cache contents such as `.npm-cache/`.
