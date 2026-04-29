---
name: dogpile-release
description: Cut, publish, or recover a release of @dogpile/sdk to GitHub and npm. Use this skill whenever the user mentions cutting a release, bumping the version, publishing to npm, shipping vX.Y.Z, creating a GitHub Release, dispatching npm-publish.yml, approving the npm environment deployment, or recovering a failed Dogpile publish — even if they don't say "release" explicitly (e.g. "let's get 0.4.0 out", "push this to npm", "tag and publish"). Captures the repo-specific identity files, protected-main PR flow, GitHub environment approval, and npm trusted-publishing quirks that are easy to get wrong.
---

# Dogpile Release

This repo publishes `@dogpile/sdk` from GitHub Actions via npm Trusted Publishing. The release path has several non-obvious gates — follow this skill end to end rather than improvising, because the failure modes (wrong tag ref, string-typed environment IDs, diverged local main) waste a real publish attempt.

## When to use

Trigger on requests like: "cut a release", "publish to npm", "ship vX.Y.Z", "bump to X.Y.Z", "make a GitHub Release", "tag and publish", "recover a failed publish", or anything that implies producing a new published version of the SDK.

## Mental model

- The `npm` GitHub environment is **protected** and **only deploys from `main`**. A Release published from a tag ref will trigger `npm-publish.yml` but the job will fail the environment gate. Don't rely on the tag-published trigger.
- `main` is **protected** — direct pushes are blocked, and merge commits are disallowed. Squash-merge a release branch.
- After squash merge, local `main` diverges from the release-branch commits. Re-sync before tagging.

## Step 1 — Bump version files together

For version `X.Y.Z`, all four must move in lockstep — `check-package-identity.mjs` enforces this and will fail the release if any one is missed.

- `package.json` → `"version": "X.Y.Z"`
- `scripts/release-identity.json` → `version` and `packFilename` (`dogpile-sdk-X.Y.Z.tgz`)
- `docs/release.md` → tarball examples and release-identity snippets
- `CHANGELOG.md` → top entry with `@dogpile/sdk@X.Y.Z` and `dogpile-sdk-X.Y.Z.tgz`

Then run the local gate (these are independent — run in parallel via separate Bash tool calls when possible):

```sh
node scripts/check-package-identity.mjs
pnpm run verify
pnpm run publish:check
```

`pnpm run verify` is the full release gate (identity → build → artifact check → packed quickstart smoke → typecheck → test). If it fails, fix the underlying issue — never skip it.

## Step 2 — Release branch and PR (protected main)

```sh
git checkout -b release/X.Y.Z
git push origin HEAD:release/X.Y.Z
gh pr create --base main --head release/X.Y.Z --title "chore: prepare X.Y.Z release"
```

Wait for required **Release Validation** checks. If GitHub code-quality bot comments appear, fix them in code and push to the release branch. Do not resolve a real comment without a fix — silent dismissal will surface as a regression downstream.

Squash merge (no merge commits allowed in this repo):

```sh
gh pr merge <PR> --squash --delete-branch=false
```

`--admin` is acceptable **only** if (a) Release Validation passed, (b) review threads are resolved, and (c) the user explicitly authorized bypassing a remaining nonessential gate. Otherwise, wait.

## Step 3 — Resync local main

GitHub squash-merge creates a new commit; your release branch's commits are no longer on `main`. Tagging the wrong commit means the npm publish workflow runs on the wrong ref.

```sh
git fetch origin
git reset --hard origin/main
```

(Confirm with the user before `reset --hard` if there's any chance of unrelated local work.)

## Step 4 — Tag, Release, dispatch publish

Order matters — tag the final `origin/main` squash commit, then create the Release, then dispatch the publish workflow from `main` (not from the tag).

```sh
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --repo bubstack/dogpile --target main --title "vX.Y.Z"
gh workflow run npm-publish.yml --repo bubstack/dogpile --ref main -f dry_run=false
```

`-f dry_run=false` still waits for environment approval — the dispatch only queues the run.

## Step 5 — Approve the `npm` environment deployment

Find the run id (most recent dispatch of `npm-publish.yml` on `main`):

```sh
gh run list --repo bubstack/dogpile --workflow=npm-publish.yml --branch=main --limit 1
gh api repos/bubstack/dogpile/actions/runs/<run-id>/pending_deployments
```

Approve. **Use `-F` (uppercase) for `environment_ids[]`** — `-f` sends it as a string and the API rejects it:

```sh
gh api --method POST repos/bubstack/dogpile/actions/runs/<run-id>/pending_deployments \
  -F 'environment_ids[]=<environment-id>' \
  -f state=approved \
  -f comment='Approve @dogpile/sdk vX.Y.Z publish from main'
```

## Step 6 — Verify

```sh
gh run watch <run-id> --repo bubstack/dogpile --exit-status
npm view @dogpile/sdk@X.Y.Z version dist.tarball
npm view @dogpile/sdk dist-tags version
gh release view vX.Y.Z --repo bubstack/dogpile
```

`dist-tags.latest` should equal `X.Y.Z`. If not, the publish workflow may have skipped or rolled back — read the workflow logs, don't re-dispatch blindly.

## Known traps (re-read before each release)

- **Tag-ref publish failure:** A Release `published` event fires `npm-publish.yml` with the tag as ref; the protected `npm` environment rejects it. Always dispatch with `--ref main`.
- **String-typed environment IDs:** `gh api ... -f 'environment_ids[]=123'` sends a string and the request 422s. Use `-F`.
- **Diverged local main:** After squash merge, `git log` on the release branch and `origin/main` differ. Sync with `git fetch && git reset --hard origin/main` before tagging.
- **Identity drift:** Forgetting one of the four version-bump files is the most common cause of a failed `verify`. Update them as a single commit.
- **Tag move on a published release:** If the npm package and GitHub Release for `vX.Y.Z` already exist, do not force-move the tag without explicit user approval and a rollback plan — downstream consumers may have cached the prior commit.

## If you get stuck

If `pnpm run verify` fails: read the failure, fix in code, push to the release branch, let CI rerun. Never `--no-verify` or skip hooks.

If the npm publish workflow fails after approval: check `gh run view <run-id> --log-failed`. Common causes are OIDC trust misconfig (rare; needs repo admin) or a tarball that doesn't match `release-identity.json` (re-run `pnpm run publish:check` locally).
