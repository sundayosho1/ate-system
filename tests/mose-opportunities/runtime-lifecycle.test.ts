import { captureOpportunityContext } from "@ate/mose-opportunities";
import { evaluateOpportunity } from "../../packages/mose-opportunities/src/transitions.js";
import { attachCapture } from "../../packages/mose-opportunities/src/evidence.js";
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

it("genuine bound host admits a declared watch with exact historical ACK", async () => {
  const f = fixture();
  expect((await f.runtime.initialize()).ok).toBe(true);
  const result = await f.runtime.createWatch(f.input, f.context);
  expect(result).toMatchObject({ ok: true, value: { journalGeneration: 1 } });
  expect((await f.repository.load()).ok).toBe(true);
});
it("absent host fails closed before admission", async () => {
  const f = fixture();
  const r = new OpportunityRuntime(f.repository, f.clock, f.authority);
  await r.initialize();
  expect(r.evaluate(f.input, f.context).ok).toBe(false);
  expect(await f.repository.load()).toEqual({ ok: true, value: [] });
});
it("repeat shutdown is truthful and no query succeeds after stop", async () => {
  const f = fixture();
  await f.runtime.initialize();
  expect((await f.runtime.shutdown()).ok).toBe(true);
  expect((await f.runtime.shutdown()).ok).toBe(true);
  expect(f.runtime.query({}).ok).toBe(false);
});
for (const field of [
  "principalRef",
  "key",
  "policyFingerprint",
  "captureFingerprint",
  "root",
  "scope",
  "issuerRef",
  "issuedAt",
  "expiresAt",
])
  it(`rejects substituted host grant ${field}`, async () => {
    const f = fixture(undefined, (g) => {
      g[field] = field === "issuerRef" ? "" : "forged";
    });
    await f.runtime.initialize();
    expect((await f.runtime.createWatch(f.input, f.context)).ok).toBe(false);
    expect(await f.repository.load()).toEqual({ ok: true, value: [] });
  });
it("rejects an unapproved configuration release", async () => {
  const f = fixture(undefined, (g) => {
    g.approvalReferences = ["other"];
  });
  await f.runtime.initialize();
  expect((await f.runtime.createWatch(f.input, f.context)).ok).toBe(false);
  expect(await f.repository.load()).toEqual({ ok: true, value: [] });
});
it("exact command retry returns identical ACK without a second record", async () => {
  const f = fixture();
  await f.runtime.initialize();
  const p = f.runtime.evaluate(f.input, f.context);
  expect(p.ok, JSON.stringify(p)).toBe(true);
  if (!p.ok) return;
  const a = await f.runtime.commit(p.value);
  expect(a.ok).toBe(true);
  expect(await f.runtime.commit(p.value)).toEqual(a);
  const loaded = await f.repository.load();
  if (!loaded.ok) throw Error("load");
  expect(loaded.value).toHaveLength(1);
});
it("raw cloned proposal cannot mint the private captured capability", async () => {
  const f = fixture();
  await f.runtime.initialize();
  const p = f.runtime.evaluate(f.input, f.context);
  expect(p.ok, JSON.stringify(p)).toBe(true);
  if (!p.ok) return;
  expect((await f.runtime.commit(structuredClone(p.value))).ok).toBe(false);
  expect(await f.repository.load()).toEqual({ ok: true, value: [] });
});

it("direct diagnostic of valid declaration", () => {
  const f = fixture();
  const p = evaluateOpportunity(f.input, attachCapture(f.context, f.capture, policy), policy);
  expect(p.ok, JSON.stringify(p)).toBe(true);
});

it("public capture materialization is separate from transition and commitment", async () => {
  const f = fixture();
  const captured = captureOpportunityContext(f.context, f.capture, policy);
  const p = evaluateOpportunity(f.input, captured, policy);
  expect(p).toMatchObject({
    ok: true,
    value: { to: "DORMANT", currentUsability: "UNKNOWN", tradingAuthority: false },
  });
  expect(await f.repository.load()).toEqual({ ok: true, value: [] });
});
it("public capture cannot grant missing host authority", async () => {
  const f = fixture();
  const captured = captureOpportunityContext(f.context, f.capture, policy);
  const p = evaluateOpportunity(f.input, captured, policy);
  if (!p.ok) throw Error(p.error.code);
  const reader = new OpportunityRuntime(f.repository, f.clock, f.authority);
  await reader.initialize();
  expect(await reader.commit(p.value)).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  expect(await f.repository.load()).toEqual({ ok: true, value: [] });
});
it("public capture rejects executable owner routes without invocation", () => {
  const f = fixture();
  let calls = 0;
  Reflect.set(f.capture, "fetchOwner", () => {
    calls++;
    return undefined;
  });
  expect(() => captureOpportunityContext(f.context, f.capture, policy)).toThrow("INPUT_INVALID");
  expect(calls).toBe(0);
  expect(policy.compositionDriverEnabled).toBe(false);
});

it("caller copies and reflected Symbols cannot forge an evaluator proposal", async () => {
  const f = fixture();
  await f.runtime.initialize();
  const p = f.runtime.evaluate(f.input, f.context);
  if (!p.ok) throw Error(p.error.code);
  const forged = Object.assign({}, p.value);
  for (const key of Object.getOwnPropertySymbols(p.value))
    Object.defineProperty(forged, key, { value: Reflect.get(p.value, key) });
  expect(await f.runtime.commit(forged)).toMatchObject({
    ok: false,
    error: { commitment: "NONE" },
  });
  expect(await f.repository.load()).toEqual({ ok: true, value: [] });
  expect((await f.runtime.commit(p.value)).ok).toBe(true);
});
it("untrusted proposal accessors are rejected before they are read or reserve an obligation", async () => {
  const f = fixture();
  await f.runtime.initialize();
  let reads = 0;
  const hostile = Object.defineProperty({}, "expectedHead", {
    get() {
      reads++;
      throw Error("hostile accessor");
    },
  });
  const result: unknown = await Reflect.apply(f.runtime.commit.bind(f.runtime), f.runtime, [
    hostile,
  ]);
  expect(result).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  expect(reads).toBe(0);
  expect(f.runtime.diagnostics()).toMatchObject({
    ok: true,
    value: { obligation: { pending: 0 } },
  });
  expect((await f.runtime.createWatch(f.input, f.context)).ok).toBe(true);
});
