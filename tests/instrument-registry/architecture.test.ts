import { it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const base = join(import.meta.dirname, "../../packages/instrument-registry/src");
it("instrument package consumes public owners without importing private implementation paths", () => {
  for (const name of readdirSync(base)) {
    const source = readFileSync(join(base, name), "utf8");
    expect(source).not.toMatch(/from\s+["']@ate\/[^"']+\//);
    expect(source).not.toMatch(/\.\.\/\.\.\/[^"']+\/src\//);
  }
});
it("registry cannot use network discovery host-time or random identity authority", () => {
  for (const name of readdirSync(base)) {
    const source = readFileSync(join(base, name), "utf8");
    expect(source).not.toMatch(
      /Date\.now|Math\.random|randomUUID|fetch\(|node:https|node:http|node:net/,
    );
  }
});
it("content hashes reuse accepted configuration authority", () => {
  for (const name of readdirSync(base)) {
    const source = readFileSync(join(base, name), "utf8");
    expect(source).not.toMatch(/createHash|node:crypto/);
  }
  expect(readFileSync(join(base, "normalization.ts"), "utf8")).toContain("@ate/configuration");
});
it("integration is an explicit reference rather than an owner mutation", () => {
  const source = readFileSync(join(base, "integration.ts"), "utf8");
  expect(source).not.toMatch(/writeFile|\.commit\(|\.revise\(|\.register\(/);
  expect(source).toContain("REVISION_NOT_IN_SNAPSHOT");
});
