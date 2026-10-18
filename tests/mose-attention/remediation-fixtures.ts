import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableStringify } from "@ate/configuration";
import {
  FilesystemScanRepository,
  checkpointSchema as scannerCheckpointSchema,
  type ScanRequest,
  type ScannerResult,
} from "@ate/mose-scanner";
import {
  FilesystemAttentionRepository,
  checkpointSchema,
  AdaptiveSurveillanceRuntime,
  fingerprint,
  type AttentionCheckpoint,
  type AttentionPolicy,
} from "@ate/mose-attention";
import { fixture, owners, take, checker } from "./fixtures.js";
export { owners, take, checker };
export const nativeSuccess = (raw: unknown): ScannerResult<ScanRequest> => ({
  ok: true,
  value: raw as ScanRequest, // Intentional native-boundary fault injection, never a trusted positive.
});
export async function physicalFixture(
  base: Awaited<ReturnType<typeof owners>>,
  changes: Partial<AttentionPolicy> = {},
) {
  const f = await fixture(base, { submissionEnabled: true, actor: checker.actorId, ...changes });
  const root = mkdtempSync(join(tmpdir(), "attention-remediation-"));
  const storage = new FilesystemAttentionRepository(join(root, "attention"), f.policy);
  const scannerStorage = new FilesystemScanRepository(join(root, "scanner"), f.scanner.policy);
  for (const cp of take(await f.repository.load()))
    take(await storage.commit(checkpointSchema.parse(cp)));
  for (const cp of take(await f.scanner.repository.load()))
    take(await scannerStorage.commit(scannerCheckpointSchema.parse(cp)));
  f.ports.repository = storage;
  f.scanner.ports.repository = scannerStorage;
  take(await f.assess());
  const allocated = take(await f.allocate());
  return {
    ...f,
    root,
    storage,
    scannerStorage,
    recommendation: allocated.state.recommendations[0]!,
    fresh: () => new AdaptiveSurveillanceRuntime({ ...f.ports, repository: storage }),
  };
}
export async function corruptHistory(
  f: Awaited<ReturnType<typeof physicalFixture>>,
  change: (last: AttentionCheckpoint) => void,
) {
  const records = structuredClone(take(await f.storage.load()));
  const last = records.at(-1)!;
  change(last);
  const { fingerprint: _old, ...body } = last;
  void _old;
  last.fingerprint = fingerprint(body);
  const root = join(f.root, "corrupt");
  mkdirSync(root);
  for (const cp of records)
    writeFileSync(
      join(root, `generation-${String(cp.generation).padStart(8, "0")}.json`),
      stableStringify(cp),
    );
  const repository = new FilesystemAttentionRepository(root, f.policy);
  return {
    records,
    repository,
    runtime: new AdaptiveSurveillanceRuntime({ ...f.ports, repository }),
  };
}
