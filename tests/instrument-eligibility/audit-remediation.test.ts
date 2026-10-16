import { beforeAll, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { mustParseUtc } from "@ate/time";
import { schemas } from "@ate/domain";
import { StaticApprovalAuthorityResolver } from "@ate/configuration";
import {
  InstrumentEligibility,
  FilesystemEligibilityRepository,
  type Attestation,
  type Action,
  type Snapshot,
  type Policy,
} from "@ate/instrument-eligibility";
import { take, checker, issuer, maker, time, root, configuration } from "./fixtures.js";
import { fixture } from "./audit-fixtures.js";
const conflict = "VALIDATION_DECLARATION_CONFLICT";
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function record(f: Fixture, changes: Record<string, unknown> = {}, id = "positive") {
  const a = f.attestation({ attestationId: id, ...changes });
  take(await f.service.recordAttestation({ kind: "ATTEST", id, attestation: a, checker }));
  return a;
}
async function preview(f: Fixture) {
  return take(
    await f.service.evaluateTransition({
      instrumentId: f.context.instrumentId,
      destination: "VALIDATED",
      context: f.context,
    }),
  );
}
async function close(f: Fixture, a: Attestation, status: "REVOKED" | "SUPERSEDED") {
  return f.service.publish({
    kind: "ATTEST_STATUS",
    id: `close-${a.attestationId}`,
    attestation: a.fingerprint,
    status,
    checker,
    reason: "Governed resolution of conflicting evidence",
  });
}
for (const withdraw of [false, true])
  it(`A24-H01 another permitted issuer/source conflicts only while authorized: withdrawal ${withdraw}`, async () => {
    const other = { ...issuer, actorId: "00000000-0000-4000-8000-000000000004" };
    const base = await fixture();
    const f = await fixture({
      ...base.policy,
      validationSources: [
        ...base.policy.validationSources,
        {
          sourceId: "another-validation-source",
          issuerId: schemas.actorId.parse(other.actorId),
          methodologyVersion: "method-v1",
        },
      ],
    });
    f.ports.authorityResolver = new StaticApprovalAuthorityResolver({
      clock: f.ports.clock,
      grants: {
        [issuer.actorId]: ["CONFIGURATION_CHECKER"],
        [other.actorId]: ["CONFIGURATION_CHECKER"],
        [checker.actorId]: ["CONFIGURATION_CHECKER"],
      },
    });
    await f.toResearch();
    const positive = await record(f);
    await record(
      f,
      { outcome: "FAILED", sourceId: "another-validation-source", issuer: other },
      "other-source-negative",
    );
    f.context.attestation = positive.fingerprint;
    expect((await preview(f)).reasons).toContain(conflict);
    if (withdraw) {
      f.ports.authorityResolver = new StaticApprovalAuthorityResolver({
        clock: f.ports.clock,
        grants: {
          [issuer.actorId]: ["CONFIGURATION_CHECKER"],
          [checker.actorId]: ["CONFIGURATION_CHECKER"],
        },
      });
      expect((await preview(f)).allowed).toBe(true);
    }
  });
for (const outcome of ["PASSED", "FAILED", "INCONCLUSIVE"] as const)
  it(`A24-H01 ${outcome} alone preserves the declared validation meaning`, async () => {
    const f = await fixture();
    await f.toResearch();
    const a = await record(f, { outcome });
    f.context.attestation = a.fingerprint;
    const assessment = await preview(f);
    expect(assessment.allowed).toBe(outcome === "PASSED");
    expect(assessment.validationAttested).toBe(outcome === "PASSED");
    expect(assessment.reasons).not.toContain(conflict);
    expect(assessment.validationIndependentlyVerified).toBe(false);
  });
for (const outcome of ["FAILED", "INCONCLUSIVE"] as const)
  for (const negativeFirst of [false, true])
    it(`A24-H01 ${outcome} conflict blocks both declaration orders: ${negativeFirst}`, async () => {
      const f = await fixture();
      await f.toResearch();
      let positive: Attestation;
      if (negativeFirst) {
        await record(f, { outcome }, "negative");
        positive = await record(f);
      } else {
        positive = await record(f);
        await record(f, { outcome }, "negative");
      }
      f.context.attestation = positive.fingerprint;
      const a = await preview(f);
      expect(a.allowed).toBe(false);
      expect(a.validationAttested).toBe(false);
      expect(a.reasons).toContain(conflict);
      const n = f.service.diagnostics().history;
      expect((await f.service.requestTransition(f.request("VALIDATED"))).ok).toBe(false);
      expect(f.service.diagnostics().history).toBe(n);
    });
it("A24-H01 duplicate operation is idempotent while a new operation cannot duplicate a declaration", async () => {
  const f = await fixture();
  await f.toResearch();
  const a = f.attestation();
  const action = { kind: "ATTEST", id: "declaration", attestation: a, checker };
  const first = take(await f.service.recordAttestation(action));
  expect(take(await f.service.recordAttestation(action))).toEqual(first);
  expect((await f.service.recordAttestation({ ...action, id: "duplicate" })).ok).toBe(false);
  f.context.attestation = a.fingerprint;
  expect((await preview(f)).allowed).toBe(true);
});
for (const field of ["subject", "hypothesis", "methodology"] as const)
  it(`A24-H01 unrelated ${field} negative is not an applicable conflict`, async () => {
    const f = await fixture();
    await f.toResearch();
    const positive = await record(f);
    await record(f, { outcome: "FAILED", [field]: "different-research-context" }, "unrelated");
    f.context.attestation = positive.fingerprint;
    const a = await preview(f);
    expect(a.allowed).toBe(true);
    expect(a.reasons).not.toContain(conflict);
  });
for (const mismatch of ["versionId", "qualityFingerprint", "policyId", "sourceId"] as const)
  it(`A24-H01 unqualified ${mismatch} declaration cannot fabricate a conflict`, async () => {
    const f = await fixture();
    await f.toResearch();
    const positive = await record(f);
    const a = f.attestation({
      attestationId: "wrong-binding",
      outcome: "FAILED",
      ...(mismatch === "policyId" || mismatch === "sourceId"
        ? { [mismatch]: "unrecognized" }
        : { datasets: [{ ...f.context.datasets[0]!, [mismatch]: "unrecognized" }] }),
    });
    expect(
      (
        await f.service.recordAttestation({
          kind: "ATTEST",
          id: "wrong-binding",
          attestation: a,
          checker,
        })
      ).ok,
    ).toBe(false);
    f.context.attestation = positive.fingerprint;
    expect((await preview(f)).allowed).toBe(true);
  });
it("A24-H01 negative expiry is inclusive and does not automatically revoke positive evidence", async () => {
  const f = await fixture();
  await f.toResearch();
  const positive = await record(f);
  await record(
    f,
    { outcome: "FAILED", expiresAt: mustParseUtc("2026-10-10T09:00:01.000Z") },
    "negative",
  );
  f.context.attestation = positive.fingerprint;
  expect((await preview(f)).reasons).toContain(conflict);
  take(f.spec.mapping.base.clock.advanceTo(mustParseUtc("2026-10-10T09:00:01.000Z")));
  expect((await preview(f)).allowed).toBe(true);
});
for (const status of ["REVOKED", "SUPERSEDED"] as const)
  it(`A24-H01 governed ${status} resolves conflict without deleting evidence`, async () => {
    const f = await fixture();
    await f.toResearch();
    const positive = await record(f);
    const negative = await record(f, { outcome: "FAILED" }, "negative");
    f.context.attestation = positive.fingerprint;
    expect((await preview(f)).allowed).toBe(false);
    const resolution = take(await close(f, negative, status));
    expect((await preview(f)).allowed).toBe(true);
    await f.promote("VALIDATED");
    expect(take(f.service.getEligibilityEvidence(negative.fingerprint)).action.kind).toBe("ATTEST");
    expect(take(await close(f, negative, status))).toEqual(resolution);
    expect((await f.service.publish({ ...resolution.action, id: "second-closure" })).ok).toBe(
      false,
    );
  });
for (const forgery of ["reference", "checker", "issuer-checker", "payload"] as const)
  it(`A24-H01 forged ${forgery} cannot close a conflicting declaration`, async () => {
    const f = await fixture();
    await f.toResearch();
    const positive = await record(f);
    const negative = await record(f, { outcome: "FAILED" }, "negative");
    f.context.attestation = positive.fingerprint;
    const action = {
      kind: "ATTEST_STATUS",
      id: "forged",
      attestation: negative.fingerprint,
      status: "SUPERSEDED",
      checker,
      reason: "Unauthorized attempted resolution",
    };
    const raw =
      forgery === "reference"
        ? { ...action, attestation: "sha256:" + "f".repeat(64) }
        : forgery === "checker"
          ? { ...action, checker: maker }
          : forgery === "issuer-checker"
            ? { ...action, checker: issuer }
            : { ...action, supersededBy: positive.fingerprint };
    expect((await f.service.publish(raw)).ok).toBe(false);
    expect((await preview(f)).reasons).toContain(conflict);
  });
for (const stage of ["VALIDATED", "SIMULATION"] as const)
  it(`A24-H01 conflict after ${stage} restricts current use while retaining historical stage and physical recovery`, async () => {
    const dir = root(),
      repository = new FilesystemEligibilityRepository(dir);
    const f = await fixture(undefined, repository);
    await f.toResearch();
    const positive = await record(f);
    f.context.attestation = positive.fingerprint;
    await f.promote("VALIDATED");
    if (stage === "SIMULATION") await f.promote("SIMULATION");
    const before = take(
      f.service.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time }),
    );
    take(f.spec.mapping.base.clock.advanceTo(mustParseUtc("2026-10-10T09:00:01.000Z")));
    await record(
      f,
      { outcome: "FAILED", issuedAt: f.ports.clock.now(), effectiveAt: f.ports.clock.now() },
      "late-negative",
    );
    const current = take(await f.service.getEligibility(f.context.instrumentId));
    expect(current.recorded).toEqual(before);
    expect(current.current.allowed).toBe(false);
    expect(current.current.reasons).toContain(conflict);
    expect(
      current.current.capabilities.find((x) => x.capability === "OFFLINE_SIMULATION")?.allowed,
    ).toBe(false);
    expect(
      take(f.service.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time })),
    ).toEqual(before);
    expect(
      take(
        f.service.historicalEligibility({
          instrumentId: f.context.instrumentId,
          asOf: f.ports.clock.now(),
        }),
      ),
    ).toEqual(before);
    const files = readdirSync(dir).map((n) => [n, readFileSync(join(dir, n), "utf8")]);
    take(await f.service.stop());
    const fresh = new InstrumentEligibility("eligibility-lab", f.ports);
    take(await fresh.initialize());
    const recovered = take(await fresh.getEligibility(f.context.instrumentId));
    expect(recovered.recorded).toEqual(before);
    expect(recovered.current.reasons).toContain(conflict);
    expect(readdirSync(dir).map((n) => [n, readFileSync(join(dir, n), "utf8")])).toEqual(files);
    take(await fresh.stop());
  });
for (const phase of ["request", "approval"] as const)
  it(`A24-H01 conflict invalidates pending ${phase} and requires fresh qualification after resolution`, async () => {
    const f = await fixture();
    await f.toResearch();
    const positive = await record(f);
    f.context.attestation = positive.fingerprint;
    const request = f.request("VALIDATED");
    take(await f.service.requestTransition(request));
    if (phase === "approval")
      take(
        await f.service.approveTransition({
          kind: "APPROVE",
          id: "approval",
          requestId: request.id,
          checker,
        }),
      );
    const negative = await record(f, { outcome: "INCONCLUSIVE" }, "negative");
    const n = f.service.diagnostics().history;
    const result =
      phase === "request"
        ? await f.service.approveTransition({
            kind: "APPROVE",
            id: "approval",
            requestId: request.id,
            checker,
          })
        : await f.service.commitTransition({
            kind: "COMMIT",
            id: "commit",
            requestId: request.id,
            approvalId: "approval",
          });
    expect(result.ok).toBe(false);
    expect(f.service.diagnostics().history).toBe(n);
    take(await close(f, negative, "REVOKED"));
    expect((await preview(f)).allowed).toBe(true);
    await f.promote("VALIDATED");
  });
// One owner fixture supplies genuine immutable actions; every recovery reader is fresh.
let recoveryFixture: Fixture, snapshots: readonly Snapshot[];
beforeAll(async () => {
  recoveryFixture = await fixture();
  await recoveryFixture.discover();
  await recoveryFixture.promote("MAPPED");
  snapshots = take(await recoveryFixture.repository.load()) as readonly Snapshot[];
});
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
function depth(v: unknown): number {
  return v !== null && typeof v === "object"
    ? Math.max(0, ...Object.entries(v).map(([, value]) => 1 + depth(value)))
    : 0;
}
async function recover(policy: Policy, rows: readonly Snapshot[] = snapshots) {
  const f = recoveryFixture,
    effective = await configuration(policy, f.ports.clock);
  const service = new InstrumentEligibility("eligibility-lab", {
    ...f.ports,
    configuration: () => effective,
    repository: {
      load: () => Promise.resolve({ ok: true as const, value: rows }),
      commit: (s) => f.repository.commit(s),
    },
  });
  return { service, result: await service.initialize() };
}
for (const delta of [-1, 0, 1])
  for (const limit of ["maxInputBytes", "maxInputDepth"] as const)
    it(`A24-M01 ${limit} current recovery exact boundary delta ${delta}`, async () => {
      const exact = Math.max(
        ...snapshots.map((s) => (limit === "maxInputBytes" ? bytes(s.action) : depth(s.action))),
      );
      const p = {
        ...recoveryFixture.policy,
        [limit]: exact + delta,
        compatibleHistoryPolicies: [snapshots[0]!.policyFingerprint],
      };
      const { service, result } = await recover(p);
      expect(result.ok).toBe(delta >= 0);
      if (delta < 0) {
        expect(service.diagnostics().readiness).toBe("NOT_READY");
        expect(service.diagnostics().health).toBe("DEGRADED");
        expect(service.diagnostics().pending).not.toBeNull();
        expect((await service.stop()).ok).toBe(false);
      } else {
        expect(service.diagnostics().history).toBe(snapshots.length);
        take(await service.stop());
      }
    });
for (const text of ["Unicode-é-研究", 'escaped-"-backslash-\\'])
  it(`A24-M01 native/wire and physical recovery measure identical semantic bytes: ${text}`, async () => {
    const f = await fixture();
    const action: Action = {
      kind: "REQUEST",
      id: "text-request",
      instrumentId: f.context.instrumentId,
      context: f.context,
      maker: { ...maker, actorId: schemas.actorId.parse(maker.actorId) },
      occurredAt: time,
      effectiveAt: time,
      destination: "MAPPED",
      disposition: null,
      reason: text,
    };
    const exact = bytes(action);
    for (const delta of [-1, 0, 1]) {
      const p = { ...f.policy, maxInputBytes: exact + delta };
      const cfg = await configuration(p, f.ports.clock);
      for (const mode of ["native", "wire"] as const) {
        const repo = new FilesystemEligibilityRepository(root());
        const service = new InstrumentEligibility("eligibility-lab", {
          ...f.ports,
          configuration: () => cfg,
          repository: repo,
        });
        take(await service.initialize());
        take(
          await service.discover({
            kind: "DISCOVER",
            id: "discover",
            instrumentId: f.context.instrumentId,
            context: f.context,
            maker,
            occurredAt: time,
            effectiveAt: time,
          }),
        );
        const result =
          mode === "native"
            ? await service.publish(action)
            : await service.publishJson(JSON.stringify(action));
        expect(result.ok).toBe(delta >= 0);
        if (result.ok) {
          take(await service.stop());
          const reader = new InstrumentEligibility("eligibility-lab", {
            ...f.ports,
            configuration: () => cfg,
            repository: repo,
          });
          take(await reader.initialize());
          expect(take(reader.getEligibilityEvidence(result.value.fingerprint))).toEqual(
            result.value,
          );
          take(await reader.stop());
        } else {
          expect(service.diagnostics().pending).toBeNull();
          take(await service.stop());
        }
      }
    }
  });
it("A24-M01 physical rejected recovery preserves a genuine lost-ACK obligation and permits fresh valid retry", async () => {
  const repo = new FilesystemEligibilityRepository(root());
  const f = await fixture(undefined, {
    load: () => repo.load(),
    commit: async (s) => {
      take(await repo.commit(s));
      throw Error("LOST_ACK");
    },
  });
  const result = await f.service.discover({
    kind: "DISCOVER",
    id: "lost-ack",
    instrumentId: f.context.instrumentId,
    context: f.context,
    maker,
    occurredAt: time,
    effectiveAt: time,
  });
  expect(result).toMatchObject({ ok: false, error: { commitment: "UNKNOWN" } });
  const saved = take(await repo.load()) as readonly Snapshot[],
    obligation = f.service.diagnostics().pending;
  const p = {
    ...f.policy,
    maxInputBytes: 1024,
    compatibleHistoryPolicies: [saved[0]!.policyFingerprint],
  };
  const cfg = await configuration(p, f.ports.clock);
  const denied = new InstrumentEligibility("eligibility-lab", {
    ...f.ports,
    repository: repo,
    configuration: () => cfg,
  });
  expect((await denied.initialize()).ok).toBe(false);
  expect(denied.diagnostics().readiness).toBe("NOT_READY");
  expect((await denied.stop()).ok).toBe(false);
  expect((await denied.stop()).ok).toBe(false);
  expect(f.service.diagnostics().pending).toEqual(obligation);
  expect((await f.service.stop()).ok).toBe(false);
  const retry = new InstrumentEligibility("eligibility-lab", { ...f.ports, repository: repo });
  take(await retry.initialize());
  expect(take(retry.getEligibilityEvidence(saved[0]!.fingerprint))).toEqual(saved[0]);
  expect(take(await repo.load())).toEqual(saved);
  take(await retry.stop());
  take(await retry.stop());
});
for (const corruption of ["policy", "action"] as const)
  it(`A24-M01 ${corruption} cannot use compatibility to bypass integrity`, async () => {
    const rows = structuredClone(snapshots) as Snapshot[];
    if (corruption === "action")
      rows[0] = { ...rows[0]!, action: { ...rows[0]!.action, id: "tampered" } };
    const p = {
      ...recoveryFixture.policy,
      maxRecords: 32,
      compatibleHistoryPolicies: corruption === "policy" ? [] : [snapshots[0]!.policyFingerprint],
    };
    const { result, service } = await recover(p, rows);
    expect(result.ok).toBe(false);
    expect(service.diagnostics().health).toBe("DEGRADED");
    expect((await service.stop()).ok).toBe(false);
  });
it("A24-H01 a newer PASSED timestamp and declaration ID cannot resolve existing conflict", async () => {
  const f = await fixture();
  await f.toResearch();
  await record(f);
  await record(f, { outcome: "FAILED" }, "negative");
  take(f.spec.mapping.base.clock.advanceTo(mustParseUtc("2026-10-10T09:00:01.000Z")));
  const newer = await record(
    f,
    { issuedAt: f.ports.clock.now(), effectiveAt: f.ports.clock.now() },
    "new-positive",
  );
  f.context.attestation = newer.fingerprint;
  expect((await preview(f)).reasons).toContain(conflict);
});
it("A24-H01 different historical policy does not conflict with a current declaration", async () => {
  const f = await fixture();
  await f.toResearch();
  await record(f, { outcome: "FAILED" }, "old-policy-negative");
  const old = take(await f.repository.load())[0] as Snapshot;
  const p = {
    ...f.policy,
    policyId: "new-governed-policy",
    compatibleHistoryPolicies: [old.policyFingerprint],
  };
  const cfg = await configuration(p, f.ports.clock);
  take(await f.service.stop());
  f.service = new InstrumentEligibility("eligibility-lab", {
    ...f.ports,
    configuration: () => cfg,
  });
  take(await f.service.initialize());
  const positive = await record(f, { policyId: p.policyId });
  f.context.attestation = positive.fingerprint;
  expect((await preview(f)).allowed).toBe(true);
});
for (const delta of [-1, 0, 1])
  for (const limit of ["maxInputBytes", "maxInputDepth"] as const)
    it(`A24-M01 physical multi-generation ${limit} boundary delta ${delta}`, async () => {
      const repository = new FilesystemEligibilityRepository(root());
      for (const s of snapshots) expect(take(await repository.commit(s))).toEqual(s);
      const exact = Math.max(
        ...snapshots.map((s) => (limit === "maxInputBytes" ? bytes(s.action) : depth(s.action))),
      );
      const p = {
        ...recoveryFixture.policy,
        [limit]: exact + delta,
        compatibleHistoryPolicies: [snapshots[0]!.policyFingerprint],
      };
      const cfg = await configuration(p, recoveryFixture.ports.clock);
      const reader = new InstrumentEligibility("eligibility-lab", {
        ...recoveryFixture.ports,
        repository,
        configuration: () => cfg,
      });
      expect((await reader.initialize()).ok).toBe(delta >= 0);
      expect(take(await repository.load())).toEqual(snapshots);
      if (delta < 0) {
        expect(reader.diagnostics().readiness).toBe("NOT_READY");
        expect((await reader.stop()).ok).toBe(false);
      } else {
        expect(reader.diagnostics().history).toBe(snapshots.length);
        take(await reader.stop());
      }
    });
for (const outcome of ["FAILED", "INCONCLUSIVE"] as const)
  it(`A24-H01 opposite ordering of the same genuine replay participants cannot conceal ${outcome}`, async () => {
    const f = await fixture();
    await f.toResearch();
    const positive = await record(f);
    const pair = f.context.replay!;
    await record(
      f,
      {
        outcome,
        replay: {
          leftSession: pair.rightSession,
          leftCheckpoint: pair.rightCheckpoint,
          rightSession: pair.leftSession,
          rightCheckpoint: pair.leftCheckpoint,
        },
      },
      "reversed-negative",
    );
    f.context.attestation = positive.fingerprint;
    const assessment = await preview(f);
    expect(assessment.allowed).toBe(false);
    expect(assessment.reasons).toContain(conflict);
    expect((await f.service.requestTransition(f.request("VALIDATED"))).ok).toBe(false);
  });
