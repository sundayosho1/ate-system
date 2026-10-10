import { it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  fingerprint,
  ConfigurationRegistry,
  ConfigurationSchemaRegistry,
} from "@ate/configuration";
import {
  brokerCatalogueConfigurationDefinitions,
  brokerCatalogueConfigurationSchemas,
  defaultPolicy,
  policyFromEffective,
  discoveryStates,
  prepareBatch,
  makeCatalogue,
} from "@ate/broker-symbol-catalogue";
import { VirtualClock } from "@ate/time";
import { effective, batch, time, setup } from "./fixtures.js";
const base = join(import.meta.dirname, "../.."),
  src = join(base, "packages/broker-symbol-catalogue/src"),
  help = readFileSync(join(base, "docs/help/broker-symbol-catalogue.md"), "utf8");
it("configuration schemas register through existing configuration owners", () => {
  const clock = new VirtualClock(time),
    definitions = new ConfigurationRegistry(clock),
    schemas = new ConfigurationSchemaRegistry(clock);
  expect(definitions.register(brokerCatalogueConfigurationDefinitions(clock)[0]!).ok).toBe(true);
  expect(schemas.register(brokerCatalogueConfigurationSchemas(clock)[0]!).ok).toBe(true);
});
it("complete documented default policy resolves without changing an upstream owner", async () => {
  expect(policyFromEffective(await effective()).policy).toEqual(defaultPolicy);
  for (const key of Object.keys(defaultPolicy)) expect(help).toContain(key);
  expect(help).toContain("broker.catalogue.policyJson");
});
it("documented JSON fixture is accepted exactly by actual native boundary", async () => {
  const block = /```json\n([\s\S]*?)\n```/.exec(help);
  expect(block).not.toBeNull();
  const f = await setup();
  expect((await f.lab.importJson(block![1])).ok).toBe(true);
});
it("help exposes all operation, permission, recovery and nonproduction boundaries", () => {
  for (const term of [
    "importNative",
    "importJson",
    "catalogue(",
    "snapshot(",
    "query(",
    "propose(",
    "review(",
    "mapping(",
    "compare(",
    "initialize()",
    "stop()",
    "F05",
    "F06",
    "T01",
    "M02",
    "O-C01",
    "O-C02",
    "Q01-A",
    "RECOVERY_REQUIRED",
    "single writer",
    "UNKNOWN",
    "PARTIAL",
    "LOOKUP_ONLY",
    "maker",
    "checker",
    "DISCOVERED ≠ CANONICALLY MATCHED ≠ AVAILABLE NOW ≠ SUITABLE ≠ AUTHORIZED TO TRADE",
    "Prompt 22",
  ])
    expect(help).toContain(term);
});
it("no new network, economic resolver, wall clock, random identity or upstream source import", () => {
  const sources = readdirSync(src)
    .filter((n) => n.endsWith(".ts"))
    .map((n) => readFileSync(join(src, n), "utf8"))
    .join("\n");
  for (const pattern of [
    /\bfetch\s*\(/,
    /node:(?:http|https|net|tls|child_process)/,
    /Date\.now\s*\(/,
    /Math\.random\s*\(/,
    /randomUUID\s*\(/,
    /packages\/.*\/src/,
    /from ["']@ate\/(?:market-replay|dataset-catalogue)\/src/,
  ])
    expect(sources).not.toMatch(pattern);
  expect(sources).toContain("registryView");
  expect(sources).toContain("validateMutation");
  expect(sources).toContain("authorityResolver.resolve");
  expect(sources).toContain("this.ports.clock.now()");
});
it("truth manifest distinguishes implemented pending audit from trading authorization", () => {
  const m = JSON.parse(readFileSync(join(base, "config/capabilities.json"), "utf8")) as {
    completed_prompt: number;
    pre_production_version: string;
    capabilities: Record<string, boolean>;
    truth_statement: string;
  };
  expect(m.completed_prompt).toBe(21);
  expect(m.pre_production_version).toBe("0.21.0-broker-symbol-catalogue.1");
  expect(m.capabilities["offline_broker_symbol_catalogue"]).toBe(true);
  for (const k of ["live_trading", "paper_trading", "execution_engine", "broker_order_submission"])
    expect(m.capabilities[k]).toBe(false);
  expect(m.truth_statement).toContain("pending independent technical audit");
  expect(m.truth_statement).toContain("Prompt 22 is not authorized");
});
it("explicit conflicting observation states never become availability or trade authorization", () => {
  const b = batch();
  b.records[0]!.listed = false;
  b.records[0]!.visible = false;
  b.records[0]!.tradeMode = "DISABLED";
  const o = makeCatalogue(
    prepareBatch(b, defaultPolicy),
    defaultPolicy,
    1,
    null,
    time,
    new VirtualClock(time).provenance,
  ).observations[0]!;
  expect(discoveryStates(o)).toEqual([
    "LISTED_IN_CATALOGUE",
    "NOT_LISTED_IN_OBSERVED_CATALOGUE",
    "OBSERVATION_CONFLICT",
    "SOURCE_DECLARED_DISABLED",
    "SOURCE_DECLARED_HIDDEN",
  ]);
  expect(fingerprint(o.raw)).toBe(fingerprint(b.records[0]));
});
