import { O1, effectivePolicy } from "./policy.js";
import { operationBudget, inOperation } from "./validation.js";
import { observationSchema } from "@ate/mose-core";
import { assessmentSchema, scannerReceiptSchema } from "@ate/mose-attention";
import {
  checkpointSchema as scannerCheckpointSchema,
  fingerprint as scannerFingerprint,
} from "@ate/mose-scanner";
import { fingerprint as ownerFingerprint } from "@ate/configuration";
import { schemas, instrumentSchema } from "@ate/domain";
import { canonicalId } from "@ate/instrument-registry";
import {
  evidenceSchema,
  contextSchema,
  originSchema,
  type Evidence,
  type CapturedEvidence,
  type EvaluationInput,
  type CapturedContext,
  type Policy,
  type NativeCapture,
  type ProposalDetails,
  type DecisionProposal,
} from "./contracts.js";
import { canonical, fingerprint } from "./canonical.js";
import { subjectFingerprint } from "./identity.js";
import type { Budget } from "./validation.js";
import { demand, object, freeze } from "./validation.js";
import { checkEvidenceTime, milliseconds } from "./time-policy.js";
const captures = new WeakMap<object, NativeCapture>();
const proposals = new WeakMap<object, ProposalDetails>();
export function captureNativeResult(
  raw: unknown,
):
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; commitment: "NONE" | "UNKNOWN" } } {
  demand(
    raw !== null && (typeof raw === "object" || typeof raw === "function"),
    "NATIVE_RESULT_INVALID",
  );
  const r = raw as Record<string, unknown>;
  const kind = r.ok,
    value = r.value,
    error = r.error;
  if (kind === true) {
    demand(error === undefined, "NATIVE_RESULT_INVALID");
    return { ok: true, value };
  }
  demand(
    kind === false &&
      value === undefined &&
      error !== null &&
      (typeof error === "object" || typeof error === "function"),
    "NATIVE_RESULT_INVALID",
  );
  const e = error as Record<string, unknown>;
  const code = e.code,
    commitment = e.commitment;
  demand(
    typeof code === "string" &&
      code.length > 0 &&
      code.length <= 128 &&
      (commitment === "NONE" || commitment === "UNKNOWN"),
    "NATIVE_RESULT_INVALID",
  );
  return { ok: false, error: { code, commitment } };
}
export function nativePayload(e: CapturedEvidence): unknown {
  // P18 readRevision returns plain immutable data, not a Result; never synthesize an ACK.
  if (e.family === "BAR") return e.native;
  const r = captureNativeResult(e.native);
  demand(r.ok, "SOURCE_UNRESOLVED");
  const value = object(r.value);
  if (e.family === "OBSERVATION") {
    demand(
      value.kind === "OBSERVATIONS" &&
        value.currentAuthorityNotEstablishedByHistoricalQuery === true,
      "NATIVE_RESULT_INVALID",
    );
    const page = object(value.value);
    demand(Array.isArray(page.records), "NATIVE_RESULT_INVALID");
    const matches = page.records.filter((row: unknown) => object(row).observationId === e.recordId);
    demand(matches.length === 1, "EVIDENCE_MISSING");
    return matches[0];
  }
  if (e.family === "ATTENTION") {
    demand(value.historicalFactsNotCurrentAuthority === true, "NATIVE_RESULT_INVALID");
    const state = object(value.state);
    demand(Array.isArray(state.assessments), "NATIVE_RESULT_INVALID");
    const matches = state.assessments.filter((row: unknown) => object(row).id === e.recordId);
    demand(matches.length === 1, "EVIDENCE_MISSING");
    return matches[0];
  }
  return r.value;
}
export function metadata(e: CapturedEvidence): Evidence {
  const { family, native, ...ref } = e;
  void family;
  void native;
  return evidenceSchema.parse(ref);
}
/** Internal capability: raw DTOs and caller authentication booleans cannot carry native authority. */
export function attachCapture(
  context: CapturedContext,
  raw: NativeCapture,
  policy: Policy,
): CapturedContext {
  return inOperation(O1, () => {
    policy = effectivePolicy(policy);
    const outer = Object.getOwnPropertyDescriptors(object(raw));
    demand(
      ["evidence,origin,scanner", "evidence,instrumentBinding,origin,scanner"].includes(
        Object.keys(outer).sort().join(),
      ) && Object.values(outer).every((d) => "value" in d && d.enumerable),
      "INPUT_INVALID",
    );
    const meter = operationBudget(policy.limits);
    const origin = originSchema.parse(meter.capture(raw.origin));
    demand(Array.isArray(raw.evidence), "INPUT_INVALID");
    demand(raw.evidence.length <= policy.limits.maxEvidenceRefs, "BUDGET_EXHAUSTED");
    const evidence = raw.evidence.map((e: CapturedEvidence) => {
      const descriptors = Object.getOwnPropertyDescriptors(object(e));
      demand(
        Object.values(descriptors).every((d) => "value" in d && d.enumerable),
        "INPUT_INVALID",
      );
      const native: unknown = descriptors.native?.value;
      const body = Object.fromEntries(
        Object.entries(descriptors)
          .filter(([key]) => key !== "native")
          .map(([key, descriptor]) => [key, descriptor.value]),
      );
      return {
        ...(meter.capture(body) as Omit<CapturedEvidence, "native">),
        native: e.family === "BAR" ? meter.capture(native) : captureNativeResult(native),
      };
    });
    const scanner =
      raw.scanner === null
        ? null
        : {
            receipt: captureNativeResult(raw.scanner.receipt),
            checkpoint: captureNativeResult(raw.scanner.checkpoint),
          };
    const binding = outer.instrumentBinding;
    const instrumentBinding = binding === undefined ? undefined : meter.capture(binding.value);
    const capture = meter.capture({
      origin,
      evidence,
      scanner,
      ...(instrumentBinding === undefined ? {} : { instrumentBinding }),
    }) as NativeCapture;
    const result = contextSchema.parse(meter.capture(context));
    captures.set(result, freeze(capture));
    return freeze(result);
  });
}
export function contextDto(raw: CapturedContext): CapturedContext {
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(raw))) {
    demand("value" in d);
    out[k] = d.value;
  }
  return out as CapturedContext;
}
export function requireCapture(context: CapturedContext): NativeCapture {
  const capture = captures.get(context);
  demand(capture, "SOURCE_UNVERIFIED");
  return capture;
}
export function sealProposal(
  proposal: DecisionProposal,
  details: ProposalDetails,
): DecisionProposal {
  const result = { ...proposal };
  proposals.set(result, freeze(details));
  return freeze(result);
}
export function proposalDetails(proposal: DecisionProposal): ProposalDetails {
  const details = proposals.get(proposal);
  demand(details, "PROPOSAL_UNVERIFIED");
  return details;
}
export function admitEvidence(
  input: EvaluationInput,
  context: CapturedContext,
  capture: NativeCapture,
  policy: Policy,
  meter: Budget,
): readonly CapturedEvidence[] {
  demand(
    input.evidence.length <= policy.limits.maxEvidenceRefs &&
      capture.evidence.length <= policy.limits.maxEvidenceRefs,
    "BUDGET_EXHAUSTED",
  );
  demand(
    canonical(input.evidence) === canonical(context.nativeEvidenceRefs) &&
      canonical(input.evidence) === canonical(capture.evidence.map(metadata)),
    "IMMUTABLE_CONFLICT",
  );
  const identities = new Map<string, string>(),
    seen = new Set<string>();
  const result: CapturedEvidence[] = [];
  for (const supplied of capture.evidence) {
    // Native graph was already captured once by the materializer or checked journal decoder.
    // Recheck the small reference, retaining that operation's shared cumulative meter.
    meter.capture(metadata(supplied));
    const e = supplied;
    for (const value of [
      e.owner,
      e.ownerVersion,
      e.namespace,
      e.runtimeId,
      e.recordId,
      e.originalReceiptRef,
      ...e.qualityReferences,
    ])
      demand(
        value === null || Buffer.byteLength(value) <= policy.limits.maxIdentifierBytes,
        "BUDGET_EXHAUSTED",
      );
    demand(
      ["OBSERVATION", "ATTENTION", "BAR", "DECLARATION", "REVOCATION"].includes(e.family),
      "INPUT_INVALID",
    );
    demand(
      e.subjectFingerprint === subjectFingerprint(context.subject) &&
        e.sourceOriginFingerprint === context.subject.sourceOriginFingerprint &&
        e.policyFingerprint === input.policyFingerprint,
      "SOURCE_CONTEXT_MISMATCH",
    );
    checkEvidenceTime(e, input, policy);
    demand(e.finality === "FINAL" || e.finality === "NOT_APPLICABLE", "EVIDENCE_INCOMPLETE");
    demand(
      e.nativeResultStatus === (e.family === "BAR" ? "UNSUPPORTED" : "ACK"),
      "SOURCE_UNRESOLVED",
    );
    const identity = canonical([
      e.owner,
      e.ownerVersion,
      e.namespace,
      e.runtimeId,
      e.recordId,
      e.generation,
      e.sourceOriginFingerprint,
    ]);
    const bytes = canonical(e);
    demand(!identities.has(identity) || identities.get(identity) === bytes, "IMMUTABLE_CONFLICT");
    identities.set(identity, bytes);
    const native = nativePayload(e);
    let expected: string;
    if (e.family === "OBSERVATION") {
      demand(
        e.owner === "@ate/mose-core" && e.ownerVersion === "0.25.0-mose-core.1",
        "SOURCE_CONTEXT_MISMATCH",
      );
      const o = observationSchema.parse(native);
      demand(
        o.outcome === "ADMITTED" &&
          o.qualityDisposition === "PRESERVED" &&
          o.processingTime !== null &&
          o.funnelEvent !== null,
        "EVIDENCE_INCOMPLETE",
      );
      demand(
        o.observationId === e.recordId &&
          o.instrumentId === context.subject.canonicalInstrumentId &&
          o.sessionId === context.subject.researchSessionId &&
          o.universeSnapshot === context.subject.universeFingerprint,
        "SOURCE_CONTEXT_MISMATCH",
      );
      demand(
        o.funnelEvent.observationId === o.observationId &&
          o.funnelEvent.instrumentId === o.instrumentId &&
          o.plan.manifestFingerprint === capture.origin.manifestFingerprint,
        "SOURCE_CONTEXT_MISMATCH",
      );
      demand(
        e.eventAt === o.plan.eventAt &&
          milliseconds(o.processingTime) <= milliseconds(e.availableAt),
        "LOOKAHEAD",
      );
      demand(o.plan.evidenceClass === "VERIFIED_POINT_IN_TIME", "SOURCE_UNVERIFIED");
      demand(capture.scanner !== null && e.originalReceiptRef !== null, "RECEIPT_MISSING");
      const receiptResult = captureNativeResult(capture.scanner.receipt),
        checkpointResult = captureNativeResult(capture.scanner.checkpoint);
      demand(receiptResult.ok && checkpointResult.ok, "SOURCE_UNRESOLVED");
      const page = object(receiptResult.value);
      demand(Array.isArray(page.requests), "RECEIPT_MISSING");
      const receipts = page.requests.filter(
        (r: unknown) => object(object(r).trigger).id === e.originalReceiptRef,
      );
      demand(receipts.length === 1, "RECEIPT_MISSING");
      const checkpointPage = object(checkpointResult.value);
      demand(
        Array.isArray(checkpointPage.records) &&
          checkpointPage.records.length === 1 &&
          checkpointPage.scope === "HISTORICAL_CHECKPOINTS_NOT_CURRENT_AUTHORITY",
        "RECEIPT_MISSING",
      );
      const receipt = scannerReceiptSchema.parse(receipts[0]),
        checkpoint = scannerCheckpointSchema.parse(checkpointPage.records[0]);
      const { fingerprint: checkpointFingerprint, ...body } = checkpoint;
      demand(scannerFingerprint(body) === checkpointFingerprint, "SOURCE_FINGERPRINT_MISMATCH");
      demand(
        receipt.trigger.id === e.originalReceiptRef &&
          ["DUE", "COALESCED", "COMPLETED"].includes(receipt.disposition) &&
          receipt.workKey !== null,
        "RECEIPT_MISSING",
      );
      const work = checkpoint.state.work.find((w) => w.key === receipt.workKey);
      demand(
        work &&
          work.status === "COMPLETED" &&
          work.requests.includes(receipt.trigger.id) &&
          work.observationId === o.observationId &&
          work.ownerAck !== null,
        "RECEIPT_MISSING",
      );
      demand(
        work.subscription.sessionId === o.sessionId &&
          work.subscription.instrumentId === o.instrumentId &&
          work.subscription.universe === o.universeSnapshot,
        "SOURCE_CONTEXT_MISMATCH",
      );
      // The owner exposes observationId, not a newly invented full-record fingerprint or generation.
      demand(
        e.generation === 0 &&
          o.observationId ===
            ownerFingerprint({
              sessionId: o.sessionId,
              universe: o.universeSnapshot,
              key: o.plan.key,
            }),
        "SOURCE_FINGERPRINT_MISMATCH",
      );
      expected = o.observationId;
    } else if (e.family === "ATTENTION") {
      demand(
        e.owner === "@ate/mose-attention" && e.ownerVersion === "0.27.0-adaptive-surveillance.1",
        "SOURCE_CONTEXT_MISMATCH",
      );
      const a = assessmentSchema.parse(native);
      demand(
        a.id === e.recordId &&
          a.subject.instrumentId === context.subject.canonicalInstrumentId &&
          a.subject.sessionId === context.subject.researchSessionId &&
          a.subject.universe === context.subject.universeFingerprint &&
          e.eventAt === a.asOf &&
          milliseconds(a.evaluatedAt) <= milliseconds(e.availableAt) &&
          milliseconds(input.decisionCutoff) < milliseconds(a.expiresAt),
        "SOURCE_CONTEXT_MISMATCH",
      );
      const { id: assessmentId, ...assessmentBody } = a;
      demand(
        e.generation === 0 && assessmentId === ownerFingerprint(assessmentBody),
        "SOURCE_FINGERPRINT_MISMATCH",
      );
      expected = assessmentId;
    } else if (e.family === "BAR") {
      demand(
        e.owner === "@ate/multitimeframe" &&
          e.ownerVersion === "0.18.0-multitimeframe.1" &&
          /^[a-f0-9]{64}$/u.test(e.fingerprint),
        "SOURCE_CONTEXT_MISMATCH",
      );
      const b = object(native);
      demand(
        b.final === true &&
          (b.state === "FINALIZED" || b.state === "CORRECTED") &&
          b.coverage === "COMPLETE_COVERAGE" &&
          b.ordering === "VERIFIED" &&
          b.availability === "VERIFIED",
        "EVIDENCE_INCOMPLETE",
      );
      const w = object(b.window),
        stream = object(b.stream);
      demand(
        b.revisionId === e.recordId &&
          b.generation === e.generation &&
          w.calendarFingerprint === context.subject.calendarFingerprint &&
          typeof stream.instrumentId === "string",
        "SOURCE_CONTEXT_MISMATCH",
      );
      demand(
        typeof w.end === "string" &&
          milliseconds(w.end) <= milliseconds(input.decisionCutoff) &&
          typeof b.availableAt === "string" &&
          milliseconds(b.availableAt) <= milliseconds(input.knowledgeCutoff),
        "LOOKAHEAD",
      );
      demand(
        b.eventAt === e.eventAt &&
          b.availableAt === e.availableAt &&
          typeof b.timeframe === "string" &&
          context.subject.timeframes.includes(b.timeframe),
        "SOURCE_CONTEXT_MISMATCH",
      );
      if (
        capture.instrumentBinding !== undefined ||
        stream.instrumentId !== context.subject.canonicalInstrumentId
      )
        validateInstrumentBinding(capture, input, context, stream.instrumentId);
      for (const field of ["open", "high", "low", "close"]) schemas.decimal.parse(b[field]);
      demand(
        typeof b.count === "number" && Number.isSafeInteger(b.count) && b.count > 0,
        "INPUT_INVALID",
      );
      demand(
        (b.state === "CORRECTED") === (e.correctionOf !== null) &&
          (!(b.state === "CORRECTED") || b.parentRevisionId === e.correctionOf),
        "CORRECTION_LINEAGE",
      );
      demand(b.researchQualified === false && b.tradingAuthorized === false, "INPUT_INVALID");
      demand(b.suppressedEvidence === 0 && Array.isArray(b.quality), "EVIDENCE_INCOMPLETE");
      for (const name of [
        "receivedAt",
        "processedAt",
        "computedAt",
        "committedAt",
        "publishedAt",
        "finalityAt",
      ]) {
        if (b[name] !== undefined)
          demand(
            typeof b[name] === "string" &&
              milliseconds(b[name]) <= milliseconds(input.knowledgeCutoff),
            "LOOKAHEAD",
          );
      }
      demand(typeof b.contentFingerprint === "string", "INPUT_INVALID");
      expected = b.contentFingerprint;
    } else {
      const n = object(native);
      demand(
        e.owner === "@ate/mose-opportunities" &&
          e.ownerVersion === "0.28.0-opportunity-state.1" &&
          n.subjectFingerprint === e.subjectFingerprint &&
          n.policyFingerprint === e.policyFingerprint &&
          n.sourceOriginFingerprint === e.sourceOriginFingerprint,
        "SOURCE_CONTEXT_MISMATCH",
      );
      demand(e.family !== "REVOCATION" || n.revoked === true, "EVIDENCE_INCOMPLETE");
      expected = fingerprint("ate.opportunity-native/1", native);
    }
    demand(e.fingerprint === expected, "SOURCE_FINGERPRINT_MISMATCH");
    const ref = fingerprint("ate.opportunity-evidence/1", e);
    if (!seen.has(ref)) {
      seen.add(ref);
      result.push(e);
    }
  }
  return result.sort((a, b) => {
    const x = canonical([a.availableAt, a.eventAt, a.namespace, a.recordId, a.fingerprint]),
      y = canonical([b.availableAt, b.eventAt, b.namespace, b.recordId, b.fingerprint]);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/** Supplied research association only. T01 source authentication is the reviewed host's duty. */
function validateInstrumentBinding(
  capture: NativeCapture,
  input: EvaluationInput,
  context: CapturedContext,
  streamId: unknown,
) {
  demand(
    capture.instrumentBinding !== undefined && capture.instrumentBinding !== null,
    "INSTRUMENT_BINDING_MISSING",
  );
  const binding = object(capture.instrumentBinding);
  demand(
    Object.keys(binding).sort().join() ===
      "association,availableAt,legacyInstrument,owner,ownerVersion,registrySnapshot",
    "INPUT_INVALID",
  );
  demand(
    binding.owner === "@ate/instrument-registry" &&
      binding.ownerVersion === "0.20.0-instrument-registry.1",
    "SOURCE_CONTEXT_MISMATCH",
  );
  demand(
    typeof binding.availableAt === "string" &&
      milliseconds(binding.availableAt) <= milliseconds(input.knowledgeCutoff),
    "LOOKAHEAD",
  );
  const legacy = instrumentSchema.parse(binding.legacyInstrument);
  const association = captureNativeResult(binding.association),
    snapshotResult = captureNativeResult(binding.registrySnapshot);
  demand(association.ok && snapshotResult.ok, "SOURCE_UNRESOLVED");
  const associationValue = object(association.value),
    ref = object(associationValue.reference),
    snapshot = object(snapshotResult.value);
  canonicalId.parse(context.subject.canonicalInstrumentId);
  demand(
    associationValue.legacyInstrumentId === legacy.instrumentId &&
      legacy.instrumentId === streamId &&
      ref.owner === "MARKET_DATA" &&
      ref.ownerReference === legacy.instrumentId &&
      ref.ownerFingerprint === ownerFingerprint(legacy),
    "SOURCE_CONTEXT_MISMATCH",
  );
  demand(
    ref.schemaVersion === 1 &&
      ref.instrumentId === context.subject.canonicalInstrumentId &&
      ref.registrySnapshot === context.subject.registryFingerprint &&
      ref.registrySnapshot === snapshot.fingerprint &&
      ref.registryId === snapshot.registryId &&
      snapshot.generation === context.subject.registryGeneration,
    "SOURCE_CONTEXT_MISMATCH",
  );
  const { fingerprint: refFingerprint, ...referenceBody } = ref;
  demand(refFingerprint === ownerFingerprint(referenceBody), "SOURCE_FINGERPRINT_MISMATCH");
  const { fingerprint: snapshotFingerprint, ...snapshotBody } = snapshot;
  demand(snapshotFingerprint === ownerFingerprint(snapshotBody), "SOURCE_FINGERPRINT_MISMATCH");
  demand(Array.isArray(snapshot.revisions), "SOURCE_CONTEXT_MISMATCH");
  const selected = snapshot.revisions.filter((r: unknown) => {
    const revision = object(r);
    return revision.instrumentId === ref.instrumentId && revision.revisionId === ref.revisionId;
  });
  demand(selected.length === 1, "SOURCE_CONTEXT_MISMATCH");
  const revision = object(selected[0]);
  demand(
    typeof revision.recordedAt === "string" &&
      milliseconds(revision.recordedAt) <= milliseconds(input.knowledgeCutoff),
    "LOOKAHEAD",
  );
  demand(revision.fingerprint === ref.revisionId, "SOURCE_FINGERPRINT_MISMATCH");
}

/** Own-package recovery path: the enclosing journal/proposal has already been bounded and frozen. */
export function rehydrateCapture(
  context: CapturedContext,
  capture: NativeCapture,
  policy: Policy,
): CapturedContext {
  demand(Object.isFrozen(context) && Object.isFrozen(capture), "SOURCE_UNVERIFIED");
  const meter = operationBudget(policy.limits);
  originSchema.parse(meter.capture(capture.origin));
  const copy = contextSchema.parse(meter.capture(context));
  captures.set(copy, capture);
  return freeze(copy);
}
