# Testing Patterns

**Analysis Date:** 2026-04-29

## Test Framework

**Runner:**
- Vitest `^4.1.5` (`package.json` devDependencies).
- No `vitest.config.*` file — Vitest uses defaults plus the project's `tsconfig.json`. The build's Vite config (`vite.browser.config.ts`) is browser-bundle-only and not the test config.

**Assertion library:** Vitest built-in `expect` (`describe`, `it`, `expect`, occasionally `vi`).

**Run Commands:**
```bash
pnpm run test                           # Full suite (vitest run)
pnpm vitest run path/to/foo.test.ts     # Single file
pnpm vitest run -t "name pattern"       # Filter by test name
pnpm run typecheck                      # Strict TS as a lint pass
pnpm run verify                         # Release gate: identity → build → artifacts → quickstart smoke → typecheck → test
pnpm run browser:smoke                  # Build + run browser-bundle smoke
```

## Test File Organization

**Two locations with distinct intents:**

| Location | Purpose | Examples |
|----------|---------|----------|
| Co-located, next to subject | Focused unit tests on one module | `src/runtime/sequential.test.ts`, `src/runtime/coordinator.test.ts`, `src/runtime/broadcast.test.ts`, `src/runtime/shared.test.ts`, `src/providers/openai-compatible.test.ts` |
| `src/tests/` | Cross-cutting contracts: public API, packaging, browser bundle, smoke | `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, `src/tests/package-exports.test.ts`, `src/tests/streaming-api.test.ts`, `src/tests/cancellation-contract.test.ts` |

**Distinct from both:** `src/testing/` is a *published* library of deterministic helpers for SDK consumers (`createDeterministicModelProvider` and friends). It is not internal test code — do not put internal tests there.

**Naming:**
- Files: `<subject>.test.ts` (e.g. `sequential.test.ts`).
- Live integration tests against real providers: `<subject>.live.test.ts` (e.g. `src/providers/vercel-ai-provider.live.test.ts`).
- Smoke tests for packaging/runtime: `<topic>-smoke.test.ts` (e.g. `browser-bundle-smoke.test.ts`, `consumer-type-resolution-smoke.test.ts`).

**Fixtures:**
- Static type-resolution fixtures: `src/tests/fixtures/consumer-type-resolution-smoke.ts`.
- Repro fixtures for paper-reproduction benchmarks: `benchmark-fixtures/` at repo root (excluded from the npm tarball).

## Test Structure

**Standard suite shape (from `src/runtime/sequential.test.ts:1-43`):**
```ts
import { describe, expect, it } from "vitest";
import { createDeterministicModelProvider } from "../internal.js";
import { Dogpile, run, stream } from "../index.js";
import type { ConfiguredModelProvider, ModelRequest, RunEvent } from "../index.js";

describe("sequential protocol", () => {
  it("runs end-to-end against a configured model provider", async () => {
    const result = await run({
      intent: "Draft a release note for a portable multi-agent SDK.",
      protocol: "sequential",
      tier: "fast",
      model: createDeterministicModelProvider()
    });

    expect(result.output).toContain("synthesizer:agent-3");
    expect(result.trace.events.map((e) => e.type)).toEqual([
      "role-assignment", "role-assignment", "role-assignment",
      "agent-turn", "agent-turn", "agent-turn",
      "final"
    ]);
    expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace);
  });
});
```

**Patterns:**
- One top-level `describe` per file, named for the module under test.
- `it` titles are full sentences describing observable behavior, present tense ("runs end-to-end…", "passes a caller AbortSignal through every…").
- No `beforeEach`/`afterEach`/`beforeAll` in the suite (verified: zero matches across test files). Tests construct their own deterministic providers per case.
- Assertions exercise: output, transcript shape, full event-type sequence, and JSON round-trip equality of the trace.

**Type imports in tests:**
- Always import from the published surface (`../index.js`) and the internal helper barrel (`../internal.js`) — never from runtime sub-paths. This keeps tests aligned with what consumers see.

## Mocking

**Framework:** Vitest's `vi` is available but used very sparingly.

**Dominant pattern: hand-rolled fake providers.** The codebase prefers building a `ConfiguredModelProvider` inline over `vi.fn()` mocks (`src/runtime/sequential.test.ts:48-54`):

```ts
const requests: ModelRequest[] = [];
const model: ConfiguredModelProvider = {
  id: "abort-signal-model",
  async generate(request) {
    requests.push(request);
    return { text: `turn-${requests.length}` };
  }
};
```

**Scripted-response provider** for protocol-decision tests (`src/runtime/sequential.test.ts:77-98`):
```ts
const responses = ["...turn 1...", "...turn 2..."];
const model: ConfiguredModelProvider = {
  id: "sequential-decision-model",
  async generate() {
    return { text: responses.shift() ?? "unused" };
  }
};
```

**Deterministic provider:** For protocol shape tests, use `createDeterministicModelProvider()` from `src/testing/deterministic-provider.ts` (re-exported via `src/internal.ts`). It branches text by `protocol`, `phase`, `role`, `agentId` metadata, returns synthetic usage and a fixed `costUsd: 0.0001`.

**Provider HTTP fakes:** OpenAI-compatible adapter tests pass an `OpenAICompatibleFetch` stub instead of mocking `globalThis.fetch` (`src/providers/openai-compatible.test.ts:23-46`).

**`vi.spyOn` is rare:** Only one occurrence in the suite — capturing `console.warn` for termination-misconfiguration assertions (`src/tests/termination-types.test.ts:666`).

**What NOT to mock:**
- Do not mock the runtime modules. Always exercise real protocol code with a fake provider.
- Do not stub `Date.now()` or timers; tests assert on event-type sequences and JSON shape, not wall-clock values.
- Do not mock `fetch` globally; provider adapters accept an injected `fetch`.

## Fixtures and Factories

**Test data factories** (in `src/testing/deterministic-provider.ts`):
- `createDeterministicModelProvider(id?)` — provider used by most protocol tests.
- `createDeterministicCoordinatorTestMission(model?)` — full `DogpileOptions` for coordinator runs.
- `createDeterministicBroadcastTestMission(model?)` — full `DogpileOptions` for broadcast runs.

**Location:**
- Live providers and missions: `src/testing/deterministic-provider.ts` (published).
- Static fixtures consumed by smoke tests: `src/tests/fixtures/`.
- Benchmark/paper-reproduction fixtures: `benchmark-fixtures/` (repo-internal).

**Pattern:** Factories return fully-typed `ConfiguredModelProvider` or `DogpileOptions` objects. No global state, no setup/teardown.

## Coverage

**Requirements:** None enforced. No `coverage` config, no thresholds, no CI gate. The release gate is `pnpm run verify` (build + artifact + quickstart + typecheck + test).

**View coverage:**
```bash
pnpm vitest run --coverage    # Ad-hoc; not wired into CI
```

## Test Types

**Unit tests (co-located):**
- One protocol module under test (`sequential.test.ts`, `broadcast.test.ts`, `shared.test.ts`, `coordinator.test.ts`).
- Exercise the real orchestrator with a deterministic or scripted provider.
- Assert: `result.output`, `result.transcript`, full `result.trace.events` type sequence, JSON round-trip, cost accumulation.

**Contract tests (`src/tests/`):** These are the gates that protect the published v1 contract. Updates to public API, exports, event shapes, termination semantics, or package layout MUST update the matching test:

| Concern | Test |
|---------|------|
| Public event union shape | `src/tests/event-schema.test.ts` |
| `RunResult` shape & JSON round-trip | `src/tests/result-contract.test.ts` |
| `package.json` exports map | `src/tests/package-exports.test.ts` |
| Streaming = non-streaming parity | `src/tests/streaming-api.test.ts` |
| `AbortSignal` propagation end-to-end | `src/tests/cancellation-contract.test.ts`, `src/tests/provider-request-signal-contract.test.ts` |
| Termination factories & types | `src/tests/termination-types.test.ts`, `src/tests/budget-first-stop.test.ts`, `src/tests/convergence-first-stop.test.ts`, `src/tests/judge-first-stop.test.ts` |
| `DogpileError` codes & shape | `src/tests/public-error-api.test.ts`, `src/tests/registration-error-contract.test.ts` |
| Caller-input validation | `src/tests/config-validation.test.ts`, `src/tests/run-bad-input.test.ts` |
| Tooling contract | `src/tests/built-in-tools.test.ts`, `src/tests/runtime-tool-*.test.ts`, `src/tests/protocol-user-tools.test.ts` |
| Wrap-up hint behavior | `src/tests/wrap-up-hint.test.ts` |
| Determinism at temperature 0 | `src/tests/temperature-zero-ordering.test.ts` |
| Performance baseline | `src/tests/performance-baseline.test.ts` |

**Smoke tests:**
- `src/tests/browser-bundle-smoke.test.ts` — runs the built browser bundle (requires `pnpm run build` first; gated behind `pnpm run browser:smoke`).
- `src/tests/consumer-type-resolution-smoke.test.ts` — proves consumer-side type resolution against the published `.d.ts`.
- `scripts/consumer-import-smoke.mjs` — packs the tarball and imports it as a real consumer would (run by `pnpm run quickstart:smoke`).

**Live integration tests:**
- `src/providers/vercel-ai-provider.live.test.ts` — hits a real provider; not part of `pnpm run test` defaults. Run manually when changing provider adapters.

**E2E:** Not used. The protocol orchestrators are tested through their public API, which is effectively end-to-end for an SDK with no I/O of its own.

## Common Patterns

**Async testing:**
```ts
it("propagates AbortSignal", async () => {
  const abortController = new AbortController();
  const result = run({ /* ... */, signal: abortController.signal });
  await expect(result).rejects.toMatchObject({
    name: "DogpileError",
    code: "aborted",
    retryable: false
  });
});
```
(`src/tests/cancellation-contract.test.ts:19-58`)

**Streaming testing:**
```ts
const handle = stream({ /* options */ });
const events: StreamEvent[] = [];
for await (const event of handle) events.push(event);
const result = await handle.result;
expect(events).toEqual(result.trace.events);
```
(`src/tests/streaming-api.test.ts:20-49`)

**Error testing:**
- Use `await expect(promise).rejects.toMatchObject({ name: "DogpileError", code: "...", ... })`.
- Always assert the stable `code`, never the message text alone.

**Trace-shape testing:**
- Assert the full event-type sequence with `toEqual` on `result.trace.events.map(e => e.type)`. This is the protocol contract.
- Always include `expect(JSON.parse(JSON.stringify(result.trace))).toEqual(result.trace)` to enforce the replayable-trace invariant.

**Replay testing:**
- Run, snapshot the trace, call `replay(trace)` (or `replayStream`), and assert byte-for-byte parity. The trace is the source of truth for replay.

## What to Add When Changing Behavior

| Change | Required test update |
|--------|---------------------|
| New public name in `src/index.ts` | `src/tests/package-exports.test.ts`, `CHANTGELOG.md` |
| New `package.json` subpath export | `src/tests/package-exports.test.ts`, `scripts/check-package-artifacts.mjs`, `package.json` `files` |
| New `RunEvent` variant | `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, every protocol's co-located test |
| New `DogpileErrorCode` | `src/tests/public-error-api.test.ts` |
| New protocol option | `src/runtime/validation.ts`, `src/tests/config-validation.test.ts`, the protocol's co-located test |
| New termination kind | `src/runtime/termination.ts`, `src/tests/termination-types.test.ts`, a `<kind>-first-stop.test.ts` |
| Browser-bundle-touching change | `src/tests/browser-bundle-smoke.test.ts` (run `pnpm run browser:smoke`) |

---

*Testing analysis: 2026-04-29*
