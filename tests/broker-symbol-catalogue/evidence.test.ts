import { it, expect } from "vitest";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { fingerprint } from "@ate/configuration";
import {
  BrokerSymbolCatalogue,
  FilesystemCatalogueRepository,
  defaultPolicy,
} from "@ate/broker-symbol-catalogue";
import { setup, registered, batch, take, maker, checker, root } from "./fixtures.js";
it("retained exact acknowledged root authenticates immutable proposal and checker decision after restart", async () => {
  const path = root(),
    canonical = await registered(),
    f = await setup(defaultPolicy, new FilesystemCatalogueRepository(path));
  f.ports.registry = canonical.canonical.registry;
  f.ports.registryConfiguration = () => canonical.canonical.config;
  const input = batch();
  input.records[0]!.identifiers = [
    { scheme: "RESEARCH", scope: "synthetic-broker", authority: "fixture", value: "economic-A" },
  ];
  const c = take(await f.lab.importNative(input)),
    p = take(
      await f.lab.propose({
        catalogueFingerprint: c.fingerprint,
        rawSymbol: "SYN.A",
        selector: { kind: "IDENTIFIER", index: 0 },
        maker,
        reason: "Retained synthetic evidence",
      }),
    ),
    d = take(
      await f.lab.review(p.proposalId, {
        checker,
        state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
        selectedCandidate: p.candidateIds[0],
        reason: "Separate authorized synthetic research review",
      }),
    ),
    ack = take(f.lab.snapshot());
  take(await f.lab.stop());
  const fresh = new BrokerSymbolCatalogue("offline-lab", f.ports);
  expect(take(await fresh.initialize())).toEqual(ack);
  expect(take(fresh.mapping(p.proposalId))).toMatchObject({
    state: "APPROVED_FOR_RESEARCH_ASSOCIATION",
    decisions: [d],
  });
  const folder = process.env["ATE_CODEX006_EVIDENCE_DIR"];
  if (folder) {
    const target = resolve(folder),
      rel = relative(resolve(process.cwd()), target);
    expect(rel.startsWith("..")).toBe(true);
    await mkdir(join(target, "retained-root"), { recursive: true });
    for (const name of await readdir(path))
      await writeFile(join(target, "retained-root", name), await readFile(join(path, name)));
    await writeFile(join(target, "retained-input.json"), JSON.stringify(input, null, 2) + "\n");
    await writeFile(
      join(target, "retained-registry-history.json"),
      JSON.stringify(take(await canonical.canonical.repository.load()), null, 2) + "\n",
    );
    await writeFile(
      join(target, "retained-recovery.json"),
      JSON.stringify(
        {
          acknowledgedSnapshot: ack,
          recoveredSnapshot: take(fresh.snapshot()),
          catalogueFingerprint: c.fingerprint,
          proposalId: p.proposalId,
          decisionId: d.decisionId,
          registrySnapshot: p.registrySnapshot,
          preparedInputFingerprint: c.inputFingerprint,
          sourceDeclarationFingerprint: input.source.contentFingerprint,
          rawFixtureFingerprint: fingerprint(input),
          configuration: f.ports.configuration(),
          registryConfiguration: f.ports.registryConfiguration(),
          diagnostics: fresh.diagnostics(),
        },
        null,
        2,
      ) + "\n",
    );
  }
  take(await fresh.stop());
  expect(fresh.mapping(p.proposalId).ok).toBe(false);
});
