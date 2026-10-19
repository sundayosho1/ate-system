import { types } from "node:util";
import { createHash } from "node:crypto";
import type { JsonValue } from "./contracts.js";
import { demand, freeze } from "./validation.js";
export interface Meter {
  visit(depth: number): void;
  bytes(n: number): void;
}
/** A successful JSON snapshot preserves validated structural fields and literal types. */
export function snapshot<T extends JsonValue>(raw: T, meter?: Meter): T;
export function snapshot(raw: unknown, meter?: Meter): JsonValue;
export function snapshot(raw: unknown, meter?: Meter): JsonValue {
  const ancestors = new Set<object>();
  let nodes = 0;
  const visit = (v: unknown, d: number): JsonValue => {
    demand(++nodes <= 10000 && d <= 16, "WORKSPACE:BUDGET_EXHAUSTED");
    meter?.visit(d);
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") {
      demand(Number.isFinite(v));
      return Object.is(v, -0) ? 0 : v;
    }
    if (typeof v === "string") {
      demand(
        !/[\uD800-\uDFFF]/u.test(v) &&
          !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
      );
      demand(Buffer.byteLength(v) <= 4194304, "WORKSPACE:BUDGET_EXHAUSTED");
      return v;
    }
    demand(typeof v === "object" && !ancestors.has(v) && !types.isProxy(v));
    demand(
      Array.isArray(v) ||
        Object.getPrototypeOf(v) === Object.prototype ||
        Object.getPrototypeOf(v) === null,
    );
    ancestors.add(v);
    demand(Reflect.ownKeys(v).every((k) => typeof k === "string"));
    const ds = Object.getOwnPropertyDescriptors(v);
    demand(Object.values(ds).every((x) => "value" in x));
    let result: JsonValue;
    if (Array.isArray(v)) {
      demand(
        Object.keys(v).length === v.length &&
          Object.keys(ds).length === v.length + 1 &&
          v.length <= 10000,
      );
      result = Array.from({ length: v.length }, (_, i) => visit(ds[String(i)]?.value, d + 1));
    } else {
      demand(Object.keys(ds).length <= 10000);
      const o: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
      for (const key of Object.keys(ds).sort()) o[key] = visit(ds[key]!.value, d + 1);
      result = o;
    }
    ancestors.delete(v);
    return result;
  };
  const result = visit(raw, 0),
    bytes = Buffer.byteLength(JSON.stringify(result));
  demand(bytes <= 4194304, "WORKSPACE:BUDGET_EXHAUSTED");
  meter?.bytes(bytes);
  return freeze(result);
}
export function fingerprint(raw: unknown, meter?: Meter): string {
  const v = snapshot(raw, meter);
  return "sha256:" + createHash("sha256").update(JSON.stringify(v)).digest("hex");
}
export function cost(raw: JsonValue): number {
  let n = 1;
  if (raw && typeof raw === "object") for (const v of Object.values(raw)) n += cost(v);
  return n;
}
