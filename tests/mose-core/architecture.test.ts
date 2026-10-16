import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const baseline = "2dec78d50c8ffa9ed325513306324bbc4bc81c9b";
const ownerDiff = (base: string) => [
  "diff",
  base,
  "--",
  "packages",
  ":(exclude)packages/mose-core",
];
it("all17 accepted owner packages including P24 retain exact bytes", () => {
  expect(execFileSync("git", ownerDiff(baseline), { encoding: "utf8" })).toBe("");
});
it("new runtime has no network, wall clock, randomness or upstream private import", () => {
  const source = readdirSync("packages/mose-core/src")
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(join("packages/mose-core/src", f), "utf8"))
    .join("\n");
  for (const pattern of [
    /Date\.now\(/,
    /Math\.random\(/,
    /\bfetch\(/,
    /node:(?:http|https|net|tls|child_process)/,
    /@ate\/[^"']+\/src\//,
  ])
    expect(source).not.toMatch(pattern);
});
it("accepted P24 governance document is byte-identical to baseline", () => {
  expect(readFileSync("docs/development/prompt-24-conditional-acceptance.md", "utf8")).toBe(
    execFileSync(
      "git",
      ["show", baseline + ":docs/development/prompt-24-conditional-acceptance.md"],
      { encoding: "utf8" },
    ),
  );
});
it("old ledger prefix remains unchanged and implementation acceptance is pending", () => {
  const old = execFileSync("git", ["show", baseline + ":docs/development/prompt-ledger.md"], {
      encoding: "utf8",
    }),
    now = readFileSync("docs/development/prompt-ledger.md", "utf8");
  expect(now.startsWith(old)).toBe(true);
  expect(now.slice(old.length)).toContain("Prompt 25 technical and governance acceptance: PENDING");
});
it("truth manifest reports core research implementation without future funnel authority", () => {
  const m = JSON.parse(readFileSync("config/capabilities.json", "utf8")) as {
    completed_prompt: number;
    capabilities: Record<string, boolean>;
    truth_statement: string;
  };
  expect(m.completed_prompt).toBe(25);
  expect(m.capabilities.offline_mose_core).toBe(true);
  for (const key of [
    "live_trading",
    "broker_order_submission",
    "mose_strategy_signals",
    "mose_opportunity_ranking",
    "mose_future_funnel_progression",
  ])
    expect(m.capabilities[key]).toBe(false);
  expect(m.truth_statement).toContain("Prompt 26 is not authorized");
});
it("historical P24 implementation identity remains explicit in accepted governance", () => {
  const s = readFileSync("docs/development/prompt-24-conditional-acceptance.md", "utf8");
  for (const token of [
    "9514059c28a6533e056c18ebfd10f0738edbf70f",
    "0.24.0-instrument-eligibility.1",
    "CONDITIONALLY ACCEPTED",
    "E-T01",
    "REVIEWER-PARTICIPATION",
  ])
    expect(s).toContain(token);
});
const owners = readdirSync("packages", { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "mose-core")
  .map((d) => d.name);
expect(owners).toHaveLength(17);
for (const owner of [...owners, "mose-core"])
  it(`real Git negative control protects ${owner}`, () => {
    const root = mkdtempSync(join(tmpdir(), "mose-owner-guard-")),
      git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.name", "MOSE Guard Control");
    git("config", "user.email", "guard@example.invalid");
    writeFileSync(join(root, "baseline"), "accepted");
    git("add", ".");
    git("commit", "-qm", "Synthetic accepted owner baseline");
    const base = git("rev-parse", "HEAD").trim();
    mkdirSync(join(root, "packages", owner, "src"), { recursive: true });
    writeFileSync(join(root, "packages", owner, "src", "owner.ts"), "changed owner\n");
    git("add", ".");
    const diff = git(...ownerDiff(base));
    expect(diff !== "").toBe(owner !== "mose-core");
  });
