import { AsyncLocalStorage } from "node:async_hooks";
import { failure, success, type Result, type Limits } from "./contracts.js";
export class OpportunityError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function demand(value: unknown, code = "INPUT_INVALID"): asserts value {
  if (!value) throw new OpportunityError(code);
}
export function guarded<T>(fn: () => T): Result<T> {
  try {
    return success(fn());
  } catch (e) {
    return failure(e instanceof OpportunityError ? e.code : "INPUT_INVALID");
  }
}
type CapturedNode = Readonly<{
  value: unknown;
  bytes: number;
  height: number;
  cost: number;
  originalFrozen: boolean;
}>;
export class Budget {
  nodes = 0;
  private nodeCeiling: number;
  private depthCeiling: number;
  private requestCeiling: number;
  private readonly validated = new WeakMap<object, CapturedNode>();
  constructor(readonly limits: Readonly<Limits>) {
    this.nodeCeiling = limits.maxOperationNodes;
    this.depthCeiling = limits.maxDepth;
    this.requestCeiling = limits.maxRequestBytes;
  }
  tighten(limits: Readonly<Limits>) {
    this.nodeCeiling = Math.min(this.nodeCeiling, limits.maxOperationNodes);
    this.depthCeiling = Math.min(this.depthCeiling, limits.maxDepth);
    this.requestCeiling = Math.min(this.requestCeiling, limits.maxRequestBytes);
    demand(this.nodes <= this.nodeCeiling, "BUDGET_EXHAUSTED");
  }
  /** Reuse only a graph already fully charged and frozen by this exact operation meter. */
  reuseCaptured(raw: unknown, maxBytes: number): unknown {
    const known = raw !== null && typeof raw === "object" ? this.validated.get(raw) : undefined;
    if (!known) return this.capture(raw, maxBytes);
    demand(
      ++this.nodes <= this.nodeCeiling &&
        known.height <= this.depthCeiling &&
        known.bytes <= maxBytes,
      "BUDGET_EXHAUSTED",
    );
    return known.value;
  }
  capture(raw: unknown, maxBytes = this.requestCeiling): unknown {
    const active = new Set<object>();
    const visit = (v: unknown, depth: number): CapturedNode => {
      demand(++this.nodes <= this.nodeCeiling && depth <= this.depthCeiling, "BUDGET_EXHAUSTED");
      if (v === null || typeof v === "boolean" || typeof v === "string" || typeof v === "number") {
        if (typeof v === "number") demand(Number.isFinite(v));
        const bytes = Buffer.byteLength(JSON.stringify(v));
        demand(bytes <= maxBytes, "BUDGET_EXHAUSTED");
        return { value: v, bytes, height: 1, cost: 1, originalFrozen: true };
      }
      demand(typeof v === "object" && !active.has(v));
      const known = this.validated.get(v);
      if (known) {
        this.nodes += known.cost - 1;
        demand(
          this.nodes <= this.nodeCeiling &&
            depth + known.height - 1 <= this.depthCeiling &&
            known.bytes <= maxBytes,
          "BUDGET_EXHAUSTED",
        );
        return known;
      }
      active.add(v);
      const descriptors = Object.getOwnPropertyDescriptors(v);
      demand(Object.getOwnPropertySymbols(v).length === 0);
      let bytes = 2,
        height = 1,
        cost = 1;
      let deeplyFrozen = Object.isFrozen(v);
      let copy: object;
      const child = (value: unknown) => {
        const result = visit(value, depth + 1);
        height = Math.max(height, 1 + result.height);
        cost += result.cost;
        deeplyFrozen = deeplyFrozen && result.originalFrozen;
        return result;
      };
      if (Array.isArray(v)) {
        demand(
          Object.keys(descriptors).every((k) => k === "length" || /^(0|[1-9][0-9]*)$/u.test(k)),
        );
        demand(v.length <= this.nodeCeiling, "BUDGET_EXHAUSTED");
        const result: unknown[] = [];
        for (let i = 0; i < v.length; i++) {
          const d = descriptors[String(i)];
          demand(d && "value" in d);
          const next = child(d.value);
          result.push(next.value);
          bytes += next.bytes + (i === 0 ? 0 : 1);
        }
        copy = result;
      } else {
        demand(Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
        const result: Record<string, unknown> = {};
        for (const [i, key] of Object.keys(descriptors).sort().entries()) {
          demand(
            !["__proto__", "constructor", "prototype"].includes(key) &&
              Buffer.byteLength(key) <= 128 &&
              !Array.from(key).some((c) => c.charCodeAt(0) < 32),
          );
          const d = descriptors[key];
          demand(d && "value" in d && d.enumerable);
          const next = child(d.value);
          result[key] = next.value;
          bytes += Buffer.byteLength(JSON.stringify(key)) + 1 + next.bytes + (i === 0 ? 0 : 1);
        }
        copy = result;
      }
      demand(bytes <= maxBytes, "BUDGET_EXHAUSTED");
      active.delete(v);
      Object.freeze(copy);
      const captured: CapturedNode = { value: copy, bytes, height, cost, originalFrozen: true };
      this.validated.set(copy, captured);
      // Only recursively immutable input is reusable. Mutable or shallow-frozen aliases are re-read.
      if (deeplyFrozen) this.validated.set(v, captured);
      return { ...captured, originalFrozen: deeplyFrozen };
    };
    return visit(raw, 1).value;
  }
}
export function object(v: unknown): Record<string, unknown> {
  demand(v !== null && typeof v === "object" && !Array.isArray(v));
  return v as Record<string, unknown>;
}
export function freeze<T>(v: T): Readonly<T> {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) freeze(x);
  }
  return v;
}

export function validateOpportunityInput(
  raw: unknown,
  limits: Readonly<Limits>,
  schema: { parse(value: unknown): unknown },
) {
  return guarded(() => freeze(schema.parse(new Budget(limits).capture(raw))));
}

const operation = new AsyncLocalStorage<Budget>();
export function operationBudget(limits: Readonly<Limits>): Budget {
  const current = operation.getStore();
  if (current) {
    current.tighten(limits);
    return current;
  }
  return new Budget(limits);
}
export function inOperation<T>(limits: Readonly<Limits>, work: () => T): T {
  const current = operation.getStore();
  if (current) {
    current.tighten(limits);
    return work();
  }
  return operation.run(new Budget(limits), work);
}
