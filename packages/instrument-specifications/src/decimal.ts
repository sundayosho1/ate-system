import { decimalSchema } from "./contracts.js";
/** Bounded exact fixed point; scale is 18. Never converts declared monetary values to Number. */
const scale = 10n ** 18n;
export function integer(raw: string): bigint {
  decimalSchema.parse(raw);
  const negative = raw.startsWith("-"),
    [whole, fraction = ""] = (negative ? raw.slice(1) : raw).split(".");
  const value = BigInt(whole!) * scale + BigInt(fraction.padEnd(18, "0"));
  return negative ? -value : value;
}
export function decimal(raw: string): string {
  const n = integer(raw),
    absolute = n < 0n ? -n : n;
  const fraction = (absolute % scale).toString().padStart(18, "0").replace(/0+$/, "");
  return `${n < 0n ? "-" : ""}${absolute / scale}${fraction ? "." + fraction : ""}`;
}
export const aligned = (value: string, increment: string, origin = "0") =>
  integer(increment) > 0n && (integer(value) - integer(origin)) % integer(increment) === 0n;
