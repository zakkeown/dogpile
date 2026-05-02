---
phase: 09-otel-tracing-bridge
review: 09-REVIEW.md
fixed_at: 2026-05-02T00:32:30Z
status: all_fixed
fix_scope: critical_warning
findings_in_scope: 2
fixed: 2
skipped: 0
iteration: 1
commits:
  - 88ca27c
verification:
  - pnpm exec vitest run src/tests/otel-tracing-contract.test.ts
  - pnpm run typecheck
  - pnpm exec vitest run src/runtime/tracing.test.ts src/tests/otel-tracing-contract.test.ts src/tests/no-otel-imports.test.ts src/testing/deterministic-provider.test.ts
---

# Phase 09 Code Review Fix Report

## Summary

Fixed both critical findings from `09-REVIEW.md`.

## Fixes Applied

### CR-01: Agent-turn span cost used cumulative run cost

`src/runtime/engine.ts` now accumulates model-response token and cost data into the active turn tracing state, then writes per-turn `dogpile.turn.*` attributes when closing the `dogpile.agent-turn` span.

Regression coverage was added to `src/tests/otel-tracing-contract.test.ts` with a two-turn sequential run that asserts each turn span records the individual provider-call cost.

### CR-02: Failed run spans omitted required run attributes

`src/runtime/engine.ts` now records best-effort run id, agent count, turn count, and cost/token accounting as events pass through tracing. The error close path applies those attributes before setting `dogpile.run.outcome = "aborted"` and ending the run span.

Regression coverage was added to `src/tests/otel-tracing-contract.test.ts` with a throwing provider that asserts failed `dogpile.run` spans retain run identity, zeroed accounting, turn count, and error status.

## Verification

- `pnpm exec vitest run src/tests/otel-tracing-contract.test.ts` - passed, 8 tests.
- `pnpm run typecheck` - passed.
- `pnpm exec vitest run src/runtime/tracing.test.ts src/tests/otel-tracing-contract.test.ts src/tests/no-otel-imports.test.ts src/testing/deterministic-provider.test.ts` - passed, 17 tests.
