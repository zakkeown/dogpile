# Dogpile API and Trace Reference

This reference collects the contract details that are too dense for the README.
Start with the [developer usage guide](developer-usage.md) if you want a guided
walkthrough; use this page when you need exact provider, tool, error, result,
or trace semantics.

## Provider Boundary

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

## OpenAI-Compatible Provider Configuration

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

Runtime tools can define an optional `validateInput(input)` hook when their JSON
schema is not enough to enforce the executable contract. Dogpile validates the
tool definition at registration time, before protocol execution begins; if
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

## DogpileError Codes

`DogpileError` and `DogpileErrorCode` are exported from `@dogpile/sdk`. The
string `code` values below are the stable public contract for JavaScript
callers, TypeScript discriminated-union handling, retry policy, and
observability. When `retryable` is present, prefer it over a hard-coded policy.

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

## Single-Call Workflow Contract

Application code starts with `Dogpile.pile()`: provide the mission and a model
provider adapter. When `protocol`, `tier`, and `budget` are omitted, Dogpile
uses the default application flow: Sequential coordination, the `balanced`
cost/quality tier, and no hard budget caps beyond the tier preset.

The required inputs are:

- `intent`: the mission the agent collective should solve.
- `model`: a caller-owned `ConfiguredModelProvider`, backed by your direct
  provider client, a compatible HTTP endpoint, or a test fixture.

Optional inputs refine the run without changing the core contract:

- `protocol`: `"coordinator"`, `"sequential"`, `"broadcast"`, or `"shared"`,
  or an explicit protocol config such as `{ kind: "broadcast", maxRounds: 2 }`;
  omitted protocols default to `"sequential"`.
- `tier`: `"fast"`, `"balanced"`, or `"quality"`; omitted tiers default to
  `"balanced"`.
- `budget`: hard caps layered over the tier, for example
  `{ maxUsd: 0.25, maxTokens: 20_000, timeoutMs: 60_000, qualityWeight: 0.7 }`.
  When `timeoutMs` expires, Dogpile aborts the active provider-facing request
  and rejects with `DogpileError` code `"timeout"`.
- `agents`: an explicit roster of `{ id, role, instructions? }` participants.
- `temperature`: an override for the tier-selected default sampling
  temperature.

Invalid caller configuration is rejected before any protocol turn starts with
`DogpileError` code `"invalid-configuration"` and `retryable: false`. The error
`detail` includes `kind: "configuration-validation"`, the failing `path`, the
`rule`, and the expected shape.

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
Provider responses are preserved in `trace.providerCalls`, not inferred from
final text. Use `replay()` / `Dogpile.replay()` or `replayStream()` /
`Dogpile.replayStream()` when loading a trace artifact you already persisted.

## Benchmark Artifacts

Benchmark runners and deterministic provider fixtures remain repository test
harnesses in this release. They are intentionally not exported from
`@dogpile/sdk`. Repository tests and benchmark harnesses that need those helpers
import them from the source-only internal path `../internal.js`, which resolves
to `src/internal.ts` in the TypeScript source tree. Consumer applications should
build reproducibility artifacts from the public `RunResult`, `Trace`,
`transcript`, `eventLog`, and cost summary returned by `run()`, `stream()`, or
`Dogpile.pile()`.
