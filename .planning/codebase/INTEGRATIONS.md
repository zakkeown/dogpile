# External Integrations

**Analysis Date:** 2026-04-29

## APIs & External Services

Dogpile is intentionally provider-neutral: it owns no SDK clients, no credentials, no pricing, and no network code beyond a single optional `fetch` call inside the bundled OpenAI-compatible adapter. All real external integrations live behind a caller-supplied `ConfiguredModelProvider` (`src/types.ts`) — `{ id, generate(request), stream?(request) }`.

**Model providers (caller-supplied, not bundled):**
- Any LLM provider — implemented as objects passed into `Dogpile.pile({ model })` / `run({ model })`. The SDK never imports vendor SDKs in its published runtime.

**Reference adapter — OpenAI-compatible HTTP:**
- File: `src/providers/openai-compatible.ts`
- Default base URL: `https://api.openai.com/v1` (overridable via `baseURL` option).
- Default path: `/chat/completions`.
- Auth: `apiKey` option, sent as `Authorization: Bearer <key>` (caller passes the key; never read from env).
- Transport: `globalThis.fetch` by default; injectable via the `fetch` option (`OpenAICompatibleFetch`).
- Works against any OpenAI-API-shaped service (OpenAI, Azure OpenAI with custom path, Together, Groq, vLLM, llama.cpp servers, etc.).

**Optional adapter — Vercel AI SDK (dev/test only):**
- File: `src/providers/vercel-ai.ts`
- Imports `generateText`, `streamText` and types from `ai` (`^6.0.168`, devDependency).
- Not exported from `src/index.ts` and not listed in `package.json` `files`; ships only inside the repo for tests, examples, and local benchmarking.

**Tool integrations (caller-supplied):**
- File: `src/runtime/tools.ts`
- Built-in tool _identities_: `webSearch` (`webSearchDogpileTool`) and `codeExec` (`codeExecDogpileTool`). The SDK provides identity, input-schema validation, permission descriptors, and adapter shims — but no actual web-search backend or sandbox. Callers wire in their own executor (e.g., Tavily/Brave/Bing for web search; Pyodide/Modal/E2B for code exec) via `createWebSearchToolAdapter({ executor })` and `createCodeExecToolAdapter({ executor })`.

## Data Storage

**Databases:**
- None. The SDK has no database client and no persistence layer.

**File Storage:**
- None inside runtime code. Runs return JSON-serializable replayable traces (`Trace` in `src/types.ts`) — caller decides whether to persist.

**Caching:**
- None. No memoization, no on-disk cache, no `node-cache`-style dependency.

## Authentication & Identity

**Auth Provider:**
- None owned by Dogpile. Provider authentication (e.g., bearer tokens, signed requests) is the caller's responsibility — typically via the `apiKey` option on `createOpenAICompatibleProvider` or the closure inside a custom `ConfiguredModelProvider`.

**Identity model:**
- Each provider object exposes a stable `id` (`createOpenAICompatibleProvider` defaults it to `openai-compatible:${model}`), used in traces, accounting, and error reporting.

## Monitoring & Observability

**Error Tracking:**
- None bundled. The SDK surfaces a typed `DogpileError` hierarchy (`src/types.ts`, exported from `src/index.ts`) with `code: DogpileErrorCode`, `retryable`, and `providerId` — callers route these into their own observability stack.

**Logs:**
- No logger. Observability is event-driven: completed runs return a `RunResult` with a full `RunEventLog`; streaming returns `StreamEvent`s (see `src/runtime/engine.ts`). Callers attach their own logging by subscribing to the event stream.

**Tracing:**
- Built-in: every run emits a replayable `Trace` (round-trips through `replay()` / `replayStream()` from `src/runtime/engine.ts`). Schema is contract-tested in `src/tests/event-schema.test.ts` and `src/tests/result-contract.test.ts`.

## CI/CD & Deployment

**Hosting:**
- npm registry (`@dogpile/sdk`, public access per `package.json` `publishConfig`).
- Source: GitHub `bubstack/dogpile` (`package.json` `repository`, `bugs`, `homepage`).

**CI Pipeline:**
- No `.github/workflows` checked in at the repo root snapshot. Release gating is local: `pnpm run verify` (identity → build → artifact check → packed quickstart smoke → typecheck → test) and `pnpm run publish:check` (verify + `npm publish --dry-run`). Helper scripts live in `scripts/` and are wired through `package.json` `scripts`.

## Environment Configuration

**Required env vars (consumed by the SDK):**
- _None._ The SDK reads no environment variables at runtime. This is a hard invariant called out in `CLAUDE.md` and `AGENTS.md`.

**Caller-supplied configuration (typical):**
- Provider API keys (e.g., `OPENAI_API_KEY`) — read by the caller and passed into `createOpenAICompatibleProvider({ apiKey })`.
- Provider base URLs and headers for non-OpenAI endpoints — passed via `baseURL`, `path`, `headers` options.
- Tool backend credentials (search API keys, sandbox tokens) — read by the caller and closed over inside the executor passed to `createWebSearchToolAdapter` / `createCodeExecToolAdapter`.

**Secrets location:**
- Outside the repo. Never read or stored by the SDK; `.npm-cache/`, generated tarballs, and any local `.env` are explicitly forbidden from commits (`AGENTS.md`).

## Webhooks & Callbacks

**Incoming:**
- None. The SDK is a library, not a service — it has no HTTP server and no webhook receiver.

**Outgoing:**
- One outgoing HTTP egress path inside the published surface: the OpenAI-compatible adapter's `fetch(POST {baseURL}{path}, …)` call in `src/providers/openai-compatible.ts`. All other network traffic is reached through caller-implemented `ConfiguredModelProvider` objects or caller-implemented tool executors (`RuntimeToolExecutor` in `src/runtime/tools.ts`).

**Cancellation propagation:**
- `AbortSignal` is threaded end-to-end (`src/runtime/cancellation.ts`) into provider calls and tool executors so callers can cancel in-flight network requests.

---

*Integration audit: 2026-04-29*
