import { it, expect } from "vitest";
import { mustParseUtc } from "@ate/time";
import { calendarSchema } from "@ate/multitimeframe";
import {
  InstrumentSpecifications,
  FilesystemSpecificationRepository,
} from "@ate/instrument-specifications";
import { addIdentity } from "../canonical-symbol-mapping/fixtures.js";
import { fixture, declared, take, root } from "./fixtures.js";
it("J1 FX precision and source evidence through P20/P21/P22 public owners", async () => {
  const f = await fixture(),
    set = await f.fx(),
    r = f.request();
  r.mappingSet = set.fingerprint;
  r.mappingFingerprint = set.prepared.mappings.find((x) => x.target?.family === "FX")!.fingerprint;
  r.metadata.contract.family = declared("FX");
  r.metadata.contract.type = declared("SPOT");
  r.metadata.contract.unit = declared("BASE_UNITS");
  r.metadata.price.precision = declared(5);
  r.metadata.price.point = declared("0.00001");
  r.metadata.price.tick = declared("0.00005");
  r.metadata.price.minimumIncrement = declared("0.00005");
  r.metadata.price.samplePrice = declared("1.15005");
  const s = take(await f.service.publish(r));
  expect(
    s.prepared.validations.find((x) => x.ruleId === "PRICE_PRECISION_POINT")?.classification,
  ).toBe("INTERNALLY_CONSISTENT");
  expect(s.prepared.context.catalogueFingerprint).toBe(
    set.prepared.mappings.find((x) => x.target?.family === "FX")!.source.catalogueFingerprint,
  );
  expect(s.prepared.rawInputFingerprint).toHaveLength(71);
});
it("J2 two broker-specific contracts retain a material size difference", async () => {
  const f = await fixture();
  await f.mapping.import("other", "SYN.A-pro", "broker-B");
  const set = take(await f.mapping.service.publish(f.mapping.request("two-brokers")));
  const a = f.request("broker-a", "spec-a"),
    b = f.request("broker-b", "spec-b");
  a.mappingSet = b.mappingSet = set.fingerprint;
  a.mappingFingerprint = set.prepared.mappings[0]!.fingerprint;
  b.mappingFingerprint = set.prepared.mappings[1]!.fingerprint;
  b.metadata.contract.size = declared("100");
  const sa = take(await f.service.publish(a)),
    sb = take(await f.service.publish(b)),
    c = take(f.service.compare(sa.fingerprint, sb.fingerprint));
  expect(c.classification).toBe("MATERIAL_DIFFERENCE");
  expect(c.differences.some((x) => x.field === "contract.size")).toBe(true);
  expect(c.tradingAuthority).toBe(false);
});
it("J3 inconsistent grid is recorded as contradictory without repair", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.price.tick = declared("0.005");
  const s = take(await f.service.publish(r));
  expect(
    s.prepared.validations.find((x) => x.ruleId === "PRICE_TICK_REPRESENTABILITY")?.classification,
  ).toBe("CONTRADICTORY");
  expect(s.prepared.normalized.price.tick?.value).toBe("0.005");
});
it("J4 inclusive and exclusive quantity boundaries are exact", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.volume.sampleQuantity = declared("0.1");
  r.metadata.volume.minimumInclusive = declared(false);
  const a = take(await f.service.publish(r));
  expect(a.prepared.validations.find((x) => x.ruleId === "VOLUME_SAMPLE")?.classification).toBe(
    "CONTRADICTORY",
  );
  const next = f.request("inclusive");
  next.metadata.volume.sampleQuantity = declared("0.1");
  const b = take(await f.service.publish(next));
  expect(b.prepared.validations.find((x) => x.ruleId === "VOLUME_SAMPLE")?.classification).toBe(
    "INTERNALLY_CONSISTENT",
  );
});
it("J5 cross-midnight schedule and DST folds delegate to accepted calendar authority", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.sessions.calendar = declared(
    calendarSchema.parse({
      id: "new-york",
      version: "1",
      kind: "EXPLICIT_SESSION_SCHEDULE",
      timezone: "America/New_York",
      fold: "REJECT",
      sessions: [
        {
          id: "overnight",
          date: "2026-10-09",
          open: "2026-10-09T22:00:00.000Z",
          close: "2026-10-10T10:00:00.000Z",
          breaks: [],
        },
      ],
    }),
  );
  r.metadata.sessions.effectiveFrom = declared(mustParseUtc("2026-10-01T00:00:00.000Z"));
  const s = take(await f.service.publish(r));
  expect(s.prepared.context.calendarFingerprint).toHaveLength(71);
  const local = { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0, millisecond: 0 };
  expect(f.service.sessionLocalBoundary(s.fingerprint, local)).toMatchObject({
    ok: false,
    error: { code: "AMBIGUOUS_LOCAL_TIME" },
  });
  expect(
    take(f.service.sessionLocalBoundary(s.fingerprint, { ...local, month: 10, day: 10, hour: 9 })),
  ).toBe("2026-10-10T13:30:00.000Z");
});
it("J6 derivative expiry and maturity preserve immutable historical distinctions", async () => {
  const f = await fixture(),
    r = f.request();
  const future = await addIdentity(
    f.mapping,
    "FUT",
    {
      family: "FUTURE",
      kind: "EXPIRING",
      underlying: f.set.prepared.mappings[0]!.target!.instrumentId,
      venue: "SYNTHETIC",
      contract: "FUT1",
      expiry: mustParseUtc("2026-12-01T00:00:00.000Z"),
    },
    "future",
  );
  await f.mapping.import("future", "SYN.FUT", "derivative-broker", ["future"]);
  const set = take(await f.mapping.service.publish(f.mapping.request("future-set")));
  r.mappingSet = set.fingerprint;
  r.mappingFingerprint = set.prepared.mappings.find(
    (m) => m.target?.instrumentId === future.instrumentId,
  )!.fingerprint;
  r.metadata.contract.family = declared("FUTURE");
  r.metadata.contract.type = declared("EXPIRING");
  r.metadata.contract.expiry = declared(mustParseUtc("2026-12-01T00:00:00.000Z"));
  r.metadata.lifecycle.expiry = declared(mustParseUtc("2026-12-01T00:00:00.000Z"));
  r.metadata.lifecycle.maturity = declared(mustParseUtc("2026-12-03T00:00:00.000Z"));
  const a = take(await f.service.publish(r));
  r.requestId = "revised";
  r.metadata.lifecycle.maturity = declared(mustParseUtc("2026-12-04T00:00:00.000Z"));
  const b = take(await f.service.publish(r));
  expect(
    take(f.service.snapshot(a.fingerprint))?.prepared.normalized.lifecycle.maturity?.value,
  ).toBe("2026-12-03T00:00:00.000Z");
  expect(b.parentVersion).toBe(a.fingerprint);
  expect(
    take(f.service.compare(a.fingerprint, b.fingerprint)).differences.some(
      (x) => x.field === "lifecycle.maturity",
    ),
  ).toBe(true);
});
it("J7 historical margin metadata does not become current sufficiency", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.margin = {
    initial: declared("100"),
    effectiveFrom: declared(mustParseUtc("2026-09-01T00:00:00.000Z")),
    effectiveTo: declared(mustParseUtc("2026-10-01T00:00:00.000Z")),
  };
  const s = take(await f.service.publish(r));
  expect(
    s.prepared.validations.find((x) => x.ruleId === "MARGIN_APPLICABILITY")?.classification,
  ).toBe("INCOMPLETE");
  expect(
    s.prepared.validations.find((x) => x.ruleId === "MARGIN_APPLICABILITY")?.explanation,
  ).toContain("Missing");
  expect(
    s.prepared.completeness.find((x) => x.profile === "DECLARED_MARGIN_RESEARCH")?.classification,
  ).toBe("STALE_CONTEXT");
  expect(f.service.diagnostics().tradingAuthority).toBe(false);
});
it("J8 immutable change and reconciliation reports preserve old conclusions", async () => {
  const f = await fixture(),
    a = take(await f.service.publish(f.request())),
    r = f.request("change");
  r.metadata.contract.size = declared("10");
  const b = take(await f.service.publish(r));
  expect(b.specificationVersion).toBe(2);
  expect(
    take(
      f.service.query({
        kind: "CHANGES",
        snapshotFingerprint: b.fingerprint,
        offset: 0,
        limit: 10,
      }),
    ).total,
  ).toBe(1);
  const first = take(f.service.snapshot(a.fingerprint));
  expect(first).toEqual(a);
  expect(
    take(
      f.service.query({
        kind: "RECONCILIATION",
        snapshotFingerprint: a.fingerprint,
        offset: 0,
        limit: 10,
      }),
    ).total,
  ).toBe(1);
});
it("J9 fresh filesystem reader recovers acknowledged evidence before shutdown", async () => {
  const path = root(),
    f = await fixture(undefined, new FilesystemSpecificationRepository(path)),
    s = take(await f.service.publish(f.request()));
  take(await f.service.stop());
  const reader = new InstrumentSpecifications("spec-lab", {
    ...f.ports,
    repository: new FilesystemSpecificationRepository(path),
  });
  expect(take(await reader.initialize())?.fingerprint).toBe(s.fingerprint);
  expect(
    take(
      reader.query({
        kind: "SPECIFICATIONS",
        snapshotFingerprint: s.fingerprint,
        offset: 0,
        limit: 1,
      }),
    ).total,
  ).toBe(1);
  expect(reader.diagnostics().readiness).toBe("READY");
  take(await reader.stop());
  expect(reader.snapshot(s.fingerprint).ok).toBe(false);
});
it("J10 adversarial oversized input cannot change accepted durable history", async () => {
  const f = await fixture(),
    s = take(await f.service.publish(f.request())),
    r = f.request("oversize");
  r.rawEvidence = "X".repeat(70000);
  expect((await f.service.publish(r)).ok).toBe(false);
  expect(take(f.service.snapshot())?.fingerprint).toBe(s.fingerprint);
  expect(take(await f.repository.load())).toHaveLength(1);
  expect(f.service.diagnostics().pending).toBe(0);
});
