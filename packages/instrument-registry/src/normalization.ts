import { safeClone } from "./boundary.js";
import { fingerprint } from "@ate/configuration";
import { freeze } from "@ate/multitimeframe";
import {
  definitionSchema,
  identitySchema,
  type Identity,
  type InstrumentDefinition,
  type Normalization,
} from "./contracts.js";
import type { Policy } from "./policy.js";
export const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const identityId = (identity: Identity): string =>
  "ins-" +
  fingerprint({ algorithm: "I1", identity: identitySchema.parse(safeClone(identity)) }).slice(7);
export function normalize(value: unknown, rule: "EXACT" | "CASE" | "PAIR"): Normalization {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !value.trim() ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    return freeze({
      status: "INVALID",
      original: typeof value === "string" ? value : "",
      value: "",
      rule,
      version: "N1",
    });
  if (!["EXACT", "CASE", "PAIR"].includes(rule))
    return freeze({ status: "UNSUPPORTED", original: value, value, rule, version: "N1" });
  let result = value.normalize("NFC").trim();
  if (rule !== "EXACT") result = result.toUpperCase();
  if (rule === "PAIR") result = result.replace(/[-/]/g, "");
  return freeze({
    status: result === value ? "UNCHANGED" : "NORMALIZED",
    original: value,
    value: result,
    rule,
    version: "N1",
  });
}
export function validateIdentifier(scheme: string, value: string, policy: Policy): void {
  if (!policy.identifierSchemes.includes(scheme as Policy["identifierSchemes"][number]))
    throw Error("UNSUPPORTED_SCHEME");
  if (scheme === "CURRENCY" && !policy.currencies.includes(value))
    throw Error("UNSUPPORTED_CURRENCY");
  if (scheme === "CFI" && !/^[A-Z]{6}$/.test(value)) throw Error("INVALID_CFI");
  if (scheme === "FIGI") {
    if (
      !/^[BCDFGHJKLMNPQRSTVWXYZ]{2}G[BCDFGHJKLMNPQRSTVWXYZ0-9]{8}[0-9]$/.test(value) ||
      ["BS", "BM", "GG", "GB", "VG"].includes(value.slice(0, 2))
    )
      throw Error("INVALID_FIGI");
    let sum = 0;
    for (let i = 0; i < 11; i++) {
      const c = value[i]!,
        n = (c >= "A" && c <= "Z" ? c.charCodeAt(0) - 55 : Number(c)) * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(n / 10) + (n % 10);
    }
    if ((10 - (sum % 10)) % 10 !== Number(value[11])) throw Error("INVALID_FIGI_CHECKSUM");
  }
  if (scheme === "ISIN") {
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value)) throw Error("INVALID_ISIN");
    const expanded = [...value]
      .map((c) => (c >= "A" && c <= "Z" ? String(c.charCodeAt(0) - 55) : c))
      .join("");
    let sum = 0;
    for (let i = expanded.length - 1; i >= 0; i--) {
      let d = Number(expanded[i]);
      if ((expanded.length - 1 - i) % 2 === 1) d *= 2;
      sum += Math.floor(d / 10) + (d % 10);
    }
    if (sum % 10 !== 0) throw Error("INVALID_ISIN_CHECKSUM");
  }
}
export function prepare(
  raw: unknown,
  p: Policy,
): { definition: InstrumentDefinition; normalization: readonly Normalization[] } {
  const cloned = safeClone(raw, p.maxRecordBytes);
  const d = definitionSchema.parse(cloned);
  const trace: Normalization[] = [];
  for (const k of ["strike", "coupon"]) {
    const original = (cloned as { identity: Record<string, unknown> }).identity[k],
      normalized = (d.identity as unknown as Record<string, unknown>)[k];
    if (typeof original === "string" && typeof normalized === "string")
      trace.push({
        status: original === normalized ? "UNCHANGED" : "NORMALIZED",
        original,
        value: normalized,
        rule: "DECIMAL",
        version: "N1",
      });
  }
  const name = normalize(d.displayName, "EXACT");
  if (name.status === "INVALID") throw Error("INVALID_NAME");
  d.displayName = name.value;
  trace.push(name);
  if (!p.supportedFamilies.includes(d.identity.family)) throw Error("UNSUPPORTED_FAMILY");
  for (const [k, v] of Object.entries(d.identity))
    if (
      ["currency", "base", "quote"].includes(k) &&
      typeof v === "string" &&
      !p.currencies.includes(v) &&
      d.identity.family !== "DIGITAL"
    )
      throw Error("UNSUPPORTED_CURRENCY");
  if (d.currency && !p.currencies.includes(d.currency)) throw Error("UNSUPPORTED_CURRENCY");
  if (d.identity.family === "FX" && d.identity.base === d.identity.quote)
    throw Error("IDENTICAL_FX_LEGS");
  if (
    d.identity.family === "OTHER" &&
    d.identity.kind === "CURRENCY" &&
    !p.currencies.includes(d.identity.key)
  )
    throw Error("UNSUPPORTED_CURRENCY");
  if (
    d.identity.family === "OTHER" &&
    d.identity.kind === "PROVISIONAL" &&
    d.qualification !== "PROVISIONAL"
  )
    throw Error("PROVISIONAL_NOT_VERIFIED");
  if (d.qualification === "VERIFIED" && !d.evidence.some((e) => e.verification === "VERIFIED"))
    throw Error("VERIFICATION_EVIDENCE_REQUIRED");
  const t = p.taxonomies.find((t) => t.version === d.taxonomyVersion);
  if (!t) throw Error("UNKNOWN_TAXONOMY");
  const c = t.categories.find((c) => c.code === d.classification);
  if (!c || c.family !== d.identity.family || !c.kinds.includes(d.identity.kind))
    throw Error("CLASSIFICATION_MISMATCH");
  if (c.deprecated && d.status !== "DEPRECATED" && d.status !== "RETIRED")
    throw Error("DEPRECATED_CATEGORY");
  if (d.aliases.length > p.maxAliases || d.relationships.length > p.maxRelationships)
    throw Error("RECORD_LIMIT");
  for (const i of d.identifiers) {
    const n = normalize(
      i.value,
      ["ISIN", "FIGI", "CFI", "CURRENCY"].includes(i.scheme) ? "CASE" : "EXACT",
    );
    if (n.status === "INVALID") throw Error("INVALID_IDENTIFIER");
    validateIdentifier(i.scheme, n.value, p);
    trace.push(n);
    i.value = n.value;
  }
  for (const a of d.aliases) {
    const n = normalize(a.value, a.rule);
    if (n.status === "INVALID") throw Error("INVALID_ALIAS");
    trace.push(n);
    a.value = n.value;
  }
  for (const field of ["identifiers", "aliases", "relationships", "evidence"] as const) {
    d[field].sort((a, b) => compare(fingerprint(a), fingerprint(b)));
    const ids = d[field].map((v) => fingerprint(v));
    if (new Set(ids).size !== ids.length) throw Error("DUPLICATE_RECORD_ELEMENT");
  }
  // Trace belongs to the submitted representation, not definition semantic identity.
  trace.sort((a, b) => compare(fingerprint(a), fingerprint(b)));
  return freeze({ definition: d, normalization: trace });
}
export const definitionFingerprint = (d: InstrumentDefinition): string => fingerprint(d);
