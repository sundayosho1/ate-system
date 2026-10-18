import { guard, object, data, exact, id, freeze, demand } from "./validation.js";
export function explainDiagnostic(raw: unknown) {
  return guard(() => {
    const r = object(data(raw));
    exact(r, ["owner", "ownerVersion", "family", "operation", "phase", "code", "helpRefs"]);
    for (const k of ["owner", "ownerVersion", "family", "operation", "phase", "code"]) id(r[k]);
    demand(Array.isArray(r.helpRefs) && r.helpRefs.length <= 32);
    r.helpRefs.forEach(id);
    return freeze({
      namespace: [r.owner, r.ownerVersion, r.family, r.operation, r.phase, r.code]
        .map((part) => {
          id(part);
          return encodeURIComponent(part);
        })
        .join("/"),
      nativeCode: r.code,
      helpRefs: r.helpRefs,
      helpStatus: r.helpRefs.length
        ? "SOURCE_SCOPED_REFERENCES_NOT_AUTHENTICATION"
        : "HELP_UNMAPPED",
      severity: "UNESTABLISHED",
      safeNextStep:
        "Review exact source/evidence and the applicable owner runbook; no automatic refresh, retry or repair is performed.",
    });
  });
}
