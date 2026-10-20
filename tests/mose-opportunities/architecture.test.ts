import { it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const baseline = "610193e2479c28d0bd32eebff2bd16f550b0643b";
const files = [
  "canonical.ts",
  "contracts.ts",
  "diagnostics.ts",
  "evidence.ts",
  "filesystem-repository.ts",
  "handover.ts",
  "identity.ts",
  "index.ts",
  "journal.ts",
  "memory-repository.ts",
  "policy.ts",
  "predicates.ts",
  "query.ts",
  "recovery.ts",
  "runtime.ts",
  "time-policy.ts",
  "transitions.ts",
  "validation.ts",
];
const owners = [
  "broker-symbol-catalogue",
  "canonical-symbol-mapping",
  "configuration",
  "data-quality",
  "dataset-catalogue",
  "domain",
  "events",
  "historical-data",
  "instrument-eligibility",
  "instrument-registry",
  "instrument-specifications",
  "market-replay",
  "mose-attention",
  "mose-core",
  "mose-scanner",
  "multitimeframe",
  "persistence",
  "realtime-data",
  "research-insight-contracts",
  "research-insights",
  "research-reporting",
  "research-workspace",
  "runtime",
  "time",
];
const expected = "3fc836d493d118873e5954cc8654134a61cee6db3e598e45ba9111c8929f5fc3";
const digest = (override?: { name: string; bytes: Buffer }) => {
  const h = createHash("sha256");
  for (const name of files)
    h.update(name + "\n")
      .update(
        override?.name === name
          ? override.bytes
          : readFileSync("packages/mose-opportunities/src/" + name),
      )
      .update("\n");
  return h.digest("hex");
};
it("exact 18-file protected source set and full source fingerprint", () => {
  expect(readdirSync("packages/mose-opportunities/src").sort()).toEqual(files);
  expect(digest()).toBe(expected);
});
for (const name of files)
  it(`source integrity detects altered ${name}`, () => {
    const bytes = Buffer.concat([
      readFileSync("packages/mose-opportunities/src/" + name),
      Buffer.from("\n// isolated integrity mutation\n"),
    ]);
    expect(digest({ name, bytes })).not.toBe(expected);
  });
for (const owner of owners)
  it(`accepted owner ${owner} remains byte-identical`, () => {
    expect(
      execFileSync("git", ["diff", "--name-only", baseline, "--", "packages/" + owner], {
        encoding: "utf8",
      }).trim(),
    ).toBe("");
    expect(
      execFileSync(
        "git",
        ["ls-files", "--others", "--exclude-standard", "--", "packages/" + owner],
        { encoding: "utf8" },
      ).trim(),
    ).toBe("");
  });
it("all imports use own relative files or approved public roots", () => {
  const metadata: unknown = JSON.parse(
    readFileSync("packages/mose-opportunities/package.json", "utf8"),
  );
  if (metadata === null || typeof metadata !== "object") throw Error("Invalid metadata");
  const dependencies: unknown = Reflect.get(metadata, "dependencies");
  if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies))
    throw Error("Invalid dependency map");
  const approved = new Set(Object.keys(dependencies));
  for (const name of files) {
    const s = readFileSync("packages/mose-opportunities/src/" + name, "utf8");
    for (const match of s.matchAll(/from\s+["']([^"']+)["']/gu)) {
      const spec = match[1]!;
      expect(spec.startsWith("./") || spec.startsWith("node:") || approved.has(spec), spec).toBe(
        true,
      );
    }
    expect(s).not.toMatch(/(?:fetch\s*\(|createServer\s*\(|WebSocket|child_process|https?:\/\/)/u);
  }
});
it("all 24 upstream package owners remain represented", () => expect(owners).toHaveLength(24));
it("automatic driver, filesystem and promotions are disabled by default", () => {
  const source = readFileSync("packages/mose-opportunities/src/policy.ts", "utf8");
  expect(source).toContain("compositionDriverEnabled: false");
  expect(source).toContain("filesystemEnabled: false");
  expect(source).toContain("promotionsEnabled: false");
});
