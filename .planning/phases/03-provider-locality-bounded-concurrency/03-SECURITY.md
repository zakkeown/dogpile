---
phase: 03-provider-locality-bounded-concurrency
asvs_level: 1
block_on: open_threats
threats_open: 0
audited: 2026-05-01
status: secured
---

# Phase 03 Security Audit

## Threat Register

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-3-01 | Tampering | mitigate | CLOSED | `validateProviderLocality` rejects non-`local`/`remote` metadata at `src/runtime/validation.ts:232`; engine run/stream call it before dispatch at `src/runtime/engine.ts:88` and `src/runtime/engine.ts:135`; config tests cover `BOGUS` at `src/tests/config-validation.test.ts:70` and `src/tests/config-validation.test.ts:375`. |
| T-3-02 | Denial of Service self-inflicted | mitigate | CLOSED | OpenAI-compatible `locality: "remote"` on detected-local baseURL throws `reason: "remote-override-on-local-host"` at `src/providers/openai-compatible.ts:167`; tests cover localhost and IPv4-mapped IPv6 rejection at `src/providers/openai-compatible.test.ts:244` and `src/providers/openai-compatible.test.ts:260`. Local clamp backstop is wired in `src/runtime/coordinator.ts:342`. |
| T-3-03 | Tampering | mitigate | CLOSED | `classifyHostLocality` uses full dotted IPv4 anchors and IPv4-mapped IPv6 normalization at `src/providers/openai-compatible.ts:208`; tests cover spoof remote and mapped local hosts at `src/providers/openai-compatible.test.ts:44` and `src/providers/openai-compatible.test.ts:52`. |
| T-3-04 | Information Disclosure | accept | CLOSED | Accepted risk AR-3-04 documents that the only host in the error is caller-supplied `baseURL`; emitted detail is at `src/providers/openai-compatible.ts:173` and `src/providers/openai-compatible.ts:180`. |
| T-3-05 | Denial of Service | mitigate | CLOSED | `MAX_DISPATCH_PER_TURN = 8` is defined at `src/runtime/coordinator.ts:141`; cumulative pre-start guard checks `dispatchCount + delegates.length` before child dispatch at `src/runtime/coordinator.ts:317`; test locks 8 starts then guard at `src/runtime/coordinator.test.ts:1028`. |
| T-3-06 | Denial of Service self-inflicted | mitigate | CLOSED | Positive integer validation is shared by engine/run validation at `src/runtime/validation.ts:713`; decision-level validation rejects `< 1` at `src/runtime/decisions.ts:191`; config tests cover zero/negative/non-integer and run lowering at `src/tests/config-validation.test.ts:796`. |
| T-3-07 | Tampering | mitigate | CLOSED | Delegate arrays are parsed by mapping every entry through `parseSingleDelegateObject` at `src/runtime/decisions.ts:102`; participate-shaped entries lack required delegate `protocol`/`intent` and throw through the same delegate validator. |
| T-3-08 | DoS / Resource Exhaustion | mitigate | CLOSED | On sibling failure, queued children emit synthetic `sub-run-failed` with `error.code: "aborted"`, `detail.reason: "sibling-failed"`, and `partialCost = emptyCost()` at `src/runtime/coordinator.ts:390`; contract test verifies two synthetic failures and zero partial cost at `src/tests/cancellation-contract.test.ts:80`. |
| T-3-09 | Confused Deputy / Race | mitigate | CLOSED | Semaphore state is created per fan-out turn with `createSemaphore(effectiveForTurn)` inside `runCoordinator` at `src/runtime/coordinator.ts:360`; semaphore mutable state is local to `createSemaphore` at `src/runtime/coordinator.ts:151`. |
| T-3-10 | Tampering | accept | CLOSED | Accepted risk AR-3-10 documents additive-only `parentDecisionArrayIndex`; event interfaces add the field without changing existing `parentDecisionId` at `src/types/events.ts:491`, `src/types/events.ts:533`, `src/types/events.ts:566`, and `src/types/events.ts:675`. |
| T-3-11 | Denial of Service self-inflicted | mitigate | CLOSED | Active local provider forces `effectiveForTurn = 1` and emits a clamp event at `src/runtime/coordinator.ts:342`; tests cover local high override and max in-flight 1 at `src/runtime/coordinator.test.ts:1086` and `src/runtime/coordinator.test.ts:1248`. |
| T-3-12 | Confused Deputy / Race | mitigate | CLOSED | `concurrencyClampEmitted` is a `runCoordinator` closure-local variable at `src/runtime/coordinator.ts:213`; shared-engine isolation test verifies local and remote runs do not leak state at `src/runtime/coordinator.test.ts:1192`. |
| T-3-13 | Information Disclosure | accept | CLOSED | Accepted risk AR-3-13 documents that `providerId` is caller-supplied/default and already present in provider/trace records; clamp payload includes it at `src/types/events.ts:703` and emission at `src/runtime/coordinator.ts:353`. |
| T-3-14 | Tampering | accept | CLOSED | Accepted risk AR-3-14 documents that custom provider behavior is caller-owned; SDK validates only the metadata hint shape at `src/runtime/validation.ts:232` and clamps only on exact `metadata?.locality === "local"` at `src/runtime/coordinator.ts:193`. |
| T-3-15 | DoS / Replay drift | mitigate | CLOSED | Replay/default switches cover `sub-run-queued` and `sub-run-concurrency-clamped` at `src/runtime/defaults.ts:308`, `src/runtime/defaults.ts:467`, and `src/runtime/defaults.ts:512`; replay decision type includes both literals at `src/types/replay.ts:119`; event/result tests lock JSON round trips at `src/tests/event-schema.test.ts:554` and `src/tests/result-contract.test.ts:1057`. |

## Accepted Risks

| Risk ID | Threat ID | Rationale | Owner | Review Trigger |
|---------|-----------|-----------|-------|----------------|
| AR-3-04 | T-3-04 | Locality override errors include only the caller-supplied `baseURL.hostname`; no credentials, headers, request bodies, or provider secrets are emitted. | SDK caller / Dogpile maintainers | Revisit if provider construction accepts secret-bearing URL forms or derived network-resolution data. |
| AR-3-10 | T-3-10 | `parentDecisionArrayIndex` is additive for new events only; historical traces remain valid because `parentDecisionId` format is unchanged. | Dogpile maintainers | Revisit if replay begins requiring the field on historical stored traces. |
| AR-3-13 | T-3-13 | Clamp event `providerId` is caller-supplied/default SDK metadata and already appears in trace/provider-call records. | SDK caller / Dogpile maintainers | Revisit if provider ids are auto-derived from secret-bearing configuration. |
| AR-3-14 | T-3-14 | `metadata.locality` is an advisory hint. A user-implemented provider that declares local while performing remote network calls is outside SDK enforcement scope; the SDK validates the hint shape but cannot police arbitrary provider internals. | SDK caller | Revisit if Dogpile adds provider sandboxing or a verified network policy layer. |

## Threat Flags

No `## Threat Flags` sections were present in `03-01-SUMMARY.md`, `03-02-SUMMARY.md`, or `03-03-SUMMARY.md`; no unregistered flags were logged.

## Audit Trail

| Date | Auditor | Action | Result |
|------|---------|--------|--------|
| 2026-05-01 | Codex security audit | Loaded required Phase 3 plans, summaries, review, verification, requirements, implementation files, tests, and changelog. Verified each declared threat by disposition using code/test evidence only. | 15/15 threats closed; `threats_open: 0`. |
