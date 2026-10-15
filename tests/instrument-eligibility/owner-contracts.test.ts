import { it, expect } from "vitest";
import { fixture } from "./fixtures.js";
it("binds exact genuine dataset, quality and catalogue owner identities", async () => {
  const f = await fixture(),
    v = f.h.registration.entry.version,
    r = f.h.report;
  expect(v.qualityReferences).toContainEqual(
    expect.objectContaining({ qualification: "QUALIFIED_WITH_WARNINGS" }),
  );
  expect(r.datasetContentFingerprint).toBe(v.content.contentFingerprint);
  expect(v.integrity.status).toBe("VERIFIED");
  expect(
    await f.ports.catalogue.explainEligibility(v.versionId, "RESEARCH_EXPLORATION"),
  ).toMatchObject({ ok: true, value: { status: "ELIGIBLE_WITH_WARNINGS" } });
});
