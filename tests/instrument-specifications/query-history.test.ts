import { it, expect } from "vitest";
import { fixture, take, declared } from "./fixtures.js";
it.each([
  "SPECIFICATIONS",
  "HISTORY",
  "VALIDATIONS",
  "PROFILES",
  "FIELDS",
  "SESSIONS",
  "LIFECYCLE",
  "MARGIN",
  "RECONCILIATION",
] as const)("bounded %s reads exact generation and rejects an unknown root", async (kind) => {
  const f = await fixture(),
    s = take(await f.service.publish(f.request()));
  const page = take(
    f.service.query({ kind, snapshotFingerprint: s.fingerprint, offset: 0, limit: 1 }),
  );
  expect(page.records).toHaveLength(1);
  expect(
    f.service.query({ kind, snapshotFingerprint: "sha256:" + "f".repeat(64), offset: 0, limit: 1 }),
  ).toMatchObject({ ok: false, error: { code: "HISTORICAL_EVIDENCE_UNAVAILABLE" } });
});
it.each([
  "specificationId",
  "instrumentId",
  "ownerId",
  "namespaceKey",
  "catalogueFingerprint",
  "observationFingerprint",
  "mappingSet",
  "sourceQuality",
] as const)("never ignores accepted %s filters", async (key) => {
  const f = await fixture();
  take(await f.service.publish(f.request()));
  const value =
    key === "instrumentId"
      ? "ins-" + "a".repeat(64)
      : key === "sourceQuality"
        ? "EVIDENCED_RECORDED"
        : key.endsWith("Key") || key.endsWith("Fingerprint") || key === "mappingSet"
          ? "sha256:" + "f".repeat(64)
          : "not-recorded";
  const result = f.service.query({ kind: "HISTORY", offset: 0, limit: 10, [key]: value });
  expect(result.ok).toBe(true);
  expect(take(result).total).toBe(0);
});
it("applies conjunctive filters before pagination with stable ordering", async () => {
  const f = await fixture();
  for (let i = 0; i < 3; i++)
    take(await f.service.publish(f.request("r" + i, i === 1 ? "B" : "A")));
  const p = take(f.service.query({ kind: "HISTORY", specificationId: "A", offset: 0, limit: 1 }));
  expect(p.total).toBe(2);
  expect(p.nextOffset).toBe(1);
  const p2 = take(f.service.query({ kind: "HISTORY", specificationId: "A", offset: 1, limit: 1 }));
  expect(p2.nextOffset).toBeNull();
  expect(p.records[0]).not.toEqual(p2.records[0]);
});
it("requires specification context for a version and rejects unsupported filter combinations", async () => {
  const f = await fixture();
  take(await f.service.publish(f.request()));
  expect(f.service.query({ kind: "HISTORY", version: 1, offset: 0, limit: 1 })).toMatchObject({
    ok: false,
    error: { code: "EXPLICIT_SPECIFICATION_REQUIRED" },
  });
  for (const extra of [
    { field: "price.tick" },
    { profile: "IDENTITY_METADATA" },
    { ignored: "bad" },
  ])
    expect(f.service.query({ kind: "HISTORY", offset: 0, limit: 1, ...extra }).ok).toBe(false);
});
it("profile and field selectors return only the exact requested evidence", async () => {
  const f = await fixture();
  take(await f.service.publish(f.request()));
  expect(
    take(
      f.service.query({ kind: "PROFILES", profile: "PRICE_GRID_RESEARCH", offset: 0, limit: 10 }),
    ).total,
  ).toBe(1);
  expect(
    take(f.service.query({ kind: "FIELDS", field: "price.tick", offset: 0, limit: 10 })).total,
  ).toBe(1);
  expect(
    take(f.service.query({ kind: "FIELDS", field: "price.unknown", offset: 0, limit: 10 })).total,
  ).toBe(0);
});
it("classification query preserves contradictions and effective-time lookup has no fallback", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.price.tick = declared("0.005");
  take(await f.service.publish(r));
  const conflicts = take(
    f.service.query({ kind: "CONFLICTS", classification: "CONTRADICTORY", offset: 0, limit: 100 }),
  );
  expect(conflicts.total).toBeGreaterThan(0);
  expect(
    take(
      f.service.query({
        kind: "HISTORY",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        offset: 0,
        limit: 10,
      }),
    ).total,
  ).toBe(0);
});
it("exact comparisons use canonical decimals but preserve material units and missing evidence", async () => {
  const f = await fixture(),
    a = take(await f.service.publish(f.request())),
    r = f.request("same");
  r.metadata.contract.size = declared("1.00");
  const b = take(await f.service.publish(r));
  expect(take(f.service.compare(a.fingerprint, b.fingerprint)).classification).toBe(
    "EXACT_MATCH_UNDER_RECORDED_POLICY",
  );
  const changed = f.request("units");
  changed.metadata.contract.unit = declared("LOTS");
  const c = take(await f.service.publish(changed));
  expect(take(f.service.compare(a.fingerprint, c.fingerprint)).classification).toBe(
    "INCOMPATIBLE_CONTRACT_SEMANTICS",
  );
});

it("unsupported or contradictory declarations cannot be reported as exact contract equivalence", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.price.quotation = declared("FRACTIONAL_UNKNOWN");
  const a = take(await f.service.publish(r));
  expect(take(f.service.compare(a.fingerprint, a.fingerprint)).classification).toBe(
    "UNSUPPORTED_COMPARISON",
  );
  const bad = f.request("bad");
  bad.metadata.price.tick = declared("0.005");
  const b = take(await f.service.publish(bad));
  expect(take(f.service.compare(b.fingerprint, b.fingerprint)).classification).toBe(
    "INSUFFICIENT_EVIDENCE",
  );
});
it("rejects nonapplicable classification filters rather than pretending to use them", async () => {
  const f = await fixture();
  take(await f.service.publish(f.request()));
  for (const kind of ["FIELDS", "SESSIONS", "LIFECYCLE", "MARGIN", "CHANGES"])
    expect(
      f.service.query({ kind, classification: "CONTRADICTORY", offset: 0, limit: 1 }),
    ).toMatchObject({ ok: false, error: { code: "FILTER_NOT_APPLICABLE" } });
});

it("effectiveAt on margin queries uses margin dates rather than specification lifecycle", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.margin.effectiveFrom = declared(
    (await import("@ate/time")).mustParseUtc("2026-09-01T00:00:00.000Z"),
  );
  r.metadata.margin.effectiveTo = declared(
    (await import("@ate/time")).mustParseUtc("2026-10-01T00:00:00.000Z"),
  );
  take(await f.service.publish(r));
  expect(
    take(
      f.service.query({
        kind: "MARGIN",
        effectiveAt: "2026-10-10T09:00:00.000Z",
        offset: 0,
        limit: 10,
      }),
    ).total,
  ).toBe(0);
  expect(
    take(
      f.service.query({
        kind: "MARGIN",
        effectiveAt: "2026-09-10T09:00:00.000Z",
        offset: 0,
        limit: 10,
      }),
    ).total,
  ).toBe(1);
});

it.each(["UNKNOWN", "ABSENT", "UNSUPPORTED", "CONTRADICTORY"] as const)(
  "identical %s declarations never certify an exact value comparison",
  async (state) => {
    const f = await fixture(),
      r = f.request();
    r.metadata.price.tick = {
      state,
      evidence: "Explicitly unresolved tick declaration",
      ...(state === "CONTRADICTORY" ? { alternatives: ["0.01", "0.05"] } : {}),
    };
    const s = take(await f.service.publish(r));
    expect(take(f.service.compare(s.fingerprint, s.fingerprint)).classification).toBe(
      state === "UNSUPPORTED" ? "UNSUPPORTED_COMPARISON" : "INSUFFICIENT_EVIDENCE",
    );
  },
);
