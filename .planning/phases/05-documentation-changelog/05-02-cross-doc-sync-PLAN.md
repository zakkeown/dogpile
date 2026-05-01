---
phase: 05-documentation-changelog
plan: 02
type: execute
wave: 2
depends_on: ["05-01"]
files_modified:
  - docs/reference.md
  - docs/developer-usage.md
  - AGENTS.md
  - CLAUDE.md
autonomous: true
requirements: [DOCS-01]
tags: [docs, reference, cross-doc-sync]

must_haves:
  truths:
    - "docs/reference.md gains entries for every v0.4.0 public export not previously documented: RunCallOptions, the seven SubRun*Event types, classifyHostLocality, recomputeAccountingFromTrace, and the seven new ReplayTraceProtocolDecisionType literals (D-20)"
    - "docs/reference.md cross-links docs/recursive-coordination.md and docs/recursive-coordination-reference.md instead of duplicating the exhaustive tables (D-03 split)"
    - "docs/developer-usage.md gains a 'Recursive coordination' section after the existing protocol/coordinator content (~50-80 lines per D-19)"
    - "docs/developer-usage.md 'Recursive coordination' section explicitly defers reference material to docs/recursive-coordination-reference.md (D-19: avoid duplication)"
    - "docs/developer-usage.md section opens with a maintenance comment ('When delegate surface changes, update both docs/recursive-coordination.md and this section') per D-19"
    - "AGENTS.md cross-cutting invariants list mentions recursive coordination (delegate decision + sub-run-* events as part of the public-surface invariants list — D-20)"
    - "CLAUDE.md cross-cutting invariants section gains a 'Recursive coordination' line referencing the public-surface mirror with event-schema/result-contract/package-exports tests (D-20)"
    - "AGENTS.md and CLAUDE.md remain consistent per CLAUDE.md's stated invariant — same phrasing where they mirror"
    - "src/tests/package-exports.test.ts is NOT modified by this plan (Phase 1-4 exports already shipped; this plan documents, does not change, exports)"
  artifacts:
    - path: "docs/reference.md"
      provides: "Updated exports catalog covering the v0.4.0 additions; cross-links to docs/recursive-coordination*.md."
      contains: "RunCallOptions"
    - path: "docs/developer-usage.md"
      provides: "New 'Recursive coordination' section ~50-80 lines, narrative-tone, links to the dedicated docs page."
      contains: "## Recursive Coordination"
    - path: "AGENTS.md"
      provides: "Repository-guidelines mirror updated to mention recursive-coordination invariants."
      contains: "recursive coordination"
    - path: "CLAUDE.md"
      provides: "Cross-cutting invariants list mentions recursive-coordination public surface."
      contains: "recursive coordination"
  key_links:
    - from: "docs/reference.md"
      to: "docs/recursive-coordination-reference.md"
      via: "explicit 'see' link for each new export group"
      pattern: "recursive-coordination-reference"
    - from: "docs/developer-usage.md Recursive coordination section"
      to: "docs/recursive-coordination.md"
      via: "see-also link"
      pattern: "recursive-coordination\\.md"
    - from: "CLAUDE.md cross-cutting invariants"
      to: "AGENTS.md (mirrored line)"
      via: "consistent phrasing per CLAUDE.md self-invariant"
      pattern: "recursive coordination"
---

<objective>
Sync the four cross-cutting docs (`docs/reference.md`, `docs/developer-usage.md`, `AGENTS.md`, `CLAUDE.md`) with the v0.4.0 public surface and the new docs pages from Plan 05-01.

- **`docs/reference.md` (D-20):** Add new exports — `RunCallOptions`, the seven `SubRun*Event` types, `recomputeAccountingFromTrace`, `classifyHostLocality`, the new `ReplayTraceProtocolDecisionType` literals. Cross-link the dedicated reference page rather than duplicating tables.
- **`docs/developer-usage.md` (D-19):** Add a "Recursive coordination" section (~50-80 lines) after the existing protocol/coordinator content. Narrative tone matching the rest of the file; defers reference material to the dedicated pages.
- **`AGENTS.md` + `CLAUDE.md` (D-20 + CLAUDE.md self-invariant):** Mirror an updated cross-cutting-invariants line referencing recursive coordination + the public-surface tests it touches.

Purpose: callers landing on the pre-existing canonical docs (`docs/reference.md`, `docs/developer-usage.md`) don't miss recursive coordination. AGENTS.md / CLAUDE.md stay aligned per CLAUDE.md's stated mirror invariant.

Output: four files modified. No source changes; no tests touched. `pnpm run typecheck` and `pnpm run test` remain green (sanity).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/05-documentation-changelog/05-CONTEXT.md
@.planning/phases/05-documentation-changelog/05-01-recursive-coordination-docs-PLAN.md
@CLAUDE.md
@AGENTS.md
@CHANGELOG.md
@docs/reference.md
@docs/developer-usage.md
@docs/recursive-coordination.md
@docs/recursive-coordination-reference.md
@src/types.ts
@src/types/events.ts
@src/index.ts

<interfaces>
<!-- Existing docs/reference.md section structure (extracted from grep -n '^## '): -->
<!-- ## Provider Boundary -->
<!-- ## OpenAI-Compatible Provider Configuration -->
<!-- ## Runtime Tool Input Validation -->
<!-- ## DogpileError Codes -->
<!-- ## Single-Call Workflow Contract -->
<!-- ## Replay Trace Contract -->
<!-- ## Benchmark Artifacts -->

<!-- Existing docs/developer-usage.md section structure: -->
<!-- ## Mental Model | ## Install | ## Choose An API | ## Minimal Provider | ## OpenAI-Compatible HTTP -->
<!-- ## Protocols | ## Streaming | ## Budgets And Termination | ## Evaluation | ## Runtime Tools -->
<!-- ## Replay And Persistence | ## Error Handling | ## Retrying Provider Failures | ## Structured Logging -->
<!-- ## Browser Usage | ## Repository Development -->

<!-- AGENTS.md section structure (full file is short): -->
<!-- ## Project Structure & Module Organization | ## Build, Test, and Development Commands -->
<!-- ## Coding Style & Naming Conventions | ## Testing Guidelines -->
<!-- ## Commit & Pull Request Guidelines | ## Security & Configuration Tips -->

<!-- CLAUDE.md "Cross-cutting invariants" section is at the heart of the file -->
<!-- — read it before editing to find the existing recursive-coordination-relevant -->
<!-- bullet (event-shape changes propagate to event-schema.test.ts etc). -->

<!-- v0.4.0 exports to document in docs/reference.md (NEW since v0.3.x): -->
//   RunCallOptions (root + /types subpath)
//   SubRunStartedEvent, SubRunQueuedEvent, SubRunCompletedEvent, SubRunFailedEvent,
//   SubRunParentAbortedEvent, SubRunBudgetClampedEvent, SubRunConcurrencyClampedEvent
//   classifyHostLocality (from /providers/openai-compatible)
//   recomputeAccountingFromTrace (root)
//   New ReplayTraceProtocolDecisionType literals: start-sub-run, complete-sub-run,
//     fail-sub-run, queue-sub-run, mark-sub-run-parent-aborted,
//     mark-sub-run-budget-clamped, mark-sub-run-concurrency-clamped
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update docs/reference.md with v0.4.0 exports + cross-link to recursive-coordination pages</name>
  <files>docs/reference.md</files>
  <read_first>
    - docs/reference.md (entire file — match formatting; identify which existing sections gain new rows vs need a new subsection)
    - docs/recursive-coordination.md (anchor IDs to cross-link)
    - docs/recursive-coordination-reference.md (full reference table location)
    - .planning/phases/05-documentation-changelog/05-CONTEXT.md (D-20)
    - src/types.ts (canonical type definitions for RunCallOptions and SubRun* event interfaces — quote exact field names)
    - src/types/events.ts (sub-run event types)
    - src/index.ts (confirm what is re-exported from the root entry — the doc must reflect public reachability)
    - CHANGELOG.md (lines 1-89 — pull existing wording for consistency)
  </read_first>
  <action>
    Edit `docs/reference.md`. Add the following content; preserve all existing sections.

    **(A) Replay Trace Contract section — augment existing.**

    Append to the existing `## Replay Trace Contract` section (line ~201) a subsection enumerating new v0.4.0 decision literals:

    ```markdown
    ### Recursive coordination decision literals (v0.4.0)

    `ReplayTraceProtocolDecisionType` gained these literals in v0.4.0:

    - `start-sub-run` — pairs with `sub-run-started`
    - `complete-sub-run` — pairs with `sub-run-completed`
    - `fail-sub-run` — pairs with `sub-run-failed`
    - `queue-sub-run` — pairs with `sub-run-queued`
    - `mark-sub-run-parent-aborted` — pairs with `sub-run-parent-aborted`
    - `mark-sub-run-budget-clamped` — pairs with `sub-run-budget-clamped`
    - `mark-sub-run-concurrency-clamped` — pairs with `sub-run-concurrency-clamped`

    See [`recursive-coordination-reference.md#replay-decision-literals`](./recursive-coordination-reference.md#replay-decision-literals) for the full payload schema of each event variant.
    ```

    **(B) DogpileError Codes section — augment existing.**

    Append to `## DogpileError Codes` (line ~129) a "v0.4.0 detail.reason additions" subsection that lists the new vocabulary values WITHOUT duplicating the matrix table (which lives in the reference page):

    ```markdown
    ### Recursive coordination detail.reason vocabulary (v0.4.0)

    These `error.detail.reason` values were added in v0.4.0:

    - `depth-overflow` — depth exceeds `maxDepth`
    - `parent-aborted` — child aborted because the parent aborted
    - `timeout` — on `code: "aborted"` for parent-budget propagation
    - `sibling-failed` — queued sibling drained after another delegate failed
    - `remote-override-on-local-host` — caller forced `locality: "remote"` on a detected-local OpenAI-compatible host
    - `trace-accounting-mismatch` (with `subReason: "parent-rollup-drift"` for the rollup variant) — replay drift detection
    - `local-provider-detected` — on the `sub-run-concurrency-clamped` event payload (not on a thrown error)

    Provider-timeout errors gain optional `detail.source?: "provider" | "engine"` discriminator (absence === "provider" for backwards-compat).

    See [`recursive-coordination-reference.md#error-matrix`](./recursive-coordination-reference.md#error-matrix) for the exhaustive code × detail.reason matrix.
    ```

    **(C) NEW SECTION — Recursive Coordination Surface.**

    Append a new top-level section after `## Replay Trace Contract` and before `## Benchmark Artifacts`:

    ```markdown
    ## Recursive Coordination Surface (v0.4.0)

    Recursive coordination is documented in detail in [`recursive-coordination.md`](./recursive-coordination.md) (concepts + worked example) and [`recursive-coordination-reference.md`](./recursive-coordination-reference.md) (exhaustive event/error/option tables). This section catalogs only the public exports added since v0.3.x.

    ### Run / engine options

    - `RunCallOptions` — second-arg options on `Engine.run` and `Engine.stream`. Re-exported from `@dogpile/sdk` and `@dogpile/sdk/types`. Fields:
      - `maxDepth?: number` (default `4`; can only LOWER the engine ceiling)
      - `maxConcurrentChildren?: number` (default `4`; lowering-only)
      - `defaultSubRunTimeoutMs?: number`
      - `onChildFailure?: "continue" | "abort"` (default `"continue"`)
    - `EngineOptions` accepts the same fields as ceilings (`Dogpile.pile`, `createEngine`, `run`, `stream`).

    ### Sub-run events (RunEvent union additions)

    The seven `SubRun*Event` types are exported from `@dogpile/sdk` and `@dogpile/sdk/types`:

    - `SubRunStartedEvent`, `SubRunQueuedEvent`, `SubRunCompletedEvent`, `SubRunFailedEvent`
    - `SubRunParentAbortedEvent`, `SubRunBudgetClampedEvent`, `SubRunConcurrencyClampedEvent`

    Full payload schemas in [`recursive-coordination-reference.md#sub-run-events`](./recursive-coordination-reference.md#sub-run-events).

    ### Provider locality

    - `ConfiguredModelProvider.metadata?.locality?: "local" | "remote"` — optional readonly hint.
    - `classifyHostLocality(host: string)` — re-exported from `@dogpile/sdk/providers/openai-compatible` for callers building custom adapters or tests.

    ### Replay helper

    - `recomputeAccountingFromTrace(trace)` — re-exported from `@dogpile/sdk`. Walks an embedded trace and verifies recorded `RunAccounting` against a per-child recompute. Throws `DogpileError({ code: "invalid-configuration", detail.reason: "trace-accounting-mismatch" })` on drift.

    ### Stream-only field

    - `event.parentRunIds?: readonly string[]` — ancestry chain on bubbled child events. Set on live stream events; NOT persisted on `RunResult.events`. See [`recursive-coordination.md#parentrunids-chain`](./recursive-coordination.md#parentrunids-chain).
    ```

    **Constraint: do NOT touch `src/tests/package-exports.test.ts` from this plan.** All Phase 1-4 exports already shipped; the test is current.
  </action>
  <verify>
    <automated>grep -c "RunCallOptions\|SubRunStartedEvent\|classifyHostLocality\|recomputeAccountingFromTrace\|recursive-coordination-reference" docs/reference.md</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "^## Recursive Coordination Surface" docs/reference.md` == 1.
    - `grep -c "RunCallOptions" docs/reference.md` >= 1.
    - `grep -c "SubRunStartedEvent\|SubRunQueuedEvent\|SubRunCompletedEvent\|SubRunFailedEvent\|SubRunParentAbortedEvent\|SubRunBudgetClampedEvent\|SubRunConcurrencyClampedEvent" docs/reference.md` >= 7.
    - `grep -c "classifyHostLocality" docs/reference.md` >= 1.
    - `grep -c "recomputeAccountingFromTrace" docs/reference.md` >= 1.
    - All seven new replay decision literals listed: `grep -cE "start-sub-run|complete-sub-run|fail-sub-run|queue-sub-run|mark-sub-run-parent-aborted|mark-sub-run-budget-clamped|mark-sub-run-concurrency-clamped" docs/reference.md` >= 7.
    - All v0.4.0 detail.reason values listed: `grep -cE "depth-overflow|parent-aborted|sibling-failed|remote-override-on-local-host|trace-accounting-mismatch|local-provider-detected" docs/reference.md` >= 6.
    - Cross-link to recursive-coordination-reference.md present at least 3 times: `grep -c "recursive-coordination-reference" docs/reference.md` >= 3.
    - Cross-link to recursive-coordination.md present: `grep -c "recursive-coordination\\.md" docs/reference.md` >= 1 (the section list-link).
    - No exhaustive tables duplicated: forbidden — `grep -c "^| Drift kind\|^| Pattern\|^| Event type" docs/reference.md` == 0.
    - `src/tests/package-exports.test.ts` is unchanged (sanity): `git diff --name-only -- src/tests/package-exports.test.ts | wc -l` == 0.
  </acceptance_criteria>
  <done>
    docs/reference.md catalogs every v0.4.0 public export and detail.reason value, cross-links the dedicated recursive-coordination pages instead of duplicating tables, and leaves package-exports.test.ts unchanged.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add "Recursive Coordination" section to docs/developer-usage.md (D-19)</name>
  <files>docs/developer-usage.md</files>
  <read_first>
    - docs/developer-usage.md (entire file — match tone, code-fence style, link format)
    - docs/recursive-coordination.md (just authored — link to anchors and not duplicate)
    - .planning/phases/05-documentation-changelog/05-CONTEXT.md (D-19)
  </read_first>
  <action>
    Edit `docs/developer-usage.md`. Insert a NEW section titled "Recursive Coordination" AFTER the existing `## Protocols` section (line 134) and BEFORE the `## Streaming` section (line 164). Target ~50-80 lines.

    Section structure (D-19):

    ```markdown
    ## Recursive Coordination

    <!-- When the delegate surface changes, update both this section and docs/recursive-coordination.md. Reference material lives in docs/recursive-coordination-reference.md to avoid drift. -->

    Coordinator agents can dispatch a whole sub-mission as part of a plan turn by emitting a `delegate` decision. The runtime executes the sub-run as a real Dogpile run; its trace embeds in the parent's trace, and budgets, aborts, and cost roll-up propagate.

    ```ts
    if (decision.type === "delegate") {
      // protocol: "sequential" | "broadcast" | "shared" | "coordinator"
      // intent:   the sub-mission's mission text
      // model?:   optional override (defaults to parent's model)
      // budget?:  optional clamp (cannot exceed parent's remaining)
    }
    ```

    The four-protocol list is unchanged; `delegate` is a parser-level concern on the `coordinator` protocol's plan turn.

    ### Defaults

    - `maxDepth` = 4 (delegate inside delegate inside delegate ...). Per-run option can only LOWER the engine ceiling.
    - `maxConcurrentChildren` = 4. Local-provider tree members force the effective max to 1 (auto-clamp); a `sub-run-concurrency-clamped` event records the clamp.
    - `defaultSubRunTimeoutMs` falls back when neither parent's deadline nor the per-decision budget pins a child timeout.

    ### When to use delegate

    Reach for `delegate` when a coordinator plan turn naturally decomposes into a self-contained sub-mission whose result feeds the next plan turn — e.g. a coordinator-of-coordinators that spins up a `broadcast` for evidence-gathering before synthesizing. Avoid delegate for one-shot worker tasks; emit `participate` or end the run instead.

    ### See also

    - [`recursive-coordination.md`](./recursive-coordination.md) — full surface, propagation rules, parentRunIds chain, structured failures, replay parity, worked example.
    - [`recursive-coordination-reference.md`](./recursive-coordination-reference.md) — exhaustive event/error/option tables.
    ```

    **Tone rules:**

    - Match existing developer-usage.md tone: code-first, no marketing language, ~one-line opening per subsection.
    - DO NOT duplicate event payloads or detail.reason matrices — link to the reference pages.
    - Section length: target 50-80 lines including code blocks (D-19).
    - The leading HTML comment IS the maintenance note D-19 calls for.
  </action>
  <verify>
    <automated>grep -n "^## Recursive Coordination" docs/developer-usage.md && awk '/^## Recursive Coordination/,/^## Streaming/' docs/developer-usage.md | wc -l</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "^## Recursive Coordination" docs/developer-usage.md` == 1.
    - `awk '/^## Recursive Coordination/,/^## Streaming/' docs/developer-usage.md | wc -l` is between 50 and 100 lines (D-19 target ~50-80 + buffer).
    - Section appears AFTER `## Protocols` and BEFORE `## Streaming`: `awk '/^## Protocols/{p=NR} /^## Recursive Coordination/{r=NR} /^## Streaming/{s=NR} END{exit !(p<r && r<s)}' docs/developer-usage.md` exits 0.
    - Maintenance comment present: `grep -c "When the delegate surface changes" docs/developer-usage.md` >= 1.
    - Cross-links present: `grep -c "recursive-coordination\\.md\|recursive-coordination-reference\\.md" docs/developer-usage.md` >= 2.
    - Forbidden duplication: `grep -c "^| Event type\|^| Pattern \\|" docs/developer-usage.md` == 0 (no exhaustive tables — those live in the reference page).
    - `pnpm run typecheck` exits 0 (sanity — no source changes expected).
  </acceptance_criteria>
  <done>
    docs/developer-usage.md has a 50-80 line "Recursive Coordination" section between Protocols and Streaming, with a maintenance comment, defers to the dedicated pages for reference material, and matches the file's tone.
  </done>
</task>

<task type="auto">
  <name>Task 3: Mirror cross-cutting-invariants update across AGENTS.md and CLAUDE.md (D-20)</name>
  <files>AGENTS.md, CLAUDE.md</files>
  <read_first>
    - CLAUDE.md (entire file — locate the "## Cross-cutting invariants" subsection or equivalent — find the "Public-surface invariants must move together" line)
    - AGENTS.md (entire file — find the parallel section to mirror)
    - .planning/phases/05-documentation-changelog/05-CONTEXT.md (D-20)
  </read_first>
  <action>
    **CLAUDE.md edit:**

    Locate the cross-cutting invariants area (under `### Cross-cutting invariants` or the public-surface bullet list — the project's existing section header for cross-cutting invariants). Add a new bullet:

    ```markdown
    - **Recursive coordination public-surface mirror.** The `delegate` decision variant, `sub-run-*` event family, `RunCallOptions`, `parentRunIds` stream chain, `locality`, `maxConcurrentChildren`, and `maxDepth` are public surface. Changes propagate to `src/tests/event-schema.test.ts`, `src/tests/result-contract.test.ts`, `src/tests/package-exports.test.ts`, `package.json` `exports`/`files`, `CHANGELOG.md`, AND the two recursive-coordination doc pages (`docs/recursive-coordination.md` + `docs/recursive-coordination-reference.md`).
    ```

    Place it adjacent to the existing "Public-surface invariants must move together" bullet so the two are next to each other.

    **AGENTS.md edit:**

    Locate AGENTS.md's parallel section (most likely under `## Project Structure & Module Organization` or similar invariants list). Add the SAME bullet, phrased identically (mirror discipline per CLAUDE.md self-invariant). If AGENTS.md has no public-surface bullet today, add it under the closest cross-cutting section — keep wording identical to the CLAUDE.md addition.

    **Mirror discipline:**

    Both files end up with the SAME line. Use the EXACT same bullet text in both — that's the simplest grep-verifiable mirror check.
  </action>
  <verify>
    <automated>grep -c "Recursive coordination public-surface mirror" CLAUDE.md AGENTS.md</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "Recursive coordination public-surface mirror" CLAUDE.md` == 1.
    - `grep -c "Recursive coordination public-surface mirror" AGENTS.md` == 1.
    - The bullet text is IDENTICAL in both files (mirror discipline): `diff <(grep "Recursive coordination public-surface mirror" CLAUDE.md) <(grep "Recursive coordination public-surface mirror" AGENTS.md)` exits 0.
    - The bullet mentions all six public-surface tests: `grep "Recursive coordination public-surface mirror" CLAUDE.md | grep -c "event-schema\\.test\\.ts.*result-contract\\.test\\.ts.*package-exports\\.test\\.ts"` == 1.
    - The bullet references both new doc pages: `grep "Recursive coordination public-surface mirror" CLAUDE.md | grep -c "recursive-coordination\\.md.*recursive-coordination-reference\\.md"` == 1.
  </acceptance_criteria>
  <done>
    CLAUDE.md and AGENTS.md carry the same "Recursive coordination public-surface mirror" bullet referencing all six public-surface gates plus both new doc pages, satisfying CLAUDE.md's self-invariant.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| docs/reference.md → recursive-coordination-reference.md | Drift between the two reference surfaces. |
| CLAUDE.md ↔ AGENTS.md | Mirror inconsistency (per CLAUDE.md's self-invariant). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-03 | T (Tampering / contract drift) | docs/reference.md duplicating tables that also live in recursive-coordination-reference.md | mitigate | Acceptance criterion forbids exhaustive tables in docs/reference.md; only links + lists. Single source of truth is the dedicated reference page. |
| T-05-04 | T (Mirror drift) | CLAUDE.md vs AGENTS.md cross-cutting-invariants bullets | mitigate | Acceptance criterion enforces byte-identical bullet text via `diff`. |

No security-relevant code changes — pure documentation phase.
</threat_model>

<verification>
- All four files modified; no source code changes.
- `pnpm run typecheck` exits 0 (sanity).
- `pnpm run test` exits 0 (no public-surface tests touched).
- `git diff --stat` shows changes only in docs/reference.md, docs/developer-usage.md, AGENTS.md, CLAUDE.md.
- `src/tests/package-exports.test.ts` is unchanged.
</verification>

<success_criteria>
- DOCS-01 (cross-doc closure): `docs/reference.md` now catalogs every v0.4.0 public export and cross-links the dedicated recursive-coordination pages.
- D-19: `docs/developer-usage.md` has a 50-80 line "Recursive Coordination" section after Protocols.
- D-20: AGENTS.md and CLAUDE.md mirror an updated cross-cutting-invariants line referencing recursive coordination.
- CLAUDE.md self-invariant (AGENTS.md ↔ CLAUDE.md consistency) preserved.
</success_criteria>

<output>
After completion, create `.planning/phases/05-documentation-changelog/05-02-SUMMARY.md` recording:
- Exact line numbers / sections modified in each of the four files
- Confirmation that `src/tests/package-exports.test.ts` was NOT modified
- Mirror-discipline confirmation: identical bullet text in CLAUDE.md and AGENTS.md
</output>
