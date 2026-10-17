import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fingerprint } from "@ate/mose-scanner";
const baseline = "c93bd4ef1100b33641d9e57d725e664ca711fa49";
const args = (base: string) => ["diff", base, "--", "packages", ":(exclude)packages/mose-scanner"];
const owners = readdirSync("packages", { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "mose-scanner")
  .map((d) => d.name)
  .sort();
it("all eighteen accepted owners including MOSE remain byte-identical", () => {
  expect(owners).toHaveLength(18);
  expect(execFileSync("git", args(baseline), { encoding: "utf8" })).toBe("");
});
for (const owner of [...owners, "mose-scanner"])
  it(`scanner actual Git boundary ${owner}`, () => {
    const root = mkdtempSync(join(tmpdir(), "scanner-guard-")),
      git = (...v: string[]) => execFileSync("git", v, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.name", "Scanner guard");
    git("config", "user.email", "guard@example.invalid");
    writeFileSync(join(root, "baseline"), "accepted");
    git("add", ".");
    git("commit", "-qm", "Synthetic owner baseline");
    const base = git("rev-parse", "HEAD").trim();
    mkdirSync(join(root, "packages", owner, "src"), { recursive: true });
    writeFileSync(join(root, "packages", owner, "src", "owner.ts"), "UNAUTHORIZED CHANGE\n");
    git("add", ".");
    expect(git(...args(base)) !== "").toBe(owner !== "mose-scanner");
    if (owner === "mose-scanner")
      expect(git("diff", base, "--", "packages/mose-scanner")).toContain("UNAUTHORIZED CHANGE");
  });
it("scanner source integrity has an explicit implementation review identity", () => {
  const files = readdirSync("packages/mose-scanner/src")
    .filter((f) => f.endsWith(".ts"))
    .sort();
  const actual = fingerprint(
    files.map((f) => [f, readFileSync(join("packages/mose-scanner/src", f), "utf8")]),
  );
  expect(actual).toBe("sha256:6c9e634eb8644adc7daff0358a831df6d1790cf5b5238b57f3e8fb0fc90753bc");
});
it("scanner authority has no network, financial actions, randomness or private upstream imports", () => {
  const src = readdirSync("packages/mose-scanner/src")
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(join("packages/mose-scanner/src", f), "utf8"))
    .join("\n");
  for (const pattern of [
    /Date\.now\(/,
    /Math\.random\(/,
    /\bfetch\(/,
    /node:(?:http|https|net|tls|child_process)/,
    /@ate\/[^"']+\/src\//,
    /\b(?:placeOrder|sendOrder|executeTrade)\s*\(/,
  ])
    expect(src).not.toMatch(pattern);
});
it("P25 governance and capability declarations remain unchanged", () => {
  for (const file of [
    "docs/development/prompt-25-conditional-acceptance.md",
    "config/capabilities.json",
  ]) {
    expect(readFileSync(file, "utf8")).toBe(
      execFileSync("git", ["show", baseline + ":" + file], { encoding: "utf8" }),
    );
  }
});
