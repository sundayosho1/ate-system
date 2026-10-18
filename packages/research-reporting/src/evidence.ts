import { validateInsightRecord } from "@ate/research-insight-contracts";
import type {
  EvidenceArtifact,
  EvidenceAnchor,
  ReportRequest,
  QualifiedObservation,
  CapturedNative,
} from "./contracts.js";
import {
  array,
  data,
  object,
  exact,
  id,
  utc,
  demand,
  freeze,
  digest,
  known,
  unknownFact,
} from "./validation.js";
export const promptOwners = Object.freeze([
  "repository",
  "domain",
  "runtime",
  "events",
  "persistence",
  "time",
  "configuration",
  "configuration",
  "configuration",
  "configuration",
  "configuration",
  "configuration",
  "domain",
  "historical-data",
  "data-quality",
  "dataset-catalogue",
  "realtime-data",
  "multitimeframe",
  "market-replay",
  "instrument-registry",
  "broker-symbol-catalogue",
  "canonical-symbol-mapping",
  "instrument-specifications",
  "instrument-eligibility",
  "mose-core",
  "mose-scanner",
  "mose-attention",
]);
export function validateArtifact(raw: unknown): EvidenceArtifact {
  const a = object(data(raw, 1048576, 32, 50000));
  exact(a, [
    "id",
    "prompt",
    "owner",
    "ownerVersion",
    "sourceCommit",
    "nativeIdentity",
    "nativeFingerprint",
    "subject",
    "unit",
    "effectiveAt",
    "availableAt",
    "captured",
  ]);
  id(a.id);
  id(a.owner);
  id(a.ownerVersion);
  id(a.nativeIdentity);
  id(a.unit);
  demand(
    Number.isSafeInteger(a.prompt) &&
      Number(a.prompt) >= 1 &&
      Number(a.prompt) <= 27 &&
      a.owner === promptOwners[Number(a.prompt) - 1],
  );
  demand(typeof a.sourceCommit === "string" && /^[a-f0-9]{40}$/.test(a.sourceCommit));
  utc(a.effectiveAt);
  if (a.availableAt !== null) utc(a.availableAt);
  demand(Array.isArray(a.subject) && a.subject.length > 0 && a.subject.length <= 8);
  a.subject.forEach(id);
  demand(validateInsightRecord("Fact", a.nativeFingerprint).ok);
  const c = object(a.captured!);
  exact(c, [
    "family",
    "selected",
    "value",
    "valuePresence",
    "code",
    "commitment",
    "auditCorrelation",
    "valueSemantics",
  ]);
  demand(
    typeof c.family === "string" &&
      ["DIRECT", "DOMAIN", "COMMITMENT", "MOSE"].includes(c.family) &&
      typeof c.selected === "string" &&
      ["DIRECT", "SUCCESS", "FAILURE"].includes(c.selected) &&
      c.valueSemantics === "UNVERIFIED_NATIVE_CAPTURE",
  );
  for (const k of ["code", "commitment", "auditCorrelation"])
    demand(validateInsightRecord("Fact", c[k]).ok);
  demand(
    c.valuePresence === "PRESENT" ||
      (c.valuePresence === "UNDEFINED" && c.value === null && c.selected !== "FAILURE"),
  );
  demand((c.family === "DIRECT") === (c.selected === "DIRECT"));
  if (c.selected !== "FAILURE" || c.family === "DOMAIN") {
    demand(
      object(c.code!).kind === "UNKNOWN" &&
        object(c.commitment!).kind === "UNKNOWN" &&
        object(c.auditCorrelation!).kind === "UNKNOWN",
    );
  }
  if (c.selected === "FAILURE" && c.family === "DOMAIN") {
    demand(Array.isArray(c.value));
    for (const issue of array(c.value)) {
      const d = object(issue);
      id(d.code);
      demand(typeof d.message === "string");
    }
  }
  // Captured success never certifies semantic validity; negative fields must remain internally consistent.
  if (c.selected === "FAILURE" && (c.family === "COMMITMENT" || c.family === "MOSE")) {
    const v = object(c.value!);
    id(v.code);
    demand(v.commitment === "NONE" || v.commitment === "UNKNOWN");
    const nativeCode = object(c.code!),
      nativeCommitment = object(c.commitment!);
    demand(
      nativeCode.kind === "KNOWN" &&
        nativeCode.value === v.code &&
        nativeCommitment.kind === "KNOWN" &&
        nativeCommitment.value === v.commitment,
    );
    if (c.family === "MOSE") {
      id(v.auditCorrelationId);
      demand(
        object(c.auditCorrelation!).kind === "KNOWN" &&
          object(c.auditCorrelation!).value === v.auditCorrelationId,
      );
    }
  }
  const fingerprint = object(a.nativeFingerprint!);
  if (fingerprint.kind === "KNOWN")
    demand(
      typeof fingerprint.value === "string" && /^sha256:[a-f0-9]{64}$/.test(fingerprint.value),
    );
  return freeze(a) as unknown as EvidenceArtifact;
}
export function qualifyEvidence(
  a: EvidenceArtifact,
  request: ReportRequest,
  anchors: readonly EvidenceAnchor[],
): QualifiedObservation {
  const captureDigest = digest(a);
  let anchor: EvidenceAnchor | undefined;
  for (const raw of anchors) {
    const x = object(data(raw));
    exact(x, ["artifactId", "captureDigest", "sourceCommit", "owner", "reference"]);
    for (const k of Object.keys(x)) id(x[k]);
    if (x.artifactId === a.id) {
      demand(!anchor, "REPORTING:EVIDENCE_IDENTITY_CONFLICT");
      demand(
        x.captureDigest === captureDigest &&
          x.sourceCommit === a.sourceCommit &&
          x.owner === a.owner,
        "REPORTING:FINGERPRINT_MISMATCH",
      );
      anchor = x as unknown as EvidenceAnchor;
    }
  }
  const pointInTime = !anchor
    ? "UNESTABLISHED"
    : a.effectiveAt > request.asOf ||
        (a.availableAt !== null && a.availableAt > request.knowledgeCutoff)
      ? "OUTSIDE_CUTOFF"
      : a.availableAt === null
        ? "UNESTABLISHED"
        : "ESTABLISHED";
  return freeze({
    artifact: a,
    captureDigest,
    provenance: anchor ? "TRUSTED_CONTEXT_ANCHOR" : "UNESTABLISHED",
    qualification: "SOURCE_DECLARED_AVAILABILITY_NOT_INDEPENDENTLY_VERIFIED",
    anchorReference: anchor
      ? known(anchor.reference, [a.id])
      : unknownFact("REPORTING:SOURCE_UNAUTHENTICATED"),
    pointInTime,
  });
}
export function captureDigest(artifact: EvidenceArtifact) {
  return digest(validateArtifact(artifact));
}
export type { CapturedNative };
