import { it, expect } from "vitest";
import { defaultPolicy, identityId } from "@ate/instrument-registry";
import { setup, equity, take, evidence } from "./fixtures.js";
it.each(["displayName", "shortName", "description", "jurisdiction", "currency"] as const)(
  "permitted metadata revision %s preserves original",
  async (field) => {
    const { registry } = await setup();
    const before = take(await registry.register(equity()));
    const d = equity();
    d[field] = field === "currency" ? "USD" : "updated";
    const after = take(
      await registry.revise(before.instrumentId, before.revisionId, d, "evidenced update"),
    );
    expect(after.sequence).toBe(2);
    expect(after.previous).toBe(before.revisionId);
    expect(take(registry.revision(before.revisionId))).toEqual(before);
    expect(take(registry.diff(before.revisionId, after.revisionId))).toContain(field);
  },
);
it("stale revision cannot become current", async () => {
  const { registry } = await setup();
  const row = take(await registry.register(equity()));
  take(
    await registry.revise(
      row.instrumentId,
      row.revisionId,
      { ...equity(), displayName: "new" },
      "rename",
    ),
  );
  expect((await registry.revise(row.instrumentId, row.revisionId, equity(), "stale")).ok).toBe(
    false,
  );
});
it("identity-changing revision rejects", async () => {
  const { registry } = await setup();
  const row = take(await registry.register(equity()));
  expect(
    (await registry.revise(row.instrumentId, row.revisionId, equity("B"), "substitute")).ok,
  ).toBe(false);
  expect(take(registry.get(row.instrumentId))).toEqual(row);
});
it("retirement preserves history but cannot reactivate", async () => {
  const { registry } = await setup();
  const row = take(await registry.register(equity()));
  const retired = take(
    await registry.revise(
      row.instrumentId,
      row.revisionId,
      { ...equity(), status: "RETIRED" },
      "retired research entry",
    ),
  );
  expect(
    (await registry.revise(row.instrumentId, retired.revisionId, equity(), "reactivate")).ok,
  ).toBe(false);
  expect(take(registry.history(row.instrumentId))).toHaveLength(2);
});
it("same revision is an idempotent no-write", async () => {
  const { registry } = await setup();
  const row = take(await registry.register(equity()));
  take(await registry.revise(row.instrumentId, row.revisionId, equity(), "same"));
  expect(registry.diagnostics().generation).toBe(1);
});
it("justification is mandatory", async () => {
  const { registry } = await setup();
  const row = take(await registry.register(equity()));
  expect(
    (
      await registry.revise(
        row.instrumentId,
        row.revisionId,
        { ...equity(), displayName: "new" },
        "",
      )
    ).ok,
  ).toBe(false);
});
it("exact revision-chain capacity is enforced without mutation", async () => {
  const { registry } = await setup({ ...defaultPolicy, maxRevisions: 1 });
  const row = take(await registry.register(equity()));
  expect(
    (
      await registry.revise(
        row.instrumentId,
        row.revisionId,
        { ...equity(), displayName: "new" },
        "rename",
      )
    ).ok,
  ).toBe(false);
  expect(take(registry.history(row.instrumentId))).toHaveLength(1);
});
it("relationship and alias evidence remains immutable in old revision", async () => {
  const { registry } = await setup();
  const row = take(await registry.register(equity()));
  const d = equity();
  d.aliases = [{ value: "ABC", kind: "SYMBOL", scope: "X", rule: "CASE", evidence: evidence() }];
  take(await registry.revise(row.instrumentId, row.revisionId, d, "alias"));
  expect(take(registry.revision(row.revisionId))!.definition.aliases).toHaveLength(0);
  expect(take(registry.get(identityId(d.identity)))!.definition.aliases).toHaveLength(1);
});
it("removed optional metadata appears in the immutable changed-field set", async () => {
  const { registry } = await setup();
  const d = { ...equity(), description: "old description" };
  const before = take(await registry.register(d));
  const after = take(
    await registry.revise(before.instrumentId, before.revisionId, equity(), "remove description"),
  );
  expect(after.changedFields).toContain("description");
  expect(take(registry.diff(before.revisionId, after.revisionId))).toContain("description");
  expect(take(registry.revision(before.revisionId))!.definition.description).toBe(
    "old description",
  );
});
