import { it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ConfigurationRegistry, ConfigurationSchemaRegistry } from "@ate/configuration";
import {
  eligibilityConfigurationDefinitions,
  eligibilityConfigurationSchemas,
  defaultPolicy,
  policyFromEffective,
} from "@ate/instrument-eligibility";
import { fixture, configuration, take } from "./fixtures.js";
const base = join(import.meta.dirname, "../.."),
  src = join(base, "packages/instrument-eligibility/src"),
  help = readFileSync(join(base, "docs/help/instrument-eligibility.md"), "utf8");
it("registers policy/schema through established configuration owners", async () => {
  const f = await fixture(),
    clock = f.ports.clock;
  const registry = new ConfigurationRegistry(clock),
    schemas = new ConfigurationSchemaRegistry(clock);
  for (const d of eligibilityConfigurationDefinitions(clock)) take(registry.register(d));
  for (const s of eligibilityConfigurationSchemas(clock)) take(schemas.register(s));
  expect(policyFromEffective(await configuration(defaultPolicy, clock)).policy).toEqual(
    defaultPolicy,
  );
  for (const key of Object.keys(defaultPolicy)) expect(help).toContain(key);
});
it("has no network, ambient clock, random identities or private upstream imports", () => {
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
    /@ate\/[^"']+\/src\//,
    /\.\.\/\.\.\//,
  ])
    expect(sources).not.toMatch(pattern);
  for (const call of [
    "validateMutation",
    "authorityResolver.resolve",
    "clock.now()",
    "compareReplayCheckpoints",
    "DeterministicReplaySequencer",
  ])
    expect(sources).toContain(call);
});
it("documents lifecycle, research-only contract and uncertainty honestly", () => {
  for (const term of [
    "DISCOVERED",
    "MAPPED",
    "DATA_QUALIFIED",
    "RESEARCH",
    "VALIDATED",
    "SIMULATION",
    "LIVE_ELIGIBLE",
    "ACTIVE",
    "PENDING_EVIDENCE",
    "UNDER_REVIEW",
    "SUSPENDED",
    "REVOKED",
    "EXPIRED",
    "QUARANTINED",
    "RETIRED",
    "REPLAY_REPRODUCIBLE",
    "VALIDATION_ATTESTED",
    "VALIDATION_INDEPENDENTLY_VERIFIED",
    "maker",
    "checker",
    "RECOVERY_REQUIRED",
    "UNKNOWN",
    "O-C01",
    "O-C02",
    "F05",
    "F06",
    "T01",
    "M02",
    "E-T01",
    "Q01-A",
    "single writer",
    "broker.eligibility.policyJson",
    "initialize()",
    "stop()",
    "createAttestation",
    "recordAttestation",
    "evaluateTransition",
    "requestTransition",
    "approveTransition",
    "commitTransition",
    "suspendEligibility",
    "revokeEligibility",
    "reinstateEligibility",
    "historicalEligibility",
    "getEligibilityHistory",
    "getEligibilityEvidence",
    "getEligibilityChanges",
    "compareEligibilityVersions",
    "explainEligibilityDecision",
  ])
    expect(help).toContain(term);
});
it("truthful P24 manifest retains trading prohibitions and pending acceptance", () => {
  const m = JSON.parse(readFileSync(join(base, "config/capabilities.json"), "utf8")) as {
    completed_prompt: number;
    pre_production_version: string;
    capabilities: Record<string, boolean>;
    truth_statement: string;
  };
  expect(m.completed_prompt).toBe(24);
  expect(m.pre_production_version).toBe("0.24.0-instrument-eligibility.1");
  expect(m.capabilities.offline_instrument_eligibility).toBe(true);
  for (const k of [
    "live_trading",
    "paper_trading",
    "execution_engine",
    "broker_order_submission",
    "independent_scientific_validation",
    "live_eligibility_promotion",
  ])
    expect(m.capabilities[k]).toBe(false);
  expect(m.truth_statement).toContain("pending independent technical audit");
  expect(m.truth_statement).toContain("Prompt 25 is not authorized");
});
