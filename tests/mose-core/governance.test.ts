import { beforeAll, it, expect } from "vitest";
import { StaticApprovalAuthorityResolver } from "@ate/configuration";
import { MOSECoreRuntime, FilesystemMOSERepository } from "@ate/mose-core";
import { owners, fixture, take, root, type Owners } from "./fixtures.js";
let base: Owners;
beforeAll(async () => {
  base = await owners();
});
it("universe checker authority withdrawal rejects new pending observations", async () => {
  const f = await fixture(base);
  await f.setup();
  take(await f.start());
  f.ports.authorityResolver = new StaticApprovalAuthorityResolver({ clock: f.clock, grants: {} });
  expect((await f.receive(0)).ok).toBe(false);
  expect(take(f.service.getSessionSummary("session-A")).received).toBe(0);
});
it("authority withdrawn after receipt produces a truthful rejection rather than OBSERVED", async () => {
  const f = await fixture(base);
  await f.setup();
  take(await f.start());
  take(await f.receive(0));
  f.ports.authorityResolver = new StaticApprovalAuthorityResolver({ clock: f.clock, grants: {} });
  const cp = take(await f.process());
  expect(cp.state.sessions[0]!.observations[0]).toMatchObject({
    outcome: "REJECTED",
    reason: "UNIVERSE_NOT_AUTHORIZED",
    funnelEvent: null,
  });
});
it("fresh recovery preserves historical facts but reports current universe authority withdrawal", async () => {
  const repo = new FilesystemMOSERepository(root()),
    f = await fixture(base, {}, repo);
  await f.setup();
  take(await f.start());
  take(await f.receive(0));
  const prior = take(await f.process()).state.sessions[0]!.observations[0];
  const reader = new MOSECoreRuntime("mose-lab", {
    ...f.ports,
    repository: repo,
    authorityResolver: new StaticApprovalAuthorityResolver({ clock: f.clock, grants: {} }),
  });
  take(await reader.initialize());
  expect(reader.diagnostics().health).toBe("DEGRADED");
  expect(
    reader.query({
      kind: "OBSERVATIONS",
      sessionId: "session-A",
      offset: 0,
      limit: 10,
      asOf: null,
    }),
  ).toMatchObject({ ok: true, value: { value: { records: [prior] } } });
  expect(
    (await reader.dispatch({ kind: "START", id: "unauthorized-restart", sessionId: "session-A" }))
      .ok,
  ).toBe(false);
});
it("healthy source and withdrawn authority remain separate health axes", async () => {
  const f = await fixture(base);
  await f.setup();
  f.ports.authorityResolver = new StaticApprovalAuthorityResolver({ clock: f.clock, grants: {} });
  const h = take(await f.service.health());
  expect(h.health).toBe("DEGRADED");
  expect(h.sourceReadinessAxes[0]).toMatchObject({
    dataSourceReady: true,
    eligibilityReady: true,
    universeAuthority: false,
  });
});
it("at most one real repository publication can be outstanding", async () => {
  let release: () => void = () => {
      throw Error("NOT_HELD");
    },
    entered: () => void = () => {
      throw Error("NOT_ENTERED");
    };
  const hold = new Promise<void>((r) => {
      release = r;
    }),
    ready = new Promise<void>((r) => {
      entered = r;
    });
  const actual = new FilesystemMOSERepository(root()),
    f = await fixture(
      base,
      {},
      {
        load: () => actual.load(),
        commit: async (c) => {
          entered();
          await hold;
          return actual.commit(c);
        },
      },
    );
  const first = f.service.dispatch(f.create());
  await ready;
  expect(f.service.diagnostics().pendingAcknowledgments).toBe(1);
  expect((await f.service.dispatch(f.create("other"))).ok).toBe(false);
  release();
  take(await first);
  expect(f.service.diagnostics()).toMatchObject({ pendingAcknowledgments: 0, history: 1 });
});
it("fully acknowledged capacity rejection permits clean local shutdown without invented debt", async () => {
  const f = await fixture(base, { maxHistory: 1 });
  await f.setup();
  expect((await f.start()).ok).toBe(false);
  expect(f.service.diagnostics().recoveryObligation).toBeNull();
  take(await f.service.stop());
  take(await f.service.stop());
  expect(f.service.diagnostics().lifecycle).toBe("STOPPED");
});
it("P24 revocation cannot enter a pending/admitted state even for the immediate receipt boundary", async () => {
  const b = await owners(),
    f = await fixture(b);
  await f.setup();
  take(await f.start());
  await b.promote("RESEARCH", { disposition: "REVOKED", reason: "Withdraw before receipt" });
  const cp = take(await f.receive(0));
  expect(cp.state.sessions[0]!.observations[0]).toMatchObject({
    outcome: "REJECTED",
    reason: "INSTRUMENT_INELIGIBLE",
    funnelEvent: null,
  });
  expect(take(f.service.getSessionSummary("session-A"))).toMatchObject({
    pending: 0,
    admitted: 0,
    rejected: 1,
  });
});
it("a wholly withdrawn immutable universe cannot silently START active surveillance", async () => {
  const b = await owners(),
    f = await fixture(b);
  await f.setup();
  await b.promote("RESEARCH", { disposition: "REVOKED", reason: "Withdraw before start" });
  expect((await f.start()).ok).toBe(false);
  expect(f.service.diagnostics().lifecycle).not.toBe("RUNNING");
});
it("a genuine response for A cannot lend its authority to a different requested canonical instrument", async () => {
  const f = await fixture(base);
  f.ports.eligibility = {
    getEligibility: () => base.service.getEligibility(base.context.instrumentId),
  };
  const a = f.create();
  const cp = take(
    await f.service.dispatch({
      ...a,
      instruments: a.instruments.map((i) => ({
        ...i,
        instrumentId: "different-canonical-instrument",
      })),
    }),
  );
  expect(cp.state.sessions[0]!.universe.members[0]).toMatchObject({
    included: false,
    eligible: false,
    reasons: ["INSTRUMENT_INELIGIBLE"],
  });
  expect(cp.state.sessions[0]!.universe.plan).toHaveLength(0);
});
it("a changed current assessment cannot reuse an older owner's fingerprint", async () => {
  const f = await fixture(base);
  f.ports.eligibility = {
    getEligibility: async (id) => {
      const r = await base.service.getEligibility(id);
      return r.ok
        ? {
            ok: true,
            value: {
              ...r.value,
              current: { ...r.value.current, contextFingerprint: "sha256:" + "0".repeat(64) },
            },
          }
        : r;
    },
  };
  const u = await f.setup();
  expect(u.members[0]!.included).toBe(false);
});
