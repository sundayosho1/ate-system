import { z } from "zod";
import { fingerprint, type EffectiveConfiguration } from "@ate/configuration";
import { freeze, CalendarBoundaryResolver } from "@ate/multitimeframe";
import { mustParseUtc, type LocalDateTime } from "@ate/time";
import {
  stateDomain,
  stateOwner,
  persistenceId,
  type StateAuthorityRegistry,
} from "@ate/persistence";
import { canonicalId } from "@ate/instrument-registry";
import {
  code,
  digest,
  text,
  clockSchema,
  snapshotSchema,
  profiles,
  ok,
  fail,
  type Snapshot,
  type Prepared,
  type Comparison,
  type Policy,
  type Repository,
  type Result,
} from "./contracts.js";
import { policyFromEffective, validatePolicy } from "./policy.js";
import { safeClone, parseJson, errorLabel } from "./boundary.js";
import {
  bytes,
  canonicalRequest,
  buildQualification,
  contentFingerprint,
  context,
  fields,
  type EvidencePorts,
} from "./engine.js";
export interface SpecificationPorts extends EvidencePorts {
  configuration: () => EffectiveConfiguration;
  authority: StateAuthorityRegistry;
  repository: Repository;
}
export class InstrumentSpecifications {
  private busy = false;
  private checking = false;
  private reading = false;
  private lifecycle: "CREATED" | "READY" | "FAILED" | "RECOVERY_REQUIRED" | "STOPPED" = "CREATED";
  private policy: Policy | undefined;
  private configurationFingerprint = "";
  private history: Snapshot[] = [];
  private obligation: { generation: number; fingerprint: string } | null = null;
  private lastError: string | null = null;
  public constructor(
    private readonly serviceId: string,
    private readonly ports: SpecificationPorts,
  ) {
    code.parse(serviceId);
  }
  private configuration() {
    if (this.checking) throw Error("REENTRANT_CONFIGURATION");
    this.checking = true;
    try {
      const c = policyFromEffective(this.ports.configuration());
      digest.parse(c.configurationFingerprint);
      const owner = this.ports.authority.require(stateDomain("instrument.specifications"));
      if (
        !owner.ok ||
        owner.value.owner !== stateOwner("instrument.specifications") ||
        owner.value.writeAuthority !== "instrument.specifications" ||
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
  private owners() {
    if (this.checking) throw Error("BUSY");
    this.checking = true;
    try {
      if (
        this.ports.mapping.diagnostics().readiness !== "READY" ||
        this.ports.registry.diagnostics().readiness !== "READY"
      )
        throw Error("OWNER_UNAVAILABLE");
    } finally {
      this.checking = false;
    }
  }
  private gate() {
    if (this.busy || this.checking || this.reading) throw Error("BUSY");
    if (this.lifecycle !== "READY") throw Error("NOT_READY");
    const p = this.configuration().policy;
    this.owners();
    return p;
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
      this.configuration();
      this.owners();
      compatible = true;
    } catch {
      /* fail closed */
    }
    const ready = this.lifecycle === "READY" && !this.busy && !this.reading && compatible;
    return freeze({
      serviceId: this.serviceId,
      lifecycle: this.lifecycle,
      readiness: ready ? "READY" : "NOT_READY",
      health: ready ? "HEALTHY" : "DEGRADED",
      generation: this.history.at(-1)?.generation ?? 0,
      fingerprint: this.history.at(-1)?.fingerprint ?? null,
      pending: this.obligation ? 1 : 0,
      unresolvedPublication: this.obligation,
      recoveryRequired: this.lifecycle === "RECOVERY_REQUIRED",
      lastError: this.lastError,
      scope: "OFFLINE_RESEARCH_ONLY",
      executionSuitability: "NOT_ESTABLISHED",
      externalAuthentication: "NOT_ESTABLISHED",
      tradingAuthority: false,
    });
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
  private validate(s: Snapshot, rows: Snapshot[], p: Policy) {
    const previous = rows.at(-1),
      same = rows.filter(
        (x) => x.prepared.request.specificationId === s.prepared.request.specificationId,
      ),
      parent = same.at(-1);
    if (
      s.serviceId !== this.serviceId ||
      s.generation !== rows.length + 1 ||
      s.previous !== (previous?.fingerprint ?? null) ||
      s.fingerprint !== contentFingerprint(s) ||
      s.prepared.fingerprint !== contentFingerprint(s.prepared) ||
      s.specificationVersion !== same.length + 1 ||
      s.parentVersion !== (parent?.fingerprint ?? null) ||
      s.publishedAt < s.prepared.evaluatedAt ||
      (previous && s.publishedAt < previous.publishedAt) ||
      s.publishedAt > mustParseUtc(this.ports.clock.now()) ||
      fingerprint(s.clockProvenance) !== fingerprint(s.prepared.clockProvenance) ||
      fingerprint(s.clockProvenance) !== fingerprint(this.ports.clock.provenance)
    )
      throw Error("SPECIFICATION_CHAIN_INVALID");
    if (
      same.length >= p.maxRevisions ||
      rows.length >= Math.min(p.maxSpecifications, p.maxHistoryDepth)
    )
      throw Error("HISTORY_CAPACITY");
    if (rows.some((x) => x.prepared.request.requestId === s.prepared.request.requestId))
      throw Error("DUPLICATE_REQUEST_ID");
    if (
      parent &&
      (parent.prepared.context.instrumentId !== s.prepared.context.instrumentId ||
        parent.prepared.context.ownerId !== s.prepared.context.ownerId ||
        parent.prepared.context.namespaceKey !== s.prepared.context.namespaceKey)
    )
      throw Error("SPECIFICATION_IDENTITY_CHANGED");
    const storedPolicy = validatePolicy(s.prepared.policy);
    if (s.prepared.policyFingerprint !== fingerprint(storedPolicy))
      throw Error("POLICY_INCOMPATIBLE");
    if (
      (s.prepared.policyFingerprint !== fingerprint(p) ||
        s.prepared.configurationFingerprint !== this.configurationFingerprint) &&
      !p.compatibleHistoryPolicies.includes(s.prepared.policyFingerprint)
    )
      throw Error("POLICY_INCOMPATIBLE");
    // Current resource constraints always apply; derivation stays under the exact historical policy.
    canonicalRequest(s.prepared.request, p);
    const request = canonicalRequest(s.prepared.request, storedPolicy);
    const rebuilt = buildQualification(
      this.ports,
      request,
      storedPolicy,
      s.prepared.configurationFingerprint,
      s.prepared.evaluatedAt,
      s.prepared.clockProvenance,
    );
    if (fingerprint(rebuilt) !== fingerprint(s.prepared))
      throw Error("SPECIFICATION_EVIDENCE_CHANGED");
    if (
      bytes(s) > p.maxSnapshotBytes ||
      rows.reduce((n, x) => n + bytes(x), bytes(s)) > p.maxRetainedBytes
    )
      throw Error("RETAINED_CAPACITY");
  }
  public async initialize(): Promise<Result<Snapshot | undefined>> {
    if (
      this.busy ||
      this.checking ||
      this.reading ||
      !["CREATED", "FAILED"].includes(this.lifecycle)
    )
      return fail("LIFECYCLE");
    this.busy = true;
    let entered = false;
    try {
      const c = this.configuration();
      this.policy = c.policy;
      this.configurationFingerprint = c.configurationFingerprint;
      mustParseUtc(this.ports.clock.now());
      clockSchema.parse(safeClone(this.ports.clock.provenance));
      this.owners();
      entered = true;
      const raw = await this.ports.repository.load();
      const cert = z
        .discriminatedUnion("ok", [
          z
            .object({
              ok: z.literal(true),
              value: z
                .array(z.unknown())
                .max(Math.min(c.policy.maxSpecifications, c.policy.maxHistoryDepth)),
            })
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
      for (const raw of cert.value) {
        const s = snapshotSchema.parse(safeClone(raw, c.policy.maxSnapshotBytes));
        this.validate(s, rows, c.policy);
        rows.push(freeze(s));
      }
      this.configuration();
      this.owners();
      this.history = rows;
      this.lifecycle = "READY";
      this.lastError = null;
      return ok(rows.at(-1));
    } catch (e) {
      this.lifecycle = entered ? "RECOVERY_REQUIRED" : "FAILED";
      return this.reject(e, entered);
    } finally {
      this.busy = false;
    }
  }
  private prepared(raw: unknown, p: Policy) {
    const request = canonicalRequest(raw, p);
    context(this.ports, request, true);
    const result = buildQualification(this.ports, request, p, this.configurationFingerprint);
    this.configuration();
    this.owners();
    context(this.ports, request, true);
    if (bytes(result) > p.maxSnapshotBytes) throw Error("SNAPSHOT_CAPACITY");
    return result;
  }
  public async prepare(raw: unknown): Promise<Result<Prepared>> {
    await Promise.resolve();

    return this.operation((p) => Promise.resolve(ok(this.prepared(raw, p))));
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
      const request = canonicalRequest(raw, p),
        existing = this.history.find((x) => x.prepared.request.requestId === request.requestId);
      if (existing) {
        if (
          fingerprint(existing.prepared.request) !== fingerprint(request) ||
          existing.prepared.policyFingerprint !== fingerprint(p) ||
          existing.prepared.configurationFingerprint !== this.configurationFingerprint
        )
          return fail("REQUEST_ID_CONFLICT");
        context(this.ports, request, true);
        return ok(existing);
      }
      const prepared = this.prepared(request, p),
        same = this.history.filter(
          (x) => x.prepared.request.specificationId === request.specificationId,
        );
      const body = {
        schemaVersion: 1 as const,
        serviceId: this.serviceId,
        generation: this.history.length + 1,
        previous: this.history.at(-1)?.fingerprint ?? null,
        publishedAt: mustParseUtc(this.ports.clock.now()),
        clockProvenance: clockSchema.parse(safeClone(this.ports.clock.provenance)),
        specificationVersion: same.length + 1,
        parentVersion: same.at(-1)?.fingerprint ?? null,
        prepared,
      };
      const next = freeze(snapshotSchema.parse({ ...body, fingerprint: fingerprint(body) }));
      this.validate(next, this.history, p);
      this.configuration();
      this.owners();
      context(this.ports, request, true);
      const mappingBefore = this.ports.mapping.snapshot();
      const registryBefore = this.ports.registry.snapshot();
      if (!mappingBefore.ok || !registryBefore.ok) throw Error("OWNER_UNAVAILABLE");
      const ownerContext = fingerprint([
        mappingBefore.value?.fingerprint,
        registryBefore.value?.fingerprint,
      ]);
      const mutation = this.ports.authority.validateMutation({
        stateId: persistenceId(this.serviceId),
        stateDomain: stateDomain("instrument.specifications"),
        owner: stateOwner("instrument.specifications"),
        runtimeMode: "RESEARCH",
        payload: next,
        actor: { actorType: "SYSTEM" },
        transition: "IMMUTABLE_SPECIFICATION_VERSION",
      });
      if (!mutation.ok) return fail("STATE_MUTATION_REJECTED");
      this.configuration();
      this.owners();
      context(this.ports, request, true);
      const beforeCommitMapping = this.ports.mapping.snapshot(),
        beforeCommitRegistry = this.ports.registry.snapshot();
      if (
        !beforeCommitMapping.ok ||
        !beforeCommitRegistry.ok ||
        fingerprint([
          beforeCommitMapping.value?.fingerprint,
          beforeCommitRegistry.value?.fingerprint,
        ]) !== ownerContext
      )
        return fail("OWNER_CONTEXT_CHANGED_BEFORE_COMMIT");
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
        this.configuration();
        this.owners();
        context(this.ports, request, true);
        const a = this.ports.mapping.snapshot(),
          b = this.ports.registry.snapshot();
        if (
          !a.ok ||
          !b.ok ||
          fingerprint([a.value?.fingerprint, b.value?.fingerprint]) !== ownerContext
        )
          throw Error("OWNER_CONTEXT_CHANGED_AFTER_ACK");
        this.history.push(next);
        this.obligation = null;
        this.lastError = null;
        return ok(next);
      } catch (e) {
        return this.reject(e, true);
      }
    });
  }
  public snapshot(reference?: string): Result<Snapshot | undefined> {
    let acquired = false;
    try {
      this.gate();
      this.reading = true;
      acquired = true;
      if (reference === undefined) return ok(this.history.at(-1));
      digest.parse(reference);
      const s = this.history.find((x) => x.fingerprint === reference);
      return s ? ok(s) : fail("HISTORICAL_EVIDENCE_UNAVAILABLE");
    } catch (e) {
      return this.reject(e);
    } finally {
      if (acquired) this.reading = false;
    }
  }
  private current(s: Snapshot, p: Policy) {
    const reasons: string[] = [];
    try {
      context(this.ports, s.prepared.request, true);
    } catch {
      reasons.push("STALE_MAPPING_CONTEXT");
    }
    const now = mustParseUtc(this.ports.clock.now()),
      rebuilt = buildQualification(
        this.ports,
        s.prepared.request,
        p,
        this.configurationFingerprint,
        now,
      );
    if (rebuilt.validations.some((v) => v.classification === "STALE_CONTEXT"))
      reasons.push("STALE_APPLICABILITY");
    return freeze({
      stored: s.fingerprint,
      evaluatedAt: now,
      staleReasons: reasons,
      validations: rebuilt.validations,
      completeness: rebuilt.completeness.map((x) => ({
        ...x,
        classification: reasons.length ? ("STALE_CONTEXT" as const) : x.classification,
      })),
      tradingAuthority: false,
    });
  }
  public query(
    raw: unknown,
  ): Result<Readonly<{ total: number; nextOffset: number | null; records: readonly unknown[] }>> {
    let acquired = false;
    try {
      const p = this.gate();
      this.reading = true;
      acquired = true;
      const q = z
        .object({
          kind: z.enum([
            "SPECIFICATIONS",
            "HISTORY",
            "VALIDATIONS",
            "PROFILES",
            "FIELDS",
            "SESSIONS",
            "LIFECYCLE",
            "MARGIN",
            "CHANGES",
            "CONFLICTS",
            "RECONCILIATION",
          ]),
          scope: z.enum(["STORED", "CURRENT"]).default("STORED"),
          snapshotFingerprint: digest.optional(),
          specificationId: code.optional(),
          version: z.number().int().positive().optional(),
          instrumentId: canonicalId.optional(),
          ownerId: code.optional(),
          namespaceKey: digest.optional(),
          catalogueFingerprint: digest.optional(),
          observationFingerprint: digest.optional(),
          mappingSet: digest.optional(),
          sourceQuality: z
            .enum(["SYNTHETIC", "UNVERIFIED_RECORDED", "EVIDENCED_RECORDED"])
            .optional(),
          profile: z.enum(profiles).optional(),
          field: text.optional(),
          classification: z
            .enum([
              "INTERNALLY_CONSISTENT",
              "INCOMPLETE",
              "CONTRADICTORY",
              "UNSUPPORTED",
              "STALE_CONTEXT",
            ])
            .optional(),
          effectiveAt: z.string().transform(mustParseUtc).optional(),
          offset: z.number().int().min(0),
          limit: z.number().int().min(1).max(p.maxQueryResults),
        })
        .strict()
        .parse(safeClone(raw, p.maxInputBytes, p.maxInputDepth));
      if (
        q.snapshotFingerprint &&
        !this.history.some((x) => x.fingerprint === q.snapshotFingerprint)
      )
        return fail("HISTORICAL_EVIDENCE_UNAVAILABLE");
      if (q.version !== undefined && !q.specificationId)
        return fail("EXPLICIT_SPECIFICATION_REQUIRED");
      if (
        q.classification !== undefined &&
        ["FIELDS", "SESSIONS", "LIFECYCLE", "MARGIN", "CHANGES"].includes(q.kind)
      )
        return fail("FILTER_NOT_APPLICABLE");
      if (q.field !== undefined && q.kind !== "FIELDS") return fail("FILTER_NOT_APPLICABLE");
      if (q.profile !== undefined && q.kind !== "PROFILES") return fail("FILTER_NOT_APPLICABLE");
      const records: unknown[] = [];
      let total = 0;
      const append = (record: unknown) => {
        if (total >= q.offset && records.length < q.limit) records.push(record);
        total++;
      };
      for (const s of this.history) {
        const r = s.prepared.request,
          c = s.prepared.context;
        if (
          (q.snapshotFingerprint && s.fingerprint !== q.snapshotFingerprint) ||
          (q.specificationId && r.specificationId !== q.specificationId) ||
          (q.version && s.specificationVersion !== q.version) ||
          (q.instrumentId && c.instrumentId !== q.instrumentId) ||
          (q.ownerId && c.ownerId !== q.ownerId) ||
          (q.namespaceKey && c.namespaceKey !== q.namespaceKey) ||
          (q.catalogueFingerprint && c.catalogueFingerprint !== q.catalogueFingerprint) ||
          (q.observationFingerprint && c.observationFingerprint !== q.observationFingerprint) ||
          (q.mappingSet && c.mappingSet !== q.mappingSet) ||
          (q.sourceQuality && r.sourceQuality !== q.sourceQuality)
        )
          continue;
        const interpretation =
          q.scope === "CURRENT" || q.kind === "RECONCILIATION" ? this.current(s, p) : null;
        const validations = interpretation?.validations ?? s.prepared.validations,
          completeness = interpretation?.completeness ?? s.prepared.completeness;
        if (q.effectiveAt) {
          const category =
            q.kind === "MARGIN" || q.profile === "DECLARED_MARGIN_RESEARCH"
              ? "margin"
              : q.kind === "SESSIONS" || q.profile === "SESSION_HISTORY"
                ? "sessions"
                : "lifecycle";
          const from = s.prepared.normalized[category].effectiveFrom,
            to = s.prepared.normalized[category].effectiveTo;
          if (
            from?.state !== "DECLARED" ||
            !from.value ||
            q.effectiveAt < from.value ||
            (to?.state === "DECLARED" && to.value && q.effectiveAt >= to.value)
          )
            continue;
        }
        if (
          q.classification &&
          !validations.some((x) => x.classification === q.classification) &&
          !completeness.some((x) => x.classification === q.classification)
        )
          continue;
        const wrap = (value: unknown) => ({
          snapshot: s.fingerprint,
          specificationId: r.specificationId,
          version: s.specificationVersion,
          scope: q.kind === "RECONCILIATION" ? "CURRENT" : q.scope,
          currentContext: interpretation
            ? { evaluatedAt: interpretation.evaluatedAt, staleReasons: interpretation.staleReasons }
            : null,
          value,
          tradingAuthority: false,
        });
        if (q.kind === "SPECIFICATIONS" || q.kind === "HISTORY")
          append(wrap({ snapshot: s, interpretation }));
        else if (q.kind === "VALIDATIONS" || q.kind === "CONFLICTS")
          for (const v of validations.filter(
            (x) =>
              (q.kind !== "CONFLICTS" || x.classification === "CONTRADICTORY") &&
              (!q.classification || x.classification === q.classification),
          ))
            append(wrap(v));
        else if (q.kind === "PROFILES")
          for (const v of completeness.filter(
            (x) =>
              (!q.profile || x.profile === q.profile) &&
              (!q.classification || x.classification === q.classification),
          ))
            append(wrap(v));
        else if (q.kind === "FIELDS") {
          for (const [path, field] of fields(s.prepared.normalized))
            if (!q.field || q.field === path)
              append(
                wrap({
                  path,
                  declared: field,
                  raw: fields(r.metadata).find(([x]) => x === path)?.[1],
                  rawInputFingerprint: s.prepared.rawInputFingerprint,
                  source: c,
                }),
              );
        } else if (q.kind === "CHANGES") {
          if (s.parentVersion) {
            const result = this.compareStored(s.parentVersion, s.fingerprint, p);
            if (!result.ok) return result;
            append(wrap(result.value));
          }
        } else if (q.kind === "RECONCILIATION") append(wrap(interpretation ?? this.current(s, p)));
        else
          append(
            wrap(
              s.prepared.normalized[
                q.kind === "SESSIONS" ? "sessions" : q.kind === "LIFECYCLE" ? "lifecycle" : "margin"
              ],
            ),
          );
      }
      const page = records;
      return ok(
        freeze({
          total,
          nextOffset: q.offset + page.length < total ? q.offset + page.length : null,
          records: page,
        }),
      );
    } catch (e) {
      return this.reject(e);
    } finally {
      if (acquired) this.reading = false;
    }
  }
  public compare(before: string, after: string): Result<Comparison> {
    let acquired = false;
    try {
      const p = this.gate();
      this.reading = true;
      acquired = true;
      return this.compareStored(before, after, p);
    } catch (e) {
      return this.reject(e);
    } finally {
      if (acquired) this.reading = false;
    }
  }
  private compareStored(before: string, after: string, p: Policy): Result<Comparison> {
    try {
      digest.parse(before);
      digest.parse(after);
      const a = this.history.find((x) => x.fingerprint === before),
        b = this.history.find((x) => x.fingerprint === after);
      if (!a || !b) return fail("HISTORICAL_EVIDENCE_UNAVAILABLE");
      const differences: {
        field: string;
        before: unknown;
        after: unknown;
        classification: string;
      }[] = [];
      const old = new Map(fields(a.prepared.normalized)),
        next = new Map(fields(b.prepared.normalized));
      for (const path of [...new Set([...old.keys(), ...next.keys()])].sort()) {
        const av = old.get(path) ?? null,
          bv = next.get(path) ?? null;
        // Compare declared values and states, retaining the full provenance in the result.
        const semantic = (f: typeof av) =>
          f
            ? { state: f.state, value: f.value ?? null, alternatives: f.alternatives ?? null }
            : null;
        if (fingerprint(semantic(av)) === fingerprint(semantic(bv))) continue;
        const classification =
          !av || !bv || av.state !== "DECLARED" || bv.state !== "DECLARED"
            ? "INSUFFICIENT_EVIDENCE"
            : path.endsWith("unit") || path.endsWith("Currency")
              ? "INCOMPATIBLE_CONTRACT_SEMANTICS"
              : "MATERIAL_DIFFERENCE";
        differences.push({ field: path, before: av, after: bv, classification });
      }
      for (const [name, av, bv] of [
        ["SOURCE_CONTEXT", a.prepared.context, b.prepared.context],
        ["VALIDATION_POLICY", a.prepared.policyFingerprint, b.prepared.policyFingerprint],
      ] as const)
        if (fingerprint(av) !== fingerprint(bv))
          differences.push({
            field: name,
            before: av,
            after: bv,
            classification: "CONTEXT_CHANGED",
          });
      if (differences.length > p.maxComparisons) return fail("COMPARISON_CAPACITY");
      const sameIdentity =
        a.prepared.context.instrumentId === b.prepared.context.instrumentId &&
        a.prepared.context.revisionId === b.prepared.context.revisionId;
      const complete = [a, b].every(
        (s) =>
          s.prepared.completeness.find((x) => x.profile === "CONTRACT_COMPARISON")
            ?.classification === "INTERNALLY_CONSISTENT",
      );
      const unsupported = [a, b].some((s) =>
        s.prepared.validations.some((v) => v.classification === "UNSUPPORTED"),
      );
      const contradictory = [a, b].some((s) =>
        s.prepared.validations.some((v) => v.classification === "CONTRADICTORY"),
      );
      const unresolvedFields = [a, b].some((s) =>
        fields(s.prepared.normalized).some(([, f]) => f.state !== "DECLARED"),
      );
      const classification = !sameIdentity
        ? "INCOMPATIBLE_CONTRACT_SEMANTICS"
        : unsupported
          ? "UNSUPPORTED_COMPARISON"
          : !complete ||
              contradictory ||
              unresolvedFields ||
              a.prepared.policyFingerprint !== b.prepared.policyFingerprint
            ? "INSUFFICIENT_EVIDENCE"
            : differences.some((x) => x.classification === "INCOMPATIBLE_CONTRACT_SEMANTICS")
              ? "INCOMPATIBLE_CONTRACT_SEMANTICS"
              : differences.some((x) => x.classification === "INSUFFICIENT_EVIDENCE")
                ? "INSUFFICIENT_EVIDENCE"
                : differences.some((x) => x.classification === "MATERIAL_DIFFERENCE")
                  ? "MATERIAL_DIFFERENCE"
                  : "EXACT_MATCH_UNDER_RECORDED_POLICY";
      const comparisonContext = (s: Snapshot) => ({
        snapshot: s.fingerprint,
        generation: s.generation,
        version: s.specificationVersion,
        source: s.prepared.context,
        policyFingerprint: s.prepared.policyFingerprint,
        effectiveFrom: s.prepared.normalized.lifecycle.effectiveFrom?.value ?? null,
        effectiveTo: s.prepared.normalized.lifecycle.effectiveTo?.value ?? null,
      });
      const body = {
        before,
        after,
        beforeContext: comparisonContext(a),
        afterContext: comparisonContext(b),
        classification,
        differences,
        tradingAuthority: false as const,
      };
      return ok(freeze({ ...body, fingerprint: fingerprint(body) }));
    } catch (e) {
      return this.reject(e);
    }
  }
  public sessionLocalBoundary(reference: string, raw: unknown): Result<string> {
    let acquired = false;
    try {
      this.gate();
      this.reading = true;
      acquired = true;
      digest.parse(reference);
      const s = this.history.find((x) => x.fingerprint === reference);
      if (!s) return fail("HISTORICAL_EVIDENCE_UNAVAILABLE");
      const c = s.prepared.normalized.sessions.calendar;
      if (c?.state !== "DECLARED" || !c.value) return fail("CALENDAR_REQUIRED");
      const local = z
        .object({
          year: z.number().int(),
          month: z.number().int(),
          day: z.number().int(),
          hour: z.number().int(),
          minute: z.number().int(),
          second: z.number().int(),
          millisecond: z.number().int(),
        })
        .strict()
        .parse(safeClone(raw));
      return ok(new CalendarBoundaryResolver(c.value).localBoundary(local as LocalDateTime));
    } catch (e) {
      return this.reject(e);
    } finally {
      if (acquired) this.reading = false;
    }
  }
  public stop(): Promise<Result<void>> {
    if (this.busy || this.checking || this.reading) return Promise.resolve(fail("BUSY"));
    if (this.lifecycle === "RECOVERY_REQUIRED" || this.obligation)
      return Promise.resolve(fail("RECOVERY_REQUIRED", "UNKNOWN"));
    this.lifecycle = "STOPPED";
    return Promise.resolve(ok(undefined));
  }
}
