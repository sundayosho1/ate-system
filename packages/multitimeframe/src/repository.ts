import {
  mkdirSync,
  realpathSync,
  lstatSync,
  existsSync,
  openSync,
  closeSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  readFileSync,
  statSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import type { Clock } from "@ate/time";
import type { UtcTimestamp } from "@ate/domain";
import { freeze, hash, instant, ok, failure, safeClone, type Result } from "./primitives.js";
import type { Checkpoint, Contribution } from "./types.js";
export type Stored = Readonly<{
  operationId: string;
  checkpoint: Checkpoint;
  newRevisionIds: readonly string[];
  committedAt: UtcTimestamp;
  publishedAt: UtcTimestamp;
  fingerprint: string;
}>;
export type WriteResult<T> =
  | Result<T>
  | Readonly<{
      ok: false;
      error: { code: string; timestamp: UtcTimestamp };
      commitment: "CONFIRMED_NOT_COMMITTED";
    }>;
export interface AggregationRepository {
  commit(
    operationId: string,
    checkpoint: Checkpoint,
    newRevisionIds: readonly string[],
  ): WriteResult<{ committedAt: UtcTimestamp }>;
  publish(operationId: string): Result<{ publishedAt: UtcTimestamp }>;
  recover(
    context?: Readonly<{ configurationFingerprint: string; policyFingerprint: string }>,
  ): Result<Stored | null>;
}
export const lineage = (a: readonly Contribution[]) =>
  a.map(({ processedAt: _p, availableAt: _a, ...e }) => e);
export function materialize(s: Stored): Checkpoint {
  const ids = new Set(s.newRevisionIds);
  const revisions = s.checkpoint.revisions.map((r) =>
    ids.has(r.revisionId)
      ? freeze({
          ...r,
          committedAt: s.committedAt,
          publishedAt: s.publishedAt,
          availableAt: s.publishedAt,
        })
      : r,
  );
  const updated = new Map(revisions.map((r) => [r.revisionId, r]));
  const patch = (a: readonly Contribution[]) =>
    a.map((x) =>
      x.revisionId && updated.has(x.revisionId)
        ? { ...x, availableAt: updated.get(x.revisionId)!.availableAt }
        : x,
    );
  const final = revisions.map((r) => ({ ...r, constituents: patch(r.constituents) }));
  const windows = s.checkpoint.windows.map((w) => ({
    ...w,
    contributions: patch(w.contributions),
  }));
  const { fingerprint: _fingerprint, ...body } = s.checkpoint;
  return freeze({
    ...body,
    revisions: final,
    windows,
    fingerprint: hash({ ...body, revisions: final, windows }),
  });
}
// Bounded single-writer commit-marker adapter following Prompt 5 owned-state/history patterns.
// Full checkpoint contains content, lineage, quality and dependencies; publication is a separate marker.
export class FilesystemAggregationRepository implements AggregationRepository {
  private readonly root: string;
  public constructor(
    root: string,
    private readonly clock: Clock,
    private readonly maxBytes = 10485760,
    private readonly maxOperations = 4096,
  ) {
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 4096 ||
      maxBytes > 67108864 ||
      !Number.isSafeInteger(maxOperations) ||
      maxOperations < 1 ||
      maxOperations > 20000
    )
      throw Error("REPOSITORY_BOUNDS");
    mkdirSync(root, { recursive: true });
    if (lstatSync(root).isSymbolicLink()) throw Error("UNSAFE_ROOT");
    this.root = realpathSync(root);
  }
  private file(id: string, suffix: string): string {
    if (!/^[a-f0-9]{64}$/u.test(id)) throw Error("UNSAFE_ID");
    const p = join(this.root, id + suffix);
    if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw Error("UNSAFE_PATH");
    return p;
  }
  private write(path: string, content: string): void {
    const temp = path + ".tmp";
    if (existsSync(temp) && lstatSync(temp).isSymbolicLink()) throw Error("UNSAFE_PATH");
    const fd = openSync(temp, "w");
    try {
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  }
  private inventory(): string[] {
    const entries = readdirSync(this.root);
    // Capacity unit is one immutable operation ID, reserving its content, marker
    // and both temporary paths. Marker creation never consumes another slot.
    const ids = new Set<string>(),
      names = new Set(entries);
    for (const name of entries) {
      if (!/^[a-f0-9]{64}\.(json|visible)(\.tmp)?$/u.test(name)) throw Error("UNKNOWN_ARTIFACT");
      const id = name.slice(0, 64);
      const path = this.file(id, name.slice(64));
      if (statSync(path).size > (name.includes(".visible") ? 1024 : this.maxBytes))
        throw Error("ARTIFACT_BOUNDS");
      ids.add(id);
      if (!names.has(id + ".json")) throw Error("UNCOMMITTED_CONTENT");
    }
    if (ids.size > this.maxOperations) throw Error("REPOSITORY_CAPACITY");
    return [...ids];
  }
  private read(id: string): {
    operationId: string;
    checkpoint: Checkpoint;
    newRevisionIds: string[];
    committedAt: UtcTimestamp;
    fingerprint: string;
  } {
    const p = this.file(id, ".json");
    if (statSync(p).size > this.maxBytes) throw Error("CHECKPOINT_BOUNDS");
    const v = safeClone(JSON.parse(readFileSync(p, "utf8")), this.maxBytes) as ReturnType<
      FilesystemAggregationRepository["read"]
    >;
    const { fingerprint, ...body } = v;
    if (hash(body) !== fingerprint || v.operationId !== id) throw Error("CHECKPOINT_INTEGRITY");
    instant(v.committedAt);
    const { fingerprint: stateHash, ...state } = v.checkpoint;
    if (hash(state) !== stateHash) throw Error("CHECKPOINT_INTEGRITY");
    return v;
  }
  public commit(
    id: string,
    checkpoint: Checkpoint,
    newRevisionIds: readonly string[],
  ): WriteResult<{ committedAt: UtcTimestamp }> {
    let attempted = false;
    try {
      const p = this.file(id, ".json");
      const operations = this.inventory();
      if (existsSync(p)) {
        const prior = this.read(id);
        if (
          hash(prior.checkpoint) !== hash(checkpoint) ||
          hash(prior.newRevisionIds) !== hash(newRevisionIds)
        )
          throw Error("OPERATION_CONFLICT");
        return ok({ committedAt: prior.committedAt });
      }
      if (operations.length >= this.maxOperations) throw Error("REPOSITORY_CAPACITY");
      const { fingerprint: stateFingerprint, ...stateBody } = checkpoint;
      if (
        hash(stateBody) !== stateFingerprint ||
        checkpoint.generation !== operations.length + 1 ||
        id !== hash({ generation: checkpoint.generation, fingerprint: stateFingerprint })
      )
        throw Error("OPERATION_IDENTITY");
      const body = { operationId: id, checkpoint, newRevisionIds, committedAt: this.clock.now() };
      const content = JSON.stringify({ ...body, fingerprint: hash(body) });
      if (Buffer.byteLength(content) > this.maxBytes) throw Error("CHECKPOINT_BOUNDS");
      attempted = true;
      this.write(p, content);
      return ok({ committedAt: body.committedAt });
    } catch {
      const r = failure(this.clock, "COMMIT_FAILED");
      return !attempted && !r.ok ? { ...r, commitment: "CONFIRMED_NOT_COMMITTED" } : r;
    }
  }
  public publish(id: string): Result<{ publishedAt: UtcTimestamp }> {
    try {
      this.inventory();
      const committed = this.read(id),
        p = this.file(id, ".visible");
      if (existsSync(p)) {
        const marker = JSON.parse(readFileSync(p, "utf8")) as {
          fingerprint: string;
          publishedAt: UtcTimestamp;
        };
        if (marker.fingerprint !== committed.fingerprint) throw Error("MARKER_CONFLICT");
        return ok({ publishedAt: instant(marker.publishedAt) });
      }
      const publishedAt = this.clock.now();
      this.write(p, JSON.stringify({ fingerprint: committed.fingerprint, publishedAt }));
      return ok({ publishedAt });
    } catch {
      return failure(this.clock, "PUBLICATION_FAILED");
    }
  }
  public recover(
    context?: Readonly<{ configurationFingerprint: string; policyFingerprint: string }>,
  ): Result<Stored | null> {
    try {
      const entries = readdirSync(this.root);
      this.inventory();
      const records: Stored[] = [];
      const raw = entries
        .filter((n) => n.endsWith(".json"))
        .map((n) => this.read(n.slice(0, -5)))
        .sort((a, b) => a.checkpoint.generation - b.checkpoint.generation);
      for (let i = 0; i < raw.length; i++) {
        const r = raw[i]!;
        if (
          r.checkpoint.generation !== i + 1 ||
          (context &&
            (r.checkpoint.configurationFingerprint !== context.configurationFingerprint ||
              r.checkpoint.policyFingerprint !== context.policyFingerprint))
        )
          throw Error("CHECKPOINT_CONTEXT");
        if (
          r.operationId !==
          hash({ generation: r.checkpoint.generation, fingerprint: r.checkpoint.fingerprint })
        )
          throw Error("OPERATION_IDENTITY");
      }

      for (const name of entries.filter((n) => n.endsWith(".json")).sort()) {
        const id = name.slice(0, -5),
          r = this.read(id);
        let publishedAt: UtcTimestamp;
        const p = this.file(id, ".visible");
        if (existsSync(p)) {
          if (statSync(p).size > 1024) throw Error("MARKER_BOUNDS");
          const marker = JSON.parse(readFileSync(p, "utf8")) as {
            fingerprint: string;
            publishedAt: UtcTimestamp;
          };
          if (marker.fingerprint !== r.fingerprint) throw Error("MARKER_INTEGRITY");
          publishedAt = instant(marker.publishedAt);
        } else {
          const result = this.publish(id);
          if (!result.ok) return result;
          publishedAt = result.value.publishedAt;
        }
        if (
          Date.parse(publishedAt) < Date.parse(r.committedAt) ||
          Date.parse(publishedAt) > Date.parse(this.clock.now())
        )
          throw Error("PUBLICATION_TIME");
        records.push(freeze({ ...r, publishedAt }));
      }
      records.sort((a, b) => a.checkpoint.generation - b.checkpoint.generation);
      if (records.length && records[0]!.checkpoint.generation !== 1)
        throw Error("GENERATION_CONFLICT");
      for (let i = 1; i < records.length; i++)
        if (records[i]!.checkpoint.generation !== records[i - 1]!.checkpoint.generation + 1)
          throw Error("GENERATION_CONFLICT");
      return ok(records.at(-1) ?? null);
    } catch {
      return failure(this.clock, "RECOVERY_REQUIRED");
    }
  }
}
export class MemoryAggregationRepository implements AggregationRepository {
  private readonly records = new Map<string, Stored>();
  private readonly visible = new Set<string>();
  public constructor(
    private readonly clock: Clock,
    private readonly limit = 4096,
  ) {}
  public commit(
    id: string,
    checkpoint: Checkpoint,
    newRevisionIds: readonly string[],
  ): WriteResult<{ committedAt: UtcTimestamp }> {
    const old = this.records.get(id);
    if (old)
      return hash(old.checkpoint) === hash(checkpoint)
        ? ok({ committedAt: old.committedAt })
        : failure(this.clock, "OPERATION_CONFLICT");
    if (this.records.size >= this.limit) {
      const r = failure(this.clock, "REPOSITORY_CAPACITY");
      return !r.ok ? { ...r, commitment: "CONFIRMED_NOT_COMMITTED" } : r;
    }
    const committedAt = this.clock.now();
    const body = {
      operationId: id,
      checkpoint: freeze(structuredClone(checkpoint)),
      newRevisionIds: [...newRevisionIds],
      committedAt,
    };
    this.records.set(id, { ...body, publishedAt: committedAt, fingerprint: hash(body) });
    return ok({ committedAt });
  }
  public publish(id: string): Result<{ publishedAt: UtcTimestamp }> {
    const r = this.records.get(id);
    if (!r) return failure(this.clock, "NOT_COMMITTED");
    if (this.visible.has(id)) return ok({ publishedAt: r.publishedAt });
    const publishedAt = this.clock.now();
    this.records.set(id, { ...r, publishedAt });
    this.visible.add(id);
    return ok({ publishedAt });
  }
  public recover(
    context?: Readonly<{ configurationFingerprint: string; policyFingerprint: string }>,
  ): Result<Stored | null> {
    if (context)
      for (const r of this.records.values())
        if (
          r.checkpoint.configurationFingerprint !== context.configurationFingerprint ||
          r.checkpoint.policyFingerprint !== context.policyFingerprint
        )
          return failure(this.clock, "CHECKPOINT_CONTEXT");
    for (const id of this.records.keys())
      if (!this.visible.has(id)) {
        const r = this.publish(id);
        if (!r.ok) return r;
      }
    return ok(
      [...this.records.values()]
        .sort((a, b) => a.checkpoint.generation - b.checkpoint.generation)
        .at(-1) ?? null,
    );
  }
}
