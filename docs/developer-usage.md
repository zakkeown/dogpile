# Dogpile Developer Usage Guide

This guide is for application developers and experiment authors who want to use
`@dogpile/sdk` directly. The README carries the release contract and the
copy-paste quickstart; this file focuses on how to choose the right API, wire a
provider, control a run, and keep artifacts useful after the model call ends.

## Mental Model

Dogpile is a stateless coordination layer. You bring a mission and a model
provider; Dogpile runs a protocol and returns a typed artifact.

Dogpile owns:

- protocol orchestration for `sequential`, `broadcast`, `shared`, and
  `coordinator`
- agent turn events, transcripts, cost aggregation, and replay traces
- configuration validation, cancellation, timeouts, and termination policy
- runtime tool envelopes and serializable tool result shapes

Your application owns:

- credentials, provider SDKs, model routing, retries, and failover
- pricing tables and `costUsd` estimation
- persistence of traces, transcripts, and event logs
- UI rendering, user permissions, tool authorization, and side effects

That split is intentional. Dogpile does not read environment variables, create
databases, own a queue, or hide provider calls behind global state.

## Install

```sh
pnpm add @dogpile/sdk
```

Dogpile supports Node.js LTS 22 / 24, Bun latest, and browser ESM runtimes. The
package root has no provider SDK peer dependency. Use any object that implements
`ConfiguredModelProvider`, or use the built-in OpenAI-compatible HTTP adapter.

## Choose An API

| Need | Use | Why |
| --- | --- | --- |
| One mission in application code | `Dogpile.pile(options)` | Branded high-level API with defaults for protocol and tier. |
| Functional style without the namespace | `run(options)` | Same result shape as `Dogpile.pile()`. |
| Live progress for a UI or log stream | `Dogpile.stream(options)` or `stream(options)` | Async iterable events plus a final `result` promise. |
| Fixed protocol/model/agents across many missions | `Dogpile.createEngine(options)` | Reuses normalized settings while keeping each run stateless. |
| Load a saved artifact without calling a model | `Dogpile.replay(trace)` | Rehydrates `RunResult` from a completed trace. |
| Render saved events as a stream | `Dogpile.replayStream(trace)` | Replays persisted events through the streaming shape. |

## Minimal Provider

`ConfiguredModelProvider` is the boundary between Dogpile and whatever model
stack you use. The provider gets normalized messages, temperature, metadata,
and cancellation signal. It returns text plus optional usage and cost.

```ts
import { Dogpile, type ConfiguredModelProvider } from "@dogpile/sdk";

const model: ConfiguredModelProvider = {
  id: "docs-echo-provider",
  async generate(request) {
    return {
      text: `Handled ${request.messages.length} messages at t=${request.temperature}.`,
      usage: {
        inputTokens: 32,
        outputTokens: 12,
        totalTokens: 44
      },
      costUsd: 0.00001
    };
  }
};

const result = await Dogpile.pile({
  intent: "Draft an SDK release checklist.",
  model
});

console.log(result.output);
console.log(result.metadata.protocol);
console.log(result.trace.events.length);
```

High-level calls default to:

- protocol: `sequential`
- tier: `balanced`
- agents: planner, critic, synthesizer
- storage: none

## OpenAI-Compatible HTTP

Use `createOpenAICompatibleProvider()` when your endpoint speaks the
chat-completions shape. Dogpile forwards your explicit `apiKey`, `baseURL`,
headers, and model id. It does not infer credentials from the environment.

```ts
import { Dogpile, createOpenAICompatibleProvider } from "@dogpile/sdk";

const model = createOpenAICompatibleProvider({
  id: "openai:gpt-4.1-mini",
  model: "gpt-4.1-mini",
  apiKey: process.env.OPENAI_API_KEY,
  maxOutputTokens: 1_024,
  costEstimator({ usage }) {
    return usage ? usage.totalTokens * 0.0000003 : undefined;
  }
});

const result = await Dogpile.pile({
  intent: "Compare two API migration plans and pick the safer one.",
  protocol: "sequential",
  tier: "balanced",
  model
});
```

For local or vendor-compatible servers, set `baseURL`, `path`, and any headers:

```ts
const localModel = createOpenAICompatibleProvider({
  id: "local:planner",
  model: "local-planner",
  baseURL: "http://127.0.0.1:8080/v1",
  path: "/chat/completions",
  headers: {
    "x-workspace": "dogpile"
  }
});
```

## Protocols

Use a named protocol for defaults, or pass an explicit protocol config.

```ts
await Dogpile.pile({
  intent: "Review this rollout plan.",
  protocol: "broadcast",
  model
});

await Dogpile.pile({
  intent: "Review this rollout plan with exactly two broadcast rounds.",
  protocol: { kind: "broadcast", maxRounds: 2 },
  model
});
```

Protocol choices:

- `sequential`: agents refine the prior transcript in order.
- `broadcast`: agents answer independently, then merge.
- `shared`: agents coordinate through shared state and optional organizational
  memory.
- `coordinator`: a coordinator manages worker turns and synthesis.

Use `sequential` for ordinary product flows, `broadcast` when independent
opinions matter, `shared` when a common state snapshot matters, and
`coordinator` when you want explicit manager-worker structure.

## Streaming

`Dogpile.stream()` starts immediately and returns an async iterable handle. The
events you render live are the same events persisted in `result.trace.events`
after completion.

```ts
const handle = Dogpile.stream({
  intent: "Plan a migration and show each agent turn as it happens.",
  protocol: "sequential",
  tier: "quality",
  model
});

for await (const event of handle) {
  if (event.type === "agent-turn") {
    console.log(`${event.role}: ${event.output}`);
  }
  if (event.type === "final") {
    console.log(`final: ${event.output}`);
  }
}

const result = await handle.result;
```

Cancel a live stream when the user leaves the page or stops the workflow:

```ts
handle.cancel();

try {
  await handle.result;
} catch (error) {
  // DogpileError code "aborted" marks caller cancellation.
}
```

You can also pass an `AbortSignal` through `Dogpile.pile()`, `run()`, or
`stream()` so active provider requests receive cancellation.

## Budgets And Termination

Use `budget` for hard caps and `terminate` for serializable stop policies.

```ts
import { Dogpile, budget, convergence, firstOf } from "@dogpile/sdk";

const result = await Dogpile.pile({
  intent: "Find a conservative answer without spending forever.",
  model,
  tier: "quality",
  budget: {
    maxUsd: 0.25,
    maxTokens: 20_000,
    timeoutMs: 60_000
  },
  terminate: firstOf(
    budget({ maxUsd: 0.25, maxTokens: 20_000, timeoutMs: 60_000 }),
    convergence({ stableTurns: 2, minSimilarity: 0.86 })
  )
});

console.log(result.accounting.usage);
console.log(result.accounting.budgetStateChanges);
```

Budget caps are caller policy. Dogpile records the selected tier, caps,
termination policy, usage, cap utilization, and any terminal stop record in the
result and trace.

## Evaluation

Pass `evaluate` when a caller-owned judge should score the completed run before
the result is exposed.

```ts
const result = await Dogpile.pile({
  intent: "Write a short support response.",
  model,
  evaluate(run) {
    return {
      quality: run.output.includes("next step") ? 0.8 : 0.4,
      rationale: run.output.includes("next step")
        ? "The answer includes an actionable next step."
        : "The answer needs a clearer next step.",
      metadata: {
        rubric: "support-rubric-v1",
        checkedForNextStep: true
      }
    };
  }
});

console.log(result.quality);
console.log(result.evaluation);
```

The evaluator is application code. Dogpile stores the normalized quality and
serializable evaluation payload on the final event and result.

## Runtime Tools

Tools are caller-owned effects wrapped in a serializable contract. Dogpile
exposes tool identity, input schema, permissions, calls, and results in events
and traces. It does not grant permissions or provide a code sandbox.

```ts
import {
  Dogpile,
  createWebSearchToolAdapter,
  type WebSearchToolOutput
} from "@dogpile/sdk";

const webSearch = createWebSearchToolAdapter({
  endpoint: "https://search.example.test/query",
  async parseResponse(response): Promise<WebSearchToolOutput> {
    const payload = await response.json() as {
      results: Array<{ title: string; url: string }>;
    };
    return {
      results: payload.results.map((result) => ({
        title: result.title,
        url: result.url
      }))
    };
  }
});

const result = await Dogpile.pile({
  intent: "Research release-note examples.",
  model,
  tools: [webSearch]
});
```

For code execution, supply your own sandbox:

```ts
import { createCodeExecToolAdapter } from "@dogpile/sdk";

const codeExec = createCodeExecToolAdapter({
  languages: ["javascript"],
  defaultTimeoutMs: 1_000,
  async execute(input) {
    return {
      stdout: "",
      stderr: "sandbox not wired in this example",
      exitCode: 1,
      metadata: {
        language: input.language
      }
    };
  }
});
```

Use `validateInput` on custom `RuntimeTool` objects for deterministic,
side-effect-free checks that should run before `execute()`.

### Web Search Adapter Threat Model

The built-in `webSearch` adapter forwards caller-supplied `endpoint`/headers
together with a model-generated `query`. That combination creates two risks
that callers must address — Dogpile does not enforce any of them by default:

- **Host allowlist.** If `endpoint` or a custom `WebSearchFetchRequestBuilder`
  ever reads from caller-controlled state (user input, model output, env), a
  confused-deputy issue can redirect requests. Constrain the allowed hosts
  explicitly inside your `WebSearchFetch` implementation, and reject any URL
  outside the list before issuing the network call.
- **Header redaction.** Auth tokens or upstream credentials threaded through
  request headers will land in the trace if they appear in
  `RuntimeToolCallEvent.input` or `RuntimeToolResultEvent.output`. Strip them
  inside your `WebSearchFetchRequestBuilder` and your `parseResponse`.
- **Response size cap.** A malicious or misbehaving search backend can return
  a response large enough to inflate the trace and the event log. Enforce a
  byte cap inside `parseResponse` (read with a size-bounded reader, or check
  `Content-Length`) and surface a typed error rather than passing the payload
  through.

### OpenAI-Compatible Provider And SSRF

`createOpenAICompatibleProvider({ baseURL })` is a thin HTTP adapter — Dogpile
does not allowlist hosts because doing so would violate provider neutrality.
If a downstream consumer ever reflects user input into `baseURL`, the SDK will
happily talk to internal addresses.

When the consumer cannot statically pin `baseURL`, validate it before passing
it in: parse with `URL`, reject anything that resolves to private/loopback
ranges, and allowlist the known providers your application actually supports.

## Replay And Persistence

Dogpile does not store anything for you. Persist the artifact your application
needs, usually `result.trace` plus any indexes you want for search.

```ts
import { Dogpile, type Trace } from "@dogpile/sdk";
import { readFile, writeFile } from "node:fs/promises";

const result = await Dogpile.pile({
  intent: "Write an incident-retrospective outline.",
  model
});

await writeFile("dogpile-trace.json", JSON.stringify(result.trace, null, 2));

const savedTrace = JSON.parse(await readFile("dogpile-trace.json", "utf8")) as Trace;
const replayed = Dogpile.replay(savedTrace);

console.log(replayed.output);
console.log(replayed.transcript.length);
```

Replay never calls a provider. It reconstructs the public result shape from the
trace you already saved.

### Replay Determinism Rules

Traces must be JSON-serializable end-to-end so saved traces survive cold
storage and round-trip through `replay()`. When you extend events, results,
or trace artifacts (in your own forks or with caller-supplied
`metadata`/`detail`), keep the values JSON-primitive:

- Use ISO-8601 strings, not `Date` instances.
- Use plain `Record<string, JsonValue>`, not `Map` or `Set`.
- Avoid `bigint` — they do not survive `JSON.stringify`.
- Avoid sparse arrays and `undefined` slots — `JSON.stringify` drops them
  silently and `replay()` will not reconstruct them.
- Avoid functions, class instances, or circular references.

The `src/tests/result-contract.test.ts` and
`src/tests/replay-version-skew.test.ts` gates assert this contract. A frozen
v0.3 trace fixture lives at `src/tests/fixtures/replay-trace-v0_3.json` and
must round-trip through every published `replay()`.

## Error Handling

Public failures use `DogpileError` with stable string codes.

```ts
import { DogpileError } from "@dogpile/sdk";

try {
  await Dogpile.pile({
    intent: "Summarize the release risk.",
    model
  });
} catch (error) {
  if (DogpileError.isInstance(error)) {
    console.error(error.code, error.retryable, error.providerId, error.detail);
  } else {
    throw error;
  }
}
```

Common application branches:

- `invalid-configuration`: fix caller options before retrying.
- `aborted`: user or caller cancellation.
- `timeout`: retry with a larger timeout or smaller workload.
- `provider-rate-limited`, `provider-timeout`, `provider-unavailable`: retry
  with backoff or fail over.
- `provider-authentication`, `provider-not-found`, `provider-unsupported`: fix
  credentials, model id, or feature choice.

## Retrying Provider Failures

`withRetry` wraps any `ConfiguredModelProvider` with a transient-failure retry
policy. The wrapper preserves provider neutrality — it is opt-in, has no peer
dependencies, and never inspects the underlying SDK.

```ts
import { createOpenAICompatibleProvider, Dogpile, withRetry } from "@dogpile/sdk";

const rawProvider = createOpenAICompatibleProvider({
  baseURL: "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY!,
  defaultModel: "gpt-4o-mini"
});

const robustProvider = withRetry(rawProvider, {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  jitter: "full",
  onRetry: ({ attempt, delayMs, error, providerId }) => {
    console.warn(`provider ${providerId} retry #${attempt} in ${delayMs}ms`, error);
  }
});

await Dogpile.pile({ intent: "Summarize the release.", model: robustProvider });
```

By default, `withRetry`:

- Retries `DogpileError` codes `provider-rate-limited`, `provider-timeout`,
  and `provider-unavailable`. Never retries `aborted` or
  `invalid-configuration`.
- Treats `TypeError` (the typical fetch network-failure shape) as retryable.
- Honors `error.detail.retryAfterMs` from `DogpileError` when no policy
  override is supplied — useful when your adapter surfaces upstream
  `Retry-After` headers.
- Short-circuits immediately when the request `AbortSignal` is aborted, both
  before each attempt and during the backoff sleep. Cancellation always wins.
- Forwards `provider.stream()` through unchanged. Streaming retries are not
  automated because partial chunks may already have been observed.

Pass a custom `retryOn` predicate to retry on adapter-specific error shapes,
or `delayForError` to honor a non-Dogpile `Retry-After` style hint.

## Structured Logging

`Logger` is a small structured-logging seam: four severity methods that take a
message and an optional JSON-shaped field bag. `loggerFromEvents` bridges any
`Logger` to a stream handle so a caller does not have to write the
event-to-log mapping themselves.

```ts
import {
  Dogpile,
  consoleLogger,
  loggerFromEvents
} from "@dogpile/sdk";

const logger = consoleLogger({ level: "info" });

const handle = Dogpile.stream({ intent: "Plan the migration.", model });
handle.subscribe(loggerFromEvents(logger));

const result = await handle.result;
```

Wire pino, winston, or any other logger by implementing four methods:

```ts
import pino from "pino";
import { Dogpile, loggerFromEvents, type Logger } from "@dogpile/sdk";

const pinoBase = pino({ level: "info" });
const logger: Logger = {
  debug: (message, fields) => pinoBase.debug({ ...fields }, message),
  info: (message, fields) => pinoBase.info({ ...fields }, message),
  warn: (message, fields) => pinoBase.warn({ ...fields }, message),
  error: (message, fields) => pinoBase.error({ ...fields }, message)
};

const handle = Dogpile.stream({ intent, model });
handle.subscribe(loggerFromEvents(logger, { include: ["agent-turn", "budget-stop", "error"] }));
```

Defaults applied by `loggerFromEvents`:

- `model-output-chunk` events log at `debug`.
- `budget-stop` and `tool-result` errors log at `warn`.
- Stream `error` events log at `error`.
- Everything else logs at `info`.

Override per event via `levelFor`. A logger that throws is caught and routed
to the same logger's `error` channel — a misbehaving logger cannot crash an
in-flight run.

## Browser Usage

Browser-aware bundlers can import from the package root and use the `browser`
export condition. Direct browser ESM consumers can import the browser subpath.

```ts
import { Dogpile } from "@dogpile/sdk/browser";
```

Keep server secrets out of browser providers. In browser apps, the provider
usually calls your own backend endpoint, and that backend talks to the vendor
model API.

## Repository Development

From a Dogpile checkout:

```sh
pnpm install
pnpm run build
pnpm run typecheck
pnpm run test
```

Before changing public docs or exports, run the doc-sensitive gates:

```sh
pnpm run package:identity
pnpm exec vitest run src/tests/package-exports.test.ts src/tests/public-error-api.test.ts
```

Before a release:

```sh
pnpm run benchmark:baseline
pnpm run verify
pnpm run pack:check
pnpm run publish:check
```

Use `pnpm run benchmark:baseline -- --iterations 50` when you need a local
before/after timing comparison for existing deterministic protocol-loop
behavior. Treat the JSON output as a baseline artifact, not as a user-facing
performance claim.

The packaged README quickstart is not ornamental. The consumer smoke test
extracts the marked quickstart block from the installed package and executes it
inside a fresh project, so keep that example complete and provider-neutral.
