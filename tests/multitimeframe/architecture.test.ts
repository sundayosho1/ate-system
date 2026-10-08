import type { RuntimeInstanceId } from "@ate/runtime";
import type { RuntimeMode } from "@ate/domain";
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  AggregationRuntimeService,
  defaultOptions,
  registerAggregationAuthority,
} from "@ate/multitimeframe";
import {
  multitimeframeConfigurationDefinitions,
  multitimeframeConfigurationSchemas,
} from "@ate/configuration";
import { StateAuthorityRegistry } from "@ate/persistence";
import { fixture } from "./fixtures.js";
describe("Prompt 18 authority and integration guards", () => {
  it("reuses Prompt 6 clock and decimal, without wall clock, timer, broker or quality scoring authorities", () => {
    const root = join(process.cwd(), "packages/multitimeframe/src");
    const code = readdirSync(root)
      .filter((n) => n.endsWith(".ts"))
      .map((n) => readFileSync(join(root, n), "utf8"))
      .join("\n");
    expect(code).not.toMatch(/Date\.now\(|new Date\(\)|setTimeout\(|setInterval\(|Math\.random\(/u);
    expect(code).not.toMatch(/from ["']@ate\/(execution|strategy|risk|broker)/u);
    expect(code).toContain("marketObservationSchema");
    expect(code).toContain("decimal.js");
    expect(code).not.toMatch(/score\s*[:=]/u);
  });
  it("governs every numeric/boolean option and material policy through existing configuration definitions", () => {
    const f = fixture(["M1"]);
    const definitions = multitimeframeConfigurationDefinitions(f.clock),
      schemas = multitimeframeConfigurationSchemas(f.clock);
    expect(definitions).toHaveLength(Object.keys(defaultOptions).length + 1);
    expect(schemas).toHaveLength(definitions.length);
    for (const d of definitions) {
      expect(d.allowedScopes).toEqual(["SYSTEM", "ENVIRONMENT"]);
      expect(d.metadata?.reloadRequirement).toBe("RESTART");
      expect(d.failClosed).toBe(true);
    }
  });
  it("lifecycle health/readiness use the managed runtime interface and remain research-only", async () => {
    const f = fixture(["M1"]);
    const context = {
      runtimeInstanceId: "40000000-0000-4000-8000-000000000009" as RuntimeInstanceId,
      runtimeMode: "RESEARCH" as RuntimeMode,
      signal: new AbortController().signal,
      now: () => f.clock.now(),
    };
    const runtime = new AggregationRuntimeService(f.engine, f.clock).managedService;
    expect(await runtime.checkReadiness!(context)).toMatchObject({
      status: "READY",
      details: { tradingAuthorized: false },
    });
    await runtime.stop!(context);
    expect(await runtime.checkReadiness!(context)).toMatchObject({ status: "NOT_READY" });
    expect(runtime.descriptor.capabilities).toEqual(["MARKET_DATA_READ"]);
  });
  it("registers derived persistent state through Prompt 5 authority registry", () => {
    const f = fixture(["M1"]);
    const registry = new StateAuthorityRegistry(f.clock);
    expect(registerAggregationAuthority(registry).ok).toBe(true);
    expect(registerAggregationAuthority(registry).ok).toBe(false);
  });
});
