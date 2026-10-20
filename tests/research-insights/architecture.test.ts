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
  for (const path of [reportingRecord, ledger]) {
    const accepted = execFileSync("git", ["show", reportingGovernance + ":" + path]);
    if (path === ledger) {
      expect(readFileSync(path).subarray(0, accepted.length)).toEqual(accepted);
      verifyWorkspaceGovernance();
    } else expect(readFileSync(path)).toEqual(accepted);
  }
};

const verifyWorkspaceLock = () => {
  const accepted = JSON.parse(
    execFileSync("git", ["show", "fe587fb12d9eefe41e4d2234b9d7962fb323bab9:package-lock.json"], {
      encoding: "utf8",
    }),
  ) as { packages: Record<string, unknown>; [key: string]: unknown };
  const proposed = JSON.parse(
    execFileSync("git", ["show", opportunityBaseline + ":package-lock.json"], { encoding: "utf8" }),
  ) as typeof accepted;
  for (const [key, value] of Object.entries(accepted))
    if (key !== "packages") expect(proposed[key]).toEqual(value);
  for (const [key, value] of Object.entries(accepted.packages))
    expect(proposed.packages[key]).toEqual(value);
  expect(Object.keys(proposed.packages).filter((key) => !(key in accepted.packages))).toEqual([
    "node_modules/@ate/research-workspace",
    "packages/research-workspace",
  ]);
  expect(
    createHash("sha256")
      .update(execFileSync("git", ["show", opportunityBaseline + ":package-lock.json"]))
      .digest("hex"),
  ).toBe("8467e34ca12656c67eb7ad38219b5c931c19bb8843ace056b9ad830dda084ce0");
};

const workspaceCandidate = "83ba497a30a1816403b1931b8701bfe00739fe2e";
const workspaceGovernance = "aae07f1ae1b8bea634f057990ec59dea12fd3f5c";
const workspaceRecord = "docs/development/p1-p27-research-workspace-conditional-acceptance.md";
const verifyWorkspaceGovernance = () => {
  expect(
    execFileSync("git", ["rev-parse", workspaceCandidate + "^"], { encoding: "utf8" }).trim(),
  ).toBe("09201f52a9d454ef142d2ca346a3a9dfc2fad66e");
  expect(
    execFileSync("git", ["rev-parse", workspaceGovernance + "^"], { encoding: "utf8" }).trim(),
  ).toBe(workspaceCandidate);
  execFileSync("git", ["merge-base", "--is-ancestor", workspaceGovernance, "HEAD"]);
  expect(
    execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", workspaceGovernance], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .sort(),
  ).toEqual([workspaceRecord, "docs/development/prompt-ledger.md"].sort());
  const ledger = "docs/development/prompt-ledger.md";
  const historical = execFileSync("git", ["show", workspaceCandidate + ":" + ledger]);
  const approved = execFileSync("git", ["show", workspaceGovernance + ":" + ledger]);
  expect(approved.subarray(0, historical.length)).toEqual(historical);
  expect(approved.length).toBeGreaterThan(historical.length);
  for (const path of [workspaceRecord, ledger])
    expect(readFileSync(path)).toEqual(
      execFileSync("git", ["show", workspaceGovernance + ":" + path]),
    );
  const compatibility = [
    "tests/mose-attention/architecture.test.ts",
    "tests/research-insights/architecture.test.ts",
    "tests/research-reporting/architecture.test.ts",
    "tests/research-workspace/architecture.test.ts",
  ];
  const tracked = execFileSync(
    "git",
    ["diff", "--name-only", workspaceGovernance, opportunityBaseline],
    {
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const path of tracked) expect(compatibility).toContain(path);
  for (const path of untracked)
    expect([
      ...opportunityPaths,
      "tests/mose-opportunities/query-resource-accounting.test.ts",
    ]).toContain(path);
  expect(new Set(tracked).size).toBeLessThanOrEqual(compatibility.length);
  verifyOpportunityEnvelope();
};

// P28 proposal: pin historical compatibility separately from new exact paths.
const opportunityBaseline = "610193e2479c28d0bd32eebff2bd16f550b0643b";
const opportunityPaths = [
  "packages/mose-opportunities/src/index.ts",
  "packages/mose-opportunities/src/contracts.ts",
  "packages/mose-opportunities/src/validation.ts",
  "packages/mose-opportunities/src/canonical.ts",
  "packages/mose-opportunities/src/identity.ts",
  "packages/mose-opportunities/src/policy.ts",
  "packages/mose-opportunities/src/evidence.ts",
  "packages/mose-opportunities/src/predicates.ts",
  "packages/mose-opportunities/src/transitions.ts",
  "packages/mose-opportunities/src/time-policy.ts",
  "packages/mose-opportunities/src/journal.ts",
  "packages/mose-opportunities/src/memory-repository.ts",
  "packages/mose-opportunities/src/filesystem-repository.ts",
  "packages/mose-opportunities/src/recovery.ts",
  "packages/mose-opportunities/src/runtime.ts",
  "packages/mose-opportunities/src/query.ts",
  "packages/mose-opportunities/src/diagnostics.ts",
  "packages/mose-opportunities/src/handover.ts",
  "packages/mose-opportunities/package.json",
  "packages/mose-opportunities/tsconfig.json",
  "packages/mose-opportunities/README.md",
  "tests/mose-opportunities/contracts.test.ts",
  "tests/mose-opportunities/identity.test.ts",
  "tests/mose-opportunities/transition-matrix.test.ts",
  "tests/mose-opportunities/evidence.test.ts",
  "tests/mose-opportunities/temporal.test.ts",
  "tests/mose-opportunities/predicates.test.ts",
  "tests/mose-opportunities/journal-recovery.test.ts",
  "tests/mose-opportunities/resource-policy.test.ts",
  "tests/mose-opportunities/runtime-lifecycle.test.ts",
  "tests/mose-opportunities/handover-help.test.ts",
  "tests/mose-opportunities/integration-journeys.test.ts",
  "tests/mose-opportunities/architecture.test.ts",
  "tests/mose-opportunities/evidence-canonicalization.test.ts",
  "docs/architecture/mose-opportunities.md",
  "docs/help/mose-opportunities.md",
  "docs/help/mose-opportunities-administration.md",
  "docs/help/mose-opportunities-developer.md",
  "docs/help/mose-opportunities-glossary.md",
  "package-lock.json",
];
const opportunityTests = [
  "tests/instrument-specifications/temporal-architecture.test.ts",
  "tests/instrument-eligibility/architecture-guard-remediation.test.ts",
  "tests/mose-core/architecture.test.ts",
  "tests/mose-scanner/architecture.test.ts",
  "tests/mose-attention/architecture.test.ts",
  "tests/research-insights/architecture.test.ts",
  "tests/research-reporting/architecture.test.ts",
  "tests/research-workspace/architecture.test.ts",
];
// BEGIN OPPORTUNITY COMPATIBILITY HASHES
const opportunityCompatibilityHashes: Record<string, string> = {
  "tests/instrument-specifications/temporal-architecture.test.ts":
    "2123ea461970b4a0796947055d19c456f0c76953280f556d19be0a634b48793a",
  "tests/instrument-eligibility/architecture-guard-remediation.test.ts":
    "0426a934b3bf12013987d37b46888a82913aa7f3c61688e46338bc173480fafe",
  "tests/mose-core/architecture.test.ts":
    "f0ebaf7595db4b80cf28c260f8f983243c6d596240202b43b18d8eaf7c7b0842",
  "tests/mose-scanner/architecture.test.ts":
    "6249bce635389090dd7d78d960319ac7702cc3082fe9195d0511e2050435d93d",
  "tests/mose-attention/architecture.test.ts":
    "8812df5c4b33e2779fae42f37f378aefac463295761655cae124a82b9a4b1409",
  "tests/research-insights/architecture.test.ts":
    "93c323ba270db1f08e7dad48c4085685ac0019b6e46ee2001b6e1d30a59dec53",
  "tests/research-reporting/architecture.test.ts":
    "eca3c65abbcb38430bb4c39a8b5b95e3fde6b3acc19c29d892eab0b284c703c9",
  "tests/research-workspace/architecture.test.ts":
    "ee847a13e521230ab3891a36a114933d1c047bea03bd886c18db79864de98690",
};
// END OPPORTUNITY COMPATIBILITY HASHES
const opportunityImplementation = "6103ca13670d6a75f85b03c24bec567f86a5e467";
const remediationPaths = [
  "packages/mose-opportunities/src/evidence.ts",
  "packages/mose-opportunities/src/contracts.ts",
  "packages/mose-opportunities/src/journal.ts",
  "packages/mose-opportunities/src/recovery.ts",
  "packages/mose-opportunities/src/runtime.ts",
  "packages/mose-opportunities/src/filesystem-repository.ts",
  "tests/mose-opportunities/architecture.test.ts",
  "tests/mose-opportunities/evidence-canonicalization.test.ts",
  "docs/help/mose-opportunities-developer.md",
  "tests/mose-attention/architecture.test.ts",
  "tests/research-insights/architecture.test.ts",
  "tests/research-reporting/architecture.test.ts",
  "tests/research-workspace/architecture.test.ts",
];
const queryRemediationBaseline = "a72f7b98e045d05b4164609475b56c8cde9ee0ff";
const queryRemediationPaths = [
  "packages/mose-opportunities/src/query.ts",
  "tests/mose-opportunities/query-resource-accounting.test.ts",
  "docs/help/mose-opportunities-developer.md",
  "tests/mose-opportunities/architecture.test.ts",
  "tests/mose-attention/architecture.test.ts",
  "tests/research-insights/architecture.test.ts",
  "tests/research-reporting/architecture.test.ts",
  "tests/research-workspace/architecture.test.ts",
];
const verifyOpportunityEnvelope = () => {
  execFileSync("git", ["merge-base", "--is-ancestor", opportunityImplementation, "HEAD"]);
  const historical = execFileSync(
    "git",
    ["diff", "--name-only", opportunityBaseline, opportunityImplementation],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  expect(historical.sort()).toEqual(
    [
      ...opportunityPaths.filter(
        (p) => p !== "tests/mose-opportunities/evidence-canonicalization.test.ts",
      ),
      ...opportunityTests,
    ].sort(),
  );
  expect(historical).toHaveLength(47);
  const remediation = execFileSync(
    "git",
    ["diff", "--name-only", opportunityImplementation, queryRemediationBaseline],
    {
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const newPaths = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  // Authenticate the completed 015E envelope independently from the proposed query correction.
  expect(remediation.sort()).toEqual([...remediationPaths].sort());
  expect(remediation).toHaveLength(13);
  execFileSync("git", ["merge-base", "--is-ancestor", queryRemediationBaseline, "HEAD"]);
  const queryChanges = execFileSync("git", ["diff", "--name-only", queryRemediationBaseline], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  expect([...new Set([...queryChanges, ...newPaths])].sort()).toEqual(
    [...queryRemediationPaths].sort(),
  );
  for (const path of queryRemediationPaths)
    expect(readFileSync(path).byteLength).toBeGreaterThan(0);
  execFileSync("git", ["merge-base", "--is-ancestor", opportunityBaseline, "HEAD"]);
  const tracked = execFileSync(
    "git",
    ["diff", "--name-only", opportunityBaseline, queryRemediationBaseline],
    {
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  const allowedPaths = [...opportunityPaths, ...opportunityTests];
  for (const path of tracked) expect(allowedPaths).toContain(path);
  expect(new Set(tracked).size).toBe(48);
  for (const path of untracked) expect(queryRemediationPaths).toContain(path);
  for (const path of opportunityPaths) expect(readFileSync(path).byteLength).toBeGreaterThan(0);
  expect(readdirSync("packages/mose-opportunities/src").sort()).toEqual(
    opportunityPaths
      .filter((p) => p.startsWith("packages/mose-opportunities/src/"))
      .map((p) => p.split("/").at(-1))
      .sort(),
  );
  expect(Object.keys(opportunityCompatibilityHashes).sort()).toEqual([...opportunityTests].sort());
  for (const [path, digest] of Object.entries(opportunityCompatibilityHashes)) {
    const bytes = readFileSync(path, "utf8").replace(
      /\/\/ BEGIN OPPORTUNITY COMPATIBILITY HASHES[\s\S]*?\/\/ END OPPORTUNITY COMPATIBILITY HASHES/u,
      "OPPORTUNITY_COMPATIBILITY_HASHES",
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);
  }
  for (const [path, digest] of Object.entries({
    "packages/mose-opportunities/package.json":
      "524699d77b647418f3fc47e2c7ab3f4dbf37286f4d3ce2cf4da6c17225946120",
    "packages/mose-opportunities/tsconfig.json":
      "c4ef5588f4e0e442aa72db545d02653e9ac2144621d081a486ee64879a5f5dcd",
    "package-lock.json": "d384695eee21a2761673da521799aae752dcaf4374def46f4e2737aa9b7b73f4",
  }))
    expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(digest);
  const oldLock = JSON.parse(
    execFileSync("git", ["show", opportunityBaseline + ":package-lock.json"], { encoding: "utf8" }),
  ) as { packages: Record<string, unknown>; [key: string]: unknown };
  const newLock = JSON.parse(readFileSync("package-lock.json", "utf8")) as typeof oldLock;
  for (const [key, value] of Object.entries(oldLock))
    if (key !== "packages") expect(newLock[key]).toEqual(value);
  for (const [key, value] of Object.entries(oldLock.packages))
    expect(newLock.packages[key]).toEqual(value);
  expect(Object.keys(newLock.packages).filter((key) => !(key in oldLock.packages))).toEqual([
    "node_modules/@ate/mose-opportunities",
    "packages/mose-opportunities",
  ]);
};
