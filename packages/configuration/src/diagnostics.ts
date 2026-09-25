import { scopeIdentity } from "./scopes.js";
import type { ConfigurationSnapshot } from "./types.js";

export const scopeCounts = (
  snapshot: ConfigurationSnapshot | undefined,
): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const entry of snapshot?.entries ?? []) {
    const identity = scopeIdentity(entry.scope);
    counts[identity] = (counts[identity] ?? 0) + 1;
  }
  return counts;
};
