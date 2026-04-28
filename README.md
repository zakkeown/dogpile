# Dogpile

[![npm version](https://img.shields.io/npm/v/@dogpile/sdk?color=0f766e&label=npm)](https://www.npmjs.com/package/@dogpile/sdk)
[![Release Validation](https://github.com/bubstack/dogpile/actions/workflows/release-validation.yml/badge.svg)](https://github.com/bubstack/dogpile/actions/workflows/release-validation.yml)
[![Node.js >=22](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/types-TypeScript-3178c6?logo=typescript&logoColor=white)](src/index.ts)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![pnpm 10.33.0](https://img.shields.io/badge/pnpm-10.33.0-f69220?logo=pnpm&logoColor=white)](package.json)

Dogpile is the TypeScript coordination layer for product teams that want
multi-agent work without handing their application to an agent framework.

Give Dogpile one mission and one model boundary. It runs a coordination
protocol, records every turn, streams the run if you need a live UI, totals
usage and cost, and hands back a replayable artifact your app can store
wherever work already lives.

```ts
import { Dogpile } from "@dogpile/sdk";

const result = await Dogpile.pile({
  intent: "Stress-test this release plan before it ships.",
  model,
  protocol: "broadcast",
  tier: "quality"
});

console.log(result.output);
console.log(result.trace.events);
```

Dogpile is useful when a single model answer is too brittle, but a full agent
platform would own too much:

- release planning that needs a planner, critic, and synthesizer
- policy or support workflows that need independent review before final text
- product research where protocol choice should be visible and repeatable
- eval harnesses that compare `sequential`, `broadcast`, `shared`, and
  `coordinator` runs against the same mission
- application features that need agent progress events, cancellation, budgets,
  typed failures, and saved traces instead of a black-box response string

## The Contract

Dogpile keeps the coordination loop strict and leaves the rest with you.

Dogpile owns:

- agent turns, transcripts, protocol events, and final synthesis
- first-party `sequential`, `broadcast`, `shared`, and `coordinator` protocols
- streaming events that match the final trace
- cancellation, timeouts, budgets, termination policy, and typed errors
- JSON-serializable run artifacts for replay, audit, evals, and debugging

Your application owns:

- credentials, provider SDKs, model routing, retries, and failover
- pricing tables and cost estimation
- persistence, queues, permissions, UI, and tool side effects
- any production policy around web search, code execution, or other tools

That boundary is the value proposition: Dogpile gives you coordinated model
work you can observe and replay, without taking over the product surface around
it.

## Choose Your Path

| Need | Start here |
| --- | --- |
| Run one coordinated mission | `Dogpile.pile({ intent, model })` |
| Keep a UI or log view live | `Dogpile.stream({ intent, model })` |
| Compare coordination strategies | Pick `sequential`, `broadcast`, `shared`, or `coordinator` |
| Reuse fixed settings across many runs | `Dogpile.createEngine({ protocol, tier, model })` |
| Save and reload a completed run | Persist `result.trace`, then call `Dogpile.replay(trace)` |
| Use direct HTTP with OpenAI-compatible servers | `createOpenAICompatibleProvider(options)` |

## Install

Dogpile ships to npm as `@dogpile/sdk`, a pure TypeScript package with its own
provider-neutral model interface. The package root has no provider SDK peer
dependency: pass any object that implements `ConfiguredModelProvider`, or use
the built-in dependency-free OpenAI-compatible adapter for direct HTTP calls.

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

Dogpile itself does not read API keys or any other environment variables. Your
provider object owns credentials, routing, pricing, retries, and any vendor
SDKs.

The SDK supports only Node.js LTS 22 / 24, Bun latest, and browser ESM runtimes.
Core APIs are stateless and do not require filesystem access, a database, or a
session store. Browser-aware bundlers can use the package root's `browser`
export condition, and direct browser ESM consumers can import the bundled
entrypoint from `@dogpile/sdk/browser`.

## Quickstart

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

## Documentation

- [Developer usage guide](https://github.com/bubstack/dogpile/blob/main/docs/developer-usage.md):
  deeper API choices, providers, protocols, streaming, termination, tools,
  replay, errors, browser usage, and repo commands.
- [API and trace reference](https://github.com/bubstack/dogpile/blob/main/docs/reference.md):
  provider contracts,
  OpenAI-compatible mapping, runtime tool validation, errors, result shapes, and
  replay traces.
- [Release and package guide](https://github.com/bubstack/dogpile/blob/main/docs/release.md):
  versioning, packed tarball
  checks, release validation, CI status checks, and npm publishing.
- [Examples](examples/README.md): repeatable protocol comparison and live
  OpenAI-compatible execution.
- [Changelog](CHANGELOG.md): release notes and public-surface changes.

## Research Basis

Dogpile's protocol vocabulary and paper-faithfulness examples are based on:

Dochkina, V. (2026). *Drop the Hierarchy and Roles: How Self-Organizing LLM Agents Outperform Designed Structures*. arXiv:2603.28990 [cs.AI]. https://doi.org/10.48550/arXiv.2603.28990

```bibtex
@misc{dochkina2026drop,
  title = {Drop the Hierarchy and Roles: How Self-Organizing LLM Agents Outperform Designed Structures},
  author = {Dochkina, Victoria},
  year = {2026},
  eprint = {2603.28990},
  archivePrefix = {arXiv},
  primaryClass = {cs.AI},
  doi = {10.48550/arXiv.2603.28990},
  url = {https://arxiv.org/abs/2603.28990}
}
```
