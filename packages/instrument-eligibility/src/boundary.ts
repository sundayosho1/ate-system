import { types } from "node:util";
import { safeClone as ownerClone } from "@ate/multitimeframe";
export const hasControl = (s: string): boolean => {
  for (const c of s) if (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) return true;
  return false;
};
export const wellFormed = (s: string): boolean =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
/** JSON-shaped input only; qualify descriptors before the owner clone can compact arrays. */
export function safeClone(raw: unknown, maxBytes = 65536, maxDepth = 20): unknown {
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (depth > maxDepth) throw Error(`INPUT_DEPTH_LIMIT_${maxDepth}`);
    if (++nodes > maxBytes) throw Error("INPUT_BOUNDS");
    if (typeof v === "string") {
      if (v.length > maxBytes || !wellFormed(v) || hasControl(v)) throw Error("INVALID_TEXT");
      return;
    }
    if (v === undefined) throw Error("NON_JSON_UNDEFINED");
    if (v === null || typeof v !== "object") return;
    if (types.isProxy(v) || seen.has(v)) throw Error("HOSTILE_INPUT");
    seen.add(v);
    const keys = Reflect.ownKeys(v);
    if (keys.length > maxBytes || keys.some((k) => typeof k !== "string"))
      throw Error("INPUT_KEYS");
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (
      Array.isArray(v) &&
      (keys.length !== v.length + 1 ||
        keys.some(
          (k) => k !== "length" && (!/^(0|[1-9][0-9]*)$/.test(String(k)) || Number(k) >= v.length),
        ))
    )
      throw Error("NON_JSON_ARRAY");
    for (const [k, d] of Object.entries(descriptors)) {
      if (Array.isArray(v) && k === "length") continue;
      if (!("value" in d) || !d.enumerable || ["__proto__", "prototype", "constructor"].includes(k))
        throw Error("HOSTILE_DESCRIPTOR");
      visit(k, depth + 1);
      visit(d.value, depth + 1);
    }
    seen.delete(v);
  };
  visit(raw, 0);
  const cloned = ownerClone(raw, maxBytes);
  // Native input is measured by deterministic JSON encoding after hostile descriptors are rejected.
  if (Buffer.byteLength(JSON.stringify(cloned), "utf8") > maxBytes) throw Error("SOURCE_BYTES");
  return cloned;
}
/** Reject duplicate JSON object members before JSON.parse discards their evidence. */
export function parseJson(raw: unknown, maxBytes: number): unknown {
  if (typeof raw !== "string" || raw.length > maxBytes || Buffer.byteLength(raw) > maxBytes)
    throw Error("SOURCE_BYTES");
  let at = 0;
  const primitive = /(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/y;
  const ws = () => {
    while (/[\t\r\n ]/.test(raw[at] ?? "!")) at++;
  };
  const string = (): string => {
    const start = at++;
    while (at < raw.length) {
      const ch = raw[at++];
      if (ch === '"') return JSON.parse(raw.slice(start, at)) as string;
      if (ch === "\\") at++;
    }
    throw Error("INVALID_JSON");
  };
  const value = (depth: number): void => {
    if (depth > 20) throw Error("INPUT_DEPTH");
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
          if (raw[at] !== '"') throw Error("INVALID_JSON");
          const key = string();
          if (keys.has(key)) throw Error("DUPLICATE_JSON_KEY");
          keys.add(key);
          ws();
          if (raw[at++] !== ":") throw Error("INVALID_JSON");
        }
        value(depth + 1);
        ws();
        if (raw[at] === close) {
          at++;
          return;
        }
        if (raw[at++] !== ",") throw Error("INVALID_JSON");
      }
    }
    primitive.lastIndex = at;
    const primitiveMatch = primitive.exec(raw);
    if (!primitiveMatch) throw Error("INVALID_JSON");
    at += primitiveMatch[0].length;
  };
  value(0);
  ws();
  if (at !== raw.length) throw Error("INVALID_JSON");
  return safeClone(JSON.parse(raw), maxBytes);
}

/** Never inspect attacker-controlled exception getters or proxies. */
export function errorLabel(error: unknown): string {
  if (error === null || typeof error !== "object" || types.isProxy(error))
    return "CALLBACK_FAILURE";
  const descriptor = Object.getOwnPropertyDescriptor(error, "message");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value.slice(0, 256)
    : "CALLBACK_FAILURE";
}
