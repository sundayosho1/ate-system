import { it, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
const baseline = "fe587fb12d9eefe41e4d2234b9d7962fb323bab9";
const sources = [
  "packages/research-workspace/src/administration.ts",
  "packages/research-workspace/src/budgets.ts",
  "packages/research-workspace/src/consistency.ts",
  "packages/research-workspace/src/contracts.ts",
  "packages/research-workspace/src/diagnostics.ts",
  "packages/research-workspace/src/export.ts",
  "packages/research-workspace/src/handover.ts",
  "packages/research-workspace/src/improvement-view.ts",
  "packages/research-workspace/src/index.ts",
  "packages/research-workspace/src/knowledge-links.ts",
  "packages/research-workspace/src/policy.ts",
  "packages/research-workspace/src/release-overlay.ts",
  "packages/research-workspace/src/report-links.ts",
  "packages/research-workspace/src/serialization.ts",
  "packages/research-workspace/src/validation.ts",
  "packages/research-workspace/src/workspace.ts",
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
  "runtime",
  "time",
];
const allowed = [
  "docs/architecture/research-workspace.md",
  "docs/help/research-workspace.md",
  "docs/integration/research-workspace-cursor-handover.md",
  "package-lock.json",
  "packages/research-workspace/README.md",
  "packages/research-workspace/package.json",
  "packages/research-workspace/src/administration.ts",
  "packages/research-workspace/src/budgets.ts",
  "packages/research-workspace/src/consistency.ts",
  "packages/research-workspace/src/contracts.ts",
  "packages/research-workspace/src/diagnostics.ts",
  "packages/research-workspace/src/export.ts",
  "packages/research-workspace/src/handover.ts",
  "packages/research-workspace/src/improvement-view.ts",
  "packages/research-workspace/src/index.ts",
  "packages/research-workspace/src/knowledge-links.ts",
  "packages/research-workspace/src/policy.ts",
  "packages/research-workspace/src/release-overlay.ts",
  "packages/research-workspace/src/report-links.ts",
  "packages/research-workspace/src/serialization.ts",
  "packages/research-workspace/src/validation.ts",
  "packages/research-workspace/src/workspace.ts",
  "packages/research-workspace/tsconfig.json",
  "tests/instrument-eligibility/architecture-guard-remediation.test.ts",
  "tests/instrument-specifications/temporal-architecture.test.ts",
  "tests/mose-attention/architecture.test.ts",
  "tests/mose-core/architecture.test.ts",
  "tests/mose-scanner/architecture.test.ts",
  "tests/research-insights/architecture.test.ts",
  "tests/research-reporting/architecture.test.ts",
  "tests/research-workspace/architecture.test.ts",
  "tests/research-workspace/budgets-hostile-input.test.ts",
  "tests/research-workspace/consistency-provenance.test.ts",
  "tests/research-workspace/contracts-policy.test.ts",
  "tests/research-workspace/diagnostics-improvements.test.ts",
  "tests/research-workspace/handover-export.test.ts",
  "tests/research-workspace/integration-journeys.test.ts",
  "tests/research-workspace/knowledge-report-links.test.ts",
  "tests/research-workspace/release-overlay.test.ts",
];
const expected = "4190e090562c10ba7b3fb5e2c232a603e64dbfe28a7e28cb6f9cde7d08b32b7a";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const actual = () => sources.map((p) => [p, readFileSync(p, "utf8")]);
it("exact16newsource integrity and extra source guard", () => {
  expect(sources).toHaveLength(16);
  expect(hash(actual())).toBe(expected);
  expect(
    readdirSync("packages/research-workspace/src")
      .filter((x) => x.endsWith(".ts"))
      .sort(),
  ).toEqual(sources.map((x) => x.split("/").at(-1)));
});
for (const source of sources)
  it(`integrity rejects mutation of ${source}`, () => {
    expect(
      hash(actual().map(([p, s]) => [p, p === source ? s + "\n// UNAUTHORIZED" : s])),
    ).not.toBe(expected);
  });
const args = (base: string) => ["diff", base, "--", ...owners.map((o) => "packages/" + o)];
it("all23accepted package source and metadata bytes preserved", () => {
  expect(owners).toHaveLength(23);
  expect(execFileSync("git", args(baseline), { encoding: "utf8" })).toBe("");
});
for (const owner of owners)
  it(`actual Git guard detects ${owner} mutation`, () => {
    const root = mkdtempSync(join(tmpdir(), "workspace-owner-")),
      git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.name", "Synthetic offline control");
    git("config", "user.email", "synthetic@example.invalid");
    writeFileSync(join(root, "baseline"), "synthetic");
    git("add", ".");
    git("commit", "-qm", "Synthetic boundary only");
    const base = git("rev-parse", "HEAD").trim();
    mkdirSync(join(root, "packages", owner, "src"), { recursive: true });
    writeFileSync(join(root, "packages", owner, "src", "mutation.ts"), "UNAUTHORIZED");
    git("add", ".");
    expect(git(...args(base))).toContain("UNAUTHORIZED");
  });
it("exact39path envelope includes no arbitrary new test or source", () => {
  const tracked = execFileSync("git", ["diff", "--name-only", baseline], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean),
    untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
  for (const p of [...tracked, ...untracked]) expect(allowed).toContain(p);
  expect(new Set([...tracked, ...untracked]).size).toBeLessThanOrEqual(39);
});
it("root config capabilities version and every governance record remain exact", () => {
  for (const p of [
    "package.json",
    "tsconfig.json",
    "config/capabilities.json",
    "docs/development/prompt-ledger.md",
    ...readdirSync("docs/development")
      .filter((n) => n.includes("conditional-acceptance"))
      .map((n) => "docs/development/" + n),
  ])
    expect(readFileSync(p)).toEqual(execFileSync("git", ["show", baseline + ":" + p]));
});
it("exact approved lock hash and219oldrecords preserved", () => {
  expect(createHash("sha256").update(readFileSync("package-lock.json")).digest("hex")).toBe(
    "8467e34ca12656c67eb7ad38219b5c931c19bb8843ace056b9ad830dda084ce0",
  );
  const old = JSON.parse(
      execFileSync("git", ["show", baseline + ":package-lock.json"], { encoding: "utf8" }),
    ) as { packages: Record<string, unknown> },
    now = JSON.parse(readFileSync("package-lock.json", "utf8")) as typeof old;
  expect(Object.keys(old.packages)).toHaveLength(219);
  for (const [k, v] of Object.entries(old.packages)) expect(now.packages[k]).toEqual(v);
  expect(Object.keys(now.packages).filter((k) => !(k in old.packages))).toEqual([
    "node_modules/@ate/research-workspace",
    "packages/research-workspace",
  ]);
});
it("new integration source cannot import private upstream code or execute financial/network actions", () => {
  const source = actual()
    .map((x) => x[1])
    .join("\n");
  for (const re of [
    /node:(?:fs|http|https|net|tls|child_process)/,
    /@ate\/[^"']+\/src\//,
    /Date\.now\(/,
    /Math\.random\(/,
    /\bfetch\(/,
    /\b(?:placeOrder|executeTrade|sendOrder)\s*\(/,
  ])
    expect(source).not.toMatch(re);
});
