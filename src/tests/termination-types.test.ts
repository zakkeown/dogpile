import { describe, expect, it } from "vitest";
import { createDeterministicModelProvider } from "../internal.js";
import type {
  BudgetStopReason,
  BudgetTerminationCondition,
  ConvergenceTerminationCondition,
  DogpileOptions,
  FirstOfTerminationCondition,
  FirstOfTerminationInput,
  FirstOfTerminationOutput,
  JudgeEvaluationDecision,
  JudgeStopReason,
  JudgeTerminationCondition,
  ModelRequest,
  ModelResponse,
  NormalizedStopReason,
  StopTerminationDecision,
  TerminationCondition,
  TerminationEvaluationContext
} from "../index.js";
import {
  budget,
  combineTerminationDecisions,
  convergence,
  evaluateBudget,
  evaluateConvergence,
  evaluateTermination,
  evaluateTerminationStop,
  evaluateJudge,
  firstOf,
  judge,
  run
} from "../index.js";

describe("termination public types", () => {
  it("creates JSON-serializable budget, convergence, judge, and firstOf termination helpers", () => {
    const budgetCondition = budget({ maxUsd: 0.25, maxTokens: 20_000 });
    const convergenceCondition = convergence({ stableTurns: 2, minSimilarity: 0.92 });
    const judgeCondition = judge({
      rubric: {
        accepts: "The answer satisfies the mission and cites the coordination tradeoffs."
      },
      minScore: 0.8
    });
    const composed = firstOf(budgetCondition, convergenceCondition, judgeCondition);

    expect(composed).toEqual({
      kind: "firstOf",
      conditions: [budgetCondition, convergenceCondition, judgeCondition]
    });
    expect(JSON.parse(JSON.stringify(composed))).toEqual(composed);
  });

  it("requires firstOf to receive at least one condition at runtime", () => {
    const unsafeFirstOf = firstOf as unknown as () => FirstOfTerminationCondition;

    expect(() => unsafeFirstOf()).toThrow(RangeError);
  });

  it("defines composable termination conditions and firstOf input/output contracts", () => {
    const budget: BudgetTerminationCondition = {
      kind: "budget",
      maxUsd: 0.25,
      maxTokens: 20_000
    };
    const convergence: ConvergenceTerminationCondition = {
      kind: "convergence",
      stableTurns: 2,
      minSimilarity: 0.92
    };
    const judge: JudgeTerminationCondition = {
      kind: "judge",
      rubric: {
        accepts: "The answer satisfies the mission and cites the coordination tradeoffs."
      },
      minScore: 0.8
    };
    const firstOf: FirstOfTerminationCondition = {
      kind: "firstOf",
      conditions: [budget, convergence, judge]
    };
    const options: DogpileOptions = {
      intent: "Use the composed termination policy.",
      protocol: "sequential",
      tier: "balanced",
      model: createDeterministicModelProvider("termination-types-model"),
      terminate: firstOf
    };
    const context: TerminationEvaluationContext = {
      runId: "run-termination-types",
      protocol: "sequential",
      tier: "balanced",
      cost: { usd: 0.24, inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      events: [],
      transcript: [],
      metadata: { source: "type-test" }
    };
    const input: FirstOfTerminationInput = {
      kind: "firstOf-input",
      conditions: firstOf.conditions,
      context
    };
    const stopDecision: StopTerminationDecision = {
      type: "stop",
      condition: budget,
      reason: "budget",
      normalizedReason: "budget:cost",
      budgetReason: "cost",
      detail: { cap: "maxUsd" }
    };
    const output: FirstOfTerminationOutput = {
      kind: "firstOf-output",
      decision: stopDecision,
      winningConditionIndex: 0,
      evaluated: [stopDecision]
    };

    expect(options.terminate).toBe(firstOf);
    expect(input.conditions).toHaveLength(3);
    expect(output.decision.type).toBe("stop");
    expect(JSON.parse(JSON.stringify({ firstOf, input, output }))).toEqual({ firstOf, input, output });
  });

  it("normalizes budget stops for cost, tokens, iterations, and timeout caps", () => {
    const cases: readonly {
      readonly condition: BudgetTerminationCondition;
      readonly context: TerminationEvaluationContext;
      readonly reason: BudgetStopReason;
      readonly cap: string;
    }[] = [
      {
        condition: budget({ maxUsd: 0.25 }),
        context: terminationContext({ cost: { usd: 0.25, inputTokens: 1, outputTokens: 1, totalTokens: 2 } }),
        reason: "cost",
        cap: "maxUsd"
      },
      {
        condition: budget({ maxTokens: 10 }),
        context: terminationContext({ cost: { usd: 0, inputTokens: 4, outputTokens: 6, totalTokens: 10 } }),
        reason: "tokens",
        cap: "maxTokens"
      },
      {
        condition: budget({ maxIterations: 2 }),
        context: terminationContext({ iteration: 2 }),
        reason: "iterations",
        cap: "maxIterations"
      },
      {
        condition: budget({ timeoutMs: 5 }),
        context: terminationContext({ elapsedMs: 5 }),
        reason: "timeout",
        cap: "timeoutMs"
      }
    ];

    for (const testCase of cases) {
      const decision = evaluateBudget(testCase.condition, testCase.context);

      expect(decision.type).toBe("stop");
      if (decision.type !== "stop") {
        throw new Error(`expected ${testCase.reason} budget stop`);
      }
      expect(decision.reason).toBe("budget");
      expect(decision.normalizedReason).toBe(`budget:${testCase.reason}`);
      expect(decision.budgetReason).toBe(testCase.reason);
      expect(decision.detail?.cap).toBe(testCase.cap);
      expect(JSON.parse(JSON.stringify(decision))).toEqual(decision);
    }
  });

  it("continues budget evaluation while cost, token, iteration, and timeout caps remain below limits", () => {
    const condition = budget({
      maxUsd: 0.25,
      maxTokens: 10,
      maxIterations: 2,
      timeoutMs: 50
    });

    expect(
      evaluateBudget(
        condition,
        terminationContext({
          cost: { usd: 0.24, inputTokens: 4, outputTokens: 5, totalTokens: 9 },
          iteration: 1,
          elapsedMs: 49
        })
      )
    ).toEqual({ type: "continue", condition });
  });

  it("stops on convergence from protocol outputs without budget or judge state", () => {
    const condition = convergence({ stableTurns: 2, minSimilarity: 1 });
    const context = terminationContext({
      cost: { usd: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      quality: 0,
      transcript: [
        transcriptEntry("planner", "stable answer"),
        transcriptEntry("critic", "stable answer")
      ]
    });

    const decision = evaluateConvergence(condition, context);

    expect(decision.type).toBe("stop");
    if (decision.type !== "stop") {
      throw new Error("expected convergence stop");
    }
    expect(decision.reason).toBe("convergence");
    expect(decision.normalizedReason).toBe("convergence");
    expect(decision.detail).toEqual({
      protocol: "sequential",
      stableTurns: 2,
      minSimilarity: 1,
      observedSimilarity: 1,
      outputs: ["stable answer", "stable answer"]
    });
  });

  it("lets convergence win firstOf independently of non-breached budget and unevaluated judge state", () => {
    const budgetCondition = budget({ maxIterations: 10, maxUsd: 5 });
    const convergenceCondition = convergence({ stableTurns: 2, minSimilarity: 1 });
    const judgeCondition = judge({ rubric: "Accept only a perfect release decision.", minScore: 1 });
    const condition = firstOf(budgetCondition, convergenceCondition, judgeCondition);

    const output = evaluateTermination(
      condition,
      terminationContext({
        cost: { usd: 0.01, inputTokens: 2, outputTokens: 2, totalTokens: 4 },
        iteration: 2,
        quality: 0,
        transcript: [
          transcriptEntry("planner", "ship rc"),
          transcriptEntry("critic", "ship rc")
        ]
      })
    );

    expect(output.type).toBe("stop");
    if (output.type !== "stop") {
      throw new Error("expected firstOf convergence stop");
    }
    expect(output.reason).toBe("convergence");
    expect(output.normalizedReason).toBe("convergence");
    expect(output.condition).toBe(convergenceCondition);
  });

  it("records the first firstOf child that fired with the concrete stop condition", () => {
    const convergenceCondition = convergence({ stableTurns: 2, minSimilarity: 1 });
    const budgetCondition = budget({ maxIterations: 2 });
    const condition = firstOf(convergenceCondition, budgetCondition);
    const record = evaluateTerminationStop(
      condition,
      terminationContext({
        iteration: 2,
        transcript: [
          transcriptEntry("planner", "stable decision"),
          transcriptEntry("critic", "stable decision")
        ]
      })
    );

    expect(record).toMatchObject({
      kind: "termination-stop",
      rootCondition: condition,
      firedCondition: convergenceCondition,
      reason: "convergence",
      normalizedReason: "convergence",
      firstOf: {
        kind: "firstOf-stop",
        winningConditionIndex: 0,
        winningCondition: convergenceCondition,
        firedCondition: convergenceCondition
      }
    });
    expect(record?.firstOf?.evaluated).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });

  it("normalizes explicit judge accept and reject decisions independently of budget and convergence state", () => {
    const condition = judge({ rubric: "Stop when the judge returns a terminal verdict.", minScore: 0.95 });
    const cases: readonly {
      readonly judgeDecision: JudgeEvaluationDecision;
      readonly reason: JudgeStopReason;
    }[] = [
      {
        judgeDecision: {
          type: "accept",
          score: 0.61,
          rationale: "The answer is good enough for this rubric.",
          metadata: { judge: "acceptance-fixture" }
        },
        reason: "accepted"
      },
      {
        judgeDecision: {
          type: "reject",
          score: 0.99,
          rationale: "The answer violates a hard constraint.",
          metadata: { judge: "rejection-fixture" }
        },
        reason: "rejected"
      }
    ];

    for (const testCase of cases) {
      const decision = evaluateJudge(
        condition,
        terminationContext({
          cost: { usd: 99, inputTokens: 99, outputTokens: 99, totalTokens: 198 },
          iteration: 99,
          elapsedMs: 99,
          transcript: [
            transcriptEntry("planner", "first distinct output"),
            transcriptEntry("critic", "second distinct output")
          ],
          judgeDecision: testCase.judgeDecision
        })
      );

      expect(decision.type).toBe("stop");
      if (decision.type !== "stop") {
        throw new Error(`expected judge ${testCase.reason} stop`);
      }
      expect(decision.reason).toBe("judge");
      expect(decision.normalizedReason).toBe(`judge:${testCase.reason}`);
      expect(decision.judgeReason).toBe(testCase.reason);
      expect(decision.detail?.decision).toBe(testCase.judgeDecision.type);
      expect(decision.detail?.score).toBe(testCase.judgeDecision.score);
      expect(JSON.parse(JSON.stringify(decision))).toEqual(decision);
    }
  });

  it("maps judge scores and legacy quality context to score-threshold stops", () => {
    const condition = judge({ rubric: "Score the current answer.", minScore: 0.8 });

    const lowScore = evaluateJudge(
      condition,
      terminationContext({
        judgeDecision: { type: "score", score: 0.79, rationale: "Close but incomplete." },
        quality: 1
      })
    );
    const explicitScore = evaluateJudge(
      condition,
      terminationContext({
        judgeDecision: { type: "score", score: 0.8, rationale: "Meets threshold." },
        quality: 0
      })
    );
    const qualityFallback = evaluateJudge(condition, terminationContext({ quality: 0.81 }));

    expect(lowScore).toEqual({ type: "continue", condition });
    expect(explicitScore.type).toBe("stop");
    expect(qualityFallback.type).toBe("stop");
    if (explicitScore.type !== "stop" || qualityFallback.type !== "stop") {
      throw new Error("expected judge score-threshold stops");
    }
    expect(explicitScore.judgeReason).toBe("score-threshold");
    expect(explicitScore.normalizedReason).toBe("judge:score-threshold");
    expect(explicitScore.detail).toEqual({
      decision: "score",
      score: 0.8,
      minScore: 0.8,
      rationale: "Meets threshold."
    });
    expect(qualityFallback.judgeReason).toBe("score-threshold");
    expect(qualityFallback.normalizedReason).toBe("judge:score-threshold");
    expect(qualityFallback.detail).toEqual({
      decision: "score",
      score: 0.81,
      minScore: 0.8
    });
  });

  it("lets a judge stop win firstOf without relying on budget or convergence checks", () => {
    const budgetCondition = budget({ maxIterations: 10, maxUsd: 5 });
    const convergenceCondition = convergence({ stableTurns: 3, minSimilarity: 1 });
    const judgeCondition = judge({ rubric: "Reject unsafe output.", minScore: 0.9 });
    const condition = firstOf(budgetCondition, convergenceCondition, judgeCondition);

    const output = evaluateTermination(
      condition,
      terminationContext({
        cost: { usd: 0.01, inputTokens: 2, outputTokens: 2, totalTokens: 4 },
        iteration: 2,
        transcript: [
          transcriptEntry("planner", "ship rc"),
          transcriptEntry("critic", "revise rc")
        ],
        judgeDecision: { type: "reject", rationale: "Missing required evidence." }
      })
    );

    expect(output.type).toBe("stop");
    if (output.type !== "stop") {
      throw new Error("expected firstOf judge stop");
    }
    expect(output.reason).toBe("judge");
    expect(output.normalizedReason).toBe("judge:rejected");
    expect(output.judgeReason).toBe("rejected");
    expect(output.condition).toBe(judgeCondition);
  });

  it("combines independent termination checks with deterministic precedence and exposes the normalized stop reason", () => {
    const budgetCondition = budget({ maxTokens: 10 });
    const convergenceCondition = convergence({ stableTurns: 2, minSimilarity: 1 });
    const judgeCondition = judge({ rubric: "Accept good enough output.", minScore: 0.7 });
    const context = terminationContext({
      cost: { usd: 0.01, inputTokens: 4, outputTokens: 6, totalTokens: 10 },
      transcript: [
        transcriptEntry("planner", "stable release plan"),
        transcriptEntry("critic", "stable release plan")
      ],
      judgeDecision: { type: "accept", score: 0.7 }
    });

    const decisions = [
      evaluateJudge(judgeCondition, context),
      evaluateConvergence(convergenceCondition, context),
      evaluateBudget(budgetCondition, context)
    ] as const;
    const combined = combineTerminationDecisions(decisions);

    expect(combined.type).toBe("stop");
    if (combined.type !== "stop") {
      throw new Error("expected combined termination stop");
    }
    expect(combined.reason).toBe("budget");
    expect(combined.normalizedReason).toBe("budget:tokens");
    expect(combined.condition).toBe(budgetCondition);

    const normalizedReasons: readonly NormalizedStopReason[] = decisions
      .filter((decision): decision is StopTerminationDecision => decision.type === "stop")
      .map((decision) => decision.normalizedReason);
    expect(normalizedReasons).toEqual(["judge:accepted", "convergence", "budget:tokens"]);
  });

  it("keeps same-precedence stop ties deterministic by selecting the earliest evaluated result", () => {
    const costCap = budget({ maxUsd: 0.01 });
    const tokenCap = budget({ maxTokens: 10 });
    const acceptJudge = judge({ rubric: "Accept complete output.", minScore: 0.7 });
    const scoreJudge = judge({ rubric: "Score complete output.", minScore: 0.7 });
    const budgetContext = terminationContext({
      cost: { usd: 0.01, inputTokens: 4, outputTokens: 6, totalTokens: 10 }
    });
    const judgeContext = terminationContext({
      judgeDecision: { type: "accept", score: 0.7 }
    });

    const costFirst = combineTerminationDecisions([
      evaluateBudget(costCap, budgetContext),
      evaluateBudget(tokenCap, budgetContext)
    ]);
    const tokenFirst = combineTerminationDecisions([
      evaluateBudget(tokenCap, budgetContext),
      evaluateBudget(costCap, budgetContext)
    ]);
    const acceptedFirst = combineTerminationDecisions([
      evaluateJudge(acceptJudge, judgeContext),
      evaluateJudge(scoreJudge, { ...judgeContext, judgeDecision: { type: "score", score: 0.7 } })
    ]);

    expect(costFirst.type).toBe("stop");
    expect(tokenFirst.type).toBe("stop");
    expect(acceptedFirst.type).toBe("stop");
    if (costFirst.type !== "stop" || tokenFirst.type !== "stop" || acceptedFirst.type !== "stop") {
      throw new Error("expected same-precedence stop ties");
    }
    expect(costFirst.normalizedReason).toBe("budget:cost");
    expect(costFirst.condition).toBe(costCap);
    expect(tokenFirst.normalizedReason).toBe("budget:tokens");
    expect(tokenFirst.condition).toBe(tokenCap);
    expect(acceptedFirst.normalizedReason).toBe("judge:accepted");
    expect(acceptedFirst.condition).toBe(acceptJudge);
  });

  it.each([
    ["sequential", { kind: "sequential", maxTurns: 3 }],
    ["coordinator", { kind: "coordinator", maxTurns: 3 }],
    ["shared", { kind: "shared", maxTurns: 3 }]
  ] as const)("halts %s execution when recent protocol outputs converge", async (_name, protocol) => {
    const result = await run({
      intent: "Stop when repeated outputs converge.",
      protocol,
      tier: "fast",
      terminate: convergence({ stableTurns: 2, minSimilarity: 1 }),
      model: createConstantModelProvider("constant-convergence-model", "same final claim")
    });

    expect(result.transcript).toHaveLength(2);
    expect(result.output).toContain("same final claim");
    expect(result.trace.events.map((event) => event.type)).not.toContain("budget-stop");
    expect(result.trace.events.at(-1)?.type).toBe("final");
    const finalEvent = result.trace.events.at(-1);
    expect(finalEvent?.type).toBe("final");
    if (finalEvent?.type !== "final") {
      throw new Error("missing final event");
    }
    expect(finalEvent.termination).toMatchObject({
      kind: "termination-stop",
      firedCondition: { kind: "convergence", stableTurns: 2, minSimilarity: 1 },
      reason: "convergence",
      normalizedReason: "convergence"
    });
  });

  it("emits a normalized coordinator budget-stop event before running past an iteration cap", async () => {
    const result = await run({
      intent: "Stop coordinator execution after one completed model turn.",
      protocol: { kind: "coordinator", maxTurns: 3 },
      tier: "fast",
      budget: { maxIterations: 1 },
      model: createDeterministicModelProvider("coordinator-budget-stop-model")
    });

    expect(result.transcript).toHaveLength(1);
    expect(result.trace.events.map((event) => event.type)).toEqual([
      "role-assignment",
      "role-assignment",
      "role-assignment",
      "agent-turn",
      "budget-stop",
      "final"
    ]);

    const stopEvent = result.trace.events.find((event) => event.type === "budget-stop");
    expect(stopEvent?.type).toBe("budget-stop");
    if (stopEvent?.type !== "budget-stop") {
      throw new Error("missing budget-stop event");
    }
    expect(stopEvent.reason).toBe("iterations");
    expect(stopEvent.iteration).toBe(1);
    expect(stopEvent.detail).toEqual({
      cap: "maxIterations",
      limit: 1,
      observed: 1
    });
    expect(result.trace.budgetStateChanges.map((change) => change.eventType)).toEqual([
      "agent-turn",
      "budget-stop",
      "final"
    ]);
    expect(result.trace.budgetStateChanges[1]).toMatchObject({
      kind: "replay-trace-budget-state-change",
      eventIndex: 4,
      eventType: "budget-stop",
      cost: stopEvent.cost,
      iteration: 1,
      budgetReason: "iterations"
    });

    const finalEvent = result.trace.events.at(-1);
    expect(finalEvent?.type).toBe("final");
    if (finalEvent?.type !== "final") {
      throw new Error("missing final event");
    }
    expect(finalEvent.termination).toMatchObject({
      kind: "termination-stop",
      firedCondition: { kind: "budget", maxIterations: 1 },
      reason: "budget",
      normalizedReason: "budget:iterations",
      budgetReason: "iterations",
      detail: {
        cap: "maxIterations",
        limit: 1,
        observed: 1
      }
    });
  });
});

function terminationContext(
  overrides: Partial<
    Pick<
      TerminationEvaluationContext,
      "cost" | "iteration" | "elapsedMs" | "quality" | "transcript" | "protocol" | "judgeDecision"
    >
  > = {}
): TerminationEvaluationContext {
  return {
    runId: "run-budget-evaluation",
    protocol: overrides.protocol ?? "sequential",
    tier: "fast",
    cost: overrides.cost ?? { usd: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    events: [],
    transcript: overrides.transcript ?? [],
    ...(overrides.iteration !== undefined ? { iteration: overrides.iteration } : {}),
    ...(overrides.elapsedMs !== undefined ? { elapsedMs: overrides.elapsedMs } : {}),
    ...(overrides.quality !== undefined ? { quality: overrides.quality } : {}),
    ...(overrides.judgeDecision !== undefined ? { judgeDecision: overrides.judgeDecision } : {})
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

function createConstantModelProvider(id: string, text: string) {
  return {
    id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const userMessage = request.messages.find((message) => message.role === "user")?.content ?? "";
      return {
        text,
        usage: {
          inputTokens: userMessage.length,
          outputTokens: text.length,
          totalTokens: userMessage.length + text.length
        },
        costUsd: 0.0001
      };
    }
  };
}
