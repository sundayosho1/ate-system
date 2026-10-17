import { mkdir, readdir, lstat, readFile, writeFile, link, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stableStringify } from "@ate/configuration";
import {
  checkpointSchema,
  policySchema,
  success,
  failure,
  type ScannerCheckpoint,
  type ScanCheckpointRepository,
  type ScannerPolicy,
} from "./contracts.js";
import { bytes, fingerprint, frozen, boundedClone } from "./primitives.js";
export function checkedCheckpoint(raw: unknown, policy: ScannerPolicy): ScannerCheckpoint {
  const c = checkpointSchema.parse(
    boundedClone(raw, policy.maxCheckpointBytes, policy.maxInputDepth),
  );
  const { fingerprint: f, ...body } = c;
  if (fingerprint(body) !== f) throw Error("CHECKPOINT_INTEGRITY");
  return frozen(c);
}
export class MemoryScanRepository implements ScanCheckpointRepository {
  private readonly history: ScannerCheckpoint[] = [];
  async load() {
    await Promise.resolve();
    return success(frozen([...this.history]));
  }
  async commit(c: ScannerCheckpoint) {
    await Promise.resolve();
    if (
      c.generation !== this.history.length + 1 ||
      c.previous !== (this.history.at(-1)?.fingerprint ?? null)
    )
      return failure("STALE_REPOSITORY");
    const { fingerprint: f, ...b } = c;
    if (fingerprint(b) !== f) return failure("CHECKPOINT_INTEGRITY");
    this.history.push(frozen(checkpointSchema.parse(c)));
    return success(c);
  }
}
/** Trusted root, single writer, exclusive immutable link/readback; no power-loss certificate. */
export class FilesystemScanRepository implements ScanCheckpointRepository {
  private readonly root: string;
  private readonly policy: ScannerPolicy;
  constructor(root: string, policy: ScannerPolicy) {
    this.root = resolve(root);
    this.policy = frozen(policySchema.parse(policy));
  }
  private async read() {
    await mkdir(this.root, { recursive: true });
    const stat = await lstat(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("UNTRUSTED_ROOT");
    const names = (await readdir(this.root)).sort();
    if (
      names.length > this.policy.maxHistory ||
      names.some((n, i) => n !== `generation-${String(i + 1).padStart(8, "0")}.json`)
    )
      throw Error("RECOVERY_REQUIRED");
    const records: ScannerCheckpoint[] = [];
    let retained = 0;
    for (const n of names) {
      const path = join(this.root, n),
        s = await lstat(path);
      if (!s.isFile() || s.isSymbolicLink() || s.size > this.policy.maxCheckpointBytes)
        throw Error("CHECKPOINT_BOUNDS");
      const raw = await readFile(path, "utf8");
      retained += Buffer.byteLength(raw);
      if (retained > this.policy.maxRetainedBytes) throw Error("RETAINED_BOUNDS");
      const checked = checkedCheckpoint(JSON.parse(raw), this.policy);
      if (stableStringify(checked) !== raw) throw Error("NONCANONICAL_HISTORY");
      records.push(checked);
    }
    return { records, retained };
  }
  async load() {
    try {
      return success(frozen((await this.read()).records));
    } catch {
      return failure("RECOVERY_REQUIRED");
    }
  }
  async commit(raw: ScannerCheckpoint) {
    let attempted = false;
    let temporary: string | null = null;
    try {
      const c = checkedCheckpoint(raw, this.policy),
        loaded = await this.read(),
        history = loaded.records;
      if (
        c.generation !== history.length + 1 ||
        c.previous !== (history.at(-1)?.fingerprint ?? null)
      )
        return failure("STALE_REPOSITORY");
      if (
        history.length >= this.policy.maxHistory ||
        loaded.retained + bytes(c) > this.policy.maxRetainedBytes
      )
        return failure("RETAINED_BOUNDS");
      const name = `generation-${String(c.generation).padStart(8, "0")}.json`,
        path = join(this.root, name);
      temporary = join(this.root, `.pending-${c.fingerprint.slice(7)}.json`);
      attempted = true;
      await writeFile(temporary, stableStringify(c), { flag: "wx", mode: 0o600 });
      await link(temporary, path);
      await unlink(temporary);
      temporary = null;
      const actual = checkedCheckpoint(JSON.parse(await readFile(path, "utf8")), this.policy);
      if (actual.fingerprint !== c.fingerprint) throw Error("ACK_MISMATCH");
      return success(actual);
    } catch {
      return failure("PUBLICATION_FAILED", attempted ? "UNKNOWN" : "NONE");
    } finally {
      if (temporary) await unlink(temporary).catch(() => undefined);
    }
  }
}
