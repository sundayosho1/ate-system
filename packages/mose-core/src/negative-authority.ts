import type { Universe } from "./contracts.js";
import { classifyMember } from "./canonical.js";

// A journal fingerprint authenticates retained bytes, not a missing native Result.
// This volatile evidence is granted only after this runtime validates and acknowledges CREATE.
export const negativeAuthorityScope = (u: Universe, instrumentId: string) =>
  JSON.stringify([u.sessionId, u.fingerprint, instrumentId]);

export function unestablishedNegatives(u: Universe, authenticated: ReadonlySet<string>) {
  return u.members
    .filter(
      (m) =>
        classifyMember(m) === "CONFIRMED_EXCLUSION" &&
        !authenticated.has(negativeAuthorityScope(u, m.instrumentId)),
    )
    .map((m) => ({
      sessionId: u.sessionId,
      instrumentId: m.instrumentId,
      universeFingerprint: u.fingerprint,
      reason: "MISSING_RETAINED_NATIVE_NEGATIVE_PROVENANCE" as const,
    }));
}
