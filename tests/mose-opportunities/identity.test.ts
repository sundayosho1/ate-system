import { it, expect } from "vitest";
import { VirtualClock, mustParseUtc } from "@ate/time";
import { StateAuthorityRegistry } from "@ate/persistence";
import { OpportunityRuntime } from "../../packages/mose-opportunities/src/runtime.js";
import { MemoryOpportunityRepository } from "../../packages/mose-opportunities/src/memory-repository.js";
import {
  opportunityStateOwnership,
  defaultOpportunityPolicy as policy,
} from "../../packages/mose-opportunities/src/policy.js";
import { fingerprint } from "../../packages/mose-opportunities/src/canonical.js";
import {
  makeOpportunityKey,
  originFingerprint,
  subjectFingerprint,
  policyFingerprint,
} from "../../packages/mose-opportunities/src/identity.js";
import { metadata } from "../../packages/mose-opportunities/src/evidence.js";
import { captureOpportunityClock } from "../../packages/mose-opportunities/src/time-policy.js";
import type {
  CapturedContext,
  EvaluationInput,
  CapturedEvidence,
  TrustedHostAuthorization,
  OpportunityRepository,
} from "../../packages/mose-opportunities/src/contracts.js";
const now = mustParseUtc("2026-10-19T12:00:00.000Z");
const actor = "40000000-0000-4000-8000-000000000003";
function fixture(
  repository?: OpportunityRepository,
  grantChange?: (value: Record<string, unknown>) => void,
) {
  const clock = new VirtualClock(now, "REPLAY", "p28-fixture-clock");
  const authority = new StateAuthorityRegistry(clock);
  const registered = authority.register(opportunityStateOwnership());
  if (!registered.ok) throw Error("authority fixture failed");
  const repositoryValue = repository ?? new MemoryOpportunityRepository("fixture-root");
  const hash = "sha256:" + "1".repeat(64);
  const origin = {
    owner: "@ate/market-replay",
    version: "0.19.0-market-replay.1",
    namespace: "offline",
    runtimeId: "replay",
    manifestId: "manifest",
    manifestFingerprint: hash.slice(7),
    inputFingerprint: hash.slice(7),
    sourceScope: "fixture",
  };
  const subject = {
    researchSessionId: "session",
    universeSnapshotId: "universe",
    universeFingerprint: hash,
    canonicalInstrumentId: "instrument",
    registryGeneration: 1,
    registryFingerprint: hash,
    sourceOriginFingerprint: originFingerprint(origin),
    calendarFingerprint: "2".repeat(64),
    timeframes: ["M1"],
    hypothesisRef: null,
    watchDeclarationId: "watch",
    lifecycleGeneration: 1,
    predecessorGenerationKey: null,
  };
  const native = {
    watchDeclarationId: "watch",
    subjectFingerprint: subjectFingerprint(subject),
    policyFingerprint: policyFingerprint(policy),
    sourceOriginFingerprint: subject.sourceOriginFingerprint,
  };
  const e: CapturedEvidence = {
    owner: "@ate/mose-opportunities",
    ownerVersion: "0.28.0-opportunity-state.1",
    namespace: "declarations",
    runtimeId: "runtime",
    recordId: "watch-record",
    generation: 1,
    fingerprint: fingerprint("ate.opportunity-native/1", native),
    sourceOriginFingerprint: subject.sourceOriginFingerprint,
    subjectFingerprint: subjectFingerprint(subject),
    policyFingerprint: policyFingerprint(policy),
    eventAt: now,
    availableAt: now,
    qualityReferences: [],
    finality: "NOT_APPLICABLE",
    correctionOf: null,
    nativeResultStatus: "ACK",
    originalReceiptRef: null,
    family: "DECLARATION",
    native: { ok: true, value: native },
  };
  const capture = { origin, evidence: [e], scanner: null };
  const context: CapturedContext = {
    schema: "ate.opportunity-context/1",
    historicalState: null,
    previousEventFingerprint: null,
    subject,
    sourceManifestRef: "manifest",
    policyRef: policy.id,
    predicateManifests: [],
    actorEvidenceRef: actor,
    scopeConsistencyEvidenceRef: "fixture-bounded-scope",
    nativeEvidenceRefs: [metadata(e)],
    trustedCaptureRef: "fixture",
  };
  const input: EvaluationInput = {
    schema: "ate.opportunity-evaluate/1",
    key: makeOpportunityKey(subject, policy, origin),
    commandId: "birth",
    actorAuthorityRef: actor,
    configurationReleaseRef: "configuration",
    expectedHead: null,
    requestedState: "DORMANT",
    capturedClock: captureOpportunityClock(clock),
    decisionCutoff: now,
    knowledgeCutoff: now,
    policyFingerprint: policyFingerprint(policy),
    evidence: [metadata(e)],
    consistency: "ESTABLISHED_SCOPE",
    authorityBasis: "HISTORICAL_AS_KNOWN",
  };
  // Synthetic trusted-host test double, not an independent certificate or scientific validation.
  // Production composition must supply a genuinely reviewed authority/evidence verifier.
  const host: TrustedHostAuthorization = {
    reviewReference: "synthetic-test-host",
    captures: { fixture: capture },
    verify(request) {
      const value = {
        ...request,
        actor: { actorType: "USER", actorId: actor },
        issuerRef: "test-issuer",
        approvalReferences: ["configuration"],
        issuedAt: now,
        expiresAt: "2026-10-19T13:00:00.000Z",
        scope: "HISTORICAL_RESEARCH" as const,
      };
      grantChange?.(value);
      return { ok: true, value };
    },
  };
  const runtime = new OpportunityRuntime(repositoryValue, clock, authority, host);
  return { runtime, repository: repositoryValue, clock, authority, host, context, input, capture };
}

it("same full identity has deterministic key", () => {
  const f = fixture();
  expect(makeOpportunityKey(f.context.subject, policy, f.capture.origin)).toBe(f.input.key);
});
for (const field of [
  "researchSessionId",
  "universeSnapshotId",
  "canonicalInstrumentId",
  "hypothesisRef",
  "watchDeclarationId",
] as const)
  it(`subject ${field} distinguishes opportunity`, () => {
    const f = fixture();
    expect(
      makeOpportunityKey({ ...f.context.subject, [field]: "different" }, policy, f.capture.origin),
    ).not.toBe(f.input.key);
  });
for (const field of ["universeFingerprint", "registryFingerprint", "calendarFingerprint"] as const)
  it(`immutable subject ${field} distinguishes opportunity`, () => {
    const f = fixture();
    const hash = (field === "calendarFingerprint" ? "" : "sha256:") + "3".repeat(64);
    expect(
      makeOpportunityKey({ ...f.context.subject, [field]: hash }, policy, f.capture.origin),
    ).not.toBe(f.input.key);
  });
for (const field of [
  "owner",
  "version",
  "namespace",
  "runtimeId",
  "manifestId",
  "sourceScope",
  "manifestFingerprint",
  "inputFingerprint",
] as const)
  it(`full origin ${field} distinguishes opportunity`, () => {
    const f = fixture();
    const origin = {
      ...f.capture.origin,
      [field]: field.endsWith("Fingerprint") ? "3".repeat(64) : "different",
    };
    if (field === "owner" || field === "version") {
      origin.manifestFingerprint = "sha256:" + origin.manifestFingerprint;
      origin.inputFingerprint = "sha256:" + origin.inputFingerprint;
    }
    const subject = { ...f.context.subject, sourceOriginFingerprint: originFingerprint(origin) };
    expect(makeOpportunityKey(subject, policy, origin)).not.toBe(f.input.key);
  });
it("origin substitution without subject binding rejects", () => {
  const f = fixture();
  expect(() =>
    makeOpportunityKey(f.context.subject, policy, { ...f.capture.origin, runtimeId: "other" }),
  ).toThrow("SOURCE_CONTEXT_MISMATCH");
});
it("policy identity is part of the key", () => {
  const f = fixture();
  expect(
    makeOpportunityKey(f.context.subject, { ...policy, version: "other" }, f.capture.origin),
  ).not.toBe(f.input.key);
});
it("canonical generation requires predecessor", () => {
  const f = fixture();
  expect(() =>
    makeOpportunityKey({ ...f.context.subject, lifecycleGeneration: 2 }, policy, f.capture.origin),
  ).toThrow();
});
it("first generation cannot point at predecessor", () => {
  const f = fixture();
  expect(() =>
    makeOpportunityKey(
      { ...f.context.subject, predecessorGenerationKey: f.input.key },
      policy,
      f.capture.origin,
    ),
  ).toThrow();
});
it("unordered timeframes reject rather than silently changing identity", () => {
  const f = fixture();
  expect(() =>
    makeOpportunityKey(
      { ...f.context.subject, timeframes: ["M5", "M1"] },
      policy,
      f.capture.origin,
    ),
  ).toThrow();
});
it("duplicate timeframes reject", () => {
  const f = fixture();
  expect(() =>
    makeOpportunityKey(
      { ...f.context.subject, timeframes: ["M1", "M1"] },
      policy,
      f.capture.origin,
    ),
  ).toThrow();
});
