import { operationBudget } from "./validation.js";
import { createHash } from "node:crypto";
import { demand, freeze } from "./validation.js";
import type { Limits } from "./contracts.js";
export function canonical(value: unknown): string {
  const compare = (a: string, b: string) => {
    const x = Array.from(a, (c) => c.codePointAt(0) ?? 0),
      y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return x.length - y.length;
  };
  const active = new Set<object>();
  const visit = (v: unknown): string => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
    if (typeof v === "number") {
      demand(Number.isFinite(v));
      return JSON.stringify(v);
    }
    demand(typeof v === "object" && !active.has(v));
    active.add(v);
    const ds = Object.getOwnPropertyDescriptors(v);
    demand(Object.getOwnPropertySymbols(v).length === 0);
    let text: string;
    if (Array.isArray(v)) {
      const out: string[] = [];
      for (let i = 0; i < v.length; i++) {
        const d = ds[String(i)];
        demand(d && "value" in d);
        out.push(visit(d.value));
      }
      text = "[" + out.join(",") + "]";
    } else {
      demand(Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
      text =
        "{" +
        Object.keys(ds)
          .sort(compare)
          .map((k) => {
            const d = ds[k];
            demand(d && "value" in d && d.enumerable);
            return JSON.stringify(k) + ":" + visit(d.value);
          })
          .join(",") +
        "}";
    }
    active.delete(v);
    return text;
  };
  return visit(value);
}
export const fingerprint = (domain: string, value: unknown) =>
  "sha256:" +
  createHash("sha256")
    .update(domain + "\n" + canonical(value))
    .digest("hex");
export function immutable<T>(
  value: T,
  limits: Readonly<Limits>,
  meter = operationBudget(limits),
): Readonly<T> {
  const copy = meter.capture(value);
  return freeze(copy as T);
}
export function checkedCanonicalText(text: string, limits: Readonly<Limits>): unknown {
  demand(Buffer.byteLength(text) <= limits.maxRecordBytes, "BUDGET_EXHAUSTED");
  const raw: unknown = JSON.parse(text);
  const captured = operationBudget(limits).capture(raw, limits.maxRecordBytes);
  demand(canonical(captured) === text, "JOURNAL_CORRUPT");
  return captured;
}
