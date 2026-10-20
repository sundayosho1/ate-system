import { inOperation, operationBudget } from "./validation.js";
import { keySchema, type JournalRecord, type Policy } from "./contracts.js";
import { O1, effectivePolicy } from "./policy.js";
import { demand, freeze, guarded, object } from "./validation.js";
import { milliseconds } from "./time-policy.js";
export function queryOpportunityHistory(
  records: readonly JournalRecord[],
  raw: unknown,
  original: Policy,
  lower?: unknown,
) {
  return inOperation(original.limits, () =>
    guarded(() => {
      // Tighten before supplied-policy capture, so its full input validation is governed too.
      // Descriptor reads neither invoke accessors nor replace the complete policy validation below.
      let inspectedCeilings: Policy["limits"] | undefined;
      if (lower !== undefined) {
        const supplied = object(lower);
        const descriptor = Object.getOwnPropertyDescriptor(supplied, "limits");
        demand(descriptor && "value" in descriptor && descriptor.enumerable);
        const limits = object(descriptor.value);
        const ceiling = { ...original.limits };
        for (const key of ["maxOperationNodes", "maxDepth", "maxRequestBytes"] as const) {
          const field = Object.getOwnPropertyDescriptor(limits, key);
          demand(field && "value" in field && field.enumerable);
          const value: unknown = field.value;
          demand(typeof value === "number" && Number.isSafeInteger(value) && value >= 1);
          ceiling[key] = Math.min(value, original.limits[key], O1[key]);
        }
        inspectedCeilings = ceiling;
        operationBudget(original.limits).tighten(ceiling);
      }
      const policy = effectivePolicy(original, lower),
        meter = operationBudget(policy.limits);
      // A changing descriptor cannot make full capture govern different resource ceilings.
      if (inspectedCeilings !== undefined) {
        for (const key of ["maxOperationNodes", "maxDepth", "maxRequestBytes"] as const)
          demand(policy.limits[key] === inspectedCeilings[key]);
      }
      const q = object(meter.capture(raw));
      demand(
        Object.keys(q).every((k) => ["key", "offset", "limit", "expectedHead", "asOf"].includes(k)),
      );
      const inherited = meter.limits;
      const pageCeiling = Math.min(policy.limits.maxPageSize, inherited.maxPageSize);
      const offset = q.offset ?? 0,
        limit =
          q.limit ??
          Math.min(policy.limits.defaultPageSize, inherited.defaultPageSize, pageCeiling);
      demand(
        typeof offset === "number" &&
          Number.isSafeInteger(offset) &&
          offset >= 0 &&
          offset <= Math.min(policy.limits.maxOffset, inherited.maxOffset) &&
          typeof limit === "number" &&
          Number.isSafeInteger(limit) &&
          limit >= 1 &&
          limit <= pageCeiling,
        "BUDGET_EXHAUSTED",
      );
      if (q.key !== undefined) {
        keySchema.parse(q.key);
        demand(
          typeof q.key === "string" &&
            Buffer.byteLength(q.key) <=
              Math.min(policy.limits.maxIdentifierBytes, inherited.maxIdentifierBytes),
          "BUDGET_EXHAUSTED",
        );
      }
      demand(q.asOf === undefined || typeof q.asOf === "string");
      if (typeof q.asOf === "string") milliseconds(q.asOf);
      const head = records.at(-1)?.fingerprint ?? null;
      demand(q.expectedHead === undefined || q.expectedHead === head, "STALE_PREDECESSOR");
      // One charged visit for every retained row, including nonmatches and offset-skipped rows.
      // Retain only the bounded output page; do not build an uncharged all-matches working list.
      const page: JournalRecord[] = [];
      let total = 0;
      for (const record of records) {
        meter.capture(0);
        if (
          (q.key === undefined || record.snapshot.key === q.key) &&
          (typeof q.asOf !== "string" ||
            milliseconds(record.details.input.knowledgeCutoff) <= milliseconds(q.asOf))
        ) {
          if (total >= offset && page.length < limit) page.push(record);
          total++;
        }
      }
      const out = {
        schema: "ate.opportunity-page/1",
        records: page,
        total,
        offset,
        nextOffset: offset + limit < total ? offset + limit : null,
        head,
        historicalFactsNotCurrentAuthority: true,
        currentAuthority: "UNESTABLISHED",
        tradingAuthority: false,
      };
      return freeze(
        meter.capture(out, Math.min(policy.limits.maxOutputBytes, inherited.maxOutputBytes)),
      );
    }),
  );
}
