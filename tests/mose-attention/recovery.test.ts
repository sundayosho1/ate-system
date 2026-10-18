import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MemoryAttentionRepository,
  FilesystemAttentionRepository,
  defaultAttentionPolicy,
  emptyState,
  fingerprint,
  checkpointSchema,
  validateDelta,
  type AttentionCheckpoint,
  clone,
} from "@ate/mose-attention";
const p = defaultAttentionPolicy;
function record(): AttentionCheckpoint {
  const body = {
    owner: "MOSE_ATTENTION" as const,
    ownerVersion: "0.27.0-adaptive-surveillance.1" as const,
    schemaVersion: 1 as const,
    generation: 1,
    previous: null,
    at: "2026-01-01T00:00:00.000Z",
    policy: fingerprint(p),
    configuration: fingerprint("C"),
    command: { kind: "START" as const, id: "start" },
    state: { ...emptyState(), phase: "RUNNING" as const },
  };
  return { ...body, fingerprint: fingerprint(body) };
}
it("memory repository preserves exact body and rejects stale generation", async () => {
  const repo = new MemoryAttentionRepository(),
    cp = record();
  expect(await repo.commit(cp)).toMatchObject({ ok: true, value: cp });
  expect((await repo.commit(cp)).ok).toBe(false);
  expect(await repo.load()).toMatchObject({ ok: true, value: [cp] });
});
it("memory publication cannot mutate with caller after acknowledgement", async () => {
  const repo = new MemoryAttentionRepository(),
    cp = record();
  expect((await repo.commit(cp)).ok).toBe(true);
  cp.state.phase = "STOPPED";
  const loaded = await repo.load();
  expect(loaded.ok && loaded.value[0]!.state.phase).toBe("RUNNING");
});
it("filesystem true readback equals physical generation bytes", async () => {
  const path = mkdtempSync(join(tmpdir(), "attention-disk-")),
    repo = new FilesystemAttentionRepository(path, p),
    cp = record();
  expect((await repo.commit(cp)).ok).toBe(true);
  const names = readdirSync(path);
  expect(names).toEqual(["generation-00000001.json"]);
  const body = checkpointSchema.parse(JSON.parse(readFileSync(join(path, names[0]!), "utf8")));
  expect(body).toEqual(cp);
  expect(await repo.load()).toMatchObject({ ok: true, value: [cp] });
});
it("foreign file causes recovery refusal rather than cleanup", async () => {
  const path = mkdtempSync(join(tmpdir(), "attention-foreign-"));
  writeFileSync(join(path, "foreign"), "retained");
  const repo = new FilesystemAttentionRepository(path, p);
  expect((await repo.load()).ok).toBe(false);
  expect(readFileSync(join(path, "foreign"), "utf8")).toBe("retained");
});
it("symlinked root denied without traversing source", async () => {
  const parent = mkdtempSync(join(tmpdir(), "attention-links-")),
    target = join(parent, "target");
  writeFileSync(target, "not a root");
  symlinkSync(target, join(parent, "root"));
  expect((await new FilesystemAttentionRepository(join(parent, "root"), p).load()).ok).toBe(false);
  expect(readFileSync(target, "utf8")).toBe("not a root");
});
it("corrupt canonical body is not accepted on read", async () => {
  const path = mkdtempSync(join(tmpdir(), "attention-corrupt-")),
    cp = record();
  cp.state.phase = "STOPPED";
  writeFileSync(join(path, "generation-00000001.json"), JSON.stringify(cp));
  expect((await new FilesystemAttentionRepository(path, p).load()).ok).toBe(false);
});
it("rehashed illegal lifecycle cannot masquerade as an assessment", () => {
  const cp = record();
  cp.command = {
    kind: "ASSESS",
    id: "illegal",
    subject: {
      sessionId: "S",
      instrumentId: "I",
      universe: fingerprint("U"),
      subscriptions: ["sub"],
    },
    asOf: cp.at,
  };
  expect(() => validateDelta(undefined, cp, p)).toThrow("RECOVERY_LIFECYCLE");
});
it("rehashed state edit outside command delta rejected", () => {
  const cp = record();
  cp.state.ledgers.push({
    epoch: 0,
    spent: 0,
    credits: {},
    bonus: {},
    bonusAccrued: [],
    bonuses: {},
    lastInstrument: null,
    lastSubject: {},
    memberKeys: [],
    consistency: "ESTABLISHED",
    barrierId: null,
  });
  expect(() => validateDelta(undefined, cp, p)).toThrow("RECOVERY_DELTA");
});
it("unresolved execution cannot be concealed by durable STOP", () => {
  const before = {
      ...emptyState(),
      phase: "RUNNING" as const,
      executions: [{ id: "dispatch", status: "UNRESOLVED" as const, result: null }],
    },
    cp = record();
  cp.command = { kind: "STOP", id: "stop" };
  cp.state = { ...clone(before), phase: "STOPPED" };
  expect(() => validateDelta(before, cp, p)).toThrow("RECOVERY_OBLIGATION");
});
it("exact first lifecycle transition passes independent delta guard", () => {
  expect(() => validateDelta(undefined, record(), p)).not.toThrow();
});
it("unknown phase transition cannot reset a live runtime to READY", () => {
  const cp = record(),
    before = clone(cp.state);
  cp.command = { kind: "RESUME", id: "resume" };
  cp.state.phase = "READY";
  expect(() => validateDelta(before, cp, p)).toThrow("RECOVERY_LIFECYCLE");
});
it("checkpoint schema rejects unrecognized opportunity state or authority fields", () => {
  expect(
    checkpointSchema.safeParse({
      ...record(),
      state: { ...record().state, opportunityState: "QUALIFIED" },
    }).success,
  ).toBe(false);
});
