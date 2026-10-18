import { beforeAll, expect, it } from "vitest";
import { clone, fail, fingerprint } from "@ate/mose-attention";
import { durationMs } from "@ate/time";
import { physicalFixture, corruptHistory, owners, take } from "./remediation-fixtures.js";
let base: Awaited<ReturnType<typeof owners>>;
beforeAll(async () => {
  base = await owners();
});
for (const variant of [
  "new-recommendation",
  "duplicate-allocation",
  "repeated-allocation",
  "pause-resume",
  "restart",
  "repeated-recovery",
  "membership",
  "policy-revision",
]) {
  it(`original obligation allowance survives ${variant}`, async () => {
    const f = await physicalFixture(base);
    let calls = 0;
    f.ports.scanner.request = async () => {
      await Promise.resolve();
      calls++;
      return fail("NONE");
    };
    for (let i = 0; i < 2; i++)
      take(
        await f.runtime.dispatch({
          kind: "SUBMIT",
          id: "attempt-" + i,
          recommendationId: f.recommendation.id,
        }),
      );
    let runtime = f.runtime;
    if (variant === "pause-resume") {
      take(await runtime.dispatch({ kind: "PAUSE", id: "pause" }));
      take(await runtime.dispatch({ kind: "RESUME", id: "resume" }));
    }
    if (variant === "restart" || variant === "repeated-recovery")
      for (let i = 0; i < (variant === "restart" ? 1 : 3); i++) {
        runtime = f.fresh();
        take(await runtime.initialize());
      }
    if (variant === "membership")
      take(
        await runtime.dispatch({
          kind: "ASSESS",
          id: "other-subject",
          subject: { ...f.subject, subscriptions: ["rescan", "periodic"] },
          asOf: f.clock.now(),
        }),
      );
    if (variant === "policy-revision")
      f.setConfig(await f.config({ ...f.policy, version: "revision" }));
    else
      for (let i = 0; i < (variant === "repeated-allocation" ? 3 : 1); i++)
        take(
          await runtime.dispatch({
            kind: "ALLOCATE",
            id: variant === "duplicate-allocation" ? "allocate" : "new-allocation-" + i,
            asOf: f.clock.now(),
            limit: variant === "duplicate-allocation" ? 32 : 1,
          }),
        );
    const last = take(await f.storage.load()).at(-1)!,
      recommendation = last.state.recommendations.at(-1)!;
    expect(recommendation.floorId).toBe(f.recommendation.floorId);
    expect(
      (
        await runtime.dispatch({
          kind: "SUBMIT",
          id: "bypass",
          recommendationId: recommendation.id,
        })
      ).ok,
    ).toBe(false);
    expect(calls).toBe(2);
    expect(
      last.state.recommendations
        .filter((r) => r.floorId === f.recommendation.floorId)
        .reduce((n, r) => n + r.attempts, 0),
    ).toBe(2);
    expect(last.state.floors[0]!.settledBy).toBeNull();
  });
}
it("retry UNKNOWN cannot buy another entitlement by allocation or recovery", async () => {
  const f = await physicalFixture(base);
  let calls = 0;
  f.ports.scanner.request = async () => {
    await Promise.resolve();
    calls++;
    return fail("UNKNOWN", "UNKNOWN");
  };
  take(
    await f.runtime.dispatch({
      kind: "SUBMIT",
      id: "unknown",
      recommendationId: f.recommendation.id,
    }),
  );
  const fresh = f.fresh();
  take(await fresh.initialize());
  await fresh.dispatch({ kind: "ALLOCATE", id: "repeat", asOf: f.clock.now(), limit: 1 });
  expect(
    (await fresh.dispatch({ kind: "SUBMIT", id: "again", recommendationId: f.recommendation.id }))
      .ok,
  ).toBe(false);
  expect(calls).toBe(1);
  expect(fresh.diagnostics()).toMatchObject({
    pendingSubmissions: 1,
    floorDebt: 1,
    readiness: "NOT_READY",
  });
});
it("retry genuine ACK does not permit another settlement or call", async () => {
  const f = await physicalFixture(base),
    original = f.ports.scanner.request.bind(f.ports.scanner);
  let calls = 0;
  f.ports.scanner.request = async (p) => {
    await Promise.resolve();
    calls++;
    return original(p);
  };
  take(
    await f.runtime.dispatch({ kind: "SUBMIT", id: "ack", recommendationId: f.recommendation.id }),
  );
  take(await f.allocate("again", 1));
  expect(
    (
      await f.runtime.dispatch({
        kind: "SUBMIT",
        id: "again",
        recommendationId: f.recommendation.id,
      })
    ).ok,
  ).toBe(false);
  expect(calls).toBe(1);
  expect(f.runtime.diagnostics().settledFloors).toBe(1);
});
it("retry held call reserves one attempt before concurrent calls and late NONE", async () => {
  const f = await physicalFixture(base);
  let calls = 0,
    release: () => void = () => {},
    entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.ports.scanner.request = () => {
    calls++;
    entered();
    return new Promise((resolve) => {
      release = () => resolve(fail("NONE"));
    });
  };
  const pending = f.runtime.dispatch({
    kind: "SUBMIT",
    id: "held",
    recommendationId: f.recommendation.id,
  });
  await started;
  expect(
    (
      await f.runtime.dispatch({
        kind: "SUBMIT",
        id: "parallel",
        recommendationId: f.recommendation.id,
      })
    ).ok,
  ).toBe(false);
  expect((await f.runtime.stop()).ok).toBe(false);
  release();
  expect((await pending).ok).toBe(false);
  expect(calls).toBe(1);
  expect(take(await f.storage.load()).at(-1)!.state.recommendations[0]!.attempts).toBe(1);
});
it("retry duplicate command cannot spend another owner call", async () => {
  const f = await physicalFixture(base);
  let calls = 0;
  f.ports.scanner.request = async () => {
    await Promise.resolve();
    calls++;
    return fail("NONE");
  };
  const command = { kind: "SUBMIT" as const, id: "same", recommendationId: f.recommendation.id };
  take(await f.runtime.dispatch(command));
  const records = take(await f.storage.load());
  take(await f.runtime.dispatch(command));
  expect(calls).toBe(1);
  expect(take(await f.storage.load())).toEqual(records);
});
it("cross forged admission from NONE cannot initialize then conceal failure with STOP", async () => {
  const f = await physicalFixture(base);
  f.ports.scanner.request = () => Promise.resolve(fail("NONE"));
  take(
    await f.runtime.dispatch({ kind: "SUBMIT", id: "none", recommendationId: f.recommendation.id }),
  );
  const altered = await corruptHistory(f, (cp) => {
    const r = cp.state.recommendations[0]!;
    r.status = "ADMITTED";
    r.receiptId = null;
    r.receiptFingerprint = null;
    cp.state.floors[0]!.settledBy = r.payload!.id;
  });
  expect((await altered.runtime.initialize()).ok).toBe(false);
  expect((await altered.runtime.stop()).ok).toBe(false);
  expect((await altered.runtime.stop()).ok).toBe(false);
});
it("cross minted UNKNOWN credit cannot recover and allocate", async () => {
  const f = await physicalFixture(base);
  f.ports.scanner.request = () => Promise.resolve(fail("UNKNOWN", "UNKNOWN"));
  take(
    await f.runtime.dispatch({
      kind: "SUBMIT",
      id: "unknown",
      recommendationId: f.recommendation.id,
    }),
  );
  const altered = await corruptHistory(f, (cp) => {
    cp.state.ledgers[0]!.credits[f.recommendation.instrumentKey] = 4;
  });
  expect((await altered.runtime.initialize()).ok).toBe(false);
  expect(
    (
      await altered.runtime.dispatch({
        kind: "ALLOCATE",
        id: "spend",
        asOf: f.clock.now(),
        limit: 1,
      })
    ).ok,
  ).toBe(false);
  expect(take(await altered.repository.load())).toEqual(altered.records);
});
it("cross one authentic receipt cannot settle a second historical epoch", async () => {
  const f = await physicalFixture(base);
  take(
    await f.runtime.dispatch({ kind: "SUBMIT", id: "ack", recommendationId: f.recommendation.id }),
  );
  const receiptId = take(f.runtime.query()).state.floors[0]!.settledBy;
  take(f.clock.advanceBy(durationMs(60000)));
  take(await f.assess("later-assess"));
  take(await f.allocate("later-allocation", 1));
  const altered = await corruptHistory(f, (cp) => {
    cp.state.floors[1]!.settledBy = receiptId;
    cp.state.floors[1]!.reservation = null;
  });
  expect((await altered.runtime.initialize()).ok).toBe(false);
});
it("cross same RequestId changed payload never publishes or clears debt", async () => {
  const f = await physicalFixture(base),
    cp = take(
      await f.runtime.dispatch({
        kind: "SUBMIT",
        id: "ack",
        recommendationId: f.recommendation.id,
      }),
    );
  const before = take(await f.scannerStorage.load()),
    payload = clone(cp.state.recommendations[0]!.payload!);
  payload.cause = "different";
  expect((await f.ports.scanner.request(payload)).ok).toBe(false);
  expect(take(await f.scannerStorage.load())).toEqual(before);
  const altered = await corruptHistory(f, (c) => {
    const r = c.state.recommendations[0]!;
    if (r.outcome?.kind === "ACK") r.outcome.receipt.trigger.cause = "different";
    r.receiptFingerprint = fingerprint("forged");
  });
  expect((await altered.runtime.initialize()).ok).toBe(false);
});
it("cross reentrant stop after prior NONE keeps exhausted original debt fenced", async () => {
  const f = await physicalFixture(base);
  let calls = 0;
  f.ports.scanner.request = async () => {
    await Promise.resolve();
    calls++;
    return fail("NONE");
  };
  take(
    await f.runtime.dispatch({
      kind: "SUBMIT",
      id: "first",
      recommendationId: f.recommendation.id,
    }),
  );
  f.ports.scanner.request = async () => {
    await Promise.resolve();
    calls++;
    expect((await f.runtime.stop()).ok).toBe(false);
    return fail("NONE");
  };
  expect(
    (
      await f.runtime.dispatch({
        kind: "SUBMIT",
        id: "second",
        recommendationId: f.recommendation.id,
      })
    ).ok,
  ).toBe(false);
  const fresh = f.fresh();
  take(await fresh.initialize());
  expect(
    (await fresh.dispatch({ kind: "ALLOCATE", id: "new", asOf: f.clock.now(), limit: 1 })).ok,
  ).toBe(false);
  expect(
    (await fresh.dispatch({ kind: "SUBMIT", id: "over", recommendationId: f.recommendation.id }))
      .ok,
  ).toBe(false);
  expect(calls).toBe(2);
  expect(fresh.diagnostics()).toMatchObject({
    floorDebt: 1,
    pendingSubmissions: 1,
    readiness: "NOT_READY",
  });
  expect((await fresh.stop()).ok).toBe(false);
});
