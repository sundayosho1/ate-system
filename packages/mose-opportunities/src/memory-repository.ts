import { inOperation, demand } from "./validation.js";
import {
  success,
  failure,
  type OpportunityRepository,
  type JournalRecord,
  type Policy,
} from "./contracts.js";
import { acknowledgement } from "./journal.js";
import { recoverJournal } from "./recovery.js";
import { defaultOpportunityPolicy, effectivePolicy } from "./policy.js";

export class MemoryOpportunityRepository implements OpportunityRepository {
  readonly storageMode = "MEMORY_VOLATILE" as const;
  private records: readonly JournalRecord[] = [];
  readonly policy: Policy;
  constructor(
    readonly root: string,
    policy: Policy = defaultOpportunityPolicy,
  ) {
    demand(
      typeof root === "string" &&
        root.length > 0 &&
        Buffer.byteLength(root) <= 4096 &&
        !Array.from(root).some((c) => c.charCodeAt(0) < 32),
      "INPUT_INVALID",
    );
    this.policy = effectivePolicy(policy);
  }
  async load() {
    return inOperation(this.policy.limits, async () => {
      await Promise.resolve();
      // Every retained record is own-package validated and deeply frozen at append.
      // Returning that immutable graph allocates no duplicate native working tree.
      return success(this.records);
    });
  }
  async compareAppend(record: JournalRecord) {
    return inOperation(this.policy.limits, async () => {
      await Promise.resolve();
      try {
        const checked = recoverJournal([...this.records, record], this.root, this.policy);
        this.records = checked;
        return success(acknowledgement(checked.at(-1)!, this.storageMode));
      } catch {
        return failure("REPOSITORY_REJECTED");
      }
    });
  }
}
