import { mkdir, readdir, lstat, readFile, writeFile, link, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { stableStringify } from "@ate/configuration";
import {
  checkpointSchema,
  ok,
  type Repository,
  type Checkpoint,
  type Result,
} from "./contracts.js";
import {
  clone,
  freeze,
  fingerprint,
  failure,
  bytes,
  withoutFingerprint,
  parseJSON,
} from "./primitives.js";
export class MemoryMOSERepository implements Repository {
  private records: Checkpoint[] = [];
  public async load() {
    await Promise.resolve();
    return ok(freeze([...this.records]));
  }
  public async commit(c: Checkpoint): Promise<Result<Checkpoint>> {
    await Promise.resolve();
    if (
      c.generation !== this.records.length + 1 ||
      c.previous !== (this.records.at(-1)?.fingerprint ?? null)
    )
      return failure("STALE_REPOSITORY");
    if (fingerprint(withoutFingerprint(c)) !== c.fingerprint)
      return failure("CHECKPOINT_INTEGRITY");
    this.records.push(freeze(checkpointSchema.parse(clone(c, 16777216))));
    return ok(c);
  }
}
/** Trusted root/single writer, exclusive immutable publication/readback. No fsync/power-loss certificate. */
export class FilesystemMOSERepository implements Repository {
  private readonly root: string;
  public constructor(
    root: string,
    private readonly maxCheckpointBytes = 1048576,
    private readonly maxHistory = 512,
    private readonly maxRetainedBytes = 67108864,
  ) {
    if (
      !Number.isSafeInteger(maxCheckpointBytes) ||
      maxCheckpointBytes < 4096 ||
      maxCheckpointBytes > 16777216 ||
      !Number.isSafeInteger(maxHistory) ||
      maxHistory < 1 ||
      maxHistory > 10000 ||
      !Number.isSafeInteger(maxRetainedBytes) ||
      maxRetainedBytes < 4096 ||
      maxRetainedBytes > 1073741824
    )
      throw Error("RESOURCE_BUDGET_EXCEEDED");
    this.root = resolve(root);
  }
  private async names() {
    await mkdir(this.root, { recursive: true });
    const s = await lstat(this.root);
    if (!s.isDirectory() || s.isSymbolicLink()) throw Error("UNTRUSTED_ROOT");
    const names = await readdir(this.root);
    if (names.length > this.maxHistory || names.some((n) => !/^generation-[0-9]{8}\.json$/.test(n)))
      throw Error("RECOVERY_REQUIRED");
    names.sort();
    if (names.some((n, i) => n !== `generation-${String(i + 1).padStart(8, "0")}.json`))
      throw Error("RECOVERY_REQUIRED");
    return names;
  }
  private async read(name: string) {
    const file = join(this.root, name),
      s = await lstat(file);
    if (!s.isFile() || s.isSymbolicLink() || s.size > this.maxCheckpointBytes)
      throw Error("RECOVERY_REQUIRED");
    const raw = await readFile(file, "utf8");
    if (Buffer.byteLength(raw) > this.maxCheckpointBytes) throw Error("RESOURCE_BUDGET_EXCEEDED");
    const c = checkpointSchema.parse(
      clone(parseJSON(raw, this.maxCheckpointBytes), this.maxCheckpointBytes),
    );
    if (fingerprint(withoutFingerprint(c)) !== c.fingerprint) throw Error("RECOVERY_REQUIRED");
    return c;
  }
  public async load(): Promise<Result<readonly unknown[]>> {
    try {
      const names = await this.names();
      let retained = 0;
      const records = [];
      for (const n of names) {
        retained += (await lstat(join(this.root, n))).size;
        if (retained > this.maxRetainedBytes) throw Error("RESOURCE_BUDGET_EXCEEDED");
        records.push(await this.read(n));
      }
      return ok(freeze(records));
    } catch {
      return failure("RECOVERY_REQUIRED", "UNKNOWN");
    }
  }
  public async commit(c: Checkpoint): Promise<Result<Checkpoint>> {
    let attempted = false;
    try {
      const names = await this.names();
      if (names.length >= this.maxHistory) return failure("RESOURCE_BUDGET_EXCEEDED");
      if (
        c.generation !== names.length + 1 ||
        c.previous !== (names.length ? (await this.read(names.at(-1)!)).fingerprint : null)
      )
        return failure("STALE_REPOSITORY");
      const parsed = checkpointSchema.parse(clone(c, this.maxCheckpointBytes));
      if (fingerprint(withoutFingerprint(parsed)) !== c.fingerprint)
        return failure("CHECKPOINT_INTEGRITY");
      let retained = bytes(c);
      for (const n of names) retained += (await lstat(join(this.root, n))).size;
      if (retained > this.maxRetainedBytes || bytes(c) > this.maxCheckpointBytes)
        return failure("RESOURCE_BUDGET_EXCEEDED");
      const name = `generation-${String(c.generation).padStart(8, "0")}.json`,
        temp = join(this.root, name + ".pending");
      attempted = true;
      await writeFile(temp, stableStringify(c), { flag: "wx" });
      await link(temp, join(this.root, name));
      await unlink(temp);
      const actual = await this.read(name);
      if (actual.fingerprint !== c.fingerprint) throw Error("READBACK_MISMATCH");
      return ok(freeze(actual));
    } catch {
      return failure(attempted ? "COMMITMENT_UNKNOWN" : "RECOVERY_REQUIRED", "UNKNOWN");
    }
  }
}
