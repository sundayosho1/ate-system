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
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import type { Clock } from "@ate/time";
import type { UtcTimestamp } from "@ate/domain";
import { hash, freeze, safeClone, instant } from "@ate/multitimeframe";
import type { ReplayCheckpoint, ReplaySessionSpecification } from "./types.js";
import { validateReplayCheckpoint, replayOperationId } from "./checkpoint.js";
export type ReplayStorageResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      code: string;
      commitment: "CONFIRMED_NOT_COMMITTED" | "UNKNOWN_COMMITMENT" | "COMMITTED";
      operationId: string;
    }>;
export type StoredReplayCheckpoint = Readonly<{
  operationId: string;
  checkpoint: ReplayCheckpoint;
  committedAt: UtcTimestamp;
  publishedAt: UtcTimestamp;
  fingerprint: string;
}>;
export interface ReplayCheckpointRepository {
  commit(
    checkpoint: ReplayCheckpoint,
  ): ReplayStorageResult<{ operationId: string; committedAt: UtcTimestamp }>;
  publish(operationId: string): ReplayStorageResult<{ publishedAt: UtcTimestamp }>;
  recover(spec: ReplaySessionSpecification): ReplayStorageResult<StoredReplayCheckpoint | null>;
}
type Content = Omit<StoredReplayCheckpoint, "publishedAt">;
export class FilesystemReplayCheckpointRepository implements ReplayCheckpointRepository {
  private readonly root: string;
  public constructor(
    root: string,
    private readonly clock: Clock,
    private readonly limits: ReplaySessionSpecification["resourceLimits"],
  ) {
    mkdirSync(root, { recursive: true });
    if (lstatSync(root).isSymbolicLink()) throw Error("UNSAFE_ROOT");
    this.root = realpathSync(root);
  }
  private file(id: string, suffix: string): string {
    if (!/^[a-f0-9]{64}$/u.test(id)) throw Error("UNSAFE_OPERATION_ID");
    const path = join(this.root, id + suffix);
    if (existsSync(path)) {
      const st = lstatSync(path);
      if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw Error("UNSAFE_ARTIFACT");
      if (st.size > (suffix.includes("visible") ? 1024 : this.limits.maxCheckpointBytes))
        throw Error("ARTIFACT_LIMIT");
    }
    return path;
  }
  private inventory(): string[] {
    const names = readdirSync(this.root);
    if (names.length > this.limits.maxRepositoryOperations * 4) throw Error("REPOSITORY_CAPACITY");
    const ids = new Set<string>();
    const knownNames = new Set(names);
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.(json|visible)(\.tmp)?$/u.test(name)) throw Error("UNKNOWN_ARTIFACT");
      const id = name.slice(0, 64);
      this.file(id, name.slice(64));
      ids.add(id);
      if (!knownNames.has(id + ".json")) throw Error("UNCOMMITTED_ARTIFACT");
    }
    if (ids.size > this.limits.maxRepositoryOperations) throw Error("REPOSITORY_CAPACITY");
    return [...ids];
  }
  private write(path: string, content: string): void {
    const id = path.slice(this.root.length + 1, this.root.length + 65);
    const suffix = path.slice(this.root.length + 65);
    const temporary = this.file(id, suffix + ".tmp");
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
  }
  private read(id: string): Content {
    const raw = safeClone(
      JSON.parse(readFileSync(this.file(id, ".json"), "utf8")),
      this.limits.maxCheckpointBytes,
    ) as Content;
    const { fingerprint, ...body } = raw;
    if (
      hash(body) !== fingerprint ||
      raw.operationId !== id ||
      replayOperationId(raw.checkpoint) !== id
    )
      throw Error("CONTENT_INTEGRITY");
    instant(raw.committedAt);
    return raw;
  }
  private marker(id: string, content: Content): UtcTimestamp | undefined {
    const path = this.file(id, ".visible");
    if (!existsSync(path)) return undefined;
    const marker = JSON.parse(readFileSync(path, "utf8")) as {
      fingerprint: string;
      publishedAt: UtcTimestamp;
    };
    if (marker.fingerprint !== content.fingerprint) throw Error("MARKER_INTEGRITY");
    const at = instant(marker.publishedAt);
    if (at < content.committedAt || at > this.clock.now()) throw Error("PUBLICATION_TIME");
    return at;
  }
  public commit(
    checkpoint: ReplayCheckpoint,
  ): ReplayStorageResult<{ operationId: string; committedAt: UtcTimestamp }> {
    const id = replayOperationId(checkpoint);
    let attempted = false;
    try {
      const ids = this.inventory();
      const path = this.file(id, ".json");
      if (existsSync(path)) {
        const old = this.read(id);
        if (hash(old.checkpoint) !== hash(checkpoint)) throw Error("OPERATION_CONFLICT");
        return { ok: true, value: { operationId: id, committedAt: old.committedAt } };
      }
      if (ids.length >= this.limits.maxRepositoryOperations) throw Error("REPOSITORY_CAPACITY");
      const prior = ids.map((x) => {
        const c = this.read(x).checkpoint;
        return {
          checkpoint: {
            sessionId: c.sessionId,
            generation: c.generation,
            specificationFingerprint: c.specificationFingerprint,
          },
        };
      });
      const sessions = new Set(prior.map((x) => x.checkpoint.sessionId));
      if (!sessions.has(checkpoint.sessionId) && sessions.size >= this.limits.maxSessions)
        throw Error("SESSION_CAPACITY");
      const own = prior
        .filter((x) => x.checkpoint.sessionId === checkpoint.sessionId)
        .sort((a, b) => a.checkpoint.generation - b.checkpoint.generation);
      if (
        checkpoint.generation !== own.length + 1 ||
        checkpoint.generation > this.limits.maxCheckpoints ||
        own.some(
          (x) => x.checkpoint.specificationFingerprint !== checkpoint.specificationFingerprint,
        )
      )
        throw Error("GENERATION_CONTEXT");
      const body = { operationId: id, checkpoint, committedAt: this.clock.now() };
      const content = JSON.stringify({ ...body, fingerprint: hash(body) });
      if (Buffer.byteLength(content) > this.limits.maxCheckpointBytes)
        throw Error("CHECKPOINT_LIMIT");
      attempted = true;
      this.write(path, content);
      return { ok: true, value: { operationId: id, committedAt: body.committedAt } };
    } catch {
      return {
        ok: false,
        code: "COMMIT_FAILED",
        operationId: id,
        commitment: attempted ? "UNKNOWN_COMMITMENT" : "CONFIRMED_NOT_COMMITTED",
      };
    }
  }
  public publish(id: string): ReplayStorageResult<{ publishedAt: UtcTimestamp }> {
    try {
      this.inventory();
      const content = this.read(id);
      const existing = this.marker(id, content);
      if (existing) return { ok: true, value: { publishedAt: existing } };
      const publishedAt = this.clock.now();
      if (publishedAt < content.committedAt) throw Error("PUBLICATION_TIME");
      this.write(
        this.file(id, ".visible"),
        JSON.stringify({ fingerprint: content.fingerprint, publishedAt }),
      );
      return { ok: true, value: { publishedAt } };
    } catch {
      return { ok: false, code: "PUBLICATION_FAILED", operationId: id, commitment: "COMMITTED" };
    }
  }
  public recover(
    spec: ReplaySessionSpecification,
  ): ReplayStorageResult<StoredReplayCheckpoint | null> {
    let operationId = hash(spec.sessionId);
    try {
      const selected = this.inventory()
        .flatMap((id) => {
          const c = this.read(id).checkpoint;
          return c.sessionId === spec.sessionId
            ? [{ operationId: id, generation: c.generation }]
            : [];
        })
        .sort((a, b) => a.generation - b.generation);
      // Validate the complete selected session before publishing any missing marker.
      for (let i = 0; i < selected.length; i++) {
        const r = this.read(selected[i]!.operationId);
        operationId = r.operationId;
        validateReplayCheckpoint(r.checkpoint, spec);
        if (r.checkpoint.generation !== i + 1) throw Error("GENERATION_CONFLICT");
        this.marker(r.operationId, r);
      }
      let latest: StoredReplayCheckpoint | null = null;
      for (const entry of selected) {
        const r = this.read(entry.operationId);
        operationId = r.operationId;
        const published = this.publish(r.operationId);
        if (!published.ok) return published;
        latest = freeze({ ...r, publishedAt: published.value.publishedAt });
      }
      return { ok: true, value: latest };
    } catch {
      return {
        ok: false,
        code: "RECOVERY_REQUIRED",
        operationId,
        commitment: "UNKNOWN_COMMITMENT",
      };
    }
  }
}
