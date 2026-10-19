import type { JsonValue, ObjectValue, WorkspaceResult } from "./contracts.js";
export function demand(x: unknown, code = "WORKSPACE:INPUT_INVALID"): asserts x {
  if (!x) throw Error(code);
}
export class DependencyFailure extends Error {
  constructor(
    readonly owner: string,
    readonly code: string,
    readonly detail: string,
  ) {
    super("WORKSPACE:REFERENCE_UNAVAILABLE");
  }
}
export function dependency(owner: string, code: string, message: string): never {
  throw new DependencyFailure(owner, code, message);
}
export function guard<T>(fn: () => T): WorkspaceResult<T> {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    if (error instanceof DependencyFailure)
      return {
        ok: false,
        issues: [
          {
            code: "WORKSPACE:REFERENCE_UNAVAILABLE",
            message: "Supplied evidence rejected by " + error.owner,
          },
          { code: error.code, message: (error.owner + ": " + error.detail).slice(0, 1024) },
        ],
      };
    const message =
      error instanceof Error && /^WORKSPACE:[A-Z_]+$/.test(error.message)
        ? error.message
        : "WORKSPACE:INPUT_INVALID";
    return { ok: false, issues: [{ code: message, message }] };
  }
}
export function object(v: JsonValue): ObjectValue {
  demand(v !== null && typeof v === "object" && !Array.isArray(v));
  return v as ObjectValue;
}
export function array(v: JsonValue | undefined): readonly JsonValue[] {
  demand(Array.isArray(v));
  return v as readonly JsonValue[];
}
export function exact(o: ObjectValue, keys: readonly string[], optional: readonly string[] = []) {
  demand(
    Object.keys(o).every((k) => keys.includes(k) || optional.includes(k)) &&
      keys.every((k) => Object.hasOwn(o, k)),
  );
}
export function text(v: unknown): asserts v is string {
  demand(
    typeof v === "string" &&
      v.length > 0 &&
      Buffer.byteLength(v) <= 1024 &&
      !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
  );
}
export function utc(v: unknown): asserts v is string {
  text(v);
  demand(
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString() === v,
  );
}
export function path(v: unknown): asserts v is string {
  text(v);
  demand(
    !v.includes(":") &&
      !v.includes("\\") &&
      !v.startsWith("/") &&
      v.split("/").every((p) => p !== ".." && p !== "." && p !== ""),
  );
}
export function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
}
