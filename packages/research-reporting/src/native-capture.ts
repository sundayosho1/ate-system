import type { CapturedNative, ReportingResult, NativeFamily } from "./contracts.js";
import type { JsonValue } from "@ate/research-insight-contracts";
import {
  array,
  data,
  object,
  demand,
  id,
  guard,
  known,
  unknownFact,
  freeze,
} from "./validation.js";
/** Accepted native structural Result representations are read exactly once, not plain-object tested. */
export function captureNativeEvidence(
  raw: unknown,
  family: NativeFamily,
): ReportingResult<CapturedNative> {
  return guard<CapturedNative>(() => {
    demand(["DIRECT", "DOMAIN", "COMMITMENT", "MOSE"].includes(family));
    if (family === "DIRECT")
      return freeze({
        family,
        selected: "DIRECT",
        value: raw === undefined ? null : data(raw, 1048576, 32, 50000),
        valuePresence: raw === undefined ? "UNDEFINED" : "PRESENT",
        code: unknownFact("REPORTING:DIRECT_NOT_RESULT"),
        commitment: unknownFact("REPORTING:DIRECT_NOT_RESULT"),
        auditCorrelation: unknownFact(),
        valueSemantics: "UNVERIFIED_NATIVE_CAPTURE",
      });
    demand(raw !== null && (typeof raw === "object" || typeof raw === "function"));
    const selected = (raw as { ok: unknown }).ok;
    demand(typeof selected === "boolean", "REPORTING:RESULT_INVALID");
    if (selected) {
      demand("value" in raw, "REPORTING:RESULT_INVALID");
      const v = raw.value;
      return freeze({
        family,
        selected: "SUCCESS",
        value: v === undefined ? null : data(v, 1048576, 32, 50000),
        valuePresence: v === undefined ? "UNDEFINED" : "PRESENT",
        code: unknownFact("REPORTING:NO_FAILURE"),
        commitment: unknownFact("REPORTING:NO_NATIVE_COMMITMENT"),
        auditCorrelation: unknownFact(),
        valueSemantics: "UNVERIFIED_NATIVE_CAPTURE",
      });
    }
    if (family === "DOMAIN") {
      const issues = data((raw as { issues: unknown }).issues, 1048576, 32, 50000);
      demand(Array.isArray(issues), "REPORTING:RESULT_INVALID");
      for (const entry of array(issues)) {
        const issue = object(entry);
        id(issue.code);
        demand(typeof issue.message === "string");
        if (issue.severity !== undefined)
          demand(issue.severity === "ERROR" || issue.severity === "WARNING");
        if (issue.path !== undefined)
          demand(
            Array.isArray(issue.path) &&
              issue.path.every(
                (x) => typeof x === "string" || (typeof x === "number" && Number.isSafeInteger(x)),
              ),
          );
      }
      return freeze({
        family,
        selected: "FAILURE",
        value: issues,
        valuePresence: "PRESENT",
        code: unknownFact("REPORTING:DOMAIN_ISSUES_NOT_ERROR_CODE"),
        commitment: unknownFact("REPORTING:NO_NATIVE_COMMITMENT"),
        auditCorrelation: unknownFact(),
        valueSemantics: "UNVERIFIED_NATIVE_CAPTURE",
      });
    }
    const e = (raw as { error: unknown }).error;
    demand(
      e !== null && (typeof e === "object" || typeof e === "function"),
      "REPORTING:RESULT_INVALID",
    );
    const code = (e as { code: unknown }).code,
      commitment = (e as { commitment: unknown }).commitment;
    id(code);
    demand(commitment === "NONE" || commitment === "UNKNOWN", "REPORTING:RESULT_INVALID");
    const body: Record<string, JsonValue> = { code, commitment };
    let audit = unknownFact();
    if (family === "MOSE") {
      const a = (e as { auditCorrelationId: unknown }).auditCorrelationId;
      id(a);
      body.auditCorrelationId = a;
      audit = known(a, ["native-selected-fields"]);
    }
    return freeze({
      family,
      selected: "FAILURE",
      value: body,
      valuePresence: "PRESENT",
      code: known(code, ["native-selected-fields"]),
      commitment: known(commitment, ["native-selected-fields"]),
      auditCorrelation: audit,
      valueSemantics: "UNVERIFIED_NATIVE_CAPTURE",
    });
  });
}
