import { fingerprint } from "@ate/configuration";
import { CalendarBoundaryResolver, freeze } from "@ate/multitimeframe";
import { mustParseUtc, type Clock } from "@ate/time";
import type { InstrumentRegistry } from "@ate/instrument-registry";
import type { CanonicalSymbolMapping } from "@ate/canonical-symbol-mapping";
import { integer, decimal, aligned } from "./decimal.js";
import { safeClone } from "./boundary.js";
import {
  requestSchema,
  clockSchema,
  profiles,
  type Request,
  type Metadata,
  type Policy,
  type Prepared,
  type Classification,
  type Validation,
} from "./contracts.js";
export interface EvidencePorts {
  clock: Clock;
  mapping: CanonicalSymbolMapping;
  registry: InstrumentRegistry;
}
export const contentFingerprint = (v: { fingerprint: string }) => {
  const { fingerprint: ignored, ...body } = v;
  void ignored;
  return fingerprint(body);
};
export const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
const decimalPaths = new Set([
  "price.point",
  "price.tick",
  "price.minimumIncrement",
  "price.tickValue",
  "price.profitTickValue",
  "price.lossTickValue",
  "price.gridOrigin",
  "price.samplePrice",
  "volume.minimum",
  "volume.maximum",
  "volume.increment",
  "volume.origin",
  "volume.limit",
  "volume.minimumNotional",
  "volume.sampleQuantity",
  "contract.size",
  "contract.multiplier",
  "margin.initial",
  "margin.maintenance",
  "margin.hedged",
  "constraints.minimumIncrement",
  "constraints.quantityIncrement",
  "constraints.priceLower",
  "constraints.priceUpper",
]);
type Field = { state: string; value?: unknown; evidence: string; alternatives?: unknown[] };
export function fields(m: Metadata): [string, Field][] {
  return Object.entries(m).flatMap(([category, values]) =>
    Object.entries(values).map(
      ([name, v]) => [`${category}.${name}`, v as Field] as [string, Field],
    ),
  );
}
export function value(m: Metadata, path: string): unknown {
  const f = fields(m).find(([p]) => p === path)?.[1];
  return f?.state === "DECLARED" ? f.value : undefined;
}
export function canonicalRequest(raw: unknown, p: Policy): Request {
  const r = requestSchema.parse(safeClone(raw, p.maxInputBytes, p.maxInputDepth));
  if (fields(r.metadata).length > p.maxFields) throw Error("FIELD_CAPACITY");
  for (const [path, f] of fields(r.metadata)) {
    const n = Array.isArray(f.value) ? f.value.length : 0;
    const max =
      path === "price.tiers"
        ? p.maxPriceTiers
        : path === "volume.tiers" || path === "margin.tiers"
          ? p.maxQuantityTiers
          : path === "lifecycle.corporateActions"
            ? p.maxLifecycleEvents
            : p.maxFields;
    if (n > max) throw Error("METADATA_CAPACITY");
  }
  const calendar = r.metadata.sessions.calendar;
  if (
    calendar?.state === "DECLARED" &&
    calendar.value &&
    (calendar.value.sessions.length > p.maxSessionIntervals ||
      calendar.value.sessions.reduce((n, s) => n + s.breaks.length, 0) > p.maxSessionIntervals)
  )
    throw Error("SESSION_CAPACITY");
  if (
    Object.keys(r.metadata.lifecycle).length +
      (r.metadata.lifecycle.corporateActions?.value?.length ?? 0) >
    p.maxLifecycleEvents
  )
    throw Error("LIFECYCLE_CAPACITY");
  if ((r.metadata.sessions.maintenance?.value?.length ?? 0) > p.maxSessionIntervals)
    throw Error("SESSION_CAPACITY");
  return freeze(r);
}
export function context(
  ports: EvidencePorts,
  r: Request,
  requireCurrent: boolean,
): Prepared["context"] {
  const snapshot = ports.mapping.snapshot(r.mappingSet);
  if (!snapshot.ok || !snapshot.value) throw Error("MAPPING_EVIDENCE_UNAVAILABLE");
  const m = snapshot.value.prepared.mappings.find((x) => x.fingerprint === r.mappingFingerprint);
  if (!m || m.outcome !== "UNIQUE_QUALIFIED_CANDIDATE" || !m.target)
    throw Error("QUALIFIED_MAPPING_REQUIRED");
  const revision = ports.registry.revision(m.target.revisionId);
  if (!revision.ok || !revision.value || revision.value.instrumentId !== m.target.instrumentId)
    throw Error("CANONICAL_EVIDENCE_UNAVAILABLE");
  if (requireCurrent) {
    const latest = ports.mapping.snapshot();
    if (!latest.ok || latest.value?.fingerprint !== r.mappingSet)
      throw Error("STALE_MAPPING_CONTEXT");
    const q = ports.mapping.query({
      kind: "MAPPINGS",
      snapshotFingerprint: r.mappingSet,
      scope: "CURRENT",
      offset: 0,
      limit: 1,
      ownerId: m.source.ownerId,
      catalogueFingerprint: m.source.catalogueFingerprint,
      observationFingerprint: m.source.observationFingerprint,
      qualifiedOnly: true,
    });
    if (!q.ok || q.value.total !== 1) throw Error("STALE_MAPPING_CONTEXT");
  }
  const calendar = r.metadata.sessions.calendar;
  let calendarFingerprint: string | null = null;
  if (calendar?.state === "DECLARED" && calendar.value) {
    try {
      calendarFingerprint = `sha256:${new CalendarBoundaryResolver(calendar.value).fingerprint}`;
    } catch {
      /* validation records invalid calendar instead of replacing it */
    }
  }
  return freeze({
    mappingSet: r.mappingSet,
    mappingFingerprint: m.fingerprint,
    instrumentId: m.target.instrumentId,
    revisionId: m.target.revisionId,
    registrySnapshot: m.registrySnapshot,
    ownerId: m.source.ownerId,
    namespaceKey: m.source.namespaceKey,
    catalogueFingerprint: m.source.catalogueFingerprint,
    observationFingerprint: m.source.observationFingerprint,
    calendarFingerprint,
  });
}
const requirements: Record<(typeof profiles)[number], string[]> = {
  IDENTITY_METADATA: ["contract.type", "contract.family"],
  PRICE_GRID_RESEARCH: [
    "price.precision",
    "price.point",
    "price.tick",
    "price.gridOrigin",
    "price.quotation",
  ],
  VOLUME_METADATA_RESEARCH: [
    "volume.minimum",
    "volume.maximum",
    "volume.increment",
    "volume.origin",
    "volume.unit",
    "volume.minimumInclusive",
    "volume.maximumInclusive",
  ],
  CONTRACT_COMPARISON: [
    "contract.size",
    "contract.unit",
    "contract.type",
    "contract.settlement",
    "contract.quoteCurrency",
  ],
  SESSION_HISTORY: ["sessions.calendar", "sessions.effectiveFrom"],
  LIFECYCLE_HISTORY: ["lifecycle.effectiveFrom", "lifecycle.status"],
  DECLARED_MARGIN_RESEARCH: [
    "margin.mode",
    "margin.currency",
    "margin.initial",
    "margin.accountClass",
    "margin.jurisdiction",
    "margin.effectiveFrom",
    "margin.effectiveTo",
  ],
};
const profileRules: Record<(typeof profiles)[number], string[]> = {
  IDENTITY_METADATA: ["SOURCE_PROVENANCE", "SOURCE_TIME"],
  PRICE_GRID_RESEARCH: ["PRICE_PRECISION_POINT", "PRICE_TICK_REPRESENTABILITY"],
  VOLUME_METADATA_RESEARCH: ["VOLUME_BOUNDARIES", "VOLUME_GRID"],
  CONTRACT_COMPARISON: ["SOURCE_PROVENANCE", "SOURCE_TIME"],
  SESSION_HISTORY: ["SESSIONS_CALENDAR"],
  LIFECYCLE_HISTORY: ["SOURCE_TIME"],
  DECLARED_MARGIN_RESEARCH: ["MARGIN_APPLICABILITY", "MARGIN_MODE"],
};
export const completenessProfiles = freeze(
  profiles.map((profile) => ({
    profile,
    version: 1,
    required: requirements[profile],
    requiredRules: profileRules[profile],
  })),
);
const rank: Record<Classification, number> = {
  INTERNALLY_CONSISTENT: 0,
  INCOMPLETE: 1,
  UNSUPPORTED: 2,
  STALE_CONTEXT: 3,
  CONTRADICTORY: 4,
};
export function buildQualification(
  ports: EvidencePorts,
  r: Request,
  p: Policy,
  configurationFingerprint: string,
  at = mustParseUtc(ports.clock.now()),
  provenance = clockSchema.parse(safeClone(ports.clock.provenance)),
): Prepared {
  const ctx = context(ports, r, false),
    rawInputFingerprint = fingerprint(r),
    policyFingerprint = fingerprint(p),
    contextFingerprint = fingerprint(ctx);
  const normalized = structuredClone(r.metadata);
  for (const [path, f] of fields(normalized)) {
    if (decimalPaths.has(path)) {
      if (f.state === "DECLARED") f.value = decimal(f.value as string);
      if (f.alternatives) f.alternatives = f.alternatives.map((v) => decimal(v as string));
    }
    if (path.endsWith(".tiers"))
      for (const t of (f.value ?? []) as { lower: string; upper: string; increment: string }[]) {
        t.lower = decimal(t.lower);
        t.upper = decimal(t.upper);
        t.increment = decimal(t.increment);
      }
  }
  const validations: Validation[] = [];
  const add = (
    ruleId: string,
    classification: Classification,
    evidence: string[],
    explanation: string,
  ) => {
    if (validations.length >= p.maxDiagnostics) throw Error("DIAGNOSTIC_CAPACITY");
    validations.push({
      ruleId,
      ruleVersion: 1,
      inputFingerprint: rawInputFingerprint,
      classification,
      evidence,
      explanation,
      policyFingerprint,
      contextFingerprint,
    });
  };
  const v = (path: string) => value(normalized, path);
  const number = (path: string) => (v(path) === undefined ? undefined : integer(v(path) as string));
  for (const [path, f] of fields(normalized)) {
    add(
      `FIELD_${path.replaceAll(".", "_").toUpperCase()}`,
      f.state === "DECLARED"
        ? "INTERNALLY_CONSISTENT"
        : f.state === "CONTRADICTORY"
          ? "CONTRADICTORY"
          : f.state === "UNSUPPORTED"
            ? "UNSUPPORTED"
            : "INCOMPLETE",
      [path, f.evidence],
      `Source state ${f.state}; no external authentication.`,
    );
    if (
      decimalPaths.has(path) &&
      f.state === "DECLARED" &&
      !path.endsWith("Origin") &&
      !path.endsWith(".origin") &&
      !path.endsWith("samplePrice") &&
      !path.endsWith("sampleQuantity") &&
      !path.endsWith("priceLower") &&
      !path.endsWith("priceUpper")
    ) {
      const n = integer(f.value as string),
        zeroAllowed = path.startsWith("margin.");
      add(
        `POSITIVE_${path.replaceAll(".", "_").toUpperCase()}`,
        n > 0n || (zeroAllowed && n === 0n) ? "INTERNALLY_CONSISTENT" : "CONTRADICTORY",
        [path],
        zeroAllowed ? "Margin metadata must be nonnegative." : "Positive declaration required.",
      );
    }
  }
  const check = (id: string, inputs: string[], test: () => boolean, explanation: string) => {
    add(
      id,
      inputs.some((x) => v(x) === undefined)
        ? "INCOMPLETE"
        : test()
          ? "INTERNALLY_CONSISTENT"
          : "CONTRADICTORY",
      inputs,
      explanation,
    );
  };
  check(
    "PRICE_PRECISION_POINT",
    ["price.precision", "price.point"],
    () => number("price.point") === 10n ** BigInt(18 - (v("price.precision") as number)),
    "Point is exactly 10^-precision; point need not equal tick.",
  );
  check(
    "PRICE_TICK_REPRESENTABILITY",
    ["price.precision", "price.tick"],
    () => number("price.tick")! % 10n ** BigInt(18 - (v("price.precision") as number)) === 0n,
    "Tick must be representable under declared precision.",
  );
  check(
    "PRICE_GRID",
    ["price.samplePrice", "price.tick", "price.gridOrigin"],
    () =>
      aligned(
        v("price.samplePrice") as string,
        v("price.tick") as string,
        v("price.gridOrigin") as string,
      ),
    "Offline sample alignment only; never an order decision.",
  );
  check(
    "PRICE_MINIMUM_INCREMENT",
    ["price.minimumIncrement", "price.tick"],
    () => number("price.minimumIncrement") === number("price.tick"),
    "Two declared minimum increments must agree for this uniform convention.",
  );
  check(
    "VOLUME_BOUNDARIES",
    ["volume.minimum", "volume.maximum", "volume.minimumInclusive", "volume.maximumInclusive"],
    () =>
      number("volume.minimum")! < number("volume.maximum")! ||
      (number("volume.minimum") === number("volume.maximum") &&
        v("volume.minimumInclusive") === true &&
        v("volume.maximumInclusive") === true),
    "An empty or reversed quantity interval is contradictory.",
  );
  check(
    "VOLUME_GRID",
    ["volume.minimum", "volume.maximum", "volume.increment", "volume.origin"],
    () =>
      aligned(
        v("volume.minimum") as string,
        v("volume.increment") as string,
        v("volume.origin") as string,
      ) &&
      aligned(
        v("volume.maximum") as string,
        v("volume.increment") as string,
        v("volume.origin") as string,
      ),
    "Bounds must be coherent with the declared exact quantity grid.",
  );
  check(
    "VOLUME_SAMPLE",
    [
      "volume.minimum",
      "volume.maximum",
      "volume.minimumInclusive",
      "volume.maximumInclusive",
      "volume.sampleQuantity",
      "volume.increment",
      "volume.origin",
    ],
    () => {
      const x = number("volume.sampleQuantity")!,
        lo = number("volume.minimum")!,
        hi = number("volume.maximum")!;
      return (
        (x > lo || (x === lo && v("volume.minimumInclusive") === true)) &&
        (x < hi || (x === hi && v("volume.maximumInclusive") === true)) &&
        aligned(
          v("volume.sampleQuantity") as string,
          v("volume.increment") as string,
          v("volume.origin") as string,
        )
      );
    },
    "Synthetic metadata boundary check, not live sizing.",
  );
  for (const path of ["price.tiers", "volume.tiers", "margin.tiers"]) {
    const tiers = v(path) as
      | {
          lower: string;
          upper: string;
          increment: string;
          lowerInclusive: boolean;
          upperInclusive: boolean;
          unit: string;
        }[]
      | undefined;
    if (!tiers) continue;
    let valid = tiers.length > 0;
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i]!,
        prev = tiers[i - 1];
      valid &&= integer(t.lower) < integer(t.upper) && integer(t.increment) > 0n;
      if (prev)
        valid &&=
          integer(prev.upper) === integer(t.lower) &&
          prev.upperInclusive !== t.lowerInclusive &&
          prev.unit === t.unit;
    }
    add(
      `${path.split(".")[0]!.toUpperCase()}_TIER_BOUNDARIES`,
      valid ? "INTERNALLY_CONSISTENT" : "CONTRADICTORY",
      [path],
      "Contiguous ordered tiers require one inclusive shared boundary and common units.",
    );
    const unit =
      path === "volume.tiers"
        ? v("volume.unit")
        : path === "margin.tiers"
          ? v("margin.currency")
          : v("contract.quoteCurrency");
    add(
      `${path.split(".")[0]!.toUpperCase()}_TIER_UNITS`,
      unit === undefined
        ? "INCOMPLETE"
        : tiers.every((t) => t.unit === unit)
          ? "INTERNALLY_CONSISTENT"
          : "CONTRADICTORY",
      [path],
      "Tier units must equal the explicitly declared category unit.",
    );
    const sample = v(path === "price.tiers" ? "price.samplePrice" : "volume.sampleQuantity") as
      string | undefined;
    if (sample && path !== "margin.tiers") {
      const n = integer(sample),
        matches = tiers.filter(
          (t) =>
            (n > integer(t.lower) || (n === integer(t.lower) && t.lowerInclusive)) &&
            (n < integer(t.upper) || (n === integer(t.upper) && t.upperInclusive)),
        );
      add(
        `${path.split(".")[0]!.toUpperCase()}_TIER_GRID`,
        matches.length === 1 && aligned(sample, matches[0]!.increment, matches[0]!.lower)
          ? "INTERNALLY_CONSISTENT"
          : "CONTRADICTORY",
        [path],
        "Exactly one tier and an aligned sample are required.",
      );
    }
  }
  if (
    ["price.tickValue", "price.profitTickValue", "price.lossTickValue"].some(
      (x) => v(x) !== undefined,
    )
  )
    add(
      "TICK_VALUE_CURRENCY",
      v("price.tickCurrency") === undefined ? "INCOMPLETE" : "INTERNALLY_CONSISTENT",
      ["price.tickCurrency"],
      "Declared monetary values retain currency and are never externally verified.",
    );
  const quotation = v("price.quotation");
  if (quotation !== undefined)
    add(
      "PRICE_QUOTATION",
      quotation === "DECIMAL" ? "INTERNALLY_CONSISTENT" : "UNSUPPORTED",
      ["price.quotation"],
      "Only explicit decimal quotation is interpreted; other conventions remain recorded.",
    );
  const convention = v("volume.convention");
  if (convention !== undefined)
    add(
      "VOLUME_CONVENTION",
      ["DECIMAL", "UNITS", "LOTS"].includes(convention as string)
        ? "INTERNALLY_CONSISTENT"
        : "UNSUPPORTED",
      ["volume.convention"],
      "No undocumented fractional convention is inferred.",
    );
  const ownerSet = ports.mapping.snapshot(r.mappingSet);
  if (!ownerSet.ok || !ownerSet.value) throw Error("MAPPING_EVIDENCE_UNAVAILABLE");
  const original = ownerSet.value.prepared.mappings.find(
    (m) => m.fingerprint === r.mappingFingerprint,
  )!.observation.raw as Record<string, unknown>;
  for (const [path, key] of [
    ["price.precision", "digits"],
    ["price.point", "point"],
    ["price.tick", "tickSize"],
    ["price.minimumIncrement", "minimumPriceIncrement"],
    ["contract.size", "contractSize"],
    ["contract.quoteCurrency", "quoteCurrency"],
    ["contract.profitCurrency", "profitCurrency"],
    ["contract.marginCurrency", "marginCurrency"],
    ["volume.minimum", "minimumVolume"],
    ["volume.maximum", "maximumVolume"],
    ["volume.increment", "volumeStep"],
    ["volume.limit", "volumeLimit"],
    ["contract.expiry", "expiry"],
  ]) {
    if (v(path!) === undefined || original[key!] === undefined) continue;
    const same = decimalPaths.has(path!)
      ? decimal(String(v(path!))) === decimal(String(original[key!]))
      : v(path!) === original[key!];
    add(
      `SOURCE_${key!.toUpperCase()}`,
      same ? "INTERNALLY_CONSISTENT" : "CONTRADICTORY",
      [path!, ctx.observationFingerprint],
      "An enriched declaration may not silently contradict its exact upstream source observation.",
    );
  }
  const revision = ports.registry.revision(ctx.revisionId);
  if (!revision.ok || !revision.value) throw Error("CANONICAL_EVIDENCE_UNAVAILABLE");
  const identity = revision.value.definition.identity as Record<string, unknown>;
  for (const [path, key] of [
    ["contract.family", "family"],
    ["contract.venue", "venue"],
    ["contract.expiry", "expiry"],
    ["contract.maturity", "maturity"],
    ["contract.quoteCurrency", "quote"],
    ["contract.quoteCurrency", "currency"],
  ])
    if (v(path!) !== undefined && identity[key!] !== undefined)
      add(
        `IDENTITY_${key!.toUpperCase()}`,
        v(path!) === identity[key!] ? "INTERNALLY_CONSISTENT" : "CONTRADICTORY",
        [path!, ctx.revisionId],
        "Accepted canonical identity must not be contradicted by a declaration.",
      );
  for (const category of ["sessions", "lifecycle", "margin", "constraints"]) {
    const start = v(`${category}.effectiveFrom`) as string | undefined,
      end = v(`${category}.effectiveTo`) as string | undefined;
    if (start && end)
      add(
        `${category.toUpperCase()}_CHRONOLOGY`,
        start < end ? "INTERNALLY_CONSISTENT" : "CONTRADICTORY",
        [`${category}.effectiveFrom`, `${category}.effectiveTo`],
        "Effective start precedes exclusive end.",
      );
    if (start || end)
      add(
        `${category.toUpperCase()}_EFFECTIVE_TIME`,
        (start && at < start) || (end && at >= end) ? "STALE_CONTEXT" : "INTERNALLY_CONSISTENT",
        [category, at],
        "Applicability is bounded to recorded evidence and evaluation time.",
      );
  }
  for (const [a, b] of [
    ["effectiveFrom", "lastTrading"],
    ["lastTrading", "expiry"],
    ["expiry", "maturity"],
    ["effectiveFrom", "retirement"],
  ]) {
    if (v(`lifecycle.${a}`) !== undefined && v(`lifecycle.${b}`) !== undefined)
      check(
        `LIFECYCLE_${a!.toUpperCase()}_${b!.toUpperCase()}`,
        [`lifecycle.${a}`, `lifecycle.${b}`],
        () => String(v(`lifecycle.${a}`)) <= String(v(`lifecycle.${b}`)),
        "Lifecycle chronology cannot silently be repaired.",
      );
  }
  for (const name of ["expiry", "maturity"])
    if (v(`contract.${name}`) !== undefined && v(`lifecycle.${name}`) !== undefined)
      check(
        `CONTRACT_${name.toUpperCase()}`,
        [`contract.${name}`, `lifecycle.${name}`],
        () => v(`contract.${name}`) === v(`lifecycle.${name}`),
        "Contract and lifecycle declarations must agree.",
      );
  const cal = normalized.sessions.calendar;
  if (cal?.state === "DECLARED" && cal.value) {
    try {
      new CalendarBoundaryResolver(cal.value);
      const ids = new Set<string>();
      for (const session of cal.value.sessions) {
        mustParseUtc(`${session.date}T00:00:00.000Z`);
        if (!session.id || ids.has(session.id)) throw Error("SESSION_ID_CONFLICT");
        ids.add(session.id);
      }
      add(
        "SESSIONS_CALENDAR",
        cal.value.kind === "EXPLICIT_SESSION_SCHEDULE" && cal.value.sessions.length === 0
          ? "INCOMPLETE"
          : "INTERNALLY_CONSISTENT",
        [ctx.calendarFingerprint!],
        "Accepted P18 calendar authority validates schedule, timezone, folds and breaks.",
      );
    } catch {
      add(
        "SESSIONS_CALENDAR",
        "CONTRADICTORY",
        ["sessions.calendar"],
        "Accepted calendar rejects the declared timezone or schedule.",
      );
    }
  }
  if (v("sessions.weeklyTemplate") !== undefined)
    add(
      "SESSIONS_WEEKLY_TEMPLATE",
      "UNSUPPORTED",
      ["sessions.weeklyTemplate"],
      "Free-form templates are retained only; provide an accepted explicit calendar to interpret instants.",
    );
  for (const interval of normalized.sessions.maintenance?.value ?? [])
    add(
      "SESSIONS_MAINTENANCE",
      interval.start < interval.end ? "INTERNALLY_CONSISTENT" : "CONTRADICTORY",
      [interval.start, interval.end],
      "Maintenance declarations must have positive intervals.",
    );
  if (Object.keys(normalized.margin).length) {
    add(
      "MARGIN_APPLICABILITY",
      ["accountClass", "jurisdiction", "effectiveFrom", "effectiveTo", "currency", "mode"].every(
        (k) => v(`margin.${k}`) !== undefined,
      )
        ? "INTERNALLY_CONSISTENT"
        : "INCOMPLETE",
      ["margin"],
      "Missing account, jurisdiction, currency, mode or effective dates prevent applicability qualification.",
    );
    if (
      v("margin.mode") === "FIXED_AMOUNT" &&
      v("margin.maintenance") !== undefined &&
      v("margin.initial") !== undefined
    )
      check(
        "MARGIN_MAINTENANCE",
        ["margin.maintenance", "margin.initial"],
        () => number("margin.maintenance")! <= number("margin.initial")!,
        "Maintenance exceeding initial is contradictory under the recorded fixed-amount interpretation.",
      );
    if (v("margin.mode") !== undefined)
      add(
        "MARGIN_MODE",
        v("margin.mode") === "FIXED_AMOUNT" ? "INTERNALLY_CONSISTENT" : "UNSUPPORTED",
        ["margin.mode"],
        "Only fixed-amount declarations are interpreted; no margin sufficiency calculation.",
      );
    if (v("margin.currency") !== undefined && v("contract.marginCurrency") !== undefined)
      check(
        "MARGIN_CURRENCY",
        ["margin.currency", "contract.marginCurrency"],
        () => v("margin.currency") === v("contract.marginCurrency"),
        "Declared margin currencies must agree.",
      );
  }
  for (const [left, right, id] of [
    ["constraints.minimumIncrement", "price.tick", "CONSTRAINT_PRICE_INCREMENT"],
    ["constraints.quantityIncrement", "volume.increment", "CONSTRAINT_QUANTITY_INCREMENT"],
  ])
    if (v(left!) !== undefined && v(right!) !== undefined)
      check(
        id!,
        [left!, right!],
        () => number(left!) === number(right!),
        "Constraint and category declarations must agree.",
      );
  if (v("constraints.priceLower") !== undefined && v("constraints.priceUpper") !== undefined)
    check(
      "CONSTRAINT_PRICE_BOUNDS",
      ["constraints.priceLower", "constraints.priceUpper"],
      () => number("constraints.priceLower")! < number("constraints.priceUpper")!,
      "Declared price interval must be nonempty.",
    );
  for (const declaration of normalized.constraints.declarations?.value ?? [])
    add(
      "CONSTRAINT_DECLARATION",
      "UNSUPPORTED",
      [declaration.name, declaration.value],
      "Source declaration retained; no execution permission or unsupported rule interpretation.",
    );
  add(
    "SOURCE_PROVENANCE",
    r.rawEvidence.length && r.importBatchId.length ? "INTERNALLY_CONSISTENT" : "INCOMPLETE",
    [r.rawEvidence, r.importBatchId],
    "Exact request and upstream source references retained; broker authenticity remains unverified.",
  );
  add(
    "SOURCE_TIME",
    r.sourceDeclaredAt > at || Date.parse(at) - Date.parse(r.sourceDeclaredAt) > p.maxSourceAgeMs
      ? "STALE_CONTEXT"
      : "INTERNALLY_CONSISTENT",
    [r.sourceDeclaredAt, at],
    "Future or aged declarations do not establish current applicability.",
  );
  const completeness = profiles.map((profile) => {
    const required = requirements[profile],
      categories = new Set(required.map((x) => x.split(".")[0]));
    const requiredRules = profileRules[profile];
    const relevant = validations.filter(
      (x) =>
        (x.evidence.some((e) => categories.has(e.split(".")[0])) &&
          x.classification !== "INCOMPLETE") ||
        requiredRules.includes(x.ruleId) ||
        ["SOURCE_TIME", "SOURCE_PROVENANCE"].includes(x.ruleId),
    );
    let classification: Classification = required.some((path) => v(path) === undefined)
      ? "INCOMPLETE"
      : "INTERNALLY_CONSISTENT";
    for (const x of relevant)
      if (rank[x.classification] > rank[classification]) classification = x.classification;
    if (
      requiredRules.some((rule) => !validations.some((v) => v.ruleId === rule)) &&
      rank[classification] < rank.INCOMPLETE
    )
      classification = "INCOMPLETE";
    return { profile, version: 1 as const, required, requiredRules, classification };
  });
  return freeze(
    (() => {
      const body = {
        request: r,
        rawInputFingerprint,
        normalizationVersion: "S1" as const,
        normalizedFingerprint: fingerprint(normalized),
        normalized,
        policy: p,
        policyFingerprint,
        configurationFingerprint,
        evaluatedAt: at,
        clockProvenance: provenance,
        context: ctx,
        validations,
        completeness,
        qualifications: [
          "SOURCE_DECLARED",
          "UNVERIFIED_EXTERNAL_SOURCE",
          "OFFLINE_RESEARCH_ONLY",
          "NO_EXECUTION_SUITABILITY",
          "F05_F06_T01_M02_Q_HIST_Q_TICK_Q_SELECTOR_Q_T01",
          "A22_Q01_THROUGH_Q06",
          "O_C01_O_C02_Q01_A",
        ],
        tradingAuthority: false as const,
      };
      return { ...body, fingerprint: fingerprint(body) };
    })(),
  );
}
