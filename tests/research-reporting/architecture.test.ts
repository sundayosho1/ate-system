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
const expected = "3dc66866bca68ac28531fb9b889a5f4335f6b31d939f0108b7d6be0b732452eb";
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
    if (p === "docs/development/prompt-ledger.md") verifyReportingGovernance();
    else expect(readFileSync(p)).toEqual(execFileSync("git", ["show", baseline + ":" + p]));
});
it("whole lock top-level and all old entries exact with only2new workspace records", () => {
  const old = JSON.parse(
      execFileSync("git", ["show", baseline + ":package-lock.json"], {
        encoding: "utf8",
      }),
    ) as { packages: Record<string, unknown>; [key: string]: unknown },
    current = JSON.parse(
      execFileSync("git", ["show", "fe587fb12d9eefe41e4d2234b9d7962fb323bab9:package-lock.json"], {
        encoding: "utf8",
      }),
    ) as typeof old;
  for (const [k, v] of Object.entries(old)) if (k !== "packages") expect(current[k]).toEqual(v);
  for (const [k, v] of Object.entries(old.packages)) expect(current.packages[k]).toEqual(v);
  expect(Object.keys(current.packages).filter((k) => !(k in old.packages))).toEqual([
    "node_modules/@ate/research-reporting",
    "packages/research-reporting",
  ]);
  expect(
    createHash("sha256")
      .update(
        execFileSync("git", ["show", "fe587fb12d9eefe41e4d2234b9d7962fb323bab9:package-lock.json"]),
      )
      .digest("hex"),
  ).toBe("60f773941fe563685ac140d1a8e26953827ab2c60cef271f22df4c709c42612b");
  verifyWorkspaceLock();
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
  const implementation = "fdb9326ad158642e48ce3c3fedeba663e31e364e";
  expect(
    execFileSync("git", ["rev-parse", implementation + "^"], {
      encoding: "utf8",
    }).trim(),
  ).toBe(baseline);
  const original = execFileSync("git", ["diff", "--name-only", baseline, implementation], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const path of original) expect(allowed).toContain(path);
  expect(new Set(original).size).toBe(37);
  const remediationAllowed = [
    "docs/architecture/research-reporting.md",
    "docs/help/research-reporting.md",
    "docs/knowledge/reporting-contract-guide.md",
    "packages/research-reporting/README.md",
    "packages/research-reporting/src/budgets.ts",
    "packages/research-reporting/src/charts.ts",
    "packages/research-reporting/src/evidence.ts",
    "packages/research-reporting/src/export.ts",
    "packages/research-reporting/src/policy.ts",
    "packages/research-reporting/src/projection.ts",
    "packages/research-reporting/src/report.ts",
    "packages/research-reporting/src/validation.ts",
    "tests/research-reporting/architecture.test.ts",
    "tests/research-reporting/cross-finding-remediation.test.ts",
    "tests/research-reporting/immutable-evidence-remediation.test.ts",
    "tests/research-reporting/readback-policy-remediation.test.ts",
    "tests/research-reporting/resource-policy-remediation.test.ts",
  ];
  const previousRemediation = "ca7495fdc42e1da260617563d0aa90d6935e91a1";
  expect(
    execFileSync("git", ["rev-parse", previousRemediation + "^"], {
      encoding: "utf8",
    }).trim(),
  ).toBe(implementation);
  const previousPaths = execFileSync(
    "git",
    ["diff", "--name-only", implementation, previousRemediation],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  expect([...previousPaths].sort()).toEqual([...remediationAllowed].sort());
  const cumulativeAllowed = [
    "docs/architecture/research-reporting.md",
    "docs/help/research-reporting.md",
    "packages/research-reporting/src/improvements.ts",
    "packages/research-reporting/src/report.ts",
    "tests/research-reporting/architecture.test.ts",
    "tests/research-reporting/cumulative-improvement-budget.test.ts",
    "tests/research-reporting/resource-policy-remediation.test.ts",
  ];
  const candidate = "e651349ede0ab6b3babd533e95c157052ca67cfa";
  expect(
    execFileSync("git", ["rev-parse", candidate + "^"], {
      encoding: "utf8",
    }).trim(),
  ).toBe(previousRemediation);
  const cumulativePaths = execFileSync(
    "git",
    ["diff", "--name-only", previousRemediation, candidate],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  expect([...cumulativePaths].sort()).toEqual([...cumulativeAllowed].sort());
  verifyReportingGovernance();
  const compatibilityAllowed = [
    "tests/mose-attention/architecture.test.ts",
    "tests/research-insights/architecture.test.ts",
    "tests/research-reporting/architecture.test.ts",
  ];
  const tracked = execFileSync(
    "git",
    ["diff", "--name-only", reportingGovernance, "fe587fb12d9eefe41e4d2234b9d7962fb323bab9"],
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
  for (const path of untracked) expect(opportunityPaths).toContain(path);
  verifyOpportunityEnvelope();
  for (const path of tracked) expect(compatibilityAllowed).toContain(path);
  expect(new Set(tracked).size).toBeLessThanOrEqual(3);
  const workspaceAllowed = [
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
  const workspaceImplementation = "09201f52a9d454ef142d2ca346a3a9dfc2fad66e";
  expect(
    execFileSync("git", ["rev-parse", workspaceImplementation + "^"], { encoding: "utf8" }).trim(),
  ).toBe("fe587fb12d9eefe41e4d2234b9d7962fb323bab9");
  execFileSync("git", ["merge-base", "--is-ancestor", workspaceImplementation, "HEAD"]);
  const historicalWorkspacePaths = execFileSync(
    "git",
    ["diff", "--name-only", "fe587fb12d9eefe41e4d2234b9d7962fb323bab9", workspaceImplementation],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  expect(historicalWorkspacePaths.sort()).toEqual([...workspaceAllowed].sort());
  expect(historicalWorkspacePaths).toHaveLength(39);
  const workspaceRemediationAllowed = [
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
  const historicalWorkspaceRemediation = execFileSync(
    "git",
    ["diff", "--name-only", workspaceImplementation, workspaceCandidate],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  expect([...historicalWorkspaceRemediation].sort()).toEqual(
    [...workspaceRemediationAllowed].sort(),
  );
  expect(historicalWorkspaceRemediation).toHaveLength(12);
  verifyWorkspaceGovernance();
  expect(
    execFileSync(
      "git",
      [
        "diff",
        "fe587fb12d9eefe41e4d2234b9d7962fb323bab9",
        "--",
        "packages",
        ":(exclude)packages/research-workspace",
        ":(exclude)packages/mose-opportunities",
      ],
      { encoding: "utf8" },
    ),
  ).toBe("");
});

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
    "1aa3c5ebfa5b7cf5ea2b9a5312fcd3c8a9abaad9a84c02c1a5795fa0a1e8280a",
  "tests/research-insights/architecture.test.ts":
    "ba559f6fa1ffb9b746bf2be91a0d6c26d4957405e82a325656cb8ce0b4c8ba38",
  "tests/research-reporting/architecture.test.ts":
    "a5157ae9f8c14629591f7dd801597c0b996cde45af81a09c43016998d3c69122",
  "tests/research-workspace/architecture.test.ts":
    "f8785b4b57fdad544e7e7515df0c6c0d88da23ca66668aaf81ddbf22c2927009",
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
  const remediation = execFileSync("git", ["diff", "--name-only", opportunityImplementation], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  const newPaths = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const path of [...remediation, ...newPaths]) expect(remediationPaths).toContain(path);
  expect(new Set([...remediation, ...newPaths]).size).toBeLessThanOrEqual(remediationPaths.length);
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
  expect(new Set([...tracked, ...untracked]).size).toBeLessThanOrEqual(48);
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
