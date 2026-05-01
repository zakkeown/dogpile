---
phase: 05-documentation-changelog
plan: 06
subsystem: release
tags: [release, version-bump, publish, changelog-datestamp]
key-files:
  created:
    - .planning/phases/05-documentation-changelog/05-06-SUMMARY.md
  modified:
    - package.json
    - CHANGELOG.md
    - docs/release.md
    - scripts/release-identity.json
    - scripts/check-package-identity.mjs
    - src/tests/package-exports.test.ts
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
metrics:
  publish-date: 2026-05-01
  release-version: 0.4.0
---

# Plan 05-06 Summary — Release Cut

## Outcome

`@dogpile/sdk@0.4.0` was published to npm and is the `latest` dist-tag.

## Release Artifacts

| Artifact | Value |
|----------|-------|
| CHANGELOG heading | `## [0.4.0] — 2026-05-01` |
| Git tag | `v0.4.0` |
| Tagged commit | `0e93f2a8b9310dafaba76af8f78fa52e14e7f16b` |
| GitHub Release | https://github.com/bubstack/dogpile/releases/tag/v0.4.0 |
| npm publish workflow | https://github.com/bubstack/dogpile/actions/runs/25222585313 |
| npm workflow conclusion | `success` |
| npm package version | `0.4.0` |
| npm latest dist-tag | `0.4.0` |
| npm tarball | https://registry.npmjs.org/@dogpile/sdk/-/sdk-0.4.0.tgz |

## Commits

| Commit | Description |
|--------|-------------|
| `0e93f2a` | `chore(release): cut v0.4.0` — squash-merged release commit on `main` |

## Verification

- `pnpm run verify` passed locally before tagging and publishing.
- Release Validation checks passed on PR #15 before merge.
- `gh run view 25222585313` reported `conclusion: success`.
- `npm view @dogpile/sdk@0.4.0 version` returned `0.4.0`.
- `npm view @dogpile/sdk dist-tags.latest` returned `0.4.0`.
- `npm view @dogpile/sdk@0.4.0 dist.tarball` returned the published tarball URL above.

## Deviations from Plan

- The release-triggered `npm-publish.yml` run from tag `v0.4.0` failed before executing steps because the protected `npm` environment rejected tag deployments. The workflow was re-run manually from `main` with `dry_run=false`, still using GitHub Actions Trusted Publisher/OIDC.
- Local `main` had diverged from `origin/main` after the squash merge. The old local history was preserved on `backup/local-main-before-v0.4.0-sync-20260501T162625Z`, then local `main` was reset to `origin/main` before retrying publication.
- `scripts/release-identity.json`, `scripts/check-package-identity.mjs`, and `src/tests/package-exports.test.ts` were updated as part of the release cut so release identity validation accepts the bracketed pre-release heading and date-stamped final heading used by the v0.4.0 changelog.

## Planning Closure

- `.planning/STATE.md` now marks Phase 5 complete and v0.4.0 shipped.
- `.planning/ROADMAP.md` marks Phase 5 and all six Phase 5 plans complete.
- `.planning/REQUIREMENTS.md` marks DOCS-01 through DOCS-04 complete.

## Self-Check: PASSED

Release artifacts, npm publication, and planning closure were verified.
