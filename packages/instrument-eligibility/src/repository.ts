import { parseJson, safeClone } from "./boundary.js";
import { mkdir, readdir, readFile, writeFile, link, unlink, lstat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fingerprint, stableStringify } from "@ate/configuration";
import { freeze } from "@ate/multitimeframe";
import { ok, fail, type Repository, type Result, type Snapshot } from "./contracts.js";
export class MemoryEligibilityRepository implements Repository {
  private snapshots: Snapshot[] = [];
  public async load(): Promise<Result<readonly unknown[]>> {
    await Promise.resolve();
    return ok(freeze([...this.snapshots]));
  }
  public async commit(s: Snapshot): Promise<Result<Snapshot>> {
    await Promise.resolve();
    const previous = this.snapshots.at(-1);
    if (
      s.generation !== this.snapshots.length + 1 ||
      s.previous !== (previous?.fingerprint ?? null)
    )
      return fail("STALE_REPOSITORY");
    this.snapshots.push(freeze(safeClone(s, 67108864) as Snapshot));
    return ok(s);
  }
}
/** Trusted root/single writer. Acknowledges exclusive immutable file publication plus readback;
 * does not certify fsync, power-loss or Windows behavior. */
export class FilesystemEligibilityRepository implements Repository {
  private readonly root: string;
  public constructor(
    root: string,
    private readonly maxBytes = 16777216,
    private readonly maxSnapshots = 512,
    private readonly maxRetainedBytes = 67108864,
  ) {
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 4096 ||
      maxBytes > 67108864 ||
      !Number.isSafeInteger(maxSnapshots) ||
      maxSnapshots < 1 ||
      maxSnapshots > 10000 ||
      !Number.isSafeInteger(maxRetainedBytes) ||
      maxRetainedBytes < 4096 ||
      maxRetainedBytes > 1073741824
    )
      throw Error("REPOSITORY_BOUNDS");
    this.root = resolve(root);
  }
  private async files(): Promise<string[]> {
    await mkdir(this.root, { recursive: true });
    const rootState = await lstat(this.root);
    if (!rootState.isDirectory() || rootState.isSymbolicLink()) throw Error("UNTRUSTED_ROOT");
    const names = await readdir(this.root);
    if (names.length > this.maxSnapshots) throw Error("REPOSITORY_CAPACITY");
    if (names.some((n) => !/^generation-[0-9]{8}\.json$/.test(n))) throw Error("RECOVERY_REQUIRED");
    names.sort();
    if (names.some((n, i) => n !== `generation-${String(i + 1).padStart(8, "0")}.json`))
      throw Error("GENERATION_GAP");
    return names;
  }
  private async read(name: string): Promise<unknown> {
    const path = join(this.root, name);
    const s = await lstat(path);
    if (!s.isFile() || s.isSymbolicLink() || s.size > this.maxBytes) throw Error("STORAGE_BOUNDS");
    const data = await readFile(path, "utf8");
    if (Buffer.byteLength(data) > this.maxBytes) throw Error("STORAGE_BOUNDS");
    return safeClone(parseJson(data, this.maxBytes), this.maxBytes);
  }
  public async load(): Promise<Result<readonly unknown[]>> {
    try {
      const names = await this.files();
      let bytes = 0;
      for (const n of names) {
        bytes += (await lstat(join(this.root, n))).size;
        if (bytes > this.maxRetainedBytes) return fail("RETAINED_STORAGE_CAPACITY", "UNKNOWN");
      }
      const rows: unknown[] = [];
      for (const n of names) rows.push(await this.read(n));
      return ok(rows);
    } catch {
      return fail("RECOVERY_REQUIRED", "UNKNOWN");
    }
  }
  public async commit(s: Snapshot): Promise<Result<Snapshot>> {
    let attempted = false;
    try {
      const names = await this.files();
      if (names.length >= this.maxSnapshots) return fail("REPOSITORY_CAPACITY");
      if (s.generation !== names.length + 1) return fail("STALE_REPOSITORY");
      const previous = names.length ? await this.read(names.at(-1)!) : null;
      if (s.previous !== (previous === null ? null : (previous as Snapshot).fingerprint))
        return fail("STALE_REPOSITORY");
      const data = stableStringify(s);
      let retainedBytes = Buffer.byteLength(data);
      for (const n of names) retainedBytes += (await lstat(join(this.root, n))).size;
      if (retainedBytes > this.maxRetainedBytes) return fail("RETAINED_STORAGE_CAPACITY");
      if (Buffer.byteLength(data) > this.maxBytes) return fail("STORAGE_BOUNDS");
      const name = `generation-${String(s.generation).padStart(8, "0")}.json`,
        temp = join(this.root, name + ".pending");
      attempted = true;
      await writeFile(temp, data, { flag: "wx" });
      await link(temp, join(this.root, name));
      await unlink(temp);
      const readback = await this.read(name);
      if (fingerprint(readback) !== fingerprint(s)) throw Error("READBACK_MISMATCH");
      return ok(freeze(readback as Snapshot));
    } catch {
      return fail(attempted ? "COMMITMENT_UNKNOWN" : "REPOSITORY_READ_FAILED", "UNKNOWN");
    }
  }
}
