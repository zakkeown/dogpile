---
phase: 05-documentation-changelog
plan: 04
type: execute
wave: 2
depends_on: ["05-01", "05-03"]
files_modified:
  - README.md
  - examples/README.md
autonomous: true
requirements: [DOCS-03]
tags: [readme, discoverability, examples-index]

must_haves:
  truths:
    - "README.md 'Choose Your Path' table (lines 67-75) gains exactly ONE new row at the END of the table (D-14: append after the openai-compat row)"
    - "The new row's left column reads exactly: 'Run a coordinator that fans out into other Dogpile runs' (D-13 wording lock)"
    - "The new row's right column references both the delegate decision AND docs/recursive-coordination.md: backtick-`delegate` decision; backtick-`docs/recursive-coordination.md` (D-13 wording lock)"
    - "examples/README.md gains a new full subsection mirroring the existing 'Hugging Face Upload GUI Plans' subsection format (D-15): H2 header, one-paragraph description, ## Run-style code block, env-var note, artifact directory note"
    - "The examples/README.md subsection points at examples/recursive-coordination/run.mjs and notes that the same OPENAI_API_KEY/DOGPILE_EXAMPLE_PROVIDER env-var contract is supported (mirror)"
    - "examples/README.md preserves the existing 'Hugging Face Upload GUI Plans' section unchanged (no churn — D-14 minimization mindset applied)"
    - "README.md preserves the existing 6 rows unchanged; only ONE new row is appended"
    - "package.json files allowlist UNCHANGED (README.md is already shipped; examples/README.md is repo-only)"
  artifacts:
    - path: "README.md"
      provides: "Choose Your Path table now lists the recursive-coordination row pointing at delegate + docs/recursive-coordination.md."
      contains: "Run a coordinator that fans out into other Dogpile runs"
    - path: "examples/README.md"
      provides: "Examples-index entry for recursive-coordination mirroring the huggingface-upload-gui subsection format."
      contains: "Recursive coordination"
  key_links:
    - from: "README.md Choose Your Path table"
      to: "docs/recursive-coordination.md"
      via: "right-column code-styled link"
      pattern: "recursive-coordination\\.md"
    - from: "examples/README.md"
      to: "examples/recursive-coordination/run.mjs"
      via: "code block run command"
      pattern: "examples/recursive-coordination/run\\.mjs"
---

<objective>
Cross-doc discoverability: developers landing on either README find recursive coordination.

- **`README.md` Choose Your Path table (DOCS-03):** Append exactly one row at the end of the table per D-13/D-14. Wording is locked: left column "Run a coordinator that fans out into other Dogpile runs"; right column "`delegate` decision; `docs/recursive-coordination.md`".
- **`examples/README.md` (D-15):** Add a new H2 subsection for `examples/recursive-coordination/` mirroring the huggingface-upload-gui section format (one-paragraph description, run command, env-var note, artifact directory note).

Purpose: minimal-churn cross-doc updates that point developers at the docs page (Plan 05-01) and the runnable example (Plan 05-03). This plan depends on those existing.

Output: two file edits. No source changes; no tests touched.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/05-documentation-changelog/05-CONTEXT.md
@.planning/phases/05-documentation-changelog/05-01-recursive-coordination-docs-PLAN.md
@.planning/phases/05-documentation-changelog/05-03-recursive-coordination-example-PLAN.md
@CLAUDE.md
@README.md
@examples/README.md
@examples/huggingface-upload-gui/README.md
@docs/recursive-coordination.md
@examples/recursive-coordination/README.md

<interfaces>
<!-- Existing README.md "Choose Your Path" table (lines 67-75): -->
//
// | Need | Start here |
// | --- | --- |
// | Run one coordinated mission | `Dogpile.pile({ intent, model })` |
// | Keep a UI or log view live | `Dogpile.stream({ intent, model })` |
// | Compare coordination strategies | Pick `sequential`, `broadcast`, `shared`, or `coordinator` |
// | Reuse fixed settings across many runs | `Dogpile.createEngine({ protocol, tier, model })` |
// | Save and reload a completed run | Persist `result.trace`, then call `Dogpile.replay(trace)` |
// | Use direct HTTP with OpenAI-compatible servers | `createOpenAICompatibleProvider(options)` |

<!-- D-13 locked wording for the new row: -->
//   left:  Run a coordinator that fans out into other Dogpile runs
//   right: `delegate` decision; `docs/recursive-coordination.md`

<!-- Existing examples/README.md structure (extract from current file): -->
//   # Dogpile Examples
//   ## Hugging Face Upload GUI Plans
//     [paragraph describing protocol comparison]
//     [run command code block]
//     [live-mode env-var code block]
//     [optional endpoint overrides bullet list]
//     [results path note]
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Append recursive-coordination row to README.md "Choose Your Path" table (D-13 + D-14)</name>
  <files>README.md</files>
  <read_first>
    - README.md (entire file — confirm exact current state of the Choose Your Path table at lines 67-75; preserve all existing rows verbatim)
    - .planning/phases/05-documentation-changelog/05-CONTEXT.md (D-13 wording lock; D-14 placement lock)
    - docs/recursive-coordination.md (just authored — confirm the link target exists)
  </read_first>
  <action>
    Locate the "Choose Your Path" table in `README.md` (currently lines 67-75 per CONTEXT). The current LAST row is:

    ```markdown
    | Use direct HTTP with OpenAI-compatible servers | `createOpenAICompatibleProvider(options)` |
    ```

    Append exactly ONE new row IMMEDIATELY AFTER it (D-14: end of table):

    ```markdown
    | Run a coordinator that fans out into other Dogpile runs | `delegate` decision; [`docs/recursive-coordination.md`](docs/recursive-coordination.md) |
    ```

    **Wording rules (D-13 lock):**

    - Left column: literal string `Run a coordinator that fans out into other Dogpile runs` — no rewording.
    - Right column: must contain both `` `delegate` decision `` AND a link to `docs/recursive-coordination.md`. The link uses the markdown link form so it's clickable on GitHub and on npm's package page; the link text is the path itself in code style for visual parity with the rest of the table.

    **Constraints:**

    - DO NOT modify any existing rows in the table.
    - DO NOT modify any other section of README.md.
    - Total diff size: 1 added line (the new row); 0 deleted lines.
  </action>
  <verify>
    <automated>grep -c "Run a coordinator that fans out into other Dogpile runs" README.md</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "Run a coordinator that fans out into other Dogpile runs" README.md` == 1.
    - The new row references both delegate AND docs/recursive-coordination.md: `grep -c "Run a coordinator.*delegate.*recursive-coordination" README.md` == 1 (single line — table row is one line).
    - The new row appears AFTER the openai-compat row: `awk '/createOpenAICompatibleProvider/{p=NR} /Run a coordinator that fans out/{r=NR} END{exit !(p<r)}' README.md` exits 0 (D-14).
    - The row is the LAST row in the Choose Your Path table: the line immediately after the new row is either blank or a non-table line (next H2 section). Verify: `awk '/Run a coordinator that fans out/{getline next; if(next ~ /^\\|/) exit 1} END{exit 0}' README.md` exits 0.
    - No deletions from existing table: `grep -c "Run one coordinated mission\|Keep a UI or log view live\|Compare coordination strategies\|Reuse fixed settings across many runs\|Save and reload a completed run\|Use direct HTTP with OpenAI-compatible servers" README.md` == 6 (all six original rows preserved).
    - `package.json` `files` allowlist UNCHANGED.
  </acceptance_criteria>
  <done>
    README.md "Choose Your Path" table has exactly one new row (the seventh) appended at the end with D-13's locked wording, pointing at delegate + docs/recursive-coordination.md. All six original rows preserved.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add recursive-coordination subsection to examples/README.md (D-15 mirror)</name>
  <files>examples/README.md</files>
  <read_first>
    - examples/README.md (entire file — extract the exact section structure of "Hugging Face Upload GUI Plans" to mirror)
    - examples/huggingface-upload-gui/README.md (sibling-level format match)
    - examples/recursive-coordination/README.md (just authored — confirm the run command, env vars, results path)
    - .planning/phases/05-documentation-changelog/05-CONTEXT.md (D-15 — full subsection mirroring huggingface format)
  </read_first>
  <action>
    Edit `examples/README.md`. Append a NEW H2 subsection AFTER the existing "Hugging Face Upload GUI Plans" section. Preserve everything else unchanged.

    The new subsection mirrors the huggingface section format. Insert at the end of the file:

    ```markdown

    ## Recursive Coordination — Hugging Face Upload GUI Plan, with Delegation

    `recursive-coordination/run.mjs` reuses the Hugging Face upload GUI planning mission and wraps it in a coordinator-with-delegate. Where the huggingface example compares the four protocols head-to-head, this example shows what changes when one of those coordinator runs *delegates* into a sub-mission of its own.

    Run it from the repository root after building:

    ```sh
    pnpm run build
    node examples/recursive-coordination/run.mjs
    ```

    The default provider is local and deterministic. It produces a repeatable mix of `delegate` decisions (including one intentionally-failing child and one local-provider clamp pass) so all of the v0.4.0 recursive-coordination surfaces (`sub-run-*` events, `parentRunIds` chain, structured failures, locality auto-clamp) are observable without spending API tokens. To use a live OpenAI-compatible endpoint instead, set:

    ```sh
    DOGPILE_EXAMPLE_PROVIDER=openai-compatible \
    DOGPILE_EXAMPLE_MODEL=gpt-4.1-mini \
    OPENAI_API_KEY=... \
    node examples/recursive-coordination/run.mjs
    ```

    Optional endpoint overrides:

    - `DOGPILE_EXAMPLE_BASE_URL`
    - `DOGPILE_EXAMPLE_PATH`

    The script writes comparison artifacts to `examples/recursive-coordination/results/`. See [`examples/recursive-coordination/README.md`](./recursive-coordination/README.md) for the full surface-by-surface walkthrough and [`docs/recursive-coordination.md`](../docs/recursive-coordination.md) for concepts.
    ```

    **Mirror rules (D-15):**

    - Same H2-then-paragraph-then-`## Run`-style-code-block-then-env-var-block-then-overrides-bullet-then-results-path-note structure as the existing "Hugging Face Upload GUI Plans" section.
    - Same env-var names as huggingface (DOGPILE_EXAMPLE_PROVIDER, DOGPILE_EXAMPLE_MODEL, OPENAI_API_KEY, DOGPILE_EXAMPLE_BASE_URL, DOGPILE_EXAMPLE_PATH).
    - Cross-link the example's own README and the docs page.
    - Preserve the existing "Hugging Face Upload GUI Plans" section EXACTLY — no edits to it.
  </action>
  <verify>
    <automated>grep -c "^## Recursive Coordination\|^## Hugging Face Upload GUI Plans" examples/README.md</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "^## Recursive Coordination" examples/README.md` == 1.
    - The huggingface section is preserved: `grep -c "^## Hugging Face Upload GUI Plans" examples/README.md` == 1.
    - Recursive section appears AFTER huggingface section: `awk '/^## Hugging Face Upload GUI Plans/{h=NR} /^## Recursive Coordination/{r=NR} END{exit !(h<r)}' examples/README.md` exits 0.
    - All five env-var names mentioned: `grep -c "DOGPILE_EXAMPLE_PROVIDER\|DOGPILE_EXAMPLE_MODEL\|OPENAI_API_KEY\|DOGPILE_EXAMPLE_BASE_URL\|DOGPILE_EXAMPLE_PATH" examples/README.md` >= 5 (mirrors huggingface).
    - Cross-link to example README: `grep -c "recursive-coordination/README\\.md\|recursive-coordination/run\\.mjs" examples/README.md` >= 1.
    - Cross-link to docs page: `grep -c "docs/recursive-coordination" examples/README.md` >= 1.
    - Results path noted: `grep -c "results/" examples/README.md` >= 2 (one for huggingface, one for recursive).
    - `package.json` `files` allowlist UNCHANGED.
  </acceptance_criteria>
  <done>
    examples/README.md has a new H2 "Recursive Coordination" subsection appended after the huggingface subsection, mirroring the huggingface format (description + run + env-vars + overrides + results path) per D-15.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| README.md ↔ npm tarball | README.md ships in the tarball; broken/dangling links visible to consumers. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-08 | T (Tampering / dangling link) | New "Choose Your Path" row links to docs/recursive-coordination.md | mitigate | Plan 05-04 depends on Plan 05-01 (`depends_on: ["05-01"]`); the link target is guaranteed to exist before this plan runs. Acceptance criterion implicitly verifies via the depends-on edge. |
| T-05-09 | T (Cross-doc inconsistency) | examples/README.md env vars drift from the example script's actual env reads | mitigate | Acceptance criterion enforces all five env-var names match the huggingface mirror, which match Plan 05-03's run.mjs. |

No security-relevant code changes — pure documentation phase.
</threat_model>

<verification>
- `grep -c "Run a coordinator that fans out into other Dogpile runs" README.md` == 1.
- `grep -c "^## Recursive Coordination" examples/README.md` == 1.
- All cross-links resolve to files that exist (Plan 05-01 + 05-03 dependencies).
- `pnpm run typecheck && pnpm run test` remain green.
- `package.json` `files` UNCHANGED.
</verification>

<success_criteria>
- DOCS-03: README "Choose Your Path" table gains a row pointing at `delegate` / recursive coordination with D-13 locked wording at the END of the table per D-14.
- D-15: examples/README.md mirrors the huggingface subsection format for the new example.
- Existing docs/tables preserved unchanged.
</success_criteria>

<output>
After completion, create `.planning/phases/05-documentation-changelog/05-04-SUMMARY.md` recording:
- Exact line ranges modified in README.md and examples/README.md
- Confirmation that all link targets resolve
- Confirmation that existing rows / sections were preserved unchanged
</output>
