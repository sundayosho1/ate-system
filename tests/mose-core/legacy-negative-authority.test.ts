import { beforeAll, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MOSECoreRuntime,
  checkpointSchema,
  commandSchema,
  FilesystemMOSERepository,
  MemoryMOSERepository,
  type Checkpoint,
  type Command,
  type MOSEPorts,
  type Repository,
} from "@ate/mose-core";
import { configuration, fixture, owners, root, take } from "./fixtures.js";
let base: Awaited<ReturnType<typeof owners>>;
beforeAll(async () => {
  base = await owners();
});
const legacy = JSON.parse(
  readFileSync(new URL("./negative-result-history.json", import.meta.url), "utf8"),
) as {
  files: Record<string, string>;
  genuineSHA256: Record<string, string>;
  malformedSHA256: Record<string, string>;
};
const originals = Object.entries(legacy.files);
const checkpoints = originals.map(([, raw]) => JSON.parse(raw) as Checkpoint);
const disk = (path: string) =>
  readdirSync(path)
    .sort()
    .map((name) => ({ name, raw: readFileSync(join(path, name), "utf8") }));
async function recovered(f: Awaited<ReturnType<typeof fixture>>, id = "mose-lab") {
  const s = new MOSECoreRuntime(id, f.ports);
  take(await s.initialize());
  return s;
}
function restricted(s: MOSECoreRuntime, sessionId = "session-A", count = 1) {
  expect(s.diagnostics()).toMatchObject({
    readiness: "NOT_READY",
    health: "DEGRADED",
    pendingAcknowledgments: 0,
    recoveryObligation: null,
  });
  expect(s.diagnostics().negativeProvenanceObligations).toHaveLength(count);
  expect(take(s.getSessionSummary(sessionId))).toMatchObject({
    currentNegativeProvenance: "UNESTABLISHED",
    currentPublicationAuthority: "RESTRICTED",
    currentCoverageComplete: false,
  });
}
for (const prefix of [1, 2, 3])
  for (const mode of ["missing", "unavailable", "malformed", "positive", "negative", "revoked"])
    for (const storage of ["filesystem", "memory"])
      it(`L legacy prefix ${prefix}, owner ${mode}, ${storage}: history never grants new authority`, async () => {
        const owner = mode === "revoked" ? await owners() : base;
        if (mode === "revoked") await owner.promote("RESEARCH", { disposition: "REVOKED" });
        const path = root();
        for (const [name, raw] of originals.slice(0, prefix)) {
          const sha = createHash("sha256").update(raw).digest("hex");
          expect(sha).toBe(legacy.genuineSHA256[name]);
          expect(sha).toBe(legacy.malformedSHA256[name]);
          writeFileSync(join(path, name), raw);
        }
        const repo =
          storage === "filesystem"
            ? new FilesystemMOSERepository(path)
            : new MemoryMOSERepository();
        if (storage === "memory")
          for (const cp of checkpoints.slice(0, prefix)) take(await repo.commit(cp));
        const f = await fixture(
          owner,
          checkpoints[0]!.state.sessions[0]!.universe.policy,
          repo,
          false,
        );
        let ownerReads = 0;
        const query = async (id: string) => {
          ownerReads++;
          if (mode === "unavailable") throw Error("owner offline");
          if (mode === "malformed")
            return { error: { code: "RECORD_NOT_FOUND", commitment: "NONE" } };
          return owner.service.getEligibility(mode === "negative" ? "L-genuine-absent" : id);
        };
        f.ports.eligibility =
          mode === "missing"
            ? (undefined as unknown as MOSEPorts["eligibility"])
            : ({ getEligibility: query } as MOSEPorts["eligibility"]);
        const s = await recovered(f),
          before = take(await repo.load()).map((row) => checkpointSchema.parse(row)),
          physical = disk(path);
        restricted(s);
        expect(take(await s.health()).health).toBe("DEGRADED");
        for (const cp of before) expect(take(await s.dispatch(cp.command))).toEqual(cp);
        const summary = take(
          s.query({
            sessionId: "session-A",
            kind: "SUMMARY",
            offset: 0,
            limit: 10,
            asOf: checkpoints[0]!.at,
          }),
        );
        expect(summary).toMatchObject({
          scope: "RECORDED_AS_OF",
          currentAuthorityNotEstablishedByHistoricalQuery: true,
          value: {
            excluded: 1,
            canonicalVerification: "VERIFIED",
            expectedObligations: 0,
            coverageComplete: true,
          },
        });
        const commands: Command[] = [
          { kind: "START", id: "L-new-start", sessionId: "session-A" },
          { kind: "COMPLETE", id: "L-new-complete", sessionId: "session-A" },
          { kind: "PAUSE", id: "L-new-pause", sessionId: "session-A" },
          { kind: "PROCESS", id: "L-new-process", sessionId: "session-A", limit: 1 },
          {
            kind: "RECEIVE",
            id: "L-new-receive",
            sessionId: "session-A",
            eventId: "L-event",
            instrumentId: owner.context.instrumentId,
            universeSnapshot: checkpoints[0]!.state.sessions[0]!.universe.fingerprint,
          },
          { kind: "STOP", id: "L-new-stop" },
          {
            ...f.create("L-descendant"),
            id: "L-new-predecessor",
            previousUniverse: checkpoints[0]!.state.sessions[0]!.universe.fingerprint,
          },
        ].map((c) => commandSchema.parse(c));
        for (const c of commands) {
          expect(await s.dispatch(c)).toMatchObject({
            ok: false,
            error: { code: "PROVENANCE_INCOMPLETE", commitment: "NONE" },
          });
          expect(await s.dispatchJson(JSON.stringify(c))).toMatchObject({
            ok: false,
            error: { commitment: "NONE" },
          });
          expect(take(await repo.load())).toEqual(before);
          expect(disk(path)).toEqual(physical);
        }
        expect(ownerReads).toBe(0);
        for (let n = 0; n < 2; n++) {
          take(await s.stop());
          take(await s.stop());
          const fresh = await recovered(f);
          restricted(fresh);
          expect(take(await fresh.dispatch(before.at(-1)!.command))).toEqual(before.at(-1));
          expect((await fresh.dispatch(commands[1]!)).ok).toBe(false);
          take(await fresh.stop());
        }
        expect(take(await repo.load())).toEqual(before);
        expect(disk(path)).toEqual(physical);
        // A separate, independently governed CREATE is not reconciliation or a predecessor claim.
        f.ports.eligibility = owner.service;
        const current = await recovered(f);
        const c = { ...f.create("L-fresh-universe"), id: "L-fresh-create" };
        take(await current.dispatch(c));
        expect(
          take(current.getSessionSummary("L-fresh-universe")).currentPublicationAuthority,
        ).toBe("SUBJECT_TO_OTHER_GOVERNED_CHECKS");
        take(
          await current.dispatch({
            kind: "START",
            id: "L-fresh-start",
            sessionId: "L-fresh-universe",
          }),
        );
        const u = take(current.getUniverse("L-fresh-universe"));
        for (const p of u.plan)
          take(
            await current.dispatch({
              kind: "RECEIVE",
              id: "L-receive-" + p.eventId,
              sessionId: u.sessionId,
              eventId: p.eventId,
              instrumentId: p.instrumentId,
              universeSnapshot: u.fingerprint,
            }),
          );
        if (u.plan.length)
          take(
            await current.dispatch({
              kind: "PROCESS",
              id: "L-fresh-process",
              sessionId: u.sessionId,
              limit: 3,
            }),
          );
        take(
          await current.dispatch({
            kind: "COMPLETE",
            id: "L-fresh-complete",
            sessionId: u.sessionId,
          }),
        );
        expect(take(current.getSessionSummary(u.sessionId)).currentCoverageComplete).toBe(true);
        restricted(current);
        expect(take(await repo.load()).slice(0, prefix)).toEqual(before);
        if (storage === "filesystem") expect(disk(path).slice(0, prefix)).toEqual(physical);
        take(await current.stop());
      });
for (const kind of ["CREATE", "START", "COMPLETE"] as const)
  for (const outcome of ["ACK", "NONE", "UNKNOWN", "LOST"])
    it(`L current negative ${kind}/${outcome} preserves exact commitment and authority`, async () => {
      const path = root(),
        durable = new FilesystemMOSERepository(path);
      let inject = true;
      const repository: Repository = {
        load: () => durable.load(),
        commit: async (cp) => {
          if (cp.command.kind === kind && inject) {
            if (outcome === "LOST") {
              take(await durable.commit(cp));
              throw Error("ACK_LOST");
            }
            if (outcome === "NONE" || outcome === "UNKNOWN")
              return {
                ok: false,
                error: {
                  code: "STORAGE_UNAVAILABLE",
                  commitment: outcome,
                  auditCorrelationId: "L-storage",
                },
              };
          }
          return durable.commit(cp);
        },
      };
      const f = await fixture(base, {}, repository),
        create = f.create();
      create.instruments[0]!.instrumentId = "L-genuinely-unregistered";
      let command: Command = commandSchema.parse(create);
      if (kind !== "CREATE") {
        take(await f.service.dispatch(create));
        command = { kind: "START", id: "L-start", sessionId: "session-A" };
        if (kind === "COMPLETE") {
          take(await f.service.dispatch(command));
          command = { kind: "COMPLETE", id: "L-complete", sessionId: "session-A" };
        }
      }
      const before = take(await durable.load()),
        bytes = disk(path),
        result = await f.service.dispatch(command);
      expect(result.ok).toBe(outcome === "ACK");
      expect(f.service.diagnostics().pendingAcknowledgments).toBe(
        outcome === "UNKNOWN" || outcome === "LOST" ? 1 : 0,
      );
      if (outcome === "NONE" || outcome === "UNKNOWN") {
        expect(take(await durable.load())).toEqual(before);
        expect(disk(path)).toEqual(bytes);
      }
      if (outcome === "NONE") {
        inject = false;
        take(await f.service.dispatch(command));
        expect(f.service.diagnostics().negativeProvenanceObligations).toHaveLength(0);
      }
      if (outcome === "UNKNOWN" || outcome === "LOST") {
        expect((await f.service.stop()).ok).toBe(false);
        expect((await f.service.stop()).ok).toBe(false);
      } else take(await f.service.stop());
      const s = await recovered(f),
        history = take(await durable.load()).map((row) => checkpointSchema.parse(row));
      if (history.length) {
        restricted(s);
        expect(
          (await s.dispatch({ kind: "START", id: "L-post-recovery", sessionId: "session-A" })).ok,
        ).toBe(false);
      }
      if (outcome === "ACK" || outcome === "LOST" || outcome === "NONE")
        expect(take(await s.dispatch(command))).toEqual(history.at(-1));
      take(await s.stop());
    });
for (const composition of ["one-negative", "two-negatives", "owner-restoration"])
  for (const storage of ["filesystem", "memory"])
    it(`L recovered mixed ${composition}/${storage} preserves three genuine peer receipts`, async () => {
      const path = root(),
        repository =
          storage === "filesystem"
            ? new FilesystemMOSERepository(path)
            : new MemoryMOSERepository(),
        f = await fixture(base, {}, repository),
        c = f.create();
      c.instruments.push({
        instrumentId: "L-negative-one",
        source: { ...c.instruments[0]!.source },
      });
      if (composition !== "one-negative")
        c.instruments.push({
          instrumentId: "L-negative-two",
          source: { ...c.instruments[0]!.source },
        });
      take(await f.service.dispatch(c));
      take(await f.start());
      for (let n = 0; n < 3; n++) take(await f.receive(n));
      take(await f.process(3));
      const before = take(await repository.load()).map((row) => checkpointSchema.parse(row)),
        bytes = disk(path);
      expect(take(f.service.getSessionSummary("session-A")).admitted).toBe(3);
      expect(f.service.diagnostics().negativeProvenanceObligations).toHaveLength(0);
      take(await f.service.stop());
      if (composition === "owner-restoration")
        f.ports.eligibility = {
          getEligibility: () => Promise.reject(Error("owner offline after CREATE")),
        };
      const s = await recovered(f);
      if (composition === "owner-restoration") {
        expect(take(await s.health()).health).toBe("DEGRADED");
        f.ports.eligibility = base.service;
        expect(take(await s.health()).health).toBe("DEGRADED");
      }
      restricted(s, "session-A", composition === "one-negative" ? 1 : 2);
      expect(take(s.getSessionSummary("session-A")).admitted).toBe(3);
      expect(
        (await s.dispatch({ kind: "COMPLETE", id: "L-mixed-complete", sessionId: "session-A" })).ok,
      ).toBe(false);
      expect(take(await repository.load())).toEqual(before);
      expect(disk(path)).toEqual(bytes);
      expect(take(await s.dispatch(before.at(-1)!.command))).toEqual(before.at(-1));
      take(await s.stop());
    });
for (const phase of ["same", "fresh"])
  for (const fault of ["policy", "source-identity"])
    it(`L ${phase} ${fault} mismatch cannot resolve old negative provenance`, async () => {
      const path = root();
      for (const [name, raw] of originals.slice(0, 2)) writeFileSync(join(path, name), raw);
      const repository = new FilesystemMOSERepository(path),
        f = await fixture(
          base,
          checkpoints[0]!.state.sessions[0]!.universe.policy,
          repository,
          false,
        ),
        s = await recovered(f),
        before = take(await repository.load()).map((row) => checkpointSchema.parse(row)),
        physical = disk(path);
      restricted(s);
      if (phase === "fresh") take(await s.stop());
      const active = phase === "fresh" ? await recovered(f) : s;
      if (fault === "policy") {
        const originalConfiguration = f.ports.configuration();
        f.setConfiguration(
          await configuration({ ...f.policy, maxSessions: f.policy.maxSessions - 1 }, f.clock),
        );
        expect(
          (await active.dispatch({ kind: "START", id: "L-policy-start", sessionId: "session-A" }))
            .ok,
        ).toBe(false);
        expect(active.diagnostics()).toMatchObject({ readiness: "NOT_READY", health: "DEGRADED" });
        f.setConfiguration(originalConfiguration);
      } else {
        const valid = structuredClone(
          take(await base.service.getEligibility(base.context.instrumentId)),
        );
        valid.recorded.context.instrumentId = "L-wrong-source-identity";
        f.ports.eligibility = { getEligibility: () => Promise.resolve({ ok: true, value: valid }) };
        const command = { ...f.create("L-source-mismatch"), id: "L-source-mismatch-create" };
        take(await active.dispatch(command));
        expect(take(active.getSessionSummary("L-source-mismatch"))).toMatchObject({
          excluded: 0,
          unresolvedEligibility: 1,
          expectedObligations: null,
          currentCoverageComplete: false,
        });
        expect(
          (await active.dispatch({ kind: "START", id: "L-mismatch-old", sessionId: "session-A" }))
            .ok,
        ).toBe(false);
      }
      restricted(active);
      expect(take(await repository.load()).slice(0, before.length)).toEqual(before);
      expect(disk(path).slice(0, physical.length)).toEqual(physical);
      take(await active.stop());
    });
