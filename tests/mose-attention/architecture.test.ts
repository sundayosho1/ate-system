import { it, expect } from "vitest";
import { strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprint } from "@ate/mose-attention";
const baseline = "873888c652c402b926fd625fe94cdd90616d27d1";
const args = (base: string) => [
  "diff",
  base,
  "--",
  "packages",
  ":(exclude)packages/mose-attention",
];
const owners = readdirSync("packages", { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "mose-attention")
  .map((d) => d.name)
  .sort();
const sourceRoot = "packages/mose-attention/src";
const sourceFiles = readdirSync(sourceRoot)
  .filter((n) => n.endsWith(".ts"))
  .sort();
const expected = "sha256:c8d985d5ef4d1cf0811f716d9ae203277158b09308ef9526ce5df88e45698533";
const sourceHash = (root: string) =>
  fingerprint(sourceFiles.map((n) => [n, readFileSync(join(root, n), "utf8")]));
function assertIntegrity(root: string) {
  strictEqual(sourceHash(root), expected);
}
it("all19 accepted source owners remain byte-identical", () => {
  expect(owners).toHaveLength(19);
  expect(execFileSync("git", args(baseline), { encoding: "utf8" })).toBe("");
});
for (const owner of [...owners, "mose-attention"])
  it(`independent Git boundary protects ${owner}`, () => {
    const root = mkdtempSync(join(tmpdir(), "attention-owner-")),
      git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.name", "External boundary control");
    git("config", "user.email", "control@example.invalid");
    writeFileSync(join(root, "baseline"), "synthetic accepted tree\n");
    git("add", ".");
    git("commit", "-qm", "Synthetic accepted owners");
    const base = git("rev-parse", "HEAD").trim();
    mkdirSync(join(root, "packages", owner, "src"), { recursive: true });
    writeFileSync(join(root, "packages", owner, "src", "owner.ts"), "UNAUTHORIZED CHANGE\n");
    git("add", ".");
    expect(git(...args(base)) !== "").toBe(owner !== "mose-attention");
  });
it("source fingerprint protects exact reviewed implementation", () => assertIntegrity(sourceRoot));
for (const file of sourceFiles)
  it(`source mutation ${file} fails actual integrity assertion`, () => {
    const root = mkdtempSync(join(tmpdir(), "attention-source-"));
    for (const n of sourceFiles) writeFileSync(join(root, n), readFileSync(join(sourceRoot, n)));
    writeFileSync(
      join(root, file),
      readFileSync(join(root, file), "utf8") + "\n// Unauthorized isolated source mutation\n",
    );
    expect(() => assertIntegrity(root)).toThrow();
  });
it("source has no private owner imports, new network, random or financial action", () => {
  const source = sourceFiles.map((n) => readFileSync(join(sourceRoot, n), "utf8")).join("\n");
  for (const pattern of [
    /Date\.now\(/,
    /Math\.random\(/,
    /\bfetch\(/,
    /node:(?:http|https|net|tls|child_process)/,
    /@ate\/[^"']+\/src\//,
    /\b(?:placeOrder|sendOrder|executeTrade)\s*\(/,
  ])
    expect(source).not.toMatch(pattern);
  expect(source).not.toMatch(/"(?:DORMANT|INTERESTING|SETUP_FORMING|CANDIDATE|QUALIFIED)"/);
});
it("governance, capabilities, root version and dependency versions preserved", () => {
  for (const p of [
    "package.json",
    "config/capabilities.json",
    "docs/development/prompt-ledger.md",
    "docs/development/prompt-26-conditional-acceptance.md",
  ]) {
    expect(readFileSync(p, "utf8")).toBe(
      execFileSync("git", ["show", baseline + ":" + p], { encoding: "utf8" }),
    );
  }
  const old = JSON.parse(
    execFileSync("git", ["show", baseline + ":package-lock.json"], { encoding: "utf8" }),
  ) as { packages: Record<string, unknown> };
  const current = JSON.parse(readFileSync("package-lock.json", "utf8")) as typeof old;
  for (const [key, value] of Object.entries(old.packages))
    expect(current.packages[key]).toEqual(value);
  expect(Object.keys(current.packages).filter((k) => !(k in old.packages))).toEqual([
    "node_modules/@ate/mose-attention",
    "packages/mose-attention",
  ]);
});
