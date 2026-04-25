# Paper Reproduction Criteria

This note documents the comparison contract for the selected reproduction
fixture, `benchmark-fixtures/l3-release-readiness-triage.yaml`.

## Fixture

- Paper: arXiv:2603.28990v1, "Drop the Hierarchy and Roles"
- Task level: L3
- Fixture: `l3-release-readiness-triage`
- Primary comparison: Sequential score minus Coordinator score
- Hypothesis: Sequential should outperform Coordinator on this fixture because
  the task requires independent evidence passes, contradiction handling, and
  synthesis into an actionable final release-readiness memo.

## Benchmark Methodology

This benchmark is a controlled paper-reproduction harness, not a general SDK
quality leaderboard. It chooses one representative L3 task from the paper's
complex-work class, runs paper-aligned protocol variants under identical
conditions, scores the resulting artifacts with a fixed rubric, and persists
the full run data as JSON-serializable benchmark artifacts.

### Dataset and Task Selection

The benchmark dataset is the committed fixture
`benchmark-fixtures/l3-release-readiness-triage.yaml`. It is intentionally
small, deterministic, and evidence-complete so the reproduction can run in the
unit test suite without network access or filesystem persistence.

The selected task asks agents to decide whether a TypeScript SDK should ship v1
from a conflicting evidence packet. It is classified as L3 because a successful
answer must do more than summarize facts: it must inspect positive and negative
release evidence, identify contradictions between public claims and test
coverage, choose a release decision, and produce prioritized remediation. That
shape directly exercises the paper's claim that non-hierarchical coordination
helps complex tasks requiring multiple independent reasoning passes.

This first reproduction compares Sequential against Coordinator because that is
the paper-faithfulness claim under test: Sequential is the non-hierarchical
candidate and Coordinator is the hierarchical baseline. Broadcast and Shared
are first-party Dogpile protocols and should use the same fixture contract when
included in broader SDK regression reports, but their scores are not used to
prove the Sequential-over-Coordinator hypothesis for this fixture.

### Protocol Configuration

Every protocol run is derived from the same `BenchmarkRunnerConfig`, then a
single protocol config is attached with `createProtocolBenchmarkRunConfig`.
Only the coordination protocol is allowed to vary within the comparison.

| Setting | Coordinator | Sequential | Rationale |
| --- | --- | --- | --- |
| Protocol config | `{ kind: "coordinator", maxTurns: 4 }` | `{ kind: "sequential", maxTurns: 4 }` | Gives each four-agent run the same turn ceiling while preserving each protocol's native control flow. |
| Agent roster | Same 4 agents | Same 4 agents | Prevents role count, instruction, or ordering differences from explaining score deltas. |
| Model provider | Same deterministic provider | Same deterministic provider | Keeps provider behavior fixed and makes the unit-test reproduction stable. |
| Temperature | `0` | `0` | Removes sampling variance from the comparison. |
| Seed | `260328990` | `260328990` | Records the intended deterministic seed in the artifact metadata. |
| Tool and network access | Disabled | Disabled | Forces outputs to use only the fixture evidence packet. |
| Budget caps | `max_usd: 1.00`, `max_output_tokens: 2500`, `max_total_tokens: 12000` | Same caps | Verifies comparable cost controls and prevents one protocol from winning by spending more. |

For four-protocol SDK regressions, Broadcast and Shared should be added as
additional rows with the same task, model, tier, budget, seed, temperature, and
agent roster. Broadcast uses its round cap as the comparable protocol-native
limit; Shared uses its turn cap. Those additional runs are useful for product
coverage, but the reproduction pass/fail margin remains
`Sequential score - Coordinator score >= 5`.

### Evaluation Procedure

1. Load the fixture intent, required artifacts, rubric, expected floors, and
   deterministic setup from `benchmark-fixtures/l3-release-readiness-triage.yaml`.
2. Build one shared benchmark config containing the task, model provider,
   temperature, seed, tier, budget caps, metadata, and agent roster.
3. Run Coordinator and Sequential through the benchmark runner helpers imported
   from the repository-only `../src/internal.js` path using the same shared
   config and protocol-specific caps.
4. Score each final output against the fixed five-dimension rubric below using
   only the fixture prompt, required artifacts, and produced answer.
5. Package each run with `createBenchmarkRunArtifact` so the final output,
   transcript, streaming event log, trace, accounting metadata, score, protocol
   config, task metadata, model id, seed, temperature, and agent roster are
   preserved as JSON-serializable data.
6. Pass the reproduction only when Coordinator clears `70`, Sequential clears
   `80`, Sequential beats Coordinator by at least `5` points, both artifacts
   serialize with `JSON.stringify`/`JSON.parse`, and required event coverage is
   present in the trace.

The deterministic unit-test implementation imports the benchmark runner helpers
and deterministic provider fixtures from `../src/internal.js`. It is
`src/benchmark/config.test.ts` under the assertion
`asserts Sequential outperforms Coordinator on the selected release-readiness benchmark`.
The committed markdown report should be updated whenever the fixture, rubric,
protocol configs, provider behavior, or expected floors change.

## Protocol Alignment

Coordinator is treated as the hierarchical baseline: one coordinating agent is
responsible for decomposing the work, assigning or summarizing subordinate
contributions, and producing the final answer. This gives the protocol a strong
single decision point, but it also makes missed evidence and unexamined
contradictions more likely on complex synthesis tasks.

Sequential is treated as the paper-aligned non-hierarchical comparison: agents
operate in sequence, each seeing the evolving transcript and adding an
independent reasoning pass before the final synthesis. On this L3 task, that
structure should help later agents catch contradictions, recover omitted
evidence, and convert the accumulated analysis into prioritized remediation.

The comparison is therefore not a generic quality bake-off. It specifically
tests whether the non-hierarchical Sequential protocol produces a better
artifact than the hierarchical Coordinator protocol on a task shaped around the
paper's complex-work advantage claim.

## Controlled Setup

Both protocols must be run with the fixture's deterministic setup:

- Same input prompt
- Same model
- Same temperature, fixed at `0`
- Same agent count, fixed at `4`
- Same turn cap, fixed at `2` turns per agent where applicable
- Same random seed, `260328990`
- Same disabled tool and network access
- Same budget caps: `max_usd: 1.00`, `max_output_tokens: 2500`, and
  `max_total_tokens: 12000`

Scores are invalid if either protocol uses facts outside the fixture evidence
packet as release-readiness evidence, omits the required decision artifact, or
recommends `ship_v1` while leaving blocker evidence unresolved.

## Scoring Criteria

Each protocol output is scored from `0` to `100` using the fixture rubric:

| Dimension | Weight | Paper-aligned purpose |
| --- | ---: | --- |
| Evidence coverage | 25 | Measures whether the protocol uses the full evidence packet instead of collapsing around a narrow summary. |
| Contradiction handling | 25 | Measures whether the protocol identifies and resolves claim-versus-evidence tensions, the main stressor for this L3 task. |
| Release judgment | 20 | Measures whether the protocol turns the evidence into a defensible ship, release-candidate, or block decision. |
| Actionability | 20 | Measures whether the protocol produces concrete remediation instead of only diagnosis. |
| Format compliance | 10 | Measures whether the protocol preserves the requested artifact shapes and memo limit. |

Sequential is expected to clear a score of at least `80`. Coordinator is
expected to clear a score of at least `70`. The reproduction succeeds only if
Sequential beats Coordinator by at least `5` points under the controlled setup.

## Reproduced Result

The deterministic reproduction is committed as
`src/benchmark/config.test.ts` under the assertion
`asserts Sequential outperforms Coordinator on the selected release-readiness benchmark`.
It runs Sequential and Coordinator against the same fixture intent, model
provider, temperature, budget, seed, and four-agent roster, then packages both
runs as JSON-serializable benchmark artifacts.

Latest verified command:

```sh
pnpm exec vitest run src/benchmark/config.test.ts -t "asserts Sequential outperforms Coordinator"
```

Required prerequisites:

- Run from the repository root, where `package.json`,
  `src/benchmark/config.test.ts`, and
  `benchmark-fixtures/l3-release-readiness-triage.yaml` are present.
- Use Node `>=22`; this report was last verified with Node `v22.22.1`.
- Use pnpm matching the package manager declaration, `pnpm@10.33.0`.
- Install dependencies first with `pnpm install` if `node_modules` is not
  already present.
- No model provider keys, network access, local storage, or fixture generation
  step are required. The selected test uses the committed fixture and
  deterministic in-memory provider only.

Result:

| Protocol | Score | Floor | Event coverage | Budget result | Outcome |
| --- | ---: | ---: | --- | --- | --- |
| Coordinator | 87 | 70 | `role-assignment`, `agent-turn`, `final` | Under `max_usd: 1.00` and `max_total_tokens: 12000` | Baseline passed |
| Sequential | 100 | 80 | `role-assignment`, `agent-turn`, `final` | Under `max_usd: 1.00` and `max_total_tokens: 12000` | Reproduction winner |

Sequential beat Coordinator by `13` points, exceeding the required `5` point
margin. Both artifacts serialize through `JSON.stringify`/`JSON.parse` without
loss, preserve the full transcript on the trace, and store score source
metadata as `run-quality`.

## Known Limitations and Interpretation Caveats

This reproduced result is useful as a committed regression and paper-faithfulness
smoke test, but it is not a full independent replication of arXiv
2603.28990v1. Interpret the `13` point Sequential-over-Coordinator margin within
the boundaries below.

- Single fixture: the comparison uses one intentionally small L3
  release-readiness triage task. It does not establish that Sequential
  outperforms Coordinator across the paper's full L1-L4 benchmark mix, across
  unrelated domains, or across tasks with different evidence shapes.
- Deterministic provider: the committed test uses a deterministic model provider
  so it can run offline and remain stable in CI. The result therefore validates
  Dogpile's protocol wiring, artifact packaging, event capture, and rubric
  application more than it validates live-model behavior.
- No statistical confidence: the run uses one seed, temperature `0`, one agent
  roster, and one controlled prompt. The report should not be read as a
  statistically significant performance estimate or as a claim about expected
  win rate under sampling variance.
- Rubric-local scoring: scores come from the fixture's fixed rubric and
  deterministic judge behavior. They are appropriate for this release-readiness
  task, but they are not a universal quality metric and should not be compared
  directly with scores from other fixtures unless the rubric is held constant.
- Narrow protocol claim: the pass/fail claim is only
  `Sequential score - Coordinator score >= 5` for this fixture. Broadcast and
  Shared are first-party protocols that should be included in broader regression
  reports, but they are not part of this reproduced margin.
- Paper-aligned, not paper-identical: the harness maps the paper's hierarchy
  contrast onto Dogpile's Coordinator and Sequential implementations. It does
  not claim byte-for-byte equivalence with the paper's original prompts,
  evaluator, model stack, task corpus, or hidden experimental controls.
- Storage-free artifact boundary: benchmark artifacts preserve the trace,
  transcript, event log, score, accounting, protocol config, and metadata as
  JSON-serializable data, but Dogpile intentionally does not persist raw files,
  external evaluator state, or live provider telemetry beyond what the caller
  supplies to the run.
- Cost interpretation: budget accounting proves both runs stayed under the
  configured caps in the SDK's cost model. With the deterministic provider, it
  does not prove real provider billing parity or token-metering parity for a
  hosted model.

Treat this report as the minimum reproducible benchmark contract for the SDK.
Broader paper-reproduction claims require adding more tasks, seeds, live-model
providers, evaluator variants, and all four protocols under the same artifact
schema.

## Tie Breakers

If the weighted scores tie, the output with the stronger contradiction-handling
score wins. If still tied, the output with the stronger actionability score
wins. If still tied, the lower total token count wins.

## Required Observability

The run traces for both protocols must be JSON-serializable and include these
events when the corresponding moments occur:

- `role-assignment`
- `agent-turn`
- `judge-score`
- `budget-stop`
- `final`

The comparison report should include the final score, per-dimension score,
budget summary, and trace event coverage for both protocols so the result can be
audited without relying on unstored runtime state.
