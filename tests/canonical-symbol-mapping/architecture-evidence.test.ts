import { it, expect } from "vitest";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  CanonicalSymbolMapping,
  FilesystemMappingRepository,
  defaultPolicy,
  mappingConfigurationDefinitions,
  mappingConfigurationSchemas,
} from "@ate/canonical-symbol-mapping";
import { fixture, take, root } from "./fixtures.js";
it("architecture guard forbids private owner imports, wall clock, random/network and parallel review engine", async () => {
  for (const name of await readdir("packages/canonical-symbol-mapping/src")) {
    const text = await readFile(join("packages/canonical-symbol-mapping/src", name), "utf8");
    expect(text).not.toMatch(
      /\.\.\/\.\.\/[^/]+\/src|Date\.now|new Date|Math\.random|randomUUID|node:(?:http|https|net|tls)|WebSocket|fetch\(/,
    );
    expect(text).not.toMatch(/class .*Approval|class .*CanonicalIdentity|class .*Clock/);
  }
});
it("help and configuration schemas explain all required identities, policies and qualifications", async () => {
  const f = await fixture(),
    help = await readFile("docs/help/canonical-symbol-mapping.md", "utf8");
  for (const term of [
    "Q-HIST",
    "Q-TICK",
    "Q-SELECTOR",
    "Q-T01",
    "F05",
    "F06",
    "T01",
    "M02",
    "O-C01",
    "O-C02",
    "Q01-A",
    "broker.mapping.policyJson",
    "requireVerifiedIdentifiers",
    "minIndependentClaims",
    "compatibleHistoryPolicies",
    "NOT_ESTABLISHED",
    "STORED",
    "CURRENT",
    "prefix",
    "NOT AUTHORIZED",
  ])
    expect(help).toContain(term);
  expect(mappingConfigurationDefinitions(f.base.clock)[0]!.key).toBe("broker.mapping.policyJson");
  expect(mappingConfigurationSchemas(f.base.clock)).toHaveLength(1);
});
it("real immutable filesystem artifact and fresh reader identities are retained when requested", async () => {
  const evidence = process.env["ATE_CODEX007_EVIDENCE_DIR"];
  if (evidence) await mkdir(evidence, { recursive: true });
  const storage = evidence ? join(evidence, "mapping-set-root") : root(),
    repository = new FilesystemMappingRepository(
      storage,
      defaultPolicy.maxSnapshotBytes,
      defaultPolicy.maxSets,
      defaultPolicy.maxRetainedBytes,
    ),
    f = await fixture(defaultPolicy, repository);
  await f.import();
  const first = take(await f.service.publish(f.request()));
  const second = take(await f.service.publish(f.request("second")));
  take(await f.service.stop());
  const fresh = new CanonicalSymbolMapping("mapping-lab", f.ports);
  take(await fresh.initialize());
  expect(take(fresh.snapshot())).toEqual(second);
  expect(take(fresh.snapshot(first.fingerprint))).toEqual(first);
  const diagnostics = fresh.diagnostics();
  take(await fresh.stop());
  expect(diagnostics).toMatchObject({ readiness: "READY", health: "HEALTHY", generation: 2 });
  if (evidence)
    await writeFile(
      join(evidence, "filesystem-recovery.json"),
      JSON.stringify(
        {
          storage,
          first,
          second,
          diagnostics,
          final: fresh.diagnostics(),
          originalSource: take(f.base.lab.snapshot()),
          canonical: take(f.base.canonical.registry.snapshot()),
        },
        null,
        2,
      ),
    );
});

it("all three actual filesystem owners stop and freshly recover one accepted qualification", async () => {
  const f = await fixture();
  await f.import();
  const storage = process.env["ATE_CODEX007_EVIDENCE_DIR"]
    ? join(process.env["ATE_CODEX007_EVIDENCE_DIR"], "joint-owners")
    : root();
  const { InstrumentRegistry, FilesystemRegistryRepository } =
    await import("@ate/instrument-registry");
  const { BrokerSymbolCatalogue, FilesystemCatalogueRepository } =
    await import("@ate/broker-symbol-catalogue");
  const canonicalDisk = new FilesystemRegistryRepository(join(storage, "canonical"));
  take(await canonicalDisk.commit(take(f.base.canonical.registry.snapshot())!));
  const canonicalId = f.base.canonical.registry.diagnostics().registryId;
  const registry = new InstrumentRegistry(canonicalId, {
    clock: f.base.clock,
    configuration: () => f.base.canonical.config,
    repository: canonicalDisk,
  });
  take(await registry.initialize());
  const sourceDisk = new FilesystemCatalogueRepository(join(storage, "source"));
  for (const s of take(await f.base.repository.load()))
    take(await sourceDisk.commit(s as Parameters<typeof sourceDisk.commit>[0]));
  const sourcePorts = { ...f.base.ports, registry, repository: sourceDisk };
  const source = new BrokerSymbolCatalogue("offline-lab", sourcePorts);
  take(await source.initialize());
  const disk = new FilesystemMappingRepository(join(storage, "mapping"));
  const ports = {
    ...f.ports,
    registry,
    sources: new Map([["offline-lab", source]]),
    repository: disk,
  };
  const mapping = new CanonicalSymbolMapping("mapping-lab", ports);
  take(await mapping.initialize());
  const snapshot = take(await mapping.publish(f.request()));
  take(await mapping.stop());
  take(await source.stop());
  take(await registry.stop());
  const registry2 = new InstrumentRegistry(canonicalId, {
    clock: f.base.clock,
    configuration: () => f.base.canonical.config,
    repository: canonicalDisk,
  });
  take(await registry2.initialize());
  const source2 = new BrokerSymbolCatalogue("offline-lab", { ...sourcePorts, registry: registry2 });
  take(await source2.initialize());
  const reader = new CanonicalSymbolMapping("mapping-lab", {
    ...ports,
    registry: registry2,
    sources: new Map([["offline-lab", source2]]),
  });
  take(await reader.initialize());
  expect(take(reader.snapshot())).toEqual(snapshot);
  expect(reader.diagnostics()).toMatchObject({ readiness: "READY", health: "HEALTHY" });
  if (process.env["ATE_CODEX007_EVIDENCE_DIR"])
    await writeFile(
      join(storage, "joint-recovery.json"),
      JSON.stringify(
        {
          snapshot,
          canonical: take(registry2.snapshot()),
          source: take(source2.snapshot()),
          mappingDiagnostics: reader.diagnostics(),
        },
        null,
        2,
      ),
    );
  take(await reader.stop());
  take(await source2.stop());
  take(await registry2.stop());
});
