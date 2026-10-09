import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  instrumentRegistryConfigurationDefinitions,
  instrumentRegistryConfigurationSchemas,
  ConfigurationRegistry,
  ConfigurationSchemaRegistry,
} from "@ate/configuration";
import { VirtualClock } from "@ate/time";
import { defaultPolicy, policyFromEffective } from "@ate/instrument-registry";
import { effective, time } from "./fixtures.js";
const help = readFileSync(
  join(import.meta.dirname, "../../docs/help/universal-instrument-registry.md"),
  "utf8",
);
it("managed policy definition and schema match existing owner domains", () => {
  const clock = new VirtualClock(time),
    registry = new ConfigurationRegistry(clock),
    schemas = new ConfigurationSchemaRegistry(clock);
  const definition = instrumentRegistryConfigurationDefinitions(clock)[0]!;
  expect(definition.domain).toBe("INSTRUMENT");
  expect(registry.register(definition).ok).toBe(true);
  expect(schemas.register(instrumentRegistryConfigurationSchemas(clock)[0]!).ok).toBe(true);
});
it("documented complete default policy is accepted by actual resolver", async () => {
  expect(policyFromEffective(await effective(defaultPolicy)).policy).toEqual(defaultPolicy);
  expect(help).toContain("instrument.registry.policyJson");
});
it("help explains ambiguous research results and identity distinction", () => {
  expect(help).toContain("AMBIGUOUS");
  expect(help).toContain("SUPPORTED ≠ AVAILABLE ≠ SUITABLE ≠ AUTHORIZED");
  expect(help).toContain("not a");
});
it("help preserves operational qualification and truthful recovery instructions", () => {
  for (const restriction of [
    "F05",
    "F06",
    "T01",
    "M02",
    "RECOVERY_REQUIRED",
    "COMMITMENT_UNKNOWN",
    "single writer",
  ])
    expect(help).toContain(restriction);
  expect(help).toContain("never silently deleted");
});
it("help documents usable import/revision/query APIs and future boundaries", () => {
  for (const operation of [
    "importJson",
    "importRecords",
    "revise",
    "snapshotAt",
    "search",
    "initialize",
    "stop()",
  ])
    expect(help).toContain(operation);
  expect(help).toContain("Prompt21 needs separate specification and authorization");
});
it("capability manifest declares implemented registry without financial authorization", () => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname, "../../config/capabilities.json"), "utf8"),
  ) as { capabilities: Record<string, boolean>; truth_statement: string };
  expect(manifest.capabilities.instrument_registry).toBe(true);
  for (const cap of [
    "execution_engine",
    "broker_order_submission",
    "paper_trading",
    "live_trading",
  ])
    expect(manifest.capabilities[cap]).toBe(false);
  expect(manifest.truth_statement).toContain("pending independent technical audit");
});
