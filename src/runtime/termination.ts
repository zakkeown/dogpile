import type {
  BudgetStopReason,
  BudgetTerminationCondition,
  ConvergenceTerminationCondition,
  FirstOfTerminationCondition,
  FirstOfTerminationConditions,
  FirstOfTerminationOutput,
  JudgeEvaluationDecision,
  JudgeStopReason,
  JudgeTerminationCondition,
  JsonObject,
  NormalizedStopReason,
  TerminationStopRecord,
  StopTerminationDecision,
  TerminationCondition,
  TerminationDecision,
  TerminationEvaluationContext,
  TranscriptEntry
} from "../types.js";

/**
 * Create a budget termination condition.
 *
 * The returned object is JSON-serializable and can be used directly in
 * `terminate` or composed with {@link firstOf}.
 */
export function budget(options: Omit<BudgetTerminationCondition, "kind">): BudgetTerminationCondition {
  return {
    kind: "budget",
    ...options
  };
}

/**
 * Create a convergence termination condition.
 *
 * The condition fires when the run has produced `stableTurns` sufficiently
 * similar protocol outputs.
 */
export function convergence(options: Omit<ConvergenceTerminationCondition, "kind">): ConvergenceTerminationCondition {
  return {
    kind: "convergence",
    ...options
  };
}

/**
 * Create a judge termination condition.
 *
 * The rubric is stored as serializable configuration so callers can replay or
 * persist traces without SDK-owned state.
 */
export function judge(options: Omit<JudgeTerminationCondition, "kind">): JudgeTerminationCondition {
  return {
    kind: "judge",
    ...options
  };
}

/**
 * Compose termination conditions so whichever child fires first wins.
 *
 * Conditions are evaluated in the order supplied by the caller. At least one
 * condition is required so the composite is always meaningful and the public
 * type remains a non-empty tuple.
 */
export function firstOf(...conditions: FirstOfTerminationConditions): FirstOfTerminationCondition {
  if (conditions.length === 0) {
    throw new RangeError("firstOf requires at least one termination condition.");
  }

  return {
    kind: "firstOf",
    conditions
  };
}

/**
 * Evaluate a serializable termination condition against the current run state.
 *
 * Budget, convergence, judge, and firstOf conditions are enforced from their
 * own normalized inputs so one stop class cannot accidentally satisfy another.
 */
export function evaluateTermination(
  condition: TerminationCondition,
  context: TerminationEvaluationContext
): TerminationDecision {
  switch (condition.kind) {
    case "budget":
      return evaluateBudget(condition, context);
    case "firstOf":
      return evaluateFirstOf(condition, context).decision;
    case "convergence":
      return evaluateConvergence(condition, context);
    case "judge":
      return evaluateJudge(condition, context);
  }
}

/**
 * Evaluate an ordered firstOf composition and return the winning child, if any.
 */
export function evaluateFirstOf(
  condition: FirstOfTerminationCondition,
  context: TerminationEvaluationContext
): FirstOfTerminationOutput {
  const evaluated: TerminationDecision[] = [];

  for (const [index, child] of condition.conditions.entries()) {
    const decision = evaluateTermination(child, context);
    evaluated.push(decision);

    if (decision.type === "stop") {
      return {
        kind: "firstOf-output",
        decision,
        winningConditionIndex: index,
        evaluated
      };
    }
  }

  return {
    kind: "firstOf-output",
    decision: { type: "continue", condition },
    winningConditionIndex: null,
    evaluated
  };
}

/**
 * Evaluate a termination condition and return a trace-ready stop record.
 *
 * Protocol runners use this helper so the first policy decision that halts a
 * run is recorded exactly once on the terminal event.
 */
export function evaluateTerminationStop(
  condition: TerminationCondition,
  context: TerminationEvaluationContext
): TerminationStopRecord | null {
  if (condition.kind === "firstOf") {
    const output = evaluateFirstOf(condition, context);
    if (output.decision.type !== "stop" || output.winningConditionIndex === null) {
      return null;
    }

    const winningCondition = condition.conditions[output.winningConditionIndex];
    if (!winningCondition) {
      throw new RangeError("firstOf stop referenced a missing winning condition.");
    }

    return stopRecord(condition, output.decision, {
      kind: "firstOf-stop",
      winningConditionIndex: output.winningConditionIndex,
      winningCondition,
      firedCondition: output.decision.condition,
      evaluated: output.evaluated
    });
  }

  const decision = evaluateTermination(condition, context);
  if (decision.type !== "stop") {
    return null;
  }

  return stopRecord(condition, decision);
}

/**
 * Combine independently evaluated termination decisions with SDK precedence.
 *
 * Budget caps win over judge decisions, and judge decisions win over
 * convergence. This keeps simultaneous stops deterministic while preserving
 * each evaluator's normalized stop reason on the returned decision.
 */
export function combineTerminationDecisions(
  decisions: readonly TerminationDecision[]
): TerminationDecision {
  const stopDecisions = decisions.filter((decision): decision is StopTerminationDecision => decision.type === "stop");
  if (stopDecisions.length === 0) {
    const firstDecision = decisions[0];
    if (!firstDecision) {
      throw new RangeError("combineTerminationDecisions requires at least one decision.");
    }

    return firstDecision;
  }

  return stopDecisions.reduce((winner, candidate) =>
    stopPrecedence(candidate.normalizedReason) < stopPrecedence(winner.normalizedReason) ? candidate : winner
  );
}

/**
 * Evaluate cost, token, iteration, and timeout caps for a budget condition.
 */
export function evaluateBudget(
  condition: BudgetTerminationCondition,
  context: TerminationEvaluationContext
): TerminationDecision {
  const iteration = context.iteration ?? context.transcript.length;
  const elapsedMs = context.elapsedMs ?? 0;

  const costStop = stopIfReached(condition, "maxUsd", "cost", context.cost.usd);
  if (costStop) {
    return costStop;
  }

  const tokenStop = stopIfReached(condition, "maxTokens", "tokens", context.cost.totalTokens);
  if (tokenStop) {
    return tokenStop;
  }

  const iterationStop = stopIfReached(condition, "maxIterations", "iterations", iteration);
  if (iterationStop) {
    return iterationStop;
  }

  const timeoutStop = stopIfReached(condition, "timeoutMs", "timeout", elapsedMs);
  if (timeoutStop) {
    return timeoutStop;
  }

  return { type: "continue", condition };
}

/**
 * Evaluate protocol-level convergence from recent coordination outputs.
 *
 * This intentionally ignores budget caps and judge quality state. Budget and
 * judge conditions can be composed with convergence through `firstOf`, but a
 * convergence condition itself only reads protocol output signals.
 */
export function evaluateConvergence(
  condition: ConvergenceTerminationCondition,
  context: TerminationEvaluationContext
): TerminationDecision {
  const stableTurns = Math.max(1, Math.ceil(condition.stableTurns));
  if (context.transcript.length < stableTurns) {
    return { type: "continue", condition };
  }

  const recentEntries = context.transcript.slice(-stableTurns);
  const recentOutputs = recentEntries.map((entry) => entry.output);
  const similarities = consecutiveSimilarities(recentEntries);
  const observedSimilarity = similarities.length === 0 ? 1 : Math.min(...similarities);

  if (observedSimilarity < condition.minSimilarity) {
    return { type: "continue", condition };
  }

  return {
    type: "stop",
    condition,
    reason: "convergence",
    normalizedReason: "convergence",
    detail: {
      protocol: context.protocol,
      stableTurns,
      minSimilarity: condition.minSimilarity,
      observedSimilarity,
      outputs: recentOutputs
    }
  };
}

/**
 * Evaluate caller-owned judge state without reading budget or convergence data.
 *
 * Explicit accept/reject verdicts always halt. Score-only decisions halt when
 * they meet `minScore`; when `minScore` is omitted, any score-only decision is
 * treated as the judge's terminal decision.
 */
export function evaluateJudge(
  condition: JudgeTerminationCondition,
  context: TerminationEvaluationContext
): TerminationDecision {
  const decision = context.judgeDecision ?? scoreDecisionFromQuality(context.quality);
  if (!decision) {
    return { type: "continue", condition };
  }

  switch (decision.type) {
    case "accept":
      return judgeStop(condition, "accepted", decision);
    case "reject":
      return judgeStop(condition, "rejected", decision);
    case "score": {
      const minScore = condition.minScore;
      if (minScore !== undefined && decision.score < minScore) {
        return { type: "continue", condition };
      }

      return judgeStop(condition, "score-threshold", decision, minScore);
    }
  }
}

function stopIfReached(
  condition: BudgetTerminationCondition,
  cap: "maxUsd" | "maxTokens" | "maxIterations" | "timeoutMs",
  reason: BudgetStopReason,
  observed: number
): StopTerminationDecision | null {
  const limit = condition[cap];
  if (limit === undefined || observed < limit) {
    return null;
  }

  return {
    type: "stop",
    condition,
    reason: "budget",
    normalizedReason: normalizeBudgetStopReason(reason),
    budgetReason: reason,
    detail: {
      cap,
      limit,
      observed
    }
  };
}

function scoreDecisionFromQuality(quality: number | undefined): JudgeEvaluationDecision | null {
  if (quality === undefined) {
    return null;
  }

  return {
    type: "score",
    score: quality
  };
}

function judgeStop(
  condition: JudgeTerminationCondition,
  judgeReason: JudgeStopReason,
  decision: JudgeEvaluationDecision,
  minScore?: number
): StopTerminationDecision {
  return {
    type: "stop",
    condition,
    reason: "judge",
    normalizedReason: normalizeJudgeStopReason(judgeReason),
    judgeReason,
    detail: judgeStopDetail(decision, minScore)
  };
}

function normalizeBudgetStopReason(reason: BudgetStopReason): NormalizedStopReason {
  switch (reason) {
    case "cost":
      return "budget:cost";
    case "tokens":
      return "budget:tokens";
    case "iterations":
      return "budget:iterations";
    case "timeout":
      return "budget:timeout";
  }
}

function normalizeJudgeStopReason(reason: JudgeStopReason): NormalizedStopReason {
  switch (reason) {
    case "accepted":
      return "judge:accepted";
    case "rejected":
      return "judge:rejected";
    case "score-threshold":
      return "judge:score-threshold";
  }
}

function stopPrecedence(reason: NormalizedStopReason): number {
  if (reason.startsWith("budget:")) {
    return 0;
  }

  if (reason.startsWith("judge:")) {
    return 1;
  }

  return 2;
}

function judgeStopDetail(decision: JudgeEvaluationDecision, minScore?: number): JsonObject {
  return {
    decision: decision.type,
    ...(decision.score !== undefined ? { score: decision.score } : {}),
    ...(minScore !== undefined ? { minScore } : {}),
    ...(decision.rationale !== undefined ? { rationale: decision.rationale } : {}),
    ...(decision.metadata !== undefined ? { metadata: decision.metadata } : {})
  };
}

function stopRecord(
  rootCondition: TerminationCondition,
  decision: StopTerminationDecision,
  firstOfRecord?: NonNullable<TerminationStopRecord["firstOf"]>
): TerminationStopRecord {
  return {
    kind: "termination-stop",
    rootCondition,
    firedCondition: decision.condition,
    reason: decision.reason,
    normalizedReason: decision.normalizedReason,
    ...(decision.budgetReason !== undefined ? { budgetReason: decision.budgetReason } : {}),
    ...(decision.judgeReason !== undefined ? { judgeReason: decision.judgeReason } : {}),
    ...(decision.detail !== undefined ? { detail: decision.detail } : {}),
    ...(firstOfRecord !== undefined ? { firstOf: firstOfRecord } : {})
  };
}

function consecutiveSimilarities(entries: readonly TranscriptEntry[]): readonly number[] {
  const similarities: number[] = [];

  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (previous && current) {
      similarities.push(outputSimilarity(previous.output, current.output));
    }
  }

  return similarities;
}

function outputSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeOutput(left);
  const normalizedRight = normalizeOutput(right);

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const leftTokens = tokenize(normalizedLeft);
  const rightTokens = tokenize(normalizedRight);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let intersection = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function normalizeOutput(output: string): string {
  return output.trim().toLowerCase();
}

function tokenize(output: string): readonly string[] {
  return output.split(/[^a-z0-9]+/u).filter((token) => token.length > 0);
}
