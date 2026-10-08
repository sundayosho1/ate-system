import { createHash } from "node:crypto";
import { types } from "node:util";
import { stableMarketDataStringify, schemas, type UtcTimestamp } from "@ate/domain";
import { mustParseUtc, type Clock } from "@ate/time";
export type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: { code: string; timestamp: UtcTimestamp } }>;
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = <T = never>(clock: Clock, code: string): Result<T> => ({
  ok: false,
  error: { code, timestamp: clock.now() },
});
export const hash = (value: unknown): string =>
  createHash("sha256").update(stableMarketDataStringify(value)).digest("hex");
export const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
export const utc = (ms: number): UtcTimestamp => {
  if (!Number.isSafeInteger(ms)) throw Error("UNSAFE_TIME");
  return mustParseUtc(new Date(ms).toISOString());
};
export const instant = (value: unknown): UtcTimestamp => schemas.timestamp.parse(value);
export const safeClone = (value: unknown, maxBytes = 65536): unknown => {
  let budget = 0;
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number): unknown => {
    if (depth > 20 || ++budget > maxBytes) throw Error("INPUT_BOUNDS");
    if (v === undefined || v === null || typeof v === "boolean") return v;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw Error("INVALID_NUMBER");
      return v;
    }
    if (typeof v === "string") {
      budget += Buffer.byteLength(v);
      if (budget > maxBytes || v.length > maxBytes) throw Error("INPUT_BOUNDS");
      return v;
    }
    if (typeof v !== "object" || types.isProxy(v) || seen.has(v)) throw Error("INVALID_INPUT");
    const proto: unknown = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== Array.prototype && proto !== null)
      throw Error("INVALID_INPUT");
    seen.add(v);
    const entries = Object.getOwnPropertyDescriptors(v);
    const result: Record<string, unknown> = {};
    for (const [key, d] of Object.entries(entries)) {
      if (!("value" in d) || ["__proto__", "constructor", "prototype"].includes(key))
        throw Error("INVALID_INPUT");
      if (key === "length" && Array.isArray(v)) continue;
      budget += key.length;
      result[key] = visit(d.value, depth + 1);
    }
    seen.delete(v);
    return Array.isArray(v) ? Object.keys(result).map((k) => result[k]) : result;
  };
  return visit(value, 0);
};
