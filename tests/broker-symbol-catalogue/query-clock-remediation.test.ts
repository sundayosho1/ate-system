import { it, expect } from "vitest";
import {
  BrokerSymbolCatalogue,
  FilesystemCatalogueRepository,
  defaultPolicy,
  fail,
  type Catalogue,
} from "@ate/broker-symbol-catalogue";
import { StaticApprovalAuthorityResolver, fingerprint } from "@ate/configuration";
import { mustParseUtc, createSystemUtcClock, type Clock } from "@ate/time";
import { registered, batch, take, maker, checker, root } from "./fixtures.js";

const kinds = [
  "NAMESPACES",
  "CATALOGUES",
  "OBSERVATIONS",
  "MAPPINGS",
  "UNRESOLVED",
  "HISTORY",
] as const;
async function data() {
  const f = await registered();
  const b = batch("first", ["SYN.A", "OTHER"]);
  b.records[0]!.declaredFamily = "EQUITY";
  b.records[0]!.identifiers = [
    { scheme: "RESEARCH", scope: "synthetic-broker", value: "economic-A" },
  ];
  b.records[1]!.declaredFamily = "FX";
  const c = take(await f.lab.importNative(b));
  const p = take(
    await f.lab.propose({
      catalogueFingerprint: c.fingerprint,
      rawSymbol: "SYN.A",
      selector: { kind: "IDENTIFIER", index: 0 },
      maker,
      reason: "Scoped claim",
    }),
  );
  const second = batch("second", ["SECOND"]);
  second.namespace.terminalFixtureId = "fixture-2";
  const c2 = take(await f.lab.importNative(second));
  return { ...f, c, c2, p };
}
const page = (kind: (typeof kinds)[number], filters: Record<string, unknown> = {}) => ({
  kind,
  offset: 0,
  limit: 10,
  ...filters,
});
it.each(kinds)(
  "%s applies all six supported filters, AND composition and contradictions",
  async (kind) => {
    const f = await data();
    const filters = {
      catalogueFingerprint: f.c.fingerprint,
      namespaceKey: f.c.namespaceKey,
      version: 1,
      rawSymbol: "SYN.A",
      normalizedKey: "SYN.A",
      family: "EQUITY",
    };
    for (const [key, value] of Object.entries(filters)) {
      expect(take(f.lab.query(page(kind, { [key]: value }))).total).toBeGreaterThan(0);
    }
    expect(take(f.lab.query(page(kind, filters))).total).toBeGreaterThan(0);
    expect(take(f.lab.query(page(kind, { ...filters, family: "FX" }))).total).toBe(0);
    expect(take(f.lab.query(page(kind, { namespaceKey: "sha256:" + "0".repeat(64) }))).total).toBe(
      0,
    );
    expect(take(f.lab.query(page(kind, { rawSymbol: "ABSENT" }))).total).toBe(0);
    expect(take(f.lab.query(page(kind, { normalizedKey: "absent" }))).total).toBe(0);
    expect(f.lab.query(page(kind, { family: "invented" })).ok).toBe(false);
    expect(f.lab.query(page(kind, { catalogueFingerprint: "sha256:" + "0".repeat(64) })).ok).toBe(
      false,
    );
  },
);
it("historical namespace/catalogue filters use the generation's own retained evidence", async () => {
  const f = await data();
  const history = take(f.lab.query(page("HISTORY", { namespaceKey: f.c2.namespaceKey })));
  expect(history.total).toBe(1);
  const rows = history.records as { catalogues: Catalogue[] }[];
  expect(rows.every((s) => s.catalogues.some((c) => c.namespaceKey === f.c2.namespaceKey))).toBe(
    true,
  );
  expect(take(f.lab.query(page("HISTORY", { catalogueFingerprint: f.c2.fingerprint }))).total).toBe(
    1,
  );
  const earlier = take(f.lab.query(page("HISTORY", { catalogueFingerprint: f.c.fingerprint })))
    .records as { fingerprint: string }[];
  expect(take(f.lab.snapshot(earlier[0]!.fingerprint))!.catalogues).toHaveLength(1);
  expect(f.lab.snapshot("sha256:" + "0".repeat(64)).ok).toBe(false);
});
it("declared family remains distinct from the selected canonical family", async () => {
  const f = await data();
  expect(take(f.lab.query(page("MAPPINGS", { family: "FX" }))).total).toBe(0);
  expect(take(f.lab.query(page("MAPPINGS", { family: "EQUITY" }))).total).toBe(1);
});
it("filtering precedes pagination and queries leave durable/current/history evidence unchanged", async () => {
  const f = await data(),
    before = take(await f.repository.load());
  const all = take(f.lab.query(page("HISTORY", { namespaceKey: f.c.namespaceKey })));
  const first = take(f.lab.query(page("HISTORY", { namespaceKey: f.c.namespaceKey, limit: 1 })));
  const second = take(
    f.lab.query(page("HISTORY", { namespaceKey: f.c.namespaceKey, limit: 1, offset: 1 })),
  );
  expect(first.total).toBe(all.total);
  expect(first.nextOffset).toBe(1);
  expect([...first.records, ...second.records]).toEqual(all.records.slice(0, 2));
  expect(
    take(f.lab.query(page("HISTORY", { namespaceKey: f.c2.namespaceKey, offset: 1 }))),
  ).toEqual({ total: 1, records: [], nextOffset: null });
  expect(take(f.lab.query(page("HISTORY")))).toEqual(take(f.lab.query(page("HISTORY"))));
  expect(take(await f.repository.load())).toEqual(before);
});

async function temporal() {
  const f = await registered(),
    b = batch();
  b.records[0]!.identifiers = [
    { scheme: "RESEARCH", scope: "synthetic-broker", value: "economic-A" },
  ];
  const c = take(await f.lab.importNative(b));
  const p = take(
    await f.lab.propose({
      catalogueFingerprint: c.fingerprint,
      rawSymbol: "SYN.A",
      selector: { kind: "IDENTIFIER", index: 0 },
      maker,
      reason: "Scoped claim",
    }),
  );
  return { ...f, p };
}
const review = (candidate?: string) => ({
  checker,
  state: candidate ? "APPROVED_FOR_RESEARCH_ASSOCIATION" : "NEEDS_REVIEW",
  ...(candidate ? { selectedCandidate: candidate } : {}),
  reason: "Clock-qualified review",
});
function ticking(f: Awaited<ReturnType<typeof temporal>>, start: string, step: number): Clock {
  let next = Date.parse(start);
  return {
    mode: f.clock.mode,
    provenance: f.clock.provenance,
    now: () => {
      const at = mustParseUtc(new Date(next).toISOString());
      next += step;
      return at;
    },
  };
}
it.each([
  ["stable", "2026-10-10T09:00:00.000Z", 0],
  ["one millisecond", "2026-10-10T09:00:00.000Z", 1],
  ["several milliseconds", "2026-10-10T09:00:00.000Z", 7],
  ["second", "2026-10-10T09:00:00.998Z", 1],
  ["minute", "2026-10-10T09:00:59.998Z", 1],
  ["date", "2026-10-10T23:59:59.998Z", 1],
] as const)(
  "actual owner accepts %s advancement and fresh recovery preserves decision time",
  async (_label, start, step) => {
    const f = await temporal(),
      clock = ticking(f, start, step);
    f.ports.clock = clock;
    f.ports.authorityResolver = new StaticApprovalAuthorityResolver({
      clock,
      grants: { [checker.actorId]: ["CONFIGURATION_CHECKER"] },
    });
    const d = take(await f.lab.review(f.p.proposalId, review(f.p.candidateIds[0])));
    expect(d.decidedAt).toBe(d.authorityEvidence.checkedAt);
    expect(Date.parse(d.decidedAt)).toBeGreaterThanOrEqual(Date.parse(start));
    take(await f.lab.stop());
    const fresh = new BrokerSymbolCatalogue("offline-lab", f.ports);
    take(await fresh.initialize());
    expect(take(fresh.mapping(f.p.proposalId)).decisions).toEqual([d]);
    expect(fresh.diagnostics().readiness).toBe("READY");
    take(await fresh.stop());
  },
);
it.each([-1, 0, 1] as const)(
  "certificate at observation boundary offset %s: stale/future rejected, exact accepted",
  async (offset) => {
    const f = await temporal(),
      owner = f.ports.authorityResolver,
      before = take(await f.repository.load());
    f.ports.authorityResolver = {
      resolve: (actor, requirement) => {
        const result = owner.resolve(actor, requirement);
        if (!result.ok) return result;
        return {
          ok: true,
          value: {
            ...result.value,
            checkedAt: mustParseUtc(new Date(Date.parse(f.clock.now()) + offset).toISOString()),
          },
        };
      },
    };
    const r = await f.lab.review(f.p.proposalId, review());
    expect(r.ok).toBe(offset === 0);
    if (offset !== 0) {
      expect(r).toEqual(fail("APPROVAL_CERTIFICATE_MISMATCH"));
      expect(take(await f.repository.load())).toEqual(before);
    }
  },
);
it.each([
  "false",
  "actor",
  "role",
  "extra-validity",
  "revoked",
  "clock-unavailable",
  "provenance",
  "conflict",
] as const)("rejects %s without publication or losing retry readiness", async (mode) => {
  const f = await temporal(),
    owner = f.ports.authorityResolver;
  const clock = f.ports.clock;
  f.ports.authorityResolver = {
    resolve: (actor, requirement) => {
      const result = owner.resolve(actor, requirement);
      if (!result.ok) return result;
      if (mode === "clock-unavailable")
        f.ports.clock = {
          ...clock,
          now: () => {
            throw Error("CLOCK_UNAVAILABLE");
          },
        };
      if (mode === "provenance")
        f.ports.clock = { ...clock, provenance: { ...clock.provenance, clockId: "" } };
      if (mode === "conflict")
        f.ports.clock = {
          ...clock,
          now: () => clock.now(),
          provenance: { ...clock.provenance, clockId: "other" },
        };
      return {
        ok: true,
        value: {
          ...result.value,
          ...(mode === "false" || mode === "revoked" ? { authorized: false } : {}),
          ...(mode === "actor" ? { actorId: maker.actorId } : {}),
          ...(mode === "role" ? { authority: "UNAUTHORIZED" } : {}),
          ...(mode === "extra-validity" ? { expiresAt: clock.now() } : {}),
        } as typeof result.value,
      };
    },
  };
  const before = take(await f.repository.load());
  expect((await f.lab.review(f.p.proposalId, review())).ok).toBe(false);
  expect(take(await f.repository.load())).toEqual(before);
  f.ports.clock = clock;
  f.ports.authorityResolver = owner;
  take(await f.lab.review(f.p.proposalId, review()));
  take(await f.lab.stop());
});
it("actual system clock and actual authority interoperate without requiring a millisecond race", async () => {
  const f = await temporal(),
    clock = createSystemUtcClock();
  f.ports.clock = clock;
  f.ports.authorityResolver = new StaticApprovalAuthorityResolver({
    clock,
    grants: { [checker.actorId]: ["CONFIGURATION_CHECKER"] },
  });
  const d = take(await f.lab.review(f.p.proposalId, review()));
  expect(d.clockProvenance).toEqual(clock.provenance);
  expect(d.decidedAt).toBe(d.authorityEvidence.checkedAt);
});
it("advancing clock approval receives real filesystem ACK and survives fresh recovery", async () => {
  const f = await temporal(),
    disk = new FilesystemCatalogueRepository(
      root(),
      defaultPolicy.maxSnapshotBytes,
      defaultPolicy.maxSnapshots,
      defaultPolicy.maxRetainedBytes,
    );
  for (const s of take(await f.repository.load()))
    take(await disk.commit(s as Parameters<typeof disk.commit>[0]));
  f.ports.repository = disk;
  const clock = ticking(f, "2026-10-10T09:00:00.000Z", 1);
  f.ports.clock = clock;
  f.ports.authorityResolver = new StaticApprovalAuthorityResolver({
    clock,
    grants: { [checker.actorId]: ["CONFIGURATION_CHECKER"] },
  });
  const d = take(await f.lab.review(f.p.proposalId, review(f.p.candidateIds[0])));
  const saved = take(f.lab.snapshot())!;
  expect(fingerprint(take(await disk.load()).at(-1))).toBe(fingerprint(saved));
  take(await f.lab.stop());
  const fresh = new BrokerSymbolCatalogue("offline-lab", f.ports);
  take(await fresh.initialize());
  expect(take(fresh.snapshot())).toEqual(saved);
  expect(take(fresh.mapping(f.p.proposalId)).decisions).toEqual([d]);
  take(await fresh.stop());
});

it("two/three filters, no filters and approved versus unresolved views preserve current evidence", async () => {
  const f = await data();
  expect(take(f.lab.query(page("OBSERVATIONS"))).total).toBe(3);
  expect(
    take(f.lab.query(page("OBSERVATIONS", { namespaceKey: f.c.namespaceKey, family: "FX" }))).total,
  ).toBe(1);
  expect(
    take(
      f.lab.query(
        page("MAPPINGS", {
          namespaceKey: f.c.namespaceKey,
          rawSymbol: "SYN.A",
          normalizedKey: "SYN.A",
        }),
      ),
    ).total,
  ).toBe(1);
  take(await f.lab.review(f.p.proposalId, review(f.p.candidateIds[0])));
  expect(take(f.lab.query(page("MAPPINGS", { family: "EQUITY" }))).total).toBe(1);
  expect(take(f.lab.query(page("UNRESOLVED", { family: "EQUITY" }))).total).toBe(0);
});
it("actual owner requirement remains configuration checker research policy, never actor role text", async () => {
  const f = await temporal(),
    owner = f.ports.authorityResolver;
  f.ports.authorityResolver = {
    resolve: (actor, requirement) => {
      expect(requirement).toEqual({
        classification: "STANDARD",
        requiredAuthority: "CONFIGURATION_CHECKER",
        runtimeMode: "RESEARCH",
        policyId: defaultPolicy.approvalPolicyId,
      });
      return owner.resolve(actor, requirement);
    },
  };
  take(await f.lab.review(f.p.proposalId, review()));
  expect((await f.lab.review(f.p.proposalId, { ...review(), checker: maker })).ok).toBe(false);
});
it.each([-1, 0, 1] as const)(
  "source age at stale boundary offset %s remains enforced",
  async (offset) => {
    const f = await temporal();
    f.clock.advanceTo(
      mustParseUtc(
        new Date(Date.parse(f.clock.now()) + defaultPolicy.staleAfterMs + offset).toISOString(),
      ),
    );
    expect((await f.lab.review(f.p.proposalId, review(f.p.candidateIds[0]))).ok).toBe(offset <= 0);
  },
);
it("callback source expiry cannot use an earlier still-fresh transition", async () => {
  const f = await temporal(),
    owner = f.ports.authorityResolver;
  f.ports.authorityResolver = {
    resolve: (actor, requirement) => {
      const r = owner.resolve(actor, requirement);
      f.clock.advanceTo(
        mustParseUtc(
          new Date(Date.parse(f.clock.now()) + defaultPolicy.staleAfterMs + 1).toISOString(),
        ),
      );
      return r;
    },
  };
  const before = take(await f.repository.load());
  expect((await f.lab.review(f.p.proposalId, review(f.p.candidateIds[0]))).ok).toBe(false);
  expect(take(await f.repository.load())).toEqual(before);
});
it("advancing-time genuinely lost ACK retains exact publication and never conceals uncertainty", async () => {
  const f = await temporal(),
    disk = f.repository;
  let attempted: { generation: number; fingerprint: string } | undefined;
  f.ports.repository = {
    load: () => disk.load(),
    commit: async (s) => {
      take(await disk.commit(s));
      attempted = { generation: s.generation, fingerprint: s.fingerprint };
      return fail("LOST_ACK", "UNKNOWN");
    },
  };
  const clock = ticking(f, "2026-10-10T09:00:00.000Z", 1);
  f.ports.clock = clock;
  f.ports.authorityResolver = new StaticApprovalAuthorityResolver({
    clock,
    grants: { [checker.actorId]: ["CONFIGURATION_CHECKER"] },
  });
  const r = await f.lab.review(f.p.proposalId, review(f.p.candidateIds[0]));
  expect(r).toEqual(fail("LOST_ACK", "UNKNOWN"));
  expect(f.lab.diagnostics()).toMatchObject({
    readiness: "NOT_READY",
    health: "DEGRADED",
    pending: 1,
    unresolvedPublication: attempted,
  });
  expect((await f.lab.stop()).ok).toBe(false);
  expect((await f.lab.stop()).ok).toBe(false);
  const fresh = new BrokerSymbolCatalogue("offline-lab", { ...f.ports, repository: disk });
  take(await fresh.initialize());
  expect(take(fresh.snapshot())!.fingerprint).toBe(attempted!.fingerprint);
  take(await fresh.stop());
});
