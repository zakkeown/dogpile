import type { AgentDecision, AgentParticipation, ParticipateAgentDecision } from "../types.js";

export function parseAgentDecision(output: string): AgentDecision | undefined {
  const selectedRole = matchLine(output, /^role_selected:\s*(.+)$/imu);
  const participation = matchLine(output, /^participation:\s*(contribute|abstain)$/imu);
  const rationale = matchLine(output, /^rationale:\s*(.+)$/imu);
  const contribution = matchContribution(output);

  if (!selectedRole || !participation || !isAgentParticipation(participation) || !rationale || !contribution) {
    return undefined;
  }

  const decision: ParticipateAgentDecision = {
    type: "participate",
    selectedRole,
    participation,
    rationale,
    contribution
  };
  return decision;
}

export function isParticipatingDecision(decision: AgentDecision | undefined): boolean {
  if (decision?.type !== "participate") {
    return false;
  }
  return decision.participation !== "abstain";
}

function matchLine(output: string, pattern: RegExp): string | undefined {
  const match = output.match(pattern);
  return match?.[1]?.trim();
}

function matchContribution(output: string): string | undefined {
  const match = output.match(/^contribution:\s*\n([\s\S]*)$/imu);
  const contribution = match?.[1]?.trim();
  return contribution && contribution.length > 0 ? contribution : undefined;
}

export function isAgentParticipation(value: string): value is AgentParticipation {
  return value === "contribute" || value === "abstain";
}
