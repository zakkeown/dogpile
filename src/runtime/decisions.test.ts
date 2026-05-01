import { describe, expect, it } from "vitest";
import { DogpileError } from "../types.js";
import { isParticipatingDecision, parseAgentDecision } from "./decisions.js";

const PARTICIPATE_OUTPUT = [
  "role_selected: triage analyst",
  "participation: contribute",
  "rationale: I have evidence to share for the release decision.",
  "contribution:",
  "Block the release until the security review is rerun."
].join("\n");

const DELEGATE_FULL_OUTPUT = [
  "role_selected: coordinator",
  "participation: contribute",
  "rationale: This sub-mission needs a focused sub-team.",
  "delegate:",
  "```json",
  JSON.stringify({
    protocol: "sequential",
    intent: "Investigate the regression and propose a fix.",
    model: "parent-provider",
    budget: { timeoutMs: 30000 }
  }),
  "```",
  "contribution:",
  "(delegated to a sub-run)"
].join("\n");

const DELEGATE_MINIMAL_OUTPUT = [
  "delegate:",
  "```json",
  JSON.stringify({ protocol: "broadcast", intent: "Gather independent estimates." }),
  "```"
].join("\n");

function expectInvalidConfiguration(fn: () => unknown, expectedPath: string): DogpileError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DogpileError);
    const dpe = error as DogpileError;
    expect(dpe.code).toBe("invalid-configuration");
    const detail = dpe.detail as { path?: string } | undefined;
    expect(detail?.path).toBe(expectedPath);
    return dpe;
  }
  throw new Error("expected parseAgentDecision to throw DogpileError");
}

describe("parseAgentDecision", () => {
  it("returns a participate decision for paper-style output with all four fields", () => {
    const decision = parseAgentDecision(PARTICIPATE_OUTPUT);
    expect(decision).toEqual({
      type: "participate",
      selectedRole: "triage analyst",
      participation: "contribute",
      rationale: "I have evidence to share for the release decision.",
      contribution: "Block the release until the security review is rerun."
    });
  });

  it("returns a delegate decision for output containing a fenced delegate JSON block with all fields", () => {
    const decision = parseAgentDecision(DELEGATE_FULL_OUTPUT, { parentProviderId: "parent-provider" });
    expect(decision).toEqual({
      type: "delegate",
      protocol: "sequential",
      intent: "Investigate the regression and propose a fix.",
      model: "parent-provider",
      budget: { timeoutMs: 30000 }
    });
  });

  it("returns a delegate decision with only protocol and intent when optional fields are absent", () => {
    const decision = parseAgentDecision(DELEGATE_MINIMAL_OUTPUT);
    expect(decision).toEqual({
      type: "delegate",
      protocol: "broadcast",
      intent: "Gather independent estimates."
    });
  });

  it("throws invalid-configuration with detail.path 'decision.protocol' for an unknown protocol", () => {
    expectInvalidConfiguration(
      () =>
        parseAgentDecision(
          [
            "delegate:",
            "```json",
            JSON.stringify({ protocol: "swarm", intent: "go" }),
            "```"
          ].join("\n")
        ),
      "decision.protocol"
    );
  });

  it("throws invalid-configuration with detail.path 'decision.intent' when intent is missing or empty", () => {
    expectInvalidConfiguration(
      () =>
        parseAgentDecision(
          [
            "delegate:",
            "```json",
            JSON.stringify({ protocol: "sequential", intent: "   " }),
            "```"
          ].join("\n")
        ),
      "decision.intent"
    );
  });

  it("throws invalid-configuration with detail.path 'decision' for malformed JSON inside the delegate block", () => {
    const error = expectInvalidConfiguration(
      () =>
        parseAgentDecision(
          ["delegate:", "```json", "{ not valid json", "```"].join("\n")
        ),
      "decision"
    );
    expect(error.message.toLowerCase()).toContain("json");
  });

  it("returns an array of delegate decisions for a fenced delegate JSON array", () => {
    const decision = parseAgentDecision(
      [
        "delegate:",
        "```json",
        JSON.stringify([
          { protocol: "sequential", intent: "Investigate the regression." },
          { protocol: "broadcast", intent: "Gather estimates." },
          { protocol: "shared", intent: "Draft the fix." }
        ]),
        "```"
      ].join("\n")
    );

    expect(decision).toEqual([
      { type: "delegate", protocol: "sequential", intent: "Investigate the regression." },
      { type: "delegate", protocol: "broadcast", intent: "Gather estimates." },
      { type: "delegate", protocol: "shared", intent: "Draft the fix." }
    ]);
  });

  it("throws invalid-configuration with detail.path 'decision' for an empty delegate array", () => {
    const error = expectInvalidConfiguration(
      () =>
        parseAgentDecision(
          [
            "delegate:",
            "```json",
            JSON.stringify([]),
            "```"
          ].join("\n")
        ),
      "decision"
    );
    expect(error.message).toMatch(/must not be empty/i);
  });

  it("throws using single-delegate validation for an invalid item in a delegate array", () => {
    expectInvalidConfiguration(
      () =>
        parseAgentDecision(
          [
            "delegate:",
            "```json",
            JSON.stringify([
              { protocol: "sequential", intent: "Investigate." },
              { protocol: "swarm", intent: "Invalid protocol." }
            ]),
            "```"
          ].join("\n")
        ),
      "decision.protocol"
    );
  });

  it("accepts positive integer maxConcurrentChildren on delegate decisions", () => {
    const decision = parseAgentDecision(
      [
        "delegate:",
        "```json",
        JSON.stringify({ protocol: "sequential", intent: "Run bounded.", maxConcurrentChildren: 2 }),
        "```"
      ].join("\n")
    );

    expect(decision).toEqual({
      type: "delegate",
      protocol: "sequential",
      intent: "Run bounded.",
      maxConcurrentChildren: 2
    });
  });

  it("rejects non-positive maxConcurrentChildren on delegate decisions", () => {
    expectInvalidConfiguration(
      () =>
        parseAgentDecision(
          [
            "delegate:",
            "```json",
            JSON.stringify({ protocol: "sequential", intent: "Run bounded.", maxConcurrentChildren: 0 }),
            "```"
          ].join("\n")
        ),
      "decision.maxConcurrentChildren"
    );
  });

  it("throws invalid-configuration with detail.path 'decision.model' when model id does not match parent provider", () => {
    expectInvalidConfiguration(
      () =>
        parseAgentDecision(
          [
            "delegate:",
            "```json",
            JSON.stringify({ protocol: "sequential", intent: "go", model: "other-provider" }),
            "```"
          ].join("\n"),
          { parentProviderId: "parent-provider" }
        ),
      "decision.model"
    );
  });

  it("throws invalid-configuration with detail.path 'decision.budget.timeoutMs' for a negative timeout", () => {
    expectInvalidConfiguration(
      () =>
        parseAgentDecision(
          [
            "delegate:",
            "```json",
            JSON.stringify({
              protocol: "sequential",
              intent: "go",
              budget: { timeoutMs: -100 }
            }),
            "```"
          ].join("\n")
        ),
      "decision.budget.timeoutMs"
    );
  });

  it("accepts a fenced block with no language tag", () => {
    const decision = parseAgentDecision(
      [
        "delegate:",
        "```",
        JSON.stringify({ protocol: "shared", intent: "Coordinate the patch review." }),
        "```"
      ].join("\n")
    );
    expect(decision).toEqual({
      type: "delegate",
      protocol: "shared",
      intent: "Coordinate the patch review."
    });
  });
});

describe("isParticipatingDecision", () => {
  it("returns true for a participate decision with participation 'contribute'", () => {
    const decision = parseAgentDecision(PARTICIPATE_OUTPUT);
    expect(isParticipatingDecision(decision)).toBe(true);
  });

  it("returns false for a participate decision with participation 'abstain'", () => {
    const decision = parseAgentDecision(
      [
        "role_selected: skeptic",
        "participation: abstain",
        "rationale: Nothing to add this round.",
        "contribution:",
        "(no contribution)"
      ].join("\n")
    );
    expect(isParticipatingDecision(decision)).toBe(false);
  });

  it("returns false for a delegate decision", () => {
    const decision = parseAgentDecision(DELEGATE_MINIMAL_OUTPUT);
    expect(isParticipatingDecision(decision)).toBe(false);
  });

  it("returns false for an undefined decision", () => {
    expect(isParticipatingDecision(undefined)).toBe(false);
  });
});
