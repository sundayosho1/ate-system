import type { JournalRecord, Policy, OpportunitySnapshot } from "./contracts.js";
import { checkedRecord, makeJournalRecord } from "./journal.js";
import { canonical } from "./canonical.js";
import { demand, freeze, operationBudget, inOperation } from "./validation.js";
import { sealProposal } from "./evidence.js";

export function recoverJournal(
  raw: readonly unknown[],
  root: string,
  policy: Policy,
): readonly JournalRecord[] {
  return inOperation(policy.limits, () => {
    demand(
      raw.length <= policy.limits.maxJournalRecords && raw.length <= policy.limits.maxReplayRecords,
      "BUDGET_EXHAUSTED",
    );
    const meter = operationBudget(policy.limits),
      records: JournalRecord[] = [];
    const latest = new Map<string, OpportunitySnapshot>();
    const lastEvent = new Map<string, string>();
    const commands = new Set<string>();
    let bytes = 0;
    for (const value of raw) {
      const record = checkedRecord(value, policy, meter);
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
    return freeze(records);
  });
}
