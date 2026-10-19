export function consistency() {
  return Object.freeze({
    status: "CONSISTENCY_UNESTABLISHED",
    scope: "SUPPLIED_ARTIFACTS_ONLY",
    reason: "NO_GENERATION_PINNED_CROSS_OWNER_READ",
    ownerAuthentication: "SELF_HASH_ONLY_NOT_OWNER_AUTHENTICATION",
  });
}
