import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
const inherited = join(
  import.meta.dirname,
  "../instrument-specifications/temporal-architecture.test.ts",
);
function argumentsFromActualGuard() {
  const source = readFileSync(inherited, "utf8");
  const block = source.match(/\[\s*"diff",([\s\S]*?)\],/);
  if (!block) throw Error("GUARD_ARGUMENTS_NOT_FOUND");
  return ["diff", ...[...block[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!)];
}
const acceptedOwners = (base: string) => [
  "diff",
  base,
  "--",
  "packages",
  ":(exclude)packages/instrument-eligibility",
  ":(exclude)packages/mose-core",
  ":(exclude)packages/mose-scanner",
  ":(exclude)packages/mose-attention",
  ":(exclude)packages/research-insight-contracts",
  ":(exclude)packages/research-insights",
  ":(exclude)packages/research-reporting",
  ":(exclude)packages/research-workspace",
  ":(exclude)packages/mose-opportunities",
];
it("A24-M02 all sixteen accepted upstream owners, including P23, retain exact bytes", () => {
  expect(
    execFileSync("git", acceptedOwners("ca1a6d93e7a949c27e6b19edd020ed03718ed55c"), {
      encoding: "utf8",
    }),
  ).toBe("");
});
it("A24-M02 authentic current tree passes actual inherited Git guard", () => {
  expect(execFileSync("git", argumentsFromActualGuard(), { encoding: "utf8" })).toBe("");
});
it("A24-M02 inherited guard permits downstream addition and detects synthetic upstream mutation", () => {
  const dir = mkdtempSync(join(tmpdir(), "ate-eligibility-guard-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const put = (path: string, value: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), value);
  };
  git("init", "-q");
  git("config", "user.name", "Synthetic Guard Control");
  git("config", "user.email", "guard@example.invalid");
  put("packages/time/src/owner.ts", "accepted clock authority\n");
  put("packages/domain/src/owner.ts", "accepted contracts\n");
  git("add", ".");
  git("commit", "-qm", "Synthetic accepted owners");
  const base = git("rev-parse", "HEAD").trim();
  const args = argumentsFromActualGuard();
  args[1] = base;
  put("packages/instrument-eligibility/src/owned.ts", "authorized downstream eligibility\n");
  git("add", ".");
  expect(git(...args)).toBe("");
  for (const owner of ["time", "domain"]) {
    put(`packages/${owner}/src/owner.ts`, "UNAUTHORIZED OWNER CHANGE\n");
    expect(git(...args)).toContain(`packages/${owner}/src/owner.ts`);
  }
  put("packages/instrument-specifications/src/owner.ts", "UNAUTHORIZED P23 CHANGE\n");
  git("add", ".");
  expect(git(...acceptedOwners(base))).toContain("packages/instrument-specifications/src/owner.ts");
  // Historical P23 expectations and all other architecture assertions remain in place.
  const source = readFileSync(inherited, "utf8");
  expect(source).toContain("6aba5a60d398faa6bb531faabd4a3bf699f873fd");
  expect(source).toContain("unchanged upstream packages retain their exact baseline bytes");
});
