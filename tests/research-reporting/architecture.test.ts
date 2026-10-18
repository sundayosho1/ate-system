import { it, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const baseline = "2cb81c1d33462f20ce15a4616eb971296d2d44ee";
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
  "runtime",
  "time",
];
const sources = [
  "packages/research-reporting/src/adapters.ts",
  "packages/research-reporting/src/budgets.ts",
  "packages/research-reporting/src/charts.ts",
  "packages/research-reporting/src/consistency.ts",
  "packages/research-reporting/src/contracts.ts",
  "packages/research-reporting/src/evidence.ts",
  "packages/research-reporting/src/export.ts",
  "packages/research-reporting/src/improvements.ts",
  "packages/research-reporting/src/index.ts",
  "packages/research-reporting/src/native-capture.ts",
  "packages/research-reporting/src/policy.ts",
  "packages/research-reporting/src/projection.ts",
  "packages/research-reporting/src/reasons.ts",
  "packages/research-reporting/src/report.ts",
  "packages/research-reporting/src/validation.ts",
];
const expected = "7b6aed1850a6844cd5906258b4dfa1fad4f83a4d9472ce8e2640e0853473e4b9";
const allowed = [
  "docs/architecture/research-reporting.md",
  "docs/help/research-reporting.md",
  "docs/knowledge/reporting-contract-guide.md",
  "package-lock.json",
  "packages/research-reporting/README.md",
  "packages/research-reporting/package.json",
  "packages/research-reporting/src/adapters.ts",
  "packages/research-reporting/src/budgets.ts",
  "packages/research-reporting/src/charts.ts",
  "packages/research-reporting/src/consistency.ts",
  "packages/research-reporting/src/contracts.ts",
  "packages/research-reporting/src/evidence.ts",
  "packages/research-reporting/src/export.ts",
  "packages/research-reporting/src/improvements.ts",
  "packages/research-reporting/src/index.ts",
  "packages/research-reporting/src/native-capture.ts",
  "packages/research-reporting/src/policy.ts",
  "packages/research-reporting/src/projection.ts",
  "packages/research-reporting/src/reasons.ts",
  "packages/research-reporting/src/report.ts",
  "packages/research-reporting/src/validation.ts",
  "packages/research-reporting/tsconfig.json",
  "tests/instrument-eligibility/architecture-guard-remediation.test.ts",
  "tests/instrument-specifications/temporal-architecture.test.ts",
  "tests/mose-attention/architecture.test.ts",
  "tests/mose-core/architecture.test.ts",
  "tests/mose-scanner/architecture.test.ts",
  "tests/research-insights/architecture.test.ts",
  "tests/research-reporting/architecture.test.ts",
  "tests/research-reporting/budgets-lifecycle.test.ts",
  "tests/research-reporting/charts-export.test.ts",
  "tests/research-reporting/consistency.test.ts",
  "tests/research-reporting/contracts.test.ts",
  "tests/research-reporting/diagnostics-improvements.test.ts",
  "tests/research-reporting/integration-journeys.test.ts",
  "tests/research-reporting/native-evidence.test.ts",
  "tests/research-reporting/projections.test.ts",
];
const hash = (files: readonly (readonly [string, string])[]) =>
  createHash("sha256").update(JSON.stringify(files)).digest("hex");
const actual = () => sources.map((p) => [p, readFileSync(p, "utf8")] as const);
it("exact15source files have explicit reviewed implementation hash", () => {
  expect(sources).toHaveLength(15);
  expect(hash(actual())).toBe(expected);
  expect(
    readdirSync("packages/research-reporting/src")
      .filter((f) => f.endsWith(".ts"))
      .sort(),
  ).toEqual(sources.map((p) => p.split("/").at(-1)));
});
for (const source of sources)
  it(`new source mutation is detected ${source}`, () => {
    expect(
      hash(actual().map(([p, s]) => [p, p === source ? s + "\n// unauthorized mutation" : s])),
    ).not.toBe(expected);
  });
it("all22accepted package trees unchanged", () => {
  expect(owners).toHaveLength(22);
  expect(
    execFileSync("git", ["diff", baseline, "--", ...owners.map((o) => "packages/" + o)], {
      encoding: "utf8",
    }),
  ).toBe("");
});
for (const owner of owners)
  it(`actual Git negative control protects ${owner}`, () => {
    const root = mkdtempSync(join(tmpdir(), "report-owner-")),
      git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.name", "Offline ownership control");
    git("config", "user.email", "control@example.invalid");
    writeFileSync(join(root, "accepted"), "fixture");
    git("add", ".");
    git("commit", "-qm", "Synthetic ownership baseline only");
    const base = git("rev-parse", "HEAD").trim(),
      path = join(root, "packages", owner, "src", "owner.ts");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "UNAUTHORIZED OWNER MUTATION\n");
    git("add", ".");
    expect(git("diff", base, "--", ...owners.map((o) => "packages/" + o))).toContain(
      "UNAUTHORIZED OWNER MUTATION",
    );
  });
it("root configuration and all governance bytes remain pinned", () => {
  for (const p of [
    "package.json",
    "tsconfig.json",
    "config/capabilities.json",
    "docs/development/prompt-ledger.md",
    "docs/development/p1-p27-insights-foundation-conditional-acceptance.md",
  ])
    expect(readFileSync(p)).toEqual(execFileSync("git", ["show", baseline + ":" + p]));
});
it("whole lock top-level and all old entries exact with only2new workspace records", () => {
  const old = JSON.parse(
      execFileSync("git", ["show", baseline + ":package-lock.json"], { encoding: "utf8" }),
    ) as { packages: Record<string, unknown>; [key: string]: unknown },
    current = JSON.parse(readFileSync("package-lock.json", "utf8")) as typeof old;
  for (const [k, v] of Object.entries(old)) if (k !== "packages") expect(current[k]).toEqual(v);
  for (const [k, v] of Object.entries(old.packages)) expect(current.packages[k]).toEqual(v);
  expect(Object.keys(current.packages).filter((k) => !(k in old.packages))).toEqual([
    "node_modules/@ate/research-reporting",
    "packages/research-reporting",
  ]);
  expect(createHash("sha256").update(readFileSync("package-lock.json")).digest("hex")).toBe(
    "60f773941fe563685ac140d1a8e26953827ab2c60cef271f22df4c709c42612b",
  );
});
it("no unapproved source private import network clock or execution", () => {
  const s = actual()
    .map((x) => x[1])
    .join("\n");
  for (const pattern of [
    /node:(?:fs|http|https|net|tls|child_process)/,
    /@ate\/[^"']+\/src\//,
    /Date\.now\(/,
    /Math\.random\(/,
    /\bfetch\(/,
    /\b(?:placeOrder|sendOrder|executeTrade)\s*\(/,
  ])
    expect(s).not.toMatch(pattern);
});
it("exact37path maximum does not confer directory-wide permission", () => {
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
  expect(new Set([...tracked, ...untracked]).size).toBeLessThanOrEqual(37);
});
