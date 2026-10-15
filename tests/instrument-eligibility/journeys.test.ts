import { describe, it, expect } from "vitest";
import {
  InstrumentEligibility,
  FilesystemEligibilityRepository,
} from "@ate/instrument-eligibility";
import { fixture, take, root, checker, time } from "./fixtures.js";
describe("Prompt 24 permanent research journeys", () => {
  it("J1 records accepted discovery and separate governed canonical mapping", async () => {
    const f = await fixture();
    await f.discover();
    expect(take(await f.service.getEligibility(f.context.instrumentId)).recorded.stage).toBe(
      "DISCOVERED",
    );
    await f.promote("MAPPED");
    expect(take(await f.service.getEligibility(f.context.instrumentId)).recorded.stage).toBe(
      "MAPPED",
    );
  });
  it("J2 rejects an ambiguous/missing immutable mapping without promotion", async () => {
    const f = await fixture();
    await f.discover();
    const r = await f.service.evaluateTransition({
      instrumentId: f.context.instrumentId,
      destination: "MAPPED",
      context: { ...f.context, mappingFingerprint: "sha256:" + "a".repeat(64) },
    });
    expect(take(r).allowed).toBe(false);
    expect(take(r).reasons).toContain("MAPPING_NOT_QUALIFIED");
    expect(take(await f.service.getEligibility(f.context.instrumentId)).recorded.stage).toBe(
      "DISCOVERED",
    );
  });
  it("J3 requires actual P14/15/16 dataset, quality and canonical association", async () => {
    const f = await fixture();
    await f.discover();
    await f.promote("MAPPED");
    expect(
      take(
        await f.service.evaluateTransition({
          instrumentId: f.context.instrumentId,
          destination: "DATA_QUALIFIED",
          context: { ...f.context, datasets: [] },
        }),
      ).allowed,
    ).toBe(false);
    await f.promote("DATA_QUALIFIED");
    expect(
      take(await f.service.getEligibility(f.context.instrumentId)).current.capabilities.find(
        (x) => x.capability === "HISTORICAL_DATA_RESEARCH",
      )?.allowed,
    ).toBe(true);
  });
  it("J4 admits research only after applicable price/identity, data and calendar gates", async () => {
    const f = await fixture();
    await f.toResearch();
    const r = take(await f.service.getEligibility(f.context.instrumentId));
    expect(r.recorded.stage).toBe("RESEARCH");
    expect(r.current.allowed).toBe(true);
    expect(r.current.replayReproducible).toBe(true);
    expect(r.current.capabilities.find((x) => x.capability === "STRATEGY_RESEARCH")?.allowed).toBe(
      false,
    );
  });
  it("J5 replay reproducibility alone never establishes attested validation", async () => {
    const f = await fixture();
    await f.toResearch();
    const r = take(
      await f.service.evaluateTransition({
        instrumentId: f.context.instrumentId,
        destination: "VALIDATED",
        context: f.context,
      }),
    );
    expect(r.replayReproducible).toBe(true);
    expect(r.validationAttested).toBe(false);
    expect(r.allowed).toBe(false);
    expect(r.reasons).toContain("VALIDATION_EVIDENCE_MISSING");
  });
  it("J6 admits PASSED external declaration only with separated existing issuer/checker authority", async () => {
    const f = await fixture();
    await f.toResearch();
    const a = f.attestation();
    take(
      await f.service.recordAttestation({
        kind: "ATTEST",
        id: "declaration",
        attestation: a,
        checker,
      }),
    );
    f.context.attestation = a.fingerprint;
    await f.promote("VALIDATED");
    const r = take(await f.service.getEligibility(f.context.instrumentId));
    expect(r.recorded.stage).toBe("VALIDATED");
    expect(r.current.validationAttested).toBe(true);
    expect(r.current.validationIndependentlyVerified).toBe(false);
  });
  it("J7 simulation requires validated evidence, volume metadata and no execution grant", async () => {
    const f = await fixture();
    await f.toResearch();
    const a = f.attestation();
    take(
      await f.service.recordAttestation({
        kind: "ATTEST",
        id: "declaration",
        attestation: a,
        checker,
      }),
    );
    f.context.attestation = a.fingerprint;
    await f.promote("VALIDATED");
    await f.promote("SIMULATION");
    const r = take(await f.service.getEligibility(f.context.instrumentId));
    expect(r.current.capabilities.find((x) => x.capability === "OFFLINE_SIMULATION")?.allowed).toBe(
      true,
    );
    expect(r.tradingAuthority).toBe(false);
  });
  it("J8 revoked validation restricts current use, permits governed suspension and retains historical stage", async () => {
    const f = await fixture();
    await f.toResearch();
    const a = f.attestation();
    take(
      await f.service.recordAttestation({
        kind: "ATTEST",
        id: "declaration",
        attestation: a,
        checker,
      }),
    );
    f.context.attestation = a.fingerprint;
    await f.promote("VALIDATED");
    take(
      await f.service.publish({
        kind: "ATTEST_STATUS",
        id: "revoke-evidence",
        attestation: a.fingerprint,
        status: "REVOKED",
        checker,
        reason: "External declaration withdrawn",
      }),
    );
    expect(take(await f.service.dependencyImpact(f.context.instrumentId)).classification).toBe(
      "SUSPENSION_REQUIRED",
    );
    await f.promote("VALIDATED", { disposition: "SUSPENDED" });
    const r = take(await f.service.getEligibility(f.context.instrumentId));
    expect(r.recorded.stage).toBe("VALIDATED");
    expect(r.recorded.disposition).toBe("SUSPENDED");
    expect(r.current.allowed).toBe(false);
  });
  it("J9 recovers actual filesystem ACK and immutable historical eligibility", async () => {
    const repository = new FilesystemEligibilityRepository(root());
    const f = await fixture(undefined, repository);
    await f.toResearch();
    const before = take(
      f.service.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time }),
    );
    take(await f.service.stop());
    const fresh = new InstrumentEligibility("eligibility-lab", f.ports);
    take(await fresh.initialize());
    expect(
      take(fresh.historicalEligibility({ instrumentId: f.context.instrumentId, asOf: time })),
    ).toEqual(before);
    expect(take(await fresh.getEligibility(f.context.instrumentId)).recorded.stage).toBe(
      "RESEARCH",
    );
    take(await fresh.stop());
    expect((await fresh.getEligibility(f.context.instrumentId)).ok).toBe(false);
  });
  it("J10 reserved LIVE_ELIGIBLE and ACTIVE reject without repository mutation", async () => {
    const f = await fixture();
    await f.discover();
    const count = f.service.diagnostics().history;
    for (const destination of ["LIVE_ELIGIBLE", "ACTIVE"] as const) {
      expect((await f.service.requestTransition(f.request(destination))).ok).toBe(false);
    }
    expect(f.service.diagnostics().history).toBe(count);
    expect(f.service.diagnostics().tradingAuthority).toBe(false);
  });
});
