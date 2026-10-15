import { it, expect, describe } from "vitest";
import { mustParseUtc } from "@ate/time";
import { InstrumentEligibility, defaultPolicy } from "@ate/instrument-eligibility";
import { fixture, take, checker, time, configuration } from "./fixtures.js";
for (const destination of [
  "DATA_QUALIFIED",
  "RESEARCH",
  "VALIDATED",
  "SIMULATION",
  "LIVE_ELIGIBLE",
  "ACTIVE",
] as const)
  it(`cannot skip from DISCOVERED to ${destination}`, async () => {
    const f = await fixture();
    await f.discover();
    const before = f.service.diagnostics().history;
    expect((await f.service.requestTransition(f.request(destination))).ok).toBe(false);
    expect(f.service.diagnostics().history).toBe(before);
  });
for (const disposition of [
  "PENDING_EVIDENCE",
  "UNDER_REVIEW",
  "REVOKED",
  "QUARANTINED",
  "RETIRED",
] as const)
  it(`governs ${disposition}, preserves stage and fails current use closed`, async () => {
    const f = await fixture();
    await f.discover();
    await f.promote("MAPPED");
    await f.promote("MAPPED", { disposition });
    const r = take(await f.service.getEligibility(f.context.instrumentId));
    expect(r.recorded).toMatchObject({ stage: "MAPPED", disposition });
    expect(r.current.allowed).toBe(false);
    expect(r.current.capabilities.every((x) => !x.allowed)).toBe(true);
    if (disposition === "RETIRED")
      expect(
        (await f.service.requestTransition(f.request("MAPPED", { disposition: "NONE" }))).ok,
      ).toBe(false);
    else {
      await f.promote("MAPPED", { disposition: "NONE" });
      expect(take(await f.service.getEligibility(f.context.instrumentId)).current.allowed).toBe(
        true,
      );
    }
  });
it("only applicable verified expired evidence can justify EXPIRED", async () => {
  const f = await fixture();
  await f.discover();
  await f.promote("MAPPED");
  expect(
    (await f.service.requestTransition(f.request("MAPPED", { disposition: "EXPIRED" }))).ok,
  ).toBe(false);
  take(f.spec.mapping.base.clock.advanceTo(mustParseUtc("2026-10-18T09:00:00.000Z")));
  await f.promote("MAPPED", { disposition: "EXPIRED" });
  expect(take(await f.service.getEligibility(f.context.instrumentId)).recorded.disposition).toBe(
    "EXPIRED",
  );
  expect(
    (await f.service.reinstateEligibility(f.request("MAPPED", { disposition: "NONE" }))).ok,
  ).toBe(false);
});
it("preview does not persist, approve or modify history; request identity is idempotent", async () => {
  const f = await fixture();
  await f.discover();
  const n = f.service.diagnostics().history;
  const preview = {
    instrumentId: f.context.instrumentId,
    destination: "MAPPED",
    context: f.context,
  };
  const a = take(await f.service.evaluateTransition(preview)),
    b = take(await f.service.evaluateTransition(preview));
  expect(a).toEqual(b);
  expect(f.service.diagnostics().history).toBe(n);
  const request = f.request("MAPPED"),
    first = take(await f.service.requestTransition(request));
  expect(take(await f.service.requestTransition(request))).toEqual(first);
  expect((await f.service.requestTransition({ ...request, reason: "different" })).ok).toBe(false);
});
it("stale approvals cannot commit after a different accepted transition", async () => {
  const f = await fixture();
  await f.discover();
  const request = f.request("MAPPED");
  take(await f.service.requestTransition(request));
  const a = take(
    await f.service.approveTransition({
      kind: "APPROVE",
      id: "old-approval",
      requestId: request.id,
      checker,
    }),
  );
  await f.promote("MAPPED");
  expect(
    (
      await f.service.commitTransition({
        kind: "COMMIT",
        id: "late",
        requestId: request.id,
        approvalId: a.action.id,
      })
    ).ok,
  ).toBe(false);
});
it("backdated as-of queries never expose newly recorded decisions", async () => {
  const f = await fixture();
  await f.discover();
  const old = take(
    f.service.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time }),
  );
  take(f.spec.mapping.base.clock.advanceTo(mustParseUtc("2026-10-10T09:01:00.000Z")));
  await f.promote("MAPPED");
  expect(
    take(f.service.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time })),
  ).toEqual(old);
  const page = take(
    f.service.getEligibilityHistory({
      instrumentId: f.context.instrumentId,
      asOf: f.ports.clock.now(),
      offset: 0,
      limit: 1,
    }),
  );
  expect(page.records).toHaveLength(1);
  expect(page.nextOffset).toBe(1);
  expect(page.total).toBe(4); // Discovery, request, approval, and committed decision.
  expect(
    f.service.historicalEligibility({
      instrumentId: f.context.instrumentId,
      asOf: mustParseUtc("2027-01-01T00:00:00.000Z"),
    }),
  ).toMatchObject({ ok: false });
});
for (const field of [
  "instrumentId",
  "revisionId",
  "mappingSet",
  "mappingFingerprint",
  "specification",
  "calendarFingerprint",
] as const)
  it(`rejects substituted ${field} before research promotion`, async () => {
    const f = await fixture();
    await f.discover();
    await f.promote("MAPPED");
    await f.promote("DATA_QUALIFIED");
    const c = {
      ...f.context,
      [field]: field === "instrumentId" ? "ins-" + "b".repeat(64) : "sha256:" + "b".repeat(64),
    };
    const r = await f.service.evaluateTransition({
      instrumentId: f.context.instrumentId,
      context: c,
      destination: "RESEARCH",
    });
    expect(r.ok ? r.value.allowed : false).toBe(false);
  });
it("cross-instrument UUID and catalogue association substitution cannot qualify data", async () => {
  const f = await fixture();
  await f.discover();
  await f.promote("MAPPED");
  for (const d of [
    { ...f.context.datasets[0]!, instrumentId: "00000000-0000-4000-8000-000000000099" },
    { ...f.context.datasets[0]!, associationFingerprint: "sha256:" + "c".repeat(64) },
    { ...f.context.datasets[0]!, qualityFingerprint: "sha256:" + "c".repeat(64) },
  ]) {
    const r = take(
      await f.service.evaluateTransition({
        instrumentId: f.context.instrumentId,
        destination: "DATA_QUALIFIED",
        context: { ...f.context, datasets: [d] },
      }),
    );
    expect(r.allowed).toBe(false);
  }
});
it("quality warnings require explicit governed opt-in and cannot qualify under restrictive default", async () => {
  const f = await fixture(defaultPolicy);
  await f.discover();
  await f.promote("MAPPED");
  expect(
    take(
      await f.service.evaluateTransition({
        instrumentId: f.context.instrumentId,
        destination: "DATA_QUALIFIED",
        context: f.context,
      }),
    ).allowed,
  ).toBe(false);
});
for (const key of [
  "maxRequests",
  "maxApprovals",
  "maxInputBytes",
  "maxInputDepth",
  "maxEvidence",
  "maxDependencies",
  "maxSnapshotBytes",
  "maxRetainedBytes",
  "maxRecords",
  "maxQueryResults",
  "maxDiagnostics",
  "maxRecoverySteps",
  "maxHistory",
] as const)
  it(`rejects invalid configuration limit ${key}`, async () => {
    const f = await fixture();
    f.setConfiguration(await configuration({ ...f.policy, [key]: 0 }, f.ports.clock));
    expect(
      (
        await f.service.discover({
          kind: "DISCOVER",
          id: "invalid-policy",
          instrumentId: f.context.instrumentId,
          context: f.context,
          maker: { actorType: "SYSTEM" },
          occurredAt: time,
          effectiveAt: time,
        })
      ).ok,
    ).toBe(false);
    expect(f.service.diagnostics().readiness).toBe("NOT_READY");
  });
it("unsupported history policy cannot silently reinterpret recovered records", async () => {
  const f = await fixture();
  await f.discover();
  const changed = await configuration({ ...f.policy, policyId: "changed-policy" }, f.ports.clock);
  const fresh = new InstrumentEligibility("eligibility-lab", {
    ...f.ports,
    configuration: () => changed,
  });
  expect((await fresh.initialize()).ok).toBe(false);
});
it("explicitly compatible history policy rederives history while restricting current capabilities", async () => {
  const f = await fixture();
  await f.toResearch();
  const event = take(
    f.service.getEligibilityHistory({
      instrumentId: f.context.instrumentId,
      asOf: time,
      offset: 0,
      limit: 1,
    }),
  ).records[0]!;
  const changed = await configuration(
    {
      ...f.policy,
      policyId: "new-research-policy",
      compatibleHistoryPolicies: [event.policyFingerprint],
    },
    f.ports.clock,
  );
  const fresh = new InstrumentEligibility("eligibility-lab", {
    ...f.ports,
    configuration: () => changed,
  });
  take(await fresh.initialize());
  expect(
    take(fresh.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time })).stage,
  ).toBe("RESEARCH");
});
describe("P18 calendar owner remains the boundary authority", () => {
  it("rejects unrecognized timeframe without inventing a session schedule", async () => {
    const f = await fixture();
    await f.toResearch();
    const r = take(
      await f.service.evaluateTransition({
        instrumentId: f.context.instrumentId,
        destination: "RESEARCH",
        context: { ...f.context, timeframes: ["FAKE"] },
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reasons).toContain("CALENDAR_EVIDENCE_MISSING");
  });
});
it("preview explicitly separates passing qualification from required commit authority", async () => {
  const f = await fixture();
  await f.discover();
  const a = take(
    await f.service.evaluateTransition({
      instrumentId: f.context.instrumentId,
      destination: "MAPPED",
      context: f.context,
    }),
  );
  expect(a.allowed).toBe(true);
  expect(a.commitAuthorized).toBe(false);
  expect(a.requiredApprovals).toEqual(["DISTINCT_AUTHORIZED_CONFIGURATION_CHECKER"]);
  expect(a.required).toContain("CURRENT_GOVERNED_MAPPING");
  expect(a.currentDisposition).toBe("NONE");
});
it("counts immutable evidence references and owner dependencies at exact capacities", async () => {
  const base = await fixture(),
    c = base.context;
  const evidence = [
    c.revisionId,
    c.mappingSet,
    c.mappingFingerprint,
    c.source.catalogueFingerprint,
    c.source.observationFingerprint,
    c.specification,
    c.calendarFingerprint,
    c.attestation,
    ...c.datasets.flatMap((d) => [
      d.versionFingerprint,
      d.contentFingerprint,
      d.qualityFingerprint,
      d.associationFingerprint,
    ]),
    ...(c.replay ? [c.replay.leftCheckpoint, c.replay.rightCheckpoint] : []),
  ].filter((x) => x !== null).length;
  const exact = await fixture({ ...defaultPolicy, maxEvidence: evidence, maxDependencies: 10 });
  await exact.discover();
  const beyond = await fixture({
    ...defaultPolicy,
    maxEvidence: evidence - 1,
    maxDependencies: 10,
  });
  expect(
    (
      await beyond.service.discover({
        kind: "DISCOVER",
        id: "bound",
        instrumentId: beyond.context.instrumentId,
        context: beyond.context,
        maker: { actorType: "SYSTEM" },
        occurredAt: time,
        effectiveAt: time,
      })
    ).ok,
  ).toBe(false);
  const dep = await fixture({ ...defaultPolicy, maxEvidence: 32, maxDependencies: 9 });
  expect(
    (
      await dep.service.publish({
        kind: "DISCOVER",
        id: "dep",
        instrumentId: dep.context.instrumentId,
        context: dep.context,
        maker: { actorType: "SYSTEM" },
        occurredAt: time,
        effectiveAt: time,
      })
    ).ok,
  ).toBe(false);
});
it("one retained request capacity still permits its approval, commit and fresh recovery", async () => {
  const f = await fixture({ ...defaultPolicy, maxRequests: 1, maxApprovals: 1 });
  await f.discover();
  await f.promote("MAPPED");
  expect((await f.service.requestTransition(f.request("MAPPED"))).ok).toBe(false);
  const fresh = new InstrumentEligibility("eligibility-lab", f.ports);
  take(await fresh.initialize());
  expect(take(await fresh.getEligibility(f.context.instrumentId)).recorded.stage).toBe("MAPPED");
});
it("current P23 specification supersession blocks research even when canonical/mapping identities remain identical", async () => {
  const f = await fixture();
  await f.toResearch();
  const old = take(await f.service.getEligibility(f.context.instrumentId));
  const request = f.spec.request("replacement-spec-request");
  take(await f.spec.service.publish(request));
  const current = take(await f.service.getEligibility(f.context.instrumentId));
  expect(current.recorded).toEqual(old.recorded);
  expect(current.current.allowed).toBe(false);
  expect(current.current.reasons).toContain("SPECIFICATION_EVIDENCE_INCOMPLETE");
});
it("actual canonical revision supersession blocks current research without rewriting accepted history", async () => {
  const f = await fixture();
  await f.toResearch();
  const before = take(await f.service.getEligibility(f.context.instrumentId)).recorded;
  const revision = take(f.ports.registry.get(f.context.instrumentId))!;
  take(
    await f.ports.registry.revise(
      f.context.instrumentId,
      revision.revisionId,
      { ...revision.definition, displayName: "Updated offline research label" },
      "Independent canonical revision check",
    ),
  );
  const after = take(await f.service.getEligibility(f.context.instrumentId));
  expect(after.recorded).toEqual(before);
  expect(after.current.allowed).toBe(false);
  expect(after.current.reasons).toContain("IDENTITY_UNRESOLVED");
});
it("actual mapping-set supersession invalidates current qualification", async () => {
  const f = await fixture();
  await f.toResearch();
  take(await f.spec.mapping.service.publish(f.spec.mapping.request("replacement-mapping")));
  const current = take(await f.service.getEligibility(f.context.instrumentId));
  expect(current.recorded.stage).toBe("RESEARCH");
  expect(current.current.reasons).toContain("MAPPING_NOT_QUALIFIED");
  expect(current.current.allowed).toBe(false);
});
it("actual catalogue quarantine blocks dataset capabilities while exact recorded history remains unchanged", async () => {
  const f = await fixture();
  await f.toResearch();
  const before = take(
    f.service.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time }),
  );
  const v = f.h.registration.entry.version;
  take(
    await f.h.catalogueRepository.transitionLifecycle(v.versionId, {
      from: v.lifecycleState,
      to: "QUARANTINED",
      reason: "Permanent offline quality investigation",
      timestamp: f.h.clock.now(),
      evidence: ["Accepted owner quarantine signal"],
    }),
  );
  const current = take(await f.service.getEligibility(f.context.instrumentId));
  expect(current.current.reasons).toContain("DATASET_NOT_QUALIFIED");
  expect(
    current.current.capabilities.find((x) => x.capability === "HISTORICAL_DATA_RESEARCH")?.allowed,
  ).toBe(false);
  expect(
    take(f.service.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time })),
  ).toEqual(before);
});
it("revoked checker authority blocks current eligibility as well as new approvals", async () => {
  const f = await fixture();
  await f.toResearch();
  f.ports.authorityResolver = {
    resolve: () => {
      throw Error("AUTHORITY_REVOKED");
    },
  };
  const current = take(await f.service.getEligibility(f.context.instrumentId));
  expect(current.current.allowed).toBe(false);
  expect(current.current.reasons).toContain("APPROVAL_AUTHORITY_REVOKED");
  expect(current.current.capabilities.every((x) => !x.allowed)).toBe(true);
});
