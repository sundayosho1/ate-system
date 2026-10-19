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
const expected = "47f57ac311cf500865c8af2535e50f19053484fd12f9b98e97287f394b621718";
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
  const implementation = "09201f52a9d454ef142d2ca346a3a9dfc2fad66e";
  expect(
    execFileSync("git", ["rev-parse", implementation + "^"], {
      encoding: "utf8",
    }).trim(),
  ).toBe(baseline);
  execFileSync("git", ["merge-base", "--is-ancestor", implementation, "HEAD"]);
  const historical = execFileSync("git", ["diff", "--name-only", baseline, implementation], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  expect(historical.sort()).toEqual([...allowed].sort());
  expect(historical).toHaveLength(39);
  const remediation = [
    "docs/architecture/research-workspace.md",
    "docs/help/research-workspace.md",
    "packages/research-workspace/README.md",
    "packages/research-workspace/src/contracts.ts",
    "packages/research-workspace/src/knowledge-links.ts",
    "packages/research-workspace/src/workspace.ts",
    "tests/research-reporting/architecture.test.ts",
    "tests/research-workspace/architecture.test.ts",
    "tests/research-workspace/reconstruction-integrity.test.ts",
    "tests/research-workspace/reconstruction-resource-security.test.ts",
    "tests/research-workspace/relationships-contextual-links.test.ts",
    "tests/research-workspace/report-filter-remediation.test.ts",
  ];
  const historicalRemediation = execFileSync(
    "git",
    ["diff", "--name-only", implementation, workspaceCandidate],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  expect([...historicalRemediation].sort()).toEqual([...remediation].sort());
  expect(historicalRemediation).toHaveLength(12);
  verifyWorkspaceGovernance();
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
    if (p === "docs/development/prompt-ledger.md" || p === workspaceRecord)
      verifyWorkspaceGovernance();
    else expect(readFileSync(p)).toEqual(execFileSync("git", ["show", baseline + ":" + p]));
});
it("exact approved lock hash and219oldrecords preserved", () => {
  expect(
    createHash("sha256")
      .update(execFileSync("git", ["show", opportunityBaseline + ":package-lock.json"]))
      .digest("hex"),
  ).toBe("8467e34ca12656c67eb7ad38219b5c931c19bb8843ace056b9ad830dda084ce0");
  const old = JSON.parse(
      execFileSync("git", ["show", baseline + ":package-lock.json"], { encoding: "utf8" }),
    ) as { packages: Record<string, unknown> },
    now = JSON.parse(
      execFileSync("git", ["show", opportunityBaseline + ":package-lock.json"], {
        encoding: "utf8",
      }),
    ) as typeof old;
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
  for (const path of untracked) expect(opportunityPaths).toContain(path);
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
const opportunityCompatibilityHashes: Readonly<Record<string, string>> = {
  "tests/instrument-specifications/temporal-architecture.test.ts":
    "2123ea461970b4a0796947055d19c456f0c76953280f556d19be0a634b48793a",
  "tests/instrument-eligibility/architecture-guard-remediation.test.ts":
    "0426a934b3bf12013987d37b46888a82913aa7f3c61688e46338bc173480fafe",
  "tests/mose-core/architecture.test.ts":
    "f0ebaf7595db4b80cf28c260f8f983243c6d596240202b43b18d8eaf7c7b0842",
  "tests/mose-scanner/architecture.test.ts":
    "6249bce635389090dd7d78d960319ac7702cc3082fe9195d0511e2050435d93d",
  "tests/mose-attention/architecture.test.ts":
    "102786ed69819ad262a62bc344bd4a310d1409959c9c6285c1047d46b6e54d49",
  "tests/research-insights/architecture.test.ts":
    "1553f7c2245214ac9db50349dd34295b5fd79865f40fbecfed42df498566ad08",
  "tests/research-reporting/architecture.test.ts":
    "46e29af67d220cdf19441e01d272ea64472a04e1ab81c5fe371bbc7ee929f721",
  "tests/research-workspace/architecture.test.ts":
    "736cd5c7311a2d564214e063b4bfb20c587423ec3c9b0431bf10640933a6d70c",
};
// END OPPORTUNITY COMPATIBILITY HASHES
const verifyOpportunityEnvelope = () => {
  execFileSync("git", ["merge-base", "--is-ancestor", opportunityBaseline, "HEAD"]);
  const tracked = execFileSync("git", ["diff", "--name-only", opportunityBaseline], {
    encoding: "utf8",
  })
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
  for (const path of [...tracked, ...untracked]) expect(allowedPaths).toContain(path);
  expect(new Set([...tracked, ...untracked]).size).toBeLessThanOrEqual(47);
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
