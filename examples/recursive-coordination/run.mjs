#!/usr/bin/env node
// examples/recursive-coordination/run.mjs
//
// Runnable demo of v0.4.0 recursive coordination. Reuses the Hugging Face
// upload GUI planning mission from examples/huggingface-upload-gui/ and wraps
// it in a coordinator that delegates sub-steps. Default mode uses a local
// deterministic provider - no network/keys required. Set
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
//   3. intentionally-failing child -> sub-run-failed + partialCost +
//      structured failures in next coordinator prompt (Phase 2 + Phase 4)
//   4. locality: "local" auto-clamp -> sub-run-concurrency-clamped (Phase 3)
//   5. Dogpile.pile() embedded-trace shape readback (Phase 1)

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Dogpile, DogpileError, createOpenAICompatibleProvider } from "@dogpile/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.resolve(__dirname, "results");
mkdirSync(RESULTS_DIR, { recursive: true });

const PROVIDER_KIND = process.env.DOGPILE_EXAMPLE_PROVIDER ?? "deterministic";

// Same mission as examples/huggingface-upload-gui - diff the two examples to
// see "plain protocol comparison" vs "coordinator-with-delegate".
const MISSION = [
  "Create a set of plans for a multi-platform Hugging Face GUI that wraps the large folder upload CLI in a GUI manager.",
  "Assume the GUI manages `huggingface-cli upload-large-folder` jobs for very large datasets or model folders.",
  "Cover desktop, web-control, future mobile-companion considerations, architecture, UX, upload job lifecycle, credential handling, retry/resume behavior, observability, packaging, and a phased implementation roadmap.",
  "Each non-coordinator agent must autonomously choose a task-specific role, decide whether to contribute or abstain, and avoid duplicating prior completed work."
].join(" ");

const agents = [
  {
    id: "coordinator",
    role: "recursive coordinator",
    instructions: "Use delegate decisions for sub-missions. When sub-run failures appear, synthesize around them instead of retrying forever. Finish with role_selected, participation, rationale, and contribution."
  }
];

const streamProvider = buildProvider();
const startedAt = new Date().toISOString();

console.log("# Recursive Coordination Example");
console.log(`Provider: ${streamProvider.id}`);
console.log("\n--- Stream pass (live parentRunIds demux) ---");

const handle = Dogpile.stream({
  intent: MISSION,
  model: streamProvider,
  agents,
  protocol: "coordinator",
  tier: "balanced",
  maxConcurrentChildren: 4,
  defaultSubRunTimeoutMs: 5_000,
  budget: { timeoutMs: 60_000 }
});

const streamEvents = [];
for await (const event of handle) {
  streamEvents.push(event);
  const chain = event.parentRunIds?.length ? `[${event.parentRunIds.join(" -> ")}]` : "(root)";
  console.log(`${chain} ${event.type}${event.childRunId ? ` child=${event.childRunId}` : ""}`);
  // Demux idiom - immediate parent:
  // if (event.parentRunIds?.[event.parentRunIds.length - 1] === handle.runId) { ... }
}

const result = await handle.result;
console.log(`Stream result: ${truncate(oneLine(result.output), 120)}`);

console.log("\n--- Pile pass (embedded child trace readback) ---");
const pileProvider = buildProvider();
const piled = await Dogpile.pile({
  intent: MISSION,
  model: pileProvider,
  agents,
  protocol: "coordinator",
  tier: "balanced",
  maxConcurrentChildren: 4,
  defaultSubRunTimeoutMs: 5_000,
  budget: { timeoutMs: 60_000 }
});

for (const event of piled.trace.events) {
  if (event.type === "sub-run-completed") {
    console.log(`  embedded child ${event.childRunId}: ${event.subResult.trace.events.length} events`);
  }
}

console.log("\n--- Local-provider pass (auto-clamp to 1) ---");
const localProvider = buildDeterministicProvider({ locality: "local" });
const localResult = await Dogpile.pile({
  intent: MISSION,
  model: localProvider,
  agents,
  protocol: "coordinator",
  tier: "balanced",
  maxConcurrentChildren: 8,
  defaultSubRunTimeoutMs: 5_000,
  budget: { timeoutMs: 60_000 }
});
const clampEvents = localResult.trace.events.filter((event) => event.type === "sub-run-concurrency-clamped");
console.log("Notice that with locality=local, maxConcurrentChildren auto-clamps to 1.");
console.log(`sub-run-concurrency-clamped events: ${clampEvents.length}`);

const artifact = {
  kind: "dogpile-recursive-coordination-example",
  schemaVersion: "1.0",
  example: "recursive-coordination",
  startedAt,
  completedAt: new Date().toISOString(),
  providerId: streamProvider.id,
  mission: MISSION,
  // T-05-05: never serialize the provider object itself; live credentials stay
  // inside the caller-constructed provider and are not present in RunResult.
  stream: summarizeResult(result, streamEvents),
  pile: summarizeResult(piled),
  local: summarizeResult(localResult)
};

writeFileSync(path.join(RESULTS_DIR, "latest.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
writeFileSync(path.join(RESULTS_DIR, "latest.md"), renderHumanReadableSummary(artifact), "utf8");

console.log(`\nWrote ${path.relative(process.cwd(), path.join(RESULTS_DIR, "latest.json"))}`);
console.log(`Wrote ${path.relative(process.cwd(), path.join(RESULTS_DIR, "latest.md"))}`);

function buildProvider() {
  if (PROVIDER_KIND === "openai-compatible") {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.DOGPILE_EXAMPLE_MODEL ?? "gpt-4.1-mini";
    const baseURL = process.env.DOGPILE_EXAMPLE_BASE_URL;
    const requestPath = process.env.DOGPILE_EXAMPLE_PATH;
    if (!apiKey) {
      console.error("OPENAI_API_KEY required for openai-compatible mode.");
      process.exit(1);
    }
    return createOpenAICompatibleProvider({
      id: "openai-live",
      model,
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      ...(requestPath ? { path: requestPath } : {})
    });
  }
  return buildDeterministicProvider();
}

function buildDeterministicProvider(options = {}) {
  const state = {
    rootPlanTurns: 0,
    childTurnsByIntent: new Map()
  };
  return {
    id: options.locality === "local" ? "local-det-recursive-coordinator" : "det-recursive-coordinator",
    ...(options.locality ? { metadata: { locality: options.locality } } : {}),
    async generate(request) {
      const metadata = request.metadata ?? {};
      const protocol = stringMetadata(metadata, "protocol", "unknown");
      const phase = stringMetadata(metadata, "phase", "turn");
      const runId = stringMetadata(metadata, "runId", "run");
      const userText = request.messages.map((message) => message.content).join("\n\n");
      if (protocol === "broadcast") {
        await abortableDelay(25, request.signal);
        throw new DogpileError({
          code: "provider-timeout",
          message: "Deterministic recursive-coordination example forced the risk-audit child to fail.",
          retryable: true,
          providerId: this.id,
          detail: { source: "provider", example: "intentional-child-failure" }
        });
      }
      const text = renderDeterministicTurn({ protocol, phase, runId, userText, state });
      const inputTokens = estimateTokens(request.messages.map((message) => message.content).join("\n"));
      const outputTokens = estimateTokens(text);

      return {
        text,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens
        },
        costUsd: Number(((inputTokens + outputTokens) / 1_000_000).toFixed(8)),
        metadata: {
          providerMode: "local-recursive-coordination-fixture"
        }
      };
    }
  };
}

function renderDeterministicTurn({ protocol, phase, runId, userText, state }) {
  if (protocol === "coordinator" && phase === "plan" && isRootPrompt(userText)) {
    state.rootPlanTurns += 1;
    if (state.rootPlanTurns === 1) {
      return renderInitialDelegateWave();
    }
    if (userText.includes("## Sub-run failures since last decision")) {
      return renderFinalSynthesis({
        rationale: "A structured failure roster is present, so the coordinator can synthesize the successful sub-runs and explicitly carry the failed risk forward.",
        contribution: [
          "Recursive synthesis:",
          "- Requirements analysis establishes a desktop-first queue around `huggingface-cli upload-large-folder`.",
          "- UX exploration keeps web-control and mobile companion surfaces behind a later safety gate.",
          "- The intentionally failed risk audit is visible as structured failure context with partialCost, so the roadmap reserves a follow-up threat-model pass instead of hiding the miss.",
          "- Phase 1 ships a supervised CLI runner plus manifests; Phase 2 adds desktop queue UX; Phase 3 hardens retry/resume; Phase 4 adds packaging and live Hugging Face smoke tests."
        ].join("\n")
      });
    }
    return renderFinalSynthesis({
      rationale: "The delegated sub-runs returned enough coverage to finalize.",
      contribution: "Final plan: build the local upload supervisor, desktop queue UX, retry/resume diagnostics, signed packages, and a cautious localhost web-control experiment."
    });
  }

  if (protocol === "coordinator" && phase === "final-synthesis") {
    return renderFinalSynthesis({
      rationale: "The coordinator already merged delegated work during the plan phase.",
      contribution: "Final recursive coordination output is captured in the coordinator plan turn."
    });
  }

  const intentKey = inferIntentKey(userText);
  const turn = (state.childTurnsByIntent.get(intentKey) ?? 0) + 1;
  state.childTurnsByIntent.set(intentKey, turn);
  if (intentKey === "ux") {
    return renderDecision({
      role: "desktop upload workflow designer",
      participation: turn === 1 ? "contribute" : "abstain",
      rationale: "The UX slice needs a concrete operator journey without expanding mobile upload scope.",
      contribution:
        turn === 1
          ? "Design a desktop-first flow: select repo and branch, choose folder, run preflight, start upload, monitor queue/progress, cancel safely, retry failed chunks, and verify remote files. Web-control is localhost-only; mobile is status and notifications."
          : "No additional UX contribution; prior sub-run output already covers the workflow."
    });
  }

  return renderDecision({
    role: "requirements and architecture analyst",
    participation: "contribute",
    rationale: "This child run decomposes the upload manager into buildable surfaces.",
    contribution: "Architecture: a local supervisor shells out to `huggingface-cli upload-large-folder`, persists job manifests, normalizes progress states, and exposes a desktop UI before any remote-control surface."
  });
}

function renderInitialDelegateWave() {
  // D-11: tiny budget forces sub-run-failed -> look for partialCost and the
  // structured failures block in turn 2's coordinator prompt.
  return [
    "delegate:",
    "```json",
    JSON.stringify([
      {
        protocol: "sequential",
        intent: `${MISSION}\n\nSub-mission: produce requirements analysis and architecture boundaries.`
      },
      {
        protocol: "sequential",
        intent: `${MISSION}\n\nSub-mission: explore the desktop upload workflow, future web-control, and mobile companion boundaries.`
      },
      {
        protocol: "broadcast",
        intent: `${MISSION}\n\nSub-mission: run a credential and failure-risk audit. This deterministic child intentionally overruns a tiny timeout so the parent captures partialCost.`,
        budget: { timeoutMs: 1 }
      }
    ], null, 2),
    "```"
  ].join("\n");
}

function renderDecision({ role, participation, rationale, contribution }) {
  return [
    `role_selected: ${role}`,
    `participation: ${participation}`,
    `rationale: ${rationale}`,
    "contribution:",
    contribution
  ].join("\n");
}

function renderFinalSynthesis({ rationale, contribution }) {
  return renderDecision({
    role: "recursive coordinator and final synthesizer",
    participation: "contribute",
    rationale,
    contribution
  });
}

function summarizeResult(result, liveEvents = []) {
  const events = result.trace.events;
  const subRunEvents = events.filter((event) => event.type.startsWith("sub-run-"));
  const failed = events.filter((event) => event.type === "sub-run-failed");
  const completed = events.filter((event) => event.type === "sub-run-completed");
  const structuredFailurePrompts = result.trace.providerCalls.map((call) =>
    call.request.messages.map((message) => message.content).join("\n\n")
  ).filter((text) => text.includes("## Sub-run failures since last decision"))
    .map((text) => truncate(text.slice(text.indexOf("## Sub-run failures since last decision")), 1_200));
  return {
    runId: result.trace.runId,
    output: result.output,
    cost: result.cost,
    eventCount: events.length,
    eventTypes: events.map((event) => event.type),
    delegatedChildren: new Set(subRunEvents.map((event) => event.childRunId).filter((id) => typeof id === "string")).size,
    completedChildren: completed.length,
    failedChildren: failed.map((event) => ({ childRunId: event.childRunId, code: event.error.code, reason: event.error.detail?.reason, partialCost: event.partialCost })),
    clampEvents: events.filter((event) => event.type === "sub-run-concurrency-clamped")
      .map((event) => ({ requestedMax: event.requestedMax, effectiveMax: event.effectiveMax, providerId: event.providerId })),
    structuredFailurePrompts,
    liveParentChains: liveEvents.filter((event) => event.parentRunIds?.length)
      .map((event) => ({ type: event.type, parentRunIds: event.parentRunIds })).slice(0, 12)
  };
}

function renderHumanReadableSummary(artifact) {
  const liveChains = artifact.stream.liveParentChains.map((entry) => `- ${entry.type}: [${entry.parentRunIds.join(" -> ")}]`).join("\n");
  const localClamp = artifact.local.clampEvents.length > 0
    ? `Captured ${artifact.local.clampEvents.length} sub-run-concurrency-clamped event(s).`
    : "No sub-run-concurrency-clamped events captured.";
  return `# Recursive Coordination Example

Generated: ${artifact.completedAt}
Provider: \`${artifact.providerId}\`

## Mission

${artifact.mission}

## Summary

| Pass | Delegated children | Failed | Clamp events | Cost USD |
| --- | ---: | ---: | ---: | ---: |
${renderSummaryRow("stream", artifact.stream)}
${renderSummaryRow("pile", artifact.pile)}
${renderSummaryRow("local", artifact.local)}

## Failed Children

${renderFailures("stream", artifact.stream)}
${renderFailures("pile", artifact.pile)}
${renderFailures("local", artifact.local)}

## Structured Failures Prompt Excerpt

${artifact.stream.structuredFailurePrompts[0] ?? "(no structured failures prompt captured)"}

## Live Parent Chains

${liveChains}

## Local Clamp

${localClamp}
`;
}

function renderSummaryRow(name, summary) {
  return `| ${name} | ${summary.delegatedChildren} | ${summary.failedChildren.length} | ${summary.clampEvents.length} | ${summary.cost.usd.toFixed(8)} |`;
}

function renderFailures(name, summary) {
  if (summary.failedChildren.length === 0) {
    return `- ${name}: none`;
  }
  return summary.failedChildren
    .map((failure) =>
      `- ${name}: ${failure.childRunId} code=${failure.code} reason=${failure.reason ?? "n/a"} partialCost=$${failure.partialCost.usd.toFixed(8)}`
    )
    .join("\n");
}

function isRootPrompt(userText) {
  return userText.includes("Coordinator coordinator: assign the work");
}

function inferIntentKey(userText) {
  const lower = userText.toLowerCase();
  if (lower.includes("workflow") || lower.includes("mobile companion")) {
    return "ux";
  }
  if (lower.includes("risk audit") || lower.includes("credential")) {
    return "risk";
  }
  return "requirements";
}

function stringMetadata(metadata, key, fallback) {
  const value = metadata[key];
  return typeof value === "string" ? value : fallback;
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function abortableDelay(ms, signal) {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("aborted"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    }, { once: true });
  });
}

function oneLine(text) {
  return text.replace(/\s+/gu, " ").trim();
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}...`;
}
