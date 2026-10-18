import { beforeAll, expect, it } from "vitest";
import { clone, fail, fingerprint } from "@ate/mose-attention";
import { physicalFixture, corruptHistory, owners, take, checker } from "./remediation-fixtures.js";
let base: Awaited<ReturnType<typeof owners>>;
beforeAll(async () => {
  base = await owners();
});
const mutations = [
  "credit",
  "receipt-id-null",
  "receipt-fingerprint-null",
  "receipt-fingerprint-wrong",
  "floor-policy",
  "floor-instrument",
  "floor-epoch",
  "floor-erasure",
  "attempt-reset",
  "intent-command",
  "outcome-command",
  "outcome-missing",
  "payload",
  "status",
  "refund",
] as const;
for (const mutation of mutations)
  it(`recovery rejects exact illegal outcome delta: ${mutation}`, async () => {
    const f = await physicalFixture(base);
    take(
      await f.runtime.dispatch({
        kind: "SUBMIT",
        id: "publish",
        recommendationId: f.recommendation.id,
      }),
    );
    const original = take(await f.storage.load());
    const altered = await corruptHistory(f, (cp) => {
      const r = cp.state.recommendations[0]!,
        floor = cp.state.floors[0]!,
        l = cp.state.ledgers[0]!;
      switch (mutation) {
        case "credit":
          l.credits[r.instrumentKey] = 4;
          break;
        case "receipt-id-null":
          r.receiptId = null;
          break;
        case "receipt-fingerprint-null":
          r.receiptFingerprint = null;
          break;
        case "receipt-fingerprint-wrong":
          r.receiptFingerprint = fingerprint("forged");
          break;
        case "floor-policy":
          floor.policy = fingerprint("forged-policy");
          break;
        case "floor-instrument":
          floor.instrumentKey = fingerprint("forged-instrument");
          break;
        case "floor-epoch":
          floor.epoch++;
          break;
        case "floor-erasure":
          cp.state.floors = [];
          break;
        case "attempt-reset":
          r.attempts = 0;
          break;
        case "intent-command":
          r.intentCommandId = "other";
          break;
        case "outcome-command":
          cp.command.id = "other.outcome";
          break;
        case "outcome-missing":
          delete r.outcome;
          break;
        case "payload":
          r.payload!.cause = "forged";
          break;
        case "status":
          r.status = "REJECTED";
          break;
        case "refund":
          floor.reservation = null;
          floor.settledBy = null;
          l.credits[r.instrumentKey] = 1;
          break;
      }
    });
    expect((await altered.runtime.initialize()).ok).toBe(false);
    expect(altered.runtime.diagnostics().readiness).toBe("NOT_READY");
    expect(take(await f.storage.load())).toEqual(original);
    expect(take(await altered.repository.load())).toEqual(altered.records);
  });
it("positive genuine ACK has complete physical evidence and repeated recovery", async () => {
  const f = await physicalFixture(base);
  const cp = take(
    await f.runtime.dispatch({ kind: "SUBMIT", id: "ack", recommendationId: f.recommendation.id }),
  );
  expect(cp.state.recommendations[0]!.outcome?.kind).toBe("ACK");
  for (let i = 0; i < 3; i++) {
    const fresh = f.fresh();
    take(await fresh.initialize());
    expect(take(fresh.query()).state).toEqual(cp.state);
  }
});
it("positive NONE refunds exactly one credit without a phantom receipt", async () => {
  const f = await physicalFixture(base);
  f.ports.scanner.request = () => Promise.resolve(fail("PROVEN_NONE"));
  const cp = take(
    await f.runtime.dispatch({ kind: "SUBMIT", id: "none", recommendationId: f.recommendation.id }),
  );
  expect(cp.state.recommendations[0]).toMatchObject({
    status: "REJECTED",
    receiptId: null,
    outcome: { kind: "NEGATIVE", commitment: "NONE" },
  });
  expect(cp.state.ledgers[0]!.credits[f.recommendation.instrumentKey]).toBe(1);
  const fresh = f.fresh();
  take(await fresh.initialize());
  expect(fresh.diagnostics().floorDebt).toBe(1);
});
it("positive UNKNOWN keeps physical reservation and truthful repeated stop", async () => {
  const f = await physicalFixture(base);
  f.ports.scanner.request = () => Promise.resolve(fail("UNKNOWN", "UNKNOWN"));
  take(
    await f.runtime.dispatch({
      kind: "SUBMIT",
      id: "unknown",
      recommendationId: f.recommendation.id,
    }),
  );
  const fresh = f.fresh();
  take(await fresh.initialize());
  expect(fresh.diagnostics()).toMatchObject({
    readiness: "NOT_READY",
    pendingSubmissions: 1,
    floorDebt: 1,
  });
  expect((await fresh.stop()).ok).toBe(false);
  expect((await fresh.stop()).ok).toBe(false);
});
it("positive lost outcome reconciles the original filesystem scanner receipt", async () => {
  const f = await physicalFixture(base);
  f.ports.repository = {
    load: () => f.storage.load(),
    commit: async (cp) =>
      cp.command.id.endsWith(".outcome") ? fail("NOT_COMMITTED") : f.storage.commit(cp),
  };
  expect(
    (
      await f.runtime.dispatch({
        kind: "SUBMIT",
        id: "lost",
        recommendationId: f.recommendation.id,
      })
    ).ok,
  ).toBe(false);
  const before = take(await f.scannerStorage.load()),
    fresh = f.fresh();
  take(await fresh.initialize());
  const cp = take(
    await fresh.dispatch({ kind: "RECONCILE", id: "read", recommendationId: f.recommendation.id }),
  );
  expect(cp.state.floors[0]!.settledBy).toBe(cp.state.recommendations[0]!.payload!.id);
  expect(take(await f.scannerStorage.load())).toEqual(before);
});
it("positive duplicate command returns the original exact acknowledgement", async () => {
  const f = await physicalFixture(base),
    command = { kind: "SUBMIT" as const, id: "dup", recommendationId: f.recommendation.id };
  const first = take(await f.runtime.dispatch(command)),
    physical = take(await f.storage.load());
  expect(first.command.id).toBe("dup.outcome");
  expect(take(await f.runtime.dispatch(command))).toEqual(
    physical.find((cp) => cp.command.id === "dup.outcome"),
  );
  expect(take(await f.storage.load())).toEqual(physical);
});
it("positive pause resume and clean shutdown preserve acknowledged lineage", async () => {
  const f = await physicalFixture(base);
  take(
    await f.runtime.dispatch({
      kind: "SUBMIT",
      id: "publish",
      recommendationId: f.recommendation.id,
    }),
  );
  take(await f.runtime.dispatch({ kind: "PAUSE", id: "pause" }));
  take(await f.runtime.dispatch({ kind: "RESUME", id: "resume" }));
  const fresh = f.fresh();
  take(await fresh.initialize());
  expect((await fresh.stop()).ok).toBe(true);
  expect((await fresh.stop()).ok).toBe(true);
});
it("resource legacy outcome with no semantic certificate fails closed", async () => {
  const f = await physicalFixture(base);
  take(
    await f.runtime.dispatch({ kind: "SUBMIT", id: "ack", recommendationId: f.recommendation.id }),
  );
  const altered = await corruptHistory(f, (cp) => {
    delete cp.state.recommendations[0]!.outcome;
  });
  expect(await altered.runtime.initialize()).toMatchObject({
    ok: false,
    error: { code: "OUTCOME_EVIDENCE_MISSING" },
  });
});
it("resource coherent fabricated full ACK must have genuine owner readback", async () => {
  const f = await physicalFixture(base);
  f.ports.scanner.request = () => Promise.resolve(fail("NONE"));
  take(
    await f.runtime.dispatch({ kind: "SUBMIT", id: "none", recommendationId: f.recommendation.id }),
  );
  const altered = await corruptHistory(f, (cp) => {
    const r = cp.state.recommendations[0]!,
      receipt = {
        trigger: r.payload!,
        workKey: null,
        disposition: "DEFERRED" as const,
        reason: "FABRICATED",
      };
    r.outcome = { kind: "ACK", receipt };
    r.status = "ADMITTED";
    r.reason = "SCANNER_ADMISSION_NOT_COMPLETION";
    r.receiptId = r.payload!.id;
    r.receiptFingerprint = fingerprint(receipt);
    cp.state.floors[0]!.settledBy = r.payload!.id;
    cp.state.floors[0]!.reservation = null;
    cp.state.ledgers[0]!.credits[r.instrumentKey] = 0;
  });
  expect(await altered.runtime.initialize()).toMatchObject({
    ok: false,
    error: { code: "RECEIPT_EVIDENCE_UNESTABLISHED" },
  });
});
it("resource outage during acknowledged recovery preserves immutable bytes", async () => {
  const f = await physicalFixture(base);
  take(
    await f.runtime.dispatch({ kind: "SUBMIT", id: "ack", recommendationId: f.recommendation.id }),
  );
  const before = take(await f.storage.load());
  f.ports.scanner.query = () => {
    throw Error("OFFLINE");
  };
  expect((await f.fresh().initialize()).ok).toBe(false);
  expect(take(await f.storage.load())).toEqual(before);
});
it("resource publication evidence conflict is rejected on repeated recovery", async () => {
  const f = await physicalFixture(base);
  take(
    await f.runtime.dispatch({ kind: "SUBMIT", id: "ack", recommendationId: f.recommendation.id }),
  );
  const original = f.ports.scanner.query.bind(f.ports.scanner);
  f.ports.scanner.query = (offset, limit) => {
    const q = clone(take(original(offset, limit)));
    q.requests[0]!.reason = "ALTERED";
    return { ok: true, value: q };
  };
  for (let i = 0; i < 2; i++)
    expect(await f.fresh().initialize()).toMatchObject({
      ok: false,
      error: { code: "RECEIPT_IDENTITY_CONFLICT" },
    });
});
it("resource policy revision cannot rewrite the original recovery budget", async () => {
  const f = await physicalFixture(base);
  const configuration = await f.config({ ...f.policy, version: "changed", actor: checker.actorId });
  f.setConfig(configuration);
  expect((await f.fresh().initialize()).ok).toBe(false);
});
for (const mutation of [
  "dispatch-status",
  "dispatch-result",
  "dispatch-command",
  "dispatch-limit",
  "dispatch-row",
]) {
  it(`supported execution outcome rejects ${mutation}`, async () => {
    const f = await physicalFixture(base, { dispatchEnabled: true });
    f.ports.scanner.dispatch = () => Promise.resolve(fail("UNKNOWN", "UNKNOWN"));
    take(await f.runtime.dispatch({ kind: "EXECUTE_ADMITTED", id: "execution", limit: 1 }));
    const altered = await corruptHistory(f, (cp) => {
      const execution = cp.state.executions[0]!;
      if (mutation === "dispatch-status") execution.status = "ACKNOWLEDGED";
      if (mutation === "dispatch-result") {
        execution.status = "ACKNOWLEDGED";
        execution.result = { ok: false, error: { code: "UNKNOWN", commitment: "UNKNOWN" } };
      }
      if (mutation === "dispatch-command") cp.command.id = "foreign.outcome";
      if (mutation === "dispatch-limit") execution.limit = 2;
      if (mutation === "dispatch-row") {
        execution.status = "ACKNOWLEDGED";
        execution.result = { ok: true, value: [null] };
      }
    });
    expect((await altered.runtime.initialize()).ok).toBe(false);
    expect((await altered.runtime.stop()).ok).toBe(false);
  });
}
