import { safeClone as ownerClone } from "@ate/multitimeframe";
/** Existing bounded native clone plus registry-specific JSON array/symbol qualification. */
export function safeClone(value: unknown, maxBytes = 65536): unknown {
  const cloned = ownerClone(value, maxBytes);
  const inspect = (v: unknown): void => {
    if (v === null || typeof v !== "object") return;
    const keys = Reflect.ownKeys(v);
    if (keys.some((k) => typeof k === "symbol")) throw Error("SYMBOL_INPUT");
    if (Array.isArray(v)) {
      if (
        keys.length !== v.length + 1 ||
        keys.some(
          (k) => k !== "length" && (!/^(0|[1-9][0-9]*)$/.test(String(k)) || Number(k) >= v.length),
        )
      )
        throw Error("NON_JSON_ARRAY");
    }
    for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
      if (key === "length" && Array.isArray(v)) continue;
      if (!("value" in d)) throw Error("ACCESSOR_INPUT");
      inspect(d.value);
    }
  };
  inspect(value);
  return cloned;
}
