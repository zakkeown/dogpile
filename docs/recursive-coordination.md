# Recursive Coordination

> Coordinator agents can dispatch whole sub-missions. Available since v0.4.0.

## Contents

- [Concept](#concept)
- [API surface](#api-surface)
- [AgentDecision narrowing](#agentdecision-narrowing)
- [Propagation rules](#propagation-rules)
- [Bounded concurrency and locality](#bounded-concurrency-and-locality)
- [parentRunIds chain](#parentrunids-chain)
- [Structured failures in the coordinator prompt](#structured-failures-in-the-coordinator-prompt)
- [Partial traces](#partial-traces)
- [Replay parity](#replay-parity)
- [Not in v0.4.0](#not-in-v040)
- [Worked example](#worked-example)

## Concept

Recursive coordination starts when a coordinator agent emits a `delegate` decision instead of a normal `participate` decision. The delegate dispatches a sub-mission using one of the existing protocols (`sequential`, `broadcast`, `shared`, or `coordinator`), and the child run's trace embeds inside the parent trace through `sub-run-completed.subResult` or `sub-run-failed.partialTrace`.

The parent remains the owner of the run tree: budgets, aborts, and cost roll-up propagate across depth, while each child keeps its own protocol turns, transcript, and replay artifact. v0.4.0 supports agent-driven nesting only; caller-defined trees such as `Dogpile.nest` are deferred to a later milestone. See [Not in v0.4.0](#not-in-v040).

## API surface

| Surface | Where | Notes |
| --- | --- | --- |
| *Decision shape* | `AgentDecision` | `type: "participate" \| "delegate"` is the discriminator. Coordinator plan turns may return a single delegate or an array of delegates. |
| `delegate` decision | Coordinator plan turn | `{ type: "delegate", protocol, intent, model?, budget?, maxConcurrentChildren? }`. `protocol` uses the existing four-protocol list. |
| *Events* | `RunEvent` | `sub-run-started`, `sub-run-completed`, `sub-run-failed`, `sub-run-queued`, `sub-run-parent-aborted`, `sub-run-budget-clamped`, and `sub-run-concurrency-clamped`. |
| `sub-run-started` | Parent trace | Marks the child start, including `childRunId`, `parentRunId`, `parentDecisionId`, `parentDecisionArrayIndex`, `protocol`, `intent`, `depth`, and optional `recursive`. |
| `sub-run-completed` | Parent trace | Carries the complete child `RunResult` as `subResult`; replay recurses into `subResult.trace`. |
| `sub-run-failed` | Parent trace | Carries serialized `error`, `partialTrace`, and `partialCost`. Synthetic failures may use `parent-aborted` or `sibling-failed`. |
| `sub-run-queued` | Parent trace | Emitted only when a child waits for a concurrency slot. |
| `sub-run-parent-aborted` | Parent stream/trace marker | Marks parent abort that lands after a sub-run completed successfully. |
| `sub-run-budget-clamped` | Parent trace | Records requested vs applied child timeout when a delegate asked for more time than the parent had remaining. |
| `sub-run-concurrency-clamped` | Parent trace | Records auto-clamp to one child when a local provider is active; reason is `local-provider-detected`. |
| *Options* | `RunCallOptions`, `EngineOptions`, `DogpileOptions` | Per-run values can lower engine ceilings. |
| `maxDepth` | Engine and run options | Default `4`; overflow throws `invalid-configuration` with `detail.reason: "depth-overflow"`. |
| `maxConcurrentChildren` | Engine, run, and delegate options | Default `4`; effective value is the minimum of engine, run, and decision values. |
| `defaultSubRunTimeoutMs` | Engine and high-level options | Fallback child timeout when parent and decision do not set one. |
| `onChildFailure` | Engine and run options | `"continue"` reissues the coordinator plan turn; `"abort"` rethrows the triggering child failure. |
| `RunCallOptions` | `Engine.run(intent, options)` and `Engine.stream(intent, options)` | Contains `maxDepth`, `maxConcurrentChildren`, and `onChildFailure`. |
| *Provider metadata* | `ConfiguredModelProvider.metadata` | `locality?: "local" \| "remote"` drives the local-provider concurrency clamp. |
| `classifyHostLocality(host)` | `@dogpile/sdk/providers/openai-compatible` | Classifies loopback, RFC1918, link-local, ULA, and `*.local` hosts as local. |
| *Stream-only fields* | Live stream events | `parentRunIds?: readonly string[]` is root-to-immediate-parent ancestry for bubbled child events. |

## AgentDecision narrowing

`AgentDecision` is a discriminated union in v0.4.0. Code that reads paper-style fields must narrow to the `participate` branch first.

```ts
import type { AgentDecision } from "@dogpile/sdk";

function renderDecision(decision: AgentDecision): string {
  if (decision.type === "participate") {
    return `${decision.selectedRole}: ${decision.contribution}`;
  } else if (decision.type === "delegate") {
    return `delegate ${decision.protocol}: ${decision.intent}`;
  }
  const exhaustive: never = decision;
  return exhaustive;
}
```

Coordinator delegate decisions use the same discriminator:

```ts
if (decision.type === "participate") {
  // existing paper-style fields: selectedRole, participation, contribution, rationale
} else if (decision.type === "delegate") {
  // delegate-only fields: protocol, intent, model?, budget?, maxConcurrentChildren?
}
```

## Propagation rules

Parent cancellation flows into active children through per-child `AbortController` instances. Children that observe the parent abort fail with `code: "aborted"` and `detail.reason: "parent-aborted"`.

```ts
const controller = new AbortController();
const handle = Dogpile.stream({
  intent: "Coordinate the launch plan.",
  protocol: "coordinator",
  model,
  signal: controller.signal
});

controller.abort();
await handle.result; // rejects with DogpileError code "aborted"
```

Parent timeout is a tree-wide deadline. A child gets `parentDeadlineMs - Date.now()` as its default; `defaultSubRunTimeoutMs` is only used when the parent has no timeout and the decision has no timeout.

```ts
await Dogpile.pile({
  intent: "Split the risk review into sub-missions.",
  protocol: "coordinator",
  model,
  budget: { timeoutMs: 30_000 },
  defaultSubRunTimeoutMs: 10_000
});
```

If the coordinator asks for a larger child timeout than the parent has remaining, Dogpile clamps it and emits `sub-run-budget-clamped`.

```ts
const decision = {
  type: "delegate",
  protocol: "broadcast",
  intent: "Audit the migration risks.",
  budget: { timeoutMs: 120_000 }
} as const;

// If the parent has 18 seconds left, the child receives 18 seconds.
// The parent trace records sub-run-budget-clamped.
```

Cost rolls up recursively. Completed children contribute `subResult.cost`; failed children contribute `partialCost`, including real provider spend before failure.

```ts
for (const event of result.trace.events) {
  if (event.type === "sub-run-completed") {
    console.log(event.subResult.cost.usd);
  }
  if (event.type === "sub-run-failed") {
    console.log(event.partialCost.usd);
  }
}
```

## Bounded concurrency and locality

Coordinator fan-out runs through a bounded child pool. The default is four children in flight; engine, per-run, and per-decision settings can only lower the effective value.

```ts
await Dogpile.pile({
  intent: "Fan out design, risk, and test planning.",
  protocol: "coordinator",
  model,
  maxConcurrentChildren: 2
});
```

Under pressure, queued children emit `sub-run-queued` before they later emit `sub-run-started`. If one real child fails, in-flight siblings continue, while never-started queued siblings are drained as synthetic `sub-run-failed` events with `detail.reason: "sibling-failed"` and zero `partialCost`.

```ts
for (const event of result.trace.events) {
  if (event.type === "sub-run-queued") {
    console.log(`queued ${event.childRunId} at ${event.queuePosition}`);
  }
}
```

Local providers clamp child concurrency to one. The OpenAI-compatible adapter auto-detects loopback, RFC1918, link-local, ULA, and `*.local` hosts as local; callers can also mark custom providers with `metadata.locality: "local"`.

```ts
const localModel = createOpenAICompatibleProvider({
  model: "llama3.1",
  baseURL: "http://localhost:11434/v1"
});

await Dogpile.pile({
  intent: "Use local inference cautiously.",
  protocol: "coordinator",
  model: localModel,
  maxConcurrentChildren: 8
});
```

The run emits `sub-run-concurrency-clamped` once with `reason: "local-provider-detected"`. A caller that tries `locality: "remote"` on a detected-local OpenAI-compatible host gets `invalid-configuration` with `detail.reason: "remote-override-on-local-host"`.

## parentRunIds chain

Live stream consumers receive a root-to-immediate-parent ancestry chain on bubbled child events. Root events omit the field; child events seen at the root include the parent; grandchild events include parent and child.

```text
parent (runId: P)
└── child (runId: C, parentRunIds=[P])
    └── grandchild (runId: G, parentRunIds=[P, C])
```

Use immediate-parent demux when a UI pane belongs to one child handle-equivalent, and ancestry demux when a view wants the whole subtree.

```ts
const parentRunIds = event.parentRunIds;

// Immediate-parent demux
// Mechanical anchor for docs checks: parentRunIds.[event.parentRunIds.length - 1]
if (parentRunIds?.[event.parentRunIds.length - 1] === handle.runId) {
  renderImmediateChildEvent(event);
}

// Ancestry demux (any descendant in the tree)
// Mechanical anchor for docs checks: parentRunIds.includes
if (parentRunIds?.includes(handle.runId)) {
  renderDescendantEvent(event);
}
```

> **Trace vs stream asymmetry.** `parentRunIds` is set on live stream events through `teedEmit` but is NOT persisted in `RunResult.events`. Replay reconstructs the chain at the bubbling boundary so replay-from-stream sees the same ancestry as live runs. Do NOT expect `parentRunIds` when iterating `result.trace.events`.

## Structured failures in the coordinator prompt

When a real child failure occurs, the next coordinator plan turn receives a stable prompt section. The legacy tagged transcript line is assembled near `src/runtime/coordinator.ts:459`, and the structured roster is assembled in the same coordinator prompt path.

```text
## Sub-run failures since last decision

failures: [
  {
    "childRunId": "...",
    "intent": "...",
    "error": { "code": "...", "message": "...", "detail": { "reason": "..." } },
    "partialCost": { "usd": 0.001 }
  }
]
```

> Synthetic failures (`sibling-failed`, `parent-aborted`) are excluded from this block; only real causes are surfaced to the coordinator. The format is part of the public coordinator-prompt contract; changes are tracked in `CHANGELOG.md`.

## Partial traces

`sub-run-failed` carries a partial child trace and a partial cost. The prompt roster intentionally omits `partialTrace`, but callers and replay tooling can inspect it on the event.

```ts
for (const event of result.trace.events) {
  if (event.type === "sub-run-failed") {
    persistFailure({
      childRunId: event.childRunId,
      error: event.error,
      partialTrace: event.partialTrace,
      partialCost: event.partialCost
    });
  }
}
```

Synthetic queue drains also use `sub-run-failed`; their `partialCost` is zero. Real failures preserve the child events accumulated before the throw.

## Replay parity

`Dogpile.replay()` walks embedded child traces from `sub-run-completed.subResult` and `sub-run-failed.partialTrace`. It does not re-invoke providers.

```ts
const result = await Dogpile.pile({
  intent: "Coordinate and delegate.",
  protocol: "coordinator",
  model
});

const replayed = await Dogpile.replay(result.trace);
console.log(replayed.output);
```

Replay recomputes accounting from the trace. If child roll-up does not match parent accounting, replay throws `invalid-configuration` with `detail.reason: "trace-accounting-mismatch"` and `detail.subReason: "parent-rollup-drift"`.

```ts
try {
  await Dogpile.replay(tamperedTrace);
} catch (error) {
  if (DogpileError.isInstance(error)) {
    console.log(error.code, error.detail);
  }
}
```

Replay reconstructs `DogpileError` instances at the throw boundary. `instanceof DogpileError` holds, but the stack is fresh because replay only has the serialized event payload.

## Not in v0.4.0

- **Caller-defined trees (`Dogpile.nest`)** — deferred milestone; agent-driven nesting via `delegate` is the v0.4.0 surface.
- **Worker-turn delegation** — only coordinator plan-turn agents may emit `delegate`; worker turns and final-synthesis turns reject delegate decisions with `invalid-configuration`.
- **Per-child user-facing `StreamHandle`** — children remain internal in v0.4.0; cancellation flows through the parent handle. See [Structured failures](#structured-failures-in-the-coordinator-prompt) and [parentRunIds chain](#parentrunids-chain) for the observability surface that replaces a dedicated child handle.

## Worked example

This example shows one coordinator stream that delegates two children: a broadcast research fan-out and a sequential implementation pass. The sequential child is intentionally budgeted too tightly so the parent records `sub-run-failed`, `partialCost`, and the structured failures roster on the next plan turn.

```ts
import {
  Dogpile,
  DogpileError,
  createOpenAICompatibleProvider,
  type StreamEvent
} from "@dogpile/sdk";

const model = createOpenAICompatibleProvider({
  id: "local-demo",
  model: "llama3.1",
  baseURL: "http://localhost:11434/v1",
  locality: "local"
});

const handle = Dogpile.stream({
  intent: [
    "Plan a recursive release review.",
    "First delegate a broadcast research pass.",
    "Then delegate a sequential implementation-risk pass with a tiny budget."
  ].join(" "),
  protocol: "coordinator",
  model,
  maxConcurrentChildren: 4,
  onChildFailure: "continue",
  defaultSubRunTimeoutMs: 20_000
});

function describe(event: StreamEvent): string | null {
  switch (event.type) {
    case "sub-run-concurrency-clamped":
      return `local clamp: requested=${event.requestedMax}, effective=${event.effectiveMax}`;
    case "sub-run-started":
      return `start child=${event.childRunId} protocol=${event.protocol}`;
    case "sub-run-completed":
      return `complete child=${event.childRunId} cost=${event.subResult.cost.usd}`;
    case "sub-run-failed":
      return `failed child=${event.childRunId} partial=${event.partialCost.usd}`;
    case "agent-turn":
      if (event.parentRunIds?.includes(handle.runId)) {
        return `child event via ${event.parentRunIds.join(" > ")}: ${event.agentId}`;
      }
      return `parent turn: ${event.agentId}`;
    case "final":
      return `final cost=${event.cost.usd}`;
    default:
      return null;
  }
}

for await (const event of handle) {
  const line = describe(event);
  if (line !== null) {
    console.log(line);
  }
}

try {
  const result = await handle.result;
  const failed = result.trace.events.find((event) => event.type === "sub-run-failed");
  if (failed?.type === "sub-run-failed") {
    console.log("structured failure source", {
      childRunId: failed.childRunId,
      error: failed.error,
      partialCost: failed.partialCost
    });
  }
} catch (error) {
  if (DogpileError.isInstance(error)) {
    console.error(error.code, error.detail);
  }
  throw error;
}
```

Annotated event-log shape:

```text
sub-run-concurrency-clamped { requestedMax: 4, effectiveMax: 1, reason: "local-provider-detected" }
sub-run-started { childRunId: "C1", protocol: "broadcast", parentRunIds: undefined }
agent-turn from child C1 seen live with parentRunIds=["P"]
sub-run-completed { childRunId: "C1", subResult.trace.events: [...] }
sub-run-started { childRunId: "C2", protocol: "sequential", parentRunIds: undefined }
agent-turn from child C2 seen live with parentRunIds=["P"]
sub-run-failed { childRunId: "C2", error.detail.reason: "timeout", partialCost: { usd: 0.001 } }
agent-turn from parent coordinator sees ## Sub-run failures since last decision
final { cost: parent provider cost + C1 cost + C2 partialCost }
```

The coordinator prompt after the failure includes:

```text
## Sub-run failures since last decision

failures: [
  {
    "childRunId": "C2",
    "intent": "implementation-risk pass",
    "error": { "code": "aborted", "message": "deadline expired", "detail": { "reason": "timeout" } },
    "partialCost": { "usd": 0.001 }
  }
]
```

The persisted parent trace contains the `sub-run-*` boundary events and embedded child traces. The live stream additionally includes bubbled child activity annotated with `parentRunIds`, while `RunResult.events` stays chain-free.

> For the exhaustive event/error/option tables, see [`docs/recursive-coordination-reference.md`](./recursive-coordination-reference.md).
