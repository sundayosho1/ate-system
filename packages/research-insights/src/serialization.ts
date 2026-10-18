import { createHash } from "node:crypto";
import { ok, fail, domainIssue, parseUtcTimestamp, type DomainResult } from "@ate/domain";
import type { Clock } from "@ate/time";
import { R1, type JsonValue } from "@ate/research-insight-contracts";
export function issue(code: string, message = code): DomainResult<never> {
  return fail(domainIssue(code, message));
}
export function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) frozen(v);
    Object.freeze(value);
  }
  return value;
}
/** Projection data only. Never invokes accessors/hooks or serializes native owner objects. */
export function snapshot(
  raw: unknown,
  maxBytes: number = R1.request.maxBytes,
  maxDepth: number = R1.request.maxDepth,
  maxNodes: number = R1.request.maxNodes,
  cancelled: boolean = false,
): DomainResult<JsonValue> {
  let bytes = 0,
    nodes = 0;
  const ancestors = new Set<object>();
  const add = (n: number) => {
    bytes += n;
    if (bytes > maxBytes) throw Error("INSIGHT_INPUT_BOUNDS");
  };
  const visit = (v: unknown, depth: number): JsonValue => {
    if (nodes % R1.cancellation.serializationBatchNodes === 0 && cancelled)
      throw Error("INSIGHT_CANCELLED");
    if (++nodes > maxNodes || depth > maxDepth) throw Error("INSIGHT_INPUT_BOUNDS");
    if (v === null) {
      add(4);
      return null;
    }
    if (typeof v === "string") {
      if (Buffer.byteLength(v, "utf8") > maxBytes) throw Error("INSIGHT_INPUT_BOUNDS");
      add(Buffer.byteLength(JSON.stringify(v)));
      return v;
    }
    if (typeof v === "boolean") {
      add(v ? 4 : 5);
      return v;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      add(Buffer.byteLength(JSON.stringify(v)));
      return Object.is(v, -0) ? 0 : v;
    }
    if (typeof v !== "object") throw Error("INSIGHT_SCHEMA_INVALID");
    if (ancestors.has(v)) throw Error("INSIGHT_CYCLIC_INPUT");
    ancestors.add(v);
    try {
      const proto: unknown = Object.getPrototypeOf(v);
      if (!Array.isArray(v) && proto !== Object.prototype && proto !== null)
        throw Error("INSIGHT_SCHEMA_INVALID");
      const keys = Reflect.ownKeys(v);
      if (keys.length > maxNodes - nodes + 1) throw Error("INSIGHT_INPUT_BOUNDS");
      if (
        keys.some(
          (k) => typeof k !== "string" || ["__proto__", "constructor", "prototype"].includes(k),
        )
      )
        throw Error("INSIGHT_SCHEMA_INVALID");
      add(2);
      if (Array.isArray(v)) {
        const len = Object.getOwnPropertyDescriptor(v, "length")?.value as unknown;
        if (typeof len !== "number" || len > maxNodes - nodes || keys.length !== len + 1)
          throw Error("INSIGHT_INPUT_BOUNDS");
        const result: JsonValue[] = [];
        for (let i = 0; i < len; i++) {
          const d = Object.getOwnPropertyDescriptor(v, String(i));
          if (!d || !("value" in d) || !d.enumerable) throw Error("INSIGHT_ACCESSOR_REJECTED");
          if (i) add(1);
          result.push(visit(d.value, depth + 1));
        }
        return result;
      }
      const result: Record<string, JsonValue> = {};
      let first = true;
      for (const k of (keys as string[]).sort()) {
        const d = Object.getOwnPropertyDescriptor(v, k);
        if (!d || !("value" in d) || !d.enumerable) throw Error("INSIGHT_ACCESSOR_REJECTED");
        if (!first) add(1);
        first = false;
        add(Buffer.byteLength(JSON.stringify(k)) + 1);
        result[k] = visit(d.value, depth + 1);
      }
      return result;
    } finally {
      ancestors.delete(v);
    }
  };
  try {
    if (cancelled) return issue("INSIGHT_CANCELLED");
    const value = frozen(visit(raw, 0));
    if (cancelled) return issue("INSIGHT_CANCELLED");
    return ok(value);
  } catch (e) {
    return issue(
      e instanceof Error && e.message.startsWith("INSIGHT_")
        ? e.message
        : "INSIGHT_ACCESSOR_REJECTED",
    );
  }
}

export function captureGeneratedAt(clock: Clock): DomainResult<JsonValue> {
  try {
    const now = clock.now(),
      t = parseUtcTimestamp(now);
    if (!t.ok || t.value !== now) return issue("INSIGHT_CLOCK_UNAVAILABLE");
    return snapshot({ generatedAt: t.value, provenance: clock.provenance });
  } catch {
    return issue("INSIGHT_CLOCK_UNAVAILABLE");
  }
}
export function canonicalInsightBytes(
  raw: unknown,
  scope: "DESCRIPTOR" | "ENTRY" | "CATALOGUE" | "REPORT" | "EXPORT" = "DESCRIPTOR",
  cancelled: boolean = false,
): DomainResult<Uint8Array> {
  if (typeof cancelled !== "boolean") return issue("INSIGHT_SCHEMA_INVALID");
  if (cancelled) return issue("INSIGHT_CANCELLED");
  const limits = {
    DESCRIPTOR: 65536,
    ENTRY: 32768,
    CATALOGUE: 16777216,
    REPORT: 4194304,
    EXPORT: 8388608,
  };
  if (typeof scope !== "string" || !Object.hasOwn(limits, scope))
    return issue("INSIGHT_SCHEMA_UNSUPPORTED");
  const r = snapshot(
    raw,
    limits[scope],
    scope === "DESCRIPTOR" || scope === "ENTRY" ? 16 : 32,
    scope === "DESCRIPTOR" || scope === "ENTRY" ? 10000 : 10000 * 10000,
    cancelled,
  );
  if (!r.ok) return scope === "EXPORT" ? issue("INSIGHT_EXPORT_LIMIT_EXCEEDED") : r;
  return ok(Buffer.from(JSON.stringify(r.value), "utf8"));
}
export function insightFingerprint(
  raw: Uint8Array,
  context: Readonly<{ contractVersion: string; sourceCommit: string; projectionVersion: string }>,
): DomainResult<string> {
  try {
    const c = snapshot(context);
    if (!c.ok) return c;
    const v = c.value as Record<string, JsonValue>;
    if (
      !(raw instanceof Uint8Array) ||
      raw.byteLength > 16777216 ||
      !v ||
      Object.keys(v).sort().join(",") !== "contractVersion,projectionVersion,sourceCommit" ||
      typeof v.contractVersion !== "string" ||
      !v.contractVersion ||
      typeof v.projectionVersion !== "string" ||
      !v.projectionVersion ||
      typeof v.sourceCommit !== "string" ||
      !/^[a-f0-9]{40}$/.test(v.sourceCommit)
    )
      return issue("INSIGHT_INPUT_BOUNDS");
    return ok(
      "sha256:" +
        createHash("sha256").update(JSON.stringify(c.value)).update("\n").update(raw).digest("hex"),
    );
  } catch {
    return issue("INSIGHT_ACCESSOR_REJECTED");
  }
}

/** Capture indexed corpus cells once. Never consume a caller iterator or sparse/accessor array. */
export function corpusRows(raw: unknown): DomainResult<readonly unknown[]> {
  try {
    if (!Array.isArray(raw)) return issue("INSIGHT_INPUT_BOUNDS");
    const ds = Object.getOwnPropertyDescriptors(raw) as unknown as Record<
        PropertyKey,
        PropertyDescriptor
      >,
      len: unknown = ds.length?.value;
    if (
      typeof len !== "number" ||
      !Number.isSafeInteger(len) ||
      len < 0 ||
      len > R1.knowledge.maxEntries
    )
      return issue("INSIGHT_INPUT_BOUNDS");
    if (Reflect.ownKeys(ds).length !== len + 1) return issue("INSIGHT_SCHEMA_INVALID");
    const result: unknown[] = [];
    for (let i = 0; i < len; i++) {
      const cell = ds[String(i)];
      if (!cell || !("value" in cell) || !cell.enumerable)
        return issue("INSIGHT_ACCESSOR_REJECTED");
      result.push(cell.value);
    }
    return ok(Object.freeze(result));
  } catch {
    return issue("INSIGHT_ACCESSOR_REJECTED");
  }
}
