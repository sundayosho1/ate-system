import { z } from "zod";
import {
  fingerprint,
  configurationApprovalPolicyId,
  type EffectiveConfiguration,
  type ApprovalAuthorityResolver,
} from "@ate/configuration";
import { freeze } from "@ate/multitimeframe";
import { mustParseUtc, type Clock } from "@ate/time";
import { families, type InstrumentRegistry, type Resolution } from "@ate/instrument-registry";
import {
  stateDomain,
  stateOwner,
  persistenceId,
  type StateAuthorityRegistry,
} from "@ate/persistence";
import {
  canonicalId,
  actor,
  code,
  digest,
  text,
  selectorSchema,
  proposalSchema,
  decisionSchema,
  snapshotSchema,
  clockSchema,
  ok,
  fail,
  type Snapshot,
  type Catalogue,
  type Proposal,
  type Decision,
  type Result,
  type Repository,
  type MappingState,
  type Batch,
} from "./contracts.js";
import { safeClone, parseJson, errorLabel } from "./boundary.js";
import { policyFromEffective, policyFingerprint, type Policy } from "./policy.js";
import {
  discoveryStates,
  prepareBatch,
  makeCatalogue,
  reconstructBatch,
  namespaceKey,
  bytes,
  freshness,
  compare,
} from "./normalization.js";
import { registryView, mappingQuery, proposalFingerprint } from "./registry.js";
import { reconcile } from "./reconciliation.js";
export interface LaboratoryPorts {
  clock: Clock;
  configuration: () => EffectiveConfiguration;
  registryConfiguration: () => EffectiveConfiguration;
  registry: InstrumentRegistry;
  repository: Repository;
  authority: StateAuthorityRegistry;
  authorityResolver: ApprovalAuthorityResolver;
  verifySourceEvidence?: (batch: Batch) => boolean;
}
export type CatalogueComparison = ReturnType<typeof reconcile> &
  Readonly<{
    differenceFingerprint: string;
    laboratorySnapshot: string | null;
    queryAt: Catalogue["importedAt"];
    clockProvenance: Catalogue["clockProvenance"];
    sourceEvidence: { before: Catalogue["source"]; after: Catalogue["source"] };
    mappingEvidence: readonly Readonly<{
      proposalId: string;
      catalogueFingerprint: string;
      registrySnapshot: string;
      candidateIds: readonly string[];
      outcome: Proposal["outcome"];
      currentMapping: ReturnType<BrokerSymbolCatalogue["mapping"]>;
    }>[];
    economicEquivalence: "NOT_ESTABLISHED";
  }>;
const requestSchema = z
  .object({
    catalogueFingerprint: digest,
    rawSymbol: text,
    selector: selectorSchema,
    maker: actor,
    reason: text,
  })
  .strict();
const reviewSchema = z
  .object({
    checker: actor,
    state: z.enum([
      "NEEDS_REVIEW",
      "AMBIGUOUS",
      "REJECTED",
      "APPROVED_FOR_RESEARCH_ASSOCIATION",
      "SUPERSEDED",
      "EXPIRED_OR_STALE",
    ]),
    selectedCandidate: canonicalId.optional(),
    supersededBy: digest.optional(),
    reason: text,
  })
  .strict();
type Lifecycle = "CREATED" | "READY" | "FAILED" | "RECOVERY_REQUIRED" | "STOPPED";
const contentHash = (v: { fingerprint: string }): string => {
  const { fingerprint: _fp, ...content } = v;
  return fingerprint(content);
};
const unchangedPrefix = (before: readonly unknown[], after: readonly unknown[]) =>
  before.length <= after.length && before.every((v, i) => fingerprint(v) === fingerprint(after[i]));
/** Sole mutable lifecycle around immutable derived state. Economic identity remains owned by P20. */
export class BrokerSymbolCatalogue {
  private lifecycle: Lifecycle = "CREATED";
  private busy = false;
  private checkingContext = false;
  private current: Snapshot | undefined;
  private history: Snapshot[] = [];
  private policy: Policy | undefined;
  private configurationFingerprint = "";
  private lastError: string | null = null;
  private publication: Readonly<{ generation: number; fingerprint: string }> | null = null;
  public constructor(
    private readonly laboratoryId: string,
    private readonly ports: LaboratoryPorts,
  ) {
    code.parse(laboratoryId);
  }
  private context(): Policy {
    if (this.checkingContext) throw Error("REENTRANT_CONFIGURATION");
    this.checkingContext = true;
    try {
      const c = policyFromEffective(this.ports.configuration());
      digest.parse(c.configurationFingerprint);
      const registered = this.ports.authority.require(stateDomain("broker.catalogue"));
      if (
        !registered.ok ||
        registered.value.owner !== stateOwner("broker.catalogue") ||
        registered.value.authorityType !== "DERIVED" ||
        registered.value.writeAuthority !== "broker.catalogue" ||
        !registered.value.runtimeModes.includes("RESEARCH") ||
        !registered.value.durable ||
        !registered.value.historyRequired ||
        !registered.value.reconciliationRequired
      )
        throw Error("STATE_AUTHORITY_REQUIRED");
      if (
        this.policy &&
        (c.configurationFingerprint !== this.configurationFingerprint ||
          policyFingerprint(c.policy) !== policyFingerprint(this.policy))
      )
        throw Error("CONFIGURATION_DRIFT");
      return c.policy;
    } finally {
      this.checkingContext = false;
    }
  }
  private gate(): Policy {
    if (this.lifecycle !== "READY" || this.busy || this.checkingContext)
      throw Error(this.busy ? "BUSY" : "NOT_READY");
    return this.context();
  }
  private source(b: Batch): void {
    if (
      (b.source.quality === "EVIDENCED_RECORDED" || b.source.timeQuality === "EVIDENCED") &&
      this.ports.verifySourceEvidence?.(b) !== true
    )
      throw Error("SOURCE_CERTIFICATE_REQUIRED");
  }
  private reject<T>(e: unknown, unknown = false): Result<T> {
    const error = errorLabel(e);
    this.lastError = error.slice(0, 256);
    if (unknown) this.lifecycle = "RECOVERY_REQUIRED";
    return fail(this.lastError, unknown ? "UNKNOWN" : "NONE");
  }
  public diagnostics() {
    let qualified = false;
    try {
      this.context();
      qualified = true;
    } catch {
      /* fail closed */
    }
    const ready = this.lifecycle === "READY" && !this.busy && qualified;
    return freeze({
      laboratoryId: this.laboratoryId,
      lifecycle: this.lifecycle,
      readiness: ready ? "READY" : "NOT_READY",
      health: ready ? "HEALTHY" : "DEGRADED",
      pending: this.busy || this.lifecycle === "RECOVERY_REQUIRED" ? 1 : 0,
      unresolvedPublication: this.publication,
      recoveryRequired: this.lifecycle === "RECOVERY_REQUIRED",
      generation: this.current?.generation ?? 0,
      fingerprint: this.current?.fingerprint ?? null,
      lastError: this.lastError,
      scope: "OFFLINE_RESEARCH_ONLY",
      availabilityNow: "NOT_ESTABLISHED",
    });
  }
  public async initialize(): Promise<Result<Snapshot | undefined>> {
    if (this.busy || !["CREATED", "FAILED"].includes(this.lifecycle))
      return fail("INITIALIZATION_NOT_ALLOWED");
    this.busy = true;
    let entered = false;
    try {
      this.policy = this.context();
      this.configurationFingerprint = policyFromEffective(
        this.ports.configuration(),
      ).configurationFingerprint;
      entered = true;
      const result = await this.ports.repository.load();
      const certificate = z
        .discriminatedUnion("ok", [
          z
            .object({
              ok: z.literal(true),
              value: z.array(z.unknown()).max(this.policy.maxSnapshots),
            })
            .strict(),
          z
            .object({
              ok: z.literal(false),
              error: z.object({ code: text, commitment: z.enum(["NONE", "UNKNOWN"]) }).strict(),
            })
            .strict(),
        ])
        .parse(safeClone(result, this.policy.maxRetainedBytes));
      if (!certificate.ok) throw Error(certificate.error.code);
      const history: Snapshot[] = [];
      let previous: Snapshot | undefined;
      let retained = 0;
      for (const raw of certificate.value) {
        const s = snapshotSchema.parse(safeClone(raw, this.policy.maxSnapshotBytes));
        retained += bytes(s);
        if (retained > this.policy.maxRetainedBytes) throw Error("RETAINED_CAPACITY");
        await this.validateSnapshot(s, previous);
        history.push(freeze(s));
        previous = s;
      }
      this.context();
      this.history = history;
      this.current = previous;
      this.lifecycle = "READY";
      this.lastError = null;
      return ok(this.current);
    } catch (e) {
      if (!entered) {
        this.policy = undefined;
        this.configurationFingerprint = "";
        this.lifecycle = "FAILED";
      }
      return this.reject(e, entered);
    } finally {
      this.busy = false;
    }
  }
  private async validateSnapshot(s: Snapshot, previous: Snapshot | undefined): Promise<void> {
    const p = this.policy!;
    if (
      s.laboratoryId !== this.laboratoryId ||
      s.generation !== (previous?.generation ?? 0) + 1 ||
      s.previous !== (previous?.fingerprint ?? null) ||
      s.configurationFingerprint !== this.configurationFingerprint ||
      s.policyFingerprint !== policyFingerprint(p) ||
      contentHash(s) !== s.fingerprint ||
      bytes(s) > p.maxSnapshotBytes ||
      s.proposals.length > p.maxProposals ||
      s.decisions.length > p.maxDecisions ||
      s.generation > p.maxSnapshots ||
      s.publishedAt < (previous?.publishedAt ?? s.publishedAt)
    )
      throw Error("SNAPSHOT_IDENTITY_OR_CAPACITY");
    clockSchema.parse(s.clockProvenance);
    if (
      previous &&
      (!unchangedPrefix(previous.catalogues, s.catalogues) ||
        !unchangedPrefix(previous.proposals, s.proposals) ||
        !unchangedPrefix(previous.decisions, s.decisions))
    )
      throw Error("IMMUTABLE_HISTORY_CHANGED");
    const delta =
      s.catalogues.length -
      (previous?.catalogues.length ?? 0) +
      (s.proposals.length - (previous?.proposals.length ?? 0)) +
      (s.decisions.length - (previous?.decisions.length ?? 0));
    if (
      new Set(s.proposals.map((p) => p.proposalId)).size !== s.proposals.length ||
      new Set(s.decisions.map((d) => d.decisionId)).size !== s.decisions.length
    )
      throw Error("DUPLICATE_HISTORY_IDENTITY");
    if (delta !== 1) throw Error("ONE_IMMUTABLE_TRANSITION_REQUIRED");
    const namespaces = new Map<string, Catalogue[]>();
    for (const c of s.catalogues) {
      const chain = namespaces.get(c.namespaceKey) ?? [];
      if (
        chain.length >= p.maxCataloguesPerNamespace ||
        c.version !== chain.length + 1 ||
        c.parent !== (chain.at(-1)?.fingerprint ?? null) ||
        chain.some((v) => v.batchId === c.batchId) ||
        chain.some((v) => fingerprint(v.namespace) !== fingerprint(c.namespace))
      )
        throw Error("CATALOGUE_HISTORY_INVALID");
      chain.push(c);
      namespaces.set(c.namespaceKey, chain);
    }
    if (namespaces.size > p.maxNamespaces) throw Error("NAMESPACE_CAPACITY");
    for (const c of s.catalogues.slice(previous?.catalogues.length ?? 0)) {
      const b = prepareBatch(reconstructBatch(c), p);
      this.source(b);
      if (
        c.namespaceKey !== namespaceKey(b.namespace) ||
        fingerprint(makeCatalogue(b, p, c.version, c.parent, c.importedAt, c.clockProvenance)) !==
          fingerprint(c) ||
        c.publishedAt > s.publishedAt
      )
        throw Error("CATALOGUE_RECONSTRUCTION_FAILED");
    }
    for (const proposal of s.proposals.slice(previous?.proposals.length ?? 0)) {
      const c = s.catalogues.find((c) => c.fingerprint === proposal.catalogueFingerprint);
      if (!c) throw Error("PROPOSAL_CATALOGUE_MISSING");
      const o = c.observations.find((o) => o.raw.rawSymbol === proposal.rawSymbol);
      if (
        !o ||
        o.fingerprint !== proposal.observationFingerprint ||
        proposal.namespaceKey !== c.namespaceKey ||
        proposal.configurationFingerprint !== this.configurationFingerprint ||
        proposal.proposalId !== proposalFingerprint(proposal) ||
        proposal.createdAt > s.publishedAt ||
        proposal.createdAt < c.publishedAt
      )
        throw Error("PROPOSAL_IDENTITY_INVALID");
      const view = await registryView(
        this.ports.registry,
        this.ports.registryConfiguration,
        this.ports.clock,
        proposal.registrySnapshot,
        p.maxRegistryHistory,
      );
      const query = mappingQuery(o, proposal.selector, c.namespace.brokerNamespaceId),
        resolution = view.resolve(query);
      if (!resolution.ok) throw Error("REGISTRY_RESOLUTION_FAILED");
      const derived = this.derive(resolution.value, o, proposal.selector);
      if (
        proposal.registryId !== view.diagnostics().registryId ||
        fingerprint(query) !== fingerprint(proposal.query) ||
        fingerprint(resolution.value) !== fingerprint(proposal.resolution) ||
        fingerprint(derived) !==
          fingerprint({
            candidateIds: proposal.candidateIds,
            contradictions: proposal.contradictions,
            outcome: proposal.outcome,
            evidenceClass: proposal.evidenceClass,
            initialState: proposal.initialState,
          })
      )
        throw Error("PROPOSAL_EVIDENCE_CHANGED");
    }
    for (const d of s.decisions.slice(previous?.decisions.length ?? 0)) {
      const proposal = s.proposals.find((p) => p.proposalId === d.proposalId);
      const prior = s.decisions.filter(
        (v) => v.proposalId === d.proposalId && v.sequence < d.sequence,
      );
      if (
        !proposal ||
        d.decisionId !== fingerprint((({ decisionId: _id, ...rest }) => rest)(d)) ||
        d.sequence !== prior.length + 1 ||
        d.previous !== (prior.at(-1)?.decisionId ?? null) ||
        d.policyFingerprint !== s.policyFingerprint ||
        d.configurationFingerprint !== s.configurationFingerprint ||
        d.checker.actorId === proposal.maker.actorId ||
        d.authorityEvidence.actorId !== d.checker.actorId ||
        d.authorityEvidence.checkedAt !== d.decidedAt ||
        d.decidedAt > s.publishedAt ||
        d.decidedAt < proposal.createdAt ||
        d.decidedAt < (prior.at(-1)?.decidedAt ?? proposal.createdAt)
      )
        throw Error("DECISION_CERTIFICATE_INVALID");
      if (d.state === "APPROVED_FOR_RESEARCH_ASSOCIATION") {
        const cat = s.catalogues.find((c) => c.fingerprint === proposal.catalogueFingerprint)!,
          o = cat.observations.find((o) => o.fingerprint === proposal.observationFingerprint)!;
        if (["STALE_EVIDENCE", "FUTURE_EVIDENCE"].includes(freshness(cat, o, d.decidedAt, p)))
          throw Error("HISTORICALLY_STALE_APPROVAL");
      }
      const authority = this.ports.authorityResolver.resolve(d.checker, {
        classification: "STANDARD",
        requiredAuthority: "CONFIGURATION_CHECKER",
        runtimeMode: "RESEARCH",
        policyId: configurationApprovalPolicyId(p.approvalPolicyId),
      });
      if (
        !authority.ok ||
        authority.value.authorized !== true ||
        authority.value.actorId !== d.checker.actorId ||
        authority.value.authority !== "CONFIGURATION_CHECKER"
      )
        throw Error("CURRENT_CHECKER_AUTHORITY_REQUIRED");
      this.transition(
        proposal,
        prior.at(-1)?.state ?? proposal.initialState,
        d.state,
        d.selectedCandidate,
        d.supersededBy,
        s,
        false,
      );
    }
  }
  private derive(
    r: Resolution,
    o: Catalogue["observations"][number],
    selector: Proposal["selector"],
  ): Pick<
    Proposal,
    "candidateIds" | "contradictions" | "outcome" | "initialState" | "evidenceClass"
  > {
    const ids = r.candidates.map((c) => c.instrumentId).sort(compare);
    const contradictions: string[] = [];
    for (const candidate of r.candidates) {
      if (
        o.raw.declaredFamily &&
        o.raw.declaredFamily !== "UNKNOWN" &&
        o.raw.declaredFamily !== candidate.definition.identity.family
      )
        contradictions.push("FAMILY_CONFLICT");
      const identity = candidate.definition.identity as Record<string, unknown>;
      for (const [sourceKey, identityKey, flag] of [
        ["baseCurrency", "base", "CURRENCY_CONFLICT"],
        ["quoteCurrency", "quote", "CURRENCY_CONFLICT"],
        ["venue", "venue", "VENUE_CONFLICT"],
        ["underlyingReference", "underlying", "UNDERLYING_CONFLICT"],
        ["contractReference", "contract", "CONTRACT_CONFLICT"],
        ["expiry", "expiry", "EXPIRY_CONFLICT"],
      ] as const)
        if (
          o.raw[sourceKey] !== undefined &&
          identity[identityKey] !== undefined &&
          o.raw[sourceKey] !== identity[identityKey]
        )
          contradictions.push(flag);
    }
    const outcome: Proposal["outcome"] = o.quality.flags.length
      ? "INVALID_SOURCE_OBSERVATION"
      : contradictions.length
        ? "MAPPING_CONFLICT"
        : r.status === "INVALID_INPUT" ||
            r.status === "UNSUPPORTED_SCHEME" ||
            r.status === "INSUFFICIENT_EVIDENCE"
          ? "INSUFFICIENT_EVIDENCE"
          : r.status === "AMBIGUOUS" || ids.length > 1
            ? "MULTIPLE_CANDIDATES"
            : ids.length === 1
              ? "UNIQUE_CANDIDATE"
              : "NO_CANDIDATE";
    return {
      candidateIds: ids,
      contradictions: [...new Set(contradictions)].sort(compare),
      outcome,
      evidenceClass: selector.kind === "IDENTIFIER" ? "SCOPED_IDENTIFIER" : "LOOKUP_ONLY",
      initialState:
        outcome === "MULTIPLE_CANDIDATES"
          ? "AMBIGUOUS"
          : outcome === "UNIQUE_CANDIDATE" && selector.kind === "IDENTIFIER"
            ? "PROPOSED"
            : "NEEDS_REVIEW",
    };
  }
  private async publish(
    catalogues: Catalogue[],
    proposals: Proposal[],
    decisions: Decision[],
  ): Promise<Result<Snapshot>> {
    const p = this.context();
    const at = this.ports.clock.now();
    const content = {
      schemaVersion: 1 as const,
      laboratoryId: this.laboratoryId,
      generation: (this.current?.generation ?? 0) + 1,
      previous: this.current?.fingerprint ?? null,
      configurationFingerprint: this.configurationFingerprint,
      policyFingerprint: policyFingerprint(p),
      publishedAt: at,
      clockProvenance: clockSchema.parse(safeClone(this.ports.clock.provenance)),
      catalogues,
      proposals,
      decisions,
    };
    const next = freeze(snapshotSchema.parse({ ...content, fingerprint: fingerprint(content) }));
    if (
      this.history.length >= p.maxSnapshots ||
      this.history.reduce((n, s) => n + bytes(s), bytes(next)) > p.maxRetainedBytes
    )
      return fail("RETAINED_CAPACITY");
    await this.validateSnapshot(next, this.current);
    const mutation = this.ports.authority.validateMutation({
      stateId: persistenceId(this.laboratoryId),
      stateDomain: stateDomain("broker.catalogue"),
      owner: stateOwner("broker.catalogue"),
      runtimeMode: "RESEARCH",
      payload: next,
      actor: { actorType: "SYSTEM" },
      transition: "IMMUTABLE_CATALOGUE_PUBLICATION",
    });
    if (!mutation.ok) return fail("STATE_MUTATION_REJECTED");
    let entered = false;
    try {
      this.context();
      entered = true;
      this.publication = freeze({ generation: next.generation, fingerprint: next.fingerprint });
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
        this.publication = null;
        return fail(cert.error.code);
      }
      if (fingerprint(cert.value) !== fingerprint(next)) throw Error("ACKNOWLEDGEMENT_MISMATCH");
      this.context();
      this.current = next;
      this.history.push(next);
      this.publication = null;
      this.lastError = null;
      return ok(next);
    } catch (e) {
      return this.reject(e, entered);
    }
  }
  private async write<T>(f: (p: Policy) => Promise<Result<T>>): Promise<Result<T>> {
    let p: Policy;
    try {
      p = this.gate();
    } catch (e) {
      return this.reject(e);
    }
    this.busy = true;
    try {
      return await f(p);
    } catch (e) {
      return this.reject(e);
    } finally {
      this.busy = false;
    }
  }
  public async importNative(raw: unknown): Promise<Result<Catalogue>> {
    return this.write(async (p) => {
      const b = prepareBatch(raw, p);
      this.source(b);
      const key = namespaceKey(b.namespace),
        catalogues = [...(this.current?.catalogues ?? [])],
        chain = catalogues.filter((c) => c.namespaceKey === key);
      const same = chain.find((c) => c.batchId === b.batchId);
      if (same)
        return same.inputFingerprint === fingerprint(b) ? ok(same) : fail("BATCH_ID_CONFLICT");
      if (chain.length && fingerprint(chain[0]!.namespace) !== fingerprint(b.namespace))
        return fail("NAMESPACE_METADATA_CONFLICT");
      const c = makeCatalogue(
        b,
        p,
        chain.length + 1,
        chain.at(-1)?.fingerprint ?? null,
        this.ports.clock.now(),
        clockSchema.parse(safeClone(this.ports.clock.provenance)),
      );
      const result = await this.publish(
        [...catalogues, c],
        [...(this.current?.proposals ?? [])],
        [...(this.current?.decisions ?? [])],
      );
      return result.ok ? ok(c) : result;
    });
  }
  public async importJson(raw: unknown): Promise<Result<Catalogue>> {
    try {
      const p = this.gate();
      return await this.importNative(parseJson(raw, p.maxSourceBytes));
    } catch (e) {
      return this.reject(e);
    }
  }
  public async propose(raw: unknown): Promise<Result<Proposal>> {
    return this.write(async (p) => {
      const request = requestSchema.parse(safeClone(raw, p.maxSourceBytes));
      const c = this.current?.catalogues.find(
          (c) => c.fingerprint === request.catalogueFingerprint,
        ),
        o = c?.observations.find((o) => o.raw.rawSymbol === request.rawSymbol);
      if (!c || !o) return fail("OBSERVATION_NOT_FOUND");
      const snapshot = this.ports.registry.snapshot();
      if (!snapshot.ok || !snapshot.value) return fail("REGISTRY_NOT_READY");
      const view = await registryView(
          this.ports.registry,
          this.ports.registryConfiguration,
          this.ports.clock,
          snapshot.value.fingerprint,
          p.maxRegistryHistory,
        ),
        query = mappingQuery(o, request.selector, c.namespace.brokerNamespaceId),
        resolution = view.resolve(query);
      if (!resolution.ok) return fail("REGISTRY_RESOLUTION_FAILED");
      const content = {
        ...request,
        namespaceKey: c.namespaceKey,
        observationFingerprint: o.fingerprint,
        query,
        registryId: view.diagnostics().registryId,
        registrySnapshot: snapshot.value.fingerprint,
        registryVersion: "0.20.0-instrument-registry.1" as const,
        resolution: safeClone(resolution.value, p.maxSnapshotBytes),
        ...this.derive(resolution.value, o, request.selector),
        createdAt: this.ports.clock.now(),
        clockProvenance: clockSchema.parse(safeClone(this.ports.clock.provenance)),
        configurationFingerprint: this.configurationFingerprint,
      };
      const proposal = freeze(
        proposalSchema.parse({ ...content, proposalId: fingerprint(content) }),
      );
      const existing = this.current?.proposals.find((p) => p.proposalId === proposal.proposalId);
      if (existing) return ok(existing);
      const result = await this.publish(
        [...this.current!.catalogues],
        [...this.current!.proposals, proposal],
        [...this.current!.decisions],
      );
      return result.ok ? ok(proposal) : result;
    });
  }
  private transition(
    proposal: Proposal,
    prior: MappingState,
    next: MappingState,
    candidate: string | null,
    superseded: string | null,
    s: Snapshot,
    current: boolean,
  ): void {
    if (["REJECTED", "SUPERSEDED", "EXPIRED_OR_STALE"].includes(prior))
      throw Error("TERMINAL_MAPPING_STATE");
    if (next === "APPROVED_FOR_RESEARCH_ASSOCIATION") {
      if (
        proposal.evidenceClass !== "SCOPED_IDENTIFIER" ||
        proposal.outcome !== "UNIQUE_CANDIDATE" ||
        !candidate ||
        !proposal.candidateIds.includes(candidate) ||
        proposal.contradictions.length
      )
        throw Error("INDEPENDENT_ECONOMIC_EVIDENCE_REQUIRED");
      const cat = s.catalogues.find((c) => c.fingerprint === proposal.catalogueFingerprint)!;
      const o = cat.observations.find((o) => o.fingerprint === proposal.observationFingerprint)!;
      if (
        s.catalogues.filter((c) => c.namespaceKey === cat.namespaceKey).at(-1)?.fingerprint !==
          cat.fingerprint ||
        o.quality.flags.length
      )
        throw Error("STALE_OR_INVALID_MAPPING");
      if (current) {
        const registry = this.ports.registry.snapshot();
        if (
          !registry.ok ||
          registry.value?.fingerprint !== proposal.registrySnapshot ||
          ["STALE_EVIDENCE", "FUTURE_EVIDENCE"].includes(
            freshness(cat, o, this.ports.clock.now(), this.policy!),
          )
        )
          throw Error("STALE_OR_INVALID_MAPPING");
      }
    } else if (candidate !== null) throw Error("CANDIDATE_ONLY_FOR_APPROVAL");
    if (next === "SUPERSEDED") {
      const replacement = s.proposals.find((p) => p.proposalId === superseded);
      if (
        !replacement ||
        replacement.proposalId === proposal.proposalId ||
        replacement.namespaceKey !== proposal.namespaceKey ||
        replacement.rawSymbol !== proposal.rawSymbol
      )
        throw Error("SUPERSESSION_CONTEXT");
    } else if (superseded !== null) throw Error("UNEXPECTED_SUPERSESSION");
  }
  public async review(proposalId: string, raw: unknown): Promise<Result<Decision>> {
    return this.write(async (p) => {
      digest.parse(proposalId);
      const r = reviewSchema.parse(safeClone(raw, p.maxRecordBytes)),
        proposal = this.current?.proposals.find((v) => v.proposalId === proposalId);
      if (!proposal) return fail("PROPOSAL_NOT_FOUND");
      if (r.checker.actorId === proposal.maker.actorId) return fail("MAKER_CHECKER_SEPARATION");
      const prior = this.current!.decisions.filter((d) => d.proposalId === proposalId);
      this.transition(
        proposal,
        prior.at(-1)?.state ?? proposal.initialState,
        r.state,
        r.selectedCandidate ?? null,
        r.supersededBy ?? null,
        this.current!,
        true,
      );
      // The owner certifies authority at checkedAt; the enclosing clock observations
      // qualify that instant without requiring a later clock read to be identical.
      const provenance = clockSchema.parse(safeClone(this.ports.clock.provenance)),
        before = mustParseUtc(this.ports.clock.now());
      const authority = this.ports.authorityResolver.resolve(r.checker, {
        classification: "STANDARD",
        requiredAuthority: "CONFIGURATION_CHECKER",
        runtimeMode: "RESEARCH",
        policyId: configurationApprovalPolicyId(p.approvalPolicyId),
      });
      if (!authority.ok) return fail("APPROVAL_AUTHORITY_REQUIRED");
      const after = mustParseUtc(this.ports.clock.now()),
        evidence = decisionSchema.shape.authorityEvidence.parse(
          safeClone(authority.value, p.maxRecordBytes),
        );
      if (
        evidence.actorId !== r.checker.actorId ||
        evidence.checkedAt < before ||
        evidence.checkedAt > after ||
        fingerprint(provenance) !==
          fingerprint(clockSchema.parse(safeClone(this.ports.clock.provenance)))
      )
        return fail("APPROVAL_CERTIFICATE_MISMATCH");
      const at = evidence.checkedAt;
      // Recheck current source/registry context after the resolver callback.
      this.transition(
        proposal,
        prior.at(-1)?.state ?? proposal.initialState,
        r.state,
        r.selectedCandidate ?? null,
        r.supersededBy ?? null,
        this.current!,
        true,
      );
      const content = {
        proposalId,
        sequence: prior.length + 1,
        previous: prior.at(-1)?.decisionId ?? null,
        state: r.state,
        selectedCandidate: r.selectedCandidate ?? null,
        supersededBy: r.supersededBy ?? null,
        checker: r.checker,
        reason: r.reason,
        authorityEvidence: evidence,
        policyFingerprint: policyFingerprint(p),
        configurationFingerprint: this.configurationFingerprint,
        decidedAt: at,
        clockProvenance: provenance,
      };
      const decision = freeze(
        decisionSchema.parse({ ...content, decisionId: fingerprint(content) }),
      );
      const result = await this.publish(
        [...this.current!.catalogues],
        [...this.current!.proposals],
        [...this.current!.decisions, decision],
      );
      return result.ok ? ok(decision) : result;
    });
  }
  public snapshot(ref?: string): Result<Snapshot | undefined> {
    try {
      this.gate();
      if (ref !== undefined) {
        digest.parse(ref);
        const s = this.history.find((s) => s.fingerprint === ref);
        return s ? ok(s) : fail("SNAPSHOT_NOT_FOUND");
      }
      return ok(this.current);
    } catch (e) {
      return this.reject(e);
    }
  }
  public catalogue(ref: string): Result<Catalogue> {
    try {
      this.gate();
      digest.parse(ref);
      const c = this.current?.catalogues.find((c) => c.fingerprint === ref);
      return c ? ok(c) : fail("CATALOGUE_NOT_FOUND");
    } catch (e) {
      return this.reject(e);
    }
  }
  public mapping(id: string): Result<
    Readonly<{
      proposal: Proposal;
      decisions: readonly Decision[];
      state: MappingState;
      staleReasons: readonly string[];
    }>
  > {
    try {
      const p = this.gate();
      digest.parse(id);
      const proposal = this.current?.proposals.find((p) => p.proposalId === id);
      if (!proposal) return fail("PROPOSAL_NOT_FOUND");
      const decisions = this.current!.decisions.filter((d) => d.proposalId === id),
        cat = this.current!.catalogues.find(
          (c) => c.fingerprint === proposal.catalogueFingerprint,
        )!,
        o = cat.observations.find((o) => o.fingerprint === proposal.observationFingerprint)!;
      const registry = this.ports.registry.snapshot(),
        staleReasons: string[] = [];
      if (
        this.current!.catalogues.filter((c) => c.namespaceKey === cat.namespaceKey).at(-1)
          ?.fingerprint !== cat.fingerprint
      )
        staleReasons.push("CATALOGUE_SUPERSEDED");
      if (!registry.ok || registry.value?.fingerprint !== proposal.registrySnapshot)
        staleReasons.push("REGISTRY_CONTEXT_CHANGED");
      if (
        ["STALE_EVIDENCE", "FUTURE_EVIDENCE"].includes(freshness(cat, o, this.ports.clock.now(), p))
      )
        staleReasons.push("SOURCE_TIME_NOT_CURRENT");
      let state: MappingState = decisions.at(-1)?.state ?? proposal.initialState;
      if (staleReasons.length && !["REJECTED", "SUPERSEDED"].includes(state))
        state = "EXPIRED_OR_STALE";
      return ok(freeze({ proposal, decisions, state, staleReasons }));
    } catch (e) {
      return this.reject(e);
    }
  }
  public query(
    raw: unknown,
  ): Result<Readonly<{ total: number; nextOffset: number | null; records: readonly unknown[] }>> {
    try {
      const p = this.gate();
      const q = z
        .object({
          kind: z.enum([
            "NAMESPACES",
            "CATALOGUES",
            "OBSERVATIONS",
            "MAPPINGS",
            "UNRESOLVED",
            "HISTORY",
          ]),
          catalogueFingerprint: digest.optional(),
          namespaceKey: digest.optional(),
          rawSymbol: text.optional(),
          normalizedKey: text.optional(),
          family: z.enum([...families, "UNKNOWN"]).optional(),
          version: z.number().int().positive().optional(),
          offset: z.number().int().min(0),
          limit: z.number().int().min(1).max(p.maxQueryResults),
        })
        .strict()
        .parse(safeClone(raw, p.maxRecordBytes));
      const observationMatches = (o: Catalogue["observations"][number]): boolean =>
        (q.rawSymbol === undefined || o.raw.rawSymbol === q.rawSymbol) &&
        (q.normalizedKey === undefined || o.keys.some((k) => k.value === q.normalizedKey)) &&
        (q.family === undefined || o.classification.family === q.family);
      const hasObservationFilter =
        q.rawSymbol !== undefined || q.normalizedKey !== undefined || q.family !== undefined;
      const catalogueMatches = (c: Catalogue): boolean =>
        (q.catalogueFingerprint === undefined || c.fingerprint === q.catalogueFingerprint) &&
        (q.namespaceKey === undefined || c.namespaceKey === q.namespaceKey) &&
        (q.version === undefined || c.version === q.version) &&
        (!hasObservationFilter || c.observations.some(observationMatches));
      if (
        q.catalogueFingerprint !== undefined &&
        !this.current?.catalogues.some((c) => c.fingerprint === q.catalogueFingerprint)
      )
        return fail("CATALOGUE_NOT_FOUND");
      const cats = (this.current?.catalogues ?? []).filter(catalogueMatches);
      let records: readonly unknown[];
      if (q.kind === "NAMESPACES")
        records = [...new Map(cats.map((c) => [c.namespaceKey, c.namespace])).values()];
      else if (q.kind === "CATALOGUES") records = cats;
      else if (q.kind === "HISTORY")
        records = this.history.filter(
          (s) =>
            (q.catalogueFingerprint === undefined &&
              q.namespaceKey === undefined &&
              q.version === undefined &&
              !hasObservationFilter) ||
            s.catalogues.some(catalogueMatches),
        );
      else if (q.kind === "OBSERVATIONS")
        records = cats.flatMap((c) =>
          c.observations.filter(observationMatches).map((o) => ({
            catalogueFingerprint: c.fingerprint,
            namespaceKey: c.namespaceKey,
            observation: o,
            discoveryStates: discoveryStates(o),
            freshness: freshness(c, o, this.ports.clock.now(), p),
            availabilityNow: "NOT_ESTABLISHED",
          })),
        );
      else {
        const mappings = [];
        for (const v of this.current?.proposals ?? []) {
          const c = cats.find((c) => c.fingerprint === v.catalogueFingerprint);
          const o = c?.observations.find((o) => o.fingerprint === v.observationFingerprint);
          if (!o || !observationMatches(o)) continue;
          const result = this.mapping(v.proposalId);
          if (!result.ok) return result;
          if (q.kind === "MAPPINGS" || result.value.state !== "APPROVED_FOR_RESEARCH_ASSOCIATION")
            mappings.push(result.value);
        }
        records = mappings;
      }
      const page = records.slice(q.offset, q.offset + q.limit);
      return ok(
        freeze({
          total: records.length,
          nextOffset: q.offset + page.length < records.length ? q.offset + page.length : null,
          records: page,
        }),
      );
    } catch (e) {
      return this.reject(e);
    }
  }
  public compare(before: string, after: string): Result<CatalogueComparison> {
    try {
      const p = this.gate(),
        a = this.catalogue(before),
        b = this.catalogue(after);
      if (!a.ok) return a;
      if (!b.ok) return b;
      const result = reconcile(a.value, b.value, p);
      const { fingerprint: differenceFingerprint, ...comparison } = result;
      const content = {
        ...comparison,
        differenceFingerprint,
        laboratorySnapshot: this.current?.fingerprint ?? null,
        queryAt: this.ports.clock.now(),
        clockProvenance: clockSchema.parse(safeClone(this.ports.clock.provenance)),
        sourceEvidence: { before: a.value.source, after: b.value.source },
        mappingEvidence: (this.current?.proposals ?? [])
          .filter((v) => [before, after].includes(v.catalogueFingerprint))
          .map((v) => ({
            proposalId: v.proposalId,
            catalogueFingerprint: v.catalogueFingerprint,
            registrySnapshot: v.registrySnapshot,
            candidateIds: v.candidateIds,
            outcome: v.outcome,
            currentMapping: this.mapping(v.proposalId),
          })),
        economicEquivalence: "NOT_ESTABLISHED" as const,
      };
      return ok(freeze({ ...content, fingerprint: fingerprint(content) }));
    } catch (e) {
      return this.reject(e);
    }
  }
  public async stop(): Promise<Result<void>> {
    await Promise.resolve();
    if (this.busy || this.checkingContext) return fail("BUSY");
    if (this.lifecycle === "RECOVERY_REQUIRED") return fail("RECOVERY_REQUIRED", "UNKNOWN");
    this.lifecycle = "STOPPED";
    return ok(undefined);
  }
}
