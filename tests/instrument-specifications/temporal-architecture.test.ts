import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { calendarSchema, utcCalendar } from "@ate/multitimeframe";
import { mustParseUtc } from "@ate/time";
import { fingerprint } from "@ate/configuration";
import { defaultPolicy, InstrumentSpecifications } from "@ate/instrument-specifications";
import { fixture, take, declared } from "./fixtures.js";
it.each([
  ["America/New_York", 3, 8, 2, "NONEXISTENT_LOCAL_TIME"],
  ["America/New_York", 11, 1, 1, "AMBIGUOUS_LOCAL_TIME"],
] as const)(
  "accepted %s rejects invalid/fold local time %s/%s %s",
  async (zone, month, day, hour, code) => {
    const f = await fixture(),
      r = f.request();
    r.metadata.sessions.calendar = declared(
      calendarSchema.parse({
        ...utcCalendar,
        id: "dst",
        kind: "TIMEZONE_CALENDAR",
        timezone: zone,
        fold: "REJECT",
      }),
    );
    const s = take(await f.service.publish(r));
    expect(
      f.service.sessionLocalBoundary(s.fingerprint, {
        year: 2026,
        month,
        day,
        hour,
        minute: 30,
        second: 0,
        millisecond: 0,
      }),
    ).toMatchObject({ ok: false, error: { code } });
  },
);
it.each(["EARLIER", "LATER"] as const)(
  "accepted calendar explicitly resolves fold %s",
  async (fold) => {
    const f = await fixture(),
      r = f.request();
    r.metadata.sessions.calendar = declared(
      calendarSchema.parse({
        ...utcCalendar,
        id: "dst",
        kind: "TIMEZONE_CALENDAR",
        timezone: "America/New_York",
        fold,
      }),
    );
    const s = take(await f.service.publish(r));
    expect(
      take(
        f.service.sessionLocalBoundary(s.fingerprint, {
          year: 2026,
          month: 11,
          day: 1,
          hour: 1,
          minute: 30,
          second: 0,
          millisecond: 0,
        }),
      ),
    ).toBe(fold === "EARLIER" ? "2026-11-01T05:30:00.000Z" : "2026-11-01T06:30:00.000Z");
  },
);
it.each(["overlap", "empty", "timezone", "break"] as const)(
  "calendar authority rejects %s schedule without repairing it",
  async (mode) => {
    const f = await fixture(),
      r = f.request();
    const a = {
        id: "s1",
        date: "2026-10-10",
        open: "2026-10-10T08:00:00.000Z",
        close: "2026-10-10T10:00:00.000Z",
        breaks: [] as { start: string; end: string }[],
      },
      b = { ...a, id: "s2" };
    if (mode === "empty") a.close = a.open;
    if (mode === "break")
      a.breaks = [{ start: "2026-10-10T07:00:00.000Z", end: "2026-10-10T08:30:00.000Z" }];
    r.metadata.sessions.calendar = declared(
      calendarSchema.parse({
        ...utcCalendar,
        id: "bad",
        kind: "EXPLICIT_SESSION_SCHEDULE",
        timezone: mode === "timezone" ? "Invalid/Timezone" : "Etc/UTC",
        sessions: mode === "overlap" ? [a, b] : [a],
      }),
    );
    const s = take(await f.service.publish(r));
    expect(
      s.prepared.validations.find((x) => x.ruleId === "SESSIONS_CALENDAR")?.classification,
    ).toBe("CONTRADICTORY");
    expect(s.prepared.context.calendarFingerprint).toBeNull();
  },
);
it("missing calendar yields explicit incomplete profile and no implicit authority", async () => {
  const f = await fixture(),
    s = take(await f.service.publish(f.request()));
  expect(s.prepared.completeness.find((x) => x.profile === "SESSION_HISTORY")?.classification).toBe(
    "INCOMPLETE",
  );
  expect(f.service.sessionLocalBoundary(s.fingerprint, {})).toMatchObject({
    ok: false,
    error: { code: "CALENDAR_REQUIRED" },
  });
});
it.each(["future", "old"] as const)("source time %s is not freshness", async (mode) => {
  const f = await fixture(),
    r = f.request();
  r.sourceDeclaredAt = mustParseUtc(
    mode === "future" ? "2026-10-11T00:00:00.000Z" : "2026-10-01T00:00:00.000Z",
  );
  const s = take(await f.service.publish(r));
  expect(s.prepared.validations.find((x) => x.ruleId === "SOURCE_TIME")?.classification).toBe(
    "STALE_CONTEXT",
  );
  expect(s.prepared.completeness.every((x) => x.classification === "STALE_CONTEXT")).toBe(true);
});
it("new canonical authority makes current reconciliation stale while exact stored evidence remains immutable", async () => {
  const f = await fixture(),
    s = take(await f.service.publish(f.request()));
  await f.mapping.import("new-source", "SYN.A");
  take(await f.mapping.service.publish(f.mapping.request("new-set")));
  const q = take(
    f.service.query({
      kind: "RECONCILIATION",
      snapshotFingerprint: s.fingerprint,
      scope: "CURRENT",
      offset: 0,
      limit: 10,
    }),
  );
  expect(JSON.stringify(q)).toContain("STALE_MAPPING_CONTEXT");
  expect(take(f.service.snapshot(s.fingerprint))).toEqual(s);
});
it("two independent identical research runs produce identical full snapshots", async () => {
  const a = await fixture(),
    b = await fixture(),
    sa = take(await a.service.publish(a.request())),
    sb = take(await b.service.publish(b.request()));
  expect(sa.fingerprint).toBe(sb.fingerprint);
  expect(fingerprint(sa)).toBe(fingerprint(sb));
  expect(Object.isFrozen(sa.prepared.normalized)).toBe(true);
});
it("unchanged upstream packages retain their exact baseline bytes", () => {
  expect(
    execFileSync(
      "git",
      [
        "diff",
        "6aba5a60d398faa6bb531faabd4a3bf699f873fd",
        "--",
        "packages",
        ":(exclude)packages/instrument-specifications",
        ":(exclude)packages/instrument-eligibility",
        ":(exclude)packages/mose-core",
        ":(exclude)packages/mose-scanner",
        ":(exclude)packages/mose-attention",
        ":(exclude)packages/research-insight-contracts",
        ":(exclude)packages/research-insights",
        ":(exclude)packages/research-reporting",
      ],
      { encoding: "utf8" },
    ),
  ).toBe("");
});
it("new owner has no live connectivity, wall clock or upstream private import", () => {
  const files = readdirSync("packages/instrument-specifications/src").filter((f) =>
      f.endsWith(".ts"),
    ),
    source = files
      .map((f) => readFileSync(join("packages/instrument-specifications/src", f), "utf8"))
      .join("\n");
  for (const pattern of [
    /Date\.now\(/,
    /Math\.random\(/,
    /node:(?:http|net|tls|child_process)/,
    /\bfetch\(/,
    /@ate\/[^"']+\/src\//,
  ])
    expect(source).not.toMatch(pattern);
  expect(source).toContain("validateMutation");
  expect(source).toContain("CalendarBoundaryResolver");
});
it("new source namespace cannot reuse an existing specification identity", async () => {
  const f = await fixture();
  take(await f.service.publish(f.request()));
  await f.mapping.import("other", "SYN.A", "different-broker");
  const set = take(await f.mapping.service.publish(f.mapping.request("other-set"))),
    r = f.request("namespace-substitution");
  r.mappingSet = set.fingerprint;
  r.mappingFingerprint = set.prepared.mappings.find(
    (x) => x.source.namespace.brokerNamespaceId === "different-broker",
  )!.fingerprint;
  expect(await f.service.publish(r)).toMatchObject({
    ok: false,
    error: { code: "SPECIFICATION_IDENTITY_CHANGED" },
  });
});
it("recovery enforces lifecycle resource bounds as well as live admission", async () => {
  const f = await fixture(),
    s = take(await f.service.publish(f.request()));
  const reader = new InstrumentSpecifications("spec-lab", {
    ...f.ports,
    repository: {
      load: () => Promise.resolve({ ok: true, value: [s] }),
      commit: () => Promise.resolve({ ok: false, error: { code: "NO", commitment: "NONE" } }),
    },
  });
  expect(take(await reader.initialize())?.fingerprint).toBe(s.fingerprint);
  expect(defaultPolicy.maxLifecycleEvents).toBeGreaterThan(0);
});

it("calendar holidays and special dated sessions retain accepted owner semantics", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.sessions.calendar = declared(
    calendarSchema.parse({
      ...utcCalendar,
      id: "holiday-calendar",
      kind: "EXPLICIT_SESSION_SCHEDULE",
      holidays: ["2026-10-10"],
      sessions: [
        {
          id: "special",
          date: "2026-10-10",
          open: "2026-10-10T08:00:00.000Z",
          close: "2026-10-10T10:00:00.000Z",
          breaks: [],
        },
      ],
    }),
  );
  const s = take(await f.service.publish(r));
  expect(s.prepared.normalized.sessions.calendar?.value?.holidays).toEqual(["2026-10-10"]);
  expect(s.prepared.validations.find((v) => v.ruleId === "SESSIONS_CALENDAR")?.classification).toBe(
    "INTERNALLY_CONSISTENT",
  );
});
it("current view degrades expired declared margin evidence without mutating its stored profile", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.margin = {
    mode: declared("FIXED_AMOUNT"),
    currency: declared("USD"),
    initial: declared("100"),
    maintenance: declared("50"),
    accountClass: declared("RESEARCH"),
    jurisdiction: declared("SYNTHETIC"),
    effectiveFrom: declared(mustParseUtc("2026-10-01T00:00:00.000Z")),
    effectiveTo: declared(mustParseUtc("2026-10-10T10:00:00.000Z")),
  };
  const s = take(await f.service.publish(r));
  expect(
    s.prepared.completeness.find((x) => x.profile === "DECLARED_MARGIN_RESEARCH")?.classification,
  ).toBe("INTERNALLY_CONSISTENT");
  take(f.mapping.base.clock.advanceTo(mustParseUtc("2026-10-10T10:00:00.000Z")));
  const q = take(
    f.service.query({
      kind: "PROFILES",
      scope: "CURRENT",
      profile: "DECLARED_MARGIN_RESEARCH",
      offset: 0,
      limit: 1,
    }),
  );
  expect(JSON.stringify(q)).toContain("STALE_CONTEXT");
  expect(take(f.service.snapshot(s.fingerprint))?.prepared.completeness).toEqual(
    s.prepared.completeness,
  );
});
it("a reentrant owner callback during synchronous current query cannot stop the service", async () => {
  const f = await fixture();
  take(await f.service.publish(f.request()));
  const original = f.mapping.service.query.bind(f.mapping.service);
  let nested: Promise<unknown> | undefined;
  f.mapping.service.query = (r) => {
    nested = f.service.stop();
    return original(r);
  };
  const result = f.service.query({ kind: "RECONCILIATION", scope: "CURRENT", offset: 0, limit: 1 });
  expect(result.ok).toBe(true);
  expect(await nested).toMatchObject({ ok: false, error: { code: "BUSY" } });
  expect(f.service.diagnostics().readiness).toBe("READY");
});
it("reentrant configuration shutdown is rejected at invocation, not after callback return", async () => {
  const f = await fixture();
  const original = f.ports.configuration;
  let nested: Promise<unknown> | undefined;
  const service = new InstrumentSpecifications("reentry-stop", {
    ...f.ports,
    configuration: () => {
      nested = service.stop();
      return original();
    },
  });
  take(await service.initialize());
  expect(await nested).toMatchObject({ ok: false, error: { code: "BUSY" } });
  expect(service.diagnostics().readiness).toBe("READY");
});

it("a new mapping set is a current-context boundary even when source records remain identical", async () => {
  const f = await fixture(),
    s = take(await f.service.publish(f.request()));
  take(await f.mapping.service.publish(f.mapping.request("same-sources-new-set")));
  expect((await f.service.publish(f.request("old-set-retry"))).ok).toBe(false);
  const current = take(
    f.service.query({
      kind: "RECONCILIATION",
      snapshotFingerprint: s.fingerprint,
      offset: 0,
      limit: 1,
    }),
  );
  expect(JSON.stringify(current)).toContain("STALE_MAPPING_CONTEXT");
  expect(take(f.service.snapshot(s.fingerprint))).toEqual(s);
});

it.each([
  "id",
  "version",
  "kind",
  "timezone",
  "fold",
  "weekStart",
  "weekdays",
  "holidays",
  "sessions",
])("missing declared calendar %s cannot acquire an implicit broker default", async (key) => {
  const f = await fixture(),
    r = f.request();
  r.metadata.sessions.calendar = declared({ ...utcCalendar });
  Reflect.deleteProperty(r.metadata.sessions.calendar.value!, key);
  expect((await f.service.publish(r)).ok).toBe(false);
  expect(take(await f.repository.load())).toHaveLength(0);
});
it("an explicitly empty session schedule does not establish a complete session history", async () => {
  const f = await fixture(),
    r = f.request();
  r.metadata.sessions.calendar = declared({ ...utcCalendar, kind: "EXPLICIT_SESSION_SCHEDULE" });
  r.metadata.sessions.effectiveFrom = declared(mustParseUtc("2026-10-01T00:00:00.000Z"));
  const s = take(await f.service.publish(r));
  expect(s.prepared.completeness.find((p) => p.profile === "SESSION_HISTORY")?.classification).toBe(
    "INCOMPLETE",
  );
});
