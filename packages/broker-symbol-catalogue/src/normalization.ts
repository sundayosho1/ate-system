import { fingerprint, stableStringify } from "@ate/configuration";
import { normalize } from "@ate/instrument-registry";
import { freeze } from "@ate/multitimeframe";
import { safeClone } from "./boundary.js";
import {
  batchSchema,
  type Batch,
  type Catalogue,
  type Observation,
  type SymbolRecord,
  type Namespace,
} from "./contracts.js";
import type { Policy } from "./policy.js";
export const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const bytes = (v: unknown): number => Buffer.byteLength(stableStringify(v), "utf8");
export const namespaceKey = (n: Namespace): string =>
  fingerprint({
    brokerNamespaceId: n.brokerNamespaceId,
    sourceSystem: n.sourceSystem,
    terminalFixtureId: n.terminalFixtureId,
    catalogueSourceId: n.catalogueSourceId,
  });
export function comparisonKeys(raw: string, p: Policy): Observation["keys"] {
  if (raw.trim() !== raw) throw Error("SYMBOL_BOUNDARY_WHITESPACE");
  return p.rules
    .map((r) => {
      const first = normalize(raw, r.case);
      if (first.status === "INVALID" || first.status === "UNSUPPORTED")
        throw Error("NORMALIZATION_INVALID");
      const suffix = r.suffixes.find((s) => first.value.endsWith(s)) ?? null;
      const base = suffix === null ? first.value : first.value.slice(0, -suffix.length);
      const final = normalize(base, r.case);
      if (
        final.status === "INVALID" ||
        final.status === "UNSUPPORTED" ||
        r.suffixes.some((s) => final.value.endsWith(s))
      )
        throw Error("UNSTABLE_OR_EMPTY_SUFFIX");
      return {
        ruleId: r.id,
        version: "B1" as const,
        n1Version: "N1" as const,
        raw,
        value: final.value,
        removedSuffix: suffix,
      };
    })
    .sort((a, b) => compare(a.ruleId, b.ruleId));
}
const scaled = (s: string): bigint => {
  const [i, f = ""] = s.split(".");
  return BigInt(i!) * 10n ** 18n + BigInt(f.padEnd(18, "0"));
};
export function quality(
  raw: SymbolRecord,
  source: Batch["source"],
  at: string,
): Observation["quality"] {
  const flags: string[] = [];
  for (const k of [
    "point",
    "tickSize",
    "minimumPriceIncrement",
    "volumeStep",
    "contractSize",
    "minimumVolume",
  ] as const)
    if (raw[k] !== undefined && scaled(raw[k]) === 0n)
      flags.push("NON_POSITIVE_" + k.toUpperCase());
  if (
    raw.minimumVolume !== undefined &&
    raw.maximumVolume !== undefined &&
    scaled(raw.minimumVolume) > scaled(raw.maximumVolume)
  )
    flags.push("VOLUME_RANGE_CONFLICT");
  if (raw.volumeStep !== undefined && scaled(raw.volumeStep) > 0n)
    for (const k of ["minimumVolume", "maximumVolume"] as const)
      if (raw[k] !== undefined && scaled(raw[k]) % scaled(raw.volumeStep) !== 0n)
        flags.push("VOLUME_STEP_CONFLICT");
  if (
    raw.point !== undefined &&
    raw.digits !== undefined &&
    scaled(raw.point) !== 10n ** BigInt(18 - raw.digits)
  )
    flags.push("PRECISION_CONFLICT");
  if (raw.listed === false) flags.push("LISTING_CONFLICT");
  const time = raw.observedAt ?? source.observedAt;
  if (time !== undefined && Date.parse(time) > Date.parse(at))
    flags.push("FUTURE_OBSERVATION_AT_IMPORT");
  if (source.sourceUpdatedAt !== undefined && Date.parse(source.sourceUpdatedAt) > Date.parse(at))
    flags.push("FUTURE_SOURCE_UPDATE_AT_IMPORT");
  const identifiers = raw.identifiers ?? [];
  if (new Set(identifiers.map((i) => fingerprint(i))).size !== identifiers.length)
    flags.push("DUPLICATE_IDENTIFIER_CLAIM");
  const complete = [
    "digits",
    "tickSize",
    "contractSize",
    "volumeStep",
    "minimumVolume",
    "maximumVolume",
  ].every((k) => raw[k as keyof SymbolRecord] !== undefined);
  return {
    completeness: complete
      ? "DECLARED_COMPLETE"
      : Object.keys(raw).length === 1
        ? "MINIMAL"
        : "PARTIAL",
    flags: [...new Set(flags)].sort(compare),
    verification: source.quality === "EVIDENCED_RECORDED" ? "EVIDENCED" : "SOURCE_ASSERTED",
  };
}
export function prepareBatch(raw: unknown, p: Policy): Batch {
  const clone = safeClone(raw, p.maxSourceBytes);
  if (bytes(clone) > p.maxSourceBytes) throw Error("SOURCE_BYTES");
  const b = batchSchema.parse(clone);
  if (
    !p.allowedSourceSystems.includes(b.namespace.sourceSystem) ||
    !p.allowedQuality.includes(b.source.quality) ||
    b.records.length > p.maxRecordsPerCatalogue
  )
    throw Error("SOURCE_NOT_ALLOWED_OR_BOUNDED");
  const seen = new Set<string>(),
    native = new Set<string>();
  for (const r of b.records) {
    if (bytes(r) > p.maxRecordBytes) throw Error("RECORD_BYTES");
    if (seen.has(r.rawSymbol)) throw Error("DUPLICATE_RAW_SYMBOL");
    seen.add(r.rawSymbol);
    if (r.sourceNativeId !== undefined) {
      if (native.has(r.sourceNativeId)) throw Error("DUPLICATE_NATIVE_ID");
      native.add(r.sourceNativeId);
    }
    comparisonKeys(r.rawSymbol, p);
  }
  b.records.sort((a, b) => compare(a.rawSymbol, b.rawSymbol));
  return freeze(b);
}
export function makeCatalogue(
  b: Batch,
  p: Policy,
  version: number,
  parent: string | null,
  at: Catalogue["importedAt"],
  clockProvenance: Catalogue["clockProvenance"],
): Catalogue {
  const nk = namespaceKey(b.namespace),
    inputFingerprint = fingerprint(b);
  const observations = b.records.map((raw) => {
    const content = {
      raw,
      keys: comparisonKeys(raw.rawSymbol, p),
      classification: {
        family: raw.declaredFamily ?? "UNKNOWN",
        basis:
          raw.declaredFamily !== undefined && raw.declaredFamily !== "UNKNOWN"
            ? ("BROKER_DECLARED" as const)
            : ("UNKNOWN" as const),
      },
      quality: quality(raw, b.source, at),
    };
    return {
      ...content,
      fingerprint: fingerprint({ namespaceKey: nk, source: b.source, ...content }),
    };
  });
  const groups = new Map<string, { ruleId: string; key: string; rawSymbols: string[] }>();
  for (const o of observations)
    for (const k of o.keys) {
      const id = fingerprint({ ruleId: k.ruleId, value: k.value }),
        g = groups.get(id) ?? { ruleId: k.ruleId, key: k.value, rawSymbols: [] };
      g.rawSymbols.push(o.raw.rawSymbol);
      groups.set(id, g);
    }
  const collisions = [...groups.values()]
    .filter((g) => g.rawSymbols.length > 1)
    .sort((a, b) => compare(a.ruleId, b.ruleId) || compare(a.key, b.key));
  const content = {
    schemaVersion: 1 as const,
    namespace: b.namespace,
    namespaceKey: nk,
    version,
    parent,
    batchId: b.batchId,
    source: b.source,
    inputFingerprint,
    importedAt: at,
    publishedAt: at,
    clockProvenance,
    observations,
    collisions,
  };
  return freeze({ ...content, fingerprint: fingerprint(content) });
}
export function reconstructBatch(c: Catalogue): Batch {
  return {
    schemaVersion: 1,
    namespace: c.namespace,
    batchId: c.batchId,
    source: c.source,
    records: c.observations.map((o) => o.raw),
  };
}
export function freshness(
  c: Catalogue,
  o: Observation,
  at: string,
  p: Policy,
): "UNKNOWN" | "FRESH_EVIDENCE" | "STALE_EVIDENCE" | "FUTURE_EVIDENCE" {
  const time = o.raw.observedAt ?? c.source.observedAt;
  if (time === undefined || c.source.timeQuality === "UNKNOWN") return "UNKNOWN";
  const age = Date.parse(at) - Date.parse(time);
  return age < 0 ? "FUTURE_EVIDENCE" : age > p.staleAfterMs ? "STALE_EVIDENCE" : "FRESH_EVIDENCE";
}

export function discoveryStates(o: Observation): readonly string[] {
  const states = ["LISTED_IN_CATALOGUE"];
  if (o.raw.visible !== undefined)
    states.push(o.raw.visible ? "SOURCE_DECLARED_VISIBLE" : "SOURCE_DECLARED_HIDDEN");
  if (o.raw.tradeMode === "DISABLED") states.push("SOURCE_DECLARED_DISABLED");
  if (o.raw.tradeMode === undefined || o.raw.tradeMode === "UNKNOWN")
    states.push("SOURCE_STATUS_UNKNOWN");
  if (o.raw.listed === false) states.push("NOT_LISTED_IN_OBSERVED_CATALOGUE");
  if (o.quality.flags.length) states.push("OBSERVATION_CONFLICT");
  return freeze(states.sort(compare));
}
