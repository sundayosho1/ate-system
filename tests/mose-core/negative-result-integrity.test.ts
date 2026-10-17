import { beforeAll, expect, it } from "vitest";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  MOSECoreRuntime,
  FilesystemMOSERepository,
  type MOSEPorts,
  type Checkpoint,
} from "@ate/mose-core";
import { fixture, root, take } from "./fixtures.js";
import { multiOwners } from "./multi-owners.js";
let pair: Awaited<ReturnType<typeof multiOwners>>;
beforeAll(async () => {
  pair = await multiOwners();
});
type Fixture = Awaited<ReturnType<typeof fixture>>;
const negative = (commitment: string = "NONE") => ({
  ok: false,
  error: { code: "RECORD_NOT_FOUND", commitment },
});
const malformed = [
  "missing-ok",
  "null-ok",
  "number-ok",
  "empty-ok",
  "false-string-ok",
  "true-string-ok",
  "true-with-error",
  "false-no-error",
  "missing-code",
  "numeric-code",
  "missing-commitment",
  "invalid-commitment",
  "null-error",
  "string-error",
  "null-result",
  "primitive-result",
  "exception",
  "conflicting-failure-value",
  "conflicting-success-error",
  "success-no-value",
  "malformed-success",
  "thrown-denial",
] as const;
type Malformed = (typeof malformed)[number];
function bad(mode: Malformed, valid: unknown): unknown {
  switch (mode) {
    case "missing-ok":
      return { error: negative().error };
    case "null-ok":
      return { ...negative(), ok: null };
    case "number-ok":
      return { ...negative(), ok: 0 };
    case "empty-ok":
      return { ...negative(), ok: "" };
    case "false-string-ok":
      return { ...negative(), ok: "false" };
    case "true-string-ok":
      return { ...negative(), ok: "true" };
    case "true-with-error":
      return { ...negative(), ok: true };
    case "false-no-error":
      return { ok: false };
    case "missing-code":
      return { ok: false, error: { commitment: "NONE" } };
    case "numeric-code":
      return { ok: false, error: { code: 0, commitment: "NONE" } };
    case "missing-commitment":
      return { ok: false, error: { code: "RECORD_NOT_FOUND" } };
    case "invalid-commitment":
      return negative("INVALID");
    case "null-error":
      return { ok: false, error: null };
    case "string-error":
      return { ok: false, error: "RECORD_NOT_FOUND" };
    case "null-result":
      return null;
    case "primitive-result":
      return false;
    case "exception":
      throw Error("ordinary native failure");
    case "thrown-denial":
      throw Error("INSTRUMENT_INELIGIBLE");
    case "conflicting-failure-value":
      return { ...negative(), value: valid };
    case "conflicting-success-error":
      return { ok: true, value: valid, error: negative().error };
    case "success-no-value":
      return { ok: true };
    case "malformed-success":
      return { ok: true, value: null };
  }
}
function inject(f: Fixture, get: (id: unknown) => unknown) {
  // Deliberately cross the native input boundary; accepted owner contracts remain untouched.
  f.ports.eligibility = {
    getEligibility: ((id: unknown) =>
      Promise.resolve().then(() => get(id))) as MOSEPorts["eligibility"]["getEligibility"],
  };
}
async function physical() {
  const path = root(),
    repository = new FilesystemMOSERepository(path),
    f = await fixture(pair.a, {}, repository);
  return { f, path, repository };
}
const disk = (path: string) =>
  Object.fromEntries(readdirSync(path).map((n) => [n, readFileSync(join(path, n), "utf8")]));
async function fresh(f: Fixture, repository = f.repository) {
  const service = new MOSECoreRuntime("mose-lab", { ...f.ports, repository });
  take(await service.initialize());
  return service;
}
async function unknown(service: MOSECoreRuntime) {
  expect(take(service.getSessionSummary("session-A"))).toMatchObject({
    excluded: 0,
    unresolvedEligibility: 1,
    expectedObligations: null,
    canonicalVerification: "UNVERIFIED",
    coverageComplete: false,
  });
  expect(take(await service.health()).health).toBe("DEGRADED");
}
async function noComplete(service: MOSECoreRuntime, path: string) {
  const before = disk(path);
  for (const id of ["J-complete-one", "J-complete-two"])
    expect(await service.dispatch({ kind: "COMPLETE", id, sessionId: "session-A" })).toMatchObject({
      ok: false,
      error: { commitment: "NONE" },
    });
  expect(
    await service.dispatchJson(
      JSON.stringify({ kind: "COMPLETE", id: "J-complete-json", sessionId: "session-A" }),
    ),
  ).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  expect(disk(path)).toEqual(before);
}
for (const mode of malformed)
  it(`J malformed native Result ${mode} stays unresolved through publication and recovery`, async () => {
    const { f, path } = await physical(),
      valid = take(await pair.a.service.getEligibility(pair.a.context.instrumentId));
    inject(f, () => bad(mode, valid));
    const u = await f.setup();
    expect(u.members[0]!.eligible).toBe(false);
    expect(u.members[0]!.reasons).not.toContain("INSTRUMENT_INELIGIBLE");
    take(await f.start());
    await unknown(f.service);
    await noComplete(f.service, path);
    const before = disk(path);
    take(await f.service.stop());
    take(await f.service.stop());
    for (let i = 0; i < 2; i++) {
      const s = await fresh(f);
      await unknown(s);
      await noComplete(s, path);
      take(await s.stop());
    }
    expect(disk(path)).toEqual(before);
  });
const supported = [
  "valid-success",
  "negative-NONE",
  "negative-UNKNOWN",
  "unavailable-NONE",
  "unavailable-UNKNOWN",
  "empty-code",
  "neutral-metadata",
  "inherited-fields",
  "array-fields",
  "null-prototype",
] as const;
for (const mode of supported)
  it(`J supported structural Result ${mode} retains the accepted authority meaning`, async () => {
    const { f, path } = await physical(),
      original = f.ports.eligibility;
    if (mode !== "valid-success")
      inject(f, async () => {
        const trusted = await original.getEligibility("J-genuinely-unregistered");
        expect(trusted).toMatchObject({
          ok: false,
          error: { code: "RECORD_NOT_FOUND", commitment: "NONE" },
        });
        if (mode === "negative-NONE") return trusted;
        if (mode === "negative-UNKNOWN") return negative("UNKNOWN");
        if (mode === "unavailable-NONE" || mode === "unavailable-UNKNOWN")
          return {
            ok: false,
            error: {
              code: "SOURCE_UNAVAILABLE",
              commitment: mode === "unavailable-NONE" ? "NONE" : "UNKNOWN",
            },
          };
        if (mode === "empty-code") return { ok: false, error: { code: "", commitment: "NONE" } };
        if (mode === "neutral-metadata")
          return { ...trusted, description: "harmless native metadata" };
        if (mode === "inherited-fields") return Object.create(trusted) as unknown;
        if (mode === "array-fields") return Object.assign([], trusted);
        return Object.assign(Object.create(null) as object, trusted);
      });
    await f.setup();
    take(await f.start());
    const unresolved = [
      "negative-UNKNOWN",
      "unavailable-NONE",
      "unavailable-UNKNOWN",
      "empty-code",
    ].includes(mode);
    if (unresolved) {
      await unknown(f.service);
      await noComplete(f.service, path);
      await unknown(await fresh(f));
    } else {
      if (mode === "valid-success") {
        for (let i = 0; i < 3; i++) take(await f.receive(i));
        take(await f.process(3));
      }
      const complete = take(await f.send({ kind: "COMPLETE", sessionId: "session-A" }));
      expect(complete.command.kind).toBe("COMPLETE");
      const s = await fresh(f);
      expect(take(s.getSessionSummary("session-A"))).toMatchObject({
        coverageComplete: true,
        unresolvedEligibility: 0,
        expectedObligations: mode === "valid-success" ? 3 : 0,
      });
      expect(take(await s.health()).health).toBe("HEALTHY");
    }
  });
for (const mode of [
  "missing-ok",
  "null-ok",
  "number-ok",
  "empty-ok",
  "missing-commitment",
  "invalid-commitment",
] as const)
  it(`J mixed ${mode} cannot hide behind three genuine ADMITTED observations`, async () => {
    const { f, path } = await physical(),
      valid = take(await pair.b.service.getEligibility(pair.b.context.instrumentId));
    inject(f, (id) =>
      id === pair.b.context.instrumentId ? bad(mode, valid) : pair.a.service.getEligibility(id),
    );
    const c = f.create();
    c.instruments.push({
      instrumentId: pair.b.context.instrumentId,
      source: {
        sessionId: pair.b.context.replay!.leftSession,
        checkpoint: pair.b.context.replay!.leftCheckpoint,
      },
    });
    take(await f.service.dispatch(c));
    take(await f.start());
    for (let i = 0; i < 3; i++) take(await f.receive(i));
    take(await f.process(3));
    expect(take(f.service.getSessionSummary("session-A")).admitted).toBe(3);
    await unknown(f.service);
    await noComplete(f.service, path);
    const s = await fresh(f);
    expect(take(s.getSessionSummary("session-A")).admitted).toBe(3);
    await unknown(s);
    await noComplete(s, path);
  });
for (const outcome of ["ACK", "NONE", "UNKNOWN", "LOST"] as const)
  it(`J malformed eligibility remains separate from genuine storage ${outcome}`, async () => {
    const { f, path, repository } = await physical();
    inject(f, () => bad("missing-ok", null));
    let first = true;
    f.ports.repository = {
      load: () => repository.load(),
      commit: async (c) => {
        if (first) {
          first = false;
          if (outcome === "NONE" || outcome === "UNKNOWN")
            return {
              ok: false,
              error: {
                code: "J_STORAGE_FAULT",
                commitment: outcome,
                auditCorrelationId: "J-storage",
              },
            };
          if (outcome === "LOST") {
            take(await repository.commit(c));
            throw Error("J-lost-ack");
          }
        }
        return repository.commit(c);
      },
    };
    const c = f.create(),
      r = await f.service.dispatch(c);
    if (outcome === "ACK") {
      take(r);
      await unknown(f.service);
    } else {
      expect(r.ok).toBe(false);
      expect(f.service.diagnostics().pendingAcknowledgments).toBe(outcome === "NONE" ? 0 : 1);
      if (outcome === "NONE") {
        expect(take(await repository.load())).toHaveLength(0);
        expect(f.service.diagnostics().sourceReadiness).toHaveLength(0);
        take(await f.service.dispatch(c));
      } else {
        expect((await f.service.stop()).ok).toBe(false);
        expect((await f.service.stop()).ok).toBe(false);
      }
    }
    const s = await fresh(f, repository);
    if (outcome === "UNKNOWN") expect(s.diagnostics().sessions).toHaveLength(0);
    else {
      await unknown(s);
      take(await s.dispatch({ kind: "START", id: "J-after-storage", sessionId: "session-A" }));
      await noComplete(s, path);
    }
  });
for (const stage of ["READY", "RUNNING", "PAUSED", "STOPPED"] as const)
  it(`J unresolved native commitment survives immutable ${stage} history`, async () => {
    const { f, path } = await physical();
    inject(f, () => negative("UNKNOWN"));
    await f.setup();
    if (stage !== "READY") take(await f.start());
    if (stage === "PAUSED") take(await f.send({ kind: "PAUSE", sessionId: "session-A" }));
    if (stage === "STOPPED") take(await f.service.dispatch({ kind: "STOP", id: f.next() }));
    const before = disk(path);
    for (let i = 0; i < 2; i++) {
      const s = await fresh(f);
      await unknown(s);
      await noComplete(s, path);
      take(await s.stop());
    }
    expect(disk(path)).toEqual(before);
  });
for (const field of ["discriminator", "code", "commitment"] as const)
  it(`J native ${field} is interpreted from one consistent read`, async () => {
    const { f, path } = await physical();
    let reads = 0;
    const error: Record<string, unknown> = { code: "RECORD_NOT_FOUND", commitment: "NONE" },
      raw: Record<string, unknown> = { ok: false, error };
    if (field === "discriminator")
      Object.defineProperty(raw, "ok", { get: () => (++reads === 1 ? false : true) });
    if (field === "code")
      Object.defineProperty(error, "code", {
        get: () => (++reads === 1 ? "SOURCE_UNAVAILABLE" : "RECORD_NOT_FOUND"),
      });
    if (field === "commitment")
      Object.defineProperty(error, "commitment", {
        get: () => (++reads === 1 ? "UNKNOWN" : "NONE"),
      });
    inject(f, () => raw);
    await f.setup();
    expect(reads).toBe(1);
    take(await f.start());
    if (field === "discriminator") {
      take(await f.send({ kind: "COMPLETE", sessionId: "session-A" }));
      expect(take(f.service.getSessionSummary("session-A")).excluded).toBe(1);
    } else {
      await unknown(f.service);
      await noComplete(f.service, path);
    }
    expect(reads).toBe(1);
  });
const legacy = JSON.parse(
  readFileSync(new URL("./negative-result-history.json", import.meta.url), "utf8"),
) as {
  files: Record<string, string>;
  genuineSHA256: Record<string, string>;
  malformedSHA256: Record<string, string>;
};
for (const prior of ["genuine-negative", "indistinguishable-malformed-negative"] as const)
  it(`J historical ${prior} is immutable evidence, not retrospective native authentication`, async () => {
    const path = root();
    for (const [name, raw] of Object.entries(legacy.files)) {
      const sha = createHash("sha256").update(raw).digest("hex");
      expect(sha).toBe(legacy.genuineSHA256[name]);
      expect(sha).toBe(legacy.malformedSHA256[name]);
      writeFileSync(join(path, name), raw);
    }
    const checkpoints = Object.values(legacy.files).map((s) => JSON.parse(s) as Checkpoint),
      first = checkpoints[0]!,
      last = checkpoints.at(-1)!,
      repo = new FilesystemMOSERepository(path),
      f = await fixture(pair.a, first.state.sessions[0]!.universe.policy, repo, false);
    let nativeReads = 0;
    inject(f, () => {
      nativeReads++;
      return prior === "genuine-negative" ? negative() : bad("missing-ok", null);
    });
    const s = new MOSECoreRuntime(first.runtimeId, f.ports),
      before = disk(path);
    take(await s.initialize());
    expect(take(await s.health()).health).toBe("HEALTHY");
    // Compatibility preserves recorded negative facts. The absent native envelope cannot be
    // re-authenticated: both genuine and historically malformed outcomes have identical bytes.
    expect(take(s.getSessionSummary("session-A"))).toMatchObject({
      sessionStatus: "COMPLETED",
      excluded: 1,
      expectedObligations: 0,
      canonicalVerification: "VERIFIED",
    });
    expect(nativeReads).toBe(0);
    expect(take(await s.dispatch(last.command))).toEqual(last);
    expect(
      (await s.dispatch({ kind: "COMPLETE", id: "J-new-history-complete", sessionId: "session-A" }))
        .ok,
    ).toBe(false);
    expect(disk(path)).toEqual(before);
    take(await s.stop());
  });
