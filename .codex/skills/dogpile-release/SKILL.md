---
name: dogpile-release
description: Use when cutting, publishing, or recovering a Dogpile release to GitHub and npm. Captures the repo-specific release identity files, protected main PR flow, GitHub environment approval, and npm trusted-publishing quirks.
---

# Dogpile Release

Use this skill for requests like "cut a release", "publish to npm", "ship vX.Y.Z",
"make a GitHub Release", or "recover a failed Dogpile publish".

## Release Shape

Dogpile publishes `@dogpile/sdk` from GitHub Actions using npm Trusted
Publishing. The `npm` environment is protected and only deploys from `main`.
Do not rely on the GitHub Release `published` trigger alone; tag refs are not
allowed to deploy to `npm` in this repo.

## Version Bump Files

For a version `X.Y.Z`, update all of these together:

- `package.json`: `"version": "X.Y.Z"`
- `scripts/release-identity.json`: `version` and `packFilename`
- `docs/release.md`: tarball examples and release identity snippets
- `CHANGELOG.md`: top entry with `@dogpile/sdk@X.Y.Z` and
  `dogpile-sdk-X.Y.Z.tgz`

Run:

```sh
node scripts/check-package-identity.mjs
pnpm run verify
pnpm run publish:check
```

## Protected Main Flow

Direct pushes to `main` are blocked. Use a release branch and PR:

```sh
git checkout -b release/X.Y.Z
git push origin HEAD:release/X.Y.Z
gh pr create --base main --head release/X.Y.Z
```

Wait for required Release Validation checks. If GitHub code-quality comments
appear, fix them in code and push the release branch. Do not just resolve a real
comment without a fix.

The repo disallows merge commits; use squash merge:

```sh
gh pr merge <PR> --squash --delete-branch=false
```

If explicitly authorized by the user to bypass a nonessential pending gate, use
`--admin`, but only after required Release Validation checks passed and review
threads are resolved.

After GitHub squash-merges, sync local `main`:

```sh
git fetch origin
git reset --hard origin/main
```

## GitHub Release And npm Publish

Preferred order:

1. Merge the release PR into `main`.
2. Tag the final `origin/main` commit as `vX.Y.Z` and push the tag.
3. Create or update the GitHub Release for `vX.Y.Z`.
4. Dispatch npm publish from `main`.
5. Approve the pending `npm` environment deployment.
6. Verify npm.

Commands:

```sh
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --repo bubstack/dogpile --target main --title "vX.Y.Z"
gh workflow run npm-publish.yml --repo bubstack/dogpile --ref main -f dry_run=false
```

Check pending environment approval:

```sh
gh api repos/bubstack/dogpile/actions/runs/<run-id>/pending_deployments
```

Approve the `npm` deployment with integer coercion via `-F`:

```sh
gh api --method POST repos/bubstack/dogpile/actions/runs/<run-id>/pending_deployments \
  -F 'environment_ids[]=<environment-id>' \
  -f state=approved \
  -f comment='Approve @dogpile/sdk vX.Y.Z publish from main'
```

Verify:

```sh
gh run watch <run-id> --repo bubstack/dogpile --exit-status
npm view @dogpile/sdk@X.Y.Z version dist.tarball
npm view @dogpile/sdk dist-tags version
gh release view vX.Y.Z --repo bubstack/dogpile
```

## Known Traps

- A GitHub Release published from a tag can trigger `npm-publish.yml`, but the
  job fails if the ref is not allowed by the protected `npm` environment.
- `gh workflow run ... -f dry_run=false` still waits for environment approval.
- `gh api ... -f 'environment_ids[]=...'` sends a string and fails; use `-F`.
- GitHub squash merge makes local `main` diverge from the release branch commits;
  sync with `git fetch origin` and `git reset --hard origin/main`.
- For future releases, tag the final `main` commit after squash merge. If a
  public GitHub Release/npm publish already exists, do not force-move the tag
  without explicit user approval and a clear rollback plan.
