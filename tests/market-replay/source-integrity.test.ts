import { describe, it, expect } from "vitest";
import {
  resolveHistoricalReplayInputs,
  DeterministicReplaySequencer,
  createReplaySpecification,
} from "@ate/market-replay";
import { historicalFixture } from "./historical-fixture.js";
import { replayFixture, t } from "./fixtures.js";
import type { HistoricalDatasetRepository } from "@ate/historical-data";
describe("real historical/quality/catalogue owner ingestion and hostile pagination", () => {
  it("resolves actual paginated imports and governed quality/catalogue identities", async () => {
    const f = await historicalFixture();
    const r = await resolveHistoricalReplayInputs(f.options);
    expect(r.manifests[0]!.records).toHaveLength(3);
    expect(r.manifests[0]!.qualityReferences).toEqual([f.report.reportFingerprint]);
    expect(r.manifests[0]!.records[0]!.qualityAvailableAt).toBe(f.clock.now());
    await r.verify();
  });
  for (const fault of ["missing", "repeated", "regressed", "oversized", "corrupted"] as const)
    it(`rejects ${fault} historical page without certification`, async () => {
      const f = await historicalFixture();
      let page = 0;
      const repository: HistoricalDatasetRepository = {
        ...f.repository,
        getManifest: (id) => f.repository.getManifest(id),
        stageDataset: (d) => f.repository.stageDataset(d),
        publishDataset: (id) => f.repository.publishDataset(id),
        quarantine: (v) => f.repository.quarantine(v),
        diagnostics: () => f.repository.diagnostics(),
        query: async (q) => {
          page++;
          const { cursor: _cursor, ...initialQuery } = q;
          const r = await f.repository.query(fault === "repeated" && page > 1 ? initialQuery : q);
          if (!r.ok) return r;
          if (fault === "missing")
            return { ok: true, value: { observations: r.value.observations } };
          if (fault === "regressed") return { ok: true, value: { ...r.value, nextCursor: "0" } };
          if (fault === "oversized")
            return {
              ok: true,
              value: {
                ...r.value,
                observations: [...r.value.observations, ...r.value.observations],
              },
            };
          if (fault === "corrupted")
            return {
              ok: true,
              value: {
                ...r.value,
                observations: r.value.observations.map((o) => ({
                  ...o,
                  metadata: { changed: true },
                })),
              },
            };
          return r;
        },
      };
      await expect(resolveHistoricalReplayInputs({ ...f.options, repository })).rejects.toThrow();
    });
  it("detects post-validation mutation rather than trusting a repository instance", async () => {
    const f = await historicalFixture();
    let mutate = false;
    const getManifest = f.repository.getManifest.bind(f.repository);
    f.repository.getManifest = async (id) => {
      const r = await getManifest(id);
      return r.ok && mutate ? { ok: true, value: { ...r.value, observationCount: 4 } } : r;
    };
    const r = await resolveHistoricalReplayInputs(f.options);
    mutate = true;
    await expect(r.verify()).rejects.toThrow();
  });
  it("rejects an incompatible canonical schema", async () => {
    const f = await historicalFixture();
    const read = f.repository.getManifest.bind(f.repository);
    f.repository.getManifest = async (id) => {
      const r = await read(id);
      return r.ok ? { ok: true, value: { ...r.value, canonicalSchemaVersion: "2" } } : r;
    };
    await expect(resolveHistoricalReplayInputs(f.options)).rejects.toThrow("HISTORICAL_MANIFEST");
  });
  it("rejects missing quality reports rather than stripping the declared requirement", async () => {
    const f = await historicalFixture();
    f.qualityRepository.getReport = () =>
      Promise.resolve({
        ok: false,
        error: {
          code: "DATA_QUALITY_REPORT_NOT_FOUND",
          message: "missing",
          severity: "ERROR",
          timestamp: f.clock.now(),
        },
      });
    await expect(resolveHistoricalReplayInputs(f.options)).rejects.toThrow(
      "DATA_QUALITY_REPORT_NOT_FOUND",
    );
  });
  it("rejects mismatched report content fingerprints", async () => {
    const f = await historicalFixture();
    const read = f.qualityRepository.getReport.bind(f.qualityRepository);
    f.qualityRepository.getReport = async (id) => {
      const r = await read(id);
      return r.ok
        ? { ok: true, value: { ...r.value, datasetContentFingerprint: "sha256:" + "0".repeat(64) } }
        : r;
    };
    await expect(resolveHistoricalReplayInputs(f.options)).rejects.toThrow("QUALITY_BINDING");
  });
  it("rejects catalogue content/version/lifecycle mismatch", async () => {
    const f = await historicalFixture();
    const read = f.catalogueRepository.getVersion.bind(f.catalogueRepository);
    f.catalogueRepository.getVersion = async (id) => {
      const r = await read(id);
      return r.ok ? { ok: true, value: { ...r.value, lifecycleState: "INVALIDATED" } } : r;
    };
    await expect(resolveHistoricalReplayInputs(f.options)).rejects.toThrow("CATALOGUE_BINDING");
  });
  it("does not convert unknown publication into verified point-in-time availability", async () => {
    const f = await historicalFixture();
    const r = await resolveHistoricalReplayInputs(f.options);
    const { fingerprint: _fp, ...base } = replayFixture("VERIFIED_POINT_IN_TIME").spec;
    const spec = createReplaySpecification({
      ...base,
      sourceManifestIds: r.manifests.map((m) => m.manifestId),
      datasetFingerprints: r.manifests.map((m) => m.contentFingerprint),
    });
    expect(() => new DeterministicReplaySequencer(spec, r)).toThrow("AVAILABILITY_UNVERIFIED");
  });
  it("rejects source and calendar substitutions", async () => {
    const f = await historicalFixture();
    await expect(
      resolveHistoricalReplayInputs({
        ...f.options,
        stream: { ...f.options.stream, sourceId: "40000000-0000-4000-8000-000000000099" },
      }),
    ).rejects.toThrow();
    const r = await resolveHistoricalReplayInputs(f.options);
    const { fingerprint: _fp, ...base } = replayFixture().spec;
    const spec = createReplaySpecification({
      ...base,
      sourceManifestIds: r.manifests.map((m) => m.manifestId),
      datasetFingerprints: r.manifests.map((m) => m.contentFingerprint),
    });
    const changed = {
      ...r,
      manifests: r.manifests.map((m) => ({ ...m, calendarFingerprint: "0".repeat(64) })),
    };
    expect(() => new DeterministicReplaySequencer(spec, changed)).toThrow();
  });
});
describe("bounded and immutable owner evidence", () => {
  it("rejects an oversized quality artifact before attaching any report", async () => {
    const f = await historicalFixture();
    const read = f.qualityRepository.getReport.bind(f.qualityRepository);
    f.qualityRepository.getReport = async (id) => {
      const r = await read(id);
      return r.ok
        ? {
            ok: true,
            value: { ...r.value, summary: { ...r.value.summary, hostile: "x".repeat(100000) } },
          }
        : r;
    };
    await expect(
      resolveHistoricalReplayInputs({
        ...f.options,
        limits: { ...f.options.limits, maxInputBytes: 16384 },
      }),
    ).rejects.toThrow();
  });
  it("detects report mutation even when its claimed fingerprint is unchanged", async () => {
    const f = await historicalFixture();
    let mutate = false;
    const read = f.qualityRepository.getReport.bind(f.qualityRepository);
    f.qualityRepository.getReport = async (id) => {
      const r = await read(id);
      return r.ok && mutate ? { ok: true, value: { ...r.value, generatedAt: t("10:04:00") } } : r;
    };
    const resolved = await resolveHistoricalReplayInputs(f.options);
    mutate = true;
    await expect(resolved.verify()).rejects.toThrow("HISTORICAL_SOURCE_CHANGED");
  });
  it("detects catalogue state mutation outside its claimed immutable version fingerprint", async () => {
    const f = await historicalFixture();
    let mutate = false;
    const read = f.catalogueRepository.getVersion.bind(f.catalogueRepository);
    f.catalogueRepository.getVersion = async (id) => {
      const r = await read(id);
      return r.ok && mutate ? { ok: true, value: { ...r.value, metadata: { altered: true } } } : r;
    };
    const resolved = await resolveHistoricalReplayInputs(f.options);
    mutate = true;
    await expect(resolved.verify()).rejects.toThrow("HISTORICAL_SOURCE_CHANGED");
  });
});
