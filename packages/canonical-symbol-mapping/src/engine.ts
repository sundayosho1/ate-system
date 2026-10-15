import { fingerprint, type EffectiveConfiguration } from "@ate/configuration";
import { freeze } from "@ate/multitimeframe";
import { identitySchema, type InstrumentRegistry, type Revision } from "@ate/instrument-registry";
import {
  snapshotSchema as brokerSnapshotSchema,
  type BrokerSymbolCatalogue,
} from "@ate/broker-symbol-catalogue";
import type { Clock } from "@ate/time";
import {
  requestSchema,
  mappingSchema,
  preparedSchema,
  type Request,
  type Prepared,
  type Policy,
  type Mapping,
} from "./contracts.js";
import { safeClone } from "./boundary.js";
import { retainedRegistryView, type RegistryEvidenceVerifier } from "./registry-view.js";
export interface EvidencePorts {
  clock: Clock;
  registry: InstrumentRegistry;
  registryConfiguration: () => EffectiveConfiguration;
  sources: ReadonlyMap<string, BrokerSymbolCatalogue>;
  verifyRegistryEvidence?: RegistryEvidenceVerifier;
}
const sorted = (xs: Iterable<string>) =>
  [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
export const contentFingerprint = (value: Readonly<{ fingerprint: string }>) => {
  const { fingerprint: _fp, ...rest } = value;
  return fingerprint(rest);
};
export function canonicalRequest(raw: unknown, p: Policy): Request {
  const r = requestSchema.parse(safeClone(raw, p.maxInputBytes, p.maxInputDepth));
  r.sources.sort((a, b) =>
    JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0,
  );
  for (const xs of [r.assertions, r.approvals])
    xs.sort((a, b) =>
      JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0,
    );
  if (
    r.sources.length > p.maxCatalogues ||
    new Set(r.sources.map((s) => s.ownerId + ":" + s.catalogueFingerprint)).size !==
      r.sources.length
  )
    throw Error("SOURCE_REFERENCE_CAPACITY_OR_DUPLICATE");
  return r;
}
export function currentContext(ports: EvidencePorts, r: Request): Prepared["context"] {
  const registry = ports.registry.snapshot();
  if (!registry.ok || !registry.value) throw Error("REGISTRY_NOT_READY");
  return {
    registryCurrent: registry.value.fingerprint,
    sourceCurrent: sorted(r.sources.map((s) => s.ownerId)).map((ownerId) => {
      const lab = ports.sources.get(ownerId);
      if (!lab || lab.diagnostics().laboratoryId !== ownerId) throw Error("SOURCE_OWNER_REQUIRED");
      const s = lab.snapshot();
      if (!s.ok || !s.value) throw Error("SOURCE_NOT_READY");
      return { ownerId, snapshot: s.value.fingerprint };
    }),
  };
}
export async function buildQualification(
  ports: EvidencePorts,
  r: Request,
  p: Policy,
  configurationFingerprint: string,
  evaluatedAt: Prepared["evaluatedAt"],
  clockProvenance: Prepared["clockProvenance"],
  context = currentContext(ports, r),
): Promise<Prepared> {
  const registry = await retainedRegistryView(
    ports.registry,
    ports.registryConfiguration,
    ports.clock,
    r.registrySnapshot,
    p.maxRegistryHistory,
    ports.verifyRegistryEvidence,
  );
  // Authenticate the retained current-at-publication registry context too, without latest fallback.
  if (!ports.registry.snapshotAt(context.registryCurrent).ok)
    throw Error("HISTORICAL_EVIDENCE_UNAVAILABLE");
  if (
    fingerprint(sorted(context.sourceCurrent.map((s) => s.ownerId))) !==
    fingerprint(sorted(r.sources.map((s) => s.ownerId)))
  )
    throw Error("SOURCE_CONTEXT_INVALID");
  const catalogues: Prepared["catalogues"] = [],
    mappings: Mapping[] = [],
    usedAssertions = new Set<number>(),
    usedApprovals = new Set<number>();
  for (const reference of r.sources) {
    const lab = ports.sources.get(reference.ownerId);
    if (!lab || lab.diagnostics().laboratoryId !== reference.ownerId)
      throw Error("SOURCE_OWNER_REQUIRED");
    const root = lab.snapshot(reference.ownerSnapshot);
    if (!root.ok || !root.value) throw Error("HISTORICAL_EVIDENCE_UNAVAILABLE");
    const s = brokerSnapshotSchema.parse(safeClone(root.value, p.maxSnapshotBytes));
    const c = s.catalogues.find((c) => c.fingerprint === reference.catalogueFingerprint);
    if (!c) throw Error("CATALOGUE_NOT_IN_EXACT_SOURCE_ROOT");
    const currentRef = context.sourceCurrent.find((x) => x.ownerId === reference.ownerId);
    const currentRoot = currentRef && lab.snapshot(currentRef.snapshot);
    if (!currentRoot?.ok || !currentRoot.value) throw Error("HISTORICAL_EVIDENCE_UNAVAILABLE");
    const latest = currentRoot.value.catalogues
      .filter((v) => v.namespaceKey === c.namespaceKey)
      .at(-1);
    catalogues.push({ reference, catalogue: c });
    for (const o of c.observations) {
      if (mappings.length >= p.maxObservations) throw Error("OBSERVATION_CAPACITY");
      const identifiers = o.raw.identifiers ?? [];
      if (identifiers.length > p.maxClaims) throw Error("CLAIM_CAPACITY");
      const claims: Mapping["claims"] = [],
        lookupEvidence: Mapping["lookupEvidence"] = [],
        candidates = new Map<string, Revision>();
      const reasons: string[] = [];
      let invalid = false,
        ambiguous = false,
        none = false;
      for (const [index, claim] of identifiers.entries()) {
        const result = registry.resolve(claim);
        if (!result.ok) throw Error("REGISTRY_RESOLUTION_FAILED");
        const resolution = result.value;
        if (resolution.candidates.length > p.maxCandidates) throw Error("CANDIDATE_CAPACITY");
        const supported = p.identifierSchemes.includes(claim.scheme);
        const ids = sorted(resolution.candidates.map((v) => v.instrumentId));
        claims.push({
          index,
          claim: safeClone(claim) as Record<string, unknown>,
          status: resolution.status,
          candidateIds: ids,
          resolution: safeClone(resolution, p.maxSnapshotBytes) as Record<string, unknown>,
          policySupported: supported,
          evidenceIdentity: fingerprint({
            scheme: claim.scheme,
            scope: claim.scope ?? null,
            authority: claim.authority ?? null,
            value: resolution.normalization?.value ?? claim.value,
          }),
        });
        for (const candidate of resolution.candidates)
          candidates.set(candidate.instrumentId, candidate);
        if (
          !supported ||
          (p.requireVerifiedIdentifiers && resolution.status !== "EXACT_MATCH") ||
          ["INVALID_INPUT", "UNSUPPORTED_SCHEME", "INSUFFICIENT_EVIDENCE"].includes(
            resolution.status,
          )
        )
          invalid = true;
        if (ids.length > 1) ambiguous = true;
        if (!ids.length) none = true;
      }
      for (const key of o.keys) {
        const result = registry.resolve({
          aliasKind: "BROKER",
          scope: c.namespace.brokerNamespaceId,
          rule: "EXACT",
          value: key.value,
        });
        if (!result.ok) throw Error("LOOKUP_RESOLUTION_FAILED");
        if (result.value.candidates.length > p.maxCandidates) throw Error("CANDIDATE_CAPACITY");
        lookupEvidence.push({ key, resolution: safeClone(result.value, p.maxSnapshotBytes) });
      }
      const ids = sorted(candidates.keys());
      if (ids.length > p.maxCandidates) throw Error("CANDIDATE_CAPACITY");
      const target = ids.length === 1 ? candidates.get(ids[0]!)! : null;
      const matchingAssertions = r.assertions
        .map((v, index) => ({ v, index }))
        .filter(
          ({ v }) =>
            v.ownerId === reference.ownerId &&
            v.catalogueFingerprint === c.fingerprint &&
            v.observationFingerprint === o.fingerprint,
        );
      if (matchingAssertions.length > 1) throw Error("DUPLICATE_ASSERTION");
      const assertion = matchingAssertions[0]?.v ?? null;
      if (matchingAssertions[0]) usedAssertions.add(matchingAssertions[0].index);
      if (assertion) {
        const { contentFingerprint: _fp, ...body } = assertion;
        if (assertion.contentFingerprint !== fingerprint(body))
          throw Error("ASSERTION_FINGERPRINT");
      }
      let taxonomy = false,
        metadata = false;
      for (const candidate of candidates.values()) {
        const identity = candidate.definition.identity as unknown as Record<string, unknown>;
        if (
          o.raw.declaredFamily &&
          o.raw.declaredFamily !== "UNKNOWN" &&
          o.raw.declaredFamily !== identity["family"]
        ) {
          taxonomy = true;
          reasons.push("DECLARED_FAMILY_CONFLICT");
        }
        for (const [rawKey, key] of [
          ["baseCurrency", "base"],
          ["quoteCurrency", "quote"],
          ["venue", "venue"],
          ["underlyingReference", "underlying"],
          ["contractReference", "contract"],
          ["expiry", "expiry"],
        ] as const) {
          if (
            o.raw[rawKey] !== undefined &&
            identity[key] !== undefined &&
            o.raw[rawKey] !== identity[key]
          ) {
            metadata = true;
            reasons.push("METADATA_" + rawKey.toUpperCase() + "_CONFLICT");
          }
        }
        if (assertion) {
          const parsed = identitySchema.safeParse({ ...identity, ...assertion.identity });
          if (!parsed.success || fingerprint(parsed.data) !== fingerprint(identity)) {
            metadata = true;
            reasons.push("SUPPLEMENTAL_IDENTITY_CONFLICT");
          }
        }
        if (
          !p.canonicalQualification.includes(
            candidate.definition.qualification as "EVIDENCE_QUALIFIED" | "VERIFIED",
          )
        ) {
          invalid = true;
          reasons.push("CANONICAL_EVIDENCE_INSUFFICIENT");
        }
      }
      const distinctClaims = new Set(
        claims
          .filter((v) => v.policySupported && v.candidateIds.length === 1)
          .map((v) => v.evidenceIdentity),
      ).size;
      const uniqueClaimIds = sorted(
        claims.filter((v) => v.candidateIds.length === 1).flatMap((v) => v.candidateIds),
      );
      const disjoint = claims.some(
        (v, i) =>
          v.candidateIds.length &&
          claims.some(
            (other, j) =>
              i !== j &&
              other.candidateIds.length &&
              !v.candidateIds.some((id) => other.candidateIds.includes(id)),
          ),
      );
      const sourceAt = o.raw.observedAt ?? c.source.observedAt;
      const sourceStale =
        latest?.fingerprint !== c.fingerprint ||
        Date.parse(c.importedAt) > Date.parse(evaluatedAt) ||
        Date.parse(s.publishedAt) > Date.parse(evaluatedAt) ||
        (!!sourceAt &&
          (Date.parse(sourceAt) > Date.parse(evaluatedAt) ||
            Date.parse(evaluatedAt) - Date.parse(sourceAt) > p.maxSourceAgeMs));
      if (sourceStale) reasons.push("SOURCE_CONTEXT_STALE");
      if (r.registrySnapshot !== context.registryCurrent) reasons.push("REGISTRY_CONTEXT_STALE");
      if (o.quality.flags.length) {
        metadata = true;
        reasons.push(...o.quality.flags.map((v) => "SOURCE_" + v));
      }
      if (
        !p.sourceQuality.includes(c.source.quality) ||
        c.source.timeQuality === "UNKNOWN" ||
        !sourceAt
      ) {
        invalid = true;
        reasons.push("SOURCE_EVIDENCE_INSUFFICIENT");
      }
      const outcome: Mapping["outcome"] =
        uniqueClaimIds.length > 1 || disjoint
          ? "IDENTIFIER_CONFLICT"
          : taxonomy
            ? "TAXONOMY_CONFLICT"
            : metadata
              ? "SOURCE_METADATA_CONFLICT"
              : sourceStale
                ? "STALE_SOURCE"
                : r.registrySnapshot !== context.registryCurrent
                  ? "STALE_REGISTRY"
                  : invalid
                    ? "INSUFFICIENT_EVIDENCE"
                    : ambiguous
                      ? "MULTIPLE_CANDIDATES"
                      : none && ids.length
                        ? "INSUFFICIENT_EVIDENCE"
                        : !ids.length
                          ? identifiers.length
                            ? "NO_CANDIDATE"
                            : "INSUFFICIENT_EVIDENCE"
                          : distinctClaims < p.minIndependentClaims
                            ? "INSUFFICIENT_EVIDENCE"
                            : "UNIQUE_QUALIFIED_CANDIDATE";
      if (!identifiers.length || distinctClaims < p.minIndependentClaims)
        reasons.push("INDEPENDENT_IDENTIFIER_REQUIRED");
      if (outcome !== "UNIQUE_QUALIFIED_CANDIDATE") reasons.push(outcome);
      const ars = r.approvals
        .map((v, index) => ({ v, index }))
        .filter(
          ({ v }) =>
            v.ownerId === reference.ownerId &&
            v.catalogueFingerprint === c.fingerprint &&
            v.observationFingerprint === o.fingerprint,
        );
      if (ars.length > 1) throw Error("DUPLICATE_APPROVAL_REFERENCE");
      let approval: Mapping["approval"] = null;
      if (ars[0]) {
        usedApprovals.add(ars[0].index);
        const proposal = s.proposals.find((v) => v.proposalId === ars[0]!.v.proposalId);
        if (
          !proposal ||
          proposal.catalogueFingerprint !== c.fingerprint ||
          proposal.observationFingerprint !== o.fingerprint
        )
          throw Error("APPROVAL_CONTEXT");
        const decision =
          s.decisions.filter((v) => v.proposalId === proposal.proposalId).at(-1) ?? null;
        approval = {
          proposal,
          decision,
          consistent:
            !!target &&
            proposal.registrySnapshot === r.registrySnapshot &&
            decision?.state === "APPROVED_FOR_RESEARCH_ASSOCIATION" &&
            decision.selectedCandidate === target.instrumentId,
        };
      }
      const content = {
        qualificationVersion: 1 as const,
        registryId: registry.diagnostics().registryId,
        registrySnapshot: r.registrySnapshot,
        policyFingerprint: fingerprint(p),
        configurationFingerprint,
        evaluatedAt,
        clockProvenance,
        source: {
          ...reference,
          contextSnapshot: currentRef!.snapshot,
          namespaceKey: c.namespaceKey,
          namespace: c.namespace,
          observationFingerprint: o.fingerprint,
          version: c.version,
        },
        observation: o,
        normalizationFingerprint: fingerprint(o.keys),
        assertion,
        claims,
        lookupEvidence,
        candidateIds: ids,
        target: target
          ? {
              instrumentId: target.instrumentId,
              revisionId: target.revisionId,
              family: target.definition.identity.family,
            }
          : null,
        outcome,
        reasonCodes: sorted(reasons),
        approval,
        tradingAuthority: false as const,
      };
      mappings.push(mappingSchema.parse({ ...content, fingerprint: fingerprint(content) }));
    }
  }
  if (new Set(catalogues.map((v) => v.catalogue.namespaceKey)).size > p.maxNamespaces)
    throw Error("NAMESPACE_CAPACITY");
  if (usedAssertions.size !== r.assertions.length || usedApprovals.size !== r.approvals.length)
    throw Error("UNATTACHED_EVIDENCE");
  mappings.sort((a, b) =>
    a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0,
  );
  const keys = new Map<string, Mapping[]>();
  for (const m of mappings)
    for (const key of m.observation.keys) {
      const rows = keys.get(key.value) ?? [];
      if (!rows.some((v) => v.fingerprint === m.fingerprint)) rows.push(m);
      keys.set(key.value, rows);
    }
  const conflicts: Prepared["conflicts"] = [];
  for (const key of sorted(keys.keys())) {
    const ms = keys.get(key)!;
    const ids = sorted(
      ms
        .filter((m) => m.outcome === "UNIQUE_QUALIFIED_CANDIDATE")
        .flatMap((m) => (m.target ? [m.target.instrumentId] : [])),
    );
    if (ids.length > 1) {
      const c = {
        code: "NORMALIZED_KEY_DISTINCT_IDENTITIES",
        key,
        mappings: sorted(ms.map((m) => m.fingerprint)),
        candidateIds: ids,
      };
      conflicts.push({ ...c, fingerprint: fingerprint(c) });
    }
  }
  for (const m of mappings)
    if (
      ["IDENTIFIER_CONFLICT", "TAXONOMY_CONFLICT", "SOURCE_METADATA_CONFLICT"].includes(m.outcome)
    ) {
      const c = {
        code: m.outcome,
        key: m.source.observationFingerprint,
        mappings: [m.fingerprint],
        candidateIds: m.candidateIds,
      };
      conflicts.push({ ...c, fingerprint: fingerprint(c) });
    }
  if (
    conflicts.length > p.maxConflicts ||
    mappings.reduce((n, m) => n + m.reasonCodes.length, 0) > p.maxConflicts
  )
    throw Error("CONFLICT_CAPACITY");
  const groups: Prepared["groups"] = [];
  for (const id of sorted(
    mappings
      .filter((m) => m.outcome === "UNIQUE_QUALIFIED_CANDIDATE")
      .flatMap((m) => (m.target ? [m.target.instrumentId] : [])),
  )) {
    const members = mappings.filter(
      (m) => m.outcome === "UNIQUE_QUALIFIED_CANDIDATE" && m.target?.instrumentId === id,
    );
    if (members.length > p.maxGroupMembers) throw Error("GROUP_CAPACITY");
    const content = {
      instrumentId: id,
      revisionId: members[0]!.target!.revisionId,
      registrySnapshot: r.registrySnapshot,
      members: members.map((m) => m.fingerprint),
      contractEquivalence: "NOT_ESTABLISHED" as const,
      tradingAuthority: false as const,
    };
    groups.push({ ...content, fingerprint: fingerprint(content) });
  }
  const content = {
    request: r,
    policy: p,
    policyFingerprint: fingerprint(p),
    configurationFingerprint,
    evaluatedAt,
    clockProvenance,
    context,
    catalogues,
    mappings,
    conflicts,
    groups,
    inputFingerprint: fingerprint({ request: r, catalogues, registrySnapshot: r.registrySnapshot }),
  };
  return freeze(preparedSchema.parse({ ...content, fingerprint: fingerprint(content) }));
}
