import { z } from "zod";
import {
  stateSchema,
  id,
  digest,
  type JournalRecord,
  type DecisionProposal,
  type Policy,
  type CommitAck,
  type StorageMode,
  type ProposalDetails,
} from "./contracts.js";
import { canonical, fingerprint } from "./canonical.js";
import { operationBudget, demand, object, freeze } from "./validation.js";
import { evaluateOpportunity } from "./transitions.js";
import { expiryAt } from "./time-policy.js";
import { commandFingerprint } from "./identity.js";
import { createOpportunityPolicy } from "./policy.js";
import { rehydrateCapture, proposalDetails } from "./evidence.js";
export function proposalDto(proposal: DecisionProposal): DecisionProposal {
  return Object.fromEntries(Object.entries(proposal)) as DecisionProposal;
}
export function recordFingerprint(record: JournalRecord): string {
  const { fingerprint: ignored, ...body } = record;
  const { fingerprint: headIgnored, ...head } = record.snapshot.head;
  void ignored;
  void headIgnored;
  return fingerprint("ate.opportunity-journal/1", {
    ...body,
    snapshot: { ...record.snapshot, head },
  });
}
export function makeJournalRecord(
  root: string,
  history: readonly JournalRecord[],
  proposal: DecisionProposal,
): JournalRecord {
  const details = proposalDetails(proposal),
    old = details.context.historicalState;
  const generation = history.length + 1;
  const record: JournalRecord = {
    schema: "ate.opportunity-journal/1",
    root,
    journalGeneration: generation,
    previous: history.at(-1)?.fingerprint ?? null,
    operationId: details.input.commandId,
    commandFingerprint: commandFingerprint(
      details.input.actorAuthorityRef,
      proposal.key,
      details.input.commandId,
      details,
    ),
    proposal: proposalDto(proposal),
    details,
    snapshot: {
      key: proposal.key,
      subject: details.context.subject,
      state: proposal.to,
      head: {
        journalGeneration: generation,
        eventSequence: (old?.head.eventSequence ?? 0) + 1,
        stateGeneration:
          (old?.head.stateGeneration ?? 0) + (proposal.disposition === "NO_ACTION" ? 0 : 1),
        fingerprint: "sha256:" + "0".repeat(64),
      },
      birthCutoff: old?.birthCutoff ?? details.input.decisionCutoff,
      lastDecisionCutoff: details.input.decisionCutoff,
      expiresAt: old?.expiresAt ?? expiryAt(details.input.decisionCutoff, details.policy),
      governingPolicyFingerprint: details.input.policyFingerprint,
      unresolvedOperationRef: null,
    },
    fingerprint: "sha256:" + "0".repeat(64),
  };
  const fp = recordFingerprint(record);
  return freeze({
    ...record,
    fingerprint: fp,
    snapshot: { ...record.snapshot, head: { ...record.snapshot.head, fingerprint: fp } },
  });
}
export function checkedRecord(
  raw: unknown,
  policy: Policy,
  meter = operationBudget(policy.limits),
): JournalRecord {
  const data = object(meter.reuseCaptured(raw, policy.limits.maxRecordBytes));
  demand(
    policy.limits.maxSnapshotsPerRecord >= 1 &&
      Buffer.byteLength(canonical(data.snapshot)) <= policy.limits.maxSnapshotBytesWithinRecord,
    "BUDGET_EXHAUSTED",
  );
  demand(
    Object.keys(data).sort().join() ===
      [
        "schema",
        "root",
        "journalGeneration",
        "previous",
        "operationId",
        "commandFingerprint",
        "proposal",
        "details",
        "snapshot",
        "fingerprint",
      ]
        .sort()
        .join(),
    "JOURNAL_CORRUPT",
  );
  demand(
    data.schema === "ate.opportunity-journal/1" &&
      typeof data.root === "string" &&
      data.root.length <= 4096,
    "JOURNAL_CORRUPT",
  );
  z.number().int().min(1).max(policy.limits.maxJournalRecords).parse(data.journalGeneration);
  const info = object(data.details);
  const original = createOpportunityPolicy(info.policy);
  demand(original.ok && canonical(original.value) === canonical(info.policy), "JOURNAL_CORRUPT");
  meter.tighten(original.value.limits);
  const details = info as ProposalDetails;
  const context = rehydrateCapture(details.context, details.capture, original.value);
  const reevaluated = evaluateOpportunity(details.input, context, original.value);
  demand(
    reevaluated.ok && canonical(proposalDto(reevaluated.value)) === canonical(data.proposal),
    !reevaluated.ok && reevaluated.error.code === "OPP:BUDGET_EXHAUSTED"
      ? "BUDGET_EXHAUSTED"
      : "JOURNAL_CORRUPT",
  );
  const snapshot = stateSchema.parse(data.snapshot);
  const record: JournalRecord = {
    schema: "ate.opportunity-journal/1",
    root: data.root,
    journalGeneration: Number(data.journalGeneration),
    previous: digest.nullable().parse(data.previous),
    operationId: id.parse(data.operationId),
    commandFingerprint: digest.parse(data.commandFingerprint),
    proposal: proposalDto(reevaluated.value),
    details: proposalDetails(reevaluated.value),
    snapshot,
    fingerprint: digest.parse(data.fingerprint),
  };
  demand(
    recordFingerprint(record) === record.fingerprint &&
      snapshot.head.fingerprint === record.fingerprint,
    "JOURNAL_CORRUPT",
  );
  return freeze(record);
}
export function acknowledgement(record: JournalRecord, storageMode: StorageMode): CommitAck {
  return freeze({
    root: record.root,
    key: record.snapshot.key,
    journalGeneration: record.journalGeneration,
    eventSequence: record.snapshot.head.eventSequence,
    fingerprint: record.fingerprint,
    previous: record.previous,
    operationId: record.operationId,
    storageMode,
    durabilityQualification:
      storageMode === "MEMORY_VOLATILE"
        ? "VOLATILE_PROCESS_LOCAL"
        : "TRUSTED_ROOT_SINGLE_WRITER_WINDOWS_POWER_LOSS_UNQUALIFIED",
  });
}
export function exactAcknowledgement(
  raw: unknown,
  record: JournalRecord,
  mode: StorageMode,
): CommitAck {
  demand(canonical(raw) === canonical(acknowledgement(record, mode)), "ACK_MISMATCH");
  return acknowledgement(record, mode);
}
