# Codebase Structure

**Analysis Date:** 2026-04-29

## Directory Layout

```
dogpile/
├── src/                              # All source (TS, ESM, strict)
│   ├── index.ts                      # PUBLIC root — only sanctioned entry
│   ├── types.ts                      # All exported types + DogpileError class
│   ├── internal.ts                   # Repo-internal aggregator (NOT exported by package.json)
│   ├── demo.ts                       # Repo-internal demo helpers
│   ├── browser/
│   │   └── index.ts                  # Browser bundle entry (re-exports `../index.js`)
│   ├── runtime/                      # Coordination engine + protocols + helpers
│   │   ├── engine.ts                 # Orchestrator: run/stream/createEngine/replay/replayStream/Dogpile
│   │   ├── sequential.ts             # Sequential protocol (one agent per turn)
│   │   ├── broadcast.ts              # Broadcast protocol (all agents per round, multi-round)
│   │   ├── coordinator.ts            # Coordinator protocol (lead dispatches subordinates)
│   │   ├── shared.ts                 # Shared organizational-memory protocol
│   │   ├── model.ts                  # Provider-call wrapper, streaming chunk fan-out, trace record
│   │   ├── decisions.ts              # Parses agent text → AgentDecision
│   │   ├── termination.ts            # budget/convergence/judge/firstOf + evaluators
│   │   ├── tools.ts                  # RuntimeTool contract + built-in webSearch/codeExec adapters
│   │   ├── wrap-up.ts                # Final-turn wrap-up hint controller
│   │   ├── cancellation.ts           # Abort/timeout → DogpileError
│   │   ├── defaults.ts               # Default agents, tier→temperature, trace canonicalization
│   │   ├── validation.ts             # Public-input validation → invalid-configuration errors
│   │   └── *.test.ts                 # Co-located unit tests
│   ├── providers/
│   │   ├── openai-compatible.ts      # PUBLIC reference adapter (the only published provider)
│   │   ├── openai-compatible.test.ts
│   │   ├── vercel-ai.ts              # Repo-internal Vercel AI SDK adapter (NOT published)
│   │   ├── vercel-ai-provider.test.ts
│   │   ├── vercel-ai-tools.test.ts
│   │   └── vercel-ai-provider.live.test.ts
│   ├── testing/
│   │   └── deterministic-provider.ts # Repo-internal deterministic provider helper
│   ├── benchmark/                    # Paper-reproduction code module (repo-internal source, NOT in `files`)
│   │   ├── config.ts
│   │   ├── coordinator.ts
│   │   ├── sequential.ts
│   │   └── config.test.ts
│   └── tests/                        # Contract / integration / public-API / packaging gates
│       ├── browser-bundle-smoke.test.ts
│       ├── package-exports.test.ts
│       ├── event-schema.test.ts
│       ├── result-contract.test.ts
│       ├── public-api-type-inference.test.ts
│       ├── public-error-api.test.ts
│       ├── streaming-api.test.ts
│       ├── consumer-type-resolution-smoke.test.ts
│       ├── (… other contract tests …)
│       └── fixtures/
│           └── consumer-type-resolution-smoke.ts
├── scripts/                          # Release/packaging gates (Node ESM)
│   ├── benchmark-baseline.mjs
│   ├── check-pack-sourcemaps.mjs
│   ├── check-package-artifacts.mjs
│   ├── check-package-identity.mjs
│   ├── consumer-import-smoke.mjs
│   └── release-identity.json
├── docs/
│   ├── developer-usage.md            # Caller-facing API guide
│   ├── reference.md
│   └── release.md
├── examples/
│   ├── README.md
│   └── huggingface-upload-gui/
├── benchmark-fixtures/               # Repo-internal repro fixtures (NOT shipped)
│   ├── l3-release-readiness-triage.yaml
│   └── paper-reproduction.md
├── dist/                             # Build output (tsc + vite browser bundle)
├── .github/
│   ├── dependabot.yml
│   └── workflows/
├── .planning/                        # GSD planning + codebase docs
│   └── codebase/
├── package.json                      # `exports` allowlist + `files` tarball allowlist (PUBLIC SURFACE)
├── pnpm-lock.yaml
├── tsconfig.json                     # Lint/typecheck config (`--noEmit`)
├── tsconfig.build.json               # Build config (emits to dist/)
├── vite.browser.config.ts            # Browser bundle build config
├── README.md
├── CHANGELOG.md                      # PUBLIC-surface change log
├── CLAUDE.md                         # Repo guidance for Claude Code
├── AGENTS.md                         # Repo guidelines (kept consistent with CLAUDE.md)
├── llms.txt
└── LICENSE
```

## Directory Purposes

**`src/`:**
- Purpose: All TypeScript source. Strict ESM with explicit `.js` extensions on relative imports.
- Contains: Public surface, runtime, providers, tests, benchmarks, internal helpers.

**`src/runtime/`:**
- Purpose: The coordination engine — protocols and shared helpers. Pure TS, browser-safe.
- Contains: Four protocol modules + engine + cross-cutting helpers + co-located unit tests.
- Key files: `engine.ts`, `sequential.ts`, `broadcast.ts`, `coordinator.ts`, `shared.ts`, `termination.ts`, `tools.ts`, `defaults.ts`, `validation.ts`.

**`src/providers/`:**
- Purpose: Provider adapters that build a `ConfiguredModelProvider`.
- Contains: `openai-compatible.ts` (the only published provider) plus `vercel-ai.ts` (repo-internal, not in `package.json#files`).
- Key files: `src/providers/openai-compatible.ts`.

**`src/browser/`:**
- Purpose: Browser bundle entry. Re-exports the public root.
- Contains: A single `index.ts` (`export * from "../index.js"`).

**`src/tests/`:**
- Purpose: Contract, integration, public-API surface, packaging, and browser-bundle gates. These protect the published contract.
- Contains: Public-API surface tests, event-schema tests, package-exports tests, streaming/runtime contract tests.
- Key files: `package-exports.test.ts`, `event-schema.test.ts`, `result-contract.test.ts`, `browser-bundle-smoke.test.ts`, `public-api-type-inference.test.ts`.

**`src/testing/`:**
- Purpose: Published library of deterministic test helpers for SDK consumers — distinct from internal tests.
- Contains: `deterministic-provider.ts` (a deterministic `ConfiguredModelProvider`).
- Note: Currently re-exported via `src/internal.ts`; not in `package.json#files`.

**`src/benchmark/`:**
- Purpose: Paper-reproduction surface and benchmark code (`./benchmark` export).
- Contains: Protocol-specific benchmark drivers and config.
- Note: Source is repo-internal; the published benchmark export ships only via `dist/` per `package.json#files`.

**`scripts/`:**
- Purpose: Release/packaging gates run by `pnpm verify`, `pnpm pack:check`, `pnpm publish:check`, `pnpm benchmark:baseline`.
- Contains: Node ESM scripts; not shipped in the tarball.

**`docs/`:**
- Purpose: Caller-facing guides.
- Key files: `docs/developer-usage.md` (API choices, providers, protocols, streaming, termination, tools, replay, errors, browser usage).

**`examples/`:**
- Purpose: Live-runnable example projects against OpenAI-compatible endpoints.

**`benchmark-fixtures/`:**
- Purpose: Repro fixtures and the paper-reproduction note. Repo-internal; excluded from the tarball.

**`dist/`:**
- Purpose: Build output (`tsc -p tsconfig.build.json` + `vite build`). Generated; not committed in normal workflow but referenced by `package.json#exports`.

**`.planning/`:**
- Purpose: GSD planning and codebase analysis docs (this file).

## Key File Locations

**Entry Points:**
- `src/index.ts`: Sole public entry; re-exports the supported API surface.
- `src/browser/index.ts`: Browser bundle entry (resolved through the `browser` export condition).
- `src/runtime/engine.ts`: Top-level orchestrator (`run`, `stream`, `createEngine`, `replay`, `replayStream`, `Dogpile`).

**Configuration:**
- `package.json`: `exports`, `files`, `engines`, `packageManager`, `sideEffects` — public surface manifest.
- `tsconfig.json`: typecheck/lint config (strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`).
- `tsconfig.build.json`: build config that emits to `dist/`.
- `vite.browser.config.ts`: browser bundle build config.

**Core Logic:**
- `src/runtime/engine.ts`: Engine, abort/timeout lifecycle, replay.
- `src/runtime/sequential.ts`, `src/runtime/broadcast.ts`, `src/runtime/coordinator.ts`, `src/runtime/shared.ts`: The four protocols.
- `src/runtime/model.ts`: The only place `model.generate` / `model.stream` are invoked.
- `src/runtime/termination.ts`: Termination DSL and evaluators.
- `src/runtime/tools.ts`: Runtime tool adapter contract + built-in tools.
- `src/runtime/defaults.ts`: Trace canonicalization, defaults, accounting.
- `src/runtime/validation.ts`: Input validation.
- `src/types.ts`: All exported types + `DogpileError`.

**Reference Provider:**
- `src/providers/openai-compatible.ts`.

**Testing:**
- `src/runtime/*.test.ts`: Co-located unit tests next to each subject.
- `src/tests/*.test.ts`: Contract / integration / packaging gates.
- `src/testing/deterministic-provider.ts`: Deterministic provider for use inside tests.

**Packaging gates:**
- `scripts/check-package-identity.mjs`, `scripts/check-package-artifacts.mjs`, `scripts/check-pack-sourcemaps.mjs`, `scripts/consumer-import-smoke.mjs`.

## Naming Conventions

**Files:**
- kebab-case (e.g., `openai-compatible.ts`, `wrap-up.ts`, `deterministic-provider.ts`).
- Co-located unit tests use `*.test.ts` next to their subject.
- Live-network tests use `*.live.test.ts` (e.g., `vercel-ai-provider.live.test.ts`).
- Contract / integration tests live in `src/tests/` with descriptive names ending `.test.ts`.

**Directories:**
- lowercase, single-word where possible (`runtime`, `providers`, `browser`, `testing`, `benchmark`, `tests`).
- Test fixtures under `src/tests/fixtures/`.

**Code identifiers:**
- `camelCase` for values and functions (`runSequential`, `parseAgentDecision`).
- `PascalCase` for exported types, classes, namespaces (`DogpileError`, `RunResult`, `Dogpile`).
- Discriminant unions use a `kind` field (e.g., `protocol.kind === "sequential"`, `condition.kind === "budget"`).
- Public error codes are kebab-case strings (e.g., `"invalid-configuration"`, `"provider-rate-limited"`).
- Internal interfaces stay private to a module (e.g., `SequentialRunOptions` in `src/runtime/sequential.ts`).

## Where to Add New Code

**New protocol:**
- Implementation: `src/runtime/<name>.ts` exporting `run<Name>(options): Promise<RunResult>`.
- Wire into the switch in `runProtocol` (`src/runtime/engine.ts:608`).
- Add discriminant `kind` to `Protocol` / `ProtocolConfig` in `src/types.ts`.
- Add normalization branch in `normalizeProtocol` (`src/runtime/defaults.ts:28`).
- Co-located tests: `src/runtime/<name>.test.ts`.
- Update `src/tests/result-contract.test.ts` and `src/tests/event-schema.test.ts`.
- Add subpath export under `package.json#exports` if you intend it to be importable as `@dogpile/sdk/runtime/<name>`; otherwise ensure it is reachable via `src/index.ts`.
- Update `package.json#files` patterns and `scripts/check-package-artifacts.mjs`.
- Update `CHANGELOG.md` (public-surface change).

**New termination condition:**
- Add `kind` to `TerminationCondition` union in `src/types.ts`.
- Add factory + evaluator in `src/runtime/termination.ts`.
- Re-export factory + evaluator from `src/index.ts`.
- Handle `kind` in `timeoutMsFromTermination` (`src/runtime/engine.ts:431`) if it carries a timeout.
- Tests in `src/runtime/` (unit) and `src/tests/termination-types.test.ts` + a `*-first-stop.test.ts` if relevant.

**New built-in tool:**
- Add to `DogpileBuiltInToolName` and the corresponding input/output types in `src/runtime/tools.ts`.
- Provide a `create<Name>ToolAdapter` factory and re-export from `src/index.ts`.
- Tests: `src/tests/built-in-tools.test.ts` + a focused unit test in `src/tests/runtime-tool-adapter-focused.test.ts`.

**New provider adapter:**
- Repo-internal: live under `src/providers/` (e.g. follow `vercel-ai.ts`). Do NOT add to `package.json#files` or `exports`.
- Published: `src/providers/<name>.ts` exporting a `create<Name>Provider` factory returning `ConfiguredModelProvider`. Add `./providers/<name>` subpath to `package.json#exports`, list `dist/providers/<name>.{js,d.ts,*.map}` under `files`, and add a contract test under `src/tests/`.

**New public type:**
- Define in `src/types.ts`. Re-export from `src/index.ts` if it is part of the API surface. Update `src/tests/public-api-type-inference.test.ts` and `CHANGELOG.md`.

**New cross-cutting helper used by all protocols:**
- Add a small module under `src/runtime/` (no upward imports beyond `src/types.ts`).
- Make sure it stays Node/Bun/browser-safe (no `process`, no `fs`).

**New tests:**
- Co-located unit test: `src/runtime/<subject>.test.ts` next to the subject.
- Public-contract / packaging / browser test: `src/tests/<purpose>.test.ts`.

**New caller-facing test helper:**
- `src/testing/<helper>.ts` (this directory is positioned to be a published consumer helpers library).

**New benchmark code (paper reproduction):**
- `src/benchmark/<name>.ts`. Note: paper-reproduction note lives in `benchmark-fixtures/paper-reproduction.md`.

**New release/packaging script:**
- `scripts/<name>.mjs` (Node ESM). Wire into `package.json#scripts` (`verify`, `pack:check`, `publish:check`).

**New documentation:**
- Caller-facing: `docs/<topic>.md`. Public-surface change notes: `CHANGELOG.md`. Repo guidance: keep `CLAUDE.md` and `AGENTS.md` consistent.

## Special Directories

**`dist/`:**
- Purpose: Compiled JS/DTS + sourcemaps + browser bundle output.
- Generated: Yes (`tsc -p tsconfig.build.json` then `vite build --config vite.browser.config.ts`).
- Committed: No.
- Note: The `package.json#exports` map points consumers at files under `dist/`. The `files` allowlist bounds what ships in the tarball.

**`benchmark-fixtures/`:**
- Purpose: Repo-internal repro fixtures and the paper-reproduction note.
- Generated: No.
- Committed: Yes.
- Note: Excluded from the published tarball — not in `package.json#files`.

**`.npm-cache/`:**
- Purpose: Local cache used by `npm pack --dry-run` during `pack:check` / `publish:check`.
- Generated: Yes.
- Committed: No (`.gitignore`d).

**`node_modules/`:**
- Purpose: pnpm-managed dependencies.
- Generated: Yes.
- Committed: No.

**`.planning/`:**
- Purpose: GSD planning and codebase analysis output.
- Generated: Yes (by GSD commands).
- Committed: Per project policy.

---

*Structure analysis: 2026-04-29*
