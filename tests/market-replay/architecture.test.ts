import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { replayConfigurationDefinitions, replayConfigurationSchemas } from "@ate/configuration";
import { defaultReplayLimits } from "@ate/market-replay";
import { VirtualClock } from "@ate/time";
import { t } from "./fixtures.js";
describe("Prompt 19 authority and security regression guards", () => {
  it("reuses existing clock/canonical/aggregation owners without execution or future-prompt dependencies", () => {
    const root = join(process.cwd(), "packages/market-replay/src");
    const code = readdirSync(root)
      .filter((n) => n.endsWith(".ts"))
      .map((n) => readFileSync(join(root, n), "utf8"))
      .join("\n");
    expect(code).not.toMatch(/Date\.now\(|new Date\(\)|setTimeout\(|setInterval\(|Math\.random\(/u);
    expect(code).not.toMatch(
      /from ["']@ate\/(broker|execution|strategy|risk|instrument-registry|market-intelligence)/u,
    );
    expect(code).not.toMatch(
      /class (?:Clock|CanonicalObservation|QualityScor|CalendarBoundaryResolver)/u,
    );
    expect(code).toContain("DeterministicScheduler");
    expect(code).toContain("marketObservationSchema");
    expect(code).toContain("AggregationEngine");
    expect(code).not.toMatch(/https?:\/\/|fetch\(/u);
  });
  it("governs every replay control through DATA-owned definitions and schemas", () => {
    const clock = new VirtualClock(t("13:00:00"));
    const definitions = replayConfigurationDefinitions(clock);
    const schemas = replayConfigurationSchemas(clock);
    expect(definitions).toHaveLength(Object.keys(defaultReplayLimits).length + 5);
    expect(schemas).toHaveLength(definitions.length);
    for (const d of definitions) {
      expect(d.domain).toBe("DATA");
      expect(d.failClosed).toBe(true);
      expect(d.allowedScopes).toEqual(["SYSTEM", "ENVIRONMENT"]);
      expect(d.metadata?.reloadRequirement).toBe("RESTART");
    }
  });
  it("adds no new third-party dependency and declares exact versions of its existing owners", () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "packages/market-replay/package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).filter((k) => !k.startsWith("@ate/"))).toEqual(["zod"]);
    expect(pkg.dependencies.zod).toBe("^4.1.13");
    for (const dependency of [
      "@ate/time",
      "@ate/domain",
      "@ate/multitimeframe",
      "@ate/historical-data",
      "@ate/data-quality",
      "@ate/dataset-catalogue",
      "@ate/realtime-data",
      "@ate/configuration",
      "@ate/runtime",
      "@ate/events",
      "@ate/persistence",
    ]) {
      const owner = JSON.parse(
        readFileSync(
          join(process.cwd(), "packages", dependency.replace("@ate/", ""), "package.json"),
          "utf8",
        ),
      ) as { version: string };
      expect(pkg.dependencies[dependency]).toBe(owner.version);
    }
  });
});
