# Phase 6: Provenance Annotations — Discussion Log

**Mode:** Power (async questionnaire)
**Generated:** 2026-05-01
**Questions:** 14 / 14 answered

---

## Section 1: modelId vs providerId

### Q-01: Is modelId a distinct concept from providerId?
**Selected:** a — Yes — modelId and providerId are different concepts  
*provider.id = adapter identity; modelId = the specific model being called. Both appear in provenance.*

### Q-02: Where does modelId come from?
**Selected:** a — Add optional modelId to ConfiguredModelProvider interface  
*ConfiguredModelProvider gains `readonly modelId?: string`. Public API addition.*

### Q-03: Fallback when modelId is absent?
**Selected:** a — Fall back to providerId — modelId always present on events  
*Runtime substitutes `provider.id` when `provider.modelId` is absent. Non-optional field on events.*

---

## Section 2: Event Emission Strategy

### Q-04: Should model-request/response events actually be emitted during a run?
**Selected:** a — Yes — start emitting them as real runtime events  
*Appears in trace.events and streaming log. Behavioral change requiring CHANGELOG migration note.*

### Q-05: Where in the event sequence do model-request/response appear?
**Selected:** a — model-request before agent-turn, model-response immediately after provider call (before agent-turn)  
*Sequence: role-assignment → model-request → [model-output-chunk*] → model-response → agent-turn.*

---

## Section 3: Timestamp Shape on Events

### Q-06: What timestamps appear on ModelRequestEvent?
**Selected:** c — Add `startedAt` and drop `at` on model-request/response only  
*model-request and model-response events use `startedAt`/`completedAt` instead of the shared `at`. Breaking shape change. All other events keep `at`.*

### Q-07: What timestamps appear on ModelResponseEvent?
**Selected:** a — ModelResponseEvent gets both startedAt and completedAt (full pair)  
*Consumers can compute call duration from a single event. `at` removed from these events.*

---

## Section 4: Alignment with trace.providerCalls

### Q-08: After Phase 6, what's the canonical provenance record?
**Selected:** c — Both are canonical but serve different use-cases  
*Events = streaming/introspection. providerCalls = replay anchor, full request/response bodies, audit.*

### Q-09: Does Phase 6 add modelId to ReplayTraceProviderCall?
**Selected:** a — Yes — add modelId to ReplayTraceProviderCall  
*Consistent provenance in both events and providerCalls. Public surface change on replay type.*

---

## Section 5: Public Surface

### Q-10: Does Phase 6 ship any provenance utility functions?
**Selected:** b — Yes — ship a getProvenance() helper alongside the event types  
*`getProvenance(event: ModelRequestEvent | ModelResponseEvent): ProvenanceRecord`. New export.*

### Q-11: Does Phase 6 add a new subpath export?
**Selected:** b — New /runtime/provenance subpath  
*Dedicated provenance module. Requires updating package.json exports, files, package-exports.test.ts, CHANGELOG.*

### Q-12: Should Phase 6 add a frozen fixture test for the provenance event shape?
**Selected:** a — Yes — frozen fixture for provenance event shape  
*`src/tests/fixtures/provenance-event-v1.json`. Explicit update required for any shape change.*

### Q-13: How should provenance fields be populated during replay()?
**Selected:** b — Provenance re-derived from trace.providerCalls during replay  
*providerCalls is the replay anchor. replay() synthesizes model-request/response events from providerCalls by callId.*

### Q-14: What's the scope of the event-shape change for existing consumers?
**Selected:** b — Treat as a potentially breaking change — flag in CHANGELOG with migration note  
*Migration note in v0.5.0: "model-request and model-response events are now emitted; update exhaustive switches."*

---

## Claude's Discretion

- `getProvenance()` return type for `ModelRequestEvent` (no `completedAt`) — overloads vs union vs optional field. Implementation detail for planner.
- Whether Vercel AI internal adapter populates `modelId` from `model.modelId` — natural fit, researcher to confirm.
