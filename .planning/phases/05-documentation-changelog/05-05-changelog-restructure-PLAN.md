---
phase: 05-documentation-changelog
plan: 05
type: execute
wave: 1
depends_on: []
files_modified:
  - CHANGELOG.md
autonomous: true
requirements: [DOCS-04]
tags: [changelog, public-surface, migration, restructure]

must_haves:
  truths:
    - "CHANGELOG.md v0.4.0 entry is restructured from phase-grouped to thematic-with-(Phase N)-tags per D-16: Breaking | Migration | Added — `delegate` decision and sub-run traces (Phase 1) | Added — Budget, cancellation, cost roll-up (Phase 2) | Added — Provider locality and bounded concurrency (Phase 3) | Added — Streaming and child error escalation (Phase 4) | Added — Documentation and runnable example (Phase 5)"
    - "ALL existing Phase 1/2/3 bullet content from the current CHANGELOG (lines 1-89) is PRESERVED — D-16 says restructure, not rewrite. Re-grouping under new thematic headings; no bullet text deleted"
    - "A new ### Migration subsection appears between Breaking and the first Added block, with the D-17 before/after AgentDecision snippet (10-20 lines) and a cross-link to docs/recursive-coordination.md#agentdecision-narrowing"
    - "The Migration subsection heading is exactly: ### Migration — AgentDecision narrowing (v0.3.x → v0.4.0) (D-17 lock)"
    - "Phase 4 additions are listed in their own thematic block: parentRunIds chain, AbortedEvent, onChildFailure, detail.source on provider-timeout, structured coordinator-prompt failures section (per CONTEXT D-15 inventory and Plan 04-04 CHANGELOG entry already in flight)"
    - "Phase 5 additions are listed: docs/recursive-coordination.md, docs/recursive-coordination-reference.md, examples/recursive-coordination/, README 'Choose Your Path' row, developer-usage.md section"
    - "Heading remains '## [Unreleased] — v0.4.0' in this plan — DO NOT date-stamp here. D-18 explicitly states the date must be the actual publish date; Plan 06 owns the date-stamp commit immediately before tag/publish"
    - "Every (Phase N) annotation is preserved on bullets that originated in a specific phase (D-16: thematic top-level with phase tags)"
    - "package.json version is NOT bumped here (Plan 06 owns version bump alongside date-stamp)"
    - "Existing v0.3.x and earlier entries (lines 91+) are UNCHANGED"
  artifacts:
    - path: "CHANGELOG.md"
      provides: "v0.4.0 entry restructured to thematic-with-phase-tags, with a new Migration subsection containing the AgentDecision before/after snippet."
      contains: "### Migration — AgentDecision narrowing"
  key_links:
    - from: "CHANGELOG.md Migration subsection"
      to: "docs/recursive-coordination.md#agentdecision-narrowing"
      via: "explicit cross-link"
      pattern: "agentdecision-narrowing"
    - from: "Each thematic Added block"
      to: "(Phase N) annotation on relevant bullets"
      via: "inline tags"
      pattern: "\\(Phase [1-5]\\)"
---

<objective>
Restructure the v0.4.0 CHANGELOG entry from phase-grouped to thematic-with-(Phase N)-tags per D-16, and add the new Migration subsection per D-17. CRITICAL: this plan does NOT date-stamp the heading and does NOT bump the version. Plan 06 owns those steps so the date is the actual publish date per D-18.

Restructure target (D-16):

```
## [Unreleased] — v0.4.0

### Breaking
  - AgentDecision discriminated union (Phase 1)

### Migration — AgentDecision narrowing (v0.3.x → v0.4.0)
  - Before/after snippet (D-17)

### Added — `delegate` decision and sub-run traces (Phase 1)
  - all Phase 1 bullets, preserved verbatim

### Added — Budget, cancellation, cost roll-up (Phase 2)
  - all Phase 2 bullets, preserved verbatim

### Added — Provider locality and bounded concurrency (Phase 3)
  - all Phase 3 bullets, preserved verbatim

### Added — Streaming and child error escalation (Phase 4)
  - parentRunIds chain, AbortedEvent, onChildFailure, detail.source, structured failures (from Plan 04-04 batched entry)

### Added — Documentation and runnable example (Phase 5)
  - docs/recursive-coordination.md + recursive-coordination-reference.md
  - examples/recursive-coordination/
  - README "Choose Your Path" row
  - developer-usage.md section

### Notes
  - existing notes preserved
```

Purpose: a developer reading the v0.4.0 CHANGELOG sees one coherent thematic narrative ("recursive coordination shipped: here are the public-surface additions, by category") with phase-tag breadcrumbs that make traceability easy. A migration snippet shows the only breaking change at-a-glance.

Output: a single CHANGELOG.md edit. No source changes. The heading stays `## [Unreleased] — v0.4.0`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/05-documentation-changelog/05-CONTEXT.md
@.planning/phases/04-streaming-child-error-escalation/04-04-throw-and-timeout-discrimination-PLAN.md
@CHANGELOG.md
@CLAUDE.md

<interfaces>
<!-- CURRENT CHANGELOG v0.4.0 STRUCTURE (lines 1-89), to be restructured: -->
//
// ## [Unreleased] — v0.4.0
//
// ### Breaking
//   - AgentDecision discriminated union (no phase tag yet)
//
// ### Added
//   - delegate decision (Phase 1, no explicit tag)
//   - sub-run-* events (Phase 1)
//   - synthetic transcript entries (Phase 1)
//   - maxDepth option + RunCallOptions (Phase 1)
//   - fenced-JSON delegate parsing (Phase 1)
//   - Dogpile.replay() rehydrates sub-run traces + recomputeAccountingFromTrace (Phase 1)
//   - new ReplayTraceProtocolDecisionType literals (Phase 1)
//
// ### Added — Recursive coordination: budget, cancellation, cost roll-up (Phase 2)
//   #### Cancellation propagation (BUDGET-01)
//   #### Timeout / deadline propagation (BUDGET-02)
//   #### Cost & token roll-up + replay parity (BUDGET-03)
//   #### Termination floors (BUDGET-04)
//
// ### Added — Recursive coordination: provider locality and bounded concurrency (Phase 3)
//   #### Provider locality (PROVIDER-01..03)
//   #### Bounded child concurrency (CONCURRENCY-01)
//   #### Local-provider clamp (CONCURRENCY-02)
//   #### Public-surface tests
//
// ### Notes
//   - existing notes

<!-- TARGET STRUCTURE (D-16): -->
//
// ## [Unreleased] — v0.4.0
//
// ### Breaking
// ### Migration — AgentDecision narrowing (v0.3.x → v0.4.0)
// ### Added — `delegate` decision and sub-run traces (Phase 1)
// ### Added — Budget, cancellation, cost roll-up (Phase 2)
// ### Added — Provider locality and bounded concurrency (Phase 3)
// ### Added — Streaming and child error escalation (Phase 4)
// ### Added — Documentation and runnable example (Phase 5)
// ### Notes

<!-- D-17 Migration snippet (verbatim): -->
//
// ```ts
// // v0.3.x
// const decision: AgentDecision = await coordinator.run(...);
// console.log(decision.selectedRole, decision.contribution);
//
// // v0.4.0
// const decision = await coordinator.run(...);
// if (decision.type === "participate") {
//   console.log(decision.selectedRole, decision.contribution);
// } else if (decision.type === "delegate") {
//   // new: handle delegated sub-mission
// }
// ```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Restructure v0.4.0 CHANGELOG entry to thematic-with-phase-tags + add Migration subsection (D-16 + D-17)</name>
  <files>CHANGELOG.md</files>
  <read_first>
    - CHANGELOG.md (entire file — confirm current state of lines 1-89; confirm Phase 4 entries from Plan 04-04 are present or absent at planning time; preserve Phase 1/2/3 bullet text VERBATIM through the move)
    - .planning/phases/05-documentation-changelog/05-CONTEXT.md (D-16, D-17, D-18; the Code Context note "do not rewrite content; reorganize by theme + add (Phase N) tags")
    - .planning/phases/04-streaming-child-error-escalation/04-04-throw-and-timeout-discrimination-PLAN.md (Phase 4 CHANGELOG batched entry; if Plan 04-04 ran before this plan, those bullets are already present and need re-grouping; if not, this plan adds the Phase 4 thematic header with the inventory from D-15 of Phase 4 CONTEXT)
    - docs/recursive-coordination.md (just authored — confirm the #agentdecision-narrowing anchor exists for D-17 cross-link)
  </read_first>
  <action>
    Edit `CHANGELOG.md`. The restructure is mechanical: cut and paste existing bullets under new thematic headings; do NOT rewrite content. Then add the Migration subsection.

    **Step A: Verify current state.**

    Confirm the current shape against the <interfaces> above. If Plan 04-04 has not yet run, Phase 4 thematic block additions come from Plan 04-04's spec (D-15 inventory in Phase 4 CONTEXT). If Plan 04-04 ran first, those bullets are already in CHANGELOG and just need re-grouping.

    **Step B: Replace lines 1-89 with the restructured form.**

    The new shape:

    ```markdown
    # Changelog

    ## [Unreleased] — v0.4.0

    Recursive coordination — coordinators can now dispatch whole sub-missions via a `delegate` decision, with embedded child traces, propagated budgets/aborts/costs, bounded concurrency with locality clamping, live child-event bubbling on streams, and structured child-failure escalation. See [`docs/recursive-coordination.md`](docs/recursive-coordination.md) for the full surface and a worked example.

    ### Breaking

    - **`AgentDecision` is now a discriminated union** with required `type: "participate" | "delegate"`. Existing paper-style fields (`selectedRole`, `participation`, `rationale`, `contribution`) are preserved under the `participate` branch. Consumers must narrow on `decision.type === "participate"` before reading paper-style fields. (Phase 1)

    ### Migration — AgentDecision narrowing (v0.3.x → v0.4.0)

    ```ts
    // v0.3.x
    const decision: AgentDecision = await coordinator.run(...);
    console.log(decision.selectedRole, decision.contribution);

    // v0.4.0
    const decision = await coordinator.run(...);
    if (decision.type === "participate") {
      console.log(decision.selectedRole, decision.contribution);
    } else if (decision.type === "delegate") {
      // new: handle delegated sub-mission
    }
    ```

    See [`docs/recursive-coordination.md#agentdecision-narrowing`](docs/recursive-coordination.md#agentdecision-narrowing) for the full discriminator and `delegate`-branch shape.

    ### Added — `delegate` decision and sub-run traces (Phase 1)

    [MOVE EXISTING PHASE 1 BULLETS HERE VERBATIM. Currently lines 10-18 of CHANGELOG.md. Bullets:
      - Coordinator agents may emit `{ type: "delegate", protocol, intent, model?, budget? }` ...
      - New `RunEvent` variants: `sub-run-started`, `sub-run-completed`, `sub-run-failed` ...
      - Synthetic transcript entries record sub-run results ...
      - `maxDepth` option on DogpileOptions and EngineOptions ...
      - New public type `RunCallOptions` ...
      - Fenced-JSON delegate parsing convention ...
      - `Dogpile.replay()` rehydrates embedded sub-run traces + `recomputeAccountingFromTrace` ...
      - New `ReplayTraceProtocolDecisionType` literals: `start-sub-run`, `complete-sub-run`, `fail-sub-run`.
    Do NOT rewrite or condense; ONLY tag each bullet with " (Phase 1)" if not already present.]

    ### Added — Budget, cancellation, cost roll-up (Phase 2)

    [MOVE EXISTING PHASE 2 BULLETS HERE VERBATIM, preserving the four #### subsections (Cancellation propagation, Timeout/deadline propagation, Cost & token roll-up + replay parity, Termination floors). Currently lines 19-44. Each #### bullet keeps its (BUDGET-NN) requirement tag; add no new tags.]

    ### Added — Provider locality and bounded concurrency (Phase 3)

    [MOVE EXISTING PHASE 3 BULLETS HERE VERBATIM, preserving the four #### subsections (Provider locality, Bounded child concurrency, Local-provider clamp, Public-surface tests). Currently lines 46-85.]

    ### Added — Streaming and child error escalation (Phase 4)

    [PLACEHOLDER FOR Plan 04-04's batched entry. The five-item D-15 inventory:
      - **`parentRunIds: readonly string[]` on stream events** ... (Phase 4)
      - **New `aborted` lifecycle event** ... (Phase 4)
      - **`onChildFailure?: "continue" | "abort"` config option** ... (Phase 4)
      - **Optional `detail.source?: "provider" | "engine"` on `provider-timeout`** ... (Phase 4)
      - **Structured `## Sub-run failures since last decision` coordinator-prompt block** ... (Phase 4)
      - **Cancel-during-fan-out drain** ... (Phase 4)
      - **Terminate-without-final throw rule clarified** (Changed sub-bullet, not Added — see Plan 04-04's spec) (Phase 4)

    If Plan 04-04 has already run before this plan, its bullets ARE present in CHANGELOG; this restructure only re-groups them under this thematic heading. If Plan 04-04 has NOT run, leave a "[Plan 04-04 fills this section]" comment marker — but per the wave structure (Plan 04 lands BEFORE Phase 5 starts), Plan 04-04's CHANGELOG entry IS already present.]

    ### Added — Documentation and runnable example (Phase 5)

    - **`docs/recursive-coordination.md`** — new dedicated docs page: concepts, propagation rules, `parentRunIds` chain, structured failures, replay parity, "Not in v0.4.0" deferrals, canonical worked example. (Phase 5)
    - **`docs/recursive-coordination-reference.md`** — new exhaustive reference page: every `sub-run-*` event payload, every `detail.reason` value, every `RunCallOptions` field, every `DogpileError` `code`/`detail.reason` combo from v0.4.0, replay-drift error matrix, provider locality classification table. (Phase 5)
    - **`docs/developer-usage.md`** — new "Recursive coordination" section with maintenance comment cross-linking the dedicated pages. (Phase 5)
    - **`docs/reference.md`** — augmented with v0.4.0 exports (`RunCallOptions`, the seven `SubRun*Event` types, `classifyHostLocality`, `recomputeAccountingFromTrace`, new `ReplayTraceProtocolDecisionType` literals) and cross-links to the dedicated reference page. (Phase 5)
    - **`README.md` "Choose Your Path"** — new row pointing at `delegate` and `docs/recursive-coordination.md`. (Phase 5)
    - **`examples/recursive-coordination/`** — new runnable example using the deterministic provider by default and `createOpenAICompatibleProvider` in live mode. Reuses the Hugging Face upload GUI mission verbatim and wraps it in a coordinator-with-delegate. Demonstrates all v0.4.0 surfaces: parentRunIds chain, intentionally-failing child with `partialCost`, structured failures in the next coordinator turn, locality-driven concurrency clamp. (Phase 5)
    - **`examples/README.md`** — index entry mirroring the huggingface-upload-gui section format. (Phase 5)
    - **`AGENTS.md` + `CLAUDE.md`** — cross-cutting-invariants list mirrors a recursive-coordination public-surface entry. (Phase 5)

    ### Notes

    [PRESERVE EXISTING NOTES BLOCK VERBATIM. Currently lines 86-89.]

    [Original notes:
      - No package `exports` / `files` change. All new public types ship through the existing `@dogpile/sdk` root entry. ...
      - Phase 1 does not propagate cost caps, ...]

    [Append a new note for Phase 5:]
    - Documentation pages (`docs/recursive-coordination*.md`) and example artifacts (`examples/recursive-coordination/`) are repository-only — neither is added to `package.json` `files`. Released tarball payload is unchanged. (Phase 5)
    ```

    **Critical preservation rules (D-16):**

    - Every existing Phase 1/2/3 bullet's PROSE TEXT is preserved verbatim. The bullet's `(Phase N)` tag is added only if missing.
    - The four `#### Cancellation propagation` / `Timeout / deadline propagation` / `Cost & token roll-up + replay parity` / `Termination floors` headers under Phase 2 are preserved.
    - The four `#### Provider locality` / `Bounded child concurrency` / `Local-provider clamp` / `Public-surface tests` headers under Phase 3 are preserved.
    - The existing `### Notes` block is preserved (with one new Phase 5 note appended).

    **Heading lock (D-18):**

    - The top heading STAYS `## [Unreleased] — v0.4.0`. DO NOT date-stamp here. Plan 06 will date-stamp immediately before publishing per D-18.

    **Verification of preservation:**

    Use `git diff CHANGELOG.md` after the edit to confirm:
    - Lines 1-89 are restructured.
    - Lines 91+ (v0.3.1 and earlier) are UNCHANGED.
    - No bullet text from Phase 1/2/3 has been deleted, only re-grouped.
  </action>
  <verify>
    <automated>grep -c "^### Migration — AgentDecision narrowing\|^### Added — `delegate` decision and sub-run traces\|^### Added — Budget, cancellation, cost roll-up\|^### Added — Provider locality and bounded concurrency\|^### Added — Streaming and child error escalation\|^### Added — Documentation and runnable example" CHANGELOG.md</automated>
  </verify>
  <acceptance_criteria>
    - All six required thematic headings present: `grep -cE "^### (Migration — AgentDecision narrowing|Added — \\\`delegate\\\` decision and sub-run traces|Added — Budget, cancellation, cost roll-up|Added — Provider locality and bounded concurrency|Added — Streaming and child error escalation|Added — Documentation and runnable example)" CHANGELOG.md` == 6.
    - Migration heading exact text per D-17: `grep -cE "^### Migration — AgentDecision narrowing \\(v0\\.3\\.x → v0\\.4\\.0\\)" CHANGELOG.md` == 1.
    - D-17 snippet present: `grep -c "decision\\.type === \"participate\"\|decision\\.type === \"delegate\"" CHANGELOG.md` >= 2 (both branches in the snippet).
    - Cross-link to docs page anchor: `grep -c "agentdecision-narrowing" CHANGELOG.md` >= 1.
    - Heading is still `[Unreleased]`: `grep -c "^## \\[Unreleased\\] — v0\\.4\\.0" CHANGELOG.md` == 1. NOT date-stamped: `grep -c "^## \\[0\\.4\\.0\\] —" CHANGELOG.md` == 0 (Plan 06 will swap this).
    - Phase 1/2/3 bullet content preserved (sample checks, NOT exhaustive — visual inspection of git diff is the real check):
      - Phase 1 sample: `grep -c "Coordinator agents may emit\|RunEvent.*variants.*sub-run-started\|recomputeAccountingFromTrace\|RunCallOptions" CHANGELOG.md` >= 4.
      - Phase 2 sample: `grep -c "BUDGET-01\|BUDGET-02\|BUDGET-03\|BUDGET-04" CHANGELOG.md` >= 4.
      - Phase 3 sample: `grep -c "PROVIDER-01\\.\\.03\|CONCURRENCY-01\|CONCURRENCY-02\|classifyHostLocality" CHANGELOG.md` >= 4.
    - Phase 4 inventory present (assumes Plan 04-04 already ran per wave order): `grep -cE "parentRunIds|onChildFailure|detail\\.source|Sub-run failures since last decision|aborted lifecycle" CHANGELOG.md` >= 5 (the D-15 #5 inventory items from Phase 4 CONTEXT).
    - Phase 5 additions enumerated: `grep -c "docs/recursive-coordination\\.md\|docs/recursive-coordination-reference\\.md\|examples/recursive-coordination\|Choose Your Path" CHANGELOG.md` >= 4.
    - Pre-v0.4.0 entries unchanged: `grep -c "^## 0\\.3\\.1\|^## 0\\.3\\.0\|^## 0\\.2\\.2\|^## 0\\.2\\.1\|^## 0\\.2\\.0\|^## 0\\.1\\.2\|^## 0\\.1\\.1\|^## 0\\.1\\.0" CHANGELOG.md` == 8 (all existing earlier sections preserved).
    - `package.json` version UNCHANGED (still 0.3.1): `node -p "require('./package.json').version"` outputs `0.3.1`.
    - No bullet content deletions from Phase 1/2/3: cross-reference current vs new via `git diff --stat CHANGELOG.md` — additions should outnumber deletions, and a manual scan of removed lines confirms only header restructuring (no prose deletion). Concretely: `git diff CHANGELOG.md | grep -E "^-[^-]" | grep -vE "^---|^- \\*\\*Added\\b|^- \\*\\*Breaking\\b|^### Added\\b|^### Breaking\\b" | wc -l` is small (< 10) — only header lines change, not bullet prose.
  </acceptance_criteria>
  <done>
    CHANGELOG.md v0.4.0 entry is restructured to six thematic Added blocks (one per phase) plus Breaking + Migration + Notes, with all existing Phase 1/2/3 bullet text preserved. Migration subsection contains D-17's locked snippet and cross-links docs/recursive-coordination.md#agentdecision-narrowing. Heading remains `[Unreleased]` (Plan 06 owns date-stamp). package.json version unchanged.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| CHANGELOG.md ↔ npm tarball | CHANGELOG.md ships in the tarball; published to consumers as the canonical change history. |
| CHANGELOG content ↔ shipped public surface | Drift between CHANGELOG and actual exports/events is a public-surface bug per CLAUDE.md. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-10 | T (Tampering / content loss during restructure) | Phase 1/2/3 bullet text could be inadvertently deleted during cut-and-paste re-grouping | mitigate | Acceptance criterion enforces `git diff` review showing minimal prose deletions (only header lines change). Sample-grep for known phrases from each phase confirms preservation. |
| T-05-11 | I (Premature date-stamp) | Date-stamping in this plan would lock a wrong date if release slips | mitigate | Heading lock acceptance criterion: `grep "^## \[Unreleased\] — v0\.4\.0"` must remain == 1 and `grep "^## \[0\.4\.0\] —"` must remain == 0. Plan 06 owns the date-stamp swap. |

No security-relevant code changes — pure documentation phase.
</threat_model>

<verification>
- `grep -cE "^### (Migration|Added — .*\\(Phase [1-5]\\))" CHANGELOG.md` >= 6.
- Heading still `[Unreleased]`.
- All Phase 1/2/3 bullet content preserved (sample greps).
- `pnpm run typecheck && pnpm run test` green.
- `package.json` version is `0.3.1` (unchanged — Plan 06 bumps).
</verification>

<success_criteria>
- DOCS-04 (content): CHANGELOG v0.4.0 entry lists every public-surface addition: `delegate` variant, `subRun.*` events, `locality`, `maxConcurrentChildren`, `maxDepth`, plus Phase 4 additions (parentRunIds, AbortedEvent, onChildFailure, detail.source, structured failures) and Phase 5 (docs + example).
- D-16: Thematic-with-(Phase N)-tags structure.
- D-17: Migration subsection with before/after snippet + cross-link.
- D-18 (date-stamp): NOT done here — explicitly deferred to Plan 06.
</success_criteria>

<output>
After completion, create `.planning/phases/05-documentation-changelog/05-05-SUMMARY.md` recording:
- Confirmation that the heading is still `[Unreleased]` (Plan 06 will date-stamp)
- Confirmation that package.json version is unchanged
- A diff-summary showing which bullets moved between sections (and confirming none were deleted)
- The six thematic headings that now exist in v0.4.0
</output>
