import { W1, checkedPolicy } from "./policy.js";
import { snapshot } from "./serialization.js";
import type { WorkspacePolicy, JsonValue } from "./contracts.js";
import { demand } from "./validation.js";
import { cost } from "./serialization.js";
export class Budget {
  private nodes = 0;
  private inputBytes = 0;
  private calls = 0;
  private clockReads = 0;
  constructor(public policy: WorkspacePolicy) {}
  visit(depth: number) {
    demand(
      this.nodes < this.policy.maxNodes && depth <= this.policy.maxDepth,
      "WORKSPACE:BUDGET_EXHAUSTED",
    );
    this.nodes++;
  }
  bytes(n: number) {
    demand(
      Number.isSafeInteger(n) && n >= 0 && this.inputBytes + n <= this.policy.maxInputBytes,
      "WORKSPACE:BUDGET_EXHAUSTED",
    );
    this.inputBytes += n;
  }
  reserve(raw: JsonValue, multiplier: number) {
    demand(Number.isSafeInteger(multiplier) && multiplier >= 1, "WORKSPACE:BUDGET_EXHAUSTED");
    const bound = cost(raw) * multiplier;
    demand(
      Number.isSafeInteger(bound) &&
        this.nodes + bound <= this.policy.maxNodes &&
        this.calls < this.policy.maxCalls,
      "WORKSPACE:BUDGET_EXHAUSTED",
    );
    this.bytes(Buffer.byteLength(JSON.stringify(raw)) * multiplier);
    this.nodes += bound;
    this.calls++;
  }
  charge(nodes: number, bytes: number) {
    demand(
      Number.isSafeInteger(nodes) && nodes >= 0 && this.nodes + nodes <= this.policy.maxNodes,
      "WORKSPACE:BUDGET_EXHAUSTED",
    );
    this.bytes(bytes);
    this.nodes += nodes;
  }
  remainingNodes() {
    return Math.max(0, this.policy.maxNodes - this.nodes);
  }
  reserveBound(nodes: number, bytes: number) {
    demand(this.calls < this.policy.maxCalls, "WORKSPACE:BUDGET_EXHAUSTED");
    this.charge(nodes, bytes);
    this.calls++;
  }
  clock() {
    demand(
      this.clockReads < this.policy.maxClockReads && this.calls < this.policy.maxCalls,
      "WORKSPACE:BUDGET_EXHAUSTED",
    );
    this.clockReads++;
    this.calls++;
  }
  tighten(p: WorkspacePolicy) {
    demand(
      this.nodes <= p.maxNodes &&
        this.inputBytes <= p.maxInputBytes &&
        this.calls <= p.maxCalls &&
        this.clockReads <= p.maxClockReads,
      "WORKSPACE:BUDGET_EXHAUSTED",
    );
    this.policy = p;
  }
  usage() {
    return {
      nodes: this.nodes,
      bytes: this.inputBytes,
      calls: this.calls,
      clockReads: this.clockReads,
    };
  }
}

export function begin(policy: WorkspacePolicy = W1) {
  const work = new Budget(W1),
    raw = snapshot(policy, work);
  work.reserve(raw, 4);
  const p = checkedPolicy(raw);
  work.tighten(p);
  return work;
}
