import type { ModelRequestEvent, ModelResponseEvent } from "../types.js";

/**
 * Normalized provenance fields from a completed model-response event.
 * All five fields are present and JSON-serializable.
 */
export interface ProvenanceRecord {
  readonly modelId: string;
  readonly providerId: string;
  readonly callId: string;
  readonly startedAt: string;
  readonly completedAt: string;
}

/**
 * Normalized provenance fields from a model-request event.
 * completedAt is absent because the call has not completed at this point.
 */
export interface PartialProvenanceRecord {
  readonly modelId: string;
  readonly providerId: string;
  readonly callId: string;
  readonly startedAt: string;
}

export function getProvenance(event: ModelResponseEvent): ProvenanceRecord;
export function getProvenance(event: ModelRequestEvent): PartialProvenanceRecord;
export function getProvenance(
  event: ModelRequestEvent | ModelResponseEvent
): ProvenanceRecord | PartialProvenanceRecord {
  const base: PartialProvenanceRecord = {
    modelId: event.modelId,
    providerId: event.providerId,
    callId: event.callId,
    startedAt: event.startedAt
  };

  if (event.type === "model-response") {
    return { ...base, completedAt: event.completedAt };
  }

  return base;
}
