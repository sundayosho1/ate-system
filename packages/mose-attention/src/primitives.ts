import { boundedClone, fingerprint, frozen } from "@ate/mose-scanner";
export { boundedClone, fingerprint, frozen };
export const errorCode = (e: unknown): string => {
  try {
    if (!(e instanceof Error)) return "OWNER_FAILURE";
    const message = e.message;
    return typeof message === "string" && /^[A-Z0-9_]{1,128}$/u.test(message)
      ? message
      : "OWNER_FAILURE";
  } catch {
    return "OWNER_FAILURE";
  }
};
export function readResult(
  raw: unknown,
):
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; commitment: "NONE" | "UNKNOWN" } } {
  if (raw === null || !["object", "function"].includes(typeof raw))
    throw Error("INVALID_OWNER_RESULT");
  const r = raw as Record<string, unknown>,
    kind = r.ok,
    value = r.value,
    error = r.error;
  if (kind === true && error === undefined) return { ok: true, value };
  if (kind !== false || value !== undefined || error === null || typeof error !== "object")
    throw Error("INVALID_OWNER_RESULT");
  const e = error as Record<string, unknown>,
    code = e.code,
    commitment = e.commitment;
  if (typeof code !== "string" || (commitment !== "NONE" && commitment !== "UNKNOWN"))
    throw Error("INVALID_OWNER_RESULT");
  return { ok: false, error: { code, commitment: commitment } };
}
export function unwrap(raw: unknown): unknown {
  const r = readResult(raw);
  if (!r.ok) throw Error(r.error.code);
  return r.value;
}
export function clone<T>(raw: T, maxBytes = 1048576, maxDepth = 20): T {
  return boundedClone(raw, maxBytes, maxDepth) as T;
}
