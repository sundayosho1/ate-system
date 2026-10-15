import { z } from "zod";
import { fingerprint, type EffectiveConfiguration } from "@ate/configuration";
import { freeze } from "@ate/multitimeframe";
import { mustParseUtc } from "@ate/time";
import {
  stateDomain,
  stateOwner,
  persistenceId,
  type StateAuthorityRegistry,
} from "@ate/persistence";
import { associateCatalogueResearchEvidence, clockSchema } from "@ate/broker-symbol-catalogue";
import { canonicalId, families } from "@ate/instrument-registry";
import {
  digest,
  code,
  text,
  outcomes,
  snapshotSchema,
  ok,
  fail,
  type Snapshot,
  type Prepared,
  type Mapping,
  type Policy,
  type Repository,
  type Result,
} from "./contracts.js";
import { policyFromEffective, validatePolicy } from "./policy.js";
import { safeClone, parseJson, errorLabel } from "./boundary.js";
import {
  canonicalRequest,
  currentContext,
  buildQualification,
  contentFingerprint,
  type EvidencePorts,
} from "./engine.js";
export interface MappingPorts extends EvidencePorts {
  configuration: () => EffectiveConfiguration;
  authority: StateAuthorityRegistry;
  repository: Repository;
}
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
export class CanonicalSymbolMapping {
  private readonly evidence: EvidencePorts;
  private busy = false;
  private checking = false;
  private lifecycle: "CREATED" | "READY" | "FAILED" | "RECOVERY_REQUIRED" | "STOPPED" = "CREATED";
  private policy: Policy | undefined;
  private configurationFingerprint = "";
  private history: Snapshot[] = [];
  private current: Snapshot | undefined;
  private obligation: { generation: number; fingerprint: string } | null = null;
  private lastError: string | null = null;
  public constructor(
    private readonly serviceId: string,
    private readonly ports: MappingPorts,
  ) {
    code.parse(serviceId);
    if (ports.sources.size < 1 || ports.sources.size > 128) throw Error("SOURCE_OWNER_CAPACITY");
    this.evidence = {
      clock: ports.clock,
      registry: ports.registry,
      registryConfiguration: ports.registryConfiguration,
      sources: new Map(ports.sources),
      ...(ports.verifyRegistryEvidence
        ? { verifyRegistryEvidence: ports.verifyRegistryEvidence }
        : {}),
    };
  }
  private context() {
    if (this.checking) throw Error("REENTRANT_CONFIGURATION");
    this.checking = true;
    try {
      const c = policyFromEffective(this.ports.configuration());
      digest.parse(c.configurationFingerprint);
      const owner = this.ports.authority.require(stateDomain("canonical.mapping"));
      if (
        !owner.ok ||
        owner.value.owner !== stateOwner("canonical.mapping") ||
        owner.value.writeAuthority !== "canonical.mapping" ||
        owner.value.authorityType !== "DERIVED" ||
        !owner.value.runtimeModes.includes("RESEARCH") ||
        !owner.value.durable ||
        !owner.value.historyRequired ||
        !owner.value.reconciliationRequired
      )
        throw Error("STATE_AUTHORITY_REQUIRED");
      if (
        this.policy &&
        (fingerprint(c.policy) !== fingerprint(this.policy) ||
          c.configurationFingerprint !== this.configurationFingerprint)
      )
        throw Error("POLICY_INCOMPATIBLE");
      return c;
    } finally {
      this.checking = false;
    }
  }
  private gate() {
    if (this.busy || this.checking) throw Error("BUSY");
    if (this.lifecycle !== "READY") throw Error("NOT_READY");
    return this.context().policy;
  }
  private reject<T>(e: unknown, uncertain = false): Result<T> {
    const label = errorLabel(e);
    this.lastError = /^[A-Z][A-Z0-9_]{0,127}$/.test(label)
      ? label
      : label.startsWith("[")
        ? "INPUT_VALIDATION_FAILED"
        : "CALLBACK_FAILURE";
    if (uncertain) this.lifecycle = "RECOVERY_REQUIRED";
    return fail(this.lastError, uncertain ? "UNKNOWN" : "NONE");
  }
  public diagnostics() {
    let compatible = false;
    try {
      this.context();
      compatible = true;
    } catch {
      /* fail closed */
    }
    let ownersReady = false;
    try {
      ownersReady =
        this.evidence.registry.diagnostics().readiness === "READY" &&
        [...this.evidence.sources.values()].every((s) => s.diagnostics().readiness === "READY");
    } catch {
      /* trusted owner unavailable */
    }
    const ready = this.lifecycle === "READY" && !this.busy && compatible && ownersReady;
    return freeze({
      serviceId: this.serviceId,
      lifecycle: this.lifecycle,
      readiness: ready ? "READY" : "NOT_READY",
      health: ready ? "HEALTHY" : "DEGRADED",
      generation: this.current?.generation ?? 0,
      fingerprint: this.current?.fingerprint ?? null,
      pending: this.busy || this.lifecycle === "RECOVERY_REQUIRED" ? 1 : 0,
      unresolvedPublication: this.obligation,
      recoveryRequired: this.lifecycle === "RECOVERY_REQUIRED",
      lastError: this.lastError,
      scope: "OFFLINE_RESEARCH_ONLY",
      availabilityNow: "NOT_ESTABLISHED",
      executionSuitability: "NOT_ESTABLISHED",
      tradingAuthority: false,
    });
  }
  private async validate(s: Snapshot, previous: Snapshot | undefined, p: Policy) {
    if (
      s.serviceId !== this.serviceId ||
      s.generation !== (previous?.generation ?? 0) + 1 ||
      s.previous !== (previous?.fingerprint ?? null) ||
      s.fingerprint !== contentFingerprint(s) ||
      s.prepared.fingerprint !== contentFingerprint(s.prepared) ||
      s.prepared.evaluatedAt > s.publishedAt ||
      (previous && s.publishedAt < previous.publishedAt)
    )
      throw Error("MAPPING_CHAIN_INVALID");
    const stored = validatePolicy(s.prepared.policy);
    if (
      fingerprint(canonicalRequest(s.prepared.request, stored)) !== fingerprint(s.prepared.request)
    )
      throw Error("INPUT_NOT_CANONICAL");
    if (
      s.prepared.policyFingerprint !== fingerprint(stored) ||
      (s.prepared.configurationFingerprint === this.configurationFingerprint &&
        s.prepared.policyFingerprint !== fingerprint(p)) ||
      (s.prepared.policyFingerprint !== fingerprint(p) &&
        !p.compatibleHistoryPolicies.includes(s.prepared.policyFingerprint))
    )
      throw Error("POLICY_INCOMPATIBLE");
    const rebuilt = await buildQualification(
      this.evidence,
      s.prepared.request,
      stored,
      s.prepared.configurationFingerprint,
      s.prepared.evaluatedAt,
      s.prepared.clockProvenance,
      s.prepared.context,
    );
    if (fingerprint(rebuilt) !== fingerprint(s.prepared)) throw Error("MAPPING_EVIDENCE_CHANGED");
    const expected = this.lineage(previous, s.prepared);
    if (fingerprint(expected) !== fingerprint(s.supersedes)) throw Error("MAPPING_LINEAGE_INVALID");
  }
  private sourceKey(m: Mapping) {
    return fingerprint([
      m.source.ownerId,
      m.source.namespaceKey,
      m.source.catalogueFingerprint,
      m.source.observationFingerprint,
    ]);
  }
  private slotKey(m: Mapping) {
    return fingerprint([m.source.ownerId, m.source.namespaceKey, m.observation.raw.rawSymbol]);
  }
  private lineage(previous: Snapshot | undefined, next: Prepared) {
    const old = previous?.prepared.mappings ?? [];
    return old.flatMap((before) => {
      const exact = next.mappings.find((m) => this.sourceKey(m) === this.sourceKey(before));
      const slotOld = old.filter((m) => this.slotKey(m) === this.slotKey(before)),
        slotNext = next.mappings.filter((m) => this.slotKey(m) === this.slotKey(before));
      const after =
        exact ?? (slotOld.length === 1 && slotNext.length === 1 ? slotNext[0] : undefined);
      return after && after.fingerprint !== before.fingerprint
        ? [{ before: before.fingerprint, after: after.fingerprint }]
        : [];
    });
  }
  public async initialize(): Promise<Result<Snapshot | undefined>> {
    if (this.busy || !["CREATED", "FAILED"].includes(this.lifecycle)) return fail("LIFECYCLE");
    this.busy = true;
    let entered = false;
    try {
      const c = this.context();
      this.policy = c.policy;
      this.configurationFingerprint = c.configurationFingerprint;
      clockSchema.parse(safeClone(this.evidence.clock.provenance));
      mustParseUtc(this.evidence.clock.now());
      entered = true;
      const raw = await this.ports.repository.load();
      const cert = z
        .discriminatedUnion("ok", [
          z
            .object({ ok: z.literal(true), value: z.array(z.unknown()).max(c.policy.maxSets) })
            .strict(),
          z
            .object({
              ok: z.literal(false),
              error: z.object({ code: text, commitment: z.enum(["NONE", "UNKNOWN"]) }).strict(),
            })
            .strict(),
        ])
        .parse(safeClone(raw, c.policy.maxRetainedBytes + 8192));
      if (!cert.ok) {
        this.lifecycle = cert.error.commitment === "UNKNOWN" ? "RECOVERY_REQUIRED" : "FAILED";
        return fail(cert.error.code, cert.error.commitment);
      }
      const rows: Snapshot[] = [];
      let retained = 0;
      for (const raw of cert.value) {
        const s = snapshotSchema.parse(safeClone(raw, c.policy.maxSnapshotBytes));
        retained += bytes(s);
        if (retained > c.policy.maxRetainedBytes) throw Error("RETAINED_CAPACITY");
        await this.validate(s, rows.at(-1), c.policy);
        if (rows.some((v) => v.prepared.request.requestId === s.prepared.request.requestId))
          throw Error("DUPLICATE_REQUEST_ID");
        rows.push(freeze(s));
      }
      this.context();
      this.history = rows;
      this.current = rows.at(-1);
      this.lifecycle = "READY";
      this.lastError = null;
      return ok(this.current);
    } catch (e) {
      this.lifecycle = entered ? "RECOVERY_REQUIRED" : "FAILED";
      return this.reject(e, entered);
    } finally {
      this.busy = false;
    }
  }
  private async operation<T>(run: (p: Policy) => Promise<Result<T>>): Promise<Result<T>> {
    let p: Policy;
    try {
      p = this.gate();
    } catch (e) {
      return this.reject(e);
    }
    this.busy = true;
    try {
      return await run(p);
    } catch (e) {
      return this.reject(e);
    } finally {
      this.busy = false;
    }
  }
  private async prepared(raw: unknown, p: Policy) {
    const request = canonicalRequest(raw, p),
      context = currentContext(this.evidence, request),
      at = mustParseUtc(this.evidence.clock.now()),
      provenance = clockSchema.parse(safeClone(this.evidence.clock.provenance));
    const prepared = await buildQualification(
      this.evidence,
      request,
      p,
      this.configurationFingerprint,
      at,
      provenance,
      context,
    );
    this.context();
    if (fingerprint(context) !== fingerprint(currentContext(this.evidence, request)))
      throw Error("OWNER_CONTEXT_CHANGED");
    if (bytes(prepared) > p.maxSnapshotBytes) throw Error("SNAPSHOT_CAPACITY");
    return prepared;
  }
  public async prepare(raw: unknown): Promise<Result<Prepared>> {
    return this.operation(async (p) => ok(await this.prepared(raw, p)));
  }
  public async publishJson(raw: unknown): Promise<Result<Snapshot>> {
    try {
      const p = this.gate();
      return await this.publish(parseJson(raw, p.maxInputBytes));
    } catch (e) {
      return this.reject(e);
    }
  }
  public async publish(raw: unknown): Promise<Result<Snapshot>> {
    return this.operation(async (p) => {
      const request = canonicalRequest(raw, p);
      const existing = this.history.find((s) => s.prepared.request.requestId === request.requestId);
      if (existing) {
        if (
          fingerprint(request) !== fingerprint(existing.prepared.request) ||
          existing.prepared.policyFingerprint !== fingerprint(p)
        )
          return fail("REQUEST_ID_CONFLICT");
        if (
          fingerprint(currentContext(this.evidence, request)) !==
          fingerprint(existing.prepared.context)
        )
          return fail("OWNER_CONTEXT_CHANGED");
        return ok(existing);
      }
      const prepared = await this.prepared(request, p);
      const at = mustParseUtc(this.evidence.clock.now());
      const content = {
        schemaVersion: 1 as const,
        serviceId: this.serviceId,
        generation: (this.current?.generation ?? 0) + 1,
        previous: this.current?.fingerprint ?? null,
        publishedAt: at,
        clockProvenance: clockSchema.parse(safeClone(this.evidence.clock.provenance)),
        prepared,
        supersedes: this.lineage(this.current, prepared),
      };
      const next = freeze(snapshotSchema.parse({ ...content, fingerprint: fingerprint(content) }));
      if (
        this.history.length >= p.maxSets ||
        bytes(next) > p.maxSnapshotBytes ||
        this.history.reduce((n, s) => n + bytes(s), bytes(next)) > p.maxRetainedBytes
      )
        return fail("RETAINED_CAPACITY");
      await this.validate(next, this.current, p);
      this.context();
      if (fingerprint(currentContext(this.evidence, request)) !== fingerprint(prepared.context))
        return fail("OWNER_CONTEXT_CHANGED");
      const mutation = this.ports.authority.validateMutation({
        stateId: persistenceId(this.serviceId),
        stateDomain: stateDomain("canonical.mapping"),
        owner: stateOwner("canonical.mapping"),
        runtimeMode: "RESEARCH",
        payload: next,
        actor: { actorType: "SYSTEM" },
        transition: "IMMUTABLE_MAPPING_SET",
      });
      if (!mutation.ok) return fail("STATE_MUTATION_REJECTED");
      this.obligation = freeze({ generation: next.generation, fingerprint: next.fingerprint });
      try {
        const raw = await this.ports.repository.commit(next);
        const cert = z
          .discriminatedUnion("ok", [
            z.object({ ok: z.literal(true), value: snapshotSchema }).strict(),
            z
              .object({
                ok: z.literal(false),
                error: z.object({ code: text, commitment: z.enum(["NONE", "UNKNOWN"]) }).strict(),
              })
              .strict(),
          ])
          .parse(safeClone(raw, p.maxSnapshotBytes + 1024));
        if (!cert.ok) {
          if (cert.error.commitment === "UNKNOWN") return this.reject(Error(cert.error.code), true);
          this.obligation = null;
          return fail(cert.error.code);
        }
        if (fingerprint(cert.value) !== fingerprint(next)) throw Error("ACKNOWLEDGEMENT_MISMATCH");
        this.context();
        if (fingerprint(currentContext(this.evidence, request)) !== fingerprint(prepared.context))
          throw Error("OWNER_CONTEXT_CHANGED_AFTER_ACK");
        this.current = next;
        this.history.push(next);
        this.obligation = null;
        this.lastError = null;
        return ok(next);
      } catch (e) {
        return this.reject(e, true);
      }
    });
  }
  public snapshot(ref?: string): Result<Snapshot | undefined> {
    try {
      this.gate();
      if (ref === undefined) return ok(this.current);
      digest.parse(ref);
      const s = this.history.find((s) => s.fingerprint === ref);
      return s ? ok(s) : fail("HISTORICAL_EVIDENCE_UNAVAILABLE");
    } catch (e) {
      return this.reject(e);
    }
  }
  private validity(
    m: Mapping,
    s: Snapshot,
    p: Policy,
    at = mustParseUtc(this.evidence.clock.now()),
  ) {
    const reasons: string[] = [];
    if (
      fingerprint(p) !== s.prepared.policyFingerprint ||
      s.prepared.configurationFingerprint !== this.configurationFingerprint
    )
      reasons.push("POLICY_INCOMPATIBLE");
    const registry = this.evidence.registry.snapshot();
    if (!registry.ok) {
      reasons.push("CURRENT_AUTHORITY_UNAVAILABLE");
    } else if (registry.value?.fingerprint !== s.prepared.request.registrySnapshot)
      reasons.push("STALE_REGISTRY");
    const lab = this.evidence.sources.get(m.source.ownerId);
    const root = lab?.snapshot();
    const latest =
      root?.ok && root.value
        ? root.value.catalogues.filter((c) => c.namespaceKey === m.source.namespaceKey).at(-1)
        : undefined;
    if (!root?.ok) reasons.push("CURRENT_AUTHORITY_UNAVAILABLE");
    else if (latest?.fingerprint !== m.source.catalogueFingerprint) reasons.push("STALE_SOURCE");
    const cat = s.prepared.catalogues.find(
      (c) =>
        c.catalogue.fingerprint === m.source.catalogueFingerprint &&
        c.reference.ownerId === m.source.ownerId,
    )!.catalogue;
    const sourceAt = m.observation.raw.observedAt ?? cat.source.observedAt;
    const queryAt = at;
    if (
      sourceAt &&
      (Date.parse(queryAt) - Date.parse(sourceAt) > p.maxSourceAgeMs ||
        Date.parse(sourceAt) > Date.parse(queryAt))
    )
      reasons.push("STALE_SOURCE");
    const approved = m.approval && lab?.mapping(m.approval.proposal.proposalId);
    return {
      mapping: m,
      currentOutcome: reasons[0] ?? m.outcome,
      staleReasons: [...new Set(reasons)],
      researchApproved:
        !reasons.length &&
        m.outcome === "UNIQUE_QUALIFIED_CANDIDATE" &&
        !!m.approval?.consistent &&
        !!approved?.ok &&
        approved.value.state === "APPROVED_FOR_RESEARCH_ASSOCIATION" &&
        approved.value.decisions.at(-1)?.decisionId === m.approval.decision?.decisionId,
      tradingAuthority: false,
    };
  }
  public query(
    raw: unknown,
  ): Result<Readonly<{ total: number; nextOffset: number | null; records: readonly unknown[] }>> {
    try {
      const p = this.gate();
      const q = z
        .object({
          kind: z.enum(["MAPPINGS", "GROUPS", "CONFLICTS", "HISTORY"]),
          snapshotFingerprint: digest.optional(),
          scope: z.enum(["CURRENT", "STORED"]).default("CURRENT"),
          ownerId: code.optional(),
          namespaceKey: digest.optional(),
          catalogueFingerprint: digest.optional(),
          observationFingerprint: digest.optional(),
          instrumentId: canonicalId.optional(),
          family: z.enum(families).optional(),
          rawSymbol: text.optional(),
          normalizedKey: text.optional(),
          outcome: z.enum(outcomes).optional(),
          qualifiedOnly: z.boolean().default(false),
          offset: z.number().int().min(0),
          limit: z.number().int().min(1).max(p.maxQueryResults),
        })
        .strict()
        .parse(safeClone(raw, p.maxInputBytes, p.maxInputDepth));
      const selected = q.snapshotFingerprint
        ? this.history.find((s) => s.fingerprint === q.snapshotFingerprint)
        : this.current;
      if (q.snapshotFingerprint && !selected) return fail("HISTORICAL_EVIDENCE_UNAVAILABLE");
      const queryAt = q.scope === "CURRENT" ? mustParseUtc(this.evidence.clock.now()) : undefined;
      const matches = (m: Mapping, s: Snapshot) => {
        const outcome =
          q.scope === "CURRENT" ? this.validity(m, s, p, queryAt).currentOutcome : m.outcome;
        return (
          (q.ownerId === undefined || m.source.ownerId === q.ownerId) &&
          (q.namespaceKey === undefined || m.source.namespaceKey === q.namespaceKey) &&
          (q.catalogueFingerprint === undefined ||
            m.source.catalogueFingerprint === q.catalogueFingerprint) &&
          (q.observationFingerprint === undefined ||
            m.source.observationFingerprint === q.observationFingerprint) &&
          (q.instrumentId === undefined || m.target?.instrumentId === q.instrumentId) &&
          (q.family === undefined || m.target?.family === q.family) &&
          (q.rawSymbol === undefined || m.observation.raw.rawSymbol === q.rawSymbol) &&
          (q.normalizedKey === undefined ||
            m.observation.keys.some((k) => k.value === q.normalizedKey)) &&
          (q.outcome === undefined || outcome === q.outcome) &&
          (!q.qualifiedOnly || outcome === "UNIQUE_QUALIFIED_CANDIDATE")
        );
      };
      const hasFilters =
        q.ownerId !== undefined ||
        q.namespaceKey !== undefined ||
        q.catalogueFingerprint !== undefined ||
        q.observationFingerprint !== undefined ||
        q.instrumentId !== undefined ||
        q.family !== undefined ||
        q.rawSymbol !== undefined ||
        q.normalizedKey !== undefined ||
        q.outcome !== undefined ||
        q.qualifiedOnly;
      let records: readonly unknown[] = [];
      if (q.kind === "HISTORY")
        records = this.history.filter(
          (s) =>
            (q.snapshotFingerprint === undefined || s.fingerprint === q.snapshotFingerprint) &&
            (!hasFilters || s.prepared.mappings.some((m) => matches(m, s))),
        );
      else if (selected) {
        const ms = selected.prepared.mappings.filter((m) => matches(m, selected));
        if (q.kind === "MAPPINGS")
          records = ms.map((m) =>
            q.scope === "CURRENT"
              ? this.validity(m, selected, p, queryAt)
              : {
                  mapping: m,
                  currentOutcome: null,
                  staleReasons: [],
                  researchApproved: m.approval?.consistent ?? false,
                  tradingAuthority: false,
                },
          );
        else if (q.kind === "GROUPS")
          records = selected.prepared.groups.flatMap((group) => {
            const matchingMembers = ms.filter((m) => group.members.includes(m.fingerprint));
            return matchingMembers.length ? [{ group, matchingMembers }] : [];
          });
        else
          records = selected.prepared.conflicts.flatMap((conflict) => {
            const matchingMembers = ms.filter((m) => conflict.mappings.includes(m.fingerprint));
            return matchingMembers.length ? [{ conflict, matchingMembers }] : [];
          });
      }
      const page = records.slice(q.offset, q.offset + q.limit);
      return ok(
        freeze({
          selectedSnapshot:
            q.kind === "HISTORY"
              ? (q.snapshotFingerprint ?? null)
              : (selected?.fingerprint ?? null),
          generation: q.kind === "HISTORY" ? null : (selected?.generation ?? null),
          scope: q.scope,
          total: records.length,
          nextOffset: q.offset + page.length < records.length ? q.offset + page.length : null,
          records: page,
        }),
      );
    } catch (e) {
      return this.reject(e);
    }
  }
  public compare(
    before: string,
    after: string,
  ): Result<
    Readonly<{
      before: string;
      after: string;
      differences: readonly {
        kind: string;
        source: string;
        before: string | null;
        after: string | null;
      }[];
      fingerprint: string;
    }>
  > {
    try {
      this.gate();
      digest.parse(before);
      digest.parse(after);
      const a = this.history.find((s) => s.fingerprint === before),
        b = this.history.find((s) => s.fingerprint === after);
      if (!a || !b) return fail("HISTORICAL_EVIDENCE_UNAVAILABLE");
      const differences: {
        kind: string;
        source: string;
        before: string | null;
        after: string | null;
      }[] = [];
      const matched = new Set<string>();
      for (const old of a.prepared.mappings) {
        const source = this.sourceKey(old),
          exact = b.prepared.mappings.find((m) => this.sourceKey(m) === source);
        const slotOld = a.prepared.mappings.filter((m) => this.slotKey(m) === this.slotKey(old)),
          slotNew = b.prepared.mappings.filter((m) => this.slotKey(m) === this.slotKey(old));
        const next =
          exact ?? (slotOld.length === 1 && slotNew.length === 1 ? slotNew[0] : undefined);
        if (next) matched.add(next.fingerprint);
        if (old.fingerprint === next?.fingerprint) continue;
        differences.push({
          kind: !next
            ? "MISSING_FROM_MAPPING_SET"
            : old.source.catalogueFingerprint !== next.source.catalogueFingerprint ||
                old.source.ownerSnapshot !== next.source.ownerSnapshot ||
                old.source.contextSnapshot !== next.source.contextSnapshot
              ? "SOURCE_CHANGED"
              : old.registrySnapshot !== next.registrySnapshot
                ? "REGISTRY_CHANGED"
                : old.policyFingerprint !== next.policyFingerprint ||
                    old.configurationFingerprint !== next.configurationFingerprint
                  ? "POLICY_CHANGED"
                  : "QUALIFICATION_CHANGED",
          source,
          before: old.fingerprint,
          after: next?.fingerprint ?? null,
        });
      }
      for (const next of b.prepared.mappings)
        if (!matched.has(next.fingerprint))
          differences.push({
            kind: "ADDED",
            source: this.sourceKey(next),
            before: null,
            after: next.fingerprint,
          });
      differences.sort((x, y) =>
        x.source < y.source
          ? -1
          : x.source > y.source
            ? 1
            : x.kind < y.kind
              ? -1
              : x.kind > y.kind
                ? 1
                : 0,
      );
      const content = { before, after, differences };
      return ok(freeze({ ...content, fingerprint: fingerprint(content) }));
    } catch (e) {
      return this.reject(e);
    }
  }
  public associateResearchEvidence(mappingFingerprint: string, raw: unknown): Result<unknown> {
    try {
      const p = this.gate();
      digest.parse(mappingFingerprint);
      const s = this.current,
        m = s?.prepared.mappings.find((m) => m.fingerprint === mappingFingerprint);
      if (
        !s ||
        !m ||
        this.validity(m, s, p).currentOutcome !== "UNIQUE_QUALIFIED_CANDIDATE" ||
        !m.approval?.consistent ||
        !this.validity(m, s, p).researchApproved
      )
        return fail("QUALIFIED_APPROVED_CURRENT_MAPPING_REQUIRED");
      const request = z
        .object({
          owner: z.enum([
            "MARKET_DATA",
            "HISTORICAL_DATA",
            "DATA_QUALITY",
            "DATASET_CATALOGUE",
            "REALTIME_CAPTURE",
            "MULTITIMEFRAME",
            "MARKET_REPLAY",
          ]),
          ownerReference: text,
          ownerFingerprint: digest,
        })
        .strict()
        .parse(safeClone(raw, p.maxInputBytes));
      const lab = this.evidence.sources.get(m.source.ownerId)!;
      const associated = associateCatalogueResearchEvidence(lab, this.evidence.registry, {
        ...request,
        proposalId: m.approval.proposal.proposalId,
      });
      if (!associated.ok) return fail(associated.error.code);
      if (
        associated.value.decisionId !== m.approval?.decision?.decisionId ||
        associated.value.reference.instrumentId !== m.target?.instrumentId ||
        associated.value.reference.revisionId !== m.target.revisionId
      )
        return fail("APPROVAL_TARGET_MISMATCH");
      const content = {
        mappingFingerprint: m.fingerprint,
        mappingSet: s.fingerprint,
        association: associated.value,
        tradingAuthority: false,
      };
      return ok(freeze({ ...content, fingerprint: fingerprint(content) }));
    } catch (e) {
      return this.reject(e);
    }
  }
  public async stop(): Promise<Result<void>> {
    await Promise.resolve();
    if (this.busy || this.checking) return fail("BUSY");
    if (this.lifecycle === "RECOVERY_REQUIRED") return fail("RECOVERY_REQUIRED", "UNKNOWN");
    this.lifecycle = "STOPPED";
    return ok(undefined);
  }
}
