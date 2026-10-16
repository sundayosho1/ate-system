import { beforeAll, it, expect } from "vitest";
import { MOSECoreRuntime, FilesystemMOSERepository } from "@ate/mose-core";
import { owners, fixture, take, root, type Owners } from "./fixtures.js";
import { started, recover } from "./remediation-helpers.js";
import { multiOwners } from "./multi-owners.js";
let base: Owners;
beforeAll(async () => {
  base = await owners();
});
type F = Awaited<ReturnType<typeof fixture>>;
function failOwner(f: F, owner: "datasets" | "quality" | "historical", fault: string) {
  if (owner === "datasets") {
    const actual = f.ports.datasets;
    f.ports.datasets = {
      getVersion: async (id) => {
        if (fault === "throw") throw Error("OWNER_FAILURE");
        if (fault === "unavailable") return actual.getVersion("missing" as typeof id);
        const r = await actual.getVersion(id);
        if (fault === "malformed") return { ok: true, value: null } as unknown as typeof r;
        return r.ok
          ? {
              ...r,
              value: {
                ...r.value,
                versionFingerprint: ("sha256:" +
                  "0".repeat(64)) as typeof r.value.versionFingerprint,
              },
            }
          : r;
      },
    };
    return () => (f.ports.datasets = actual);
  }
  if (owner === "quality") {
    const actual = f.ports.quality;
    f.ports.quality = {
      getReport: async (id) => {
        if (fault === "throw") throw Error("OWNER_FAILURE");
        if (fault === "unavailable") return actual.getReport("missing" as typeof id);
        const r = await actual.getReport(id);
        if (fault === "malformed") return { ok: true, value: null } as unknown as typeof r;
        return r.ok
          ? {
              ...r,
              value: {
                ...r.value,
                reportFingerprint: "0".repeat(64) as typeof r.value.reportFingerprint,
              },
            }
          : r;
      },
    };
    return () => (f.ports.quality = actual);
  }
  const actual = f.ports.historical;
  f.ports.historical = {
    getManifest: async (id) => {
      if (fault === "throw") throw Error("OWNER_FAILURE");
      if (fault === "unavailable") return actual.getManifest("missing" as typeof id);
      const r = await actual.getManifest(id);
      if (fault === "malformed") return { ok: true, value: null } as unknown as typeof r;
      return r.ok
        ? {
            ...r,
            value: {
              ...r.value,
              contentFingerprint: "0".repeat(64) as typeof r.value.contentFingerprint,
            },
          }
        : r;
    },
  };
  return () => (f.ports.historical = actual);
}
for (const [owner, label] of [
  ["datasets", "E13"],
  ["quality", "E14"],
  ["historical", "E15"],
] as const)
  for (const fault of ["unavailable", "throw", "malformed", "mismatch"])
    it(`${label} ${owner} ${fault} produces truthful fresh health, immutable history and exact restoration`, async () => {
      const f = await started(base);
      take(await f.receive(0));
      take(await f.process());
      const before = take(await f.repository.load()),
        restore = failOwner(f, owner, fault);
      for (let i = 0; i < 2; i++) {
        const h = take(await f.service.health());
        expect(h.health).toBe("DEGRADED");
        expect(h.sourceReadinessAxes[0]).toMatchObject({
          dataSourceReady: false,
          eligibilityReady: true,
          universeAuthority: true,
        });
        expect(h.sourceReadinessAxes[0]!.dataSourceReasons.length).toBeGreaterThan(0);
      }
      expect(take(await f.repository.load())).toEqual(before);
      restore();
      expect(take(await f.service.health()).health).toBe("HEALTHY");
      expect(take(await f.repository.load())).toEqual(before);
    });
for (const owner of ["datasets", "quality", "historical"] as const)
  it(`X12 fresh physical recovery retains history while ${owner} is unavailable`, async () => {
    const f = await fixture(base, {}, new FilesystemMOSERepository(root()));
    await f.setup();
    take(await f.start());
    take(await f.receive(0));
    take(await f.process());
    const before = take(await f.repository.load());
    failOwner(f, owner, "unavailable");
    const n = await recover(f);
    take(n.result);
    expect(n.reader.diagnostics().health).toBe("DEGRADED");
    expect(take(await f.repository.load())).toEqual(before);
    expect(take(n.reader.getSessionSummary("session-A")).admitted).toBe(1);
  });
it("valid current source remains ready with an explicit empty source-reason list", async () => {
  const f = await started(base);
  const h = take(await f.service.health());
  expect(h.health).toBe("HEALTHY");
  expect(h.sourceReadinessAxes[0]).toMatchObject({ dataSourceReady: true, dataSourceReasons: [] });
});
it("current P24 revocation remains separate from available source bindings", async () => {
  const b = await owners(),
    f = await started(b);
  await b.promote("RESEARCH", { disposition: "REVOKED" });
  const h = take(await f.service.health());
  expect(h.health).toBe("DEGRADED");
  expect(h.sourceReadinessAxes[0]).toMatchObject({
    dataSourceReady: true,
    eligibilityReady: false,
  });
});
it("health never trusts a cached source result after the next owner withdrawal", async () => {
  const f = await started(base);
  expect(take(await f.service.health()).health).toBe("HEALTHY");
  failOwner(f, "quality", "unavailable");
  expect(take(await f.service.health()).health).toBe("DEGRADED");
});
it("health does not admit a concurrent mutation during delayed owner binding read", async () => {
  const f = await started(base),
    original = f.ports.datasets;
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (entered = r));
  f.ports.datasets = {
    getVersion: async (id) => {
      entered();
      await held;
      return original.getVersion(id);
    },
  };
  const universe = take(f.service.getUniverse("session-A")),
    event = universe.plan[0]!;
  const health = f.service.health();
  await ready;
  try {
    expect(
      (
        await f.service.dispatch({
          kind: "RECEIVE",
          id: f.next(),
          sessionId: "session-A",
          eventId: event.eventId,
          instrumentId: event.instrumentId,
          universeSnapshot: universe.fingerprint,
        })
      ).ok,
    ).toBe(false);
  } finally {
    release();
  }
  expect(take(await health).health).toBe("HEALTHY");
  expect(take(f.service.getSessionSummary("session-A")).received).toBe(0);
});
it("one unavailable canonical source cannot mask a second genuine ready owner", async () => {
  const m = await multiOwners(),
    f = await fixture(m.a);
  const replay = m.b.context.replay!,
    a = f.create();
  f.ports.datasets = {
    getVersion: (id) =>
      id === m.b.context.datasets[0]!.versionId
        ? m.b.ports.datasets.getVersion(id)
        : m.a.ports.datasets.getVersion(id),
  };
  f.ports.quality = {
    getReport: (id) =>
      id === m.b.context.datasets[0]!.qualityReportId
        ? m.b.ports.quality.getReport(id)
        : m.a.ports.quality.getReport(id),
  };
  f.ports.historical = {
    getManifest: async (id) => {
      const r = await m.b.ports.historical.getManifest(id);
      return r.ok ? r : m.a.ports.historical.getManifest(id);
    },
  };
  f.ports.eligibility = {
    getEligibility: (id) =>
      id === m.b.context.instrumentId
        ? m.b.service.getEligibility(id)
        : m.a.service.getEligibility(id),
  };
  f.ports.replayEvidence = (s, c) =>
    m.b.ports.replayEvidence(s, c) ?? m.a.ports.replayEvidence(s, c);
  take(
    await f.service.dispatch({
      ...a,
      instruments: [
        ...a.instruments,
        {
          instrumentId: m.b.context.instrumentId,
          source: { sessionId: replay.leftSession, checkpoint: replay.leftCheckpoint },
        },
      ],
    }),
  );
  const q = f.ports.quality;
  f.ports.quality = {
    getReport: (id) =>
      id === m.b.context.datasets[0]!.qualityReportId
        ? q.getReport("missing" as typeof id)
        : q.getReport(id),
  };
  const h = take(await f.service.health());
  expect(h.health).toBe("DEGRADED");
  expect(
    h.sourceReadinessAxes.find((x) => x.scope.endsWith(m.a.context.instrumentId))!.dataSourceReady,
  ).toBe(true);
  expect(
    h.sourceReadinessAxes.find((x) => x.scope.endsWith(m.b.context.instrumentId))!.dataSourceReady,
  ).toBe(false);
});
it("fresh healthy reader preserves original observation and emits no extra event", async () => {
  const f = await started(base);
  take(await f.receive(0));
  take(await f.process());
  const history = take(await f.repository.load());
  const s = new MOSECoreRuntime("mose-lab", f.ports);
  take(await s.initialize());
  take(await s.health());
  expect(take(await f.repository.load())).toEqual(history);
});
