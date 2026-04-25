# Dogpile

Dogpile is a strict TypeScript SDK for running multi-agent LLM workflows through coordination protocols inspired by arXiv 2603.28990v1, "Drop the Hierarchy and Roles".

## Install

Dogpile ships to npm as `@dogpile/sdk`, a pure TypeScript package with its own provider-neutral model interface. The package root has no provider SDK peer dependency: pass any object that implements `ConfiguredModelProvider`, or use the built-in dependency-free OpenAI-compatible adapter for direct HTTP calls.

```sh
pnpm add @dogpile/sdk
```

```sh
npm install @dogpile/sdk
```

```sh
yarn add @dogpile/sdk
```

```sh
bun add @dogpile/sdk
```

Dogpile itself does not read API keys or any other environment variables. Your provider object owns credentials, routing, pricing, retries, and any vendor SDKs.

The SDK supports only Node.js LTS 22 / 24, Bun latest, and browser ESM runtimes. Core APIs are stateless and do not require filesystem access, a database, or a session store. Browser-aware bundlers can use the package root's `browser` export condition, and direct browser ESM consumers can import the bundled entrypoint from `@dogpile/sdk/browser`.

### Packed Tarball Quickstart Setup

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

The local tarball is named `dogpile-sdk-1.0.0.tgz` for the scoped package
`@dogpile/sdk@1.0.0`. Install that tarball into a fresh consumer project:

```sh
mkdir ../dogpile-quickstart
cd ../dogpile-quickstart
pnpm init
pnpm add ../dogpile/packed/dogpile-sdk-1.0.0.tgz
```

Equivalent install commands for other supported package managers are:

```sh
npm install ../dogpile/packed/dogpile-sdk-1.0.0.tgz
yarn add ../dogpile/packed/dogpile-sdk-1.0.0.tgz
bun add ../dogpile/packed/dogpile-sdk-1.0.0.tgz
```

## Versioning and Stability

Dogpile follows semantic versioning for published packages:

- Patch releases fix bugs, tighten docs, or add tests without changing public behavior.
- Minor releases add backward-compatible APIs, protocols, event fields, or runtime support.
- Major releases may change public contracts, remove deprecated APIs, or alter protocol semantics.

The v1.0.0 stable surface includes the package root exports, high-level `Dogpile.pile()`, `run()`, `stream()`, `createEngine()`, the dependency-free OpenAI-compatible provider adapter, protocol and tier discriminated unions, event unions, trace/result types, and runtime portability guarantees for Node.js LTS 22 / 24, Bun latest, and browser ESM runtimes.

Dogpile treats documented `dist` entrypoints, their runtime implementation dependencies, JavaScript source maps, declaration maps, original TypeScript sources for shipped runtime/browser/provider files, `README.md`, `CHANGELOG.md`, and `LICENSE` as the publishable package payload. Demo, benchmark, deterministic testing, and internal helper files are repository-only and stay out of the npm tarball. Core runtime code must remain pure TypeScript, storage-free, and free of Node-only dependencies so the same package can run across the supported Node.js, Bun, and browser ESM runtimes.

## Release Verification

Before publishing, run the local package gates:

```sh
pnpm run package:identity
pnpm run package:artifacts
pnpm run browser:smoke
pnpm run quickstart:smoke
pnpm run verify
pnpm run pack:check
pnpm run publish:check
```

`package:identity` asserts the scoped npm package name `@dogpile/sdk`, the v1 release identity, required package metadata (license, repository, keywords, publish access, and package manager), and scans release-facing source, docs, tests, and CI files for stale unscoped package install/import references. `package:artifacts` verifies that every runtime JavaScript file and TypeScript declaration file referenced by package metadata has been emitted by the build and is covered by `package.json` `files` before any pack or publish dry run. `browser:smoke` rebuilds the browser ESM bundle and runs the focused smoke test that imports `@dogpile/sdk` through the `browser` condition. `quickstart:smoke` builds the SDK, runs the package artifact guard, creates a real `pnpm pack` tarball, installs that tarball into a fresh temporary project without provider SDK peer fixtures, asserts the consumer dependency and lockfile resolve `@dogpile/sdk` from the `.tgz` instead of `workspace:` or `link:` metadata, verifies installed package entrypoints and `dist` imports do not resolve through local source imports, imports `@dogpile/sdk` from the consumer, imports every public package subpath from the installed tarball, extracts the marked quickstart from the installed package README, executes that documented provider-neutral `Dogpile.pile()` example end to end, writes a downstream TypeScript fixture that imports the package root and public subpaths, runs `tsc --noEmit` from the consumer project to prove declaration and export-map type resolution, verifies private helper files are absent from the installed tarball, and proves private helper subpaths remain blocked by package exports. `consumer:smoke` is kept as the same packed-tarball quickstart smoke command for compatibility. `verify` rebuilds `dist`, runs the package artifact guard, runs the packed-tarball quickstart smoke against that build, runs strict typecheck, then runs the test suite so declaration export checks, downstream type-resolution smoke tests, public API type-level assertions, the tarball install path, and package identity checks all fail the same local or CI gate. `pack:check` runs package identity, rebuilds `dist`, runs the package artifact guard before the packed-tarball quickstart smoke creates its `pnpm pack` tarball, then runs the packed JavaScript source-map and declaration-map guard and `npm pack --dry-run` so both the actual tarball install path and the npm package payload are checked. The source-map guard extracts the packed tarball, verifies every packaged `dist/**/*.js` and `dist/**/*.d.ts` file has its map, resolves packaged JavaScript and declaration `sourceMappingURL` references to map files present in the tarball, and confirms package-owned source references in those maps resolve to files present in the tarball. `publish:check` runs `verify`, reruns the package artifact guard, and then runs `npm publish --dry-run` so the package metadata, export map, and publishable files are checked without publishing.

The release identity is `@dogpile/sdk@1.0.0`. A real `pnpm pack` or `npm pack` for this scoped package produces the local tarball `dogpile-sdk-1.0.0.tgz`; the dry-run package gate must report that tarball filename and the scoped npm package name before publish. See `CHANGELOG.md` for v1.0.0 release notes and breaking-change documentation.

The browser ESM target is emitted at `dist/browser/index.js` with `dist/browser/index.js.map`; both the package root `browser` condition and the explicit `@dogpile/sdk/browser` subpath resolve to that bundled artifact.

### Required CI Status Checks

Before publishing from `main` or a `release/**` branch, GitHub branch protection or release review must require these `Release Validation` workflow checks to pass:

- `Release Validation / Required Node.js 22 full suite`
- `Release Validation / Required Node.js 24 full suite`
- `Release Validation / Required Bun latest full suite`
- `Release Validation / Required browser bundle smoke`
- `Release Validation / Required packed-tarball quickstart smoke`
- `Release Validation / Required pack:check package artifact`

Do not publish `@dogpile/sdk` unless all Node LTS matrix entries, the Bun latest suite, the browser bundle smoke job, the packed-tarball quickstart smoke job, and the dependent `pack:check` package artifact job are green.

## Import

Use the branded high-level API for application code:

```ts
import { Dogpile } from "@dogpile/sdk";

const result = await Dogpile.pile({
  intent: "Draft a migration plan for an SDK release.",
  model
});
```

Dogpile also exports direct helpers and public types from the package root:

```ts
import {
  createOpenAICompatibleProvider,
  createEngine,
  run,
  stream,
  type ConfiguredModelProvider,
  type DogpileOptions,
  type Protocol,
  type RunAccounting,
  type RunEventLog,
  type RunEvent,
  type RunMetadata,
  type RunResult,
  type RunUsage,
  type Tier
} from "@dogpile/sdk";
```

The `model` option is a `ConfiguredModelProvider`: a small caller-owned object
with a stable `id` and a `generate(request)` function. That is Dogpile's
provider boundary. Save this complete script as `quickstart.mjs` in the
consumer project:

<!-- dogpile-consumer-quickstart-smoke:start -->
```ts
import { Dogpile } from "@dogpile/sdk";

const pricing = {
  inputPerMillionTokens: 0.15,
  outputPerMillionTokens: 0.6
};
let turn = 0;

const provider = {
  id: "quickstart-provider",
  async generate() {
    turn += 1;
    const usage = {
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14
    };

    return {
      text: `quickstart turn ${turn} completed`,
      usage,
      costUsd:
        (usage.inputTokens * pricing.inputPerMillionTokens +
          usage.outputTokens * pricing.outputPerMillionTokens) /
        1_000_000
    };
  }
};

const result = await Dogpile.pile({
  intent: "Draft a migration plan for an SDK release.",
  model: provider
});

console.log("Dogpile quickstart complete");
console.log(`protocol=${result.metadata.protocol}`);
console.log(`tier=${result.metadata.tier}`);
console.log(`provider=${result.metadata.modelProviderId}`);
console.log(`turns=${result.transcript.length}`);
console.log(`costUsd=${result.usage.usd}`);
console.log(`output=${result.output}`);
```
<!-- dogpile-consumer-quickstart-smoke:end -->

Run it from the consumer project:

```sh
node quickstart.mjs
```

Expected observable output:

```text
Dogpile quickstart complete
protocol=sequential
tier=balanced
provider=quickstart-provider
turns=3
costUsd=<estimated from provider token usage and your pricing table>
output=<model response text>
```

For direct OpenAI or OpenAI-compatible HTTP endpoints, use Dogpile's built-in
adapter. It uses `fetch` and the endpoint you provide; it does not route through
any gateway unless your `baseURL` points at one.

```ts
import { createOpenAICompatibleProvider, run } from "@dogpile/sdk";

const provider = createOpenAICompatibleProvider({
  model: "gpt-4.1-mini",
  apiKey: process.env.OPENAI_API_KEY,
  costEstimator({ usage }) {
    return usage ? usage.totalTokens * 0.0000003 : undefined;
  }
});

const result = await run({
  intent: "Compare the release risks for a TypeScript SDK.",
  protocol: "sequential",
  tier: "balanced",
  model: provider
});

console.log(result.output);
```

You can point the same adapter at another compatible server by setting
`baseURL`, `path`, and headers explicitly:

```ts
const provider = createOpenAICompatibleProvider({
  id: "local-openai-compatible",
  model: "local-model",
  baseURL: "http://127.0.0.1:8080/v1",
  headers: {
    "x-workspace": "dogpile-live-test"
  },
  maxOutputTokens: 1_024
});
```

### Provider Boundary

`ConfiguredModelProvider` is the only model contract Dogpile core needs:

```ts
const provider = {
  id: "my-provider",
  async generate(request) {
    const response = await myModelClient.complete({
      messages: request.messages,
      temperature: request.temperature,
      signal: request.signal
    });

    return {
      text: response.text,
      usage: response.usage,
      costUsd: response.costUsd
    };
  }
};
```

The provider owns vendor SDKs, credentials, model names, retries, routing,
pricing, and telemetry. Dogpile owns protocol orchestration, events, traces,
termination policy, and replayable result shapes.

### OpenAI-Compatible Provider Configuration

`createOpenAICompatibleProvider()` returns Dogpile's
`ConfiguredModelProvider`, which is the value passed to `Dogpile.pile()`,
`run()`, `stream()`, or `createEngine()`.

```ts
const provider = createOpenAICompatibleProvider({
  id: "openai:gpt-4.1-mini",
  model: "gpt-4.1-mini",
  apiKey: process.env.OPENAI_API_KEY,
  maxOutputTokens: 1_024,
  extraBody: {
    reasoning_effort: "low"
  },
  costEstimator({ usage }) {
    return usage ? usage.totalTokens * 0.0000003 : undefined;
  }
});
```

The configuration object supports:

- `model`: required model id sent to the compatible chat-completions endpoint.
- `apiKey`: optional bearer token. Dogpile does not read environment variables;
  pass the credential explicitly when the endpoint requires one.
- `baseURL`: endpoint root; defaults to `https://api.openai.com/v1`.
- `path`: request path under `baseURL`; defaults to `/chat/completions`.
- `id`: stable provider id stored in events, traces, and errors; when omitted,
  Dogpile uses `openai-compatible:<model>`.
- `fetch`: optional fetch-compatible implementation for tests, custom runtimes,
  proxies, or instrumentation.
- `costEstimator`: caller-owned usage-to-USD function. Dogpile passes
  `{ providerId, request, response, usage }` and records the returned number as
  `costUsd`; Dogpile does not bundle model pricing.
- `headers`: optional headers merged into the request. `authorization` is set
  from `apiKey` unless you provide it yourself.
- `maxOutputTokens`: optional positive integer sent as `max_tokens`.
- `extraBody`: optional JSON object merged into the request body before
  Dogpile sets `model`, `messages`, `temperature`, and `max_tokens`.

During each model turn, Dogpile supplies a provider-neutral `ModelRequest` and
the adapter builds an OpenAI-compatible chat-completions request with this
mapping:

| Dogpile field | Request field | Behavior |
| --- | --- | --- |
| `request.messages[].role` and `request.messages[].content` | `messages[].role` and `messages[].content` | Preserves message order and role/content values. |
| `request.temperature` | `temperature` | Forwards the protocol-selected sampling temperature. |
| `request.signal` | `signal` | Passes caller cancellation through to `fetch`. |
| `request.metadata` | Not forwarded | Remains Dogpile trace/protocol metadata and is available to `costEstimator` through `request`. |
| `model` | `model` | Sends the configured model id. |
| `maxOutputTokens` | `max_tokens` | Sends the configured output cap when present. |
| `extraBody` | request body | Merges caller-owned provider options before canonical Dogpile fields are written. |

OpenAI-compatible responses are normalized back into Dogpile's stable public
provider types with this mapping:

| Response field | Dogpile field | Behavior |
| --- | --- | --- |
| `choices[0].message.content` | `ModelResponse.text` | Becomes the completed model-turn text. String content and text parts are supported. |
| `choices[0].finish_reason` | `finishReason` | Maps `stop`, `length`, content-filter, and tool-call finish reasons to Dogpile's provider-neutral finish reason union. |
| `usage.prompt_tokens` / `usage.completion_tokens` / `usage.total_tokens` | `usage` | Maps input/output/total tokens when all counts are available. |
| Caller `costEstimator` return value | `costUsd` | Calls `costEstimator({ providerId, request, response, usage })`; Dogpile does not ship or infer a pricing table. |
| `id`, `object`, `created`, `model`, and `usage` | `metadata.openAICompatible` | Stores JSON-compatible response metadata. |
| HTTP/provider failures | `DogpileError` | Wraps failures with stable string codes such as `provider-rate-limited`, `provider-authentication`, `provider-invalid-request`, and `provider-unavailable`. |

## Runtime Tool Input Validation

Runtime tools can define an optional `validateInput(input)` hook when their
JSON schema is not enough to enforce the executable contract. Dogpile validates
the tool definition at registration time, before protocol execution begins; if
`validateInput` is present, it must be callable. Invalid registrations fail with
`DogpileError` code `"invalid-configuration"` and a `detail.path` such as
`tools[0].validateInput`.

For each registered tool call, Dogpile emits the `tool-call` event, builds the
`RuntimeToolExecutionContext`, then calls `validateInput()` with the normalized
JSON object input immediately before `execute()`. If the hook is omitted, the
input is treated as valid. If the hook returns `{ type: "invalid", issues }`,
Dogpile does not call `execute()`. Instead it returns and emits a
`RuntimeToolErrorResult` with `error.code: "invalid-input"`, `retryable: false`,
and `error.detail.issues` copied from the validation result. This is tool-result
data, not a thrown `DogpileError`, so traces and transcripts remain replayable.

Tool authors should keep `inputSchema` as the model-visible JSON contract and
use `validateInput()` for runtime-only checks such as cross-field constraints,
caller policy, adapter limits, or stricter type narrowing before side effects.
Return serializable `RuntimeToolValidationIssue` objects for ordinary bad model
or caller input instead of throwing. Keep the hook deterministic and side-effect
free because it runs on every execution of that tool; put network calls,
filesystem work, sandbox execution, and other effects inside `execute()` after
validation has passed.

```ts
import { type RuntimeTool } from "@dogpile/sdk";

interface LookupInput {
  readonly query?: string;
}

const lookupTool: RuntimeTool<LookupInput> = {
  identity: {
    id: "app.tools.lookup",
    name: "lookup",
    description: "Look up release context."
  },
  inputSchema: {
    kind: "json-schema",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  validateInput(input) {
    return typeof input.query === "string" && input.query.trim().length > 0
      ? { type: "valid" }
      : {
          type: "invalid",
          issues: [
            {
              code: "missing-field",
              path: "query",
              message: "query is required."
            }
          ]
        };
  },
  execute(input, context) {
    return {
      type: "success",
      toolCallId: context.toolCallId,
      tool: this.identity,
      output: {
        answer: `result for ${input.query}`
      }
    };
  }
};
```

## DogpileError Codes

`DogpileError` and `DogpileErrorCode` are exported from `@dogpile/sdk`. The
string `code` values below are the stable v1 contract for JavaScript callers,
TypeScript discriminated-union handling, retry policy, and observability. When
`retryable` is present, prefer it over a hard-coded policy; the handling column
describes the default caller posture when provider metadata does not override
it.

| Code | When Dogpile emits it | Caller handling |
| --- | --- | --- |
| `invalid-configuration` | Public entrypoint or adapter validation fails before a model turn starts, including malformed `run()`, `stream()`, `createEngine()`, runtime tool, provider registration, or OpenAI-compatible adapter options. `detail.path` points at the failing input. | Treat as a caller/configuration bug. Do not retry the same request; fix the option named by `detail.path`. |
| `aborted` | A caller `AbortSignal`, `StreamHandle.cancel()`, or provider-facing abort failure cancels an active run or stream. | Treat as intentional cancellation. Stop consuming the run, clean up UI/state, and start a new request only if the user asks. |
| `timeout` | Dogpile's own `budget.timeoutMs` deadline expires and Dogpile aborts the active provider-facing request. | Safe to retry with a larger timeout, smaller workload, cheaper/faster tier, or different provider. |
| `provider-authentication` | The configured provider reports authentication or authorization failure, including HTTP 401/403 or API key loading errors. | Do not blindly retry. Refresh credentials, permissions, provider configuration, or account state. |
| `provider-invalid-request` | The provider SDK rejects the model request shape, prompt, tool choice/input, argument set, or type validation before a valid provider response is produced. | Treat as a request-construction bug. Fix the prompt/tool/options payload before retrying. |
| `provider-invalid-response` | The provider returns an empty, unparsable, schema-invalid, or no-output response that the configured adapter cannot normalize. | Usually safe to retry once or fail over; log `detail` because repeated failures may indicate provider drift or an unsupported response shape. |
| `provider-not-found` | The provider SDK reports a missing provider, model, route, or resource, including HTTP 404. | Do not retry unchanged. Verify the configured model id, provider id, deployment, and account access. |
| `provider-rate-limited` | The provider indicates quota, contention, or rate limiting, including HTTP 409/429. | Retry with backoff or switch providers; surface quota pressure when retries are exhausted. |
| `provider-timeout` | The provider or upstream gateway times out the request, including HTTP 408/504. | Retry with backoff, reduce prompt/work size, or fail over to another provider. |
| `provider-unavailable` | The provider is temporarily unavailable, including HTTP 5xx responses or retry exhaustion. | Retry with backoff or fail over. Preserve the original `providerId` and `detail` for incident correlation. |
| `provider-unsupported` | The provider/model does not support a requested function or model version. | Do not retry unchanged. Disable the unsupported feature or choose a model that supports it. |
| `provider-error` | The configured adapter reports a generic provider failure that Dogpile cannot map to a narrower provider code. | Check `retryable` and `detail.statusCode` when present. Retry transient status codes; otherwise inspect provider diagnostics. |
| `unknown` | Dogpile catches an unrecognized provider or adapter failure with no stable mapping. | Treat conservatively: log `detail`, avoid assuming retry safety unless `retryable` is true, and add handling once the underlying failure is understood. |

Use `stream()` or `Dogpile.stream()` when you need a live event log, and `createEngine()` when a research harness needs reusable low-level protocol settings across many missions.

## Benchmark Artifacts

Benchmark runners and deterministic provider fixtures remain repository test
harnesses in v1. They are intentionally not exported from `@dogpile/sdk`.
Repository tests and benchmark harnesses that need those helpers import them
from the source-only internal path `../internal.js`, which resolves to
`src/internal.ts` in the TypeScript source tree.
Consumer applications should build reproducibility artifacts from the public
`RunResult`, `Trace`, `transcript`, `eventLog`, and cost summary returned by
`run()`, `stream()`, or `Dogpile.pile()`.

## Single-Call Workflow Contract

Application code starts with `Dogpile.pile()`: provide the mission and a model
provider adapter. When `protocol`, `tier`, and `budget` are omitted, Dogpile
uses the default application flow: Sequential coordination, the `balanced`
cost/quality tier, and no hard budget caps beyond the tier preset.

```ts
const result = await Dogpile.pile({
  intent: "Plan the safest SDK v1 release sequence.",
  model: provider
});

console.log(result.output);
console.log(result.trace.events);
console.log(result.transcript);
```

Pass explicit controls when the application needs a non-default protocol,
cost tier, or hard budget cap:

```ts
const result = await Dogpile.pile({
  intent: "Plan the safest SDK v1 release sequence.",
  protocol: "sequential",
  tier: "balanced",
  model: provider,
  budget: { maxTokens: 20_000 }
});
```

Use an explicit protocol configuration when the workflow needs custom
coordination limits, and pair it with an explicit cost tier plus hard caps:

```ts
import { Dogpile, type Budget, type ProtocolConfig } from "@dogpile/sdk";

const protocol = {
  kind: "broadcast",
  maxRounds: 2
} satisfies ProtocolConfig;

const budget = {
  tier: "quality",
  maxUsd: 0.5,
  maxTokens: 24_000,
  qualityWeight: 0.85
} satisfies Budget;

const result = await Dogpile.pile({
  intent: "Produce a release-risk brief with independent reviewer opinions.",
  protocol,
  tier: budget.tier,
  model: provider,
  budget: {
    maxUsd: budget.maxUsd,
    maxTokens: budget.maxTokens,
    qualityWeight: budget.qualityWeight
  }
});

console.log(result.output);
console.log(result.trace.protocol);
console.log(result.trace.events);
```

The required inputs are:

- `intent`: the mission the agent collective should solve.
- `model`: a caller-owned `ConfiguredModelProvider`, backed by your direct provider client, a compatible HTTP endpoint, or a test fixture.

Optional inputs refine the run without changing the core contract:

- `protocol`: `"coordinator"`, `"sequential"`, `"broadcast"`, or `"shared"`, or an explicit protocol config such as `{ kind: "broadcast", maxRounds: 2 }`; omitted protocols default to `"sequential"`.
- `tier`: `"fast"`, `"balanced"`, or `"quality"`; omitted tiers default to `"balanced"`.
- `budget`: hard caps layered over the tier, for example `{ maxUsd: 0.25, maxTokens: 20_000, timeoutMs: 60_000, qualityWeight: 0.7 }`. When `timeoutMs` expires, Dogpile aborts the active provider-facing request and rejects with `DogpileError` code `"timeout"`.
- `agents`: an explicit roster of `{ id, role, instructions? }` participants.
- `temperature`: an override for the tier-selected default sampling temperature.

Invalid caller configuration is rejected before any protocol turn starts with
`DogpileError` code `"invalid-configuration"` and `retryable: false`. The
error `detail` includes `kind: "configuration-validation"`, the failing
`path`, the `rule`, and the expected shape. Validation covers required
`intent`, provider registrations, protocol and tier enums, positive turn/round
limits, non-negative budget caps, normalized `qualityWeight`, agent and tool
shapes, termination policies, `AbortSignal` inputs, and built-in provider
adapter options.

Every completed call returns the same result shape:

```ts
type RunResult = {
  output: string;
  eventLog: RunEventLog;
  trace: Trace;
  transcript: readonly TranscriptEntry[];
  usage: RunUsage;
  metadata: RunMetadata;
  accounting: RunAccounting;
  cost: CostSummary;
  quality?: number;
};
```

- `output` is the final synthesized answer.
- `eventLog` is the complete non-streaming event log with ordered event types, count, and events.
- `trace` is a JSON-serializable replay artifact containing the run id, protocol, tier, model provider id, agents used, ordered event log, and transcript.
- `trace.events` is the full event log for coordination moments: `role-assignment`, `agent-turn`, `broadcast`, and `final`.
- `transcript` is the ordered list of model-visible agent turns with `agentId`, `role`, `input`, and `output`; it matches `trace.transcript` for ergonomic access.
- `usage` reports aggregate USD and token accounting.
- `metadata` exposes run id, protocol, tier, model provider id, participating agents, and start/completion timestamps.
- `accounting` bundles the selected tier, optional budget caps, termination policy, final usage/cost, budget state snapshots, and cap utilization.
- `cost` is retained as a compatibility alias for `usage`.

## Replay Trace Contract

`result.trace` is the canonical replay artifact for a completed run. It is
versioned by `schemaVersion`, JSON-serializable, and contains all SDK-owned
state required to inspect or reproduce the coordination path without Dogpile
storage. Callers own persistence and may save the trace as JSON, NDJSON-derived
records, object storage, or database rows.

The required trace sections are:

- `inputs`: normalized mission, protocol config, tier, model provider id,
  agent roster, and temperature.
- `budget`: selected tier, caller caps, and the serializable termination policy
  used by the run.
- `seed`: caller seed metadata, or an explicit `source: "none"` record when no
  seed was supplied.
- `events`: the ordered event log emitted during execution.
- `protocolDecisions`: one replay decision per event, with `eventIndex`
  pointing at the corresponding `events[eventIndex]`.
- `providerCalls`: every provider request and provider response, ordered by
  execution and keyed by stable `callId` values such as
  `${runId}:provider-call:1`.
- `budgetStateChanges`: cumulative cost snapshots derived from cost-bearing
  events.
- `transcript`: ordered model-visible prompt/output turns.
- `finalOutput`: terminal output, final cost, completion timestamp, and
  transcript link.

Event ordering is authoritative. `trace.events`, `result.eventLog.events`, and
the live events yielded by `stream()` use the same order for completed runs.
`result.eventLog.eventTypes` is exactly `trace.events.map(event => event.type)`,
and `protocolDecisions[n].eventIndex === n` for each recorded coordination
moment. The terminal event is always `final` for a successful run, and
`trace.finalOutput.output` matches `result.output`.

Provider responses are preserved in `trace.providerCalls`, not inferred from
final text. Each provider call stores the exact provider-neutral `ModelRequest`
handed to the configured adapter and the exact `ModelResponse` returned by that
adapter, including optional usage and USD cost. For current protocol runners,
provider calls are ordered one-to-one with transcript entries and completed
`agent-turn` events: the `n`th provider response text is the `n`th transcript
output, and the `n`th transcript input is the final user message in the `n`th
provider request. Streaming providers may additionally emit
`model-output-chunk` events before the completed `agent-turn`; the completed
provider response remains the replay source for the final turn text.

Use `Dogpile.stream()` when the UI or harness needs the event log as it happens.
The stream yields the same `RunEvent` values that will later appear in
`result.trace.events`, and the final result is available through
`handle.result`. Pass `signal` to propagate caller cancellation through
streamed provider requests, or call `handle.cancel()` to abort the active
provider-facing request, close the stream iterator, mark `handle.status` as
`"cancelled"`, and reject `handle.result` with `DogpileError` code
`"aborted"`.

```ts
const abortController = new AbortController();
const handle = Dogpile.stream({
  intent: "Compare release risks across protocol variants.",
  protocol: "broadcast",
  tier: "quality",
  model: provider,
  budget: { maxTokens: 12_000 },
  signal: abortController.signal
});

for await (const event of handle) {
  if (event.type === "agent-turn") {
    renderTurn(event.agentId, event.output);
  }
}

// Later, if the user leaves the view or stops the workflow:
// handle.cancel();

const result = await handle.result;
```

Use `replay()` / `Dogpile.replay()` or `replayStream()` /
`Dogpile.replayStream()` when loading a trace artifact you already persisted.
The replay entrypoints accept the saved `Trace` object and reconstruct the same
public `RunResult`, event stream, and transcript without calling a model,
reading disk, or using SDK-managed storage:

```ts
import { Dogpile, replay, replayStream, type Trace } from "@dogpile/sdk";

const trace = await loadJson<Trace>("run-trace.json");

const result = replay(trace);
const sameResult = Dogpile.replay(trace);
const replayHandle = replayStream(trace);

for await (const event of replayHandle) {
  renderReplayEvent(event);
}

console.log(result.output);
console.log(result.eventLog.events);
console.log(sameResult.transcript);
console.log((await replayHandle.result).output);
```

Researchers can drop below the single-call surface with `createEngine()` while
keeping the same stateless result contract:

```ts
const engine = Dogpile.createEngine({
  protocol: { kind: "sequential", maxTurns: 4 },
  tier: "balanced",
  model: provider,
  agents
});

const reproductionRun = await engine.run("Reproduce the paper triage task.");
```

For a lower-level reproduction harness, keep protocol settings and agents fixed
on the engine, capture only the streaming events you need for live analysis, and
persist the completed trace/transcript yourself:

```ts
import {
  Dogpile,
  type AgentSpec,
  type ProtocolConfig,
  type RunEvent,
  type TranscriptEntry
} from "@dogpile/sdk";

const protocol = {
  kind: "shared",
  maxTurns: 4
} satisfies ProtocolConfig;

const agents = [
  { id: "a", role: "solver", instructions: "Solve the task directly." },
  { id: "b", role: "auditor", instructions: "Challenge weak assumptions." },
  { id: "c", role: "editor", instructions: "Merge the strongest answer." }
] satisfies readonly AgentSpec[];

const engine = Dogpile.createEngine({
  protocol,
  tier: "quality",
  model: provider,
  agents,
  temperature: 0.1,
  budget: { maxTokens: 16_000, qualityWeight: 0.9 }
});

const handle = engine.stream("Re-run the L3 release readiness triage fixture.");
const eventLog: RunEvent[] = [];

for await (const event of handle) {
  if (event.type === "agent-turn" || event.type === "broadcast") {
    eventLog.push(event);
  }
}

const result = await handle.result;
const transcript: readonly TranscriptEntry[] = result.transcript;
const replayArtifact = {
  output: result.output,
  eventLog,
  transcript,
  trace: result.trace
};

await saveJson(replayArtifact);
```
