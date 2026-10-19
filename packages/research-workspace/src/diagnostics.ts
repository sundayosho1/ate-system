import { axes } from "@ate/research-reporting";
import type { JsonValue } from "./contracts.js";
import { array, object, demand } from "./validation.js";
export function diagnosticRows(report: JsonValue) {
  if (report === null) return [];
  return array(object(report).facets).map((v) => {
    const f = object(v),
      facet = object(f.facet!);
    demand(axes.includes(facet.axis as (typeof axes)[number]));
    return {
      section: "DIAGNOSTICS",
      evidenceAuthentication: "SELF_HASH_ONLY_NOT_OWNER_AUTHENTICATION",
      id: facet.id!,
      owner: facet.owner!,
      prompt: object(
        array(object(object(report).request!).facets).find((x) => object(x).id === facet.id)!,
      ).prompt!,
      axis: facet.axis!,
      status: f.status!,
      reasons: f.reasons!,
      evidence: v,
      currentAuthority: "UNKNOWN",
    };
  });
}
