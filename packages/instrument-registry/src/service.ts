import { safeClone } from "./boundary.js";
import { z } from "zod";
import { fingerprint, type EffectiveConfiguration } from "@ate/configuration";
import { freeze } from "@ate/multitimeframe";
import { schemas } from "@ate/domain";
import type { Clock } from "@ate/time";
import {
  canonicalId,
  definitionSchema,
  digest,
  ok,
  fail,
  type InstrumentDefinition,
  type Evidence,
  type Revision,
  type Snapshot,
  type Repository,
  type Result,
  type Resolution,
  type Conflict,
  type ImportManifest,
} from "./contracts.js";
import {
  policyFromEffective,
  policyFingerprint,
  taxonomyVersionFingerprint,
  type Policy,
} from "./policy.js";
import {
  prepare,
  validateNormalizationTrace,
  identityId,
  definitionFingerprint,
  normalize,
  validateIdentifier,
  compare,
} from "./normalization.js";
const revisionSchema = z
  .object({
    instrumentId: canonicalId,
    revisionId: digest,
    sequence: z.number().int().positive(),
    previous: digest.nullable(),
    definition: definitionSchema,
    normalization: z.array(
      z
        .object({
          status: z.enum(["NORMALIZED", "UNCHANGED", "AMBIGUOUS", "UNSUPPORTED", "INVALID"]),
          original: z.string(),
          value: z.string(),
          rule: z.string(),
          version: z.literal("N1"),
          path: z.string().min(1).max(128).optional(),
        })
        .strict(),
    ),
    changedFields: z.array(z.string()),
    justification: z.string().min(1).max(2048),
    configurationFingerprint: digest,
    recordedAt: schemas.timestamp,
    clockProvenance: z.unknown(),
    fingerprint: digest,
  })
  .strict();
const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    registryId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    generation: z.number().int().positive(),
    previous: digest.nullable(),
    policyFingerprint: digest,
    configurationFingerprint: digest,
    revisions: z.array(revisionSchema),
    conflicts: z.array(
      z
        .object({
          conflictId: digest,
          instrumentId: canonicalId,
          reason: z.string(),
          evidenceFingerprint: digest,
        })
        .strict(),
    ),
    imports: z.array(
      z
        .object({
          importId: digest,
          inputFingerprint: digest,
          outcomes: z.array(
            z
              .object({
                input: digest,
                status: z.enum(["REGISTERED", "IDEMPOTENT", "CONFLICT"]),
                revisionId: digest.nullable(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    fingerprint: digest,
  })
  .strict();
const semanticRevision = (r: Revision) => ({
  instrumentId: r.instrumentId,
  sequence: r.sequence,
  previous: r.previous,
  definition: r.definition,
  changedFields: r.changedFields,
  justification: r.justification,
  configurationFingerprint: r.configurationFingerprint,
});
const contentSnapshot = (s: Snapshot) => ({
  schemaVersion: s.schemaVersion,
  registryId: s.registryId,
  generation: s.generation,
  previous: s.previous,
  policyFingerprint: s.policyFingerprint,
  configurationFingerprint: s.configurationFingerprint,
  revisions: s.revisions,
  conflicts: s.conflicts,
  imports: s.imports,
});
const latest = (rows: readonly Revision[]) => {
  const m = new Map<string, Revision>();
  for (const r of rows) m.set(r.instrumentId, r);
  return m;
};
export class InstrumentRegistry {
  private readonly policy: Policy;
  private readonly configurationFingerprint: string;
  private readonly pf: string;
  private state: Snapshot | undefined;
  private snapshots: Snapshot[] = [];
  private busy = false;
  private lifecycle: "CREATED" | "FAILED" | "READY" | "RECOVERY_REQUIRED" | "STOPPED" = "CREATED";
  public constructor(
    private readonly registryId: string,
    private readonly ports: {
      clock: Clock;
      repository: Repository;
      configuration: () => EffectiveConfiguration;
      verifyEvidence?: (evidence: Evidence, definition: InstrumentDefinition) => boolean;
    },
  ) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(registryId)) throw Error("INVALID_REGISTRY_ID");
    const governed = policyFromEffective(ports.configuration());
    this.policy = governed.policy;
    this.configurationFingerprint = governed.configurationFingerprint;
    this.pf = policyFingerprint(this.policy);
  }
  public diagnostics() {
    const wasBusy = this.busy;
    let configurationAligned: boolean | null = wasBusy ? null : true;
    if (!wasBusy) {
      this.busy = true;
      try {
        this.assertPolicy();
      } catch {
        configurationAligned = false;
      } finally {
        this.busy = false;
      }
    }
    return freeze({
      lifecycle: this.lifecycle,
      busy: wasBusy,
      configurationAligned,
      readiness:
        this.lifecycle === "READY" && !wasBusy && configurationAligned === true
          ? "READY"
          : "NOT_READY",
      health:
        ["RECOVERY_REQUIRED", "FAILED"].includes(this.lifecycle) || configurationAligned === false
          ? "DEGRADED"
          : "HEALTHY",
      generation: this.state?.generation ?? 0,
      registryId: this.registryId,
      publicationDurability: "REPOSITORY_ACK_ONLY",
      recoveryRequired: this.lifecycle === "RECOVERY_REQUIRED",
    });
  }
  private assertPolicy() {
    try {
      const p = policyFromEffective(this.ports.configuration());
      if (
        p.configurationFingerprint !== this.configurationFingerprint ||
        policyFingerprint(p.policy) !== this.pf
      )
        throw Error("CONFIGURATION_DRIFT");
    } catch {
      throw Error("CONFIGURATION_DRIFT");
    }
  }
  public async initialize(): Promise<Result<void>> {
    if (this.busy || !["CREATED", "FAILED"].includes(this.lifecycle))
      return fail("INVALID_LIFECYCLE");
    this.busy = true;
    let repositoryEntered = false;
    try {
      this.assertPolicy();
      repositoryEntered = true;
      const loaded = await this.ports.repository.load();
      if (!loaded.ok) {
        this.lifecycle = "RECOVERY_REQUIRED";
        return loaded;
      }
      if (loaded.value.length > this.policy.maxSnapshots) throw Error("SNAPSHOT_CAPACITY");
      let previous: Snapshot | undefined;
      const verified: Snapshot[] = [];
      let retainedBytes = 0;
      for (const raw of loaded.value) {
        const s = this.validateSnapshot(raw, previous);
        retainedBytes += Buffer.byteLength(JSON.stringify(s));
        if (retainedBytes > this.policy.maxRetainedSnapshotBytes)
          throw Error("RETAINED_STORAGE_CAPACITY");
        verified.push(s);
        previous = s;
      }
      this.snapshots = verified;
      this.state = previous;
      this.lifecycle = "READY";
      return ok(undefined);
    } catch {
      this.lifecycle = repositoryEntered ? "RECOVERY_REQUIRED" : "FAILED";
      return fail(
        repositoryEntered ? "RECOVERY_VALIDATION_FAILED" : "INITIALIZATION_CONFIGURATION_FAILED",
        repositoryEntered ? "UNKNOWN" : "NONE",
      );
    } finally {
      this.busy = false;
    }
  }
  private validateSnapshot(raw: unknown, previous?: Snapshot): Snapshot {
    const s = freeze(
      snapshotSchema.parse(safeClone(raw, this.policy.maxSnapshotBytes)),
    ) as Snapshot;
    if (
      s.registryId !== this.registryId ||
      s.policyFingerprint !== this.pf ||
      s.configurationFingerprint !== this.configurationFingerprint
    )
      throw Error("FOREIGN_REGISTRY_OR_POLICY");
    if (
      s.generation !== (previous?.generation ?? 0) + 1 ||
      s.previous !== (previous?.fingerprint ?? null) ||
      s.fingerprint !== fingerprint(contentSnapshot(s))
    )
      throw Error("SNAPSHOT_CHAIN");
    if (s.conflicts.length > this.policy.maxConflicts || s.imports.length > this.policy.maxImports)
      throw Error("EVIDENCE_CAPACITY");
    if (previous) {
      for (const [key, old] of [
        ["revisions", previous.revisions],
        ["conflicts", previous.conflicts],
        ["imports", previous.imports],
      ] as const) {
        const current = s[key];
        if (
          current.length < old.length ||
          fingerprint(current.slice(0, old.length)) !== fingerprint(old)
        )
          throw Error("HISTORY_REPLACEMENT");
      }
    }
    if (
      new Set(s.conflicts.map((c) => c.conflictId)).size !== s.conflicts.length ||
      new Set(s.imports.map((m) => m.importId)).size !== s.imports.length
    )
      throw Error("DUPLICATE_HISTORY_EVIDENCE");
    const seen = new Map<string, Revision>();
    const ids = new Set<string>();
    for (const row of s.revisions) {
      const prepared = prepare(row.definition, this.policy);
      validateNormalizationTrace(prepared.definition, row.normalization, this.policy);
      if (fingerprint(prepared.definition) !== fingerprint(row.definition))
        throw Error("NONCANONICAL_DEFINITION");
      if (
        [
          ...row.definition.evidence,
          ...row.definition.identifiers.map((i) => i.evidence),
          ...row.definition.aliases.map((a) => a.evidence),
          ...row.definition.relationships.map((r) => r.evidence),
        ].some(
          (e) =>
            e.observedAt !== undefined && Date.parse(e.observedAt) > Date.parse(row.recordedAt),
        )
      )
        throw Error("FUTURE_RECORDED_EVIDENCE");
      const before = seen.get(row.instrumentId);
      if (
        row.instrumentId !== identityId(row.definition.identity) ||
        row.sequence !== (before?.sequence ?? 0) + 1 ||
        row.previous !== (before?.revisionId ?? null) ||
        row.revisionId !== fingerprint(semanticRevision(row)) ||
        row.fingerprint !== row.revisionId ||
        row.configurationFingerprint !== this.configurationFingerprint ||
        ids.has(row.revisionId)
      )
        throw Error("REVISION_CHAIN");
      if (row.sequence > this.policy.maxRevisions) throw Error("REVISION_CAPACITY");
      const changed = this.changed(before?.definition, row.definition);
      if (fingerprint(changed) !== fingerprint(row.changedFields)) throw Error("CHANGED_FIELDS");
      if (before?.definition.status === "RETIRED" && row.definition.status !== "RETIRED")
        throw Error("RETIRED_IDENTITY");
      this.validateRelations(row.definition, row.instrumentId, seen);
      seen.set(row.instrumentId, row);
      ids.add(row.revisionId);
    }
    if (seen.size > this.policy.maxInstruments) throw Error("REGISTRY_CAPACITY");
    for (const c of s.conflicts)
      if (
        c.conflictId !==
        fingerprint({
          instrumentId: c.instrumentId,
          reason: c.reason,
          evidenceFingerprint: c.evidenceFingerprint,
        })
      )
        throw Error("CONFLICT_INTEGRITY");
    for (const m of s.imports) {
      if (
        m.importId !==
        fingerprint({ registryId: this.registryId, inputFingerprint: m.inputFingerprint })
      )
        throw Error("IMPORT_INTEGRITY");
      if (m.outcomes.length > this.policy.maxImportBatch) throw Error("IMPORT_BOUNDS");
      if (
        !m.outcomes.length ||
        m.inputFingerprint !== fingerprint(m.outcomes.map((r) => r.input).sort(compare))
      )
        throw Error("IMPORT_INPUT_INTEGRITY");
      for (const result of m.outcomes) {
        if (result.status === "CONFLICT") {
          if (
            result.revisionId !== null ||
            !s.conflicts.some((c) => c.evidenceFingerprint === result.input)
          )
            throw Error("IMPORT_CONFLICT_INTEGRITY");
        } else {
          const row = s.revisions.find((r) => r.revisionId === result.revisionId);
          if (!row || definitionFingerprint(row.definition) !== result.input)
            throw Error("IMPORT_REVISION_SUBSTITUTION");
        }
      }
    }
    return freeze(s);
  }
  private changed(before: InstrumentDefinition | undefined, after: InstrumentDefinition): string[] {
    return [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])]
      .filter(
        (k) =>
          fingerprint((before as unknown as Record<string, unknown> | undefined)?.[k] ?? null) !==
          fingerprint((after as unknown as Record<string, unknown>)[k] ?? null),
      )
      .sort(compare);
  }
  private assertEvidence(d: InstrumentDefinition): void {
    const evidence = [
      ...d.evidence,
      ...d.identifiers.map((i) => i.evidence),
      ...d.aliases.map((a) => a.evidence),
      ...d.relationships.map((r) => r.evidence),
    ];
    for (const e of evidence)
      if (
        (e.verification === "VERIFIED" || e.timeAuthority === "EVIDENCED") &&
        this.ports.verifyEvidence?.(e, d) !== true
      )
        throw Error("EVIDENCE_NOT_VERIFIED");
  }
  private validateRelations(
    d: InstrumentDefinition,
    id: string,
    records: Map<string, Revision>,
  ): void {
    this.assertEvidence(d);
    if ("underlying" in d.identity) {
      const target = records.get(d.identity.underlying);
      if (
        !target ||
        target.instrumentId === id ||
        ["OPTION", "FUTURE"].includes(target.definition.identity.family)
      )
        throw Error("INVALID_UNDERLYING");
    }
    for (const edge of d.relationships) {
      const target = records.get(edge.target);
      if (!target || edge.target === id) throw Error("INVALID_RELATIONSHIP_TARGET");
      if (edge.type === "REPLACES" && d.identity.family !== target.definition.identity.family)
        throw Error("RELATIONSHIP_ENDPOINTS");
      if (
        edge.type === "TRACKS_INDEX" &&
        (d.identity.family !== "FUND" || target.definition.identity.family !== "INDEX")
      )
        throw Error("RELATIONSHIP_ENDPOINTS");
      if (
        edge.type === "SHARE_CLASS_OF" &&
        (d.identity.family !== "EQUITY" || target.definition.identity.family !== "EQUITY")
      )
        throw Error("RELATIONSHIP_ENDPOINTS");
      if (
        edge.type === "UNDERLYING_OF" &&
        (!("underlying" in target.definition.identity) ||
          target.definition.identity.underlying !== id)
      )
        throw Error("RELATIONSHIP_ENDPOINTS");
      if (
        edge.type === "REPRESENTS_ASSET" &&
        (d.identity.family !== "DIGITAL" || target.definition.identity.family !== "DIGITAL")
      )
        throw Error("RELATIONSHIP_ENDPOINTS");
      if (["DERIVED_FROM", "SHARE_CLASS_OF", "REPLACES"].includes(edge.type)) {
        const visited = new Set<string>();
        const queue = [edge.target];
        while (queue.length) {
          const v = queue.pop()!;
          if (v === id) throw Error("RELATIONSHIP_CYCLE");
          if (visited.has(v)) continue;
          visited.add(v);
          if (visited.size > this.policy.maxInstruments) throw Error("GRAPH_BOUNDS");
          for (const e of records.get(v)?.definition.relationships ?? [])
            if (e.type === edge.type) queue.push(e.target);
        }
      }
    }
  }
  private makeRevision(
    d: InstrumentDefinition,
    normalization: Revision["normalization"],
    previous: Revision | undefined,
    justification: string,
  ): Revision {
    const base = {
      instrumentId: identityId(d.identity),
      sequence: (previous?.sequence ?? 0) + 1,
      previous: previous?.revisionId ?? null,
      definition: d,
      changedFields: this.changed(previous?.definition, d),
      justification,
      configurationFingerprint: this.configurationFingerprint,
    };
    const hash = fingerprint(base);
    const now = schemas.timestamp.parse(this.ports.clock.now());
    if (
      [
        ...d.evidence,
        ...d.identifiers.map((i) => i.evidence),
        ...d.aliases.map((a) => a.evidence),
        ...d.relationships.map((r) => r.evidence),
      ].some((e) => e.observedAt !== undefined && Date.parse(e.observedAt) > Date.parse(now))
    )
      throw Error("FUTURE_EVIDENCE");
    return freeze({
      ...base,
      normalization,
      revisionId: hash,
      fingerprint: hash,
      recordedAt: now,
      clockProvenance: safeClone(this.ports.clock.provenance),
    });
  }
  private envelope(
    revisions: readonly Revision[],
    conflicts: readonly Conflict[],
    imports: readonly ImportManifest[],
  ): Snapshot {
    const base = {
      schemaVersion: 1 as const,
      registryId: this.registryId,
      generation: (this.state?.generation ?? 0) + 1,
      previous: this.state?.fingerprint ?? null,
      policyFingerprint: this.pf,
      configurationFingerprint: this.configurationFingerprint,
      revisions,
      conflicts,
      imports,
    };
    return freeze({ ...base, fingerprint: fingerprint(base) });
  }
  private async persist(next: Snapshot): Promise<Result<Snapshot>> {
    if (
      this.snapshots.reduce((sum, s) => sum + Buffer.byteLength(JSON.stringify(s)), 0) +
        Buffer.byteLength(JSON.stringify(next)) >
        this.policy.maxRetainedSnapshotBytes ||
      next.generation > this.policy.maxSnapshots ||
      Buffer.byteLength(JSON.stringify(next)) > this.policy.maxSnapshotBytes
    )
      return fail("SNAPSHOT_CAPACITY");
    // No source of rejection after repository entry can prove noncommitment.
    try {
      const report = await this.ports.repository.commit(next);
      const certificate = z.discriminatedUnion("ok", [
        z.object({ ok: z.literal(true), value: snapshotSchema }).strict(),
        z
          .object({
            ok: z.literal(false),
            error: z
              .object({ code: z.string().min(1).max(128), commitment: z.enum(["NONE", "UNKNOWN"]) })
              .strict(),
          })
          .strict(),
      ]);
      const result = certificate.parse(safeClone(report, this.policy.maxSnapshotBytes + 1024));
      if (!result.ok) {
        if (result.error.commitment === "UNKNOWN") this.lifecycle = "RECOVERY_REQUIRED";
        return result;
      }
      if (fingerprint(result.value) !== fingerprint(next)) {
        this.lifecycle = "RECOVERY_REQUIRED";
        return fail("ACK_MISMATCH", "UNKNOWN");
      }
      this.state = next;
      this.snapshots.push(next);
      return ok(next);
    } catch {
      this.lifecycle = "RECOVERY_REQUIRED";
      return fail("COMMITMENT_UNKNOWN", "UNKNOWN");
    }
  }
  private async mutate<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
    if (this.lifecycle !== "READY" || this.busy) return fail("REGISTRY_NOT_READY");
    this.busy = true;
    try {
      this.assertPolicy();
      return await work();
    } catch {
      return fail("INVALID_INPUT");
    } finally {
      this.busy = false;
    }
  }
  public async register(raw: unknown): Promise<Result<Revision>> {
    return this.mutate(async () => {
      const prepared = prepare(raw, this.policy),
        id = identityId(prepared.definition.identity),
        rows = this.state?.revisions ?? [],
        m = latest(rows),
        previous = m.get(id);
      if (previous) {
        if (
          definitionFingerprint(previous.definition) === definitionFingerprint(prepared.definition)
        )
          return ok(previous);
        return this.recordConflict(
          id,
          "IDENTITY_CONTENT_CONFLICT",
          fingerprint(prepared.definition),
        );
      }
      if (m.size >= this.policy.maxInstruments) return fail("REGISTRY_CAPACITY");
      this.validateRelations(prepared.definition, id, m);
      const row = this.makeRevision(
        prepared.definition,
        prepared.normalization,
        undefined,
        "INITIAL_REGISTRATION",
      );
      const result = await this.persist(
        this.envelope([...rows, row], this.state?.conflicts ?? [], this.state?.imports ?? []),
      );
      return result.ok ? ok(row) : result;
    });
  }
  private async recordConflict(id: string, reason: string, input: string): Promise<Result<never>> {
    const c = { instrumentId: id, reason, evidenceFingerprint: input };
    const conflict = freeze({ ...c, conflictId: fingerprint(c) }),
      conflicts = this.state?.conflicts ?? [];
    if (conflicts.some((c) => c.conflictId === conflict.conflictId))
      return fail("IDENTITY_CONFLICT");
    if (conflicts.length >= this.policy.maxConflicts) return fail("CONFLICT_CAPACITY");
    const result = await this.persist(
      this.envelope(
        this.state?.revisions ?? [],
        [...conflicts, conflict],
        this.state?.imports ?? [],
      ),
    );
    return result.ok ? fail("IDENTITY_CONFLICT") : result;
  }
  public async revise(
    id: string,
    expectedRevision: string,
    raw: unknown,
    justification: string,
  ): Promise<Result<Revision>> {
    return this.mutate(async () => {
      if (typeof justification !== "string" || !justification.trim() || justification.length > 2048)
        return fail("JUSTIFICATION_REQUIRED");
      const rows = this.state?.revisions ?? [],
        m = latest(rows),
        before = m.get(id);
      if (!before) return fail("NOT_FOUND");
      if (before.revisionId !== expectedRevision) return fail("STALE_REVISION");
      const p = prepare(raw, this.policy);
      if (identityId(p.definition.identity) !== id) return fail("IDENTITY_IMMUTABLE");
      if (before.definition.status === "RETIRED" && p.definition.status !== "RETIRED")
        return fail("RETIRED_IDENTITY");
      if (definitionFingerprint(before.definition) === definitionFingerprint(p.definition))
        return ok(before);
      if (before.sequence >= this.policy.maxRevisions) return fail("REVISION_CAPACITY");
      this.validateRelations(p.definition, id, m);
      const row = this.makeRevision(p.definition, p.normalization, before, justification);
      const result = await this.persist(
        this.envelope([...rows, row], this.state?.conflicts ?? [], this.state?.imports ?? []),
      );
      return result.ok ? ok(row) : result;
    });
  }
  public async importJson(raw: unknown): Promise<Result<ImportManifest>> {
    if (
      typeof raw !== "string" ||
      Buffer.byteLength(raw) >
        Math.min(
          this.policy.maxRecordBytes * this.policy.maxImportBatch,
          this.policy.maxSnapshotBytes,
        )
    )
      return fail("IMPORT_BOUNDS");
    try {
      return await this.importRecords(JSON.parse(raw));
    } catch {
      return fail("INVALID_JSON");
    }
  }
  public async importRecords(raw: unknown): Promise<Result<ImportManifest>> {
    return this.mutate(async () => {
      const input = safeClone(
        raw,
        Math.min(
          this.policy.maxRecordBytes * this.policy.maxImportBatch,
          this.policy.maxSnapshotBytes,
        ),
      );
      if (!Array.isArray(input) || !input.length || input.length > this.policy.maxImportBatch)
        return fail("IMPORT_BOUNDS");
      const prepared = input
        .map((v) => prepare(v, this.policy))
        .sort(
          (a, b) =>
            compare(fingerprint(a.definition), fingerprint(b.definition)) ||
            compare(fingerprint(a.normalization), fingerprint(b.normalization)),
        );
      const identities = new Map<string, string>();
      for (const p of prepared) {
        const id = identityId(p.definition.identity),
          hash = fingerprint(p.definition),
          before = identities.get(id);
        if (before !== undefined && before !== hash) return fail("CONFLICTING_BATCH_IDENTITY");
        identities.set(id, hash);
      }
      const inputFingerprint = fingerprint(prepared.map((p) => fingerprint(p.definition))),
        importId = fingerprint({ registryId: this.registryId, inputFingerprint });
      const imports = this.state?.imports ?? [],
        existing = imports.find((m) => m.importId === importId);
      if (existing) return ok(existing);
      if (imports.length >= this.policy.maxImports) return fail("IMPORT_CAPACITY");
      const rows = [...(this.state?.revisions ?? [])],
        conflicts = [...(this.state?.conflicts ?? [])],
        m = latest(rows),
        outcomes: ImportManifest["outcomes"][number][] = [];
      // Topological deterministic admission permits underlying records in the same batch.
      const pending = [...prepared];
      while (pending.length) {
        let progress = false;
        for (let i = 0; i < pending.length;) {
          const p = pending[i]!,
            id = identityId(p.definition.identity),
            hash = fingerprint(p.definition),
            previous = m.get(id);
          if ("underlying" in p.definition.identity && !m.has(p.definition.identity.underlying)) {
            i++;
            continue;
          }
          if (p.definition.relationships.some((e) => !m.has(e.target))) {
            i++;
            continue;
          }
          if (previous) {
            if (definitionFingerprint(previous.definition) === hash)
              outcomes.push({ input: hash, status: "IDEMPOTENT", revisionId: previous.revisionId });
            else {
              const c = {
                  instrumentId: id,
                  reason: "IMPORT_CONTENT_CONFLICT",
                  evidenceFingerprint: hash,
                },
                conflict = { ...c, conflictId: fingerprint(c) };
              if (!conflicts.some((c) => c.conflictId === conflict.conflictId))
                conflicts.push(conflict);
              outcomes.push({ input: hash, status: "CONFLICT", revisionId: null });
            }
          } else {
            if (m.size >= this.policy.maxInstruments) return fail("REGISTRY_CAPACITY");
            this.validateRelations(p.definition, id, m);
            const row = this.makeRevision(
              p.definition,
              p.normalization,
              undefined,
              "INITIAL_REGISTRATION",
            );
            rows.push(row);
            m.set(id, row);
            outcomes.push({ input: hash, status: "REGISTERED", revisionId: row.revisionId });
          }
          pending.splice(i, 1);
          progress = true;
        }
        if (!progress) return fail("UNRESOLVED_IMPORT_REFERENCES");
      }
      if (conflicts.length > this.policy.maxConflicts) return fail("CONFLICT_CAPACITY");
      outcomes.sort((a, b) => compare(a.input, b.input));
      const manifest = freeze({ importId, inputFingerprint, outcomes });
      const result = await this.persist(this.envelope(rows, conflicts, [...imports, manifest]));
      return result.ok ? ok(manifest) : result;
    });
  }
  private read<T>(work: () => T): Result<T> {
    if (this.lifecycle !== "READY" || this.busy) return fail("REGISTRY_NOT_READY");
    this.busy = true;
    try {
      this.assertPolicy();
      return ok(freeze(work()));
    } catch {
      return fail("INVALID_QUERY");
    } finally {
      this.busy = false;
    }
  }
  public exportManifest() {
    return this.read(() => {
      const references = (this.state?.revisions ?? []).map((r) => ({
        instrumentId: r.instrumentId,
        revisionId: r.revisionId,
        sequence: r.sequence,
      }));
      const content = {
        schemaVersion: 1,
        registryId: this.registryId,
        configurationFingerprint: this.configurationFingerprint,
        policyFingerprint: this.pf,
        references,
      };
      return { ...content, fingerprint: fingerprint(content) };
    });
  }
  public snapshot(): Result<Snapshot | undefined> {
    return this.read(() => this.state);
  }
  public snapshotAt(hash: string): Result<Snapshot> {
    return this.read(() => {
      const s = this.snapshots.find((s) => s.fingerprint === hash);
      if (!s) throw Error("SNAPSHOT_NOT_FOUND");
      return s;
    });
  }
  public get(id: string, snapshotFingerprint?: string): Result<Revision | undefined> {
    return this.read(() => {
      canonicalId.parse(id);
      const rows = snapshotFingerprint
        ? this.snapshots.find((s) => s.fingerprint === snapshotFingerprint)?.revisions
        : this.state?.revisions;
      if (snapshotFingerprint && !rows) throw Error("SNAPSHOT_NOT_FOUND");
      return latest(rows ?? []).get(id);
    });
  }
  public revision(id: string): Result<Revision | undefined> {
    return this.read(() => {
      digest.parse(id);
      return this.state?.revisions.find((r) => r.revisionId === id);
    });
  }
  public history(id: string): Result<readonly Revision[]> {
    return this.read(() => {
      canonicalId.parse(id);
      return (this.state?.revisions ?? []).filter((r) => r.instrumentId === id);
    });
  }
  public diff(a: string, b: string): Result<readonly string[]> {
    return this.read(() => {
      const left = this.state?.revisions.find((r) => r.revisionId === a),
        right = this.state?.revisions.find((r) => r.revisionId === b);
      if (!left || !right || left.instrumentId !== right.instrumentId)
        throw Error("REVISION_MISMATCH");
      return this.changed(left.definition, right.definition);
    });
  }
  public taxonomy(version: string) {
    return this.read(() => {
      const t = this.policy.taxonomies.find((t) => t.version === version);
      return t ? { ...t, fingerprint: taxonomyVersionFingerprint(t) } : undefined;
    });
  }
  public relationships(id: string) {
    return this.read(
      () => latest(this.state?.revisions ?? []).get(id)?.definition.relationships ?? [],
    );
  }
  public provenance(id: string) {
    return this.read(() => latest(this.state?.revisions ?? []).get(id)?.definition.evidence ?? []);
  }
  public conflicts(): Result<readonly Conflict[]> {
    return this.read(() => this.state?.conflicts ?? []);
  }
  public search(
    query: { family?: string; subtype?: string; offset?: number; limit?: number } = {},
  ): Result<readonly Revision[]> {
    return this.read(() => {
      const q = safeClone(query) as typeof query;
      const offset = q.offset ?? 0,
        limit = q.limit ?? this.policy.maxQueryResults;
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > this.policy.maxQueryResults
      )
        throw Error("QUERY_BOUNDS");
      return [...latest(this.state?.revisions ?? []).values()]
        .filter(
          (r) =>
            (!q.family || r.definition.identity.family === q.family) &&
            (!q.subtype || r.definition.identity.kind === q.subtype),
        )
        .sort((a, b) => compare(a.instrumentId, b.instrumentId))
        .slice(offset, offset + limit);
    });
  }
  public resolve(raw: unknown): Result<Resolution> {
    return this.read(() => {
      const q = z
        .object({
          canonicalId: canonicalId.optional(),
          scheme: z.string().max(64).optional(),
          value: z.string().max(256).optional(),
          scope: z.string().max(128).optional(),
          authority: z.string().max(128).optional(),
          aliasKind: z
            .enum(["SYMBOL", "DISPLAY", "HISTORICAL", "DATASET", "PROVIDER", "BROKER", "TERMINAL"])
            .optional(),
          rule: z.enum(["EXACT", "CASE", "PAIR"]).optional(),
          family: z.string().max(64).optional(),
          jurisdiction: z.string().max(128).optional(),
        })
        .strict()
        .safeParse(safeClone(raw));
      const boundary =
        this.state?.fingerprint ?? fingerprint({ registryId: this.registryId, empty: true });
      let matchedEvidence: Evidence[] = [];
      const result = (
        status: Resolution["status"],
        candidates: Revision[] = [],
        reason: string = status,
        normalization: Resolution["normalization"] = null,
      ): Resolution => ({
        status,
        candidates,
        evidence: [
          ...new Map(
            [...candidates.flatMap((r) => r.definition.evidence), ...matchedEvidence].map(
              (e) => [fingerprint(e), e] as const,
            ),
          ).entries(),
        ]
          .sort(([a], [b]) => compare(a, b))
          .map(([, e]) => e),
        normalization,
        reason,
        snapshotFingerprint: boundary,
      });
      if (!q.success) return result("INVALID_INPUT");
      const v = q.data,
        rows = [...latest(this.state?.revisions ?? []).values()];
      let found: Revision[],
        n: Resolution["normalization"] = null;
      let exact = false;
      if (v.canonicalId) {
        found = rows.filter((r) => r.instrumentId === v.canonicalId);
        exact = true;
      } else {
        if (!v.value || !v.scope || (!v.scheme && !v.aliasKind))
          return result("INSUFFICIENT_EVIDENCE");
        if (v.scheme) {
          if (
            !this.policy.identifierSchemes.includes(v.scheme as Policy["identifierSchemes"][number])
          )
            return result("UNSUPPORTED_SCHEME");
          n = normalize(
            v.value,
            ["ISIN", "FIGI", "CFI", "CURRENCY"].includes(v.scheme) ? "CASE" : "EXACT",
          );
          try {
            validateIdentifier(v.scheme, n.value, this.policy);
          } catch {
            return result("INVALID_INPUT");
          }
          found = rows.filter((r) =>
            r.definition.identifiers.some(
              (i) =>
                i.scheme === v.scheme &&
                i.scope === v.scope &&
                i.value === n?.value &&
                (!v.authority || i.authority === v.authority),
            ),
          );
          exact =
            found.length === 1 &&
            found[0]!.definition.identifiers.some(
              (i) =>
                i.scheme === v.scheme &&
                i.scope === v.scope &&
                i.value === n?.value &&
                (!v.authority || i.authority === v.authority) &&
                i.evidence.verification === "VERIFIED",
            );
        } else {
          if (!v.rule) return result("INSUFFICIENT_EVIDENCE");
          n = normalize(v.value, v.rule);
          if (n.status === "INVALID") return result("INVALID_INPUT");
          found = rows.filter((r) =>
            r.definition.aliases.some(
              (a) =>
                a.kind === v.aliasKind &&
                a.scope === v.scope &&
                a.rule === v.rule &&
                a.value === n?.value,
            ),
          );
        }
      }
      found = found
        .filter(
          (r) =>
            (!v.family || r.definition.identity.family === v.family) &&
            (!v.jurisdiction || r.definition.jurisdiction === v.jurisdiction),
        )
        .sort((a, b) => compare(a.instrumentId, b.instrumentId));
      if (!found.length) return result("NOT_FOUND", [], "NOT_FOUND", n);
      if (found.length > this.policy.maxCandidates)
        return result("AMBIGUOUS", [], "CANDIDATE_CAPACITY", n);
      if (!v.canonicalId)
        matchedEvidence = found.flatMap((r) =>
          v.scheme
            ? r.definition.identifiers
                .filter(
                  (i) =>
                    i.scheme === v.scheme &&
                    i.scope === v.scope &&
                    i.value === n?.value &&
                    (!v.authority || i.authority === v.authority),
                )
                .map((i) => i.evidence)
            : r.definition.aliases
                .filter(
                  (a) =>
                    a.kind === v.aliasKind &&
                    a.scope === v.scope &&
                    a.rule === v.rule &&
                    a.value === n?.value,
                )
                .map((a) => a.evidence),
        );
      if (found.length > 1) return result("AMBIGUOUS", found, "SCOPED_EVIDENCE_REQUIRED", n);
      return result(
        exact ? "EXACT_MATCH" : "QUALIFIED_MATCH",
        found,
        exact
          ? v.canonicalId
            ? "CANONICAL_IDENTITY_ADDRESS"
            : "VERIFIED_SCOPED_IDENTIFIER"
          : "CLAIM_NOT_VERIFIED",
        n,
      );
    });
  }
  public stop(): Promise<Result<void>> {
    if (this.busy) return Promise.resolve(fail("REGISTRY_BUSY"));
    if (this.lifecycle === "RECOVERY_REQUIRED")
      return Promise.resolve(fail("RECOVERY_REQUIRED", "UNKNOWN"));
    this.lifecycle = "STOPPED";
    return Promise.resolve(ok(undefined));
  }
}
