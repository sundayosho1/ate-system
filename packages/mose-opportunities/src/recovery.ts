import type {
  JournalRecord,
  Policy,
  OpportunitySnapshot,
  TrustedHostAuthorization,
} from "./contracts.js";
import { checkedRecord, makeJournalRecord } from "./journal.js";
import { canonical } from "./canonical.js";
import { demand, freeze, operationBudget, inOperation, object } from "./validation.js";
import { sealProposal, captureNativeResult } from "./evidence.js";

const legacyRecords = new WeakSet<object>();
export const isVerifiedLegacyRecord = (record: JournalRecord) => legacyRecords.has(record);
const legacyImplementation = "6103ca13670d6a75f85b03c24bec567f86a5e467";
export function recoverJournal(
  raw: readonly unknown[],
  root: string,
  policy: Policy,
  host: TrustedHostAuthorization | null = null,
  maximumLegacyGeneration = raw.length,
): readonly JournalRecord[] {
  return inOperation(policy.limits, () => {
    demand(
      raw.length <= policy.limits.maxJournalRecords && raw.length <= policy.limits.maxReplayRecords,
      "BUDGET_EXHAUSTED",
    );
    const meter = operationBudget(policy.limits),
      records: JournalRecord[] = [];
    let legacyGeneration = 0,
      legacyFingerprint: string | null = null;
    if (host?.verifyLegacyJournalPrefix !== undefined) {
      demand(host.reviewReference.length > 0, "AUTHORITY_UNESTABLISHED");
      const answer = captureNativeResult(
        host.verifyLegacyJournalPrefix({ root, sourceImplementation: legacyImplementation }),
      );
      demand(answer.ok, "LEGACY_AUTHORITY_UNESTABLISHED");
      const anchor = object(meter.capture(answer.value));
      demand(
        Object.keys(anchor).sort().join() ===
          [
            "root",
            "sourceImplementation",
            "journalGeneration",
            "journalFingerprint",
            "issuerRef",
            "approvalReference",
            "acknowledgementProofRef",
          ]
            .sort()
            .join(),
        "LEGACY_AUTHORITY_UNESTABLISHED",
      );
      demand(
        anchor.root === root &&
          anchor.sourceImplementation === legacyImplementation &&
          typeof anchor.journalGeneration === "number" &&
          Number.isSafeInteger(anchor.journalGeneration) &&
          anchor.journalGeneration >= 1 &&
          anchor.journalGeneration <= raw.length &&
          anchor.journalGeneration <= maximumLegacyGeneration &&
          typeof anchor.journalFingerprint === "string" &&
          /^sha256:[a-f0-9]{64}$/u.test(anchor.journalFingerprint),
        "LEGACY_AUTHORITY_UNESTABLISHED",
      );
      for (const field of ["issuerRef", "approvalReference", "acknowledgementProofRef"]) {
        const value = anchor[field];
        demand(
          typeof value === "string" &&
            value.length > 0 &&
            Buffer.byteLength(value) <= policy.limits.maxIdentifierBytes,
          "LEGACY_AUTHORITY_UNESTABLISHED",
        );
      }
      legacyGeneration = anchor.journalGeneration;
      legacyFingerprint = anchor.journalFingerprint;
    }
    const latest = new Map<string, OpportunitySnapshot>();
    const lastEvent = new Map<string, string>();
    const commands = new Set<string>();
    let bytes = 0;
    for (const value of raw) {
      const record = checkedRecord(value, policy, meter, records.length < legacyGeneration);
      bytes += Buffer.byteLength(canonical(record));
      demand(bytes <= policy.limits.maxRetainedJournalBytes, "BUDGET_EXHAUSTED");
      demand(
        record.root === root &&
          record.journalGeneration === records.length + 1 &&
          record.previous === (records.at(-1)?.fingerprint ?? null),
        "JOURNAL_CORRUPT",
      );
      const prior = latest.get(record.snapshot.key) ?? null;
      demand(
        record.details.context.previousEventFingerprint ===
          (lastEvent.get(record.snapshot.key) ?? null),
        "JOURNAL_CORRUPT",
      );
      demand(
        canonical(prior) === canonical(record.details.context.historicalState),
        "JOURNAL_CORRUPT",
      );
      const command = canonical([
        record.snapshot.key,
        record.details.input.actorAuthorityRef,
        record.operationId,
      ]);
      demand(!commands.has(command), "JOURNAL_CORRUPT");
      commands.add(command);
      if (!prior) {
        const parent = record.snapshot.subject.predecessorGenerationKey;
        if (parent !== null) {
          const p = latest.get(parent);
          demand(
            p &&
              (p.state === "INVALIDATED" || p.state === "EXPIRED") &&
              p.subject.lifecycleGeneration + 1 === record.snapshot.subject.lifecycleGeneration &&
              p.subject.canonicalInstrumentId === record.snapshot.subject.canonicalInstrumentId &&
              p.subject.researchSessionId === record.snapshot.subject.researchSessionId,
            "GENERATION_INVALID",
          );
        } else
          demand(
            ![...latest.values()].some(
              (s) =>
                s.subject.watchDeclarationId === record.snapshot.subject.watchDeclarationId &&
                s.subject.canonicalInstrumentId === record.snapshot.subject.canonicalInstrumentId &&
                s.subject.researchSessionId === record.snapshot.subject.researchSessionId,
            ),
            "GENERATION_INVALID",
          );
      }
      const p = sealProposal(record.proposal, record.details);
      const expected = makeJournalRecord(root, records, p);
      demand(canonical(record) === canonical(expected), "JOURNAL_CORRUPT");
      records.push(record);
      latest.set(record.snapshot.key, record.snapshot);
      lastEvent.set(record.snapshot.key, record.proposal.eventFingerprint);
      demand(
        [...latest.values()].filter((s) => s.state !== "INVALIDATED" && s.state !== "EXPIRED")
          .length <= policy.limits.maxLiveKeys,
        "CAPACITY_EXHAUSTED",
      );
    }
    if (legacyGeneration > 0) {
      demand(
        records[legacyGeneration - 1]?.fingerprint === legacyFingerprint,
        "LEGACY_ACK_MISMATCH",
      );
      for (const record of records.slice(0, legacyGeneration)) legacyRecords.add(record);
    }
    return freeze(records);
  });
}
