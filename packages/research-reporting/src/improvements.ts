import { validateInsightRecord } from "@ate/research-insight-contracts";
import type { ImprovementProposal } from "@ate/research-insight-contracts";
import { array, data, object, demand, guard, freeze, digest, id } from "./validation.js";
export function projectImprovementRegister(raw: unknown, evidenceIds: readonly string[]) {
  return guard(() => {
    const rows = data(raw, 1048576, 32, 50000);
    demand(Array.isArray(rows) && rows.length <= 256, "REPORTING:BUDGET_EXHAUSTED");
    const ids = new Set<string>();
    for (const entry of array(rows)) {
      const x = object(entry);
      demand(validateInsightRecord("ImprovementProposal", x).ok);
      for (const key of ["id"]) {
        demand(typeof x[key] === "string" && Buffer.byteLength(x[key]) <= 256);
      }
      for (const key of ["hypothesis", "boundedChange", "qualificationImpact"]) {
        demand(
          typeof x[key] === "string" && Buffer.byteLength(x[key]) <= 1024,
          "REPORTING:BUDGET_EXHAUSTED",
        );
      }
      id(x.id);
      demand(typeof x.revision === "number" && Number.isSafeInteger(x.revision));
      const identity = x.id + ":" + x.revision;
      demand(!ids.has(identity), "REPORTING:EVIDENCE_IDENTITY_CONFLICT");
      ids.add(identity);
      demand(
        Array.isArray(x.evidenceIds) &&
          x.evidenceIds.every((e) => typeof e === "string" && evidenceIds.includes(e)),
        "REPORTING:EVIDENCE_UNAVAILABLE",
      );
    }
    const sorted = [...array(rows)].sort((a, b) => {
      const x = object(a),
        y = object(b);
      id(x.id);
      id(y.id);
      return x.id < y.id ? -1 : x.id > y.id ? 1 : Number(x.revision) - Number(y.revision);
    });
    return freeze({
      schema: "ate.reporting.improvements/1",
      records: sorted as unknown as readonly ImprovementProposal[],
      decisionAuthority: "NOT_ESTABLISHED_SUPPLIED_RECORDS_ONLY",
      mutationAuthority: false,
      fingerprint: digest(sorted),
    });
  });
}
