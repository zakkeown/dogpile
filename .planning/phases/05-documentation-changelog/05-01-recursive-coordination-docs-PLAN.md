---
phase: 05-documentation-changelog
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - docs/recursive-coordination.md
  - docs/recursive-coordination-reference.md
autonomous: true
requirements: [DOCS-01]
tags: [docs, recursive-coordination, public-surface]

must_haves:
  truths:
    - "docs/recursive-coordination.md exists at repo root and opens with a 2-paragraph framing of recursive coordination as 'a coordinator agent emits delegate to dispatch a sub-mission; the sub-run trace embeds in the parent trace; budgets/aborts/costs propagate'"
    - "docs/recursive-coordination.md has a Table of Contents at the top linking every H2 anchor on the page (D-01: longest page in docs/ — TOC handles navigability)"
    - "docs/recursive-coordination.md includes a single 'API surface' table covering: delegate decision shape, the seven sub-run-* events (started/completed/failed/queued/parent-aborted/budget-clamped/concurrency-clamped), parentRunIds chain, locality field, maxConcurrentChildren, maxDepth, defaultSubRunTimeoutMs, RunCallOptions, onChildFailure"
    - "docs/recursive-coordination.md ships a fragment-per-concept (5-15 line snippet) for each surface AND a single canonical end-to-end example at the close (D-02: hybrid)"
    - "docs/recursive-coordination.md has these stable anchor slugs (downstream cross-links depend on them): #agentdecision-narrowing, #propagation-rules, #parentrunids-chain, #structured-failures, #partial-traces, #replay-parity, #not-in-v040, #worked-example"
    - "docs/recursive-coordination.md #parentrunids-chain section has an ASCII tree diagram showing parent → child → grandchild with parentRunIds values at each level (root → [], child seen at root → [parent], grandchild seen at root → [parent, child]) AND shows BOTH demux idioms (immediate-parent and ancestry includes) (D-04)"
    - "docs/recursive-coordination.md #parentrunids-chain section explicitly notes the trace/stream asymmetry: persisted RunResult.events does NOT carry the chain (Phase 4 D-04); only live stream events do (D-04 lock)"
    - "docs/recursive-coordination.md #structured-failures section reproduces the exact text-block format the coordinator agent sees on its plan-turn prompt: failures: [{ childRunId, code, message, partialCost }, ...] with cross-link to coordinator.ts:459 (D-05)"
    - "docs/recursive-coordination.md #not-in-v040 section explicitly lists the three deferrals from D-06: caller-defined trees (Dogpile.nest), worker-turn delegation, per-child user-facing StreamHandle"
    - "docs/recursive-coordination-reference.md exists as a separate exhaustive reference page (D-03 split): every sub-run-* event variant with full payload schema, every detail.reason vocabulary value, every RunCallOptions field, every DogpileError code/detail.reason combo introduced in v0.4.0, parentRunIds chain semantics formalized, replay-drift error matrix (parent-rollup-drift, trace-accounting-mismatch)"
    - "neither docs/recursive-coordination.md nor docs/recursive-coordination-reference.md is added to package.json files allowlist (docs stay repo-only / GitHub-only — D-03)"
  artifacts:
    - path: "docs/recursive-coordination.md"
      provides: "Concept-and-narrative page: framing, API surface table, fragment-per-concept subsections, canonical worked example. Stable anchor IDs for downstream cross-links."
      min_lines: 250
      contains: "## Worked example"
    - path: "docs/recursive-coordination-reference.md"
      provides: "Exhaustive reference page: every event payload, every detail.reason value, every RunCallOptions field, every DogpileError code/detail.reason combo from v0.4.0, replay-drift error matrix."
      min_lines: 150
      contains: "sub-run-concurrency-clamped"
  key_links:
    - from: "docs/recursive-coordination.md TOC"
      to: "every H2 on the same page"
      via: "anchor links"
      pattern: "\\]\\(#"
    - from: "docs/recursive-coordination.md (concept page)"
      to: "docs/recursive-coordination-reference.md (reference page)"
      via: "explicit 'See the reference page for the exhaustive event/error tables' link"
      pattern: "recursive-coordination-reference"
    - from: "docs/recursive-coordination.md #structured-failures"
      to: "src/runtime/coordinator.ts:459"
      via: "code link to the legacy taggedText line site (D-05)"
      pattern: "coordinator\\.ts"
---

<objective>
Author the two recursive-coordination doc pages that DOCS-01 satisfies.

- **`docs/recursive-coordination.md`** — concepts + narrative + worked example. The page DOCS-01 satisfies. Hybrid arc per D-01: 2-paragraph framing → API surface table → fragment-per-concept (per D-02) → single canonical end-to-end worked example at the close. TOC at top per D-01. Stable anchor IDs that downstream plans (CHANGELOG Migration block, README row, examples/README) cross-link.
- **`docs/recursive-coordination-reference.md`** — NEW exhaustive reference page (per D-03): every sub-run-* event variant with full payload schema, every `detail.reason` vocabulary value, every `RunCallOptions` field, every `DogpileError` `code`/`detail.reason` combo introduced in v0.4.0, the `parentRunIds` chain semantics formalized, the replay-drift error matrix.

Purpose: recursive coordination becomes discoverable. Concepts page reads start-to-finish; reference page is point-lookup. `docs/reference.md` (Plan 02) cross-links here rather than duplicating.

Output: two markdown files in `docs/`. Neither is added to `package.json` `files` allowlist — docs stay repo-only.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/05-documentation-changelog/05-CONTEXT.md
@.planning/phases/01-delegate-decision-sub-run-traces/01-CONTEXT.md
@.planning/phases/02-budget-cancellation-cost-rollup/02-CONTEXT.md
@.planning/phases/03-provider-locality-bounded-concurrency/03-CONTEXT.md
@.planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md
@CLAUDE.md
@CHANGELOG.md
@docs/developer-usage.md
@docs/reference.md
@src/runtime/coordinator.ts
@src/types/events.ts
@src/types.ts

<interfaces>
<!-- Public surface to document. Extracted from CHANGELOG.md v0.4.0 entries + Phase 1-4 CONTEXT files. -->

Run events introduced in v0.4.0 (the seven sub-run-* variants):
- `sub-run-started` { childRunId, parentRunId, parentDecisionId, parentDecisionArrayIndex, protocol, intent, depth, recursive? }
- `sub-run-completed` { childRunId, parentRunId, parentDecisionId, parentDecisionArrayIndex, subResult }
- `sub-run-failed` { childRunId, parentRunId, parentDecisionId, parentDecisionArrayIndex, error, partialTrace, partialCost }
- `sub-run-queued` { childRunId, parentRunId, parentDecisionId, parentDecisionArrayIndex }
- `sub-run-parent-aborted` { childRunId, parentRunId, at }
- `sub-run-budget-clamped` { childRunId, requestedTimeoutMs, clampedTimeoutMs, parentRemainingMs }
- `sub-run-concurrency-clamped` { requestedMax, effectiveMax, reason, providerId }

DogpileError detail.reason vocabulary added in v0.4.0:
- "depth-overflow" (DELEGATE-04)
- "parent-aborted" (BUDGET-01)
- "timeout" (BUDGET-02 — on `code: "aborted"` for parent-budget propagation)
- "trace-accounting-mismatch" / sub-reason "parent-rollup-drift" (BUDGET-03)
- "remote-override-on-local-host" (PROVIDER-02)
- "local-provider-detected" (CONCURRENCY-02 — on sub-run-concurrency-clamped event)
- "sibling-failed" (CONCURRENCY-01)
- "delegate-validation" (DELEGATE-03 — detail.kind)

RunCallOptions fields (second arg to Engine.run / Engine.stream):
- `maxDepth?: number` — can only LOWER the engine ceiling
- `maxConcurrentChildren?: number` — same lowering rule
- `defaultSubRunTimeoutMs?: number`
- `onChildFailure?: "continue" | "abort"` (Phase 4 default "continue")

Provider metadata:
- `ConfiguredModelProvider.metadata?.locality?: "local" | "remote"`
- `classifyHostLocality(host)` exported from openai-compatible

Stream-only field (NOT on persisted RunResult.events):
- `event.parentRunIds?: readonly string[]` — root → ... → immediate-parent ancestry chain on bubbled child events

ReplayTraceProtocolDecisionType literals added: start-sub-run, complete-sub-run, fail-sub-run, queue-sub-run, mark-sub-run-parent-aborted, mark-sub-run-budget-clamped, mark-sub-run-concurrency-clamped.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Author docs/recursive-coordination.md (concept + narrative + worked example)</name>
  <files>docs/recursive-coordination.md</files>
  <read_first>
    - .planning/phases/05-documentation-changelog/05-CONTEXT.md (D-01..D-06, D-19)
    - .planning/phases/01-delegate-decision-sub-run-traces/01-CONTEXT.md (delegate decision shape, sub-run events, maxDepth, replay)
    - .planning/phases/02-budget-cancellation-cost-rollup/02-CONTEXT.md (parent-aborted, timeout, defaultSubRunTimeoutMs, partialTrace, parent-rollup-drift)
    - .planning/phases/03-provider-locality-bounded-concurrency/03-CONTEXT.md (locality, maxConcurrentChildren, sub-run-concurrency-clamped)
    - .planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md (parentRunIds chain, structured failures, onChildFailure, detail.source)
    - CHANGELOG.md (lines 1-89 — already-shipped Phase 1/2/3 surface)
    - docs/developer-usage.md (lines 134-204 for protocols, 164-204 for streaming — for tone/format match)
    - docs/reference.md (entire file — for tone/format match; this page MUST NOT duplicate the exhaustive tables that go in recursive-coordination-reference.md)
    - src/runtime/coordinator.ts lines 459, 1116-1183, 1212-1262 — referenced by structured-failures section
    - src/types/events.ts lines 789-830 — sub-run event payload shapes
  </read_first>
  <action>
    Create `docs/recursive-coordination.md` with the following EXACT structure. Match the markdown style of `docs/developer-usage.md` (sentence-case H2s, one-blank-line spacing, fenced ```ts code blocks with explicit type annotations).

    ```markdown
    # Recursive Coordination

    > Coordinator agents can dispatch whole sub-missions. Available since v0.4.0.

    ## Contents

    - [Concept](#concept)
    - [API surface](#api-surface)
    - [AgentDecision narrowing](#agentdecision-narrowing)
    - [Propagation rules](#propagation-rules)
    - [Bounded concurrency and locality](#bounded-concurrency-and-locality)
    - [parentRunIds chain](#parentrunids-chain)
    - [Structured failures in the coordinator prompt](#structured-failures)
    - [Partial traces](#partial-traces)
    - [Replay parity](#replay-parity)
    - [Not in v0.4.0](#not-in-v040)
    - [Worked example](#worked-example)

    ## Concept

    [TWO PARAGRAPHS — D-01 framing. Paragraph 1: a coordinator agent emits a `delegate` decision to dispatch a sub-mission (`sequential` | `broadcast` | `shared` | `coordinator`); the sub-run's trace embeds in the parent's trace. Paragraph 2: budgets, aborts, and cost roll-up propagate cleanly across depth. Agent-driven nesting only — caller-defined trees (`Dogpile.nest`) are deferred (cross-link to #not-in-v040).]

    ## API surface

    [SINGLE TABLE — D-01. Columns: Surface | Where | Notes. Rows must cover every item in <interfaces> above. Group by category with table-row sub-headers as italicized cells (e.g. *Decision shape*, *Events*, *Options*, *Provider metadata*, *Stream-only fields*).]

    ## AgentDecision narrowing

    [Anchor: #agentdecision-narrowing — referenced by CHANGELOG Migration block in Plan 05 D-17. Show the discriminated union with `type: "participate" | "delegate"` and the narrowing pattern. 5-15 line fragment per D-02.]

    ```ts
    if (decision.type === "participate") {
      // existing paper-style fields: selectedRole, participation, contribution, rationale
    } else if (decision.type === "delegate") {
      // delegate-only fields: protocol, intent, model?, budget?
    }
    ```

    ## Propagation rules

    [5-15 line fragments per surface. Show abort propagation (parent → child, parent-aborted detail.reason); timeout propagation (parentDeadlineMs - now default; defaultSubRunTimeoutMs fallback; sub-run-budget-clamped event); cost roll-up recursion (parent.accounting.cost includes children + partialCost on failed); per-decision budget override clamping behavior.]

    ## Bounded concurrency and locality

    [Fragment showing maxConcurrentChildren default 4, lowering-only rule, sub-run-queued event under pressure, sibling-failed drain semantics. Then locality: "local" auto-detection by createOpenAICompatibleProvider, the auto-clamp-to-1 with sub-run-concurrency-clamped emission, the remote-override-on-local-host throw.]

    ## parentRunIds chain

    [D-04. Anchor: #parentrunids-chain. ASCII tree:]

    ```
    parent (runId: P)
    └── child (runId: C, parentRunIds=[P])
        └── grandchild (runId: G, parentRunIds=[P, C])
    ```

    [Show BOTH demux idioms:]

    ```ts
    // Immediate-parent demux
    if (event.parentRunIds?.[event.parentRunIds.length - 1] === handle.runId) { ... }

    // Ancestry demux (any descendant in the tree)
    if (event.parentRunIds?.includes(handle.runId)) { ... }
    ```

    > **Trace vs stream asymmetry.** `parentRunIds` is set on live stream events (via `teedEmit`) but is NOT persisted in `RunResult.events`. Replay reconstructs the chain at the bubbling boundary so replay-from-stream sees the same ancestry as live runs. Do NOT expect `parentRunIds` when iterating `result.trace.events`.

    ## Structured failures in the coordinator prompt

    [D-05. Anchor: #structured-failures. Show the EXACT prompt block format that lands in the next coordinator plan turn after a real child failure. Cross-link `coordinator.ts:459` and the planner-side assembly site.]

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

    > Synthetic failures (`sibling-failed`, `parent-aborted`) are excluded from this block — only real causes are surfaced to the coordinator. The format is part of the public coordinator-prompt contract; changes are tracked in `CHANGELOG.md`.

    ## Partial traces

    [Fragment: sub-run-failed carries partialTrace + partialCost; partialCost is included in parent rollup; partialTrace is intentionally omitted from the structured failures block but available on the event for callers/replay.]

    ## Replay parity

    [Fragment: `Dogpile.replay()` walks embedded sub-run-completed.subResult / sub-run-failed.partialTrace; `recomputeAccountingFromTrace` verifies; parent-rollup-drift throws `invalid-configuration` with `detail.reason: "trace-accounting-mismatch"` and `detail.subReason: "parent-rollup-drift"`. Replay reconstructs DogpileError instances at the throw boundary (instanceof DogpileError holds; .stack is fresh).]

    ## Not in v0.4.0

    [D-06. Anchor: #not-in-v040. Bullet list with one-sentence reason each:]

    - **Caller-defined trees (`Dogpile.nest`)** — deferred milestone; agent-driven nesting via `delegate` is the v0.4.0 surface.
    - **Worker-turn delegation** — only coordinator plan-turn agents may emit `delegate`; worker turns and final-synthesis turns reject delegate decisions with `invalid-configuration`.
    - **Per-child user-facing `StreamHandle`** — children remain internal in v0.4.0; cancellation flows through the parent handle. (See [structured-failures](#structured-failures) and [parentRunIds chain](#parentrunids-chain) for the observability surface that replaces a dedicated child handle.)

    ## Worked example

    [D-02. Anchor: #worked-example. ONE complete end-to-end example exercising every surface in a single run, with annotated event-log output. Build a coordinator that delegates two children (one `broadcast`, one `sequential`); use `Dogpile.stream` so the example shows parentRunIds demux live; show the sub-run-started → sub-run-completed event sequence with annotated parentRunIds at each level; show one intentionally-failing child (e.g. tiny budget) so sub-run-failed with partialCost lands; show the structured failures block the coordinator sees on its next plan turn; show final cost rollup including the partial cost. ~80-150 lines of code + commentary.]

    [Close with:]

    > For the exhaustive event/error/option tables, see [`docs/recursive-coordination-reference.md`](./recursive-coordination-reference.md).
    ```

    **Concrete content rules:**

    - Every code fence uses ```ts (TypeScript). For shell, ```sh.
    - Cross-links use relative paths: `./recursive-coordination-reference.md`, `./reference.md`, `./developer-usage.md`.
    - Source-line refs use repo-relative path with line number: `src/runtime/coordinator.ts:459`.
    - The page is the longest in `docs/` per D-01 (target 350-500 lines including code blocks). TOC handles navigation.
    - DO NOT duplicate exhaustive event-payload tables here — those live in the reference page (Task 2).
    - Match the existing `docs/developer-usage.md` tone (concise, code-first, no marketing language).
  </action>
  <verify>
    <automated>test -f docs/recursive-coordination.md && wc -l docs/recursive-coordination.md | awk '$1>=250{exit 0} {exit 1}' && grep -c "^## " docs/recursive-coordination.md</automated>
  </verify>
  <acceptance_criteria>
    - `test -f docs/recursive-coordination.md` exits 0.
    - `wc -l docs/recursive-coordination.md` reports >= 250 lines.
    - `grep -c "^## " docs/recursive-coordination.md` >= 11 (Concept, API surface, AgentDecision narrowing, Propagation rules, Bounded concurrency and locality, parentRunIds chain, Structured failures, Partial traces, Replay parity, Not in v0.4.0, Worked example, plus Contents).
    - `grep -nE "^- \[.*\]\(#" docs/recursive-coordination.md | wc -l` >= 11 (TOC entries — D-01 navigability).
    - All required anchor slugs present: `grep -cE "^## (AgentDecision narrowing|Propagation rules|parentRunIds chain|Structured failures|Partial traces|Replay parity|Not in v0\\.4\\.0|Worked example)" docs/recursive-coordination.md` == 8.
    - `grep -c "parent-aborted\|timeout\|sibling-failed\|local-provider-detected\|trace-accounting-mismatch\|depth-overflow\|remote-override-on-local-host" docs/recursive-coordination.md` >= 7 (every detail.reason from v0.4.0 mentioned at least once).
    - `grep -c "sub-run-started\|sub-run-completed\|sub-run-failed\|sub-run-queued\|sub-run-parent-aborted\|sub-run-budget-clamped\|sub-run-concurrency-clamped" docs/recursive-coordination.md` >= 7 (all seven event variants mentioned).
    - `grep -c "ASCII\|^\\s*└──\|parentRunIds=\\[" docs/recursive-coordination.md` >= 1 (D-04 ASCII diagram present).
    - `grep -c "parentRunIds\\?\\.\\[event\\.parentRunIds\\.length - 1\\]\\|parentRunIds\\?\\.includes" docs/recursive-coordination.md` >= 2 (D-04: BOTH demux idioms shown).
    - `grep -c "RunResult\\.events\|persisted.*chain\|trace.*asymmetry\|stream.*asymmetry" docs/recursive-coordination.md` >= 1 (D-04 trace/stream asymmetry call-out).
    - `grep -c "coordinator\\.ts:459\|coordinator\\.ts" docs/recursive-coordination.md` >= 1 (D-05 cross-link).
    - `grep -c "Dogpile\\.nest\|caller-defined trees" docs/recursive-coordination.md` >= 1 (D-06 deferral).
    - `grep -c "Worker-turn delegation\|worker turns\|final-synthesis" docs/recursive-coordination.md` >= 1 (D-06 deferral).
    - `grep -c "recursive-coordination-reference" docs/recursive-coordination.md` >= 1 (cross-link to reference page).
    - Forbidden duplication: `grep -c "^| Event payload\|^| Field | Type" docs/recursive-coordination.md` should be 0 or 1 (NOT a full reference table — those live in the reference page).
  </acceptance_criteria>
  <done>
    docs/recursive-coordination.md is a 250-500 line concept + narrative + worked-example page with TOC, all required anchors, fragment-per-concept hybrid (D-02), parentRunIds ASCII diagram (D-04), structured failures format excerpt (D-05), explicit "Not in v0.4.0" section (D-06), and a closing canonical worked example. All public-surface terms from v0.4.0 are mentioned at least once.
  </done>
</task>

<task type="auto">
  <name>Task 2: Author docs/recursive-coordination-reference.md (exhaustive reference tables)</name>
  <files>docs/recursive-coordination-reference.md</files>
  <read_first>
    - docs/recursive-coordination.md (just authored — confirm anchor IDs and avoid content duplication; this page is point-lookup, the other is narrative)
    - .planning/phases/05-documentation-changelog/05-CONTEXT.md (D-03)
    - src/types/events.ts lines 789-830 (sub-run event payload shapes — exact type signatures)
    - src/types.ts lines 1311-1985 (RunCallOptions, EngineOptions, DogpileError shape)
    - src/runtime/coordinator.ts (locality clamp logic, fan-out semantics — for the "clamp matrix" table)
    - src/providers/openai-compatible.ts (classifyHostLocality + locality auto-detect rules)
    - CHANGELOG.md (lines 1-89 — copy event-payload shape definitions verbatim where they appear)
    - docs/reference.md (existing exports catalog — match its formatting; do NOT duplicate its content, cross-link from there in Plan 02)
  </read_first>
  <action>
    Create `docs/recursive-coordination-reference.md`. This page is point-lookup; readers land here from a search or a link in `docs/reference.md` / the concept page. Sections (D-03 inventory):

    ```markdown
    # Recursive Coordination Reference

    > Exhaustive event, error, and option tables for v0.4.0 recursive coordination. For concepts and a worked example, see [`recursive-coordination.md`](./recursive-coordination.md).

    ## Contents

    - [Sub-run events](#sub-run-events)
    - [RunCallOptions](#runcalloptions)
    - [DogpileError code × detail.reason matrix](#error-matrix)
    - [parentRunIds chain semantics](#parentrunids-semantics)
    - [Replay-drift error matrix](#replay-drift-matrix)
    - [Provider locality classification](#locality-classification)
    - [ReplayTraceProtocolDecisionType literals](#replay-decision-literals)

    ## Sub-run events

    [TABLE per event variant. Columns: Event type | Payload fields (TypeScript signature) | When emitted | Phase introduced. Cover ALL SEVEN: sub-run-started, sub-run-queued, sub-run-completed, sub-run-failed, sub-run-parent-aborted, sub-run-budget-clamped, sub-run-concurrency-clamped. Use exact field names from src/types/events.ts.]

    ## RunCallOptions

    [TABLE. Columns: Field | Type | Default | Lowers engine ceiling? | Phase. Rows: maxDepth, maxConcurrentChildren, defaultSubRunTimeoutMs, onChildFailure. Plus EngineOptions superset note: every RunCallOptions field is also accepted on createEngine/Dogpile.pile/run/stream as the engine ceiling.]

    ## DogpileError code × detail.reason matrix

    [TABLE. Columns: error.code | detail.reason | detail.kind / detail.subReason | When raised | Phase introduced. Rows must cover EVERY combo from v0.4.0:
      - invalid-configuration / depth-overflow / kind: delegate-validation (DELEGATE-04, Phase 1)
      - invalid-configuration / kind: delegate-validation / parser/dispatcher (DELEGATE-03, Phase 1)
      - invalid-configuration / remote-override-on-local-host (PROVIDER-02, Phase 3)
      - invalid-configuration / trace-accounting-mismatch [+ subReason: parent-rollup-drift] (BUDGET-03, Phase 2)
      - aborted / parent-aborted (BUDGET-01, Phase 2)
      - aborted / timeout (BUDGET-02, Phase 2)
      - aborted / sibling-failed (CONCURRENCY-01, Phase 3)
      - provider-timeout / detail.source: "provider" | "engine" (Phase 4)
    ]

    ## parentRunIds chain semantics

    [Formal spec. Bullet list:
      - Type: `readonly string[]` ordered root → ... → immediate-parent.
      - Set on every event passed through `teedEmit` from a child stream into the parent stream.
      - NOT persisted on `RunResult.events`. Replay reconstructs at the bubbling boundary.
      - Per-child event order preserved within a single child; cross-child order unspecified.
      - Demux idioms (immediate vs ancestry).]

    ## Replay-drift error matrix

    [TABLE. Columns: Drift kind | Detection site | error.code | detail.reason | detail.subReason | detail.field | detail.eventIndex / detail.childRunId.
    Rows:
      - Per-event accounting mismatch (top-level): code=invalid-configuration, reason=trace-accounting-mismatch, eventIndex=-1, field=one-of-eight-numeric-fields.
      - Per-event accounting mismatch (child): same but eventIndex>=0, childRunId set.
      - Parent-rollup drift: subReason=parent-rollup-drift, field identifies the drifting numeric field.
    The eight comparable numeric fields (per CHANGELOG): cost.usd, cost.inputTokens, cost.outputTokens, cost.totalTokens, usage.usd, usage.inputTokens, usage.outputTokens, usage.totalTokens.]

    ## Provider locality classification

    [TABLE per host pattern. Columns: Pattern | Classification | Source.
    Rows from CHANGELOG/Phase 3:
      - localhost / loopback (127/8, ::1) → local
      - RFC1918 (10/8, 172.16/12, 192.168/16) → local
      - IPv4 link-local (169.254/16) → local
      - IPv6 ULA (fc00::/7) → local
      - IPv6 link-local (fe80::/10) → local
      - *.local mDNS → local
      - everything else → remote (treated as remote when locality omitted entirely)
    Note caller override: locality: "local" always wins; locality: "remote" on a detected-local OpenAI-compatible host throws invalid-configuration with detail.reason: "remote-override-on-local-host".]

    ## ReplayTraceProtocolDecisionType literals

    [BULLET LIST of every literal added in v0.4.0:
      - start-sub-run (Phase 1)
      - complete-sub-run (Phase 1)
      - fail-sub-run (Phase 1)
      - queue-sub-run (Phase 3)
      - mark-sub-run-parent-aborted (Phase 2)
      - mark-sub-run-budget-clamped (Phase 2)
      - mark-sub-run-concurrency-clamped (Phase 3)
    ]
    ```

    **Content rules:**

    - This page is reference, not narrative. Tables and bullet lists. Minimum prose.
    - Field signatures and shapes are EXACT — copy from `src/types/events.ts` and CHANGELOG.md verbatim. Drift between this page and the source files is a public-surface bug.
    - Every entry on every table must reference the Phase (1-4) it shipped in.
    - Cross-link back to `recursive-coordination.md` at top.
    - DO NOT duplicate the worked example or the narrative subsections — those live on the concept page.
  </action>
  <verify>
    <automated>test -f docs/recursive-coordination-reference.md && wc -l docs/recursive-coordination-reference.md | awk '$1>=150{exit 0} {exit 1}'</automated>
  </verify>
  <acceptance_criteria>
    - `test -f docs/recursive-coordination-reference.md` exits 0.
    - `wc -l docs/recursive-coordination-reference.md` reports >= 150 lines.
    - `grep -c "^## " docs/recursive-coordination-reference.md` >= 7 (all seven sections from D-03 inventory).
    - All seven sub-run event types appear: `grep -c "sub-run-started\|sub-run-queued\|sub-run-completed\|sub-run-failed\|sub-run-parent-aborted\|sub-run-budget-clamped\|sub-run-concurrency-clamped" docs/recursive-coordination-reference.md` >= 7.
    - All eight detail.reason values appear in the error matrix: `grep -c "depth-overflow\|delegate-validation\|remote-override-on-local-host\|trace-accounting-mismatch\|parent-aborted\|sibling-failed\|local-provider-detected\|parent-rollup-drift" docs/recursive-coordination-reference.md` >= 8.
    - All four RunCallOptions fields appear: `grep -c "maxDepth\|maxConcurrentChildren\|defaultSubRunTimeoutMs\|onChildFailure" docs/recursive-coordination-reference.md` >= 4.
    - All seven replay decision literals appear: `grep -c "start-sub-run\|complete-sub-run\|fail-sub-run\|queue-sub-run\|mark-sub-run-parent-aborted\|mark-sub-run-budget-clamped\|mark-sub-run-concurrency-clamped" docs/recursive-coordination-reference.md` >= 7.
    - Locality classification covers all six host pattern classes: `grep -c "loopback\|127\|RFC1918\|169\\.254\|fc00\|fe80\|\\*\\.local\|mDNS" docs/recursive-coordination-reference.md` >= 6.
    - All eight numeric drift fields enumerated: `grep -c "cost\\.usd\|cost\\.inputTokens\|cost\\.outputTokens\|cost\\.totalTokens\|usage\\.usd\|usage\\.inputTokens\|usage\\.outputTokens\|usage\\.totalTokens" docs/recursive-coordination-reference.md` >= 8.
    - Cross-link back to concept page: `grep -c "recursive-coordination\\.md" docs/recursive-coordination-reference.md` >= 1.
    - `package.json` `files` allowlist UNCHANGED — `node -e "const f=require('./package.json').files; if(f.some(x=>x.startsWith('docs/')))process.exit(1)"` exits 0.
  </acceptance_criteria>
  <done>
    docs/recursive-coordination-reference.md is a >=150-line exhaustive reference covering all seven sub-run events, all four RunCallOptions, all eight error reasons, all seven replay decision literals, and all locality patterns. No duplication with the concept page. Not added to package.json files allowlist.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| docs page → npm tarball | If `package.json` `files` accidentally globs `docs/`, the published tarball bloats and recursive-coordination.md ships to consumers. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-01 | I (Information disclosure / supply chain bloat) | docs/recursive-coordination*.md inclusion in npm tarball | mitigate | Acceptance criterion verifies `package.json` `files` does NOT include `docs/`. Plan 06 reruns `npm pack --dry-run` to catch any later regression. |
| T-05-02 | T (Tampering / contract drift) | Public-surface event-payload shapes in the reference page | mitigate | Field signatures are EXACT-copied from `src/types/events.ts`. Drift between docs and source is treated as a public-surface bug per CLAUDE.md invariants. Plan 02 cross-links from `docs/reference.md` rather than duplicating. |

No security-relevant code changes — pure documentation phase.
</threat_model>

<verification>
- `test -f docs/recursive-coordination.md && test -f docs/recursive-coordination-reference.md` both exit 0.
- All anchor IDs that downstream plans cross-link are present (Plan 04 README row, Plan 05 CHANGELOG Migration block).
- `pnpm run typecheck` (no source changes — should remain green; sanity check).
- `package.json` `files` allowlist unchanged.
</verification>

<success_criteria>
- DOCS-01 (concept page): `docs/recursive-coordination.md` documents `delegate`, propagation rules, concurrency, locality, and trace embedding with at least one worked example. Hybrid arc per D-01; fragment-per-concept + canonical close per D-02; TOC navigability; all required anchor IDs.
- DOCS-01 (reference page): `docs/recursive-coordination-reference.md` is a separate exhaustive reference per D-03 with every event variant, error reason, RunCallOptions field, and replay decision literal locked.
- D-04, D-05, D-06 explicitly satisfied with their dedicated subsections.
- Neither page added to `package.json` `files` allowlist (D-03 lock).
</success_criteria>

<output>
After completion, create `.planning/phases/05-documentation-changelog/05-01-SUMMARY.md` recording:
- Final line counts for both pages
- Final anchor ID list (downstream plans cross-link these)
- Any RESEARCH.md content cross-references that landed on the page
- Confirmation that `package.json` `files` was NOT modified
</output>
