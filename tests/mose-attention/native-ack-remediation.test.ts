import { triggerSchema } from "@ate/mose-scanner";
import { beforeAll, expect, it } from "vitest";
import { fail } from "@ate/mose-attention";
import { physicalFixture, owners, take, nativeSuccess } from "./remediation-fixtures.js";
let base: Awaited<ReturnType<typeof owners>>;
beforeAll(async () => {
  base = await owners();
});
for (const variant of [
  "missing-work",
  "numeric-work",
  "missing-disposition",
  "invalid-disposition",
  "missing-reason",
  "numeric-reason",
  "throwing-trigger",
  "wrong-id",
  "wrong-cause",
]) {
  it(`native selected success rejects ${variant} without clearing physical uncertainty`, async () => {
    const f = await physicalFixture(base);
    f.ports.scanner.request = async (trigger) => {
      await Promise.resolve();
      const value: Record<string, unknown> = {
        trigger,
        workKey: null,
        disposition: "DUE",
        reason: "ADMISSION",
      };
      switch (variant) {
        case "missing-work":
          delete value.workKey;
          break;
        case "numeric-work":
          value.workKey = 3;
          break;
        case "missing-disposition":
          delete value.disposition;
          break;
        case "invalid-disposition":
          value.disposition = "NOT_A_DISPOSITION";
          break;
        case "missing-reason":
          delete value.reason;
          break;
        case "numeric-reason":
          value.reason = 3;
          break;
        case "throwing-trigger":
          Object.defineProperty(value, "trigger", {
            get() {
              throw Error("HOSTILE");
            },
          });
          break;
        case "wrong-id":
          value.trigger = { ...triggerSchema.parse(trigger), id: "foreign" };
          break;
        case "wrong-cause":
          value.trigger = { ...triggerSchema.parse(trigger), cause: "foreign" };
          break;
      }
      return nativeSuccess(value);
    };
    const cp = take(
      await f.runtime.dispatch({
        kind: "SUBMIT",
        id: "native",
        recommendationId: f.recommendation.id,
      }),
    );
    expect(cp.state.recommendations[0]).toMatchObject({
      status: "UNRESOLVED",
      receiptId: null,
      receiptFingerprint: null,
      outcome: { kind: "UNCERTAIN" },
    });
    expect(cp.state.floors[0]).toMatchObject({ settledBy: null, reservation: f.recommendation.id });
    const fresh = f.fresh();
    take(await fresh.initialize());
    expect(fresh.diagnostics()).toMatchObject({
      readiness: "NOT_READY",
      health: "DEGRADED",
      pendingSubmissions: 1,
    });
    expect((await fresh.stop()).ok).toBe(false);
    expect((await fresh.stop()).ok).toBe(false);
    expect(take(await f.scannerStorage.load()).at(-1)!.state.requests).toHaveLength(0);
  });
}
for (const variant of ["array", "inherited", "null-prototype"]) {
  it(`native genuine ACK accepts structural ${variant} and ignores unrelated metadata`, async () => {
    const f = await physicalFixture(base),
      original = f.ports.scanner.request.bind(f.ports.scanner);
    f.ports.scanner.request = async (payload) => {
      await Promise.resolve();
      const actual = take(await original(payload));
      const representation: unknown =
        variant === "array"
          ? Object.assign([], { ...actual, metadata: "extra" })
          : variant === "inherited"
            ? Object.create(actual)
            : Object.assign(Object.create(null), { ...actual, metadata: "extra" });
      return nativeSuccess(representation);
    };
    const cp = take(
      await f.runtime.dispatch({
        kind: "SUBMIT",
        id: "structural",
        recommendationId: f.recommendation.id,
      }),
    );
    expect(cp.state.recommendations[0]!.status).toBe("ADMITTED");
    const fresh = f.fresh();
    take(await fresh.initialize());
    expect(fresh.diagnostics().settledFloors).toBe(1);
  });
}
it("cross malformed ACK and restart never create a fresh RequestId entitlement", async () => {
  const f = await physicalFixture(base);
  let calls = 0;
  f.ports.scanner.request = async (trigger) => {
    await Promise.resolve();
    calls++;
    return nativeSuccess({ trigger, disposition: "DUE", reason: "MISSING_WORK" });
  };
  const command = {
    kind: "SUBMIT" as const,
    id: "malformed",
    recommendationId: f.recommendation.id,
  };
  take(await f.runtime.dispatch(command));
  const payload = take(f.runtime.query()).state.recommendations[0]!.payload;
  const fresh = f.fresh();
  take(await fresh.initialize());
  await fresh.dispatch(command);
  expect((await fresh.dispatch({ ...command, id: "new-id" })).ok).toBe(false);
  expect(calls).toBe(1);
  expect(take(fresh.query()).state.recommendations[0]!.payload).toEqual(payload);
});
it("cross malformed committed ACK reconciles exactly its actual owner record", async () => {
  const f = await physicalFixture(base),
    original = f.ports.scanner.request.bind(f.ports.scanner);
  f.ports.scanner.request = async (payload) => {
    await Promise.resolve();
    const receipt = take(await original(payload));
    return nativeSuccess({
      trigger: receipt.trigger,
      disposition: receipt.disposition,
      reason: receipt.reason,
    });
  };
  take(
    await f.runtime.dispatch({
      kind: "SUBMIT",
      id: "malformed-committed",
      recommendationId: f.recommendation.id,
    }),
  );
  const before = take(await f.scannerStorage.load()),
    fresh = f.fresh();
  take(await fresh.initialize());
  const cp = take(
    await fresh.dispatch({
      kind: "RECONCILE",
      id: "readback",
      recommendationId: f.recommendation.id,
    }),
  );
  expect(cp.state.recommendations[0]!.status).toBe("ADMITTED");
  expect(take(await f.scannerStorage.load())).toEqual(before);
});
it("cross changing receipt getter is captured once and retains genuine fingerprint", async () => {
  const f = await physicalFixture(base),
    original = f.ports.scanner.request.bind(f.ports.scanner);
  let reads = 0;
  f.ports.scanner.request = async (payload) => {
    await Promise.resolve();
    const receipt = take(await original(payload));
    return nativeSuccess({
      ...receipt,
      get workKey() {
        return ++reads === 1 ? receipt.workKey : 3;
      },
    });
  };
  take(
    await f.runtime.dispatch({
      kind: "SUBMIT",
      id: "getter",
      recommendationId: f.recommendation.id,
    }),
  );
  expect(reads).toBe(1);
  const fresh = f.fresh();
  take(await fresh.initialize());
  expect(fresh.diagnostics().settledFloors).toBe(1);
});
it("cross source withdrawal cannot turn reconciliation into new operational authority", async () => {
  const isolated = await owners(),
    f = await physicalFixture(isolated),
    original = f.ports.scanner.request.bind(f.ports.scanner);
  f.ports.scanner.request = async (payload) => {
    await Promise.resolve();
    take(await original(payload));
    return fail("LOST", "UNKNOWN");
  };
  take(
    await f.runtime.dispatch({ kind: "SUBMIT", id: "lost", recommendationId: f.recommendation.id }),
  );
  take(await isolated.service.stop());
  take(
    await f.runtime.dispatch({
      kind: "RECONCILE",
      id: "historical-read",
      recommendationId: f.recommendation.id,
    }),
  );
  const health = await f.runtime.health();
  expect(!health.ok || health.value.readiness === "NOT_READY").toBe(true);
  expect((await f.assess("current")).ok).toBe(true);
  expect(take(f.runtime.query()).state.assessments.at(-1)!.sufficient).toBe(false);
});
it("cross reentrant stop during malformed callback preserves shutdown failure", async () => {
  const f = await physicalFixture(base);
  let nested: unknown;
  f.ports.scanner.request = async (trigger) => {
    await Promise.resolve();
    nested = await f.runtime.stop();
    return nativeSuccess({ trigger, workKey: null, disposition: "INVALID", reason: "BAD" });
  };
  expect(
    (
      await f.runtime.dispatch({
        kind: "SUBMIT",
        id: "reentrant",
        recommendationId: f.recommendation.id,
      })
    ).ok,
  ).toBe(false);
  expect(nested).toMatchObject({ ok: false });
  expect((await f.runtime.stop()).ok).toBe(false);
  expect((await f.runtime.stop()).ok).toBe(false);
  expect(take(await f.storage.load()).at(-1)!.state.recommendations[0]!.status).toBe("INTENT");
});
