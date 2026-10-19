import { it, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const baseline = "6307f53d4febe2bd731e00d73d429546fc29d5ee";
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
  "runtime",
  "time",
];
const sources = [
  "packages/research-insight-contracts/src/configuration.ts",
  "packages/research-insight-contracts/src/diagnostics.ts",
  "packages/research-insight-contracts/src/evidence.ts",
  "packages/research-insight-contracts/src/facts.ts",
  "packages/research-insight-contracts/src/improvements.ts",
  "packages/research-insight-contracts/src/index.ts",
  "packages/research-insight-contracts/src/knowledge.ts",
  "packages/research-insight-contracts/src/observations.ts",
  "packages/research-insight-contracts/src/reporting.ts",
  "packages/research-insight-contracts/src/resource-profile.ts",
  "packages/research-insight-contracts/src/validation.ts",
  "packages/research-insights/src/catalogue.ts",
  "packages/research-insights/src/configuration-guide.ts",
  "packages/research-insights/src/glossary.ts",
  "packages/research-insights/src/index.ts",
  "packages/research-insights/src/search.ts",
  "packages/research-insights/src/serialization.ts",
  "packages/research-insights/src/source-manifest.ts",
  "packages/research-insights/src/status-overlay.ts",
  "packages/research-insights/src/traceability.ts",
];
const expected = "78994d5891d06120b10e3821f16b46e080f849505f47f462396af379b74d45cd";
const hash = (root: string) =>
  createHash("sha256")
    .update(JSON.stringify(sources.map((p) => [p, readFileSync(join(root, p), "utf8")])))
    .digest("hex");
it("all20acceptedsourceownersunchanged", () => {
  expect(owners).toHaveLength(20);
  for (const owner of owners)
    expect(
      execFileSync("git", ["diff", baseline, "--", "packages/" + owner], {
        encoding: "utf8",
      }),
    ).toBe("");
});
for (const owner of owners)
  it(`independent mutation detects accepted ${owner}`, () => {
    const root = mkdtempSync(join(tmpdir(), "insights-owner-")),
      git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.name", "Offline boundary control");
    git("config", "user.email", "control@example.invalid");
    writeFileSync(join(root, "baseline"), "synthetic");
    git("add", ".");
    git("commit", "-qm", "Synthetic control only");
    const base = git("rev-parse", "HEAD").trim();
    const file = join(root, "packages", owner, "src", "owner.ts");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "UNAUTHORIZED SOURCE CHANGE\n");
    git("add", ".");
    expect(git("diff", base, "--", ...owners.map((o) => "packages/" + o))).toContain(
      "UNAUTHORIZED SOURCE CHANGE",
    );
  });
it("exactnewsourcehashprotected", () => expect(hash(".")).toBe(expected));
for (const source of sources)
  it(`new source mutation detected ${source}`, () => {
    const root = mkdtempSync(join(tmpdir(), "insights-source-"));
    for (const p of sources) {
      const path = join(root, p);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, readFileSync(p));
    }
    writeFileSync(
      join(root, source),
      readFileSync(source, "utf8") + "\n// Unauthorized isolated mutation\n",
    );
    expect(hash(root)).not.toBe(expected);
  });
it("no extra new TSsource", () => {
  const actual = ["research-insight-contracts", "research-insights"]
    .flatMap((n) =>
      readdirSync("packages/" + n + "/src")
        .filter((f) => f.endsWith(".ts"))
        .map((f) => "packages/" + n + "/src/" + f),
    )
    .sort();
  expect(actual).toEqual(sources);
});
it("no forbidden capability or private owner import", () => {
  const source = sources.map((p) => readFileSync(p, "utf8")).join("\n");
  for (const p of [
    /Date\.now\(/,
    /Math\.random\(/,
    /\bfetch\(/,
    /node:(?:fs|http|https|net|tls|child_process)/,
    /@ate\/[^"']+\/src\//,
    /\b(?:placeOrder|sendOrder|executeTrade)\s*\(/,
  ])
    expect(source).not.toMatch(p);
});
it("accepted root/governance/capabilities bytepreserved", () => {
  for (const p of [
    "package.json",
    "config/capabilities.json",
    "docs/development/prompt-ledger.md",
    "docs/development/prompt-27-conditional-acceptance.md",
  ])
    if (p === "docs/development/prompt-ledger.md") {
      const historical = execFileSync("git", ["show", baseline + ":" + p]);
      expect(readFileSync(p).subarray(0, historical.length)).toEqual(historical);
      verifyFoundationGovernance();
    } else expect(readFileSync(p)).toEqual(execFileSync("git", ["show", baseline + ":" + p]));
});
it("onlyfourworkspacekeysandoldentriesexact", () => {
  const old = JSON.parse(
    execFileSync("git", ["show", baseline + ":package-lock.json"], {
      encoding: "utf8",
    }),
  ) as { packages: Record<string, unknown> };
  const current = JSON.parse(
    execFileSync("git", ["show", "fe587fb12d9eefe41e4d2234b9d7962fb323bab9:package-lock.json"], {
      encoding: "utf8",
    }),
  ) as typeof old;
  for (const [k, v] of Object.entries(old.packages)) expect(current.packages[k]).toEqual(v);
  expect(Object.keys(current.packages).filter((k) => !(k in old.packages))).toEqual([
    "node_modules/@ate/research-insight-contracts",
    "node_modules/@ate/research-insights",
    "node_modules/@ate/research-reporting",
    "packages/research-insight-contracts",
    "packages/research-insights",
    "packages/research-reporting",
  ]);
  verifyWorkspaceLock();
});
it("all49qualificationrowsand12riskrestrictionsretained", () => {
  const data = JSON.parse(readFileSync("docs/knowledge/qualifications.json", "utf8")) as {
    preservationRows: { id: string }[];
    designRisks: string;
  };
  expect(data.preservationRows).toHaveLength(49);
  for (let i = 1; i <= 12; i++)
    expect(data.designRisks).toContain("B-R" + String(i).padStart(2, "0"));
});

const foundationGovernance = "538c2d564b9ad6df1d1b1d50016e5e75f89cb6c8";
const foundationRecord = "docs/development/p1-p27-insights-foundation-conditional-acceptance.md";
const verifyFoundationGovernance = () => {
  expect(
    execFileSync("git", ["rev-parse", foundationGovernance + "^"], {
      encoding: "utf8",
    }).trim(),
  ).toBe("216f26d10eea057b62d14ec009d4c56d6f27993b");
  expect(
    execFileSync(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", foundationGovernance],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .sort(),
  ).toEqual([foundationRecord, "docs/development/prompt-ledger.md"].sort());
  for (const path of [foundationRecord, "docs/development/prompt-ledger.md"]) {
    const approved = execFileSync("git", ["show", foundationGovernance + ":" + path]);
    if (path === "docs/development/prompt-ledger.md") {
      expect(readFileSync(path).subarray(0, approved.length)).toEqual(approved);
      verifyReportingGovernance();
    } else expect(readFileSync(path)).toEqual(approved);
  }
};

const reportingGovernance = "7c6445e78b9e8c2e817e22099baab15846292ca5";
const reportingRecord = "docs/development/p1-p27-reporting-conditional-acceptance.md";
const verifyReportingGovernance = () => {
  expect(
    execFileSync("git", ["rev-parse", reportingGovernance + "^"], {
      encoding: "utf8",
    }).trim(),
  ).toBe("e651349ede0ab6b3babd533e95c157052ca67cfa");
  expect(
    execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", reportingGovernance], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .sort(),
  ).toEqual([reportingRecord, "docs/development/prompt-ledger.md"].sort());
  const ledger = "docs/development/prompt-ledger.md",
    historical = execFileSync("git", [
      "show",
      "e651349ede0ab6b3babd533e95c157052ca67cfa:" + ledger,
    ]),
    approved = execFileSync("git", ["show", reportingGovernance + ":" + ledger]);
  expect(approved.subarray(0, historical.length)).toEqual(historical);
  expect(approved.length).toBeGreaterThan(historical.length);
  for (const path of [reportingRecord, ledger])
    expect(readFileSync(path)).toEqual(
      execFileSync("git", ["show", reportingGovernance + ":" + path]),
    );
};

const verifyWorkspaceLock = () => {
  const accepted = JSON.parse(
    execFileSync("git", ["show", "fe587fb12d9eefe41e4d2234b9d7962fb323bab9:package-lock.json"], {
      encoding: "utf8",
    }),
  ) as { packages: Record<string, unknown>; [key: string]: unknown };
  const proposed = JSON.parse(readFileSync("package-lock.json", "utf8")) as typeof accepted;
  for (const [key, value] of Object.entries(accepted))
    if (key !== "packages") expect(proposed[key]).toEqual(value);
  for (const [key, value] of Object.entries(accepted.packages))
    expect(proposed.packages[key]).toEqual(value);
  expect(Object.keys(proposed.packages).filter((key) => !(key in accepted.packages))).toEqual([
    "node_modules/@ate/research-workspace",
    "packages/research-workspace",
  ]);
  expect(createHash("sha256").update(readFileSync("package-lock.json")).digest("hex")).toBe(
    "8467e34ca12656c67eb7ad38219b5c931c19bb8843ace056b9ad830dda084ce0",
  );
};
