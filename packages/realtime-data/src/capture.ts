import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { marketObservationSchema, schemas, stableMarketDataStringify } from "@ate/domain";
import type { Clock } from "@ate/time";
import { z } from "zod";
import { failure, hash, immutable, safeId } from "./primitives.js";
import type {
  AcceptedObservation,
  CaptureManifest,
  MaterializationHandoff,
  RealtimeResult,
} from "./types.js";

const manifestShape = z
  .object({
    captureId: z.string(),
    state: z.enum(["RUNNING", "COMPLETED", "FAILED", "ABORTED"]),
    count: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    storageReference: z.string(),
  })
  .passthrough();
export interface CaptureRepository {
  // NOT_CREATED certifies this attempt performed no mutating storage operation.
  // It says nothing about artifacts predating this attempt. Missing evidence means UNKNOWN.
  start(manifest: CaptureManifest): CaptureStartResult;
  append(captureId: string, record: AcceptedObservation): RealtimeResult<void>;
  finish(
    captureId: string,
    evidence: CaptureManifest["evidence"],
  ): RealtimeResult<MaterializationHandoff>;
  abort(captureId: string): RealtimeResult<void>;
  recover(): RealtimeResult<readonly CaptureManifest[]>;
  verify(captureId: string): RealtimeResult<MaterializationHandoff>;
}
export type CaptureStartResult =
  | Extract<RealtimeResult<void>, { ok: true }>
  | (Extract<RealtimeResult<void>, { ok: false }> & {
      readonly commitment?: "NOT_CREATED";
    });
// Content final rename precedes the COMPLETED manifest commit marker. No reader infers completion
// from a filename. A manifest/data mismatch always fails verification; running state is aborted.
export class FilesystemCaptureRepository implements CaptureRepository {
  private readonly root: string;
  public constructor(
    root: string,
    private readonly clock: Clock,
    private readonly maxBytes: number,
    private readonly maxSessions: number,
  ) {
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1024 ||
      maxBytes > 67108864 ||
      !Number.isSafeInteger(maxSessions) ||
      maxSessions < 1 ||
      maxSessions > 1000
    )
      throw new Error("capture bounds");
    mkdirSync(root, { recursive: true });
    if (lstatSync(root).isSymbolicLink()) throw new Error("capture root symlink");
    this.root = realpathSync(root);
  }
  private directory(id: string): string {
    if (!safeId(id)) throw new Error("unsafe capture id");
    const p = join(this.root, id);
    if (
      existsSync(p) &&
      (lstatSync(p).isSymbolicLink() || realpathSync(p) !== resolve(this.root, id))
    )
      throw new Error("unsafe capture directory");
    return p;
  }
  private file(id: string, name: string): string {
    const p = join(this.directory(id), name);
    if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Error("capture symlink");
    return p;
  }
  private manifests(): string[] {
    const ids: string[] = [];
    const dir = opendirSync(this.root);
    try {
      let entry;
      while ((entry = dir.readSync()) !== null) {
        if (!entry.isDirectory() || entry.isSymbolicLink())
          throw new Error("invalid capture storage entry");
        if (ids.length >= this.maxSessions) throw new Error("capture capacity");
        ids.push(entry.name);
      }
    } finally {
      dir.closeSync();
    }
    return ids.sort();
  }
  private read(id: string): CaptureManifest {
    const p = this.file(id, "manifest.json");
    if (statSync(p).size > 262144) throw new Error("manifest bounds");
    const data: unknown = JSON.parse(readFileSync(p, "utf8"));
    const parsed = manifestShape.parse(data);
    const { manifestFingerprint, ...body } = parsed;
    if (
      typeof manifestFingerprint !== "string" ||
      hash(stableMarketDataStringify(body)) !== manifestFingerprint
    )
      throw new Error("manifest integrity");
    if (parsed.captureId !== id) throw new Error("manifest identity");
    return data as CaptureManifest;
  }
  private publish(m: CaptureManifest): void {
    const { manifestFingerprint: _previous, ...body } = m;
    const text = stableMarketDataStringify({
      ...body,
      manifestFingerprint: hash(stableMarketDataStringify(body)),
    });
    if (Buffer.byteLength(text) > 262144) throw new Error("manifest bounds");
    const temp = this.file(m.captureId, "manifest.tmp");
    const fd = openSync(temp, "w");
    try {
      writeFileSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, this.file(m.captureId, "manifest.json"));
  }
  public start(manifest: CaptureManifest): CaptureStartResult {
    let mutationAttempted = false;
    try {
      if (
        manifest.state !== "RUNNING" ||
        manifest.count !== 0 ||
        manifest.bytes !== 0 ||
        manifest.endedAt !== undefined ||
        manifest.contentFingerprint !== undefined
      )
        throw new Error("capture initial state");
      if (
        this.manifests().length >= this.maxSessions ||
        manifest.sessionIds.length > this.maxSessions ||
        manifest.subscriptions.length > 1000
      )
        throw new Error("capture capacity");
      const directory = this.directory(manifest.captureId);
      // Once a mutating call is attempted, even a failed call cannot certify no side effects.
      mutationAttempted = true;
      mkdirSync(directory);
      const fd = openSync(this.file(manifest.captureId, "records.partial"), "wx");
      closeSync(fd);
      this.publish(manifest);
      return { ok: true, value: undefined };
    } catch {
      const result = failure<void>(this.clock, "CAPTURE_FAILED", "capture");
      return !mutationAttempted && !result.ok ? { ...result, commitment: "NOT_CREATED" } : result;
    }
  }
  public append(id: string, record: AcceptedObservation): RealtimeResult<void> {
    try {
      const m = this.read(id);
      if (m.state !== "RUNNING") throw new Error("capture not running");
      if (
        record.ingress.configurationFingerprint !== m.configurationFingerprint ||
        record.ingress.sourceId !== m.source.sourceId ||
        !m.subscriptions.some((s) => s.subscriptionId === record.ingress.subscriptionId)
      )
        throw new Error("capture provenance mismatch");
      const text = stableMarketDataStringify(record) + "\n";
      const data = this.file(id, "records.partial");
      const bytes = Buffer.byteLength(text);
      if (statSync(data).size + bytes > this.maxBytes) throw new Error("capture file capacity");
      const sessions = [...new Set([...m.sessionIds, record.ingress.sessionId])];
      if (sessions.length > this.maxSessions) throw new Error("capture session capacity");
      const fd = openSync(data, "a");
      try {
        const buffer = Buffer.from(text);
        let offset = 0;
        while (offset < buffer.length) {
          const written = writeSync(fd, buffer, offset, buffer.length - offset);
          if (written <= 0) throw new Error("short write");
          offset += written;
        }
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.publish({
        ...m,
        count: m.count + 1,
        bytes: m.bytes + bytes,
        sessionIds: sessions,
        eventTimeRange: {
          start:
            m.eventTimeRange && m.eventTimeRange.start < record.observation.eventTime
              ? m.eventTimeRange.start
              : record.observation.eventTime,
          end:
            m.eventTimeRange && m.eventTimeRange.end > record.observation.eventTime
              ? m.eventTimeRange.end
              : record.observation.eventTime,
        },
      });
      return { ok: true, value: undefined };
    } catch {
      this.markFailed(id);
      return failure(this.clock, "CAPTURE_FAILED", "capture");
    }
  }
  private markFailed(id: string): void {
    try {
      const m = this.read(id);
      if (m.state === "RUNNING") this.publish({ ...m, state: "FAILED", endedAt: this.clock.now() });
    } catch {
      /* A missing/unreadable manifest remains uncommitted and recover() reports failure. */
    }
  }
  public finish(
    id: string,
    evidence: CaptureManifest["evidence"],
  ): RealtimeResult<MaterializationHandoff> {
    try {
      const m = this.read(id);
      if (m.state === "COMPLETED") return this.verify(id);
      if (m.state !== "RUNNING") throw new Error("capture state");
      const p = this.file(id, "records.partial");
      if (statSync(p).size > this.maxBytes) throw new Error("capture bounds");
      const text = readFileSync(p, "utf8");
      if (Buffer.byteLength(text) !== m.bytes || this.count(text) !== m.count)
        throw new Error("capture count");
      renameSync(p, this.file(id, "records.ndjson"));
      this.publish({
        ...m,
        state: "COMPLETED",
        endedAt: this.clock.now(),
        contentFingerprint: hash(text),
        evidence,
      });
      return this.verify(id);
    } catch {
      this.markFailed(id);
      return failure(this.clock, "CAPTURE_INTEGRITY_FAILED", "capture");
    }
  }
  private count(text: string): number {
    if (text !== "" && !text.endsWith("\n")) throw new Error("partial record");
    const lines = text === "" ? [] : text.trimEnd().split("\n");
    for (const line of lines) JSON.parse(line);
    return lines.length;
  }
  public verify(id: string): RealtimeResult<MaterializationHandoff> {
    try {
      const m = this.read(id);
      if (m.state !== "COMPLETED") throw new Error("not completed");
      const p = this.file(id, "records.ndjson");
      if (statSync(p).size > this.maxBytes) throw new Error("capture bounds");
      const text = readFileSync(p, "utf8");
      if (
        hash(text) !== m.contentFingerprint ||
        Buffer.byteLength(text) !== m.bytes ||
        this.count(text) !== m.count
      )
        throw new Error("capture integrity");
      return {
        ok: true,
        value: immutable({
          manifest: m,
          authority: "CAPTURE_ONLY",
          historicalMaterializationRequired: true,
          qualityAssessmentRequired: true,
          catalogueRegistrationRequired: true,
          researchQualified: false,
          tradingAuthorized: false,
        }),
      };
    } catch {
      return failure(this.clock, "CAPTURE_INTEGRITY_FAILED", "capture");
    }
  }
  /** Bounded read-only capture access. This does not materialize or qualify a dataset. */
  public readRecords(
    id: string,
    limit: number,
    cursor = 0,
  ): RealtimeResult<Readonly<{ records: readonly AcceptedObservation[]; nextCursor?: number }>> {
    try {
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 1000 ||
        !Number.isSafeInteger(cursor) ||
        cursor < 0
      )
        throw Error("READ_BOUNDS");
      const verified = this.verify(id);
      if (!verified.ok) return verified;
      const manifest = verified.value.manifest;
      const recordsPath = this.file(id, "records.ndjson");
      if (statSync(recordsPath).size > this.maxBytes) throw Error("READ_BOUNDS");
      const text = readFileSync(recordsPath, "utf8");
      if (hash(text) !== manifest.contentFingerprint || Buffer.byteLength(text) !== manifest.bytes)
        throw Error("READ_INTEGRITY");
      const lines = text === "" ? [] : text.trimEnd().split("\n");
      if (cursor > lines.length || lines.length !== manifest.count) throw Error("READ_CURSOR");
      const idString = z.string().min(1).max(128);
      const ingress = z
        .object({
          ingressId: idString,
          sourceId: idString,
          adapterId: idString,
          adapterVersion: idString,
          sessionId: idString,
          subscriptionId: idString,
          providerSymbol: idString,
          observationKind: z.enum(["QUOTE", "TICK", "TRADE", "BAR"]),
          eventId: idString.optional(),
          providerSequence: z
            .string()
            .regex(/^\d{1,40}$/u)
            .optional(),
          sourceTime: z.string().max(128).optional(),
          receivedAt: schemas.timestamp,
          localSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
          payloadFingerprint: idString,
          configurationFingerprint: idString,
        })
        .strict();
      const shape = z
        .object({
          ingress,
          observation: marketObservationSchema,
          processedAt: schemas.timestamp,
          warnings: z
            .array(
              z.enum([
                "LATE",
                "OUT_OF_ORDER",
                "SEQUENCE_GAP",
                "SOURCE_TIME_MISSING",
                "IDENTITY_UNCERTAIN",
                "CONTINUITY_UNCERTAIN",
                "SUBSCRIPTION_UNCERTAIN",
              ]),
            )
            .max(64),
        })
        .strict();
      const records = lines
        .slice(cursor, cursor + limit)
        .map((line) => shape.parse(JSON.parse(line)) as AcceptedObservation);
      if (
        records.some(
          (r) =>
            r.ingress.sourceId !== manifest.source.sourceId ||
            r.observation.source.sourceId !== manifest.source.sourceId ||
            r.ingress.configurationFingerprint !== manifest.configurationFingerprint ||
            !manifest.subscriptions.some((x) => x.subscriptionId === r.ingress.subscriptionId),
        )
      )
        throw Error("READ_PROVENANCE");
      return {
        ok: true,
        value: immutable({
          records,
          ...(cursor + records.length < lines.length
            ? { nextCursor: cursor + records.length }
            : {}),
        }),
      };
    } catch {
      return failure(this.clock, "CAPTURE_INTEGRITY_FAILED", "capture");
    }
  }
  public abort(id: string): RealtimeResult<void> {
    try {
      const m = this.read(id);
      if (m.state === "RUNNING")
        this.publish({ ...m, state: "ABORTED", endedAt: this.clock.now() });
      return { ok: true, value: undefined };
    } catch {
      return failure(this.clock, "PERSISTENCE_FAILED", "capture");
    }
  }
  public recover(): RealtimeResult<readonly CaptureManifest[]> {
    try {
      const recovered: CaptureManifest[] = [];
      for (const id of this.manifests()) {
        const m = this.read(id);
        if (m.state === "RUNNING") {
          const result = this.abort(id);
          if (!result.ok) return result;
        } else if (m.state === "COMPLETED") {
          const result = this.verify(id);
          if (!result.ok) return result;
        }
        recovered.push(immutable(this.read(id)));
      }
      return { ok: true, value: recovered };
    } catch {
      return failure(this.clock, "CAPTURE_INTEGRITY_FAILED", "capture");
    }
  }
}
