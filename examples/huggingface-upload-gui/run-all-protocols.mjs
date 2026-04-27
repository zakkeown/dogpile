#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const resultsDir = resolve(__dirname, "results");
const sdk = await import(resolve(repoRoot, "dist/index.js"));

const { Dogpile, createOpenAICompatibleProvider } = sdk;

const protocols = ["sequential", "broadcast", "shared", "coordinator"];
const agentCount = numberFromEnv("DOGPILE_EXAMPLE_AGENT_COUNT", 8);
const organizationalMemory = [
  "Prior organizational memory:",
  "- Large-folder upload planning succeeds when retry/resume manifests are first-class.",
  "- Previous GUI concepts over-expanded mobile upload; keep mobile to status and notifications until desktop control is safe.",
  "- Credential handling must be explicit, redacted, and outside model-visible logs."
].join("\n");

const mission = [
  "Create a set of plans for a multi-platform Hugging Face GUI that wraps the large folder upload CLI in a GUI manager.",
  "Assume the GUI manages `huggingface-cli upload-large-folder` jobs for very large datasets or model folders.",
  "Cover desktop, web-control, future mobile-companion considerations, architecture, UX, upload job lifecycle, credential handling, retry/resume behavior, observability, packaging, and a phased implementation roadmap.",
  "Each non-coordinator agent must autonomously choose a task-specific role, decide whether to contribute or abstain, and avoid duplicating prior completed work."
].join(" ");

const agents = Array.from({ length: agentCount }, (_, index) => ({
  id: `agent-${index}`,
  role: "autonomous-agent",
  instructions: [
    "Do not keep this generic role. For this task, choose your own specific role.",
    "Output these exact labels: role_selected, participation, rationale, contribution.",
    "If your contribution would duplicate completed work, set participation to abstain and explain why.",
    "If you contribute, make the contribution concrete, concise, and grounded in the mission."
  ].join(" ")
}));

const provider = createExampleProvider();
const startedAt = new Date().toISOString();
const runs = [];

for (const protocol of protocols) {
  const result = await Dogpile.pile({
    intent: mission,
    protocol: protocolConfig(protocol),
    tier: "balanced",
    model: provider,
    agents,
    budget: {
      maxTokens: 120_000,
      maxUsd: 1,
      timeoutMs: 120_000
    },
    seed: "260328990-hf-upload-gui-paper-faithful"
  });

  runs.push(summarizeRun(protocol, result));
}

const artifact = {
  kind: "dogpile-paper-faithfulness-protocol-comparison",
  schemaVersion: "1.0",
  example: "huggingface-upload-gui",
  paperRef: "arXiv:2603.28990v1",
  startedAt,
  completedAt: new Date().toISOString(),
  providerId: provider.id,
  mission,
  agentCount,
  agents,
  protocols,
  runs
};

await mkdir(resultsDir, { recursive: true });
await writeFile(resolve(resultsDir, "latest.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile(resolve(resultsDir, "latest.md"), renderMarkdown(artifact), "utf8");

console.log(renderConsoleSummary(artifact));
console.log(`\nWrote ${relativeFromRoot(resolve(resultsDir, "latest.json"))}`);
console.log(`Wrote ${relativeFromRoot(resolve(resultsDir, "latest.md"))}`);

function protocolConfig(protocol) {
  switch (protocol) {
    case "broadcast":
      return { kind: "broadcast", maxRounds: 2 };
    case "coordinator":
      return { kind: "coordinator", maxTurns: agents.length };
    case "shared":
      return { kind: "shared", maxTurns: agents.length, organizationalMemory };
    case "sequential":
      return { kind: "sequential", maxTurns: agents.length };
    default:
      throw new Error(`Unknown protocol: ${protocol}`);
  }
}

function createExampleProvider() {
  if (process.env.DOGPILE_EXAMPLE_PROVIDER === "openai-compatible") {
    const model = process.env.DOGPILE_EXAMPLE_MODEL;
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.DOGPILE_EXAMPLE_API_KEY;

    if (!model) {
      throw new Error("DOGPILE_EXAMPLE_MODEL is required for the openai-compatible example provider.");
    }
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY or DOGPILE_EXAMPLE_API_KEY is required for the openai-compatible example provider.");
    }

    return createOpenAICompatibleProvider({
      id: `openai-compatible:${model}`,
      model,
      apiKey,
      ...(process.env.DOGPILE_EXAMPLE_BASE_URL ? { baseURL: process.env.DOGPILE_EXAMPLE_BASE_URL } : {}),
      ...(process.env.DOGPILE_EXAMPLE_PATH ? { path: process.env.DOGPILE_EXAMPLE_PATH } : {})
    });
  }

  return createLocalPaperFaithfulProvider();
}

function createLocalPaperFaithfulProvider() {
  return {
    id: "local-paper-faithful-fixture:huggingface-upload-gui",
    async generate(request) {
      const metadata = request.metadata ?? {};
      const agentId = stringMetadata(metadata, "agentId", "agent-0");
      const protocol = stringMetadata(metadata, "protocol", "unknown");
      const phase = stringMetadata(metadata, "phase", "turn");
      const runId = stringMetadata(metadata, "runId", "run");
      const round = numberMetadata(metadata, "round", 0);
      const userText = request.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content)
        .join("\n\n");
      const text = renderPaperFaithfulTurn({
        agentId,
        protocol,
        phase,
        runId,
        round,
        userText,
      });
      const inputTokens = estimateTokens(request.messages.map((message) => message.content).join("\n"));
      const outputTokens = estimateTokens(text);

      return {
        text,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens
        },
        costUsd: 0,
        metadata: {
          providerMode: "local-paper-faithful-fixture"
        }
      };
    }
  };
}

function renderPaperFaithfulTurn(options) {
  if (options.protocol === "coordinator") {
    return renderCoordinatorTurn(options);
  }
  if (options.protocol === "broadcast") {
    return renderBroadcastTurn(options);
  }

  const profile = selectProfile(options);
  if (profile.participation === "abstain") {
    return renderDecision({
      role: profile.role,
      participation: "abstain",
      rationale: profile.rationale,
      contribution: "No contribution. The completed predecessor work already covers this slice well enough."
    });
  }

  return renderDecision({
    role: profile.role,
    participation: "contribute",
    rationale: profile.rationale,
    contribution: profile.contribution
  });
}

function renderCoordinatorTurn({ phase, agentId, userText }) {
  if (phase === "plan") {
    return renderDecision({
      role: "central coordinator and role allocator",
      participation: "contribute",
      rationale:
        "This protocol intentionally centralizes decomposition and worker selection in one coordinating agent.",
      contribution: [
        "Plan: build one desktop-first upload manager around a local process supervisor.",
        "Assigned roles: upload job supervisor, credential safety reviewer, UI workflow planner, cross-platform packager, observability tester.",
        "Known risk: the central plan may omit specialist concerns before workers see the task."
      ].join("\n")
    });
  }

  if (phase === "final-synthesis") {
    return [
      "role_selected: central coordinator and final synthesizer",
      "participation: contribute",
      "rationale: The centralized protocol requires one coordinator to integrate the assigned worker outputs into the final answer.",
      "contribution:",
      "release_plan:",
      "1. Build a local upload supervisor that shells out to `huggingface-cli upload-large-folder`, captures structured progress, and records every job manifest.",
      "2. Ship a desktop UI first, with queue controls, repo/folder selection, preflight checks, credential status, cancellation, retry, and diagnostics.",
      "3. Store tokens only in OS keychain or caller-provided environment; redact command logs and require explicit repo, branch, and visibility confirmation.",
      "4. Add localhost web-control after daemon auth and private-network protections exist; keep mobile companion to status and notifications.",
      "5. Gate release on fake-CLI failure injection, interrupted-upload recovery, cross-platform path tests, packaged-app smoke tests, and one live Hugging Face upload smoke."
    ].join("\n");
  }

  const workerProfile = selectProfile({ agentId, protocol: "coordinator", userText });
  return renderDecision({
    role: workerProfile.role,
    participation: workerProfile.participation,
    rationale: `Working inside the coordinator's assigned plan. ${workerProfile.rationale}`,
    contribution:
      workerProfile.participation === "abstain"
        ? "No contribution. The coordinator plan and other worker assignments already cover this slice."
        : workerProfile.contribution
  });
}

function renderBroadcastTurn(options) {
  const profile = selectProfile(options);

  if (options.round === 1) {
    return renderDecision({
      role: profile.role,
      participation: profile.participation,
      rationale: "Round 1 broadcasts intended specialization before final decisions.",
      contribution:
        profile.participation === "abstain"
          ? "Intention only: likely abstain unless the final round shows a missing gap."
          : `Intention only: I plan to cover ${profile.role}.`
    });
  }

  const promptContainsIntentions = hasBroadcastIntentions(options.userText);
  return renderDecision({
    role: profile.role,
    participation: profile.participation,
    rationale:
      promptContainsIntentions
        ? "Final decision informed by peer broadcast intentions."
        : "Round 2 did not expose peer intentions in the prompt, so this final decision cannot be paper-faithful.",
    contribution:
      profile.participation === "abstain"
        ? "No contribution. Round 1 intentions already cover this slice; adding more would duplicate peer work."
        : profile.contribution
  });
}

function selectProfile({ agentId, protocol, userText }) {
  const index = agentNumber(agentId);
  const priorText = userText.toLowerCase();
  const hasPrior = priorText.includes("prior contributions:") || priorText.includes("shared state:");
  const profiles = [
    {
      role: "repository workflow analyst",
      contribution:
        "Define the operator journey: authenticate, select repo type and branch, choose a local folder, run preflight checks, start upload, monitor progress, resolve failures, and verify remote files.",
      rationale: "The mission needs a concrete product workflow before platform or test details can be useful."
    },
    {
      role: "large-folder CLI process supervisor",
      contribution:
        "Wrap `huggingface-cli upload-large-folder` in a job supervisor with command manifests, process groups, stdout/stderr parsing, exit-code handling, cancellation, and restart-safe job IDs.",
      rationale: "The upload CLI is the technical center of gravity and needs an explicit supervision boundary."
    },
    {
      role: "credential and audit boundary reviewer",
      contribution:
        "Keep tokens in OS keychain or caller-owned environment, redact logs, separate repo metadata from secrets, require explicit repo/branch/visibility confirmation, and emit an audit trail without credential material.",
      rationale: "Large uploads touch account credentials and public/private repository decisions."
    },
    {
      role: "cross-platform shell and packaging architect",
      contribution:
        "Use a local supervisor core with desktop clients first. Prefer Tauri for footprint or Electron for mature process integration. Package signed macOS, Windows, and Linux builds after path, shell, and CLI-discovery tests pass.",
      rationale: "The GUI must work across OS process models, shells, path conventions, and app packaging systems."
    },
    {
      role: "progress observability designer",
      contribution:
        "Normalize upload states into queued, scanning, hashing, uploading, retrying, completed, failed, and cancelled. Persist progress events, command fingerprints, CLI version, stderr summaries, and final verification status.",
      rationale: "Operators need trustworthy progress and post-failure diagnostics for large folders."
    },
    {
      role: "failure recovery and resume tester",
      contribution:
        "Test tiny folders, many-file folders, sparse large fixtures, symlinks, hidden files, expired tokens, permission failures, network loss, process kill, restart, and retry using fake CLI scripts before live smoke runs.",
      rationale: "The highest-risk behavior is not the happy path; it is interruption and recovery."
    },
    {
      role: "remote control and mobile companion skeptic",
      contribution:
        "Constrain web-control to localhost with explicit auth and CSRF/private-network protection. Treat mobile as status and notifications only; do not attempt large-folder upload from mobile storage in v1.",
      rationale: "Remote surfaces are useful but can easily overexpand the v1 safety boundary."
    },
    {
      role: "emergent final integrator",
      contribution:
        "Synthesis: phase 1 builds the supervised CLI runner and manifest contract; phase 2 adds desktop queue UX; phase 3 adds retry/resume diagnostics; phase 4 packages signed desktop apps; phase 5 experiments with localhost web-control and mobile status.",
      rationale: "Prior completed work now covers the main slices; the remaining useful contribution is integration."
    }
  ];
  const profile = profiles[index % profiles.length];

  if (protocol === "shared" && index >= 6) {
    return {
      ...profile,
      participation: "abstain",
      rationale:
        "Shared memory already contains enough current-task coverage, so the best action is self-abstention to avoid role duplication."
    };
  }

  if (protocol === "broadcast" && hasBroadcastIntentions(userText) && index === 6) {
    return {
      ...profile,
      participation: "abstain",
      rationale:
        "Round 1 peer intentions already cover web-control risk, platform boundaries, and release staging."
    };
  }

  if (protocol === "coordinator" && index >= 6) {
    return {
      ...profile,
      participation: "abstain",
      rationale:
        "The coordinator's worker plan has enough assigned coverage, so this worker should avoid duplicating peer assignments."
    };
  }

  if (protocol === "sequential" && hasPrior && index === 6) {
    return {
      ...profile,
      participation: "abstain",
      rationale:
        "The predecessor outputs already cover remote-control risk, platform boundaries, and release staging."
    };
  }

  return {
    ...profile,
    participation: "contribute"
  };
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

function summarizeRun(protocol, result) {
  const transcript = result.transcript.map((entry, index) => {
    const decision = entry.decision ?? parseDecision(entry.output);
    return {
      turn: index + 1,
      agentId: entry.agentId,
      role: entry.role,
      selectedRole: decision.selectedRole,
      participation: decision.participation,
      inputPreview: truncate(entry.input, 700),
      inputSignals: {
        hasPriorContributions: entry.input.includes("Prior contributions:"),
        hasSharedState: entry.input.includes("Shared state:"),
        hasEmptySharedState: entry.input.includes("Shared state:\n(empty)"),
        sharedState: extractSharedState(entry.input),
        hasBroadcastIntentions: hasBroadcastIntentions(entry.input)
      },
      output: entry.output
    };
  });
  const checks = paperFaithfulnessChecks(protocol, result, transcript);
  const score = scoreRun(protocol, result, transcript, checks);

  return {
    protocol,
    runId: result.trace.runId,
    providerId: result.trace.modelProviderId,
    output: result.output,
    cost: result.cost,
    eventTypes: result.trace.events.map((event) => event.type),
    eventCount: result.trace.events.length,
    transcript,
    selectedRoles: transcript.map((entry) => entry.selectedRole).filter(Boolean),
    participatingTurns: transcript.filter((entry) => entry.participation === "contribute").length,
    abstainedTurns: transcript.filter((entry) => entry.participation === "abstain").length,
    checks,
    score
  };
}

function paperFaithfulnessChecks(protocol, result, transcript) {
  const checks = [
    check(
      "anonymous_agent_pool",
      result.trace.agentsUsed.every((agent) => agent.role === "autonomous-agent"),
      "Agents are anonymous and do not encode product/platform/QA roles before the run."
    ),
    check(
      "structured_autonomous_role_selection",
      transcript.every((entry) => Boolean(entry.selectedRole) && entry.selectedRole !== entry.role),
      "Every turn emits a task-specific selected role separate from the generic agent role."
    ),
    check(
      "voluntary_self_abstention_visible",
      transcript.some((entry) => entry.participation === "abstain"),
      "At least one agent voluntarily abstains when it would duplicate prior work."
    )
  ];

  if (protocol === "sequential") {
    checks.push(
      check(
        "predecessor_outputs_visible",
        transcript.slice(1).every((entry) => entry.inputSignals.hasPriorContributions),
        "Later sequential agents receive completed predecessor outputs."
      ),
      check(
        "final_turn_integrates",
        /synthesis|phase 1|phase 2|phase 3/iu.test(result.output),
        "The final sequential turn acts as an emergent synthesis instead of a pre-assigned specialist."
      )
    );
  }

  if (protocol === "broadcast") {
    const broadcastEvents = result.trace.events.filter((event) => event.type === "broadcast");
    checks.push(
      check(
        "two_broadcast_rounds",
        broadcastEvents.length === 2,
        "Broadcast runs an intention round and a final-decision round."
      ),
      check(
        "round_two_prompt_contains_intentions",
        transcript.slice(agentCount).every((entry) => entry.inputSignals.hasBroadcastIntentions),
        "Round 2 prompts expose round 1 intentions to the model."
      )
    );
  }

  if (protocol === "shared") {
    const firstSharedState = transcript[0]?.inputSignals.sharedState;
    const currentRunPeerOutputsHidden = result.transcript.every((entry) =>
      result.transcript.every((peer) => peer.agentId === entry.agentId || !entry.input.includes(peer.output))
    );
    checks.push(
      check(
        "shared_memory_visible",
        transcript.every(
          (entry) =>
            entry.inputSignals.hasSharedState &&
            entry.inputSignals.sharedState?.includes("Prior organizational memory:") === true
        ),
        "Each shared agent receives organizational memory."
      ),
      check(
        "same_organizational_memory_snapshot",
        firstSharedState !== undefined &&
          transcript.every((entry) => entry.inputSignals.sharedState === firstSharedState),
        "Every shared agent sees the same organizational-memory snapshot."
      ),
      check(
        "simultaneous_current_task_decisions",
        currentRunPeerOutputsHidden,
        "Shared agents decide simultaneously rather than reading current-run peer updates."
      )
    );
  }

  if (protocol === "coordinator") {
    const workerEntries = result.transcript.slice(1, -1);
    const workersParallelAfterPlan =
      workerEntries.length > 1 &&
      workerEntries.every((entry) =>
        workerEntries.every((peer) => peer.agentId === entry.agentId || !entry.input.includes(peer.output))
      );
    checks.push(
      check(
        "central_coordinator_plan",
        transcript[0]?.selectedRole?.includes("coordinator") === true,
        "The first agent centrally decomposes and assigns work."
      ),
      check(
        "coordinator_final_synthesis",
        transcript.at(-1)?.selectedRole?.includes("coordinator") === true,
        "The coordinator produces the final synthesis."
      ),
      check(
        "workers_parallel_after_plan",
        workersParallelAfterPlan,
        "Workers execute in parallel after the coordinator plan."
      )
    );
  }

  return checks;
}

function scoreRun(protocol, result, transcript, checks) {
  const coverageScore = scoreCoverage(result.output);
  const roleAutonomyScore = Math.round((checks.filter((item) => item.pass).length / checks.length) * 35);
  const participationScore = transcript.some((entry) => entry.participation === "abstain") ? 15 : 5;
  const synthesisScore = /synthesis|release_plan|phase 1|phase 2|phase 3/iu.test(result.output) ? 20 : 10;
  const score = Math.min(100, coverageScore + roleAutonomyScore + participationScore + synthesisScore);

  return {
    kind: "paper-faithfulness-smoke-score",
    protocol,
    score,
    maxScore: 100,
    dimensions: [
      { name: "coverage", score: coverageScore, maxScore: 30 },
      { name: "role_autonomy_and_protocol_checks", score: roleAutonomyScore, maxScore: 35 },
      { name: "voluntary_participation", score: participationScore, maxScore: 15 },
      { name: "usable_synthesis", score: synthesisScore, maxScore: 20 }
    ]
  };
}

function scoreCoverage(output) {
  const checks = [
    /desktop|tauri|electron/iu,
    /huggingface-cli upload-large-folder|upload-large-folder/iu,
    /credential|token|keychain/iu,
    /retry|resume|restart|recovery/iu,
    /progress|observability|stderr|manifest/iu,
    /test|fixture|smoke|release gate/iu
  ];
  return checks.reduce((score, pattern) => score + (pattern.test(output) ? 5 : 0), 0);
}

function check(id, pass, description) {
  return {
    id,
    pass,
    description
  };
}

function parseDecision(output) {
  return {
    selectedRole: matchLine(output, /^role_selected:\s*(.+)$/imu),
    participation: matchLine(output, /^participation:\s*(contribute|abstain)$/imu)
  };
}

function renderMarkdown(artifact) {
  const lines = [
    "# Hugging Face Upload GUI Paper-Faithful Protocol Comparison",
    "",
    `Generated: ${artifact.completedAt}`,
    `Provider: \`${artifact.providerId}\``,
    `Paper reference: \`${artifact.paperRef}\``,
    `Anonymous agent count: ${artifact.agentCount}`,
    "",
    "## Mission",
    "",
    artifact.mission,
    "",
    "## Summary",
    "",
    "| Protocol | Score | Events | Turns | Contrib | Abstain | Tokens | Failed Checks | Final Output Preview |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |"
  ];

  for (const run of artifact.runs) {
    const failed = run.checks.filter((item) => !item.pass).map((item) => item.id).join(", ") || "none";
    lines.push(
      `| ${run.protocol} | ${run.score.score} | ${run.eventCount} | ${run.transcript.length} | ${run.participatingTurns} | ${run.abstainedTurns} | ${run.cost.totalTokens} | ${escapeTable(failed)} | ${escapeTable(truncate(oneLine(run.output), 110))} |`
    );
  }

  lines.push(
    "",
    "## Interpretation",
    "",
    "This is a paper-faithfulness smoke test, not a statistical reproduction. It uses anonymous agents, autonomous role-selection output, visible abstention, and protocol-specific checks. Failed checks are intentional evidence when the current SDK runner does not expose the same information flow described by the paper."
  );

  for (const run of artifact.runs) {
    lines.push(
      "",
      `## ${titleCase(run.protocol)}`,
      "",
      "### Paper-Faithfulness Checks",
      "",
      "| Check | Result | Description |",
      "| --- | --- | --- |"
    );
    for (const item of run.checks) {
      lines.push(`| ${item.id} | ${item.pass ? "PASS" : "FAIL"} | ${escapeTable(item.description)} |`);
    }

    lines.push("", "### Selected Roles", "");
    for (const entry of run.transcript) {
      lines.push(
        `- ${entry.agentId}: ${entry.selectedRole ?? "(missing)"}; participation=${entry.participation ?? "(missing)"}`
      );
    }

    lines.push("", "### Final Output", "", run.output, "", "### Transcript");
    for (const entry of run.transcript) {
      lines.push("", `#### ${entry.turn}. ${entry.agentId}`, "", entry.output);
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderConsoleSummary(artifact) {
  const lines = [
    "Dogpile paper-faithfulness comparison: Hugging Face upload GUI plans",
    `Provider: ${artifact.providerId}`,
    `Anonymous agents: ${artifact.agentCount}`,
    ""
  ];

  for (const run of artifact.runs) {
    const failed = run.checks.filter((item) => !item.pass).map((item) => item.id).join(", ") || "none";
    lines.push(
      `${run.protocol.padEnd(11)} score=${String(run.score.score).padStart(3)} turns=${String(run.transcript.length).padStart(2)} abstain=${String(run.abstainedTurns).padStart(2)} failed=${failed}`
    );
  }

  return lines.join("\n");
}

function stringMetadata(metadata, key, fallback) {
  const value = metadata[key];
  return typeof value === "string" ? value : fallback;
}

function numberMetadata(metadata, key, fallback) {
  const value = metadata[key];
  return typeof value === "number" ? value : fallback;
}

function numberFromEnv(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function matchLine(text, pattern) {
  const match = text.match(pattern);
  return match?.[1]?.trim();
}

function hasBroadcastIntentions(text) {
  return /broadcast intentions:|prior broadcast intentions|peer intentions|round 1 intentions/iu.test(text);
}

function extractSharedState(text) {
  const marker = "Shared state:\n";
  const markerIndex = text.indexOf(marker);
  return markerIndex === -1 ? undefined : text.slice(markerIndex + marker.length).trim();
}

function agentNumber(agentId) {
  const match = agentId.match(/(\d+)$/u);
  return match ? Number(match[1]) : 0;
}

function estimateTokens(text) {
  return Math.max(1, text.split(/\s+/u).filter(Boolean).length);
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function oneLine(text) {
  return text.replace(/\s+/gu, " ").trim();
}

function escapeTable(text) {
  return text.split("|").join("\\|");
}

function titleCase(text) {
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}

function relativeFromRoot(path) {
  return path.slice(repoRoot.length + 1);
}
