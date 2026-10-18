import { beforeAll, it, expect } from "vitest";
import { MemoryAttentionRepository, fail, ok, fingerprint, readResult } from "@ate/mose-attention";
import { fixture, owners, take, durationMs, checker } from "./fixtures.js";
let base: Awaited<ReturnType<typeof owners>>;
beforeAll(async () => {
  base = await owners();
});
it("genuine accepted observation qualifies without any future owner", async () => {
  const f = await fixture(base);
  const cp = take(await f.assess());
  expect(cp.state.assessments.at(-1)?.reason).toBe("EVIDENCE_QUALIFIED");
  expect(cp.state.assessments.at(-1)).toMatchObject({
    sufficient: true,
    tier: "STANDARD",
    opportunityState: "UNSUPPORTED",
  });
});
it("allocation reserves floor without fabricating admitted work", async () => {
  const f = await fixture(base);
  take(await f.assess());
  const cp = take(await f.allocate());
  expect(cp.state.ledgers.at(-1)!.barrierId).toBe("offline-single-writer-test-barrier");
  expect(cp.state.floors).toHaveLength(1);
  expect(cp.state.floors[0]!.settledBy).toBeNull();
  expect(cp.state.ledgers[0]!.spent).toBe(1);
});
it("disabled submission never calls upstream", async () => {
  const f = await fixture(base);
  take(await f.assess());
  const cp = take(await f.allocate());
  const original = f.ports.scanner.request;
  let calls = 0;
  f.ports.scanner = {
    ...f.ports.scanner,
    request: (r) => {
      calls++;
      return original.call(f.scanner.scanner, r);
    },
  };
  expect(
    await f.runtime.dispatch({
      kind: "SUBMIT",
      id: "submit",
      recommendationId: cp.state.recommendations[0]!.id,
    }),
  ).toMatchObject({ ok: false, error: { code: "SUBMISSION_DISABLED" } });
  expect(calls).toBe(0);
});
it("unknown read consistency persists explicit outcome and no proposals", async () => {
  const f = await fixture(base);
  delete f.ports.readBarrier;
  take(await f.assess());
  const cp = take(await f.allocate());
  expect(cp.state.ledgers[0]!.consistency).toBe("CONSISTENCY_UNESTABLISHED");
  expect(cp.state.recommendations).toEqual([]);
  expect(f.runtime.diagnostics().eligibleDenominator).toBeNull();
});
it("same epoch repeated allocations do not reserve floor twice", async () => {
  const f = await fixture(base);
  take(await f.assess());
  take(await f.allocate());
  const cp = take(await f.allocate("again"));
  expect(cp.state.recommendations).toHaveLength(1);
  expect(cp.state.ledgers[0]!.spent).toBe(1);
});
it("same command returns original exact generation; changed payload conflicts", async () => {
  const f = await fixture(base);
  const a = take(await f.assess());
  expect(take(await f.assess()).fingerprint).toBe(a.fingerprint);
  expect(
    await f.runtime.dispatch({
      kind: "ASSESS",
      id: "assess",
      subject: { ...f.subject, subscriptions: ["periodic"] },
      asOf: f.clock.now(),
    }),
  ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
});
it("forged subject rejects without poisoning identity retry", async () => {
  const f = await fixture(base);
  expect(
    (
      await f.runtime.dispatch({
        kind: "ASSESS",
        id: "retry",
        subject: { ...f.subject, universe: fingerprint("forged") },
        asOf: f.clock.now(),
      })
    ).ok,
  ).toBe(false);
  expect((await f.assess("retry")).ok).toBe(true);
});
it("future evidence cutoff rejected before journal advancement", async () => {
  const f = await fixture(base);
  const before = take(f.runtime.query()).total;
  expect(
    (
      await f.runtime.dispatch({
        kind: "ASSESS",
        id: "future",
        subject: f.subject,
        asOf: new Date(Date.parse(f.clock.now()) + 1).toISOString(),
      })
    ).ok,
  ).toBe(false);
  expect(take(f.runtime.query()).total).toBe(before);
});
it("native owner exception creates insufficient assessment not escaped callback", async () => {
  const f = await fixture(base);
  f.ports.eligibility = {
    getEligibility: () => {
      throw Error("SOURCE_UNAVAILABLE");
    },
  };
  expect(take(await f.assess()).state.assessments.at(-1)).toMatchObject({
    sufficient: false,
    proposedBudget: 0,
  });
});
it("source restoration requires new genuine current assessment", async () => {
  const f = await fixture(base);
  const eligibility = f.ports.eligibility;
  f.ports.eligibility = {
    getEligibility: () => Promise.resolve(fail("RECORD_NOT_FOUND", "UNKNOWN")),
  };
  expect(take(await f.assess()).state.assessments.at(-1)!.sufficient).toBe(false);
  f.ports.eligibility = eligibility;
  expect(take(await f.assess("restored")).state.assessments.at(-1)!.sufficient).toBe(true);
});
it("pause blocks assessment and resume restores service", async () => {
  const f = await fixture(base);
  take(await f.runtime.dispatch({ kind: "PAUSE", id: "pause" }));
  expect((await f.assess()).ok).toBe(false);
  take(await f.runtime.dispatch({ kind: "RESUME", id: "resume" }));
  expect((await f.assess()).ok).toBe(true);
});
it("clean repeated local shutdown rejects subsequent queries", async () => {
  const f = await fixture(base);
  expect((await f.runtime.stop()).ok).toBe(true);
  expect((await f.runtime.stop()).ok).toBe(true);
  expect(f.runtime.query().ok).toBe(false);
});
it("fresh recovery preserves floor identity and spent budget", async () => {
  const f = await fixture(base);
  take(await f.assess());
  const cp = take(await f.allocate());
  const next = await f.restart();
  expect(take(next.query()).state).toEqual(cp.state);
  const result = take(
    await next.dispatch({
      kind: "ALLOCATE",
      id: "recovery-allocate",
      asOf: f.clock.now(),
      limit: 32,
    }),
  );
  expect(result.state.recommendations).toHaveLength(1);
});
it("JSON and native commands use same idempotency contract", async () => {
  const f = await fixture(base);
  const command = { kind: "ASSESS", id: "json", subject: f.subject, asOf: f.clock.now() };
  const a = take(await f.runtime.dispatchJson(JSON.stringify(command)));
  expect(take(await f.runtime.dispatch(command)).fingerprint).toBe(a.fingerprint);
});
it.each([null, 1, true, {}, "{", []])("malformed JSON input %# safely rejected", async (raw) => {
  const f = await fixture(base);
  expect((await f.runtime.dispatchJson(raw)).ok).toBe(false);
  expect((await f.assess()).ok).toBe(true);
});
it.each([
  null,
  0,
  true,
  { ok: null },
  { ok: 0 },
  { ok: "false" },
  { ok: true, value: 1, error: {} },
  { ok: false },
  { ok: false, error: null },
  { ok: false, error: { code: 1, commitment: "NONE" } },
  { ok: false, error: { code: "X", commitment: "MAYBE" } },
  { ok: false, value: 1, error: { code: "X", commitment: "NONE" } },
])("native Result contract rejects malformed envelope %#", (raw) => {
  expect(() => readResult(raw)).toThrow();
});
it.each(["NONE", "UNKNOWN"] as const)(
  "valid negative commitment %s remains distinct",
  (commitment) => {
    expect(readResult({ ok: false, error: { code: "RECORD_NOT_FOUND", commitment } })).toEqual(
      fail("RECORD_NOT_FOUND", commitment),
    );
  },
);
it("Result discriminator read exactly once", () => {
  let reads = 0;
  expect(
    readResult({
      get ok() {
        reads++;
        return reads === 1;
      },
      value: 3,
    }),
  ).toEqual(ok(3));
  expect(reads).toBe(1);
});
it.each([
  Object.assign([], { ok: true, value: 3 }),
  Object.create({ ok: true, value: 3 }) as unknown,
  Object.assign(Object.create(null) as object, { ok: true, value: 3 }),
])("structural native Result representation accepted %#", (raw) => {
  expect(readResult(raw)).toEqual(ok(3));
});
it("property exception cannot escape runtime adapter boundary", async () => {
  const f = await fixture(base);
  f.ports.eligibility = {
    getEligibility: () =>
      Promise.resolve({
        get ok() {
          throw Error("HOSTILE_GETTER");
        },
      } as never),
  };
  expect(take(await f.assess()).state.assessments.at(-1)!.reason).toBe("HOSTILE_GETTER");
});
it("own UNKNOWN retains exact publication and repeated stop failure", async () => {
  const repo = new MemoryAttentionRepository();
  const f = await fixture(base, {}, repo);
  f.ports.repository = {
    load: () => repo.load(),
    commit: async (cp) => {
      take(await repo.commit(cp));
      return fail("LOST_ACK", "UNKNOWN");
    },
  };
  expect(await f.assess()).toMatchObject({ ok: false, error: { commitment: "UNKNOWN" } });
  expect((await f.runtime.stop()).ok).toBe(false);
  expect((await f.runtime.stop()).ok).toBe(false);
  expect(f.runtime.diagnostics().pendingPublications).toBe(1);
  take(await f.runtime.reconcilePublication());
  expect(f.runtime.diagnostics().pendingPublications).toBe(0);
});
it("proven NONE allows same command retry without phantom publication", async () => {
  const f = await fixture(base);
  const repo = f.ports.repository;
  f.ports.repository = { load: () => repo.load(), commit: () => Promise.resolve(fail("FULL")) };
  expect(await f.assess()).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  f.ports.repository = repo;
  expect((await f.assess()).ok).toBe(true);
});
it("forged successful ACK cannot advance trusted state", async () => {
  const f = await fixture(base);
  const repo = f.ports.repository;
  f.ports.repository = {
    load: () => repo.load(),
    commit: (cp) => Promise.resolve(ok({ ...cp, generation: cp.generation + 1 })),
  };
  expect(await f.assess()).toMatchObject({
    ok: false,
    error: { code: "ACK_MISMATCH", commitment: "UNKNOWN" },
  });
  expect(f.runtime.diagnostics().pendingPublications).toBe(1);
});
it("governed checker rescan creates exact one-to-one floor receipt", async () => {
  const f = await fixture(base, { submissionEnabled: true, actor: checker.actorId });
  take(await f.assess());
  const cp = take(await f.allocate());
  const id = cp.state.recommendations[0]!.id;
  const ack = take(
    await f.runtime.dispatch({ kind: "SUBMIT", id: "submit", recommendationId: id }),
  );
  expect(ack.state.recommendations[0]!.status).toBe("ADMITTED");
  expect(ack.state.floors[0]!.settledBy).toBe(ack.state.recommendations[0]!.payload!.id);
});
it("expired assessment never grants optional submission", async () => {
  const f = await fixture(base, { submissionEnabled: true, actor: checker.actorId });
  take(await f.assess());
  const cp = take(await f.allocate());
  take(f.clock.advanceBy(durationMs(180000)));
  expect(
    (
      await f.runtime.dispatch({
        kind: "SUBMIT",
        id: "expired",
        recommendationId: cp.state.recommendations[0]!.id,
      })
    ).ok,
  ).toBe(false);
});
it("historical as-of state and denominator never borrow newer assessment", async () => {
  const f = await fixture(base);
  take(await f.assess());
  const at = f.clock.now();
  take(f.clock.advanceBy(durationMs(60000)));
  take(await f.assess("later"));
  const old = take(f.runtime.queryHistory(at));
  expect(old.state.assessments).toHaveLength(1);
  expect(take(f.runtime.query()).state.assessments).toHaveLength(2);
  expect(old.total).toBe(2);
  expect(old.scope).toBe("HISTORICAL_NOT_CURRENT_AUTHORITY");
});
it("explicit enabled dispatch cannot run without assessed current authority", async () => {
  const f = await fixture(base, { dispatchEnabled: true, actor: checker.actorId });
  expect(
    await f.runtime.dispatch({ kind: "EXECUTE_ADMITTED", id: "no-assessment", limit: 1 }),
  ).toMatchObject({ ok: false, error: { code: "CURRENT_AUTHORITY_MISSING" } });
});
it("explicit governed dispatch journals full accepted child results", async () => {
  const f = await fixture(base, {
    submissionEnabled: true,
    dispatchEnabled: true,
    actor: checker.actorId,
  });
  take(await f.assess());
  const allocation = take(await f.allocate());
  take(
    await f.runtime.dispatch({
      kind: "SUBMIT",
      id: "prepare-dispatch",
      recommendationId: allocation.state.recommendations[0]!.id,
    }),
  );
  const cp = take(await f.runtime.dispatch({ kind: "EXECUTE_ADMITTED", id: "execute", limit: 1 }));
  expect(cp.state.executions[0]).toMatchObject({ status: "ACKNOWLEDGED", result: { ok: true } });
  expect(cp.state.executions[0]!.result).toHaveProperty("value");
});
it("unknown dispatch cannot be hidden by durable STOP or restart", async () => {
  const f = await fixture(base, { dispatchEnabled: true, actor: checker.actorId });
  take(await f.assess());
  f.ports.scanner.dispatch = () => Promise.resolve(fail("OWNER_UNKNOWN", "UNKNOWN"));
  const cp = take(
    await f.runtime.dispatch({ kind: "EXECUTE_ADMITTED", id: "unknown-execution", limit: 1 }),
  );
  expect(cp.state.executions[0]!.status).toBe("UNRESOLVED");
  expect((await f.runtime.dispatch({ kind: "STOP", id: "stop-uncertain" })).ok).toBe(false);
  const next = await f.restart();
  expect(next.diagnostics().pendingSubmissions).toBe(1);
  expect((await next.stop()).ok).toBe(false);
});
it("historical native cutoff rejects coercion objects without executing them", async () => {
  const f = await fixture(base);
  let coerced = false;
  const hostile = {
    toString() {
      coerced = true;
      throw Error("HOSTILE_COERCION");
    },
  };
  for (const input of [null, 1, hostile])
    expect(f.runtime.queryHistory(input as unknown as string)).toMatchObject({ ok: false });
  expect(coerced).toBe(false);
});
it("hostile thrown owner value cannot escape structured assessment rejection", async () => {
  const f = await fixture(base);
  const hostile = new Proxy(new Error("OWNER_FAILURE"), {
    getPrototypeOf() {
      throw Error("HOSTILE_CAUGHT_VALUE");
    },
  });
  f.ports.eligibility = { getEligibility: () => Promise.reject(hostile) };
  expect(take(await f.assess()).state.assessments.at(-1)).toMatchObject({
    sufficient: false,
    reason: "OWNER_FAILURE",
  });
});
it("genuine but stale eligibility evaluation cannot grant current authority", async () => {
  const f = await fixture(base),
    original = f.ports.eligibility,
    stale = await original.getEligibility(f.subject.instrumentId);
  take(f.clock.advanceBy(durationMs(60000)));
  f.ports.eligibility = { getEligibility: () => Promise.resolve(stale) };
  const rejected = take(await f.assess());
  expect(rejected.state.assessments.at(-1)!.reason).toBe("CURRENT_AUTHORITY_TIME_MISMATCH");
  expect(rejected.state.assessments.at(-1)).toMatchObject({
    sufficient: false,
    reason: "CURRENT_AUTHORITY_TIME_MISMATCH",
    currentAuthority: "UNESTABLISHED",
  });
  f.ports.eligibility = original;
  expect(take(await f.assess("current-evaluation")).state.assessments.at(-1)!.sufficient).toBe(
    true,
  );
});
it("a newer resolved configuration cannot be backdated into earlier knowledge", async () => {
  const f = await fixture(base),
    at = new Date(Date.parse(f.clock.now()) - 1).toISOString();
  expect(
    await f.runtime.dispatch({
      kind: "ASSESS",
      id: "backdated-policy",
      subject: f.subject,
      asOf: at,
    }),
  ).toMatchObject({ ok: false, error: { code: "POLICY_NOT_KNOWN_AT_CUTOFF" } });
  expect((await f.assess("present-policy")).ok).toBe(true);
});
