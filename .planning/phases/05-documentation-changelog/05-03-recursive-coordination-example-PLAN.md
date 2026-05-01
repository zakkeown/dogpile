---
phase: 05-documentation-changelog
plan: 03
type: execute
wave: 1
depends_on: []
files_modified:
  - examples/recursive-coordination/run.mjs
  - examples/recursive-coordination/README.md
  - examples/recursive-coordination/results/.gitkeep
autonomous: true
requirements: [DOCS-02]
tags: [examples, runnable, openai-compatible, deterministic-provider]

must_haves:
  truths:
    - "examples/recursive-coordination/run.mjs is a single .mjs script (D-09) imports from @dogpile/sdk via the built dist/ (same pattern as examples/huggingface-upload-gui/run-all-protocols.mjs)"
    - "Default invocation (`node examples/recursive-coordination/run.mjs` after `pnpm run build`) runs against a local deterministic provider — no network/keys required (D-08)"
    - "Live mode is documented in the example's README via env vars: DOGPILE_EXAMPLE_PROVIDER=openai-compatible, DOGPILE_EXAMPLE_MODEL, OPENAI_API_KEY, optional DOGPILE_EXAMPLE_BASE_URL/PATH (D-08, mirrors huggingface)"
    - "Live mode constructs createOpenAICompatibleProvider so DOCS-02 requirement 'wired against createOpenAICompatibleProvider' is satisfied by the live-mode code path"
    - "The example reuses the Hugging Face upload GUI mission VERBATIM from examples/huggingface-upload-gui/run-all-protocols.mjs and wraps it in a coordinator-with-delegate (D-07)"
    - "The example demonstrates BOTH Dogpile.stream() (primary, with parentRunIds chain demux live) AND a small Dogpile.pile() block at the end that prints the embedded child trace shape from result.trace (D-10)"
    - "The example includes ONE intentionally-failing child (e.g. tiny budget) so sub-run-failed with partialCost lands AND the structured failures block surfaces on the next coordinator turn (D-11)"
    - "The example wires a locality: 'local' provider for at least one delegated child (or a dedicated --local sub-run) so sub-run-concurrency-clamped is captured in output (D-12)"
    - "Output artifacts written to examples/recursive-coordination/results/ mirroring huggingface's results/ pattern; results/ is gitkept but its outputs are gitignored (latest.json, latest.md)"
    - "examples/recursive-coordination/README.md mirrors examples/huggingface-upload-gui/README.md format: title, mission paragraph, ## Run section with build+command, ## Output section listing artifacts (D-15 mirror)"
    - "package.json files allowlist is NOT modified (examples/ stays repo-only — confirm before commit)"
    - "The example contains NO env reads inside src/runtime/ (constraint inherited from CLAUDE.md); env reads are confined to the example .mjs script itself"
  artifacts:
    - path: "examples/recursive-coordination/run.mjs"
      provides: "Single-file runnable example: deterministic provider default, live OpenAI-compatible mode via env, coordinator-with-delegate wrapping the HF upload mission, both .stream() and .pile() demos, intentionally-failing child, local-provider clamp demo."
      min_lines: 200
      contains: "createOpenAICompatibleProvider"
    - path: "examples/recursive-coordination/README.md"
      provides: "Example-level README mirroring huggingface format (title, mission paragraph, ## Run, ## Output)."
      min_lines: 30
      contains: "## Run"
    - path: "examples/recursive-coordination/results/.gitkeep"
      provides: "Gitkept results directory for output artifacts (mirrors huggingface)."
  key_links:
    - from: "examples/recursive-coordination/run.mjs"
      to: "@dogpile/sdk built dist/"
      via: "import from package root"
      pattern: "from \"@dogpile/sdk\""
    - from: "examples/recursive-coordination/run.mjs (live mode)"
      to: "createOpenAICompatibleProvider"
      via: "DOGPILE_EXAMPLE_PROVIDER=openai-compatible branch"
      pattern: "createOpenAICompatibleProvider"
    - from: "examples/recursive-coordination/run.mjs"
      to: "examples/recursive-coordination/results/"
      via: "fs.writeFileSync(results/latest.json|md)"
      pattern: "results/"
    - from: "examples/recursive-coordination/README.md"
      to: "examples/huggingface-upload-gui/README.md (format mirror)"
      via: "same H1/Run/Output structure"
      pattern: "## Run"
---

<objective>
Build the runnable example DOCS-02 satisfies. Mirror the huggingface-upload-gui shape exactly: single `.mjs`, deterministic default, live mode via env vars, results in a sibling `results/` directory.

Reuse the Hugging Face upload GUI planning mission verbatim (D-07) and wrap it in a coordinator-with-delegate. Demonstrate every Phase 1-4 surface a developer wants to see in motion:

- delegate decision dispatch (Phase 1)
- embedded child trace via `Dogpile.pile()` (Phase 1)
- live parentRunIds chain demux via `Dogpile.stream()` (Phase 4)
- intentionally-failing child → `sub-run-failed` with `partialCost` → structured failures coordinator prompt block on next turn (Phase 2 + Phase 4)
- local-provider auto-clamp → `sub-run-concurrency-clamped` event (Phase 3)

Purpose: a developer cloning the repo can `pnpm run build && node examples/recursive-coordination/run.mjs` and watch every recursive-coordination surface light up in deterministic, repeatable output. Live mode (env-gated) exercises the same code path against `createOpenAICompatibleProvider`.

Output: three files under `examples/recursive-coordination/`. No changes to `package.json` (examples stay repo-only).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/05-documentation-changelog/05-CONTEXT.md
@.planning/phases/01-delegate-decision-sub-run-traces/01-CONTEXT.md
@.planning/phases/02-budget-cancellation-cost-rollup/02-CONTEXT.md
@.planning/phases/03-provider-locality-bounded-concurrency/03-CONTEXT.md
@.planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md
@CLAUDE.md
@examples/huggingface-upload-gui/run-all-protocols.mjs
@examples/huggingface-upload-gui/README.md
@src/index.ts
@src/runtime/coordinator.ts
@src/providers/openai-compatible.ts
@src/types.ts

<interfaces>
<!-- Public exports the example uses (from @dogpile/sdk root): -->
//   Dogpile.pile, Dogpile.stream
//   createOpenAICompatibleProvider
//   ConfiguredModelProvider (for the deterministic provider object's typing in JSDoc comments)
//   AgentDecision (the discriminated union — for narration in comments)

<!-- Deterministic provider shape (extract pattern from huggingface-upload-gui/run-all-protocols.mjs): -->
//   { id, generate(request) } — returns paper-style autonomous role-selection JSON,
//   plus delegate decisions when invoked from the coordinator plan turn.

<!-- For D-12 local-provider clamp demo, set metadata.locality on the deterministic provider: -->
//   const localProvider = { id: "local-det", metadata: { locality: "local" }, generate: ... }
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Author examples/recursive-coordination/run.mjs (deterministic default + live mode + delegate demo)</name>
  <files>examples/recursive-coordination/run.mjs, examples/recursive-coordination/results/.gitkeep</files>
  <read_first>
    - examples/huggingface-upload-gui/run-all-protocols.mjs (entire file — copy the deterministic-provider helper shape, the env-var live-mode branch, the results-writing pattern; reuse the mission text verbatim)
    - .planning/phases/05-documentation-changelog/05-CONTEXT.md (D-07..D-12; Code Context note about extracting shared helper to examples/_lib/ — left to judgment, default is to inline)
    - src/index.ts (confirm public exports — Dogpile, createOpenAICompatibleProvider)
    - src/runtime/coordinator.ts (confirm the delegate decision JSON shape parser accepts: fenced ```json block prefixed by "delegate:")
    - .planning/phases/01-delegate-decision-sub-run-traces/01-CONTEXT.md (delegate decision shape, fenced-JSON parsing convention)
    - .planning/phases/03-provider-locality-bounded-concurrency/03-CONTEXT.md (Phase 3 D-09 sibling-failed; the array-of-delegates shape if relevant; D-12 local clamp behavior)
    - .planning/phases/04-streaming-child-error-escalation/04-CONTEXT.md (parentRunIds chain shape — for the live-stream demux block)
  </read_first>
  <action>
    Create `examples/recursive-coordination/run.mjs`.

    **File header:**

    ```js
    // examples/recursive-coordination/run.mjs
    //
    // Runnable demo of v0.4.0 recursive coordination. Reuses the Hugging Face
    // upload GUI planning mission from examples/huggingface-upload-gui/ and wraps
    // it in a coordinator that delegates sub-steps. Default mode uses a local
    // deterministic provider — no network/keys required. Set
    // DOGPILE_EXAMPLE_PROVIDER=openai-compatible (with OPENAI_API_KEY +
    // DOGPILE_EXAMPLE_MODEL) to exercise the same flow against
    // createOpenAICompatibleProvider.
    //
    // Run from the repository root:
    //   pnpm run build
    //   node examples/recursive-coordination/run.mjs
    //
    // Output artifacts: examples/recursive-coordination/results/latest.{json,md}
    //
    // Surfaces demonstrated:
    //   1. delegate decision + embedded child trace (Phase 1)
    //   2. parentRunIds chain demux on live stream (Phase 4)
    //   3. intentionally-failing child → sub-run-failed + partialCost +
    //      structured failures in next coordinator prompt (Phase 2 + Phase 4)
    //   4. locality: "local" auto-clamp → sub-run-concurrency-clamped (Phase 3)
    //   5. Dogpile.pile() embedded-trace shape readback (Phase 1)
    ```

    **Imports & env-driven provider selection (mirror huggingface):**

    ```js
    import { writeFileSync, mkdirSync } from "node:fs";
    import { fileURLToPath } from "node:url";
    import path from "node:path";
    import { Dogpile, createOpenAICompatibleProvider } from "@dogpile/sdk";

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const RESULTS_DIR = path.resolve(__dirname, "results");
    mkdirSync(RESULTS_DIR, { recursive: true });

    const PROVIDER_KIND = process.env.DOGPILE_EXAMPLE_PROVIDER ?? "deterministic";
    ```

    **Mission constant (D-07 — verbatim from huggingface):**

    Copy the EXACT mission string from `examples/huggingface-upload-gui/run-all-protocols.mjs` into a `MISSION` const here. Cross-link in a comment: "Same mission as examples/huggingface-upload-gui — diff to see 'plain protocol' vs 'coordinator-with-delegate'."

    **Deterministic provider helper (D-08):**

    Extract the deterministic provider construction from huggingface-upload-gui/run-all-protocols.mjs. Inline it here (per CONTEXT D-08 and Deferred Idea note: "only extract to examples/_lib/ if natural duplication forces it" — for a single new example, inline is correct; the planner judgment per CONTEXT is "researcher decides," and inlining is the lowest-coupling choice).

    The deterministic provider must produce coordinator plan-turn outputs that exercise:

    - At least TWO delegate decisions in one plan turn (so concurrency is observable). Use the array-of-delegates shape (Phase 3 fan-out).
    - At least one delegate decision with a `budget.timeoutMs` so tiny it forces a timeout failure (D-11 intentional failure).
    - A second plan turn after the failures lands so the structured failures block is observable.
    - A final `participate` decision that synthesizes the (partial) results.

    **Live-mode provider construction (D-08 — mirrors huggingface):**

    ```js
    function buildProvider() {
      if (PROVIDER_KIND === "openai-compatible") {
        const apiKey = process.env.OPENAI_API_KEY;
        const model = process.env.DOGPILE_EXAMPLE_MODEL ?? "gpt-4.1-mini";
        const baseURL = process.env.DOGPILE_EXAMPLE_BASE_URL;
        const path = process.env.DOGPILE_EXAMPLE_PATH;
        if (!apiKey) {
          console.error("OPENAI_API_KEY required for openai-compatible mode.");
          process.exit(1);
        }
        return createOpenAICompatibleProvider({
          id: "openai-live",
          model,
          apiKey,
          ...(baseURL ? { baseURL } : {}),
          ...(path ? { path } : {}),
        });
      }
      return buildDeterministicProvider();
    }
    ```

    **Local-provider clamp demo (D-12):**

    Build a separate deterministic provider with `metadata: { locality: "local" }`. Run a SECOND coordinator pass using this provider so `sub-run-concurrency-clamped` lands. Annotate output: "Notice that with locality=local, maxConcurrentChildren auto-clamps to 1; see the sub-run-concurrency-clamped event."

    Acceptable shape (per D-12): a sequential second run inside the script that flips locality. A `--local` flag is optional; pick the cleanest fit.

    **Two demo passes (D-10):**

    PASS 1 — `Dogpile.stream` (primary, parentRunIds chain demux):

    ```js
    const handle = Dogpile.stream({
      intent: MISSION,
      model: provider,
      protocol: "coordinator",
      tier: "balanced",
    });

    for await (const event of handle.events) {
      const chain = event.parentRunIds?.length
        ? `[${event.parentRunIds.join(" → ")}]`
        : "(root)";
      console.log(`${chain} ${event.type}`);
      // demux idiom — immediate-parent:
      // if (event.parentRunIds?.[event.parentRunIds.length - 1] === handle.runId) { ... }
    }

    const result = await handle.result;
    ```

    PASS 2 — `Dogpile.pile` (small block, ~15 lines max per CONTEXT D-10 scope-creep guard):

    ```js
    const piled = await Dogpile.pile({
      intent: MISSION,
      model: provider,
      protocol: "coordinator",
      tier: "balanced",
    });
    // Walk the embedded child trace:
    for (const event of piled.trace.events) {
      if (event.type === "sub-run-completed") {
        console.log(`  embedded child ${event.childRunId}: ${event.subResult.trace.events.length} events`);
      }
    }
    ```

    **Local-provider second pass (D-12):**

    ```js
    const localProvider = buildDeterministicProvider({ locality: "local" });
    console.log("\n--- Local-provider pass (auto-clamp to 1) ---");
    const localResult = await Dogpile.pile({
      intent: MISSION,
      model: localProvider,
      protocol: "coordinator",
      tier: "balanced",
      maxConcurrentChildren: 8, // explicit; clamp will silently force to 1
    });
    const clampEvents = localResult.trace.events.filter((e) => e.type === "sub-run-concurrency-clamped");
    console.log(`sub-run-concurrency-clamped events: ${clampEvents.length}`);
    ```

    **Result artifacts (mirror huggingface):**

    ```js
    writeFileSync(
      path.join(RESULTS_DIR, "latest.json"),
      JSON.stringify({ stream: result, pile: piled, local: localResult }, null, 2),
    );
    writeFileSync(
      path.join(RESULTS_DIR, "latest.md"),
      renderHumanReadableSummary({ result, piled, localResult }),
    );
    ```

    `renderHumanReadableSummary` is a helper that walks the three results and prints: number of delegated children, sub-run-failed count + reasons, total cost, sub-run-concurrency-clamped count, and a short structured-failures excerpt for the failing-child case (D-11).

    **Annotation comments inside the script (D-11 — "what to look at"):**

    Add inline comments at each emit site explaining what the reader should observe. Example: above the failing-budget delegate construction, comment `// D-11: tiny budget forces sub-run-failed → look for partialCost and the structured failures block in turn 2's coordinator prompt`.

    **Constraints:**

    - Single `.mjs` file (D-09). No package.json in the example dir.
    - Imports come from `@dogpile/sdk` (the built dist/), NOT from `../../src/...` (we are a consumer of the built package).
    - `examples/_lib/` extraction is NOT done in this plan (per Deferred Ideas note in CONTEXT — "only if natural duplication forces it"; one new example is not enough duplication).
    - Total target: 200-400 lines including comments. If the script approaches 400 lines, consider splitting README content out into the README task only (Task 2).

    Also create the empty results directory marker:

    ```sh
    examples/recursive-coordination/results/.gitkeep
    ```

    (an empty file; mirrors huggingface-upload-gui/results/ which already contains latest.json + latest.md as gitignored outputs).
  </action>
  <verify>
    <automated>pnpm run build && node examples/recursive-coordination/run.mjs</automated>
  </verify>
  <acceptance_criteria>
    - `test -f examples/recursive-coordination/run.mjs` exits 0.
    - `wc -l examples/recursive-coordination/run.mjs` reports >= 200 lines.
    - `grep -c "createOpenAICompatibleProvider" examples/recursive-coordination/run.mjs` >= 1 (D-08 live-mode wiring; satisfies DOCS-02 "wired against createOpenAICompatibleProvider").
    - `grep -c "DOGPILE_EXAMPLE_PROVIDER\|OPENAI_API_KEY\|DOGPILE_EXAMPLE_MODEL" examples/recursive-coordination/run.mjs` >= 3 (env-var contract mirrored from huggingface).
    - `grep -c "Dogpile\\.stream\|Dogpile\\.pile" examples/recursive-coordination/run.mjs` >= 2 (D-10 BOTH demos present).
    - `grep -c "parentRunIds" examples/recursive-coordination/run.mjs` >= 1 (D-10 chain demux).
    - `grep -c "locality.*local\|locality: \"local\"" examples/recursive-coordination/run.mjs` >= 1 (D-12 local-provider demo).
    - `grep -c "sub-run-concurrency-clamped" examples/recursive-coordination/run.mjs` >= 1 (D-12 clamp event observation).
    - `grep -c "sub-run-failed\|partialCost\|budget.*1\|timeoutMs" examples/recursive-coordination/run.mjs` >= 2 (D-11 intentionally-failing child).
    - `grep -c "from \"@dogpile/sdk\"" examples/recursive-coordination/run.mjs` >= 1 (built-package import — D-09).
    - `grep -c "from \"\\.\\./\\.\\./src" examples/recursive-coordination/run.mjs` == 0 (forbidden — must consume built package, not source).
    - `grep -c "results" examples/recursive-coordination/run.mjs` >= 2 (mkdirSync + writeFileSync).
    - `test -f examples/recursive-coordination/results/.gitkeep` exits 0.
    - `pnpm run build && node examples/recursive-coordination/run.mjs` exits 0 AND writes `examples/recursive-coordination/results/latest.json` and `latest.md`.
    - `package.json` `files` allowlist UNCHANGED: `node -e "const f=require('./package.json').files; if(f.some(x=>x.startsWith('examples/')))process.exit(1)"` exits 0.
  </acceptance_criteria>
  <done>
    Single-file runnable example wires the deterministic provider for repeatable default runs, createOpenAICompatibleProvider via env for live mode, two demo passes (.stream + .pile), the local-provider clamp demo, an intentionally-failing child, and writes results/ artifacts mirroring huggingface.
  </done>
</task>

<task type="auto">
  <name>Task 2: Author examples/recursive-coordination/README.md mirroring huggingface format (D-15 sibling)</name>
  <files>examples/recursive-coordination/README.md</files>
  <read_first>
    - examples/huggingface-upload-gui/README.md (entire file — mirror exact section structure)
    - examples/recursive-coordination/run.mjs (just authored — confirm exact env vars, command, output paths)
    - .planning/phases/05-documentation-changelog/05-CONTEXT.md (D-15 — full subsection mirroring huggingface format)
  </read_first>
  <action>
    Create `examples/recursive-coordination/README.md`. Mirror `examples/huggingface-upload-gui/README.md` section-for-section:

    ```markdown
    # Recursive Coordination — Hugging Face Upload GUI Plan, with Delegation

    This example reuses the same planning mission as `examples/huggingface-upload-gui/` — but instead of comparing the four protocols head-to-head, it wraps the mission in a **coordinator-with-delegate**: a single coordinator agent dispatches sub-missions through the new v0.4.0 `delegate` decision and weaves the partial results into a final synthesis.

    > **Why diff this against `huggingface-upload-gui/`?** Same mission, two scripts. The huggingface example shows protocol-level comparison; this example shows recursion *inside* the coordinator. The line-by-line diff is the clearest demonstration of what `delegate` adds.

    The harness exercises every Phase 1-4 surface a developer cares about:

    - Delegate dispatch + embedded child trace (Phase 1)
    - Live `parentRunIds` chain demux on `Dogpile.stream` (Phase 4)
    - Intentionally-failing child → `sub-run-failed` + `partialCost` → structured failures in the next coordinator turn (Phase 2 + Phase 4)
    - `locality: "local"` auto-clamp → `sub-run-concurrency-clamped` (Phase 3)

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

    > Dogpile reads no environment variables. The example script is the only env-aware layer; the SDK itself takes a fully constructed `ConfiguredModelProvider` object.

    ## Output

    The script writes:

    - `results/latest.json` — full run dump including the parent stream events, embedded child traces from `Dogpile.pile`, and the local-provider pass with its `sub-run-concurrency-clamped` event.
    - `results/latest.md` — human-readable summary: delegate count, sub-run-failed reasons, total cost (including partial costs from failed children), structured failures excerpt.

    Each run captures:

    - Delegated child count and their protocols
    - `sub-run-failed` events with `partialCost` (D-11 demonstration)
    - Structured failures block from the next coordinator prompt (Phase 4 D-07)
    - `sub-run-concurrency-clamped` events (D-12 local-provider demonstration)
    - Total token + cost rollup including partial costs

    ## See also

    - [`docs/recursive-coordination.md`](../../docs/recursive-coordination.md) — concepts, propagation rules, parentRunIds chain, structured failures, replay parity, worked example.
    - [`docs/recursive-coordination-reference.md`](../../docs/recursive-coordination-reference.md) — exhaustive event/error/option tables.
    - [`examples/huggingface-upload-gui/`](../huggingface-upload-gui/) — same mission, plain-protocol comparison.
    ```

    **Tone & format rules:**

    - Mirror `examples/huggingface-upload-gui/README.md` section structure: H1, intro paragraph(s), `## Run`, `## Output`, optional see-also.
    - Cross-links use relative paths from the example dir (`../../docs/...`, `../huggingface-upload-gui/`).
    - Match the existing example's tone: concise, no marketing.
    - Document live-mode env vars in a code block (D-15).
  </action>
  <verify>
    <automated>test -f examples/recursive-coordination/README.md && wc -l examples/recursive-coordination/README.md | awk '$1>=30{exit 0} {exit 1}'</automated>
  </verify>
  <acceptance_criteria>
    - `test -f examples/recursive-coordination/README.md` exits 0.
    - `wc -l examples/recursive-coordination/README.md` reports >= 30 lines.
    - `grep -c "^## Run\|^## Output" examples/recursive-coordination/README.md` >= 2 (mirror huggingface format — D-15).
    - `grep -c "DOGPILE_EXAMPLE_PROVIDER\|DOGPILE_EXAMPLE_MODEL\|OPENAI_API_KEY\|DOGPILE_EXAMPLE_BASE_URL\|DOGPILE_EXAMPLE_PATH" examples/recursive-coordination/README.md` >= 5 (full env-var table mirrored from huggingface).
    - `grep -c "results/latest\\.json\|results/latest\\.md" examples/recursive-coordination/README.md` >= 2 (output artifacts noted).
    - `grep -c "docs/recursive-coordination" examples/recursive-coordination/README.md` >= 1 (cross-link to docs).
    - `grep -c "huggingface-upload-gui" examples/recursive-coordination/README.md` >= 1 (acknowledge mission re-use, D-07 continuity note).
    - `package.json` `files` allowlist UNCHANGED.
  </acceptance_criteria>
  <done>
    examples/recursive-coordination/README.md mirrors the huggingface README section-for-section (Run, Output, env-var contract, artifacts), cross-links the docs pages, and is >=30 lines.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Example script ↔ user-supplied OPENAI_API_KEY | The runnable example handles a real API key in live mode. Keys must come from env, never logged into trace artifacts. |
| examples/ directory ↔ npm tarball | If `package.json` `files` accidentally globs `examples/`, the tarball ships demos to consumers. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-05 | I (Information disclosure) | OPENAI_API_KEY in live mode could leak into results/latest.json | mitigate | The script reads the key from env and passes it ONLY to `createOpenAICompatibleProvider`. Result-writing code MUST exclude provider config from the dump (only serialize `result`/`piled`/`localResult` from the SDK return values, which never echo the key). Add a comment in the script explicitly noting that `provider` itself is never serialized. |
| T-05-06 | I (Supply-chain bloat) | examples/ accidentally shipped in npm tarball | mitigate | Acceptance criterion verifies `package.json` `files` does NOT include `examples/`. Plan 06's release gate (`pnpm run pack:check`) catches any later regression. |
| T-05-07 | I (Hidden runtime impurity) | Any `process.env` read or Node-only API leaking into `src/runtime/` from this work | accept | The example script lives under `examples/`, not `src/`. CLAUDE.md's "no Node-only deps in src/runtime/" invariant is unaffected. |

The runnable example uses real provider keys (env-supplied). Keys are never logged into the trace.
</threat_model>

<verification>
- `pnpm run build` succeeds.
- `node examples/recursive-coordination/run.mjs` exits 0 in default (deterministic) mode.
- `examples/recursive-coordination/results/latest.json` and `latest.md` are written.
- `pnpm run typecheck` and `pnpm run test` remain green (no source changes).
- `package.json` `files` allowlist UNCHANGED (examples stay repo-only).
</verification>

<success_criteria>
- DOCS-02: `examples/recursive-coordination/` is a runnable example wired against `createOpenAICompatibleProvider` (live mode) exercising a real `delegate` flow end-to-end.
- D-07: HF mission reused verbatim; coordinator-with-delegate variant.
- D-08: Deterministic default + documented live mode.
- D-09: Single `.mjs` script.
- D-10: Both `Dogpile.stream` and `Dogpile.pile` demonstrated.
- D-11: Intentionally-failing child surfaces `sub-run-failed` + `partialCost` + structured failures.
- D-12: `locality: "local"` provider triggers `sub-run-concurrency-clamped`.
- D-15 (sibling README mirroring huggingface format).
</success_criteria>

<output>
After completion, create `.planning/phases/05-documentation-changelog/05-03-SUMMARY.md` recording:
- Final line counts for run.mjs and README.md
- Confirmation that the script ran successfully and wrote results/latest.{json,md}
- Confirmation that package.json files allowlist was NOT modified
- Note any issues encountered with the deterministic provider hand-rolling (and whether examples/_lib/ extraction was triggered or deferred)
</output>
