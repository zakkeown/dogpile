# Recursive Coordination Reference

> Exhaustive event, error, and option tables for v0.4.0 recursive coordination. For concepts and a worked example, see [`recursive-coordination.md`](./recursive-coordination.md).

## Contents

- [Sub-run events](#sub-run-events)
- [RunCallOptions](#runcalloptions)
- [DogpileError code x detail.reason matrix](#error-matrix)
- [parentRunIds chain semantics](#parentrunids-semantics)
- [Replay-drift error matrix](#replay-drift-matrix)
- [Provider locality classification](#locality-classification)
- [ReplayTraceProtocolDecisionType literals](#replay-decision-literals)

## Sub-run events

| Event type | Payload fields (TypeScript signature) | When emitted | Phase introduced |
| --- | --- | --- | --- |
| `sub-run-started` | `{ type: "sub-run-started"; runId: string; parentRunIds?: readonly string[]; at: string; childRunId: string; parentRunId: string; parentDecisionId: string; parentDecisionArrayIndex: number; protocol: ProtocolName; intent: string; depth: number; recursive?: boolean; }` | Immediately before the child run starts executing. | Phase 1, expanded Phase 3/4 |
| `sub-run-queued` | `{ type: "sub-run-queued"; runId: string; parentRunIds?: readonly string[]; at: string; childRunId: string; parentRunId: string; parentDecisionId: string; parentDecisionArrayIndex: number; protocol: ProtocolName; intent: string; depth: number; queuePosition: number; }` | When a delegate waits for a concurrency slot; no-pressure runs do not emit it. | Phase 3 |
| `sub-run-completed` | `{ type: "sub-run-completed"; runId: string; parentRunIds?: readonly string[]; at: string; childRunId: string; parentRunId: string; parentDecisionId: string; parentDecisionArrayIndex: number; subResult: RunResult; }` | After a delegated child completes; embeds the full child result and trace. | Phase 1, expanded Phase 3/4 |
| `sub-run-failed` | `{ type: "sub-run-failed"; runId: string; parentRunIds?: readonly string[]; at: string; childRunId: string; parentRunId: string; parentDecisionId: string; parentDecisionArrayIndex: number; error: { code: string; message: string; providerId?: string; detail?: JsonObject; }; partialTrace: Trace; partialCost: CostSummary; }` | When a delegated child fails, is synthetically drained after parent abort, or is abandoned after a sibling failure. | Phase 1, expanded Phase 2/3/4 |
| `sub-run-parent-aborted` | `{ type: "sub-run-parent-aborted"; runId: string; parentRunIds?: readonly string[]; at: string; childRunId: string; parentRunId: string; reason: "parent-aborted"; }` | When the parent aborts after a child completed successfully but before the parent advances. | Phase 2 |
| `sub-run-budget-clamped` | `{ type: "sub-run-budget-clamped"; runId: string; parentRunIds?: readonly string[]; at: string; childRunId: string; parentRunId: string; parentDecisionId: string; requestedTimeoutMs: number; clampedTimeoutMs: number; reason: "exceeded-parent-remaining"; }` | Before child start when a decision timeout exceeds parent remaining time. | Phase 2 |
| `sub-run-concurrency-clamped` | `{ type: "sub-run-concurrency-clamped"; runId: string; parentRunIds?: readonly string[]; at: string; requestedMax: number; effectiveMax: 1; reason: "local-provider-detected"; providerId: string; }` | Once per run at the first delegate dispatch where a local provider clamps concurrency to one. | Phase 3 |

Notes:

- `parentRunIds` is optional on the TypeScript event shapes because the same event unions are used for live streams and persisted traces.
- Root-level `sub-run-*` boundary events in a parent trace normally have no `parentRunIds`; bubbled child events in a parent stream carry the chain.
- `parentDecisionArrayIndex` is `0` for single-delegate turns and the delegate array index for fan-out turns.
- `sub-run-failed.partialCost` contributes to parent roll-up even when the child never reaches a final event.

## RunCallOptions

| Field | Type | Default | Lowers engine ceiling? | Phase |
| --- | --- | --- | --- | --- |
| `maxDepth` | `number` | Engine default `4` | Yes. Effective value is `Math.min(engine.maxDepth ?? 4, runOptions.maxDepth ?? Infinity)`. | Phase 1 |
| `maxConcurrentChildren` | `number` | Engine default `4` | Yes. Effective value is `min(engine, run ?? Infinity, decision ?? Infinity)`. | Phase 3 |
| `defaultSubRunTimeoutMs` | `number` | `undefined` | No. It is a fallback timeout, not a ceiling-lowering control. | Phase 2 |
| `onChildFailure` | `"continue" \| "abort"` | `"continue"` | No. Per-run value overrides engine behavior. | Phase 4 |

`RunCallOptions` is the second argument to `Engine.run(intent, options)` and `Engine.stream(intent, options)`. The same option family is accepted on `Dogpile.pile()`, `run()`, `stream()`, and `createEngine()` as engine or high-level configuration. `defaultSubRunTimeoutMs` is present on engine/high-level options; per-call `RunCallOptions` currently contains `maxDepth`, `maxConcurrentChildren`, and `onChildFailure`.

Precedence summary:

- `maxDepth`: engine ceiling, optionally lowered per run.
- `maxConcurrentChildren`: engine ceiling, optionally lowered per run and per delegate decision.
- Child timeout: `decision.budget.timeoutMs` > parent remaining deadline > `defaultSubRunTimeoutMs` > `undefined`.
- `onChildFailure`: per-run option > engine option > `"continue"`.

## DogpileError code x detail.reason matrix

| `error.code` | `detail.reason` | `detail.kind` / `detail.subReason` | When raised | Phase introduced |
| --- | --- | --- | --- | --- |
| `invalid-configuration` | `depth-overflow` | `kind: "delegate-validation"` | Delegate parse or dispatch would exceed `maxDepth`. | Phase 1 |
| `invalid-configuration` | Optional; delegate parser may report via `detail.path` | `kind: "delegate-validation"` | Delegate payload is malformed, such as unknown protocol, missing intent, wrong model id, or mixed participate/delegate output. | Phase 1 |
| `invalid-configuration` | `remote-override-on-local-host` | `kind: "configuration-validation"` | OpenAI-compatible provider was configured with `locality: "remote"` for a detected-local host. | Phase 3 |
| `invalid-configuration` | `trace-accounting-mismatch` | `kind: "trace-validation"; subReason?: "parent-rollup-drift"` | Replay detects tampered or inconsistent trace accounting. | Phase 1, expanded Phase 2 |
| `aborted` | `parent-aborted` | Provider or cancellation detail may include source context. | Parent abort propagates to child, including `StreamHandle.cancel()`. | Phase 2, expanded Phase 4 |
| `aborted` | `timeout` | Parent-budget propagation. | Parent deadline expires and aborts the child through the parent signal. | Phase 2 |
| `aborted` | `sibling-failed` | Synthetic queued-child drain. | A fan-out child failed, so never-started queued siblings were abandoned. | Phase 3 |
| `provider-timeout` | Not a `detail.reason`; use `detail.source` | `detail.source: "provider" \| "engine"` | Provider or child engine deadline timed out. Absence of `detail.source` means provider for backwards compatibility. | Phase 4 |
| Event reason only | `local-provider-detected` | `sub-run-concurrency-clamped.reason` | Local provider clamp warning event; not a thrown `DogpileError` reason. | Phase 3 |
| Replay sub-reason | `parent-rollup-drift` | `detail.reason: "trace-accounting-mismatch"; detail.subReason: "parent-rollup-drift"` | Parent accounting disagrees with child roll-up or failed-child partial cost. | Phase 2 |

Prompt-roster exclusions:

- Synthetic `sibling-failed` failures are omitted from the structured coordinator `failures` prompt block.
- Synthetic `parent-aborted` failures are omitted from the structured coordinator `failures` prompt block.
- Real failures include `childRunId`, `intent`, `error.code`, `error.message`, optional `error.detail.reason`, and `partialCost.usd`.

## parentRunIds chain semantics

- Type: `readonly string[]`.
- Order: root run id to immediate parent run id.
- Root-originated stream events omit `parentRunIds`.
- A child event bubbled into the root parent stream has `[parentRunId]`.
- A grandchild event bubbled into the root parent stream has `[parentRunId, childRunId]`.
- Set on every live event passed through `teedEmit` from a child stream into the parent stream.
- Not persisted on `RunResult.events`, `RunEventLog.events`, or `Trace.events`.
- Replay stream reconstruction adds the same chain at the bubbling boundary.
- Per-child event order is preserved within a single child.
- Cross-child event order is intentionally unspecified.
- Use immediate-parent demux for one direct child.
- Use ancestry demux for any descendant in a subtree.

Immediate-parent demux:

```ts
const parentRunIds = event.parentRunIds;

if (parentRunIds?.[event.parentRunIds.length - 1] === handle.runId) {
  renderImmediateChildEvent(event);
}
```

Ancestry demux:

```ts
const parentRunIds = event.parentRunIds;

if (parentRunIds?.includes(handle.runId)) {
  renderDescendantEvent(event);
}
```

Trace asymmetry:

- Parent trace: contains parent-level `sub-run-*` boundary events and embedded child traces.
- Child trace: contains the child run's own events without parent ancestry.
- Live parent stream: contains bubbled child events with `parentRunIds`.
- Replay stream: reconstructs `parentRunIds` so replayed streams match live stream ancestry.

## Replay-drift error matrix

| Drift kind | Detection site | `error.code` | `detail.reason` | `detail.subReason` | `detail.field` | `detail.eventIndex` / `detail.childRunId` |
| --- | --- | --- | --- | --- | --- | --- |
| Per-event accounting mismatch (top-level) | `recomputeAccountingFromTrace` checks parent events against recorded accounting. | `invalid-configuration` | `trace-accounting-mismatch` | Not set | One of the eight comparable numeric fields. | `eventIndex: -1`; no `childRunId`. |
| Per-event accounting mismatch (child) | Recursive recompute checks embedded `subResult.trace` or `partialTrace`. | `invalid-configuration` | `trace-accounting-mismatch` | Not set | One of the eight comparable numeric fields. | `eventIndex >= 0`; `childRunId` set when the mismatch is under a child. |
| Parent-rollup drift | Parent total is compared with local parent spend plus completed child cost plus failed child `partialCost`. | `invalid-configuration` | `trace-accounting-mismatch` | `parent-rollup-drift` | One of the eight comparable numeric fields. | `eventIndex` identifies the sub-run boundary where possible; `childRunId` identifies the drifting child when applicable. |

Comparable numeric fields:

- `cost.usd`
- `cost.inputTokens`
- `cost.outputTokens`
- `cost.totalTokens`
- `usage.usd`
- `usage.inputTokens`
- `usage.outputTokens`
- `usage.totalTokens`

Replay behavior:

- Completed children are replayed from `sub-run-completed.subResult.trace`.
- Failed children are checked from `sub-run-failed.partialTrace` and `sub-run-failed.partialCost`.
- Runtime throws may preserve the original `DogpileError` instance.
- Replay reconstructs a fresh `DogpileError` from serialized event payloads.

## Provider locality classification

| Pattern | Classification | Source |
| --- | --- | --- |
| `localhost` | `local` | `classifyHostLocality(host)` in `src/providers/openai-compatible.ts` |
| IPv4 loopback `127/8` | `local` | OpenAI-compatible `baseURL` auto-detection |
| IPv6 loopback `::1` | `local` | OpenAI-compatible `baseURL` auto-detection |
| RFC1918 `10/8` | `local` | OpenAI-compatible `baseURL` auto-detection |
| RFC1918 `172.16/12` | `local` | OpenAI-compatible `baseURL` auto-detection |
| RFC1918 `192.168/16` | `local` | OpenAI-compatible `baseURL` auto-detection |
| IPv4 link-local `169.254/16` | `local` | OpenAI-compatible `baseURL` auto-detection |
| IPv6 ULA `fc00::/7` | `local` | OpenAI-compatible `baseURL` auto-detection |
| IPv6 link-local `fe80::/10` | `local` | OpenAI-compatible `baseURL` auto-detection |
| `*.local` mDNS | `local` | OpenAI-compatible `baseURL` auto-detection |
| Everything else | `remote` | Treated as remote when locality is omitted entirely. |

Override rules:

- `locality: "local"` always wins, including for a host that auto-detects as remote.
- Omitted `locality` uses auto-detection for OpenAI-compatible providers.
- Omitted `metadata.locality` on custom providers is treated as remote for clamping.
- `locality: "remote"` on a detected-local OpenAI-compatible host throws `invalid-configuration` with `detail.reason: "remote-override-on-local-host"`.
- A run with any active provider whose `metadata.locality === "local"` clamps effective child concurrency to one and emits `sub-run-concurrency-clamped` with `reason: "local-provider-detected"`.

## ReplayTraceProtocolDecisionType literals

Added in v0.4.0:

- `start-sub-run` (Phase 1)
- `complete-sub-run` (Phase 1)
- `fail-sub-run` (Phase 1)
- `queue-sub-run` (Phase 3)
- `mark-sub-run-parent-aborted` (Phase 2)
- `mark-sub-run-budget-clamped` (Phase 2)
- `mark-sub-run-concurrency-clamped` (Phase 3)

Related existing literals remain unchanged:

- `assign-role`
- `select-agent-turn`
- `start-model-call`
- `complete-model-call`
- `observe-model-output`
- `start-tool-call`
- `complete-tool-call`
- `collect-broadcast-round`
- `stop-for-budget`
- `finalize-output`
