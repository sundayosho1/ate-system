import { fingerprint } from "@ate/configuration";
import { freeze } from "@ate/multitimeframe";
import type { Catalogue, Observation } from "./contracts.js";
import { compare } from "./normalization.js";
import type { Policy } from "./policy.js";
export type Difference = Readonly<{
  kind:
    | "ADDED"
    | "REMOVED_FROM_OBSERVED_CATALOGUE"
    | "NOT_OBSERVED_IN_PARTIAL_CATALOGUE"
    | "METADATA_CHANGED"
    | "RENAMED_BY_SOURCE_NATIVE_ID"
    | "NORMALIZATION_BECAME_AMBIGUOUS";
  before: string | null;
  after: string | null;
  fields: readonly string[];
  certainty: "DECLARED_COMPLETE_SOURCE" | "PARTIAL_OR_CROSS_NAMESPACE";
}>;
export function reconcile(before: Catalogue, after: Catalogue, p: Policy) {
  const same = before.namespaceKey === after.namespaceKey,
    complete = after.source.completeness === "COMPLETE";
  const left = new Map(before.observations.map((o) => [o.raw.rawSymbol, o])),
    right = new Map(after.observations.map((o) => [o.raw.rawSymbol, o]));
  const differences: Difference[] = [];
  const used = new Set<string>();
  const add = (d: Difference) => {
    if (differences.length >= p.maxDifferences) throw Error("RECONCILIATION_CAPACITY");
    differences.push(d);
  };
  const certainty =
    same && complete
      ? ("DECLARED_COMPLETE_SOURCE" as const)
      : ("PARTIAL_OR_CROSS_NAMESPACE" as const);
  for (const [name, old] of left) {
    let next = right.get(name),
      renamed = false;
    if (!next && same && complete && old.raw.sourceNativeId !== undefined) {
      next = after.observations.find(
        (o) => o.raw.sourceNativeId === old.raw.sourceNativeId && !left.has(o.raw.rawSymbol),
      );
      renamed = next !== undefined;
    }
    if (!next) {
      add({
        kind:
          same && complete
            ? "REMOVED_FROM_OBSERVED_CATALOGUE"
            : "NOT_OBSERVED_IN_PARTIAL_CATALOGUE",
        before: name,
        after: null,
        fields: [],
        certainty,
      });
      continue;
    }
    used.add(next.raw.rawSymbol);
    const fields = [...new Set([...Object.keys(old.raw), ...Object.keys(next.raw)])]
      .filter(
        (k) =>
          fingerprint(old.raw[k as keyof Observation["raw"]] ?? null) !==
          fingerprint(next.raw[k as keyof Observation["raw"]] ?? null),
      )
      .sort(compare);
    if (renamed)
      add({
        kind: "RENAMED_BY_SOURCE_NATIVE_ID",
        before: name,
        after: next.raw.rawSymbol,
        fields,
        certainty,
      });
    else if (fields.length)
      add({ kind: "METADATA_CHANGED", before: name, after: name, fields, certainty });
  }
  for (const [name] of right)
    if (!left.has(name) && !used.has(name))
      add({ kind: "ADDED", before: null, after: name, fields: [], certainty });
  for (const c of after.collisions)
    if (!before.collisions.some((old) => fingerprint(old) === fingerprint(c)))
      add({
        kind: "NORMALIZATION_BECAME_AMBIGUOUS",
        before: null,
        after: c.key,
        fields: [c.ruleId],
        certainty,
      });
  const content = {
    before: before.fingerprint,
    after: after.fingerprint,
    namespaceRelationship: same ? "SAME_NAMESPACE" : "CROSS_NAMESPACE",
    differences,
    metadataComparison: "SOURCE_DECLARATIONS_ONLY",
  };
  return freeze({ ...content, fingerprint: fingerprint(content) });
}
