# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`@dogpile/sdk` — a strict, provider-neutral TypeScript SDK that runs one mission through a multi-agent coordination protocol and returns a replayable trace. Inspired by arXiv 2603.28990 ("Drop the Hierarchy and Roles"), packaged as an application SDK.

The SDK owns the coordination loop: agent turns, protocol events, transcripts, cost aggregation, cancellation, termination, typed errors, replayable result shapes. It does NOT own credentials, pricing, storage, queues, or UI — callers pass any object implementing `ConfiguredModelProvider` (`{ id, generate(request) }`) as the model boundary. Dogpile reads no env vars and has no required peer SDK.

## Commands

Requires Node.js 22+ and pnpm 10.33.0 (declared in `packageManager`).

- `pnpm install` — install from lockfile
- `pnpm run build` — `tsc -p tsconfig.build.json` then `vite build` for the browser bundle
- `pnpm run test` — full Vitest suite (`vitest run`)
- `pnpm vitest run path/to/foo.test.ts` — run a single test file
- `pnpm vitest run -t "name pattern"` — filter by test name
- `pnpm run typecheck` (alias `lint`) — `tsc --noEmit` against `tsconfig.json`
- `pnpm run verify` — release gate: identity → build → artifact check → packed quickstart smoke → typecheck → test
- `pnpm run pack:check` / `pnpm run publish:check` — validate the publishable tarball via `npm pack --dry-run`
- `pnpm run browser:smoke` — builds and runs the browser-bundle smoke test
- `pnpm run benchmark:baseline` — paper-reproduction benchmark using `benchmark-fixtures/`

## Architecture

### Public surface (small and deliberate)

`src/index.ts` is the only root export. The high-level entry is `Dogpile.pile({ intent, model, protocol, tier })`; `run`, `stream`, `createEngine`, `replay`, `replayStream` are the functional equivalents. `createOpenAICompatibleProvider` is the one bundled, dependency-free provider adapter — every other provider is a caller-supplied object.

The package also exposes runtime subpath exports (`@dogpile/sdk/runtime/*`, `/types`, `/browser`, `/providers/openai-compatible`) — see `package.json` `exports`. **Adding or removing any subpath export is a public-surface change** and must be reflected in `src/tests/package-exports.test.ts` and `scripts/check-package-artifacts.mjs`. The `files` allowlist in `package.json` controls what ships in the npm tarball; demo, benchmark, deterministic testing, and internal helper files are repo-only and must stay out.

### Runtime layout (`src/runtime/`)

- `engine.ts` — top-level orchestrator; exports `Dogpile`, `run`, `stream`, `createEngine`, `replay`. The escape hatch beneath `Dogpile.pile()`.
- `sequential.ts`, `broadcast.ts`, `shared.ts`, `coordinator.ts` — the four first-party protocols. All four return the same result/event shape; switching `protocol` must not change the contract.
- `termination.ts` — `budget`, `convergence`, `judge`, `firstOf`, `combineTerminationDecisions`. Termination is composable.
- `tools.ts` — runtime tool adapters (web search, code exec) and built-in tool identity/permissions. Tool execution stays under caller policy.
- `model.ts`, `defaults.ts`, `decisions.ts`, `validation.ts`, `cancellation.ts`, `shared.ts` — model boundary types, default configs, agent decision shape, input validation, cancellation propagation, shared helpers.

### Cross-cutting invariants

- **Pure TypeScript runtime.** No Node-only deps, no filesystem, no storage, no env reads in `src/runtime/`, `src/browser/`, `src/providers/`. The same code must run under Node 22/24, Bun latest, and browser ESM. The `browser` export condition resolves through `src/browser/` to `dist/browser/`.
- **ESM with explicit `.js` extensions** in relative imports (TS resolves through `.js` even though source is `.ts`).
- **Strict TS:** `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` are on. Prefer `readonly` where existing APIs already do.
- **Replayable trace contract:** completed runs return JSON-serializable traces (inputs, events, provider calls, transcript, accounting, output) that round-trip through `replay()`. Event-shape changes are public-API changes — update `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, and the changelog. **`ModelRequestEvent` and `ModelResponseEvent` use `startedAt`/`completedAt`/`modelId` instead of `at`.** These event types no longer carry the `at` field. The provenance shape is additionally protected by `src/tests/provenance-shape.test.ts` and `src/tests/fixtures/provenance-event-v1.json` — update the fixture when intentionally changing the provenance event shape.
- **Recursive coordination public-surface mirror.** The `delegate` decision variant, `sub-run-*` event family, `RunCallOptions`, `parentRunIds` stream chain, `locality`, `maxConcurrentChildren`, and `maxDepth` are public surface. Changes propagate to `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, `src/tests/package-exports.test.ts`, `package.json` `exports`/`files`, `CHANGELOG.md`, AND the two recursive-coordination doc pages (`docs/recursive-coordination.md` + `docs/recursive-coordination-reference.md`).
- **Phase 7 introspection + health public-surface mirror.** `result.health: RunHealthSummary` is required and always present on `RunResult`; `@dogpile/sdk/runtime/introspection` and `@dogpile/sdk/runtime/health` are public subpaths; `AnomalyCode`, `HealthAnomaly`, and `RunHealthSummary` are root-exported types. Changes propagate to `src/tests/result-contract.test.ts`, `src/tests/event-schema.test.ts`, `src/tests/package-exports.test.ts`, `src/tests/health-shape.test.ts`, `package.json` `exports`/`files`, and `CHANGELOG.md`.
- **Provider neutrality:** never assume an SDK or pricing table beyond `ConfiguredModelProvider`. The OpenAI-compatible adapter is the reference implementation, not a privileged path.

### Tests

Vitest. Two locations with different intents:

- **Co-located unit tests** next to their subject (e.g. `src/runtime/sequential.test.ts` next to `sequential.ts`).
- **`src/tests/`** — contract, integration, public-API surface, packaging, browser-bundle, and smoke tests. These are the gates that protect the published contract. Touching public API, exports, event shapes, termination semantics, or package layout means updating tests here.

Distinct from both: **`src/testing/`** is a *published* library of deterministic test helpers (e.g. a deterministic provider) for SDK consumers — not internal tests.

### Benchmarks

`src/benchmark/` is a published code module (the `./benchmark` export, paper-reproduction surface). `benchmark-fixtures/` at the repo root holds repro fixtures and the paper-reproduction note — repo-internal, excluded from the tarball.

## Conventions

- Conventional Commit subjects (`fix:`, `feat:`, `chore:`, `docs:`, `ci:`), imperative and concise. PRs should list verification commands run and call out public-API, packaging, or browser-bundle impact.
- Two-space indent, double quotes, semicolons; `camelCase` values, `PascalCase` exported types/classes, kebab-case filenames (`openai-compatible.ts`).
- Never commit secrets, generated tarballs, or `.npm-cache/`.

## Further reading

- `AGENTS.md` — repository guidelines (overlaps with this file; keep them consistent).
- `docs/developer-usage.md` — API choices, providers, protocols, streaming, termination, tools, replay, errors, browser usage.
- `examples/README.md` — protocol comparison and live OpenAI-compatible runs.
- `CHANGELOG.md` — public-surface change log.
