import { createHash } from "node:crypto";
import { types } from "node:util";
import { stableStringify } from "@ate/configuration";
export const fingerprint = (value: unknown): string =>
  "sha256:" + createHash("sha256").update(stableStringify(value)).digest("hex");
export function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) frozen(v);
    Object.freeze(value);
  }
  return value;
}
export function boundedClone(raw: unknown, maxBytes: number, maxDepth: number): unknown {
  const seen = new Set<object>();
  let remaining = maxBytes;
  const inspect = (value: unknown, depth: number): void => {
    if (depth > maxDepth) throw Error("INPUT_DEPTH");
    if (--remaining < 0) throw Error("INPUT_BOUNDS");
    if (typeof value === "string") {
      remaining -= Buffer.byteLength(value);
      if (remaining < 0) throw Error("INPUT_BOUNDS");
    }
    if (value && typeof value === "object") {
      if (types.isProxy(value) || seen.has(value)) throw Error("INVALID_INPUT");
      seen.add(value);
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key))
          throw Error("INVALID_INPUT");
        const d = Object.getOwnPropertyDescriptor(value, key)!;
        if (d.get || d.set) throw Error("INVALID_INPUT");
        inspect(d.value, depth + 1);
      }
      seen.delete(value);
    } else if (value !== null && !["string", "number", "boolean"].includes(typeof value))
      throw Error("INVALID_INPUT");
  };
  inspect(raw, 0);
  let text: string;
  try {
    text = JSON.stringify(raw);
  } catch {
    throw Error("INVALID_INPUT");
  }
  if (typeof text !== "string" || Buffer.byteLength(text) > maxBytes) throw Error("INPUT_BOUNDS");
  const value: unknown = JSON.parse(text);
  const visit = (v: unknown, depth: number): void => {
    if (depth > maxDepth) throw Error("INPUT_DEPTH");
    if (v && typeof v === "object")
      for (const [k, child] of Object.entries(v)) {
        if (["__proto__", "prototype", "constructor"].includes(k)) throw Error("INVALID_INPUT");
        visit(child, depth + 1);
      }
  };
  visit(value, 0);
  return value;
}
export const bytes = (v: unknown) => Buffer.byteLength(stableStringify(v));
/** Validate raw JSON keys before normal parsing can erase duplicate evidence. */
export function parsePolicyJson(raw: string): unknown {
  const value: unknown = JSON.parse(raw),
    stack: { object: boolean; key: boolean; seen: Set<string> }[] = [];
  for (const match of raw.matchAll(/"(?:\\.|[^"\\])*"|\{|\}|\[|\]|:|,/gu)) {
    const token = match[0];
    if (token === "{" || token === "[") {
      stack.push({ object: token === "{", key: token === "{", seen: new Set() });
      continue;
    }
    if (token === "}" || token === "]") {
      stack.pop();
      continue;
    }
    const scope = stack.at(-1);
    if (token === ",") {
      if (scope?.object) scope.key = true;
      continue;
    }
    if (token.startsWith('"') && scope?.object && scope.key) {
      const key = JSON.parse(token) as string;
      if (scope.seen.has(key)) throw Error("DUPLICATE_JSON_KEY");
      scope.seen.add(key);
      scope.key = false;
    }
  }
  return value;
}
