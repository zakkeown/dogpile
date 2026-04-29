# Technology Stack

**Analysis Date:** 2026-04-29

## Languages

**Primary:**
- TypeScript (target ES2022, module ESNext, `moduleResolution: Bundler`) — entire `src/` tree. Configured in `tsconfig.json` with `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.

**Secondary:**
- JavaScript (`.mjs`) — release/verification scripts only, in `scripts/` (`benchmark-baseline.mjs`, `check-pack-sourcemaps.mjs`, `check-package-artifacts.mjs`, `check-package-identity.mjs`, `consumer-import-smoke.mjs`).

## Runtime

**Environment:**
- Node.js `>=22` (declared in `package.json` `engines.node`).
- Targets Node 22/24, Bun latest, and browser ESM (per `CLAUDE.md`). Runtime code in `src/runtime/`, `src/browser/`, `src/providers/` is portable: no Node-only APIs, no filesystem, no env reads.

**Package Manager:**
- pnpm `10.33.0` (declared in `package.json` `packageManager`).
- Lockfile: `pnpm-lock.yaml` (present at repo root).

## Frameworks

**Core:**
- None. `@dogpile/sdk` is a zero-runtime-dependency library — `package.json` declares no `dependencies`. The published runtime relies only on platform-builtins (`fetch`, `AbortSignal`, `ReadableStream`).

**Testing:**
- Vitest `^4.1.5` (devDependency). Co-located unit tests as `*.test.ts` next to subjects (`src/runtime/sequential.test.ts`) and contract/packaging tests under `src/tests/`.

**Build/Dev:**
- TypeScript compiler `^6.0.3` — emits `dist/` from `tsconfig.build.json`.
- Vite `^8.0.10` — builds the browser bundle via `vite.browser.config.ts` (entry `src/browser/index.ts`, output `dist/browser/index.js`, ES2022 ESM, sourcemaps inlined).
- `ai` `^6.0.168` (Vercel AI SDK) — devDependency only, used by the optional `src/providers/vercel-ai.ts` adapter for tests/examples; not part of the published `files` allowlist.

## Key Dependencies

**Critical:**
- _Zero runtime dependencies_ — see `package.json`. Provider neutrality is enforced by the zero-deps surface; callers supply any object implementing `ConfiguredModelProvider` (`src/types.ts`).

**Dev/build:**
- `@types/node` `^25.6.0` — Node typings (used because `tsconfig.json` lists `"types": ["node"]`).
- `typescript` `^6.0.3`, `vite` `^8.0.10`, `vitest` `^4.1.5`, `ai` `^6.0.168`.

## Configuration

**TypeScript:**
- `tsconfig.json` — strict typecheck profile (`noEmit: true`), used by `pnpm run typecheck` and editor tooling.
- `tsconfig.build.json` — build profile, extends `tsconfig.json`, `outDir: dist`, `rootDir: src`, excludes `**/*.test.ts`.

**Vite (browser bundle):**
- `vite.browser.config.ts` — library mode, ES2022 target, ESM-only output (`formats: ["es"]`), unminified, sourcemaps with full sources.

**Package exports / publish surface:**
- `package.json` `exports` map: `.`, `./browser`, `./types`, `./providers/openai-compatible`, and seven `./runtime/*` subpaths. Each export uses conditional resolution (`types`, `browser`, `import`, `default`).
- `package.json` `files` allowlist controls the npm tarball; demo/benchmark/internal files are deliberately excluded.
- `sideEffects: false` — enables tree-shaking for consumers.

**Environment:**
- The SDK reads no environment variables. Credentials, base URLs, retries, and pricing live in caller-supplied provider objects (`createOpenAICompatibleProvider({ apiKey, baseURL, ... })` in `src/providers/openai-compatible.ts`).
- `.env` files: not used by the SDK runtime. Examples and live tests may rely on caller-set variables, but no dotenv loader is wired into `src/`.

**Build outputs:**
- `dist/index.js`, `dist/types.js`, `dist/runtime/*.js`, `dist/providers/openai-compatible.js`, `dist/browser/index.js` — each with `.d.ts`, `.js.map`, `.d.ts.map` siblings (validated by `scripts/check-package-artifacts.mjs`).

## Platform Requirements

**Development:**
- Node.js 22+ and pnpm `10.33.0` (any newer pnpm should work but version is pinned in `packageManager`).
- Commands: `pnpm install`, `pnpm run build`, `pnpm run test`, `pnpm run typecheck`, `pnpm run verify` (release gate), `pnpm run pack:check`, `pnpm run browser:smoke`, `pnpm run benchmark:baseline`.

**Production (consumers):**
- Any ESM-capable runtime with `fetch` available: Node 22+, Bun, modern browsers. The browser bundle (`dist/browser/index.js`) is published as a separate ESM entry resolved via the `browser` export condition.
- Strict ESM only — `package.json` `type: "module"`, no CommonJS output. Relative imports inside `src/` use explicit `.js` extensions even for `.ts` sources.

---

*Stack analysis: 2026-04-29*
