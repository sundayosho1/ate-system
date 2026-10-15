import { schemas } from "@ate/domain";
import { describe, it, expect, beforeAll } from "vitest";
import { mustParseUtc } from "@ate/time";
import { InstrumentEligibility, MemoryEligibilityRepository } from "@ate/instrument-eligibility";
import { fixture, take, checker, issuer, time } from "./fixtures.js";
describe("governed external research validation declarations", () => {
  let rejectionFixture: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    rejectionFixture = await fixture();
    await rejectionFixture.toResearch();
  });
  for (const outcome of ["FAILED", "INCONCLUSIVE"] as const)
    it(`records ${outcome} without granting validation`, async () => {
      const f = await fixture();
      await f.toResearch();
      const a = f.attestation({ outcome });
      take(
        await f.service.recordAttestation({
          kind: "ATTEST",
          id: "declaration",
          attestation: a,
          checker,
        }),
      );
      f.context.attestation = a.fingerprint;
      const r = take(
        await f.service.evaluateTransition({
          instrumentId: f.context.instrumentId,
          context: f.context,
          destination: "VALIDATED",
        }),
      );
      expect(r.allowed).toBe(false);
      expect(r.reasons).toContain(`VALIDATION_${outcome}`);
    });
  for (const status of ["REVOKED", "SUPERSEDED"] as const)
    it(`${status} declarations cannot promote, including after fresh recovery`, async () => {
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
      take(
        await f.service.publish({
          kind: "ATTEST_STATUS",
          id: "withdrawal",
          attestation: a.fingerprint,
          status,
          checker,
          reason: "Synthetic withdrawal",
        }),
      );
      expect(
        take(
          await f.service.evaluateTransition({
            instrumentId: f.context.instrumentId,
            context: f.context,
            destination: "VALIDATED",
          }),
        ).reasons,
      ).toContain(`VALIDATION_${status}`);
      take(await f.service.stop());
      const fresh = new InstrumentEligibility("eligibility-lab", f.ports);
      take(await fresh.initialize());
      expect(
        take(
          await fresh.evaluateTransition({
            instrumentId: f.context.instrumentId,
            context: f.context,
            destination: "VALIDATED",
          }),
        ).allowed,
      ).toBe(false);
    });
  it("expiry is inclusive at the exact accepted-clock cutoff", async () => {
    const f = await fixture();
    await f.toResearch();
    const a = f.attestation({ expiresAt: mustParseUtc("2026-10-10T09:00:01.000Z") });
    take(
      await f.service.recordAttestation({
        kind: "ATTEST",
        id: "declaration",
        attestation: a,
        checker,
      }),
    );
    f.context.attestation = a.fingerprint;
    expect(
      take(
        await f.service.evaluateTransition({
          instrumentId: f.context.instrumentId,
          context: f.context,
          destination: "VALIDATED",
        }),
      ).allowed,
    ).toBe(true);
    f.spec.mapping.base.clock.advanceTo(mustParseUtc("2026-10-10T09:00:01.000Z"));
    expect(
      take(
        await f.service.evaluateTransition({
          instrumentId: f.context.instrumentId,
          context: f.context,
          destination: "VALIDATED",
        }),
      ).reasons,
    ).toContain("VALIDATION_EXPIRED");
  });
  for (const field of ["hypothesis", "methodology", "methodologyVersion", "subject"] as const)
    it(`rejects mismatched ${field} research bindings`, async () => {
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
      const context = { ...f.context, attestation: a.fingerprint, [field]: "substituted" };
      const r = take(
        await f.service.evaluateTransition({
          instrumentId: f.context.instrumentId,
          context,
          destination: "VALIDATED",
        }),
      );
      expect(r.allowed).toBe(false);
      expect(r.reasons).toContain("VALIDATION_CONTEXT_MISMATCH");
    });
  for (const field of [
    "issuer",
    "sourceId",
    "fingerprint",
    "evidenceFingerprint",
    "policyId",
    "policyVersion",
    "instrumentId",
    "datasets",
    "issuedAt",
    "effectiveAt",
  ] as const)
    it(`rejects forged or malformed declaration ${field}`, async () => {
      const f = rejectionFixture;
      const a = f.attestation();
      const change: unknown =
        field === "issuer"
          ? { ...issuer, actorId: checker.actorId }
          : field === "datasets"
            ? []
            : field === "policyVersion"
              ? 2
              : field === "issuedAt" || field === "effectiveAt"
                ? "2027-10-10T09:00:00.000Z"
                : "forged";
      const n = f.service.diagnostics().history;
      expect(
        (
          await f.service.recordAttestation({
            kind: "ATTEST",
            id: "forged",
            attestation: { ...a, [field]: change },
            checker,
          })
        ).ok,
      ).toBe(false);
      expect(f.service.diagnostics().history).toBe(n);
    });
  it("denies issuer/checker self-approval", async () => {
    const f = await fixture();
    await f.toResearch();
    expect(
      (
        await f.service.recordAttestation({
          kind: "ATTEST",
          id: "self",
          attestation: f.attestation(),
          checker: issuer,
        })
      ).ok,
    ).toBe(false);
  });
  it("refuses valid hashes when configured issuer authority is unavailable", async () => {
    const f = await fixture();
    await f.toResearch();
    f.ports.authorityResolver = {
      resolve: () => {
        throw Error("UNAVAILABLE");
      },
    };
    expect(
      (
        await f.service.recordAttestation({
          kind: "ATTEST",
          id: "denied",
          attestation: f.attestation(),
          checker,
        })
      ).ok,
    ).toBe(false);
  });
  it("retains exact attested history and queryable identities after recovery", async () => {
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
    const accepted = await f.promote("VALIDATED");
    take(await f.service.stop());
    const fresh = new InstrumentEligibility("eligibility-lab", f.ports);
    take(await fresh.initialize());
    expect(take(fresh.explainEligibilityDecision(accepted.fingerprint))).toEqual(accepted);
    expect(
      take(await fresh.getEligibility(f.context.instrumentId)).current.validationAttested,
    ).toBe(true);
  });
  it("missing authority cannot be manufactured by replaying declaration bytes into a fresh repository", async () => {
    const f = await fixture(undefined, new MemoryEligibilityRepository());
    await f.toResearch();
    f.ports.authorityResolver = {
      resolve: () => ({
        ok: true,
        value: {
          actorId: schemas.actorId.parse(issuer.actorId),
          authority: "CONFIGURATION_CHECKER",
          authorized: false,
          checkedAt: time,
          evidence: "No grant",
        },
      }),
    };
    expect(
      await f.service.recordAttestation({
        kind: "ATTEST",
        id: "forged-authority",
        attestation: f.attestation(),
        checker,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_AUTHORITY_REQUIRED", commitment: "NONE" },
    });
  });
});
for (const status of ["REVOKED", "SUPERSEDED"] as const)
  it(`imported source-declared ${status} status never becomes CURRENT`, async () => {
    const f = await fixture();
    await f.toResearch();
    const a = f.attestation({
      status,
      supersededBy: status === "SUPERSEDED" ? "sha256:" + "f".repeat(64) : null,
    });
    take(
      await f.service.recordAttestation({
        kind: "ATTEST",
        id: "imported-closed",
        attestation: a,
        checker,
      }),
    );
    f.context.attestation = a.fingerprint;
    const result = take(
      await f.service.evaluateTransition({
        instrumentId: f.context.instrumentId,
        destination: "VALIDATED",
        context: f.context,
      }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain(`VALIDATION_${status}`);
  });
