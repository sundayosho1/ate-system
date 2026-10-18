import { parseUtcTimestamp } from "@ate/domain";
import { canonicalInsightBytes, insightFingerprint } from "@ate/research-insights";
import type { JsonValue, Fact } from "@ate/research-insight-contracts";
import { axes, type ReportRequest, type ReportingResult } from "./contracts.js";
export class ReportingError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export const reject = <T = never>(code: string): ReportingResult<T> => ({
  ok: false,
  issues: [{ code, message: code }],
});
export const guard = <T>(fn: () => T): ReportingResult<T> => {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return reject(e instanceof ReportingError ? e.code : "REPORTING:INPUT_INVALID");
  }
};
export function demand(condition: unknown, code = "REPORTING:INPUT_INVALID"): asserts condition {
  if (!condition) throw new ReportingError(code);
}
export function freeze<T>(x: T): T {
  if (x && typeof x === "object") {
    for (const v of Object.values(x)) freeze(v);
    Object.freeze(x);
  }
  return x;
}
/** Projector DTOs only: native selected discriminator is captured separately. No accessors/hooks. */
export function data(raw: unknown, maxBytes = 65536, maxDepth = 16, maxNodes = 10000): JsonValue {
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (x: unknown, depth: number): JsonValue => {
    demand(++nodes <= maxNodes && depth <= maxDepth, "REPORTING:BUDGET_EXHAUSTED");
    if (x === null || typeof x === "boolean" || typeof x === "string") return x;
    if (typeof x === "number") {
      demand(Number.isFinite(x));
      return x;
    }
    demand(typeof x === "object" && x !== null && !seen.has(x));
    seen.add(x);
    const result: JsonValue = Array.isArray(x) ? [] : {};
    const keys = Reflect.ownKeys(x);
    demand(keys.length <= maxNodes, "REPORTING:BUDGET_EXHAUSTED");
    if (Array.isArray(x)) {
      const len = Object.getOwnPropertyDescriptor(x, "length")?.value as unknown;
      demand(
        typeof len === "number" &&
          Number.isSafeInteger(len) &&
          len >= 0 &&
          len <= maxNodes &&
          keys.length === len + 1,
      );
      for (let i = 0; i < len; i++) {
        const d = Object.getOwnPropertyDescriptor(x, String(i));
        demand(d && "value" in d && d.enumerable);
        (result as JsonValue[]).push(visit(d.value, depth + 1));
      }
    } else {
      for (const k of keys) {
        demand(typeof k === "string" && !["__proto__", "constructor", "prototype"].includes(k));
        const d = Object.getOwnPropertyDescriptor(x, k);
        demand(d && "value" in d && d.enumerable);
        (result as Record<string, JsonValue>)[k] = visit(d.value, depth + 1);
      }
    }
    seen.delete(x);
    return result;
  };
  const value = visit(raw, 0);
  demand(Buffer.byteLength(JSON.stringify(value)) <= maxBytes, "REPORTING:BUDGET_EXHAUSTED");
  return freeze(value);
}
export function object(x: JsonValue): Record<string, JsonValue> {
  demand(x !== null && typeof x === "object" && !Array.isArray(x));
  return x as Record<string, JsonValue>;
}
export function array(x: JsonValue | undefined): readonly JsonValue[] {
  demand(Array.isArray(x));
  return x as readonly JsonValue[];
}
export function exact(x: Record<string, JsonValue>, keys: readonly string[]) {
  demand(Object.keys(x).sort().join("|") === [...keys].sort().join("|"));
}
export function id(x: unknown): asserts x is string {
  demand(
    typeof x === "string" &&
      x.trim().length > 0 &&
      Buffer.byteLength(x) <= 256 &&
      ![...x].some((character) => character.charCodeAt(0) < 32),
  );
}
export function utc(x: unknown): asserts x is string {
  demand(
    typeof x === "string" &&
      x.length === 24 &&
      parseUtcTimestamp(x).ok &&
      new Date(x).toISOString() === x,
  );
}
export const unknownFact = (reason = "REPORTING:EVIDENCE_UNAVAILABLE"): Fact =>
  freeze({ kind: "UNKNOWN", reasonIds: [reason] });
export const known = (value: JsonValue, evidenceIds: readonly string[]): Fact =>
  freeze({ kind: "KNOWN", value, evidenceIds });
export function digest(raw: unknown): string {
  const b = canonicalInsightBytes(raw, "REPORT");
  demand(b.ok, "REPORTING:INPUT_INVALID");
  const h = insightFingerprint(b.value, {
    contractVersion: "ate.reporting/1",
    sourceCommit: "2cb81c1d33462f20ce15a4616eb971296d2d44ee",
    projectionVersion: "0.1.0-reporting-projection.1",
  });
  demand(h.ok);
  return h.value;
}
export const byteSize = (raw: unknown) => Buffer.byteLength(JSON.stringify(raw));
export function validateReportRequest(raw: unknown): ReportingResult<ReportRequest> {
  return guard(() => {
    const r = object(data(raw));
    exact(r, ["schema", "id", "baseline", "purpose", "mode", "asOf", "knowledgeCutoff", "facets"]);
    demand(r.schema === "ate.reporting.request/1");
    id(r.id);
    demand(r.baseline === "2cb81c1d33462f20ce15a4616eb971296d2d44ee");
    id(r.purpose);
    demand(r.mode === "HISTORICAL" || r.mode === "CURRENT");
    utc(r.asOf);
    utc(r.knowledgeCutoff);
    demand(Array.isArray(r.facets) && r.facets.length <= 2000);
    const ids = new Set<string>();
    for (const raw of array(r.facets)) {
      const f = object(raw);
      exact(f, ["id", "prompt", "owner", "subject", "axis", "artifactId", "field", "unit"]);
      id(f.id);
      demand(!ids.has(f.id));
      ids.add(f.id);
      id(f.owner);
      id(f.artifactId);
      id(f.field);
      id(f.unit);
      demand(!["__proto__", "constructor", "prototype"].includes(f.field));
      demand(Number.isSafeInteger(f.prompt) && Number(f.prompt) >= 1 && Number(f.prompt) <= 27);
      demand(axes.includes(f.axis as (typeof axes)[number]));
      demand(Array.isArray(f.subject) && f.subject.length > 0 && f.subject.length <= 8);
      f.subject.forEach(id);
    }
    return r as unknown as ReportRequest;
  });
}
