import { it, expect } from "vitest";
import { VirtualClock, mustParseUtc } from "@ate/time";
import { StateAuthorityRegistry } from "@ate/persistence";
import {
  captureOpportunityContext,
  evaluateOpportunity,
  OpportunityRuntime,
  MemoryOpportunityRepository,
  opportunityStateOwnership,
  createOpportunityPolicy,
  defaultOpportunityPolicy as policy,
  serializeOpportunityExport,
  type Policy,
} from "@ate/mose-opportunities";
import { fingerprint } from "../../packages/mose-opportunities/src/canonical.js";
import {
  makeOpportunityKey,
  originFingerprint,
  subjectFingerprint,
  policyFingerprint,
} from "../../packages/mose-opportunities/src/identity.js";
import { metadata } from "../../packages/mose-opportunities/src/evidence.js";
import { captureOpportunityClock } from "../../packages/mose-opportunities/src/time-policy.js";
import { inOperation, operationBudget } from "../../packages/mose-opportunities/src/validation.js";
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

function take<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw Error(JSON.stringify(result.error));
  return result.value;
}
// Independent logical-tree oracle: no production Budget counter or query implementation is read.
function nodes(value: unknown): number {
  if (Array.isArray(value)) return 1 + value.reduce<number>((n, v) => n + nodes(v), 0);
  if (value !== null && typeof value === "object")
    return 1 + Object.values(value).reduce<number>((n, v) => n + nodes(v), 0);
  return 1;
}
function lower(limit: number) {
  return { ...policy, limits: { ...policy.limits, maxOperationNodes: limit } };
}
function emptyPage() {
  return {
    schema: "ate.opportunity-page/1",
    records: [],
    total: 0,
    offset: 0,
    nextOffset: null,
    head: null,
    historicalFactsNotCurrentAuthority: true,
    currentAuthority: "UNESTABLISHED",
    tradingAuthority: false,
  };
}
async function empty(original: Policy = policy) {
  const clock = new VirtualClock(now, "REPLAY", "query-accounting-test");
  const authority = new StateAuthorityRegistry(clock);
  const repository = new MemoryOpportunityRepository("query-accounting-empty", original);
  const runtime = new OpportunityRuntime(repository, clock, authority, null, original);
  take(await runtime.initialize());
  return runtime;
}
async function populated() {
  const f = fixture();
  take(await f.runtime.initialize());
  const proposal = take(
    evaluateOpportunity(f.input, captureOpportunityContext(f.context, f.capture, policy), policy),
  );
  const ack = take(await f.runtime.commit(proposal));
  return { ...f, ack, records: take(await f.repository.load()) };
}
for (const ceiling of [16, 20, 32, 48, 50])
  it(`original A28F-M01 safety assertion rejects ceiling ${ceiling}`, async () => {
    const runtime = await empty();
    const result = runtime.query({}, lower(ceiling));
    expect(result.ok, "one operation spent more nodes than its lower governing ceiling").toBe(
      false,
    );
    expect("value" in result).toBe(false);
  });
for (const ceiling of [51, 64])
  it(`empty supplied-policy exact original boundary ${ceiling}`, async () => {
    const runtime = await empty();
    expect(nodes(lower(ceiling)) + nodes({}) + nodes(emptyPage())).toBe(51);
    expect(take(runtime.query({}, lower(ceiling)))).toEqual(emptyPage());
  });
for (const ceiling of [10, 11, 12, 16])
  it(`omitted policy retains separately validated original ceiling ${ceiling}`, async () => {
    const original = take(createOpportunityPolicy(lower(ceiling)));
    const runtime = await empty(original);
    expect(runtime.query({}).ok).toBe(ceiling >= nodes({}) + nodes(emptyPage()));
  });
for (const originalLimit of [16, 50, 51, 64])
  it(`weaker supplied policy cannot increase original ${originalLimit}`, async () => {
    const original = take(createOpportunityPolicy(lower(originalLimit)));
    const runtime = await empty(original);
    expect(runtime.query({}, lower(20000)).ok).toBe(originalLimit >= 51);
  });
for (const value of [-1, 0, 0.5, NaN, Infinity, "16", null, undefined])
  it(`invalid node policy fails closed: ${String(value)}`, async () => {
    const runtime = await empty();
    expect(
      runtime.query({}, { ...policy, limits: { ...policy.limits, maxOperationNodes: value } }).ok,
    ).toBe(false);
  });
for (const value of [
  null,
  [],
  {},
  { ...policy, extra: true },
  { ...policy, tradingAuthorized: true },
  { ...policy, compositionDriverEnabled: true },
  { ...policy, limits: { ...policy.limits, maxLiveKeys: -1 } },
])
  it(`complete validation remains active for malformed policy ${JSON.stringify(value)}`, async () => {
    const runtime = await empty();
    expect(runtime.query({}, value).ok).toBe(false);
  });
for (const field of ["maxOperationNodes", "maxDepth", "maxRequestBytes"])
  it(`policy ceiling accessor ${field} is rejected without evaluation`, async () => {
    const runtime = await empty();
    let reads = 0;
    const limits = { ...policy.limits };
    Object.defineProperty(limits, field, {
      enumerable: true,
      get() {
        reads++;
        throw Error("not inert");
      },
    });
    expect(runtime.query({}, { ...policy, limits }).ok).toBe(false);
    expect(reads).toBe(0);
  });
for (const maxDepth of [1, 2, 3, 4])
  it(`supplied policy itself respects depth ceiling ${maxDepth}`, async () => {
    const runtime = await empty();
    expect(runtime.query({}, { ...policy, limits: { ...policy.limits, maxDepth } }).ok).toBe(
      maxDepth >= 3,
    );
  });
for (const delta of [-1, 0, 1])
  it(`supplied policy UTF8 request size boundary ${delta}`, async () => {
    const runtime = await empty();
    let exact = 1000;
    for (let i = 0; i < 5; i++)
      exact = Buffer.byteLength(
        JSON.stringify({ ...policy, limits: { ...policy.limits, maxRequestBytes: exact } }),
      );
    const supplied = { ...policy, limits: { ...policy.limits, maxRequestBytes: exact + delta } };
    const fits = Buffer.byteLength(JSON.stringify(supplied)) <= exact + delta;
    expect(runtime.query({}, supplied).ok).toBe(fits);
  });
for (const delta of [-1, 0, 1])
  it(`empty output byte ceiling ${delta}`, async () => {
    const runtime = await empty();
    const exact = Buffer.byteLength(JSON.stringify(emptyPage()));
    expect(
      runtime.query({}, { ...policy, limits: { ...policy.limits, maxOutputBytes: exact + delta } })
        .ok,
    ).toBe(delta >= 0);
  });
for (const mode of ["all", "key-miss", "asof-miss", "offset-skip", "first-page"] as const)
  for (const delta of [-1, 0, 1])
    it(`independent filtering/page graph ledger ${mode} boundary ${delta}`, async () => {
      const f = await populated();
      const q =
        mode === "key-miss"
          ? { key: "opp28:" + "f".repeat(64) }
          : mode === "asof-miss"
            ? { asOf: "2026-10-19T11:59:59.999Z" }
            : mode === "offset-skip"
              ? { offset: 1 }
              : mode === "first-page"
                ? { limit: 1 }
                : {};
      const matching = mode !== "key-miss" && mode !== "asof-miss";
      const expected = {
        ...emptyPage(),
        records: matching && mode !== "offset-skip" ? [...f.records] : [],
        total: matching ? 1 : 0,
        offset: mode === "offset-skip" ? 1 : 0,
        head: f.ack.fingerprint,
      };
      const cost = nodes(lower(10000)) + nodes(q) + f.records.length + nodes(expected);
      const before = JSON.stringify(f.records);
      const result = f.runtime.query(q, lower(cost + delta));
      expect(result.ok).toBe(delta >= 0);
      if (result.ok) expect(result.value).toEqual(expected);
      expect(JSON.stringify(take(await f.repository.load()))).toBe(before);
    });
for (const asynchronous of [false, true])
  for (const ceiling of [101, 102, 103])
    it(`nested repeated public queries retain one ledger async=${asynchronous} ceiling=${ceiling}`, async () => {
      const runtime = await empty();
      const result = await inOperation(
        { ...policy.limits, maxOperationNodes: ceiling },
        async () => {
          const first = runtime.query({}, lower(ceiling));
          if (asynchronous) await Promise.resolve();
          const second = runtime.query({}, lower(ceiling));
          return { first, second };
        },
      );
      expect(result.first.ok).toBe(true);
      expect(result.second.ok).toBe(ceiling >= 102);
    });
it("a failed query cannot reset an exhausted enclosing ledger through a weaker retry", async () => {
  const runtime = await empty();
  const result = inOperation(policy.limits, () => {
    const first = runtime.query({}, lower(16));
    const second = runtime.query({}, lower(10000));
    return { first, second };
  });
  expect(result.first.ok).toBe(false);
  expect(result.second.ok).toBe(false);
});
for (const prefix of [0, 1, 7])
  for (const delta of [-1, 0, 1])
    it(`prior work survives query tightening prefix=${prefix} boundary=${delta}`, async () => {
      const runtime = await empty();
      const cost = 51 + prefix;
      const result = inOperation(policy.limits, () => {
        for (let i = 0; i < prefix; i++) operationBudget(policy.limits).capture(0);
        return runtime.query({}, lower(cost + delta));
      });
      expect(result.ok).toBe(delta >= 0);
    });
for (const format of ["JSON", "CSV"] as const)
  for (const delta of [-1, 0, 1])
    it(`query plus ${format} serialization shares cumulative work boundary ${delta}`, async () => {
      const runtime = await empty();
      const cost =
        nodes({}) + nodes(emptyPage()) + 2 * nodes(emptyPage()) + (format === "CSV" ? 2 : 1);
      const result = inOperation({ ...policy.limits, maxOperationNodes: cost + delta }, () => {
        const page = take(runtime.query({}));
        return serializeOpportunityExport(page, policy, format);
      });
      expect(result.ok).toBe(delta >= 0);
      if (!result.ok) expect("value" in result).toBe(false);
    });
it("independent requests legitimately receive fresh budgets and unchanged deterministic output", async () => {
  const runtime = await empty();
  const first = take(runtime.query({}, lower(51)));
  expect(take(runtime.query({}, lower(51)))).toEqual(first);
  expect(first).toMatchObject({
    currentAuthority: "UNESTABLISHED",
    tradingAuthority: false,
    historicalFactsNotCurrentAuthority: true,
  });
});

for (const supplied of [false, true])
  for (const delta of [-1, 0, 1])
    it(`inherited output bytes cannot be relaxed supplied=${supplied} boundary=${delta}`, async () => {
      const runtime = await empty();
      const exact = Buffer.byteLength(JSON.stringify(emptyPage()));
      const result = inOperation({ ...policy.limits, maxOutputBytes: exact + delta }, () =>
        runtime.query({}, supplied ? policy : undefined),
      );
      expect(result.ok).toBe(delta >= 0);
    });
for (const supplied of [false, true]) {
  it(`inherited page limit wins over a weaker request supplied=${supplied}`, async () => {
    const runtime = await empty();
    const result = inOperation({ ...policy.limits, maxPageSize: 1, defaultPageSize: 1 }, () =>
      runtime.query({ limit: 2 }, supplied ? policy : undefined),
    );
    expect(result.ok).toBe(false);
  });
  it(`inherited offset limit wins supplied=${supplied}`, async () => {
    const runtime = await empty();
    const result = inOperation({ ...policy.limits, maxOffset: 0 }, () =>
      runtime.query({ offset: 1 }, supplied ? policy : undefined),
    );
    expect(result.ok).toBe(false);
  });
  it(`inherited key byte limit wins supplied=${supplied}`, async () => {
    const runtime = await empty();
    const result = inOperation({ ...policy.limits, maxIdentifierBytes: 1 }, () =>
      runtime.query({ key: "opp28:" + "f".repeat(64) }, supplied ? policy : undefined),
    );
    expect(result.ok).toBe(false);
  });
}
it("inherited default page size preserves genuine two-watch history and next offset", async () => {
  const f = await populated();
  const subject = { ...f.context.subject, watchDeclarationId: "watch-second" };
  const native = {
    watchDeclarationId: subject.watchDeclarationId,
    subjectFingerprint: subjectFingerprint(subject),
    policyFingerprint: policyFingerprint(policy),
    sourceOriginFingerprint: subject.sourceOriginFingerprint,
  };
  const first = f.capture.evidence[0];
  if (!first) throw Error("missing fixture evidence");
  const evidence: CapturedEvidence = {
    ...first,
    recordId: "second-declaration",
    subjectFingerprint: subjectFingerprint(subject),
    fingerprint: fingerprint("ate.opportunity-native/1", native),
    native: { ok: true, value: native },
  };
  const context: CapturedContext = {
    ...f.context,
    subject,
    nativeEvidenceRefs: [metadata(evidence)],
  };
  const capture = { ...f.capture, evidence: [evidence] };
  const input = {
    ...f.input,
    commandId: "second-birth",
    key: makeOpportunityKey(subject, policy, capture.origin),
    evidence: [metadata(evidence)],
  };
  take(
    await f.runtime.commit(
      take(evaluateOpportunity(input, captureOpportunityContext(context, capture, policy), policy)),
    ),
  );
  const page = take(
    inOperation({ ...policy.limits, maxPageSize: 2, defaultPageSize: 1 }, () =>
      f.runtime.query({}),
    ),
  );
  expect(page).toMatchObject({ total: 2, nextOffset: 1, records: [expect.anything()] });
});

for (const field of ["maxOperationNodes", "maxDepth", "maxRequestBytes"] as const)
  it(`changing resource descriptor ${field} cannot disagree with full captured policy`, async () => {
    const runtime = await empty();
    let reads = 0;
    const value = field === "maxOperationNodes" ? 16 : field === "maxDepth" ? 2 : 512;
    const limits = new Proxy(
      { ...policy.limits, [field]: value },
      {
        getOwnPropertyDescriptor(target, key) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
          const captured: unknown = descriptor?.value;
          if (descriptor && key === field)
            return {
              ...descriptor,
              value: ++reads === 1 ? policy.limits[field] : captured,
            };
          return descriptor;
        },
      },
    );
    expect(runtime.query({}, { ...policy, limits }).ok).toBe(false);
  });
it("inert structural policy proxy remains supported without a new representation rule", async () => {
  const runtime = await empty();
  const supplied = {
    ...policy,
    limits: new Proxy({ ...policy.limits, maxOperationNodes: 51 }, {}),
  };
  expect(take(runtime.query({}, supplied))).toEqual(emptyPage());
});
