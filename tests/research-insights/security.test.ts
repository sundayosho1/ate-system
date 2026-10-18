import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { DomainResult } from "@ate/domain";
import type { InsightRecord } from "@ate/research-insight-contracts";
import type { SourceManifest } from "@ate/research-insights";
import * as C from "@ate/research-insight-contracts";
import * as I from "@ate/research-insights";
const fixture = JSON.parse(
  readFileSync("tests/research-insights/fixtures/owner-evidence.json", "utf8"),
) as {
  samples: Record<string, Record<string, unknown>>;
  manifest: SourceManifest;
  generatedAt: string;
};
const take = <T>(r: DomainResult<T>): T => {
  if (!r.ok) throw Error(r.issues.map((x) => x.code).join(","));
  return r.value;
};
const rec = (kind: string) => structuredClone(fixture.samples[kind]!);

for (const [unsafeIndex, raw] of [
  undefined,
  NaN,
  Infinity,
  () => 0,
  Symbol("unsafe"),
  new Date(),
  new Map(),
  new Set(),
].entries())
  it(`reject unsafe projection ${unsafeIndex}`, () =>
    expect(I.canonicalInsightBytes(raw).ok).toBe(false));
it("toJSON never invoked", () => {
  let called = 0;
  const r = I.canonicalInsightBytes({
    toJSON() {
      called++;
      return {};
    },
  });
  expect(r.ok).toBe(false);
  expect(called).toBe(0);
});
it("getter never invoked", () => {
  let called = 0;
  const r = I.canonicalInsightBytes({
    get ok() {
      called++;
      throw Error("unsafe");
    },
  });
  expect(r.ok).toBe(false);
  expect(called).toBe(0);
});
it("throwing proxy contained", () =>
  expect(
    I.canonicalInsightBytes(
      new Proxy(
        {},
        {
          ownKeys() {
            throw Error("unsafe");
          },
        },
      ),
    ).ok,
  ).toBe(false));
it("cycle rejected", () => {
  const a: Record<string, unknown> = {};
  a.self = a;
  expect(I.canonicalInsightBytes(a).ok).toBe(false);
});
it("prototype pollution key rejected", () =>
  expect(I.canonicalInsightBytes(JSON.parse('{"__proto__":{"polluted":true}}') as unknown).ok).toBe(
    false,
  ));
it("null prototype safe data accepted", () => {
  const a = Object.create(null) as Record<string, unknown>;
  a.a = 1;
  expect(I.canonicalInsightBytes(a).ok).toBe(true);
});
it("schema validation does not authenticate source", () => {
  const r = take(
    C.validateInsightRecord("EvidenceReference", rec("EvidenceReference")),
  ) as InsightRecord;
  expect(r).not.toHaveProperty("authenticated");
});

it("null search catalogue is structured rejection", () =>
  expect(I.searchKnowledge(null as unknown as I.KnowledgeCatalogue, { query: "" }).ok).toBe(false));
it("hostile scope is not coerced", () => {
  let calls = 0;
  const scope = {
    toString() {
      calls++;
      throw Error("unsafe");
    },
  };
  expect(I.canonicalInsightBytes({}, scope as unknown as "ENTRY").ok).toBe(false);
  expect(calls).toBe(0);
});
it("hostile schema selector is not coerced", () => {
  let calls = 0;
  const k = {
    toString() {
      calls++;
      throw Error("unsafe");
    },
  };
  expect(
    C.validateInsightRecord(k as unknown as Parameters<typeof C.validateInsightRecord>[0], {}).ok,
  ).toBe(false);
  expect(calls).toBe(0);
});

it("array cell getter is not executed", () => {
  let calls = 0;
  const entries: unknown[] = [];
  Object.defineProperty(entries, "0", {
    enumerable: true,
    get() {
      calls++;
      throw Error("unsafe");
    },
  });
  expect(
    I.createKnowledgeCatalogue({
      entries,
      sourceManifest: fixture.manifest,
      qualificationIds: [],
      generatedAt: fixture.generatedAt,
    }).ok,
  ).toBe(false);
  expect(calls).toBe(0);
});

it("ill-formed Unicode is rejected without coercion", () => {
  expect(I.canonicalInsightBytes("\uD800").ok).toBe(false);
  expect(I.canonicalInsightBytes("😀").ok).toBe(true);
});

it("oversized array rejected before enumerating its cells", () => {
  let scans = 0;
  const raw = new Proxy(new Array(10001), {
    ownKeys(target) {
      scans++;
      return Reflect.ownKeys(target);
    },
  });
  expect(I.canonicalInsightBytes(raw).ok).toBe(false);
  expect(scans).toBe(0);
});
