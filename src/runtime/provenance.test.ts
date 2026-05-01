import { describe, expect, it } from "vitest";
import {
  getProvenance,
  type PartialProvenanceRecord,
  type ProvenanceRecord
} from "./provenance.js";
import type { ModelRequest, ModelRequestEvent, ModelResponseEvent } from "../types.js";

const baseRequest: ModelRequest = {
  messages: [{ role: "user", content: "test" }],
  temperature: 0,
  metadata: {}
};

const modelRequestEvent: ModelRequestEvent = {
  type: "model-request",
  runId: "run-prov-test",
  callId: "run-prov-test:provider-call:1",
  providerId: "openai-compatible",
  modelId: "gpt-4o",
  startedAt: "2026-05-01T00:00:00.000Z",
  agentId: "agent-1",
  role: "researcher",
  request: baseRequest
};

const modelResponseEvent: ModelResponseEvent = {
  type: "model-response",
  runId: "run-prov-test",
  callId: "run-prov-test:provider-call:1",
  providerId: "openai-compatible",
  modelId: "gpt-4o",
  startedAt: "2026-05-01T00:00:00.000Z",
  completedAt: "2026-05-01T00:00:01.000Z",
  agentId: "agent-1",
  role: "researcher",
  response: { text: "output" }
};

describe("getProvenance", () => {
  it("returns ProvenanceRecord with all five fields from ModelResponseEvent", () => {
    const provenance: ProvenanceRecord = getProvenance(modelResponseEvent);
    expect(provenance.modelId).toBe("gpt-4o");
    expect(provenance.providerId).toBe("openai-compatible");
    expect(provenance.callId).toBe("run-prov-test:provider-call:1");
    expect(provenance.startedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(provenance.completedAt).toBe("2026-05-01T00:00:01.000Z");
  });

  it("returns PartialProvenanceRecord with four fields from ModelRequestEvent", () => {
    const provenance: PartialProvenanceRecord = getProvenance(modelRequestEvent);
    expect(provenance.modelId).toBe("gpt-4o");
    expect(provenance.providerId).toBe("openai-compatible");
    expect(provenance.callId).toBe("run-prov-test:provider-call:1");
    expect(provenance.startedAt).toBe("2026-05-01T00:00:00.000Z");
    expect("completedAt" in provenance).toBe(false);
  });

  it("ProvenanceRecord survives JSON round-trip without data loss", () => {
    const provenance = getProvenance(modelResponseEvent);
    expect(JSON.parse(JSON.stringify(provenance))).toEqual(provenance);
  });

  it("PartialProvenanceRecord survives JSON round-trip without data loss", () => {
    const provenance = getProvenance(modelRequestEvent);
    expect(JSON.parse(JSON.stringify(provenance))).toEqual(provenance);
  });
});
