import { types } from "node:util";
import { safeClone as ownerClone, freeze } from "@ate/multitimeframe";
import { fingerprint } from "@ate/configuration";
import type { Result } from "./contracts.js";
export { freeze, fingerprint };
export function clone(raw: unknown, maxBytes = 65536, maxDepth = 20): unknown {
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (depth > maxDepth || ++nodes > maxBytes) throw Error("RESOURCE_BUDGET_EXCEEDED");
    if (
      v === undefined ||
      typeof v === "symbol" ||
      typeof v === "bigint" ||
      typeof v === "function"
    )
      throw Error("UNKNOWN_EVIDENCE");
    if (
      typeof v === "string" &&
      ([...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v))
    )
      throw Error("UNKNOWN_EVIDENCE");
    if (v === null || typeof v !== "object") return;
    if (types.isProxy(v) || seen.has(v)) throw Error("UNKNOWN_EVIDENCE");
    seen.add(v);
    const keys = Reflect.ownKeys(v),
      descriptors = Object.getOwnPropertyDescriptors(v);
    if (keys.length > maxBytes || keys.some((k) => typeof k !== "string"))
      throw Error("RESOURCE_BUDGET_EXCEEDED");
    if (Array.isArray(v) && keys.length !== v.length + 1) throw Error("UNKNOWN_EVIDENCE");
    for (const [key, d] of Object.entries(descriptors)) {
      if (Array.isArray(v) && key === "length") continue;
      if (
        !("value" in d) ||
        !d.enumerable ||
        ["__proto__", "constructor", "prototype"].includes(key)
      )
        throw Error("UNKNOWN_EVIDENCE");
      visit(key, depth + 1);
      visit(d.value, depth + 1);
    }
    seen.delete(v);
  };
  visit(raw, 0);
  const c = ownerClone(raw, maxBytes);
  if (Buffer.byteLength(JSON.stringify(c)) > maxBytes) throw Error("RESOURCE_BUDGET_EXCEEDED");
  return c;
}
export function errorCode(e: unknown): string {
  if (e === null || typeof e !== "object" || types.isProxy(e)) return "UNKNOWN_EVIDENCE";
  const d = Object.getOwnPropertyDescriptor(e, "message");
  return d && "value" in d && typeof d.value === "string" && /^[A-Z][A-Z0-9_]{0,127}$/.test(d.value)
    ? d.value
    : "UNKNOWN_EVIDENCE";
}
export const failure = <T = never>(
  code: string,
  commitment: "NONE" | "UNKNOWN" = "NONE",
  correlation = "unavailable",
): Result<T> => ({ ok: false, error: { code, commitment, auditCorrelationId: correlation } });
export const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
export function withoutFingerprint<T extends { fingerprint: string }>(v: T) {
  const { fingerprint: ignored, ...body } = v;
  void ignored;
  return body;
}
/** Validate member uniqueness before JSON.parse can erase conflicting evidence. */
export function parseJSON(raw: unknown, maxBytes: number): unknown {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > maxBytes)
    throw Error("RESOURCE_BUDGET_EXCEEDED");
  let at = 0,
    nodes = 0;
  const ws = () => {
    while (/[\t\r\n ]/.test(raw[at] ?? "!")) at++;
  };
  const string = (): string => {
    const start = at++;
    while (at < raw.length) {
      const c = raw[at++];
      if (c === '"') return JSON.parse(raw.slice(start, at)) as string;
      if (c === "\\") at++;
    }
    throw Error("UNKNOWN_EVIDENCE");
  };
  const primitive = /(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/y;
  const value = (depth: number): void => {
    if (depth > 20 || ++nodes > maxBytes) throw Error("RESOURCE_BUDGET_EXCEEDED");
    ws();
    if (raw[at] === '"') {
      string();
      return;
    }
    const open = raw[at];
    if (open === "{" || open === "[") {
      at++;
      ws();
      const close = open === "{" ? "}" : "]",
        keys = new Set<string>();
      if (raw[at] === close) {
        at++;
        return;
      }
      for (;;) {
        ws();
        if (open === "{") {
          if (raw[at] !== '"') throw Error("UNKNOWN_EVIDENCE");
          const key = string();
          if (keys.has(key)) throw Error("DUPLICATE_JSON_KEY");
          keys.add(key);
          ws();
          if (raw[at++] !== ":") throw Error("UNKNOWN_EVIDENCE");
        }
        value(depth + 1);
        ws();
        if (raw[at] === close) {
          at++;
          return;
        }
        if (raw[at++] !== ",") throw Error("UNKNOWN_EVIDENCE");
      }
    }
    primitive.lastIndex = at;
    const match = primitive.exec(raw);
    if (!match) throw Error("UNKNOWN_EVIDENCE");
    at += match[0].length;
  };
  value(0);
  ws();
  if (at !== raw.length) throw Error("UNKNOWN_EVIDENCE");
  return clone(JSON.parse(raw), maxBytes);
}

/** Sum of checkpoint UTF-8 JSON bytes; collection brackets/commas are not retained records. */
export function retainedHistoryBytes(records: readonly unknown[]): number {
  return records.reduce<number>((total, record) => total + bytes(record), 0);
}

/** Validate the bounded native collection before reading any row getter or allocating copies. */
export function cloneHistory(
  raw: unknown,
  maxRecords: number,
  maxCheckpointBytes: number,
  maxRetainedBytes: number,
): unknown[] {
  if (types.isProxy(raw) || !Array.isArray(raw)) throw Error("UNKNOWN_EVIDENCE");
  if (raw.length > maxRecords) throw Error("RESOURCE_BUDGET_EXCEEDED");
  if (Reflect.ownKeys(raw).length !== raw.length + 1) throw Error("UNKNOWN_EVIDENCE");
  const records: unknown[] = [];
  let retained = 0;
  for (let i = 0; i < raw.length; i++) {
    const d = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!d || !("value" in d) || !d.enumerable) throw Error("UNKNOWN_EVIDENCE");
    const record = clone(d.value, Math.min(maxCheckpointBytes, maxRetainedBytes - retained));
    retained += bytes(record);
    if (retained > maxRetainedBytes) throw Error("RESOURCE_BUDGET_EXCEEDED");
    records.push(record);
  }
  return records;
}
