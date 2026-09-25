import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const readText = (relativePath: string): string => readFileSync(join(root, relativePath), "utf8");

const readJson = <T>(relativePath: string): T => JSON.parse(readText(relativePath)) as T;

type CapabilityManifest = {
  completed_prompt: number;
  capabilities: Record<string, boolean>;
  truth_statement: string;
};

const requiredDocuments = [
  "README.md",
  "docs/architecture/engineering-constitution.md",
  "docs/architecture/system-architecture.md",
  "docs/architecture/safety-invariants.md",
  "docs/architecture/authority-hierarchy.md",
  "docs/architecture/environment-runtime-modes.md",
  "docs/architecture/time-and-clock.md",
  "docs/architecture/hierarchical-configuration.md",
  "docs/architecture/configuration-schema-validation.md",
  "docs/architecture/configuration-versioning.md",
  "docs/architecture/glossary.md",
  "docs/configuration/configuration-principles.md",
  "docs/help/help-and-configuration-usability-standard.md",
  "docs/security/security-baseline.md",
  "docs/development/repository-structure.md",
  "docs/development/development-setup.md",
  "docs/development/coding-standards.md",
  "docs/development/contribution-workflow.md",
  "docs/development/versioning.md",
  "docs/development/prompt-ledger.md",
  "docs/testing/testing-strategy.md",
  "docs/help/time-and-clock.md",
  "docs/help/hierarchical-configuration.md",
  "docs/help/configuration-schema-and-validation.md",
  "docs/help/configuration-versioning.md",
];

describe("Prompt 1 repository foundation", () => {
  it("contains the required foundation documents", () => {
    for (const documentPath of requiredDocuments) {
      expect(
        readText(documentPath).trim().length,
        `${documentPath} should not be empty`,
      ).toBeGreaterThan(100);
    }
  });

  it("documents all mandatory safety invariants", () => {
    const safetyInvariants = readText("docs/architecture/safety-invariants.md");

    for (let invariant = 1; invariant <= 20; invariant += 1) {
      const identifier = `INV-${String(invariant).padStart(3, "0")}`;
      expect(safetyInvariants, `${identifier} should be documented`).toContain(identifier);
    }
  });

  it("keeps the capability manifest truthful about unimplemented trading features", () => {
    const manifest = readJson<CapabilityManifest>("config/capabilities.json");

    expect(manifest.completed_prompt).toBeGreaterThanOrEqual(1);
    expect(manifest.capabilities.repository_foundation).toBe(true);
    expect(manifest.capabilities.engineering_constitution).toBe(true);

    const unimplementedCapitalBearingCapabilities = [
      "backend_api",
      "frontend_control_center",
      "market_data_ingestion",
      "mose_surveillance",
      "strategy_engine",
      "risk_engine",
      "portfolio_engine",
      "capital_protection_engine",
      "multi_account_management",
      "execution_engine",
      "mt5_gateway",
      "connector_ea",
      "broker_order_submission",
      "reconciliation",
      "backtesting",
      "paper_trading",
      "live_trading",
    ];

    for (const capability of unimplementedCapitalBearingCapabilities) {
      expect(manifest.capabilities[capability], `${capability} must remain false in Prompt 1`).toBe(
        false,
      );
    }

    expect(manifest.truth_statement).toContain("cannot trade");
  });

  it("records implemented prompts without marking future prompts complete", () => {
    const ledger = readText("docs/development/prompt-ledger.md");

    expect(ledger).toContain(
      "Master Architecture, Repository Foundation & Engineering Constitution",
    );
    expect(ledger).toContain("Completed");
    expect(ledger).not.toMatch(/\|\s*10\s*\|.*Completed/i);
  });

  it("does not claim live trading capability in the README", () => {
    const readme = readText("README.md");

    expect(readme).toContain("Trading capability: **not implemented**");
    expect(readme).toContain("Live execution: **not implemented**");
    expect(readme).not.toMatch(/currently supports live trading/i);
  });
});
