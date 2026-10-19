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

import { recoverJournal } from "../../packages/mose-opportunities/src/recovery.js";
import { recordFingerprint } from "../../packages/mose-opportunities/src/journal.js";
import type { JournalRecord } from "../../packages/mose-opportunities/src/contracts.js";
async function record() {
  const f = fixture();
  await f.runtime.initialize();
  const a = await f.runtime.createWatch(f.input, f.context);
  expect(a.ok, JSON.stringify(a)).toBe(true);
  const loaded = await f.repository.load();
  if (!loaded.ok) throw Error("load");
  return { f, record: loaded.value[0] as JournalRecord };
}
it("fresh instance recovers identical historical state without current authority", async () => {
  const { f, record: r } = await record();
  await f.runtime.shutdown();
  const next = new OpportunityRuntime(f.repository, f.clock, f.authority);
  const loaded = await next.initialize();
  expect(loaded.ok).toBe(true);
  if (loaded.ok) expect(loaded.value[0]?.fingerprint).toBe(r.fingerprint);
  expect(next.diagnostics()).toMatchObject({
    ok: true,
    value: { currentReadiness: "NOT_READY", currentAuthority: "UNESTABLISHED" },
  });
});
it("physical fingerprint excludes only its two self-references", async () => {
  const { record: r } = await record();
  expect(recordFingerprint(r)).toBe(r.fingerprint);
  expect(r.snapshot.head.fingerprint).toBe(r.fingerprint);
  expect(recordFingerprint({ ...r, operationId: "other" })).not.toBe(r.fingerprint);
});
for (const field of [
  "root",
  "previous",
  "operationId",
  "commandFingerprint",
  "fingerprint",
] as const)
  it(`recovery rejects changed ${field}`, async () => {
    const { record: r } = await record();
    expect(() => recoverJournal([{ ...r, [field]: "changed" }], "fixture-root", policy)).toThrow();
  });
it("recovery rejects sequence gap", async () => {
  const { record: r } = await record();
  expect(() => recoverJournal([{ ...r, journalGeneration: 2 }], "fixture-root", policy)).toThrow();
});
it("recovery rejects changed snapshot even after rehash", async () => {
  const { record: r } = await record();
  const tampered = { ...r, snapshot: { ...r.snapshot, state: "QUALIFIED" as const } };
  const fp = recordFingerprint(tampered);
  expect(() =>
    recoverJournal(
      [
        {
          ...tampered,
          fingerprint: fp,
          snapshot: { ...tampered.snapshot, head: { ...tampered.snapshot.head, fingerprint: fp } },
        },
      ],
      "fixture-root",
      policy,
    ),
  ).toThrow();
});
it("recovery rejects replayed physical record", async () => {
  const { record: r } = await record();
  expect(() => recoverJournal([r, r], "fixture-root", policy)).toThrow();
});
it("repository prewrite NONE leaves no obligation and permits valid retry", async () => {
  const memory = new MemoryOpportunityRepository("fixture-root");
  let fail = true;
  const repo: OpportunityRepository = {
    root: memory.root,
    storageMode: memory.storageMode,
    load: () => memory.load(),
    compareAppend: (r) => {
      if (fail)
        return Promise.resolve({
          ok: false,
          error: { code: "OPP:REJECT", commitment: "NONE", reasonCodes: [], operationRef: null },
        });
      return memory.compareAppend(r);
    },
  };
  const f = fixture(repo);
  await f.runtime.initialize();
  const first = await f.runtime.createWatch(f.input, f.context);
  expect(first).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  expect(f.runtime.diagnostics()).toMatchObject({
    ok: true,
    value: { obligation: { pending: 0 } },
  });
  fail = false;
  expect((await f.runtime.createWatch(f.input, f.context)).ok).toBe(true);
});
it("acknowledged write followed by throw retains UNKNOWN until exact readback", async () => {
  const memory = new MemoryOpportunityRepository("fixture-root");
  const repo: OpportunityRepository = {
    root: memory.root,
    storageMode: memory.storageMode,
    load: () => memory.load(),
    compareAppend: async (r) => {
      await memory.compareAppend(r);
      throw Error("after durable acknowledgement");
    },
  };
  const f = fixture(repo);
  await f.runtime.initialize();
  expect(await f.runtime.createWatch(f.input, f.context)).toMatchObject({
    ok: false,
    error: { commitment: "UNKNOWN", operationRef: "birth" },
  });
  expect(f.runtime.diagnostics()).toMatchObject({
    ok: true,
    value: { obligation: { pending: 1 } },
  });
  expect((await f.runtime.shutdown()).ok).toBe(false);
  expect((await f.runtime.shutdown()).ok).toBe(false);
  const recovered = await f.runtime.recover("birth");
  expect(recovered.ok, JSON.stringify(recovered)).toBe(true);
  expect((await f.runtime.shutdown()).ok).toBe(true);
});
it("wrong acknowledgement never silently clears retained publication", async () => {
  const memory = new MemoryOpportunityRepository("fixture-root");
  const repo: OpportunityRepository = {
    root: memory.root,
    storageMode: memory.storageMode,
    load: () => memory.load(),
    compareAppend: async (r) => {
      const a = await memory.compareAppend(r);
      return a.ok
        ? { ok: true, value: { ...a.value, fingerprint: "sha256:" + "0".repeat(64) } }
        : a;
    },
  };
  const f = fixture(repo);
  await f.runtime.initialize();
  expect(await f.runtime.createWatch(f.input, f.context)).toMatchObject({
    ok: false,
    error: { commitment: "UNKNOWN" },
  });
  expect((await f.runtime.shutdown()).ok).toBe(false);
  expect((await f.runtime.recover("birth")).ok).toBe(true);
});
it("fresh recovery does not invoke the mutation authority host", async () => {
  const { f } = await record();
  let calls = 0;
  const host = {
    ...f.host,
    verify: (request: Parameters<TrustedHostAuthorization["verify"]>[0]) => {
      calls++;
      return f.host.verify(request);
    },
  };
  const next = new OpportunityRuntime(f.repository, f.clock, f.authority, host);
  expect((await next.initialize()).ok).toBe(true);
  expect(calls).toBe(0);
});
it("empty replacement memory instance cannot claim retained history", async () => {
  const { f } = await record();
  const fresh = new OpportunityRuntime(
    new MemoryOpportunityRepository(f.repository.root),
    f.clock,
    f.authority,
  );
  const loaded = await fresh.initialize();
  expect(loaded).toEqual({ ok: true, value: [] });
});
