---
phase: 06
slug: provenance-annotations
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-01
verified: 2026-05-01
---

# Phase 06 Security Verification

**Phase:** 06 - Provenance Annotations  
**Verified:** 2026-05-01  
**ASVS Level:** 1  
**Config:** `block_on: critical,high`  
**Threats Open:** 0

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-06-01 | Tampering | accept | CLOSED | Accepted type-contract risk. The changed provenance shapes are TypeScript interfaces only: `ModelRequestEvent`/`ModelResponseEvent` in `src/types/events.ts:67` and `src/types/events.ts:99`, `ReplayTraceProviderCall.modelId` in `src/types/replay.ts:177`, and `ConfiguredModelProvider.modelId?` in `src/types.ts:884`. Runtime data-flow exposure is covered separately by T-06-02/T-06-03/T-06-04. |
| T-06-02 | Information Disclosure | accept | CLOSED | Accepted request-body exposure. The same `traceRequest` snapshot is emitted in `model-request` (`src/runtime/model.ts:28`, `src/runtime/model.ts:33`) and recorded in `providerCalls` (`src/runtime/model.ts:129`), and replay synthesis derives `model-request.request` from `trace.providerCalls` (`src/runtime/engine.ts:938`, `src/runtime/engine.ts:987`). |
| T-06-03 | Information Disclosure | accept | CLOSED | Accepted model-id exposure. Runtime resolves `modelId` from caller/provider configuration with fallback to provider id (`src/runtime/model.ts:27`). First-party adapters populate it from caller-provided model values (`src/providers/openai-compatible.ts:94`, `src/internal/vercel-ai.ts:215`). |
| T-06-04 | Information Disclosure | accept | CLOSED | Accepted provenance-field exposure. `getProvenance()` extracts only existing event fields: `modelId`, `providerId`, `callId`, `startedAt`, and response-only `completedAt` (`src/runtime/provenance.ts:31`, `src/runtime/provenance.ts:38`). No I/O or extra data source is introduced. |
| T-06-05 | Tampering | mitigate | CLOSED | Frozen fixture mitigation present. `src/tests/provenance-shape.test.ts` reads the committed fixture (`src/tests/provenance-shape.test.ts:40`), compares live keys and value types to the fixture (`src/tests/provenance-shape.test.ts:54`, `src/tests/provenance-shape.test.ts:56`), and asserts required provenance fields (`src/tests/provenance-shape.test.ts:59`, `src/tests/provenance-shape.test.ts:68`). `rg "writeFile\|existsSync" src/tests/provenance-shape.test.ts` returned no matches, so the test does not silently regenerate or self-heal the fixture. Fixture exists at `src/tests/fixtures/provenance-event-v1.json:1`. Focused test passed: `pnpm vitest run src/tests/provenance-shape.test.ts`. |
| T-06-06 | Information Disclosure | accept | CLOSED | Accepted public documentation exposure. `CHANGELOG.md` documents the intentional model event shape, emitted events, `modelId`, provenance subpath, and replay synthesis (`CHANGELOG.md:3`, `CHANGELOG.md:9`, `CHANGELOG.md:11`, `CHANGELOG.md:15`, `CHANGELOG.md:17`, `CHANGELOG.md:21`). |

## Accepted Risks Log

| Threat ID | Accepted Risk | Rationale |
|-----------|---------------|-----------|
| T-06-01 | Type contract tampering risk from public shape changes. | Accepted because the threat is limited to compile-time/public type shape changes; runtime data-flow impacts are represented by the information-disclosure threats below. |
| T-06-02 | Request bodies appear in `model-request` events. | Accepted because the same request payload was already persisted in `trace.providerCalls`; event exposure reuses that existing snapshot rather than adding a new source. |
| T-06-03 | Model identifiers appear in events. | Accepted because model identifiers come from caller/provider configuration and are already chosen by the caller. |
| T-06-04 | Provenance helper exposes provider/model/call/timestamp fields. | Accepted because the helper returns only fields already present on provenance events. |
| T-06-06 | CHANGELOG publishes model/event shape details. | Accepted because CHANGELOG is public API documentation and these details are intentional release notes. |

## Threat Flags

No unregistered threat flags were found. All Phase 06 plan summaries list `## Threat Flags` as none.

## Verification Commands

- `rg -n "writeFile|existsSync" src/tests/provenance-shape.test.ts` - no matches
- `pnpm vitest run src/tests/provenance-shape.test.ts` - passed, 1 test

## Scope Guard

Implementation files were inspected only. This audit modified only `.planning/phases/06-provenance-annotations/06-SECURITY.md`.
