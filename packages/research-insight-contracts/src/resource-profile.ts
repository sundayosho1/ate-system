const freeze = <T>(v: T): T => {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
};
export const R1 = freeze({
  id: "R1",
  revision: 1,
  status: "CONDITIONALLY_APPROVED_FOR_PLANNING_NOT_RUNTIME_QUALIFIED",
  byteUnit: "UTF8 bytes; KiB=1024, MiB=1048576",
  ownerCalls: {
    total: 64,
    perOwner: 8,
  },
  pages: {
    total: 32,
    perOwner: 8,
    defaultResults: 20,
    maxResults: 50,
  },
  concurrency: 1,
  request: {
    maxBytes: 65536,
    maxDepth: 16,
    maxNodes: 10000,
  },
  nativeResponse: {
    maxBytes: 1048576,
    maxDepth: 32,
    maxNodes: 50000,
  },
  report: {
    maxBytes: 4194304,
    maxEvidenceRefs: 1000,
    maxFacets: 2000,
  },
  export: {
    maxBytes: 8388608,
    maxFiles: 100,
    recursiveDiscovery: false,
  },
  knowledge: {
    maxEntries: 10000,
    maxBytes: 16777216,
    maxEntryBytes: 32768,
  },
  search: {
    maxQueryBytes: 256,
    maxTokens: 20,
    maxHits: 100,
  },
  retention: {
    maxReports: 100,
    maxBytes: 268435456,
    automaticPurge: false,
  },
  refresh: {
    enabled: false,
    minIntervalMs: 60000,
  },
  cancellation: {
    checkBeforeAfterCallPage: true,
    serializationBatchNodes: 256,
  },
  wait: {
    maxMs: 5000,
    preemptsSynchronousOwner: false,
  },
  rule: "Minimum of frozen R1, genuine supported owner bound and remaining transaction budget; unavailable owner-cost bounds deny invocation. Retries never reset budgets.",
  CODEX014CEnabledFeatures: [
    "Static catalogue validation/build/search",
    "Projection schema/semantic validation",
    "Source/approval/configuration guidance metadata",
  ],
  CODEX014CDisabledFeatures: [
    "Owner calls",
    "Owner pagination",
    "Owner refresh",
    "Native Result interpretation from running service",
    "Report persistence",
    "Artefact filesystem resolver",
    "Network listener",
    "Command dispatch",
  ],
  foundationInputScopes: {
    descriptor: "request caps apply to operation/query descriptor",
    catalogueCorpus:
      "10000 entries/16MiBtotal/32KiB perentry, supplied separately; cumulative across batches",
    derivedPerEntryValidation:
      "Depth16/10000nodes perentry, conservative additional planning restriction; subject to specification approval",
    cancellation: "Cooperative only, no synchronous event-loop preemption guarantee",
  },
} as const);
