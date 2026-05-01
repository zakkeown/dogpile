---
phase: 05-documentation-changelog
plan: 06
type: execute
wave: 3
depends_on: ["05-01", "05-02", "05-03", "05-04", "05-05"]
files_modified:
  - package.json
  - CHANGELOG.md
  - docs/release.md
autonomous: false
requirements: [DOCS-04]
tags: [release, version-bump, publish, changelog-datestamp]
user_setup:
  - service: github
    why: "Publishing a GitHub Release triggers the npm-publish.yml workflow which runs npm publish via Trusted Publisher OIDC."
    dashboard_config:
      - task: "Confirm npm Trusted Publisher (organization=bubstack, repository=dogpile, workflow=npm-publish.yml, environment=npm) is still configured."
        location: "https://www.npmjs.com/package/@dogpile/sdk → Settings → Trusted Publisher"
  - service: npm
    why: "Final visibility check that the published version landed."
    dashboard_config:
      - task: "Verify @dogpile/sdk@0.4.0 appears on npmjs.com after the GitHub Release workflow completes."
        location: "https://www.npmjs.com/package/@dogpile/sdk"

must_haves:
  truths:
    - "package.json version bumped from 0.3.1 to 0.4.0 (D-18)"
    - "docs/release.md version references updated from 0.3.1 to 0.4.0 (tarball name dogpile-sdk-0.4.0.tgz, release identity @dogpile/sdk@0.4.0)"
    - "CHANGELOG.md v0.4.0 heading swapped from '## [Unreleased] — v0.4.0' to '## [0.4.0] — YYYY-MM-DD' where YYYY-MM-DD is the actual publish date (D-18 — must be the actual date, not a guessed-ahead date)"
    - "package.json files allowlist verified to NOT include examples/ or docs/ (npm tarball stays slim — explicit grep gate before any publish step)"
    - "pnpm run verify completes green BEFORE the date-stamp commit and BEFORE git tag (release gate per docs/release.md)"
    - "git tag v0.4.0 created on the date-stamped commit; tag pushed to origin"
    - "GitHub Release v0.4.0 created via gh release create — this triggers .github/workflows/npm-publish.yml which runs npm publish via Trusted Publisher OIDC (per docs/release.md, NOT a direct npm publish call from a developer machine)"
    - "After publish: npm view @dogpile/sdk@0.4.0 resolves; gh run list shows the npm-publish workflow green"
    - "If publish fails or any verify gate fails, NO tag is pushed and NO GitHub Release is created — recovery is to fix the failure on a new commit and retry"
    - "This plan has autonomous: false because the GitHub Release create + npm publish OIDC verification flow involves a human-witnessed signal (workflow completion)"
  artifacts:
    - path: "package.json"
      provides: "Version bumped to 0.4.0; files allowlist unchanged."
      contains: "\"version\": \"0.4.0\""
    - path: "CHANGELOG.md"
      provides: "v0.4.0 heading date-stamped; all other content preserved from Plan 05-05's restructure."
      contains: "## [0.4.0]"
    - path: "docs/release.md"
      provides: "Version-string references bumped from 0.3.1 to 0.4.0 (tarball name, release identity)."
      contains: "0.4.0"
  key_links:
    - from: "git tag v0.4.0"
      to: ".github/workflows/npm-publish.yml"
      via: "GitHub Release published event"
      pattern: "release-validation\\.yml\\|npm-publish\\.yml"
    - from: "package.json version 0.4.0"
      to: "CHANGELOG.md ## [0.4.0] heading"
      via: "release identity must match"
      pattern: "0\\.4\\.0"
---

<objective>
Cut and ship v0.4.0 per `docs/release.md`. This is the final phase deliverable.

Sequence:

1. Pre-flight checks (files allowlist sanity; existing test green).
2. Bump `package.json` version 0.3.1 → 0.4.0 and update version strings in `docs/release.md`.
3. Run `pnpm run verify` — the release gate (identity → build → artifact check → packed quickstart smoke → typecheck → test). Must be green BEFORE date-stamp.
4. **Checkpoint** — confirm verify is green AND ready to ship today.
5. Date-stamp CHANGELOG: `## [Unreleased] — v0.4.0` → `## [0.4.0] — <today's actual date>`.
6. Commit, tag `v0.4.0`, push branch + tag.
7. `gh release create v0.4.0 --notes-from-tag` (or with explicit notes) — this triggers `.github/workflows/npm-publish.yml`.
8. Verify the publish workflow ran green and `@dogpile/sdk@0.4.0` resolves on npmjs.com.
9. Update STATE.md (and ROADMAP progress) — Phase 5 complete; v0.4.0 milestone shipped.

Purpose: ship the milestone. D-18 explicitly requires this phase to date-stamp AND publish. The autonomous: false flag is set because the publish workflow itself runs in CI and produces a human-witnessed completion signal that this plan must check.

Output: package.json + CHANGELOG.md + docs/release.md committed; git tag pushed; GitHub Release published; npm-publish workflow green; npm registry shows v0.4.0.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/phases/05-documentation-changelog/05-CONTEXT.md
@.planning/phases/05-documentation-changelog/05-05-changelog-restructure-PLAN.md
@CLAUDE.md
@docs/release.md
@package.json
@CHANGELOG.md

<interfaces>
<!-- Release pipeline (from docs/release.md): -->
//
// 1. pnpm run verify (identity → build → artifact check → packed quickstart smoke → typecheck → test)
// 2. git tag vX.Y.Z; git push --tags
// 3. gh release create vX.Y.Z (this triggers .github/workflows/npm-publish.yml)
// 4. Workflow uses Trusted Publisher OIDC (org=bubstack, repo=dogpile, workflow=npm-publish.yml, env=npm)
// 5. Verify: npm view @dogpile/sdk@X.Y.Z resolves; gh run list shows green run

<!-- package.json fields to bump: -->
//   "version": "0.3.1" → "0.4.0"

<!-- docs/release.md fields to bump (grep -n "0\\.3\\.1\|dogpile-sdk-0\\.3\\.1" docs/release.md): -->
//   "release identity is `@dogpile/sdk@0.3.1`" → "@dogpile/sdk@0.4.0"
//   "tarball is named `dogpile-sdk-0.3.1.tgz`" → "dogpile-sdk-0.4.0.tgz"
//   any install-command examples that reference 0.3.1
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Pre-flight — verify files allowlist excludes examples/ and docs/, and confirm working tree is clean</name>
  <files>(read-only audit)</files>
  <read_first>
    - package.json (lines 109-166 — files allowlist)
    - docs/release.md (entire file — confirm release procedure)
  </read_first>
  <action>
    Run a sequence of read-only sanity checks BEFORE any version-bump work:

    ```sh
    # (a) Files allowlist must NOT include examples/ or docs/.
    node -e "const f=require('./package.json').files; const bad=f.filter(x=>x.startsWith('examples/')||x.startsWith('docs/')); if(bad.length){console.error('FAIL: forbidden paths in files allowlist:',bad); process.exit(1)} else {console.log('OK: files allowlist excludes examples/ and docs/')}"

    # (b) Working tree clean (or at least: no uncommitted changes to release-critical files).
    git status --porcelain package.json CHANGELOG.md docs/release.md

    # (c) Current version is 0.3.1.
    node -p "require('./package.json').version"

    # (d) Plans 05-01..05-05 SUMMARY files exist (sanity that this is wave 3, not running prematurely).
    ls .planning/phases/05-documentation-changelog/05-0{1,2,3,4,5}-SUMMARY.md
    ```

    All four checks must pass. If (a) fails, abort: examples/ or docs/ in files allowlist is a regression and must be fixed before publish. If (d) fails, this plan is being run out of wave order — abort and complete prior plans.
  </action>
  <verify>
    <automated>node -e "const f=require('./package.json').files; if(f.some(x=>x.startsWith('examples/')||x.startsWith('docs/')))process.exit(1)" && test "$(node -p 'require(\"./package.json\").version')" = "0.3.1"</automated>
  </verify>
  <acceptance_criteria>
    - `node -e "const f=require('./package.json').files; if(f.some(x=>x.startsWith('examples/')||x.startsWith('docs/')))process.exit(1)"` exits 0.
    - `node -p "require('./package.json').version"` outputs `0.3.1` (pre-bump).
    - All five SUMMARY files from prior Phase 5 plans exist: `ls .planning/phases/05-documentation-changelog/05-01-SUMMARY.md .planning/phases/05-documentation-changelog/05-02-SUMMARY.md .planning/phases/05-documentation-changelog/05-03-SUMMARY.md .planning/phases/05-documentation-changelog/05-04-SUMMARY.md .planning/phases/05-documentation-changelog/05-05-SUMMARY.md` exits 0.
    - Working tree has no uncommitted changes to release-critical files OR has only the expected restructure changes from Plan 05-05.
  </acceptance_criteria>
  <done>
    Pre-flight green: files allowlist correctly excludes examples/ and docs/; current version is 0.3.1; all prior Phase 5 SUMMARYs exist.
  </done>
</task>

<task type="auto">
  <name>Task 2: Bump package.json version 0.3.1 → 0.4.0 and update docs/release.md version strings</name>
  <files>package.json, docs/release.md</files>
  <read_first>
    - package.json (line 3 for version field)
    - docs/release.md (entire file — locate every reference to `0.3.1` or `dogpile-sdk-0.3.1`)
  </read_first>
  <action>
    **package.json:**

    Edit only the `version` field:

    ```diff
    - "version": "0.3.1",
    + "version": "0.4.0",
    ```

    Do NOT modify any other field — `files` allowlist, `exports`, `scripts` all stay as-is.

    **docs/release.md:**

    Find every occurrence of `0.3.1` and `dogpile-sdk-0.3.1` and bump to `0.4.0` / `dogpile-sdk-0.4.0`. Reading lines 44-60 and 105-107 of the current docs/release.md identifies these references:

    - "The local tarball is named `dogpile-sdk-0.3.1.tgz`" → "dogpile-sdk-0.4.0.tgz"
    - "scoped package `@dogpile/sdk@0.3.1`" → "@dogpile/sdk@0.4.0"
    - All install-command examples (`pnpm add ../dogpile/packed/dogpile-sdk-0.3.1.tgz`, etc.) → `dogpile-sdk-0.4.0.tgz`
    - "The release identity is `@dogpile/sdk@0.3.1`" → "@dogpile/sdk@0.4.0"

    Use `grep -n "0\\.3\\.1\|dogpile-sdk-0\\.3\\.1" docs/release.md` to enumerate sites; bump each in place.
  </action>
  <verify>
    <automated>test "$(node -p 'require(\"./package.json\").version')" = "0.4.0" && grep -c "0\\.3\\.1\\|dogpile-sdk-0\\.3\\.1" docs/release.md | awk '$1==0{exit 0} {exit 1}'</automated>
  </verify>
  <acceptance_criteria>
    - `node -p "require('./package.json').version"` outputs `0.4.0`.
    - `grep -c "0\\.3\\.1\|dogpile-sdk-0\\.3\\.1" docs/release.md` == 0 (every old version reference bumped).
    - `grep -c "0\\.4\\.0\|dogpile-sdk-0\\.4\\.0" docs/release.md` >= 4 (at least the four bumped sites: tarball name, release identity, install command examples).
    - No other package.json field changed: `git diff package.json | grep -E "^[+-][^+-]" | grep -vE '"version":' | wc -l` == 0.
  </acceptance_criteria>
  <done>
    package.json version is 0.4.0; docs/release.md version strings all bumped to 0.4.0; no other fields touched.
  </done>
</task>

<task type="auto">
  <name>Task 3: Run pnpm run verify — release gate before date-stamp</name>
  <files>(no edits — gate run only)</files>
  <read_first>
    - docs/release.md (release verification section, lines 62-103 — what each gate proves)
    - package.json scripts.verify
  </read_first>
  <action>
    Run the release gate:

    ```sh
    pnpm run verify
    ```

    This runs: package:identity → build → package:artifacts → quickstart:smoke (skip-build) → typecheck → test.

    **Failure handling:**

    - If any gate fails, abort. Do NOT proceed to date-stamp / tag / publish. Diagnose:
      - `package:identity` — likely the version bump didn't propagate to a file the identity check reads. Update.
      - `package:artifacts` — files allowlist references an emitted file that the build did not produce. Investigate.
      - `quickstart:smoke` — the packed tarball failed downstream consumer import. Investigate.
      - `typecheck` / `test` — a Phase 4 or Phase 5 docs sync introduced a regression. Investigate (likely a stale doc-comment that broke a public-surface assertion test).
    - Fix the failure on a NEW commit, then re-run `pnpm run verify`.

    Do NOT proceed past this task until verify is green.
  </action>
  <verify>
    <automated>pnpm run verify</automated>
  </verify>
  <acceptance_criteria>
    - `pnpm run verify` exits 0.
    - The verify command exercises all six gates (identity → build → artifacts → quickstart smoke → typecheck → test).
    - No console errors or warnings about missing files / failed assertions.
  </acceptance_criteria>
  <done>
    pnpm run verify is green with version 0.4.0. Release gate passed.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Human checkpoint — confirm ready to ship today</name>
  <what-built>
    pnpm run verify is green with version 0.4.0. CHANGELOG is restructured but still reads `## [Unreleased] — v0.4.0`. The next step date-stamps the CHANGELOG with TODAY's date and creates a tag — once tagged and the GitHub Release is published, npm publish runs via OIDC and is irreversible (the version is forever).
  </what-built>
  <how-to-verify>
    Confirm:

    1. The verify gate output (Task 3) was green.
    2. Today is the date you want stamped on the v0.4.0 CHANGELOG heading. (D-18 says the heading must be the actual publish date — if you can't ship today, abort and re-run this plan on the day you ship.)
    3. The npm Trusted Publisher configuration on npmjs.com (`@dogpile/sdk` → Settings → Trusted Publisher) still lists organization=bubstack, repository=dogpile, workflow=npm-publish.yml, environment=npm.
    4. The GitHub `npm` environment for the publishing workflow is configured (or release review is acceptable to be auto-approved).

    Reply `ship` to proceed with date-stamp + tag + GitHub Release. Reply with anything else to abort and re-run later.
  </how-to-verify>
  <resume-signal>Type "ship" to proceed with the date-stamp, tag, and GitHub Release.</resume-signal>
</task>

<task type="auto">
  <name>Task 5: Date-stamp CHANGELOG and commit version bump + restructure + date-stamp together</name>
  <files>CHANGELOG.md</files>
  <read_first>
    - CHANGELOG.md (line 3 — current `## [Unreleased] — v0.4.0` heading)
    - .planning/phases/05-documentation-changelog/05-CONTEXT.md (D-18 — heading must be actual publish date)
  </read_first>
  <action>
    **Date-stamp:**

    ```diff
    - ## [Unreleased] — v0.4.0
    + ## [0.4.0] — YYYY-MM-DD
    ```

    Where `YYYY-MM-DD` is TODAY's date (the date the human approved in Task 4). Capture the actual date dynamically:

    ```sh
    TODAY=$(date -u +%Y-%m-%d)
    ```

    Then sed-equivalent: replace `## [Unreleased] — v0.4.0` with `## [0.4.0] — $TODAY` exactly once (verify only one match exists first).

    **Commit:**

    Stage `package.json`, `CHANGELOG.md`, `docs/release.md`. Commit with conventional message:

    ```sh
    git add package.json CHANGELOG.md docs/release.md
    git commit -m "$(cat <<'EOF'
    chore(release): cut v0.4.0

    Recursive coordination milestone. See CHANGELOG.md for the public-surface
    inventory across Phases 1-5.
    EOF
    )"
    ```

    Verify the commit landed cleanly: `git log -1 --pretty=oneline` shows the new commit.
  </action>
  <verify>
    <automated>grep -cE "^## \\[0\\.4\\.0\\] — [0-9]{4}-[0-9]{2}-[0-9]{2}" CHANGELOG.md</automated>
  </verify>
  <acceptance_criteria>
    - `grep -cE "^## \\[0\\.4\\.0\\] — [0-9]{4}-[0-9]{2}-[0-9]{2}" CHANGELOG.md` == 1.
    - `grep -c "^## \\[Unreleased\\] — v0\\.4\\.0" CHANGELOG.md` == 0 (heading swapped).
    - The date in the heading equals today's UTC date: `grep -E "^## \\[0\\.4\\.0\\]" CHANGELOG.md | grep -c "$(date -u +%Y-%m-%d)"` == 1.
    - `git log -1 --pretty=%s` matches `chore(release): cut v0.4.0`.
    - `git diff HEAD~1..HEAD --name-only` lists exactly: package.json, CHANGELOG.md, docs/release.md.
  </acceptance_criteria>
  <done>
    CHANGELOG v0.4.0 heading is date-stamped with today's UTC date; commit lands with the version bump, restructure (already in tree from Plan 05-05), and date-stamp combined.
  </done>
</task>

<task type="auto">
  <name>Task 6: Tag v0.4.0; push branch + tag; create GitHub Release (triggers npm publish workflow)</name>
  <files>(no file edits — git ops only)</files>
  <read_first>
    - docs/release.md (Automated npm Publishing section — lines 132-168)
    - .github/workflows/npm-publish.yml (read; confirm trigger event and Trusted Publisher OIDC config)
  </read_first>
  <action>
    **Create the tag:**

    ```sh
    git tag -a v0.4.0 -m "v0.4.0 — Recursive Coordination"
    ```

    **Push branch + tag:**

    ```sh
    git push origin main
    git push origin v0.4.0
    ```

    **Create GitHub Release (this triggers npm publish via OIDC per docs/release.md):**

    Generate release notes from the CHANGELOG v0.4.0 section. The simplest approach is to extract the section between `## [0.4.0]` and the next `## ` heading:

    ```sh
    awk '/^## \[0\.4\.0\]/{flag=1; next} /^## /{if(flag) exit} flag' CHANGELOG.md > /tmp/v0.4.0-release-notes.md

    gh release create v0.4.0 \
      --title "v0.4.0 — Recursive Coordination" \
      --notes-file /tmp/v0.4.0-release-notes.md
    ```

    `gh release create` with the published event triggers `.github/workflows/npm-publish.yml`. The workflow runs `pnpm run publish:check` and then `npm publish --access public` via Trusted Publisher OIDC.

    **Do NOT run `npm publish` directly.** docs/release.md is explicit: publishing is automated via GitHub Actions OIDC, not a direct developer-machine call. The first manual publish was handled at v0.1.0; every release since uses the workflow.
  </action>
  <verify>
    <automated>git rev-parse v0.4.0 && gh release view v0.4.0 --json tagName -q .tagName | grep -q "^v0.4.0$"</automated>
  </verify>
  <acceptance_criteria>
    - `git rev-parse v0.4.0` exits 0 (tag exists locally).
    - `git ls-remote --tags origin v0.4.0 | wc -l` >= 1 (tag pushed to origin).
    - `gh release view v0.4.0 --json tagName -q .tagName` outputs `v0.4.0`.
    - `gh release view v0.4.0 --json body -q .body | wc -c` >= 500 (release notes are non-empty and substantial).
    - `gh release view v0.4.0 --json isDraft -q .isDraft` outputs `false` (release is published, which triggers the npm-publish workflow).
  </acceptance_criteria>
  <done>
    Tag v0.4.0 pushed; GitHub Release v0.4.0 published; npm-publish.yml workflow triggered.
  </done>
</task>

<task type="auto">
  <name>Task 7: Verify npm-publish workflow green and @dogpile/sdk@0.4.0 resolves on npmjs.com</name>
  <files>(no edits — verification only)</files>
  <read_first>
    - .github/workflows/npm-publish.yml (confirm step list)
    - docs/release.md (Required CI Status Checks list — lines 116-130)
  </read_first>
  <action>
    Wait for the publish workflow to complete, then verify:

    ```sh
    # Watch the most recent npm-publish workflow run.
    gh run list --workflow=npm-publish.yml --limit 1
    gh run watch  # or: gh run view --log on the run id

    # Once green, verify the published version on npmjs.com.
    npm view @dogpile/sdk@0.4.0 version
    npm view @dogpile/sdk dist-tags.latest
    ```

    `npm view @dogpile/sdk@0.4.0 version` must output `0.4.0`. `npm view @dogpile/sdk dist-tags.latest` must output `0.4.0` (the new release becomes latest).

    If the workflow fails:

    - Read the failure log: `gh run view <run-id> --log-failed`.
    - Common failure modes: identity mismatch (version-string drift in some file the identity check reads), publish:check artifact gate failed, OIDC token misconfigured.
    - Recovery: do NOT delete the tag (the version is now "claimed" — re-publishing the same version is impossible). Either patch with v0.4.1 or fix the workflow on a follow-up. Document the failure mode in the SUMMARY.

    On success: the milestone is shipped.
  </action>
  <verify>
    <automated>npm view @dogpile/sdk@0.4.0 version | grep -q "^0.4.0$"</automated>
  </verify>
  <acceptance_criteria>
    - `gh run list --workflow=npm-publish.yml --limit 1 --json conclusion -q '.[0].conclusion'` outputs `success`.
    - `npm view @dogpile/sdk@0.4.0 version` outputs `0.4.0`.
    - `npm view @dogpile/sdk dist-tags.latest` outputs `0.4.0`.
    - `npm view @dogpile/sdk@0.4.0 dist.tarball` returns a URL containing `dogpile-sdk-0.4.0.tgz`.
  </acceptance_criteria>
  <done>
    npm-publish.yml workflow ran green; @dogpile/sdk@0.4.0 is published on npmjs.com and is dist-tags.latest.
  </done>
</task>

<task type="auto">
  <name>Task 8: Update STATE.md and ROADMAP.md to reflect milestone shipped</name>
  <files>.planning/STATE.md, .planning/ROADMAP.md</files>
  <read_first>
    - .planning/STATE.md (entire file — current status, progress block, decisions)
    - .planning/ROADMAP.md (Progress table at lines 104-112 and Phase 5 detail at lines 92-102)
    - .planning/REQUIREMENTS.md (DOCS-01..04 status rows at lines 106-109)
  </read_first>
  <action>
    **STATE.md:**

    Update:

    - `status:` field → `Phase 5 complete; v0.4.0 shipped to npm on YYYY-MM-DD`
    - `last_updated:` → today's UTC date-time
    - `last_activity:` → today's UTC date
    - `progress.completed_phases: 5`, `total_plans: <total including phase 5>`, `completed_plans: <same>`, `percent: 100`
    - `## Current Position` → `Phase: complete; v0.4.0 shipped`
    - `### Decisions` — append a Phase 5 line summarizing the docs/example/changelog/release shipped
    - `### Todos` — clear (all phase 5 todos done)
    - `### Blockers` — (none)
    - `## Session Continuity` `**Next action:**` → "v0.4.0 shipped. Define next milestone or work on follow-ups (caller-defined trees, OTEL bridge, etc. — see REQUIREMENTS.md Future Requirements)."

    **ROADMAP.md:**

    Update Progress table (lines 104-112):

    - Row "5. Documentation & Changelog": `| 5/5 | Complete | YYYY-MM-DD |` (or however many plans landed — count `ls .planning/phases/05-documentation-changelog/*-PLAN.md`).
    - Update Phase 5 section header: `- [x] **Phase 5: Documentation & Changelog**` (was `- [ ]`).
    - Update Plans list under Phase 5 (lines 102+): mark each `- [ ]` entry as `- [x]` for the six plans this phase produced.

    **REQUIREMENTS.md (lines 106-109):**

    Mark all four DOCS-* requirements as `[x] Complete`:

    ```markdown
    - [x] **DOCS-01** ...
    - [x] **DOCS-02** ...
    - [x] **DOCS-03** ...
    - [x] **DOCS-04** ...
    ```

    And update Traceability table rows for DOCS-01..04 from `Pending` to `Complete`.

    **Commit:**

    ```sh
    git add .planning/STATE.md .planning/ROADMAP.md .planning/REQUIREMENTS.md
    git commit -m "$(cat <<'EOF'
    docs(planning): close out v0.4.0 milestone

    Phase 5 shipped; DOCS-01..04 complete; @dogpile/sdk@0.4.0 published.
    EOF
    )"
    git push origin main
    ```
  </action>
  <verify>
    <automated>grep -c "Phase 5 complete\|v0.4.0 shipped" .planning/STATE.md && grep -c "^- \[x\] \\*\\*Phase 5" .planning/ROADMAP.md</automated>
  </verify>
  <acceptance_criteria>
    - STATE.md status reflects v0.4.0 shipped: `grep -c "v0.4.0 shipped\|Phase 5 complete" .planning/STATE.md` >= 1.
    - STATE.md progress block: `completed_phases: 5` and `percent: 100` present.
    - ROADMAP.md Phase 5 marked complete: `grep -c "^- \[x\] \\*\\*Phase 5" .planning/ROADMAP.md` == 1.
    - ROADMAP.md Progress table row for Phase 5 reads "Complete" with a date: `awk '/5\\. Documentation & Changelog/{print}' .planning/ROADMAP.md | grep -c "Complete"` == 1.
    - REQUIREMENTS.md DOCS-01..04 marked complete: `grep -cE "^- \\[x\\] \\*\\*DOCS-0[1-4]\\*\\*" .planning/REQUIREMENTS.md` == 4.
    - Commit pushed to main.
  </acceptance_criteria>
  <done>
    STATE.md, ROADMAP.md, and REQUIREMENTS.md reflect v0.4.0 milestone complete; all DOCS-* requirements marked Complete; commit pushed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Developer machine ↔ npm registry | `npm publish` itself happens in CI via OIDC; the developer's machine never holds an npm token. |
| GitHub Release ↔ workflow trigger | A published GitHub Release is the publish trigger; an inadvertently published draft would fire the workflow. |
| package.json files allowlist ↔ tarball payload | A regression that adds examples/ or docs/ to files would bloat the published tarball. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-12 | E (Elevation of Privilege / supply-chain) | Direct `npm publish` from a developer machine bypassing OIDC | mitigate | Plan explicitly forbids direct `npm publish`. Action text says: "Do NOT run `npm publish` directly. docs/release.md is explicit: publishing is automated via GitHub Actions OIDC." Workflow uses Trusted Publisher (org=bubstack, repo=dogpile, workflow=npm-publish.yml, env=npm). |
| T-05-13 | I (Information disclosure / supply-chain bloat) | Files allowlist regression including examples/ or docs/ | mitigate | Pre-flight Task 1 verifies `node -e` script blocking examples/ and docs/. `pnpm run verify` (Task 3) reruns `package:artifacts` which independently confirms allowlist sanity. |
| T-05-14 | T (Tampering / wrong date stamp) | Date-stamping ahead of actual publish date | mitigate | Task 5 captures `date -u +%Y-%m-%d` dynamically AT date-stamp time, after the human approval checkpoint (Task 4). The CHANGELOG date matches the actual commit/publish day. |
| T-05-15 | I (Premature publish) | Tagging before verify is green | mitigate | Task 3 (verify) is sequential and blocking; Task 4 (human checkpoint) gates Task 5 (date-stamp + commit) and Task 6 (tag + push). No tag is created if verify fails. |
| T-05-16 | R (Repudiation / failed publish recovery) | Tag pushed but workflow fails to publish | accept | If publish fails, the version is "claimed" on npm; recovery is a follow-up patch (v0.4.1). Action text instructs to NOT delete the tag and to document the failure. |

The release procedure relies on docs/release.md's Trusted Publisher (bubstack/dogpile/npm-publish.yml/env=npm). Credentials are out of scope for the SDK; release plan defers to docs/release.md.
</threat_model>

<verification>
- `node -p "require('./package.json').version"` outputs `0.4.0`.
- `git rev-parse v0.4.0` returns a commit hash.
- `git ls-remote --tags origin v0.4.0` shows the tag pushed.
- `gh release view v0.4.0 --json isDraft -q .isDraft` outputs `false`.
- `gh run list --workflow=npm-publish.yml --limit 1 --json conclusion -q '.[0].conclusion'` outputs `success`.
- `npm view @dogpile/sdk@0.4.0 version` outputs `0.4.0`.
- `npm view @dogpile/sdk dist-tags.latest` outputs `0.4.0`.
- STATE.md, ROADMAP.md, REQUIREMENTS.md reflect milestone complete.
</verification>

<success_criteria>
- DOCS-04 (closure): CHANGELOG.md ## [0.4.0] is date-stamped, the version is published to npm, and STATE.md / ROADMAP.md / REQUIREMENTS.md mark the milestone complete.
- D-18 (release cut): version bump + verify gate + date-stamp + tag + GitHub Release + workflow green + npm view confirms 0.4.0 + Trusted Publisher (`bubstack`) confirmation.
- v0.4.0 — Recursive Coordination — shipped.
</success_criteria>

<output>
After completion, create `.planning/phases/05-documentation-changelog/05-06-SUMMARY.md` recording:
- The actual publish date (CHANGELOG heading)
- The git tag SHA and the GitHub Release URL
- The npm-publish workflow run ID and conclusion
- `npm view @dogpile/sdk@0.4.0 dist.tarball` URL
- Any deviation from docs/release.md procedure (and why)
- Confirmation that .planning files were updated for milestone closure
</output>
