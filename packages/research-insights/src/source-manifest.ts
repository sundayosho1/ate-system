import { ok, type DomainResult } from "@ate/domain";
import { type JsonValue } from "@ate/research-insight-contracts";
import { snapshot, issue } from "./serialization.js";
export type SourceManifest = Readonly<{
  baseline: string;
  sources: Readonly<Record<string, Readonly<{ path: string; line: number; sha256: string }>>>;
}>;
export function validateSourceManifest(raw: unknown): DomainResult<SourceManifest> {
  const r = snapshot(raw, 16777216, 16, 50000);
  if (!r.ok) return r;
  const m = r.value as unknown as SourceManifest;
  if (
    !m ||
    typeof m !== "object" ||
    Array.isArray(m) ||
    Object.keys(m).sort().join(",") !== "baseline,sources" ||
    !m.sources ||
    typeof m.sources !== "object" ||
    Array.isArray(m.sources) ||
    !/^[a-f0-9]{40}$/.test(m.baseline)
  )
    return issue("INSIGHT_SOURCE_REFERENCE_INVALID");
  for (const [id, s] of Object.entries(m.sources))
    if (
      !s ||
      typeof s !== "object" ||
      Array.isArray(s) ||
      Object.keys(s).sort().join(",") !== "line,path,sha256" ||
      !id ||
      typeof s.path !== "string" ||
      s.path.startsWith("/") ||
      s.path.includes("\\") ||
      s.path.split("/").some((p) => !p || p === ".." || p === ".") ||
      s.path.includes(":") ||
      !Number.isSafeInteger(s.line) ||
      s.line < 1 ||
      !/^sha256:[a-f0-9]{64}$/.test(s.sha256)
    )
      return issue("INSIGHT_SOURCE_REFERENCE_INVALID");
  return ok(m);
}
export function sourceReferences(refs: JsonValue, manifest: SourceManifest): boolean {
  return (
    Array.isArray(refs) &&
    refs.length > 0 &&
    refs.every((r) => typeof r === "string" && Object.hasOwn(manifest.sources, r))
  );
}
