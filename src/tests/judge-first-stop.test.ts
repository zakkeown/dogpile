import { describe, expect, it } from "vitest";
import { budget, convergence, evaluateTerminationStop, firstOf, judge } from "../index.js";
import type { JsonObject, TerminationEvaluationContext } from "../index.js";

describe("judge-first stop behavior", () => {
  it.each([
    [
      "accepted",
      {
        type: "accept",
        score: 0.72,
        rationale: "The release triage answer satisfies the judge rubric.",
        metadata: { judge: "acceptance-fixture" }
      }
    ],
    [
      "rejected",
      {
        type: "reject",
        score: 0.99,
        rationale: "A hard evidence requirement is missing.",
        metadata: { judge: "rejection-fixture" }
      }
    ],
    [
      "score-threshold",
      {
        type: "score",
        score: 0.84,
        rationale: "The answer meets the minimum quality threshold.",
        metadata: { judge: "score-fixture" }
      }
    ]
  ] as const)("records a judge %s stop before later eligible stop conditions", (_name, decision) => {
    const judgeCondition = judge({ rubric: "Stop when the judge returns a terminal decision.", minScore: 0.8 });
    const budgetCondition = budget({ maxIterations: 2 });
    const convergenceCondition = convergence({ stableTurns: 2, minSimilarity: 1 });
    const terminate = firstOf(judgeCondition, budgetCondition, convergenceCondition);

    const record = evaluateTerminationStop(
      terminate,
      terminationContext({
        iteration: 2,
        judgeDecision: decision,
        transcript: [
          transcriptEntry("planner", "stable release decision"),
          transcriptEntry("critic", "stable release decision")
        ]
      })
    );

    const expectedDetail: JsonObject = {
      decision: decision.type,
      score: decision.score,
      ...(_name === "score-threshold" ? { minScore: 0.8 } : {}),
      rationale: decision.rationale,
      metadata: decision.metadata
    };

    expect(record).toMatchObject({
      kind: "termination-stop",
      rootCondition: terminate,
      firedCondition: judgeCondition,
      reason: "judge",
      normalizedReason: `judge:${_name}`,
      judgeReason: _name,
      detail: expectedDetail,
      firstOf: {
        kind: "firstOf-stop",
        winningConditionIndex: 0,
        winningCondition: judgeCondition,
        firedCondition: judgeCondition
      }
    });
    expect(record?.firstOf?.evaluated).toHaveLength(1);
    expect(record?.firstOf?.evaluated[0]).toMatchObject({
      type: "stop",
      condition: judgeCondition,
      reason: "judge",
      normalizedReason: `judge:${_name}`,
      judgeReason: _name
    });
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });
});

function terminationContext(
  overrides: Pick<TerminationEvaluationContext, "judgeDecision" | "iteration" | "transcript">
): TerminationEvaluationContext {
  return {
    runId: "run-judge-first-stop",
    protocol: "sequential",
    tier: "fast",
    cost: { usd: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    events: [],
    ...overrides
  };
}

function transcriptEntry(role: string, output: string): TerminationEvaluationContext["transcript"][number] {
  return {
    agentId: `${role}-agent`,
    role,
    input: `Input for ${role}`,
    output
  };
}
