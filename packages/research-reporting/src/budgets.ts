import type { ReportingPolicy } from "./contracts.js";
import { checkedPolicy } from "./policy.js";
import { demand } from "./validation.js";
export class ReadBudgetLedger {
  readonly policy: ReportingPolicy;
  private calls = 0;
  private clockReads = 0;
  private nativeBytes = 0;
  constructor(policy: ReportingPolicy) {
    this.policy = checkedPolicy(policy);
  }
  clock() {
    demand(
      this.clockReads < this.policy.maxClockReads && this.calls < this.policy.maxCalls,
      "REPORTING:BUDGET_EXHAUSTED",
    );
    this.clockReads++;
    this.calls++;
  }
  evidence(bytes: number) {
    demand(
      Number.isSafeInteger(bytes) &&
        bytes >= 0 &&
        this.nativeBytes + bytes <= this.policy.maxNativeBytes,
      "REPORTING:BUDGET_EXHAUSTED",
    );
    this.nativeBytes += bytes;
  }
  snapshot() {
    return Object.freeze({
      calls: this.calls,
      clockReads: this.clockReads,
      nativeBytes: this.nativeBytes,
    });
  }
}
