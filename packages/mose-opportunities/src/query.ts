import { operationBudget } from "./validation.js";
import { keySchema, type JournalRecord, type Policy } from "./contracts.js";
import { effectivePolicy } from "./policy.js";
import { demand, freeze, guarded, object } from "./validation.js";
import { milliseconds } from "./time-policy.js";
export function queryOpportunityHistory(
  records: readonly JournalRecord[],
  raw: unknown,
  original: Policy,
  lower?: unknown,
) {
  return guarded(() => {
    const policy = effectivePolicy(original, lower),
      meter = operationBudget(policy.limits),
      q = object(meter.capture(raw));
    demand(
      Object.keys(q).every((k) => ["key", "offset", "limit", "expectedHead", "asOf"].includes(k)),
    );
    const offset = q.offset ?? 0,
      limit = q.limit ?? policy.limits.defaultPageSize;
    demand(
      typeof offset === "number" &&
        Number.isSafeInteger(offset) &&
        offset >= 0 &&
        offset <= policy.limits.maxOffset &&
        typeof limit === "number" &&
        Number.isSafeInteger(limit) &&
        limit >= 1 &&
        limit <= policy.limits.maxPageSize,
      "BUDGET_EXHAUSTED",
    );
    if (q.key !== undefined) {
      keySchema.parse(q.key);
      demand(
        typeof q.key === "string" && Buffer.byteLength(q.key) <= policy.limits.maxIdentifierBytes,
        "BUDGET_EXHAUSTED",
      );
    }
    demand(q.asOf === undefined || typeof q.asOf === "string");
    if (typeof q.asOf === "string") milliseconds(q.asOf);
    const head = records.at(-1)?.fingerprint ?? null;
    demand(q.expectedHead === undefined || q.expectedHead === head, "STALE_PREDECESSOR");
    const selected = records.filter(
      (r) =>
        (q.key === undefined || r.snapshot.key === q.key) &&
        (typeof q.asOf !== "string" ||
          milliseconds(r.details.input.knowledgeCutoff) <= milliseconds(q.asOf)),
    );
    const out = {
      schema: "ate.opportunity-page/1",
      records: selected.slice(offset, offset + limit),
      total: selected.length,
      offset,
      nextOffset: offset + limit < selected.length ? offset + limit : null,
      head,
      historicalFactsNotCurrentAuthority: true,
      currentAuthority: "UNESTABLISHED",
      tradingAuthority: false,
    };
    return freeze(meter.capture(out, policy.limits.maxOutputBytes));
  });
}
