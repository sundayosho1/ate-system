import { it, expect } from "vitest";
import { strictEqual } from "node:assert";
import { createHash } from "node:crypto";
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
  ":(exclude)packages/research-insight-contracts",
  ":(exclude)packages/research-insights",
  ":(exclude)packages/research-reporting",
  ":(exclude)packages/research-workspace",
  ":(exclude)packages/mose-opportunities",
];
const owners = readdirSync("packages", { withFileTypes: true })
  .filter(
    (d) =>
      d.isDirectory() &&
      d.name !== "mose-attention" &&
      d.name !== "research-insight-contracts" &&
      d.name !== "research-insights" &&
      d.name !== "research-reporting" &&
      d.name !== "research-workspace" &&
      d.name !== "mose-opportunities",
  )
  .map((d) => d.name)
  .sort();
const sourceRoot = "packages/mose-attention/src";
const sourceFiles = readdirSync(sourceRoot)
  .filter((n) => n.endsWith(".ts"))
  .sort();
const expected = "sha256:61342e5cb2284bd5724c881e22edf6a70a3af3855c2325814973c5cf5fa41cab";
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
    if (p === "docs/development/prompt-ledger.md") {
      const approved = "f2dcad7a52d059e91b092ad52ef3098e3ad75e24",
        historical = execFileSync("git", ["show", baseline + ":" + p]),
        authorized = execFileSync("git", ["show", approved + ":" + p]),
        current = readFileSync(p),
        record = "docs/development/prompt-27-conditional-acceptance.md";
      expect(authorized.subarray(0, historical.length)).toEqual(historical);
      expect(authorized.length).toBeGreaterThan(historical.length);
      expect(current.subarray(0, historical.length)).toEqual(historical);
      expect(current.subarray(historical.length, authorized.length)).toEqual(
        authorized.subarray(historical.length),
      );
      verifyFoundationGovernance();
      expect(readFileSync(record)).toEqual(execFileSync("git", ["show", approved + ":" + record]));
    } else {
      expect(readFileSync(p, "utf8")).toBe(
        execFileSync("git", ["show", baseline + ":" + p], { encoding: "utf8" }),
      );
    }
  }
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
  for (const [key, value] of Object.entries(old.packages))
    expect(current.packages[key]).toEqual(value);
  expect(Object.keys(current.packages).filter((k) => !(k in old.packages))).toEqual([
    "node_modules/@ate/mose-attention",
    "node_modules/@ate/research-insight-contracts",
    "node_modules/@ate/research-insights",
    "node_modules/@ate/research-reporting",
    "packages/mose-attention",
    "packages/research-insight-contracts",
    "packages/research-insights",
    "packages/research-reporting",
  ]);
  verifyWorkspaceLock();
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
