import { captureOpportunityContext } from "@ate/mose-opportunities";
import { evaluateOpportunity } from "../../packages/mose-opportunities/src/transitions.js";
import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { admitEvidence, proposalDetails } from "../../packages/mose-opportunities/src/evidence.js";
import { Budget } from "../../packages/mose-opportunities/src/validation.js";
import { recoverJournal } from "../../packages/mose-opportunities/src/recovery.js";
import { failure } from "../../packages/mose-opportunities/src/contracts.js";
import type { DecisionProposal } from "../../packages/mose-opportunities/src/contracts.js";
import { VirtualClock, mustParseUtc } from "@ate/time";
import { StateAuthorityRegistry } from "@ate/persistence";
import { OpportunityRuntime } from "../../packages/mose-opportunities/src/runtime.js";
import { MemoryOpportunityRepository } from "../../packages/mose-opportunities/src/memory-repository.js";
import {
  opportunityStateOwnership,
  defaultOpportunityPolicy as policy,
} from "../../packages/mose-opportunities/src/policy.js";
import { fingerprint } from "../../packages/mose-opportunities/src/canonical.js";
import {
  makeOpportunityKey,
  originFingerprint,
  subjectFingerprint,
  policyFingerprint,
} from "../../packages/mose-opportunities/src/identity.js";
import { metadata } from "../../packages/mose-opportunities/src/evidence.js";
import { captureOpportunityClock } from "../../packages/mose-opportunities/src/time-policy.js";
import type {
  CapturedContext,
  EvaluationInput,
  CapturedEvidence,
  TrustedHostAuthorization,
  OpportunityRepository,
} from "../../packages/mose-opportunities/src/contracts.js";
const now = mustParseUtc("2026-10-19T12:00:00.000Z");
const actor = "40000000-0000-4000-8000-000000000003";
function fixture(
  repository?: OpportunityRepository,
  grantChange?: (value: Record<string, unknown>) => void,
) {
  const clock = new VirtualClock(now, "REPLAY", "p28-fixture-clock");
  const authority = new StateAuthorityRegistry(clock);
  const registered = authority.register(opportunityStateOwnership());
  if (!registered.ok) throw Error("authority fixture failed");
  const repositoryValue = repository ?? new MemoryOpportunityRepository("fixture-root");
  const hash = "sha256:" + "1".repeat(64);
  const origin = {
    owner: "@ate/market-replay",
    version: "0.19.0-market-replay.1",
    namespace: "offline",
    runtimeId: "replay",
    manifestId: "manifest",
    manifestFingerprint: hash.slice(7),
    inputFingerprint: hash.slice(7),
    sourceScope: "fixture",
  };
  const subject = {
    researchSessionId: "session",
    universeSnapshotId: "universe",
    universeFingerprint: hash,
    canonicalInstrumentId: "instrument",
    registryGeneration: 1,
    registryFingerprint: hash,
    sourceOriginFingerprint: originFingerprint(origin),
    calendarFingerprint: "2".repeat(64),
    timeframes: ["M1"],
    hypothesisRef: null,
    watchDeclarationId: "watch",
    lifecycleGeneration: 1,
    predecessorGenerationKey: null,
  };
  const native = {
    watchDeclarationId: "watch",
    subjectFingerprint: subjectFingerprint(subject),
    policyFingerprint: policyFingerprint(policy),
    sourceOriginFingerprint: subject.sourceOriginFingerprint,
  };
  const e: CapturedEvidence = {
    owner: "@ate/mose-opportunities",
    ownerVersion: "0.28.0-opportunity-state.1",
    namespace: "declarations",
    runtimeId: "runtime",
    recordId: "watch-record",
    generation: 1,
    fingerprint: fingerprint("ate.opportunity-native/1", native),
    sourceOriginFingerprint: subject.sourceOriginFingerprint,
    subjectFingerprint: subjectFingerprint(subject),
    policyFingerprint: policyFingerprint(policy),
    eventAt: now,
    availableAt: now,
    qualityReferences: [],
    finality: "NOT_APPLICABLE",
    correctionOf: null,
    nativeResultStatus: "ACK",
    originalReceiptRef: null,
    family: "DECLARATION",
    native: { ok: true, value: native },
  };
  const capture = { origin, evidence: [e], scanner: null };
  const context: CapturedContext = {
    schema: "ate.opportunity-context/1",
    historicalState: null,
    previousEventFingerprint: null,
    subject,
    sourceManifestRef: "manifest",
    policyRef: policy.id,
    predicateManifests: [],
    actorEvidenceRef: actor,
    scopeConsistencyEvidenceRef: "fixture-bounded-scope",
    nativeEvidenceRefs: [metadata(e)],
    trustedCaptureRef: "fixture",
  };
  const input: EvaluationInput = {
    schema: "ate.opportunity-evaluate/1",
    key: makeOpportunityKey(subject, policy, origin),
    commandId: "birth",
    actorAuthorityRef: actor,
    configurationReleaseRef: "configuration",
    expectedHead: null,
    requestedState: "DORMANT",
    capturedClock: captureOpportunityClock(clock),
    decisionCutoff: now,
    knowledgeCutoff: now,
    policyFingerprint: policyFingerprint(policy),
    evidence: [metadata(e)],
    consistency: "ESTABLISHED_SCOPE",
    authorityBasis: "HISTORICAL_AS_KNOWN",
  };
  // Synthetic trusted-host test double, not an independent certificate or scientific validation.
  // Production composition must supply a genuinely reviewed authority/evidence verifier.
  const host: TrustedHostAuthorization = {
    reviewReference: "synthetic-test-host",
    captures: { fixture: capture },
    verify(request) {
      const value = {
        ...request,
        actor: { actorType: "USER", actorId: actor },
        issuerRef: "test-issuer",
        approvalReferences: ["configuration"],
        issuedAt: now,
        expiresAt: "2026-10-19T13:00:00.000Z",
        scope: "HISTORICAL_RESEARCH" as const,
      };
      grantChange?.(value);
      return { ok: true, value };
    },
  };
  const runtime = new OpportunityRuntime(repositoryValue, clock, authority, host);
  return { runtime, repository: repositoryValue, clock, authority, host, context, input, capture };
}

// Independent test oracle: no production canonicalization or fingerprint helper.
function oracle(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(oracle).join(",") + "]";
  const row = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(row)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + oracle(row[k]))
      .join(",") +
    "}"
  );
}
const digest = (domain: string, value: unknown) =>
  "sha256:" +
  createHash("sha256")
    .update(domain + "\n" + oracle(value))
    .digest("hex");
function take<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
}
function install(f: ReturnType<typeof fixture>, refs: CapturedEvidence[]) {
  f.capture.evidence = refs;
  f.context.nativeEvidenceRefs = refs.map(metadata);
  f.input.evidence = refs.map(metadata);
}
function tied(f: ReturnType<typeof fixture>, dimension: "runtimeId" | "generation", count = 2) {
  const original = f.capture.evidence[0]!;
  return Array.from({ length: count }, (_, i) => ({
    ...structuredClone(original),
    ...(dimension === "runtimeId" ? { runtimeId: "source-" + i } : { generation: 17 + i }),
  }));
}
function evaluate(f: ReturnType<typeof fixture>) {
  return evaluateOpportunity(
    f.input,
    captureOpportunityContext(f.context, f.capture, policy),
    policy,
  );
}
function permutations<T>(values: T[]): T[][] {
  if (!values.length) return [[]];
  return values.flatMap((v, i) =>
    permutations(values.filter((_, j) => j !== i)).map((p) => [v, ...p]),
  );
}
function expectedEvent(proposal: DecisionProposal) {
  const d = proposalDetails(proposal);
  const { eventFingerprint: ignored, ...body } = proposal;
  void ignored;
  return digest("ate.opportunity-event/1", {
    key: d.input.key,
    sequence: (d.context.historicalState?.head.eventSequence ?? 0) + 1,
    previousEventFingerprint: d.context.previousEventFingerprint,
    commandId: d.input.commandId,
    payloadFingerprint: digest("ate.opportunity-payload/1", {
      ...body,
      input: d.input,
      context: d.context,
      capture: d.capture,
      policy: d.policy,
    }),
    policyFingerprint: d.input.policyFingerprint,
    decisionCutoff: d.input.decisionCutoff,
  });
}
for (const dimension of ["runtimeId", "generation"] as const) {
  for (const order of permutations([0, 1, 2, 3])) {
    it(`${dimension} permutation ${order.join("")} preserves complete evidence and event identity`, () => {
      const f = fixture();
      const refs = tied(f, dimension, 4);
      install(f, refs);
      const first = take(evaluate(f));
      const before = structuredClone({ input: f.input, context: f.context, capture: f.capture });
      install(
        f,
        order.map((i) => refs[i]!),
      );
      const reorderedBefore = structuredClone({
        input: f.input,
        context: f.context,
        capture: f.capture,
      });
      const second = take(evaluate(f));
      expect(second.eventFingerprint).toBe(first.eventFingerprint);
      expect(digest("evidence", second.evidence)).toBe(digest("evidence", first.evidence));
      expect(second.evidence).toHaveLength(4);
      expect(second.eventFingerprint).toBe(expectedEvent(second));
      expect({ input: f.input, context: f.context, capture: f.capture }).toEqual(reorderedBefore);
      expect(new Set(before.capture.evidence.map((e) => oracle(e))).size).toBe(4);
    });
  }
  it(`${dimension} equivalent retry returns original ACK without authority renewal or second record`, async () => {
    let grants = 0;
    const f = fixture(undefined, () => {
      grants++;
    });
    install(f, tied(f, dimension));
    take(await f.runtime.initialize());
    const proposal = take(evaluate(f));
    const ack = take(await f.runtime.commit(proposal));
    const before = take(await f.repository.load());
    const calls = grants;
    install(f, [...f.capture.evidence].reverse());
    const retry = take(evaluate(f));
    expect(take(await f.runtime.commit(retry))).toEqual(ack);
    expect(grants).toBe(calls);
    expect(take(await f.repository.load())).toEqual(before);
    expect(before).toHaveLength(1);
    const recovered = recoverJournal(before, f.repository.root, policy);
    expect(recovered).toEqual(before);
    expect(recovered[0]?.snapshot.state).toBe("DORMANT");
    expect(recovered[0]?.journalGeneration).toBe(1);
  });
}
it("same-identity exact duplicate keeps existing idempotent reference semantics", () => {
  const f = fixture();
  const one = take(evaluate(f));
  const original = f.capture.evidence[0]!;
  install(f, [original, structuredClone(original)]);
  const two = take(evaluate(f));
  expect(two.evidence).toHaveLength(1);
  expect(two.eventFingerprint).toBe(one.eventFingerprint);
});
for (const field of ["qualityReferences", "originalReceiptRef", "availableAt"] as const) {
  it(`contradictory same immutable identity ${field} is not deduplicated away`, () => {
    const f = fixture();
    const a = f.capture.evidence[0]!;
    const b = structuredClone(a);
    if (field === "qualityReferences") b.qualityReferences = ["other-quality"];
    if (field === "originalReceiptRef") b.originalReceiptRef = "different-receipt";
    if (field === "availableAt") b.availableAt = "2026-10-19T11:59:59.000Z";
    install(f, [a, b]);
    expect(evaluate(f)).toMatchObject({ ok: false, error: { code: "OPP:IMMUTABLE_CONFLICT" } });
  });
}
for (const dimension of ["runtimeId", "generation"] as const) {
  it(`${dimension} materially different evidence retains genuine command conflict`, async () => {
    const f = fixture();
    take(await f.runtime.initialize());
    install(f, tied(f, dimension));
    take(await f.runtime.commit(take(evaluate(f))));
    const before = take(await f.repository.load());
    install(f, f.capture.evidence.slice(0, 1));
    expect(await f.runtime.commit(take(evaluate(f)))).toMatchObject({
      ok: false,
      error: { code: "OPP:COMMAND_CONFLICT" },
    });
    expect(take(await f.repository.load())).toEqual(before);
  });
}
for (const field of [
  "eventAt",
  "availableAt",
  "originalReceiptRef",
  "qualityReferences",
] as const) {
  it(`meaningful ${field} change retains payload and event sensitivity`, () => {
    const f = fixture();
    const before = take(evaluate(f));
    const ref = structuredClone(f.capture.evidence[0]!);
    if (field === "eventAt") ref.eventAt = "2026-10-19T11:59:59.000Z";
    if (field === "availableAt") ref.availableAt = "2026-10-19T11:59:59.000Z";
    if (field === "originalReceiptRef") ref.originalReceiptRef = "receipt-1";
    if (field === "qualityReferences") ref.qualityReferences = ["quality-a", "quality-b"];
    install(f, [ref]);
    const after = take(evaluate(f));
    expect(after.eventFingerprint).not.toBe(before.eventFingerprint);
  });
}
it("ordered quality lineage within a reference is not recursively sorted", () => {
  const f = fixture();
  const ref = structuredClone(f.capture.evidence[0]!);
  ref.qualityReferences = ["quality-a", "quality-b"];
  install(f, [ref]);
  const first = take(evaluate(f));
  install(f, [{ ...ref, qualityReferences: [...ref.qualityReferences].reverse() }]);
  expect(take(evaluate(f)).eventFingerprint).not.toBe(first.eventFingerprint);
});
for (const namespace of [
  "@ate/multitimeframe",
  "@ate/market-replay",
  "@ate/instrument-registry",
  "@ate/mose-core",
]) {
  it(`does not grant ${namespace} authority to a relabeled declaration`, () => {
    const f = fixture();
    install(f, [{ ...f.capture.evidence[0]!, owner: namespace }]);
    expect(evaluate(f).ok).toBe(false);
  });
}
it("native replay-origin fingerprints remain bare and unchanged through normalization and recovery", async () => {
  const f = fixture();
  const origin = structuredClone(f.capture.origin);
  install(f, tied(f, "runtimeId"));
  take(await f.runtime.initialize());
  const p = take(evaluate(f));
  expect(proposalDetails(p).capture.origin).toEqual(origin);
  expect(origin.manifestFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  expect(origin.inputFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  take(await f.runtime.commit(p));
  const records = recoverJournal(take(await f.repository.load()), f.repository.root, policy);
  expect(records[0]?.details.capture.origin).toEqual(origin);
});
it("missing references never establish an admitted watch", () => {
  const f = fixture();
  install(f, []);
  expect(evaluate(f).ok).toBe(false);
});
it("malformed and getter-backed references reject without executing caller accessors", () => {
  const f = fixture();
  let reads = 0;
  const e = structuredClone(f.capture.evidence[0]!);
  Object.defineProperty(e, "runtimeId", {
    enumerable: true,
    get() {
      reads++;
      return "forged";
    },
  });
  f.capture.evidence = [e];
  expect(() => captureOpportunityContext(f.context, f.capture, policy)).toThrow();
  expect(reads).toBe(0);
});
it("oversized evidence fails before any publication", async () => {
  const f = fixture();
  install(f, tied(f, "generation", policy.limits.maxEvidenceRefs + 1));
  take(await f.runtime.initialize());
  expect(() => captureOpportunityContext(f.context, f.capture, policy)).toThrow();
  expect(take(await f.repository.load())).toEqual([]);
});
it("admission charges each supplied reference cumulatively including duplicates", () => {
  const f = fixture();
  const ref = f.capture.evidence[0]!;
  const count = (v: unknown): number =>
    v !== null && typeof v === "object"
      ? 1 +
        (Array.isArray(v) ? v : Object.values(v)).reduce<number>(
          (n, child: unknown) => n + count(child),
          0,
        )
      : 1;
  const cost = count(metadata(ref));
  install(f, [ref, structuredClone(ref)]);
  const meter = new Budget({ ...policy.limits, maxOperationNodes: cost * 2 });
  expect(admitEvidence(f.input, f.context, f.capture, policy, meter)).toHaveLength(1);
  expect(meter.nodes).toBe(cost * 2);
  const short = new Budget({ ...policy.limits, maxOperationNodes: cost * 2 - 1 });
  expect(() => admitEvidence(f.input, f.context, f.capture, policy, short)).toThrow(
    "BUDGET_EXHAUSTED",
  );
});
it("cloned unproved proposal cannot use equivalent evidence to gain commit authority", async () => {
  const f = fixture();
  install(f, tied(f, "runtimeId"));
  take(await f.runtime.initialize());
  expect((await f.runtime.commit(structuredClone(take(evaluate(f))))).ok).toBe(false);
  expect(take(await f.repository.load())).toEqual([]);
});
it("changed event predecessor is distinct from physical journal ACK", async () => {
  const f = fixture();
  take(await f.runtime.initialize());
  const p = take(evaluate(f));
  const ack = take(await f.runtime.commit(p));
  expect(ack.fingerprint).not.toBe(p.eventFingerprint);
  const records = recoverJournal(take(await f.repository.load()), f.repository.root, policy);
  const record = records[0]!;
  const { fingerprint: omitted, ...body } = record;
  const { fingerprint: headOmitted, ...head } = record.snapshot.head;
  void omitted;
  void headOmitted;
  expect(
    digest("ate.opportunity-journal/1", { ...body, snapshot: { ...record.snapshot, head } }),
  ).toBe(ack.fingerprint);
  expect(() => recoverJournal([...records, ...records], f.repository.root, policy)).toThrow();
  expect(() =>
    recoverJournal([{ ...record, journalGeneration: 2 }], f.repository.root, policy),
  ).toThrow();
});
it("absence of a reviewed host remains fail-closed for canonical equivalent inputs", async () => {
  const f = fixture();
  install(f, tied(f, "runtimeId"));
  const runtime = new OpportunityRuntime(f.repository, f.clock, f.authority);
  take(await runtime.initialize());
  expect(runtime.evaluate(f.input, f.context).ok).toBe(false);
  expect(take(await f.repository.load())).toEqual([]);
});
for (const mode of ["NONE", "UNKNOWN", "ACK_THEN_THROW"] as const) {
  it(`${mode} publication preserves uncertainty and never invents a reordered retry ACK`, async () => {
    const memory = new MemoryOpportunityRepository("uncertain-root");
    const repository: OpportunityRepository = {
      root: memory.root,
      storageMode: memory.storageMode,
      load: () => memory.load(),
      async compareAppend(record) {
        if (mode === "ACK_THEN_THROW") {
          take(await memory.compareAppend(record));
          throw Error("interrupted after physical publication");
        }
        return failure("REPOSITORY_REJECTED", mode, record.operationId);
      },
    };
    const f = fixture(repository);
    install(f, tied(f, "generation"));
    take(await f.runtime.initialize());
    const p = take(evaluate(f));
    expect(await f.runtime.commit(p)).toMatchObject({
      ok: false,
      error: { commitment: mode === "NONE" ? "NONE" : "UNKNOWN" },
    });
    install(f, [...f.capture.evidence].reverse());
    expect(take(evaluate(f)).eventFingerprint).toBe(p.eventFingerprint);
    const retained = take(await memory.load());
    expect(retained).toHaveLength(mode === "ACK_THEN_THROW" ? 1 : 0);
    if (mode === "ACK_THEN_THROW") {
      expect(take(await f.runtime.recover(f.input.commandId)).fingerprint).toBe(
        recoverJournal(retained, memory.root, policy)[0]?.fingerprint,
      );
    } else if (mode === "UNKNOWN") {
      expect((await f.runtime.shutdown()).ok).toBe(false);
    }
  });
}

// Legacy producer fixture: authenticate and execute the original 18-source implementation
// in an isolated CommonJS module cache. No current normalizer fabricates historical ACKs.
import { beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import * as legacyDomain from "@ate/domain";
import * as legacyTime from "@ate/time";
import * as legacyPersistence from "@ate/persistence";
import * as legacyConfiguration from "@ate/configuration";
import * as legacyCore from "@ate/mose-core";
import * as legacyAttention from "@ate/mose-attention";
import * as legacyScanner from "@ate/mose-scanner";
import * as legacyRegistry from "@ate/instrument-registry";
import * as legacyZod from "zod";
import { FilesystemOpportunityRepository } from "@ate/mose-opportunities";
import { createOpportunityPolicy } from "../../packages/mose-opportunities/src/policy.js";
import { makeJournalRecord } from "../../packages/mose-opportunities/src/journal.js";
import { isVerifiedLegacyRecord } from "../../packages/mose-opportunities/src/recovery.js";
import { inOperation } from "../../packages/mose-opportunities/src/validation.js";
import type {
  JournalRecord,
  Policy,
  CommitAck,
  ProposalDetails,
  NativeCapture,
} from "../../packages/mose-opportunities/src/contracts.js";

import type * as LegacyOpportunityTypes from "@ate/mose-opportunities";
import { success as legacySuccess } from "../../packages/mose-opportunities/src/contracts.js";
type LegacyAPI = Pick<
  typeof LegacyOpportunityTypes,
  | "OpportunityRuntime"
  | "FilesystemOpportunityRepository"
  | "captureOpportunityContext"
  | "evaluateOpportunity"
>;
const legacyProducer = "6103ca13670d6a75f85b03c24bec567f86a5e467";
const legacySources = [
  "canonical.ts",
  "contracts.ts",
  "diagnostics.ts",
  "evidence.ts",
  "filesystem-repository.ts",
  "handover.ts",
  "identity.ts",
  "index.ts",
  "journal.ts",
  "memory-repository.ts",
  "policy.ts",
  "predicates.ts",
  "query.ts",
  "recovery.ts",
  "runtime.ts",
  "time-policy.ts",
  "transitions.ts",
  "validation.ts",
];
function originalLegacyProducer(): LegacyAPI {
  const sources = new Map<string, string>();
  const hash = createHash("sha256");
  for (const name of legacySources) {
    const bytes = execFileSync("git", [
      "show",
      `${legacyProducer}:packages/mose-opportunities/src/${name}`,
    ]);
    hash
      .update(name + "\n")
      .update(bytes)
      .update("\n");
    sources.set(name.replace(/\.ts$/u, ".js"), bytes.toString("utf8"));
  }
  expect(hash.digest("hex")).toBe(
    "1b5473c00c38da6d650f562356bd0fedb8a25b3a55428bfbf3b589dcddc24626",
  );
  const publicOwners: Readonly<Record<string, unknown>> = {
    "@ate/domain": legacyDomain,
    "@ate/time": legacyTime,
    "@ate/persistence": legacyPersistence,
    "@ate/configuration": legacyConfiguration,
    "@ate/mose-core": legacyCore,
    "@ate/mose-attention": legacyAttention,
    "@ate/mose-scanner": legacyScanner,
    "@ate/instrument-registry": legacyRegistry,
    zod: legacyZod,
  };
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const native = createRequire(import.meta.url);
  const builtins = new Set([
    "node:crypto",
    "node:async_hooks",
    "node:fs",
    "node:fs/promises",
    "node:path",
  ]);
  const load = (name: string): unknown => {
    if (Object.hasOwn(publicOwners, name)) return publicOwners[name];
    if (builtins.has(name)) {
      const value: unknown = native(name);
      return value;
    }
    if (!name.startsWith("./")) throw Error("Unreviewed original producer import: " + name);
    const file = name.slice(2);
    const existing = cache.get(file);
    if (existing) return existing.exports;
    const source = sources.get(file);
    if (source === undefined) throw Error("Original producer source missing: " + file);
    const module = { exports: {} as Record<string, unknown> };
    cache.set(file, module);
    const javascript = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
    }).outputText;
    const execute: unknown = runInThisContext(
      "(function(require,module,exports){\n" + javascript + "\n})",
      { filename: "authenticated-original-p28-" + file },
    );
    if (typeof execute !== "function") throw Error("Original module wrapper missing");
    Reflect.apply(execute, undefined, [load, module, module.exports]);
    return module.exports;
  };
  const api = load("./index.js");
  if (api === null || typeof api !== "object") throw Error("Original producer exports missing");
  for (const name of [
    "OpportunityRuntime",
    "FilesystemOpportunityRepository",
    "captureOpportunityContext",
    "evaluateOpportunity",
  ])
    if (typeof Reflect.get(api, name) !== "function")
      throw Error("Original export missing: " + name);
  // Byte authentication plus the checked original root exports establish this old API subset.
  return api as LegacyAPI;
}
interface LegacyHistory {
  reverse: boolean;
  root: string;
  policy: Policy;
  ack: CommitAck;
  records: readonly JournalRecord[];
  physicalBytes: string;
}
const legacyHistories: LegacyHistory[] = [];
const legacyDirectories: string[] = [];
function legacyObject(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw Error("Expected inert fixture object");
  return raw as Record<string, unknown>;
}
function legacySet(target: object, key: string, value: unknown) {
  expect(Reflect.set(target, key, value)).toBe(true);
}
function legacyAnchor(h: LegacyHistory) {
  return {
    root: h.root,
    sourceImplementation: legacyProducer,
    journalGeneration: h.ack.journalGeneration,
    journalFingerprint: h.ack.fingerprint,
    issuerRef: "synthetic-original-receipt-custodian",
    approvalReference: "scoped-offline-lab",
    acknowledgementProofRef: "authenticated-original-runtime-ACK-and-physical-bytes",
  };
}
function legacyHost(h?: LegacyHistory, change?: (a: ReturnType<typeof legacyAnchor>) => void) {
  let mutationGrants = 0,
    prefixVerifications = 0;
  const host: TrustedHostAuthorization = {
    reviewReference: "synthetic-offline-original-receipt-verifier-not-production-certification",
    captures: {},
    verify(request) {
      mutationGrants++;
      return {
        ok: true,
        value: {
          ...request,
          actor: { actorType: "USER", actorId: request.principalRef },
          issuerRef: "synthetic-test-issuer",
          approvalReferences: ["configuration"],
          issuedAt: "2026-10-19T11:00:00.000Z",
          expiresAt: "2026-10-19T14:00:00.000Z",
          scope: "HISTORICAL_RESEARCH",
        },
      };
    },
    ...(h === undefined
      ? {}
      : {
          verifyLegacyJournalPrefix() {
            prefixVerifications++;
            const anchor = legacyAnchor(h);
            change?.(anchor);
            return { ok: true as const, value: anchor };
          },
        }),
  };
  return { host, counts: () => ({ mutationGrants, prefixVerifications }) };
}
beforeAll(async () => {
  const old = originalLegacyProducer();
  for (const reverse of [false, true]) {
    const f = fixture();
    const governing = take(createOpportunityPolicy({ ...policy, filesystemEnabled: true }));
    const first = structuredClone(f.capture.evidence[0]!);
    first.policyFingerprint = policyFingerprint(governing);
    const value = legacyObject(legacyObject(first.native).value);
    legacySet(value, "policyFingerprint", first.policyFingerprint);
    first.fingerprint = digest("ate.opportunity-native/1", value);
    const second = structuredClone(first);
    first.runtimeId = "legacy-source-A";
    second.runtimeId = "legacy-source-B";
    const refs = reverse ? [second, first] : [first, second];
    const capture: NativeCapture = { ...f.capture, evidence: refs };
    const context = { ...f.context, nativeEvidenceRefs: refs.map(metadata) };
    const input = {
      ...f.input,
      key: makeOpportunityKey(context.subject, governing, capture.origin),
      policyFingerprint: policyFingerprint(governing),
      evidence: refs.map(metadata),
    };
    const root = mkdtempSync(join(tmpdir(), "p28-authenticated-legacy-"));
    legacyDirectories.push(root);
    const repository = new old.FilesystemOpportunityRepository(root, governing);
    const runtime = new old.OpportunityRuntime(
      repository,
      f.clock,
      f.authority,
      legacyHost().host,
      governing,
    );
    take(await runtime.initialize());
    const p = take(
      old.evaluateOpportunity(
        input,
        old.captureOpportunityContext(context, capture, governing),
        governing,
      ),
    );
    const ack = take(await runtime.commit(p));
    const raw = take(await repository.load());
    // This is the exact old record physically acknowledged by the authenticated original runtime.
    const physicalBytes = readFileSync(join(root, "journal-00000001.json"), "utf8");
    expect(oracle(raw)).toBe("[" + physicalBytes + "]");
    const oldRecords: unknown = JSON.parse(physicalBytes);
    expect(oldRecords).toEqual(raw[0]);
    const decoded = legacyObject(oldRecords);
    expect(decoded.fingerprint).toBe(ack.fingerprint);
    // Original runtime query returns the validated immutable record; structure is unchanged in P28.
    const record = oldRecords as JournalRecord;
    legacyHistories.push({
      reverse,
      root,
      policy: governing,
      ack,
      records: [record],
      physicalBytes,
    });
  }
});
afterAll(() => {
  for (const path of legacyDirectories) rmSync(path, { recursive: true, force: true });
});
function legacyFresh(
  h: LegacyHistory,
  host: TrustedHostAuthorization,
  mode: "NONE" | "UNKNOWN" = "NONE",
) {
  let appendCalls = 0;
  const f = fixture();
  const repository: OpportunityRepository = {
    root: h.root,
    storageMode: "OFFLINE_FILESYSTEM",
    load: () => Promise.resolve(legacySuccess(structuredClone(h.records))),
    compareAppend() {
      appendCalls++;
      return Promise.resolve(failure("REPOSITORY_REJECTED", mode));
    },
  };
  return {
    runtime: new OpportunityRuntime(repository, f.clock, f.authority, host, h.policy),
    appendCalls: () => appendCalls,
  };
}
function legacyProposal(h: LegacyHistory, change?: (d: ProposalDetails) => void) {
  const d = structuredClone(h.records[0]!.details);
  change?.(d);
  return evaluateOpportunity(
    d.input,
    captureOpportunityContext(d.context, d.capture, d.policy),
    d.policy,
  );
}
function legacySync(d: ProposalDetails) {
  d.context.nativeEvidenceRefs = d.capture.evidence.map(metadata);
  d.input.evidence = d.capture.evidence.map(metadata);
}
for (const reverse of [false, true]) {
  it(`L01 authenticated original history preserved reverse=${reverse}`, () => {
    const h = legacyHistories.find((row) => row.reverse === reverse)!;
    const records = recoverJournal(h.records, h.root, h.policy, legacyHost(h).host);
    expect(records).toEqual(h.records);
    expect(oracle(records)).toBe(oracle(h.records));
    expect(records.every(isVerifiedLegacyRecord)).toBe(true);
    expect(readFileSync(join(h.root, "journal-00000001.json"), "utf8")).toBe(h.physicalBytes);
  });
  it(`L02 equivalent legacy retry returns original ACK without writer or new mutation authority reverse=${reverse}`, async () => {
    const h = legacyHistories.find((row) => row.reverse === reverse)!,
      v = legacyHost(h),
      f = legacyFresh(h, v.host);
    take(await f.runtime.initialize());
    const calls = v.counts().mutationGrants;
    const p = take(
      legacyProposal(h, (d) => {
        legacySet(d.capture, "evidence", [...d.capture.evidence].reverse());
        legacySync(d);
      }),
    );
    expect(take(await f.runtime.commit(p))).toEqual(h.ack);
    expect(v.counts().mutationGrants).toBe(calls);
    expect(f.appendCalls()).toBe(0);
    const page = take(f.runtime.query({}));
    expect(legacyObject(page).records).toHaveLength(1);
    expect(f.runtime.diagnostics()).toMatchObject({
      ok: true,
      value: { currentReadiness: "NOT_READY" },
    });
  });
  it(`L03 repeated restart/recovery preserves classification reverse=${reverse}`, async () => {
    const h = legacyHistories.find((row) => row.reverse === reverse)!;
    for (let i = 0; i < 3; i++) {
      const f = legacyFresh(h, legacyHost(h).host);
      take(await f.runtime.initialize());
      expect(take(await f.runtime.commit(take(legacyProposal(h))))).toEqual(h.ack);
      expect(f.appendCalls()).toBe(0);
      take(await f.runtime.shutdown());
    }
  });
}
for (const field of [
  "configurationReleaseRef",
  "requestedState",
  "scopeConsistencyEvidenceRef",
  "trustedCaptureRef",
  "decisionCutoff",
  "originalReceiptRef",
  "qualityReferences",
  "runtimeId",
] as const)
  it(`L04 material change ${field} remains conflict or denied`, async () => {
    const h = legacyHistories[1]!,
      v = legacyHost(h),
      f = legacyFresh(h, v.host);
    take(await f.runtime.initialize());
    const p = legacyProposal(h, (d) => {
      if (field === "configurationReleaseRef") d.input.configurationReleaseRef = "different-config";
      else if (field === "requestedState") d.input.requestedState = "QUALIFIED";
      else if (field === "scopeConsistencyEvidenceRef")
        d.context.scopeConsistencyEvidenceRef = "different-scope";
      else if (field === "trustedCaptureRef") d.context.trustedCaptureRef = "different-capture";
      else if (field === "decisionCutoff") d.input.decisionCutoff = "2026-10-19T11:59:59.000Z";
      else {
        const e = d.capture.evidence[0]!;
        legacySet(e, field, field === "qualityReferences" ? ["different-quality"] : "different");
        legacySync(d);
      }
    });
    const result = p.ok ? await f.runtime.commit(p.value) : p;
    expect(result.ok).toBe(false);
    expect(f.appendCalls()).toBe(0);
    expect(v.counts().mutationGrants).toBe(0);
  });
for (const field of [
  "root",
  "sourceImplementation",
  "journalGeneration",
  "journalFingerprint",
  "issuerRef",
  "approvalReference",
  "acknowledgementProofRef",
] as const)
  it(`L05 wrong trusted-prefix binding ${field} fails closed`, () => {
    const h = legacyHistories[1]!,
      v = legacyHost(h, (a) => {
        legacySet(
          a,
          field,
          field === "journalGeneration"
            ? 2
            : field === "journalFingerprint"
              ? "sha256:" + "0".repeat(64)
              : field === "root"
                ? "another-root"
                : "",
        );
      });
    expect(() => recoverJournal(h.records, h.root, h.policy, v.host)).toThrow();
  });
for (const kind of [
  "missing-verifier",
  "UNKNOWN",
  "NONE",
  "throws",
  "malformed",
  "getter",
  "unreviewed",
] as const)
  it(`L06 ${kind} cannot authenticate legacy ordering`, () => {
    const h = legacyHistories[1]!,
      v = legacyHost(h);
    if (kind === "missing-verifier")
      expect(Reflect.deleteProperty(v.host, "verifyLegacyJournalPrefix")).toBe(true);
    if (kind === "UNKNOWN" || kind === "NONE")
      legacySet(v.host, "verifyLegacyJournalPrefix", () => ({
        ok: false,
        error: { code: "NO_AUTHORITY", commitment: kind },
      }));
    if (kind === "throws")
      legacySet(v.host, "verifyLegacyJournalPrefix", () => {
        throw Error("verifier unavailable");
      });
    if (kind === "malformed")
      legacySet(v.host, "verifyLegacyJournalPrefix", () => ({ ok: null, value: {} }));
    if (kind === "getter")
      legacySet(v.host, "verifyLegacyJournalPrefix", () => ({
        ok: true,
        value: Object.defineProperty({}, "root", {
          enumerable: true,
          get() {
            throw Error("hostile");
          },
        }),
      }));
    if (kind === "unreviewed") legacySet(v.host, "reviewReference", "");
    expect(() => recoverJournal(h.records, h.root, h.policy, v.host)).toThrow();
  });
for (const field of [
  "fingerprint",
  "commandFingerprint",
  "proposal",
  "previous",
  "journalGeneration",
  "snapshot",
  "native",
  "missing-generation",
] as const)
  it(`L07 malformed/forged record ${field} rejects despite genuine anchor`, () => {
    const h = legacyHistories[1]!,
      rows = structuredClone([...h.records]),
      r = rows[0]!;
    if (field === "fingerprint" || field === "commandFingerprint")
      legacySet(r, field, "sha256:" + "a".repeat(64));
    if (field === "proposal") legacySet(r.proposal, "to", "QUALIFIED");
    if (field === "previous") legacySet(r, field, "sha256:" + "b".repeat(64));
    if (field === "journalGeneration") legacySet(r, field, 2);
    if (field === "snapshot") legacySet(r.snapshot, "state", "ACTIVE");
    if (field === "native")
      legacySet(
        legacyObject(legacyObject(r.details.capture.evidence[0]!.native).value),
        "watchDeclarationId",
        "forged",
      );
    if (field === "missing-generation") rows.splice(0, 1);
    expect(() => recoverJournal(rows, h.root, h.policy, legacyHost(h).host)).toThrow();
  });
it("L08 original trusted ACK and event predecessor are distinct, not interchangeable", () => {
  const h = legacyHistories[1]!,
    rows = structuredClone(h.records);
  rows[0]!.details.context.previousEventFingerprint = h.ack.fingerprint;
  expect(() => recoverJournal(rows, h.root, h.policy, legacyHost(h).host)).toThrow();
  expect(h.records[0]!.proposal.eventFingerprint).not.toBe(h.ack.fingerprint);
});
it("L09 contradictory same-identity native reference rejects even with a matching forged head", () => {
  const h = legacyHistories[1]!,
    rows = structuredClone(h.records),
    r = rows[0]!,
    e = structuredClone(r.details.capture.evidence[0]!);
  legacySet(legacyObject(legacyObject(e.native).value), "watchDeclarationId", "contradiction");
  legacySet(r.details.capture, "evidence", [...r.details.capture.evidence, e]);
  legacySync(r.details);
  expect(() => recoverJournal(rows, h.root, h.policy, legacyHost(h).host)).toThrow();
});
function legacyNodeCount(value: unknown): number {
  if (value === null || typeof value !== "object") return 1;
  return (
    1 + Object.values(value).reduce<number>((n, child: unknown) => n + legacyNodeCount(child), 0)
  );
}
it("L10 anchor work is charged cumulatively with complete original validation", () => {
  const h = legacyHistories[1]!,
    v = legacyHost(h);
  let low = 1,
    high = h.policy.limits.maxOperationNodes;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    let valid = true;
    try {
      inOperation({ ...h.policy.limits, maxOperationNodes: mid }, () =>
        recoverJournal(h.records, h.root, h.policy, v.host),
      );
    } catch {
      valid = false;
    }
    if (valid) high = mid;
    else low = mid + 1;
  }
  expect(() =>
    inOperation({ ...h.policy.limits, maxOperationNodes: low }, () =>
      recoverJournal(h.records, h.root, h.policy, v.host),
    ),
  ).not.toThrow();
  expect(() =>
    inOperation({ ...h.policy.limits, maxOperationNodes: low - 1 }, () =>
      recoverJournal(h.records, h.root, h.policy, v.host),
    ),
  ).toThrow();
  expect(low).toBeGreaterThan(legacyNodeCount(legacyAnchor(h)) + legacyNodeCount(h.records[0]));
  expect(() =>
    inOperation({ ...h.policy.limits, maxOperationNodes: low }, () => {
      recoverJournal(h.records, h.root, h.policy, v.host);
      recoverJournal(h.records, h.root, h.policy, v.host);
    }),
  ).toThrow();
});
it("L11 no caller-declared legacy flag is accepted by the current public materializer", () => {
  const d = structuredClone(legacyHistories[1]!.records[0]!.details);
  legacySet(d.capture, "legacy", true);
  expect(() => captureOpportunityContext(d.context, d.capture, d.policy)).toThrow();
});
it("L12 unanchored reverse-order journals cannot acquire legacy proof through prior anchored replay", () => {
  const h = legacyHistories[1]!;
  recoverJournal(h.records, h.root, h.policy, legacyHost(h).host);
  expect(() => recoverJournal(h.records, h.root, h.policy)).toThrow();
});
function legacyComponents(
  h: LegacyHistory,
  host: TrustedHostAuthorization,
  repository?: OpportunityRepository,
) {
  const clock = new VirtualClock(
    mustParseUtc("2026-10-19T13:00:00.000Z"),
    "REPLAY",
    "p28-fixture-clock",
  );
  const authority = new StateAuthorityRegistry(clock);
  take(authority.register(opportunityStateOwnership()));
  const fs = repository ?? new FilesystemOpportunityRepository(h.root, h.policy, host);
  return { clock, fs, runtime: new OpportunityRuntime(fs, clock, authority, host, h.policy) };
}
function legacyExpiry(h: LegacyHistory, clock: VirtualClock) {
  const d = structuredClone(h.records[0]!.details);
  d.context.historicalState = h.records[0]!.snapshot;
  d.context.previousEventFingerprint = h.records[0]!.proposal.eventFingerprint;
  d.input.expectedHead = h.records[0]!.snapshot.head;
  d.input.commandId = "canonical-expiry";
  d.input.requestedState = "EXPIRED";
  d.input.decisionCutoff = clock.now();
  d.input.knowledgeCutoff = clock.now();
  d.input.capturedClock = captureOpportunityClock(clock);
  legacySet(
    d.capture,
    "evidence",
    d.capture.evidence.map((e) => ({
      ...e,
      eventAt: clock.now(),
      availableAt: clock.now(),
      generation: e.generation + 1,
    })),
  );
  legacySync(d);
  return take(
    evaluateOpportunity(
      d.input,
      captureOpportunityContext(d.context, d.capture, d.policy),
      d.policy,
    ),
  );
}
for (const reverse of [false, true])
  for (const interrupted of [false, true])
    it(`M01 mixed legacy/current filesystem generation, interrupted=${interrupted} reverse=${reverse}`, async () => {
      const h = legacyHistories.find((row) => row.reverse === reverse)!,
        v = legacyHost(h),
        fs = new FilesystemOpportunityRepository(h.root, h.policy, v.host);
      let threw = false;
      const repo: OpportunityRepository = interrupted
        ? {
            root: fs.root,
            storageMode: fs.storageMode,
            load: () => fs.load(),
            async compareAppend(r) {
              const ack = await fs.compareAppend(r);
              if (ack.ok) {
                threw = true;
                throw Error("interrupted after physical ACK");
              }
              return ack;
            },
          }
        : fs;
      const f = legacyComponents(h, v.host, repo);
      try {
        expect(take(await f.runtime.initialize())).toEqual(h.records);
        const p = legacyExpiry(h, f.clock),
          ack = await f.runtime.commit(p);
        if (interrupted) {
          expect(threw).toBe(true);
          expect(ack).toMatchObject({ ok: false, error: { commitment: "UNKNOWN" } });
          expect((await f.runtime.shutdown()).ok).toBe(false);
          expect(take(await f.runtime.recover("canonical-expiry")).journalGeneration).toBe(2);
        } else expect(take(ack).journalGeneration).toBe(2);
        const rows = take(await fs.load()),
          validated = recoverJournal(rows, h.root, h.policy, v.host);
        expect(validated).toHaveLength(2);
        expect(validated[0]).toEqual(h.records[0]);
        expect(validated[1]!.snapshot.state).toBe("EXPIRED");
        expect(validated[1]!.details.context.previousEventFingerprint).toBe(
          h.records[0]!.proposal.eventFingerprint,
        );
        expect(validated[1]!.details.context.previousEventFingerprint).not.toBe(h.ack.fingerprint);
        expect(validated[1]!.previous).toBe(h.ack.fingerprint);
        const fresh = legacyComponents(h, v.host);
        expect(take(await fresh.runtime.initialize())).toEqual(rows);
        expect(take(await fresh.runtime.initialize())).toEqual(rows);
        expect(readFileSync(join(h.root, "journal-00000001.json"), "utf8")).toBe(h.physicalBytes);
      } finally {
        rmSync(join(h.root, "journal-00000002.json"), { force: true });
      }
    });
it("M02 caller cannot append an old reverse-order record as a new publication", async () => {
  const h = legacyHistories[1]!,
    fs = new FilesystemOpportunityRepository(h.root, h.policy, legacyHost(h).host);
  expect(await fs.compareAppend(h.records[0]!)).toMatchObject({
    ok: false,
    error: { commitment: "NONE" },
  });
  expect(take(await fs.load())).toEqual(h.records);
});
it("M03 prefix attestation cannot classify the next append as legacy", async () => {
  const h = legacyHistories[1]!,
    host = legacyHost(h),
    f = legacyComponents(h, host.host);
  take(await f.runtime.initialize());
  const r = makeJournalRecord(h.root, h.records, legacyExpiry(h, f.clock));
  const bad = legacyHost(h, (a) => {
    a.journalGeneration = 2;
  });
  const fs = new FilesystemOpportunityRepository(h.root, h.policy, bad.host);
  expect(await fs.compareAppend(r)).toMatchObject({ ok: false, error: { commitment: "NONE" } });
  expect(take(await fs.load())).toEqual(h.records);
});
for (const mode of ["NONE", "UNKNOWN"] as const)
  it(`M04 ${mode} write outcome does not settle through legacy retry path`, async () => {
    const h = legacyHistories[1]!,
      host = legacyHost(h);
    const repository: OpportunityRepository = {
      root: h.root,
      storageMode: "OFFLINE_FILESYSTEM",
      load: () => Promise.resolve(legacySuccess(structuredClone(h.records))),
      compareAppend: () => Promise.resolve(failure("BLOCKED", mode)),
    };
    const f = legacyComponents(h, host.host, repository);
    take(await f.runtime.initialize());
    expect(await f.runtime.commit(legacyExpiry(h, f.clock))).toMatchObject({
      ok: false,
      error: { commitment: mode },
    });
    if (mode === "UNKNOWN") {
      expect((await f.runtime.recover("canonical-expiry")).ok).toBe(false);
      expect((await f.runtime.shutdown()).ok).toBe(false);
    } else expect((await f.runtime.shutdown()).ok).toBe(true);
    expect(take(await repository.load())).toEqual(h.records);
  });
it("M05 even a self-consistent next-head attestation cannot cover the next append", async () => {
  const h = legacyHistories[1]!,
    f = legacyComponents(h, legacyHost(h).host);
  take(await f.runtime.initialize());
  const r = makeJournalRecord(h.root, h.records, legacyExpiry(h, f.clock));
  const bad = legacyHost(h, (a) => {
    a.journalGeneration = 2;
    a.journalFingerprint = r.fingerprint;
  });
  const fs = new FilesystemOpportunityRepository(h.root, h.policy, bad.host);
  try {
    expect(await fs.compareAppend(r)).toMatchObject({ ok: false, error: { commitment: "NONE" } });
    expect(take(await fs.load())).toEqual(h.records);
  } finally {
    rmSync(join(h.root, "journal-00000002.json"), { force: true });
  }
});
it("R01 independent graph ledger agrees with cumulative logical captures, with no counter reset", () => {
  const h = legacyHistories[1]!,
    host = legacyHost(h).host,
    captureDescriptor = Object.getOwnPropertyDescriptor(Budget.prototype, "capture"),
    reuseDescriptor = Object.getOwnPropertyDescriptor(Budget.prototype, "reuseCaptured");
  const capture: unknown = captureDescriptor?.value,
    reuse: unknown = reuseDescriptor?.value;
  if (
    !captureDescriptor ||
    !reuseDescriptor ||
    typeof capture !== "function" ||
    typeof reuse !== "function"
  )
    throw Error("Expected original Budget methods");
  const known = new WeakMap<Budget, WeakSet<object>>(),
    expected = new WeakMap<Budget, number>(),
    meters = new Set<Budget>();
  const deep = (v: unknown): boolean =>
    v === null || typeof v !== "object" || (Object.isFrozen(v) && Object.values(v).every(deep));
  const mark = (v: unknown, set: WeakSet<object>, onlyFrozen: boolean) => {
    if (v !== null && typeof v === "object") {
      if (!onlyFrozen || deep(v)) set.add(v);
      Object.values(v).forEach((x: unknown) => mark(x, set, onlyFrozen));
    }
  };
  const state = (b: Budget) => {
    if (!known.has(b)) known.set(b, new WeakSet());
    meters.add(b);
    return known.get(b)!;
  };
  Budget.prototype.capture = function (raw: unknown, bytes?: number) {
    const cost = legacyNodeCount(raw),
      set = state(this),
      result: unknown = Reflect.apply(capture, this, [raw, bytes]);
    expected.set(this, (expected.get(this) ?? 0) + cost);
    mark(result, set, false);
    mark(raw, set, true);
    return result;
  };
  Budget.prototype.reuseCaptured = function (raw: unknown, bytes: number) {
    const set = state(this);
    if (raw !== null && typeof raw === "object" && set.has(raw))
      expected.set(this, (expected.get(this) ?? 0) + 1);
    const value: unknown = Reflect.apply(reuse, this, [raw, bytes]);
    return value;
  };
  try {
    inOperation(h.policy.limits, () => recoverJournal(h.records, h.root, h.policy, host));
    for (const meter of meters) expect(meter.nodes).toBe(expected.get(meter) ?? 0);
  } finally {
    Object.defineProperty(Budget.prototype, "capture", captureDescriptor);
    Object.defineProperty(Budget.prototype, "reuseCaptured", reuseDescriptor);
  }
});
function legacyRehash(record: JournalRecord) {
  const { eventFingerprint: omitted, ...body } = record.proposal;
  void omitted;
  const d = record.details;
  legacySet(
    record.proposal,
    "eventFingerprint",
    digest("ate.opportunity-event/1", {
      key: d.input.key,
      sequence: (d.context.historicalState?.head.eventSequence ?? 0) + 1,
      previousEventFingerprint: d.context.previousEventFingerprint,
      commandId: d.input.commandId,
      payloadFingerprint: digest("ate.opportunity-payload/1", {
        ...body,
        input: d.input,
        context: d.context,
        capture: d.capture,
        policy: d.policy,
      }),
      policyFingerprint: d.input.policyFingerprint,
      decisionCutoff: d.input.decisionCutoff,
    }),
  );
  legacySet(
    record,
    "commandFingerprint",
    digest("ate.opportunity-command/1", {
      principal: d.input.actorAuthorityRef,
      key: record.proposal.key,
      commandId: d.input.commandId,
      payload: d,
    }),
  );
  const { fingerprint: omittedRecord, ...value } = record;
  const { fingerprint: omittedHead, ...head } = record.snapshot.head;
  void omittedRecord;
  void omittedHead;
  const hash = digest("ate.opportunity-journal/1", {
    ...value,
    snapshot: { ...record.snapshot, head },
  });
  legacySet(record, "fingerprint", hash);
  legacySet(record.snapshot.head, "fingerprint", hash);
}
for (const kind of [
  "native-binding",
  "contradiction",
  "event-predecessor",
  "impossible-state",
] as const)
  it(`R02 ${kind} rejects even after all self-hashes are independently recomputed`, () => {
    const h = legacyHistories[1]!,
      rows = structuredClone(h.records),
      r = rows[0]!;
    if (kind === "native-binding")
      legacySet(
        legacyObject(legacyObject(r.details.capture.evidence[0]!.native).value),
        "sourceOriginFingerprint",
        "sha256:" + "f".repeat(64),
      );
    if (kind === "contradiction") {
      const e = structuredClone(r.details.capture.evidence[0]!);
      legacySet(legacyObject(legacyObject(e.native).value), "watchDeclarationId", "contradictory");
      legacySet(r.details.capture, "evidence", [...r.details.capture.evidence, e]);
      legacySync(r.details);
    }
    if (kind === "event-predecessor")
      r.details.context.previousEventFingerprint = h.ack.fingerprint;
    if (kind === "impossible-state") {
      legacySet(r.proposal, "to", "QUALIFIED");
      legacySet(r.snapshot, "state", "QUALIFIED");
    }
    legacyRehash(r);
    const bad = legacyHost(h, (a) => {
      a.journalFingerprint = r.fingerprint;
    });
    expect(() => recoverJournal(rows, h.root, h.policy, bad.host)).toThrow();
  });
