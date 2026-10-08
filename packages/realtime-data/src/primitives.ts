import { createHash } from "node:crypto";
import { types } from "node:util";
import { stableMarketDataStringify } from "@ate/domain";
import type { Clock } from "@ate/time";
import type { AcceptedObservation, RealtimeErrorCode, RealtimeResult } from "./types.js";

export const hash = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const fingerprint = (value: unknown): string => hash(stableMarketDataStringify(value));
export const immutable = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) immutable(nested);
    Object.freeze(value);
  }
  return value;
};
export const failure = <T = never>(
  clock: Clock,
  code: RealtimeErrorCode,
  scope: string,
): RealtimeResult<T> => ({
  ok: false,
  error: { code, scope, timestamp: clock.now(), message: code.toLowerCase().replaceAll("_", " ") },
});
export const safeId = (value: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value);

// Reject accessors, custom prototypes, cycles and secret-shaped metadata before cloning/normalizing.
// A byte budget is consumed during traversal, not after JSON.stringify allocates an unbounded string.
export const boundedInput = (
  value: unknown,
  maxBytes: number,
  maxDepth: number,
  maxString: number,
): unknown => {
  let bytes = 0;
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > maxBytes || depth > maxDepth) throw new Error("input bounds");
    if (item === null || typeof item === "boolean" || typeof item === "number") {
      if (typeof item === "number" && !Number.isFinite(item)) throw new Error("input number");
      bytes += 16;
      if (bytes > maxBytes) throw new Error("input size");
      return item;
    }
    if (typeof item === "string") {
      if (
        item.length > maxString ||
        /(?:https?:\/\/\S*[?@]|Bearer\s|gh[pousr]_[A-Za-z0-9_]{20,})/iu.test(item)
      )
        throw new Error("unsafe string");
      bytes += Buffer.byteLength(item) + 2;
      if (bytes > maxBytes) throw new Error("input size");
      return item;
    }
    if (typeof item !== "object" || seen.has(item) || types.isProxy(item))
      throw new Error("input shape");
    const proto: unknown = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && proto !== Object.prototype && proto !== null)
      throw new Error("input prototype");
    seen.add(item);
    if (Array.isArray(item) && item.length > maxBytes / 4) throw new Error("input fields");
    let fields = 0;
    const out: Record<string, unknown> = {};
    const arr: unknown[] = [];
    for (const key in item) {
      if (!Object.hasOwn(item, key)) continue;
      if (++fields > maxBytes / 4) throw new Error("input fields");
      const d = Object.getOwnPropertyDescriptor(item, key)!;
      if (
        d.get ||
        d.set ||
        key.length > 128 ||
        /__proto__|constructor|prototype|password|secret|token|credential|api.?key/iu.test(key)
      )
        throw new Error("unsafe property");
      bytes += Buffer.byteLength(key) + 4;
      if (bytes > maxBytes) throw new Error("input size");
      const nested = visit(d.value as unknown, depth + 1);
      if (Array.isArray(item)) arr.push(nested);
      else out[key] = nested;
    }
    seen.delete(item);
    return Array.isArray(item) ? arr : out;
  };
  return immutable(visit(value, 0));
};

export class BoundedQueue<T> {
  private readonly items: T[] = [];
  public highWater = 0;
  public enqueued = 0;
  public dequeued = 0;
  public rejected = 0;
  public constructor(public readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("invalid capacity");
  }
  public push(item: T): boolean {
    if (this.items.length >= this.capacity) {
      this.rejected++;
      return false;
    }
    this.items.push(item);
    this.enqueued++;
    this.highWater = Math.max(this.highWater, this.items.length);
    return true;
  }
  public shift(): T | undefined {
    const item = this.items.shift();
    if (item !== undefined) this.dequeued++;
    return item;
  }
  public get depth(): number {
    return this.items.length;
  }
  public clear(): number {
    const count = this.items.length;
    this.items.length = 0;
    return count;
  }
  public snapshot() {
    return {
      capacity: this.capacity,
      depth: this.depth,
      highWater: this.highWater,
      enqueued: this.enqueued,
      dequeued: this.dequeued,
      rejected: this.rejected,
    };
  }
}
export class ConsumerChannel {
  public readonly queue: BoundedQueue<AcceptedObservation>;
  public degraded = false;
  public closed = false;
  public constructor(
    public readonly consumerId: string,
    capacity: number,
  ) {
    this.queue = new BoundedQueue(capacity);
  }
  public deliver(value: AcceptedObservation): boolean {
    if (this.closed) return false;
    const ok = this.queue.push(value);
    if (!ok) this.degraded = true;
    return ok;
  }
  public async read(): Promise<AcceptedObservation | undefined> {
    return Promise.resolve(this.queue.shift());
  }
  public close(): number {
    this.closed = true;
    return this.queue.clear();
  }
}
