# Phase 10: Metrics / Counters — Discussion Log

**Mode:** Power (async, 14 questions generated)
**Date:** 2026-05-01
**Questions answered:** 13 / 14

---

## Section 1: MetricsHook Interface Design

| Question | Options | Decision |
|----------|---------|----------|
| Q-01: Hook shape | (a) single function / (b) callback object / (c) custom | **b** — Callback object with `onRunComplete?` and `onSubRunComplete?` |
| Q-02: RunMetricsSnapshot fields | (a) counters only / (b) counters + identity / (c) counters + outcome | **c** — 5 counters plus `outcome: 'completed' \| 'budget-stopped' \| 'aborted'` |
| Q-03: Async support | (a) sync only / (b) async awaited / (c) async fire-and-forget | **c** — Async fire-and-forget: `.catch()` attached, not awaited |
| Q-04: Error isolation | (a) console.error / (b) add `logger?: Logger` to EngineOptions / (c) silent swallow | **b** — Add `logger?: Logger` to EngineOptions and DogpileOptions |

## Section 2: Counter Fields and Semantics

| Question | Options | Decision |
|----------|---------|----------|
| Q-05: `turns` definition | (a) agent-turn events only / (b) round-based / (c) use result.usage.turns | **a** — Count of TurnEvent entries in trace.events |
| Q-06: `durationMs` source | (a) Date.now() wall-clock / (b) trace metadata / (c) mixed | **a** — Date.now() at run start, delta at hook call time |
| Q-07: Sub-run counter scope | (a) cumulative / (b) own-only / (c) both own and total fields | **c** — Both: `own*` (direct work) and `total*` (full subtree) in snapshot |

## Section 3: Integration Architecture

| Question | Options | Decision |
|----------|---------|----------|
| Q-08: Integration point | (a) after result assembly in runNonStreamingProtocol / (b) inside runProtocol via emit callback / (c) custom | **b** — Uniform emit-callback approach for all depths |
| Q-09: Mirror on DogpileOptions | (a) both EngineOptions + DogpileOptions / (b) EngineOptions only / (c) DogpileOptions only | **a** — Mirror on both, consistent with Phase 9 tracer pattern |

## Section 4: Terminal State Coverage

| Question | Options | Decision |
|----------|---------|----------|
| Q-10: Budget-stopped and aborted | (a) all terminals / (b) completed + budget-stopped / (c) completed only | **a** — Hook fires for all terminal states |
| Q-11: Failed sub-runs (`sub-run-failed`) | (a) yes with partial counters / (b) no, skip / (c) custom | **unanswered** — Deferred to planner (default: no) |

## Section 5: Public Surface and Testing

| Question | Options | Decision |
|----------|---------|----------|
| Q-12: Subpath export | (a) /runtime/metrics subpath / (b) root-only / (c) both subpath + root | **c** — Both subpath and root re-export (but see Q-13 conflict) |
| Q-13: Root-exported types | (a) both MetricsHook + RunMetricsSnapshot / (b) MetricsHook only / (c) subpath-only | **c** — Subpath-only, no root exports |
| Q-14: Frozen fixture | (a) yes / (b) no / (c) conditional on Q-02 having non-trivial fields | **c** → **yes** (Q-02 picked c, so snapshot has non-trivial fields) |

---

## Notable Conflicts and Claude's Resolutions

- **Q-12 vs Q-13:** Q-12 picked "both root + subpath" but Q-13 picked "subpath-only." Resolution: Q-13 (the specific root-export question) takes precedence. `/runtime/metrics` subpath exists; no root re-export.
- **Q-11 unanswered:** Default recommendation in CONTEXT.md is "no — skip hook for failed sub-runs." Planner can override.

## Deferred Ideas
- `runId`, `depth`, `parentRunId` on `RunMetricsSnapshot` — not in scope
- Built-in metric exporters — out of scope per REQUIREMENTS.md
- Per-turn hook — future phase
- `metricsHook` on `RunCallOptions` per-call override — deferred
- Replay hook behavior — planner should add a guard (consistent with Phase 9 D-14)
- Double-fire concern: planner must decide if `onRunComplete` fires for all depths or root-only
