# Codebase Concerns

**Analysis Date:** 2026-04-29

## Tech Debt

**Duplicated `createRunId` / `nowMs` / `elapsedMs` helpers across protocol modules:**
- Issue: Identical id-generation and timing helpers are copy-pasted into every protocol file.
- Files: `src/runtime/broadcast.ts:443-455`, `src/runtime/sequential.ts:372-384`, `src/runtime/coordinator.ts:622-634`, `src/runtime/shared.ts:378-390`
- Impact: A change to id format or fallback semantics (e.g. when `globalThis.crypto.randomUUID` is absent) must be made in four places. One drift introduces subtle protocol-specific behavior that violates the "switching `protocol` must not change the contract" invariant in CLAUDE.md.
- Fix approach: Move `createRunId`, `nowMs`, `elapsedMs`, and `providerCallIdFor` into `src/runtime/shared.ts` (or a dedicated `src/runtime/ids.ts`) and import from there. The existing `shared.ts` helpers can be the canonical source.

**Vercel AI provider lives in `src/providers/` but is not part of the published surface:**
- Issue: `src/providers/vercel-ai.ts` (744 lines) imports `ai` as a hard `import` statement, declares a `createVercelAIProvider` public-looking API, and is referenced by tests. It is **not** in `package.json` `exports`, **not** in `package.json` `files`, and `ai` is in `devDependencies` (not `peerDependencies`). The file is reachable from `src/types.ts` only via cross-references in JSDoc.
- Files: `src/providers/vercel-ai.ts:1`, `package.json:159-168`, `src/providers/vercel-ai-provider.test.ts`, `src/providers/vercel-ai-provider.live.test.ts`, `src/providers/vercel-ai-tools.test.ts`
- Impact: Ambiguous status — looks like a first-party adapter but is internal. Risk of accidentally adding it to `exports`/`files` (would force `ai` to become a peer dep, exploding install size and contradicting "no required peer SDK"). Also risks accidental tree-shake leakage if someone imports from `@dogpile/sdk/providers/vercel-ai` once a subpath gets added.
- Fix approach: Either (a) decide it's a published adapter, move to peer dep, add to exports + files + `package-exports.test.ts`; or (b) move it to `src/internal/` (or under `src/testing/`) with a comment stating it is repo-only and remove the suggestive `createVercelAIProvider` naming. Document the decision in CHANGELOG.

**`as unknown as` type escapes in tools adapter:**
- Issue: Three `as unknown as` casts bypass `exactOptionalPropertyTypes` strictness around tool validation issues and Vercel-AI tool shapes.
- Files: `src/runtime/tools.ts:849`, `src/runtime/tools.ts:1044`, `src/runtime/tools.ts:1517`
- Impact: Validation issue payloads and Vercel-AI tool inputs aren't structurally checked at compile time; runtime shape drift in upstream `ai` types or `RuntimeToolValidationIssue` will not be caught by `tsc`.
- Fix approach: Replace the validation-issue casts with a `JsonValue`-shaped serializer that walks `RuntimeToolValidationIssue` explicitly. For `asJsonRuntimeVercelAITool`, define a narrow conditional type rather than a blanket `as unknown as`.

**Raw `throw new Error(...)` instead of `DogpileError` in tool adapter paths:**
- Issue: Three call sites throw plain `Error` rather than typed `DogpileError`, breaking the "stable typed errors" promise (Gap 5 in CHANGELOG 0.1.0).
- Files: `src/runtime/tools.ts:951`, `src/runtime/tools.ts:1141`, `src/runtime/tools.ts:1158`
- Impact: Callers catching by `DogpileError.isInstance` or by error code will miss these. They surface as untyped `Error` in traces.
- Fix approach: Convert to `DogpileError` with codes such as `registration-error` / `vercel-ai-tool-error`.

**`src/types.ts` is 2,799 lines:**
- Issue: A single types file holds the entire public type surface, including event shapes, protocol configs, runtime tool types, replay trace types, and provider contracts.
- Files: `src/types.ts`
- Impact: Every public-API change touches one large file, increasing merge-conflict risk and making review harder. Splitting requires care because `package.json` exposes `./types` as a subpath; the file path must remain stable.
- Fix approach: Keep `src/types.ts` as the public re-export aggregator and split internals into `src/types/{events,protocols,tools,replay}.ts`, re-exported from `src/types.ts`. The `./types` export points at the aggregator, so the public surface is unchanged.

**`src/runtime/tools.ts` is 1,518 lines:**
- Issue: Single module owns built-in tool identity/permissions, web-search adapter, code-exec adapter, runtime tool executor, and Vercel-AI tool adapter.
- Files: `src/runtime/tools.ts`
- Impact: Hard to reason about; risk of regressions in unrelated tool features when changing one adapter.
- Fix approach: Split into `src/runtime/tools/{built-in,web-search,code-exec,executor,vercel-ai-adapter}.ts`. The `./runtime/tools` subpath export must stay as the aggregator — update `src/tests/package-exports.test.ts` if file layout changes.

## Known Bugs

**`createRunId` collisions when `crypto.randomUUID` is unavailable:**
- Symptoms: Two runs started in the same millisecond on a runtime without `crypto.randomUUID` (older Bun versions, some workers) get the same `run-${Date.now().toString(36)}` id.
- Files: `src/runtime/broadcast.ts:443-447`, `src/runtime/sequential.ts:372-376`, `src/runtime/coordinator.ts:622-626`, `src/runtime/shared.ts:378-382`
- Trigger: Spawn two `Dogpile.pile` calls back-to-back in an environment without `globalThis.crypto.randomUUID`.
- Workaround: None at runtime; callers cannot inject a run-id source. CLAUDE.md commits to Node 22 / Bun latest / browser ESM, all of which have `crypto.randomUUID`, but the fallback exists and is wrong.
- Fix approach: Either remove the fallback and throw a `DogpileError` with code `unavailable` when no UUID source is present, or augment with a per-run counter, or accept a `runIdGenerator` engine option.

**Live provider token accounting is a known TODO in benchmark suite:**
- Symptoms: Cost estimator stops before `maxUsd` only in synthetic tests; live provider token accounting is incomplete.
- Files: `src/benchmark/config.test.ts:533`, `src/benchmark/config.test.ts:736`
- Trigger: Run `pnpm run benchmark:baseline` against a live provider expecting cost-stop semantics.
- Workaround: Synthetic deterministic provider tests cover the contract; treat live numbers as advisory until follow-up lands.
- Fix approach: Wire a real cost estimator into the benchmark fixtures and assert mid-run budget stop.

## Security Considerations

**Built-in `webSearch` adapter passes raw input through to caller-supplied fetch:**
- Risk: Adapter URL/headers come from caller-supplied input shaping; combined with model-generated `query`, a confused-deputy issue could send unintended requests if the consumer wires a permissive `WebSearchFetchRequestBuilder`.
- Files: `src/runtime/tools.ts:744-820`
- Current mitigation: Adapter is opt-in; caller controls `fetch`, request builder, and response parser. CLAUDE.md is explicit that "tool execution stays under caller policy."
- Recommendations: Document the threat model in `docs/developer-usage.md` (host allowlist, header redaction, response size cap). Consider adding a default `RuntimeToolNetworkPermission` host allowlist on the built-in adapter.

**No SSRF guardrails in `OpenAICompatibleProvider` URL resolver:**
- Risk: `resolveURL` accepts any `baseURL` from caller config; if a downstream consumer reflects user input into `baseURL`, the SDK happily talks to internal addresses.
- Files: `src/providers/openai-compatible.ts:175`
- Current mitigation: This is documented as a low-level adapter; callers own the URL.
- Recommendations: None at SDK layer — surface guidance in `docs/developer-usage.md`. Do NOT add allowlists in the SDK (would violate provider neutrality).

**Tarball must not leak repo-only files:**
- Risk: `src/demo.ts`, `src/internal.ts`, `src/benchmark/`, `src/testing/`, `src/providers/vercel-ai.ts`, all `*.test.ts`, `benchmark-fixtures/`, and `.npm-cache/` must stay out of the published tarball. The `files` allowlist is explicit but easy to break by adding wildcards.
- Files: `package.json:99-141`, `scripts/check-package-artifacts.mjs`, `src/tests/package-exports.test.ts`
- Current mitigation: Three layers — explicit `files` allowlist, `pnpm run package:artifacts` gate, `package-exports.test.ts`. `pnpm run pack:check` runs all of them before publish.
- Recommendations: When adding a new runtime file, update all three locations atomically. The `dist/runtime/*.js` glob in `files` is broad — anything matching it ships, so do not put repo-only output under `dist/runtime/`.

## Performance Bottlenecks

**[DEFERRED 2026-04-29]** Both items below are conditional on profiler evidence ("If hot"). Real workloads are dominated by provider-network latency (100ms–10s per call); per-event timestamp formatting and small-object canonicalization are unlikely to register. Revisit if a user reports measured run-loop latency. Replay-determinism (`src/tests/result-contract.test.ts`) and event-shape (`src/tests/event-schema.test.ts`) gates remain the constraints any future optimization must satisfy.



**`canonicalizeSerializable` recursively walks every result on every run:**
- Problem: Final result construction calls `canonicalizeSerializable` on `cost`, `evaluation`, `metadata`, `quality`, and `usage` (and `stableJsonStringify` walks again).
- Files: `src/runtime/defaults.ts:500-525`
- Cause: Defensive copy + canonicalization to make traces JSON-deterministic and replay-safe.
- Improvement path: Profile against `src/tests/performance-baseline.test.ts`. If hot, memoize on already-canonical inputs (most metadata is small) or switch to a structural hash for the stringify path. Do not break replay determinism — `src/tests/result-contract.test.ts` is the gate.

**Repeated `new Date().toISOString()` on every event:**
- Problem: 20+ call sites build wall-clock timestamps per event; high-frequency `model-output-chunk` streams each pay the formatter cost.
- Files: `src/runtime/broadcast.ts:117,230,258,280,388`, `src/runtime/sequential.ts:116,201,225,333`, `src/runtime/engine.ts:462,473,482`, `src/runtime/model.ts:26,53,103`, `src/runtime/shared.ts:114,211,233,341`, `src/runtime/tools.ts:448`, plus more
- Cause: Each event records its own `at`.
- Improvement path: For chunk-frequency events, accept a single `at` per provider call rather than per chunk. Verify `src/tests/event-schema.test.ts` still passes — `at` is part of the event contract.

## Fragile Areas

**Public subpath exports are gated by three independent files that must agree:**
- Files: `package.json` (`exports`, `files`), `src/tests/package-exports.test.ts`, `scripts/check-package-artifacts.mjs`
- Why fragile: Adding/removing any subpath export silently breaks consumer imports unless all three are updated. CLAUDE.md flags this as a public-surface change.
- Safe modification: Change all three in one PR, run `pnpm run pack:check`, and add a CHANGELOG entry.
- Test coverage: `src/tests/package-exports.test.ts` and `src/tests/consumer-type-resolution-smoke.test.ts` are the contract gates.

**Replayable trace contract is an implicit invariant:**
- Files: `src/runtime/engine.ts` (`replay`, `replayStream`), `src/runtime/defaults.ts:500-525`, `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`
- Why fragile: Any new field on `RunEvent`, `Trace`, `RunResult`, or `ReplayTrace*` must be JSON-serializable AND survive round-trip through `replay()`. Non-JSON values (`Date`, `Map`, `undefined` in arrays, `bigint`) silently break replay.
- Safe modification: Add new fields as `readonly` and JSON-primitive only; add coverage in both `event-schema.test.ts` and `result-contract.test.ts`; update CHANGELOG as a public-surface change.
- Test coverage: Strong on shape, weaker on replay-after-version-skew (no fixture-based replay test against a frozen v0.x trace).

**ESM `.js` extension discipline is unenforced by tooling:**
- Files: All of `src/runtime/`, `src/providers/`, `src/browser/`, `src/index.ts`, `src/types.ts`
- Why fragile: TS `moduleResolution: "Bundler"` resolves both with and without `.js`, but Node ESM at runtime requires the explicit `.js`. A relative import without `.js` typechecks and tests pass under Vitest, but breaks the published package.
- Safe modification: When adding imports, always end with `.js`. Consider an ESLint rule (`import/extensions`) — currently no linter is configured (`pnpm run lint` is just `tsc --noEmit`).
- Test coverage: `src/tests/consumer-type-resolution-smoke.test.ts` and `scripts/consumer-import-smoke.mjs` exercise packed-tarball imports; they would catch this only if a test file imports the broken module.

**Pure-runtime invariant has no static enforcement:**
- Files: `src/runtime/`, `src/browser/`, `src/providers/`
- Why fragile: CLAUDE.md says "no Node-only deps, no filesystem, no storage, no env reads" in these directories. Nothing prevents a contributor from adding `import { readFile } from "node:fs"` to `src/runtime/`. The `src/tests/browser-bundle-smoke.test.ts` would catch a Node-builtin import only if Vite fails to bundle it.
- Safe modification: Audit every new import in those folders. Avoid `node:*` imports outside `scripts/`.
- Test coverage: Browser-bundle smoke test is the de facto gate. Consider adding an explicit AST-level scan for forbidden imports.

**Tier defaults and pricing are caller-provided:**
- Files: `src/runtime/defaults.ts`, `src/providers/openai-compatible.ts:1-30`
- Why fragile: Dogpile deliberately ships no pricing tables (Gap 1). Users who forget to provide a `costEstimator` get `costUsd: undefined` silently and any cost-budget termination becomes a no-op.
- Safe modification: Document prominently; consider a warning event when `budget.maxUsd` is set but `costEstimator` is absent.
- Test coverage: `src/tests/budget-first-stop.test.ts` covers the success path, no test asserts the silent-noop behavior.

## Scaling Limits

**No caps on event log size:**
- Current capacity: Bounded only by caller's `budget` (turns, time, USD).
- Limit: A long-running coordinator/broadcast run with verbose tool calls accumulates an unbounded `RunEventLog` in memory. The whole event array is held until the final result is constructed.
- Scaling path: Stream-only consumers can drop events as they fire; for non-streaming runs, document the memory footprint per event and add a `maxEvents` budget if real users hit limits.

**Single-process coordination only:**
- Current capacity: Coordination runs in a single Node/Bun/browser process.
- Limit: No support for distributed agents across processes. Cancellation propagates only through in-process `AbortSignal` chains (`src/runtime/cancellation.ts`).
- Scaling path: Out of scope per CLAUDE.md ("does NOT own queues, storage"). Callers wrap multi-process orchestration externally.

## Dependencies at Risk

**`ai` package is in `devDependencies` but `src/providers/vercel-ai.ts` imports it as a runtime dependency:**
- Risk: If anyone ever exposes the file via `package.json` `exports` (or a consumer imports the source path directly), `ai` becomes a missing runtime dep.
- Files: `package.json:162`, `src/providers/vercel-ai.ts:1`
- Impact: `Cannot find module 'ai'` at consumer install time.
- Migration plan: Decide vendor status (see "Vercel AI provider lives in src/providers" above). If kept internal, leave as-is and add a comment in `vercel-ai.ts` explicitly stating "repo-internal, do not export."

**TypeScript `^6.0.3` and Vite `^8.0.10`:**
- Risk: TS 6 and Vite 8 are both very recent majors; behavior of `verbatimModuleSyntax` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` interactions can shift between minors.
- Files: `package.json:160-164`, `tsconfig.json`
- Impact: A TS minor bump could surface latent strictness errors.
- Migration plan: Pin to a known-good TS minor in CI; track release notes.

## Missing Critical Features

**No structured logging hook:**
- Problem: Runtime emits events (`RunEvent`) but has no built-in logging seam — callers either subscribe to the stream or post-process traces.
- Blocks: Operators want a logger (pino, console) injection without subscribing to the event stream. Currently they wire it themselves.
- Fix approach: Acceptable as-is; document the `subscribe` pattern. Adding a logger interface would be a public-surface addition.

**No retry or backoff on the model boundary:**
- Problem: `ConfiguredModelProvider.generate` failures bubble immediately; callers must implement retry inside their adapter.
- Blocks: Convenient handling of transient 429/503 from provider APIs without wrapping every adapter.
- Fix approach: Out of scope per CLAUDE.md ("provider neutrality"). Document the recipe in `docs/developer-usage.md`.

## Test Coverage Gaps

**No fixture-based replay-version-skew test:**
- What's not tested: A frozen JSON trace from a previous version replayed by current `replay()`.
- Files: `src/tests/result-contract.test.ts`, `src/tests/event-schema.test.ts`
- Risk: Silent breaking of trace round-trip across SDK versions; replay is a documented contract.
- Priority: Medium — add a `src/tests/fixtures/trace-v0_x.json` and assert it round-trips.

**No assertion that `budget.maxUsd` without `costEstimator` warns or errors:**
- What's not tested: The no-op when caller sets a USD budget but provides no estimator.
- Files: `src/tests/budget-first-stop.test.ts`
- Risk: Users believe USD budgets are enforced; production runs blow through caps silently.
- Priority: Medium.

**No static check that runtime/browser/providers stay free of `node:*` imports:**
- What's not tested: The "pure TS runtime" invariant is enforced only indirectly by `src/tests/browser-bundle-smoke.test.ts` (which would fail if Vite hits a Node builtin).
- Files: All of `src/runtime/`, `src/browser/`, `src/providers/`
- Risk: A contributor adds `import { readFile } from "node:fs"` to a runtime module; tests pass under Vitest (Node), and the regression only surfaces in the browser smoke build.
- Priority: High — the invariant is core to the SDK's positioning. Add a grep-based test in `src/tests/`.

**No test for ESM `.js` extension discipline in source imports:**
- What's not tested: Relative imports without `.js` extension typecheck under bundler resolution but break Node runtime ESM.
- Files: All `src/**/*.ts`
- Risk: Published tarball fails to load on Node, even though `pnpm test` and `pnpm typecheck` are green. The packed quickstart smoke (`scripts/consumer-import-smoke.mjs`) catches it only for entry points it imports.
- Priority: High — add a regex scan over `src/**/*.ts` asserting every relative import ends with `.js`.

**`src/internal.ts` re-exports `demo.js`, `benchmark/*.js`, `testing/*.js`, but no test asserts these stay out of the public exports map:**
- What's not tested: That nothing in the publishable `package.json` `exports` chain transitively imports `src/internal.ts` or the modules it re-exports.
- Files: `src/internal.ts`, `src/index.ts`, `src/types.ts`, `src/browser/index.ts`
- Risk: Accidental re-export from `src/index.ts` would pull demo + benchmark + deterministic-provider into the published bundle and inflate it (and surface unintended API).
- Priority: Medium — `src/tests/package-exports.test.ts` covers shape, not the import graph; an ast-grep walk from `src/index.ts` checking it never reaches `src/internal.ts`, `src/demo.ts`, `src/benchmark/`, `src/testing/`, or `src/providers/vercel-ai.ts` would close the gap.

---

*Concerns audit: 2026-04-29*
