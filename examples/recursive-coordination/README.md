# Recursive Coordination - Hugging Face Upload GUI Plan, with Delegation

This example reuses the same planning mission as `examples/huggingface-upload-gui/` - but instead of comparing the four protocols head-to-head, it wraps the mission in a coordinator-with-delegate: a single coordinator agent dispatches sub-missions through the new v0.4.0 `delegate` decision and weaves the partial results into a final synthesis.

> Why diff this against `huggingface-upload-gui/`? Same mission, two scripts. The huggingface example shows protocol-level comparison; this example shows recursion inside the coordinator. The line-by-line diff is the clearest demonstration of what `delegate` adds.

The harness exercises every Phase 1-4 surface a developer cares about:

- Delegate dispatch + embedded child trace (Phase 1)
- Live `parentRunIds` chain demux on `Dogpile.stream` (Phase 4)
- Intentionally-failing child -> `sub-run-failed` + `partialCost` -> structured failures in the next coordinator turn (Phase 2 + Phase 4)
- `locality: "local"` auto-clamp -> `sub-run-concurrency-clamped` (Phase 3)

See [`docs/recursive-coordination.md`](../../docs/recursive-coordination.md) for the full surface and worked example.

## Run

From the repository root:

```sh
pnpm run build
node examples/recursive-coordination/run.mjs
```

The default provider is local and deterministic. It is shaped to produce repeatable delegate decisions, including one intentionally-failing child and one local-provider clamp pass, so the recursive-coordination surfaces are observable without spending API tokens or hitting the network.

To run with a live OpenAI-compatible provider:

```sh
DOGPILE_EXAMPLE_PROVIDER=openai-compatible \
DOGPILE_EXAMPLE_MODEL=gpt-4.1-mini \
OPENAI_API_KEY=... \
node examples/recursive-coordination/run.mjs
```

Optional endpoint overrides:

- `DOGPILE_EXAMPLE_BASE_URL`
- `DOGPILE_EXAMPLE_PATH`

Dogpile reads no environment variables. The example script is the only env-aware layer; the SDK itself takes a fully constructed `ConfiguredModelProvider` object.

## Output

The script writes:

- `results/latest.json` - full run dump including the parent stream events, embedded child traces from `Dogpile.pile`, and the local-provider pass with its `sub-run-concurrency-clamped` event.
- `results/latest.md` - human-readable summary: delegate count, sub-run-failed reasons, total cost including partial costs from failed children, and a structured failures excerpt.

Each run captures:

- Delegated child count and their protocols
- `sub-run-failed` events with `partialCost` (D-11 demonstration)
- Structured failures block from the next coordinator prompt (Phase 4 D-07)
- `sub-run-concurrency-clamped` events (D-12 local-provider demonstration)
- Total token and cost rollup including partial costs

## See also

- [`docs/recursive-coordination.md`](../../docs/recursive-coordination.md) - concepts, propagation rules, parentRunIds chain, structured failures, replay parity, worked example.
- [`docs/recursive-coordination-reference.md`](../../docs/recursive-coordination-reference.md) - exhaustive event/error/option tables.
- [`examples/huggingface-upload-gui/`](../huggingface-upload-gui/) - same mission, plain-protocol comparison.
