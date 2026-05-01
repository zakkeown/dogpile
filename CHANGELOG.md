# Changelog

## [Unreleased] — v0.4.0

### Breaking

- `AgentDecision` is now a discriminated union with required `type: "participate" | "delegate"`. Existing paper-style fields (`selectedRole`, `participation`, `rationale`, `contribution`) are preserved under the `participate` branch. Consumers must narrow on `decision.type === "participate"` before reading paper-style fields.

### Added

- Coordinator agents may emit `{ type: "delegate", protocol, intent, model?, budget? }` to dispatch a sub-mission as part of the plan turn. Phase 1 of v0.4.0 enables delegation from the coordinator's plan turn only; worker delegation and final-synthesis-turn delegation are rejected with `invalid-configuration`.
- New `RunEvent` variants: `sub-run-started`, `sub-run-completed`, `sub-run-failed`. `sub-run-completed` carries the full child `RunResult` (including embedded `Trace`); `sub-run-failed` carries `error` and `partialTrace`. `sub-run-started` carries `{ childRunId, parentRunId, parentDecisionId, protocol, intent, depth }` plus `recursive: true` when the dispatching protocol and the delegated protocol are both `coordinator`.
- Synthetic transcript entries record sub-run results with `agentId: "sub-run:<childRunId>"` and `role: "delegate-result"`. The next coordinator plan prompt receives a tagged `[sub-run <childRunId>]: <output>\n[sub-run <childRunId> stats]: turns=<N> costUsd=<X> durationMs=<Y>` block (D-17).
- `maxDepth` option on `DogpileOptions` and `EngineOptions` (default `4`); `Engine.run` and `Engine.stream` accept an optional second-argument `RunCallOptions` that can only LOWER the engine ceiling — `effectiveMaxDepth = Math.min(engineMaxDepth, runOptions.maxDepth ?? Infinity)`. Depth overflow is enforced at both the parser (`parseDelegateDecision`) and the dispatcher (`dispatchDelegate`); both throw `invalid-configuration` with `detail.reason: "depth-overflow"` and `detail.path: "decision.protocol"`.
- New public type `RunCallOptions` is re-exported through `@dogpile/sdk` and `@dogpile/sdk/types`.
- Fenced-JSON delegate parsing convention added to `parseAgentDecision` (no new tool surface — delegate is a parser-level concern). Coordinator runs accept a `delegate:` prefix followed by a fenced ```json block.
- `Dogpile.replay()` rehydrates embedded sub-run traces without provider invocation; the new `recomputeAccountingFromTrace` helper verifies recorded child `RunAccounting` against a per-child recompute and throws `invalid-configuration` with `detail.reason: "trace-accounting-mismatch"` and `detail.field` identifying the offending numeric field on tamper. The eight enumerated comparable numeric fields are `cost.usd`, `cost.inputTokens`, `cost.outputTokens`, `cost.totalTokens`, `usage.usd`, `usage.inputTokens`, `usage.outputTokens`, `usage.totalTokens`. Top-level parent drift is reported with `eventIndex: -1`; child drift is reported with the offending event's index plus `childRunId`.
- New `ReplayTraceProtocolDecisionType` literals: `start-sub-run`, `complete-sub-run`, `fail-sub-run`.
- Added: parent abort propagates to all in-flight sub-runs via a per-child derived `AbortController`; aborted children carry `detail.reason: "parent-aborted"` on `code: "aborted"` errors. New trace event `sub-run-parent-aborted` (also exported as TS type `SubRunParentAbortedEvent`) marks parent aborts that land after a sub-run completes; observable on `Dogpile.stream()` subscribers when stream teardown timing permits. New `ReplayTraceProtocolDecisionType` literal `mark-sub-run-parent-aborted`.
- Added: parent `budget.timeoutMs` is now a true tree-wide deadline. Children inherit `parentDeadline − now` as their default timeout. Per-decision `budget.timeoutMs` exceeding the parent's remaining is clamped (no longer throws), and the parent trace gains a `sub-run-budget-clamped` event (also exported as TS type `SubRunBudgetClampedEvent`) recording the requested vs clamped values. Parent timeouts surface on the child as `code: "aborted"` with `detail.reason: "timeout"`. New `ReplayTraceProtocolDecisionType` literal `mark-sub-run-budget-clamped`.
- Added: `defaultSubRunTimeoutMs` engine option on `createEngine`, `Dogpile.pile`, `run`, and `stream` — fallback ceiling applied only when neither parent nor decision specifies a timeout. Precedence: `decision.budget.timeoutMs` > parent's remaining deadline > `defaultSubRunTimeoutMs` > undefined.

### Notes

- No package `exports` / `files` change. All new public types ship through the existing `@dogpile/sdk` root entry. `recomputeAccountingFromTrace` and the depth-gate helpers (`assertDepthWithinLimit`, `depthOverflowError`) remain runtime-internal.
- Phase 1 does not propagate cost caps, parent timeouts to children with no caller-set timeout, child-event bubbling into the parent stream, or worker-side delegation — those land in v0.4.0 Phases 2–4. Phase 1 leaves event ordering schema-stable for the future Phase 4 child-event-bubbling addition.

## 0.3.1

- Prepared the patch release identity for `@dogpile/sdk@0.3.1` and `dogpile-sdk-0.3.1.tgz`.
- Added a structured logging seam at `@dogpile/sdk/runtime/logger` (also re-exported from the package root). Exports `Logger` interface, `noopLogger`, `consoleLogger`, and `loggerFromEvents` adapter. Bridges any logger (pino/winston/console) to an existing stream handle via `handle.subscribe(loggerFromEvents(logger))` — no engine changes, no new event variants. Logger throws are caught and re-routed to the logger's own `error` channel so a misbehaving logger cannot crash a run.
- Added `withRetry(provider, policy)` and the `@dogpile/sdk/runtime/retry` subpath. Wraps any `ConfiguredModelProvider` with a transient-failure retry policy — preserves provider neutrality (opt-in, no peer deps), retries `provider-rate-limited` / `provider-timeout` / `provider-unavailable` by default, honors `error.detail.retryAfterMs`, and short-circuits on `AbortSignal`. Streaming calls are forwarded unchanged.
- Internalized the Vercel AI provider adapter. `src/providers/vercel-ai.ts` moved to `src/internal/vercel-ai.ts`; it was never listed in `package.json#exports` or `package.json#files` and remains repo-internal so `ai` does not become a peer dependency. No behavior change for consumers.
- `createRunId` no longer falls back to a `Date.now`-based id when `globalThis.crypto.randomUUID` is unavailable; it now throws `DogpileError({ code: "invalid-configuration" })`. Node 22+, Bun latest, and modern browser ESM environments all expose `crypto.randomUUID`.
- Three previously plain `Error` throws in `src/runtime/tools.ts` now throw `DogpileError` with stable codes (`invalid-configuration` / `provider-invalid-response`), so `DogpileError.isInstance` catches them as the typed-error contract requires.

## 0.3.0

- Prepared the minor release identity for `@dogpile/sdk@0.3.0` and `dogpile-sdk-0.3.0.tgz`.
- Added one-shot `wrapUpHint` support so the next model turn can package work before hard iteration or timeout caps terminate the run.
- Added protocol-level `minTurns` / `minRounds` floors so convergence and judge termination cannot fire before the configured minimum progress.

## 0.2.2

- Prepared the documentation refresh release identity for `@dogpile/sdk@0.2.2` and `dogpile-sdk-0.2.2.tgz`.
- Reworked the README around the product value proposition, quickstart, and documentation map.
- Split dense API, trace, and release details into dedicated docs pages.

## 0.2.1

- Prepared the security patch release identity for `@dogpile/sdk@0.2.1` and `dogpile-sdk-0.2.1.tgz`.
- Added explicit read-only GitHub Actions workflow permissions for release validation jobs.
- Reworked package identity command scanning to avoid ReDoS-prone install command regexes.
- Hardened the Hugging Face upload GUI example's markdown table escaping.

## 0.2.0

- Prepared the Snow Leopard hardening release identity for `@dogpile/sdk@0.2.0` and `dogpile-sdk-0.2.0.tgz`.
- Centralized release identity checks so manifest, README, changelog, package guard, package export tests, and pack metadata assertions drift together.
- Normalized OpenAI-compatible fetch/network failures into stable `DogpileError` provider codes.
- Tightened the publishable source allowlist so runtime test files stay out of the npm tarball.
- Added a deterministic `pnpm run benchmark:baseline` timing harness for protocol-loop baseline comparisons without making a performance claim.
- Corrected benchmark reproduction documentation paths and commands to point at the live `src/benchmark/config.test.ts` suite.

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
