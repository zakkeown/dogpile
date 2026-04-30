# Milestone v0.4.0 — Recursive Coordination Requirements

**Goal:** Let a `coordinator` run dispatch whole sub-missions (`sequential`, `broadcast`, `shared`, `coordinator`) as first-class agent decisions, with traces, costs, cancellation, and concurrency that compose cleanly. Agent-driven nesting only.

REQ-ID format: `[CATEGORY]-[NN]`. Numbering restarts per milestone (no prior REQUIREMENTS.md existed).

---

## v0.4.0 Requirements

### DELEGATE — `delegate` decision shape on `coordinator`

- [ ] **DELEGATE-01** — Coordinator agents can return decision `{ type: "delegate", protocol, intent, model?, budget? }` where `protocol ∈ { sequential, broadcast, shared, coordinator }`.
- [ ] **DELEGATE-02** — Runtime executes a delegated decision as a full sub-run; sub-run `result` returns to the coordinator's next decision context. Defaults: child model = parent model if omitted; child budget = parent's remaining if omitted.
- [ ] **DELEGATE-03** — Invalid `delegate` payload (unknown protocol, missing `intent`) throws `DogpileError({ code: "invalid-configuration", detail.path })`.
- [ ] **DELEGATE-04** — Nesting works to depth `maxDepth` (default 4); exceeding it throws `DogpileError({ code: "invalid-configuration" })`.

### TRACE — sub-run events and replay

- [ ] **TRACE-01** — Parent trace includes a `subRun.started` event (child `runId`, protocol, intent, parent decision id) when a delegated run begins.
- [ ] **TRACE-02** — Parent trace includes a `subRun.completed` event with the child's full JSON-serializable trace inline (or `subRun.failed` with the child error).
- [ ] **TRACE-03** — `Dogpile.replay(parentTrace)` replays embedded child traces without re-executing children; replayed parent returns identical `output`, `accounting`, and event sequence.
- [ ] **TRACE-04** — `src/tests/event-schema.test.ts` and `src/tests/result-contract.test.ts` are updated to lock the new event shapes.

### BUDGET — cancellation, timeout, cost, floors

- [ ] **BUDGET-01** — Parent abort (`AbortSignal` or `StreamHandle.cancel()`) propagates to all in-flight children; child runs surface `DogpileError({ code: "aborted" })`.
- [ ] **BUDGET-02** — Parent `budget.timeoutMs` is a hard ceiling. Children get the parent's remaining time as their default; per-decision `budget` override is honored.
- [ ] **BUDGET-03** — Parent `accounting.costUsd` and token totals = parent's own provider calls + sum of children. Roll-up is recursive across depth.
- [ ] **BUDGET-04** — Parent termination policies (`budget` / `convergence` / `judge` / `firstOf`) operate over parent-level events only. `minTurns` / `minRounds` floors apply per-protocol-instance and do not propagate.

### CONCURRENCY — bounded parallelism

- [ ] **CONCURRENCY-01** — Coordinator config accepts `maxConcurrentChildren` (default 4). When a turn emits multiple `delegate` decisions, at most that many execute in parallel; the rest queue.
- [ ] **CONCURRENCY-02** — When any provider in the active tree declares `locality: "local"`, `maxConcurrentChildren` clamps to 1 regardless of caller config and emits a `subRun.concurrencyClamped` warning event with `reason: "local-provider-detected"`.

### PROVIDER — locality hint

- [ ] **PROVIDER-01** — `ConfiguredModelProvider` accepts optional `locality?: "local" | "remote"` (default unknown → treated as `remote` for clamping).
- [ ] **PROVIDER-02** — `createOpenAICompatibleProvider` auto-sets `locality: "local"` when `baseURL` host is loopback (`localhost`, `127/8`, `::1`) or RFC1918. Caller-supplied `locality` overrides auto-detection.
- [ ] **PROVIDER-03** — Invalid `locality` value throws `DogpileError({ code: "invalid-configuration" })`.

### STREAM — child event bubbling

- [ ] **STREAM-01** — `Dogpile.stream(parent)` emits child events wrapped with `parentRunId` and the child's `runId`, so consumers can demultiplex concurrent children.
- [ ] **STREAM-02** — Within a single child, event order is preserved; cross-child order is unspecified.
- [ ] **STREAM-03** — `StreamHandle.cancel()` on the parent cancels all in-flight child streams.

### ERROR — child failure escalation

- [ ] **ERROR-01** — A child throwing `DogpileError` surfaces as a `subRun.failed` event into the coordinator's next decision context. The coordinator agent can retry, delegate differently, or terminate.
- [ ] **ERROR-02** — If the parent terminates without final synthesis after an unhandled child failure, the parent throws the child's original `DogpileError` (no wrapping).
- [ ] **ERROR-03** — Child timeouts surface as `provider-timeout` at child level; parent timeouts surface as `aborted` with `detail.reason: "timeout"`.

### DOCS — discoverability

- [ ] **DOCS-01** — `docs/recursive-coordination.md` documents the `delegate` decision, propagation rules, concurrency, locality, and trace embedding with a worked example.
- [ ] **DOCS-02** — `examples/recursive-coordination/` is a runnable example using `createOpenAICompatibleProvider`.
- [ ] **DOCS-03** — README "Choose Your Path" table gets a new row pointing at `delegate`.
- [ ] **DOCS-04** — `CHANGELOG.md` v0.4.0 entry lists public-surface additions (`delegate` decision, `subRun.*` events, `locality` field, `maxConcurrentChildren` config, `maxDepth` config).

---

## Future Requirements (deferred)

- Caller-defined-tree API: `Dogpile.nest({ children: [...] })`.
- New protocol value `"recursive"` (revisit if the `delegate`-on-coordinator surface proves discoverability-limited).
- Cross-protocol shared transcript across parent/child boundary.
- Per-child retry policy on `delegate` decisions (today, retry is the coordinator agent's job).
- OTEL / tracing bridge for sub-run spans.

## Out of Scope

- **Caller-defined trees in this milestone** — agent-driven nesting only. Reason: scope discipline; the coordinator-with-`delegate` shape is the unit of value here. Caller-defined trees are a separate API surface.
- **A 5th protocol identity** — would either rename `coordinator` or duplicate it. Reason: `delegate` is naturally a coordinator concern; CLAUDE.md's four-protocol invariant stays intact.
- **Bundled pricing or local-model registry** — `locality` is a single boolean-ish hint, not a model registry. Reason: SDK ships no pricing tables; the locality field is for concurrency safety, not provider routing.
- **Mutating the four existing protocols' decision unions** — only `coordinator` gains `delegate`. Reason: keeps the "switching `protocol` does not change the result/event contract" invariant trivially true for the other three.

## Traceability

(Filled by roadmap step.)

---

*Last updated: 2026-04-30 — milestone v0.4.0 requirements drafted.*
