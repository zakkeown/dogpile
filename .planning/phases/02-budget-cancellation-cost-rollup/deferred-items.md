# Deferred items — Phase 2

## Pre-existing test failures (not caused by Phase 2 work)

### `src/tests/consumer-type-resolution-smoke.test.ts` (1 test)

The test invokes `execFile("pnpm", ["exec", "tsc", ...], { cwd: rootDir })` where
`rootDir = src/`. When run inside this sandbox, `pnpm` reports
`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsc" not found`.

Reproduced on baseline commit `8824b57` (parent of all Phase 2 work) — failure
is independent of any source changes in plan 02-01.

Direct invocation of the same `tsc` command outside `execFile` succeeds and
typechecks cleanly. The sandboxed pnpm-recursive-exec path is the failing layer.

Out of scope for plan 02-01 (BUDGET-01) — file separately if it persists in
unsandboxed CI.
