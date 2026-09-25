import type { Actor, ActorId, RuntimeMode, UtcTimestamp } from "@ate/domain";
import { EventRegistry } from "@ate/events";
import { StateAuthorityRegistry } from "@ate/persistence";
import { mustParseUtc, VirtualClock } from "@ate/time";
import {
  buildConfigurationSnapshot,
  CapabilityRegistry,
  ConfigurationApprovalPolicyRegistry,
  ConfigurationPromotionGraph,
  ConfigurationPromotionPolicyRegistry,
  configurationEntry,
  configurationEventRegistrations,
  configurationPromotionPolicyId,
  configurationSchemaFromDefinition,
  configurationSourceId,
  ConfigurationRegistry,
  ConfigurationSchemaRegistry,
  createConfigurationApprovalService,
  createConfigurationReleaseService,
  createEmptyConfigurationApprovalStore,
  createEmptyConfigurationReleaseStore,
  createEmptyConfigurationVersionStore,
  FeatureFlagRegistry,
  foundationalApprovalPolicies,
  foundationalCapabilityDefinitions,
  foundationalConfigurationDefinitions,
  foundationalConfigurationKey,
  foundationalConfigurationSchemas,
  foundationalFeatureFlagDefinitions,
  foundationalPromotionPolicies,
  InMemoryConfigurationApprovalRepository,
  InMemoryConfigurationReleaseRepository,
  InMemoryConfigurationVersionRepository,
  registerApprovalPolicies,
  registerCapabilityDefinitions,
  registerConfigurationApprovalStateAuthority,
  registerConfigurationCapabilityControlStateAuthority,
  registerConfigurationReleaseStateAuthority,
  registerConfigurationSchemas,
  registerConfigurationStateAuthority,
  registerConfigurationVersionHistoryStateAuthority,
  registerFeatureFlagDefinitions,
  registerPromotionPolicies,
  StaticApprovalAuthorityResolver,
  StaticConfigurationSource,
  type ConfigurationDefinition,
  type ConfigurationEntry,
  type ConfigurationKey,
  type ConfigurationPromotionPolicy,
  type ConfigurationVersion,
  type MutableConfigurationVersionStore,
} from "@ate/configuration";
import { describe, expect, it } from "vitest";

const utc = (value: string): UtcTimestamp => mustParseUtc(value);
const makeClock = () => new VirtualClock(utc("2026-09-25T17:30:00.000Z"));

const actor = (actorId: string, displayName: string): Actor => ({
  actorType: "USER",
  actorId: actorId as ActorId,
  displayName,
});

const maker = actor("actor-maker", "Maker");
const checker = actor("actor-checker", "Checker");

const key = (value: string, clock: VirtualClock): ConfigurationKey =>
  foundationalConfigurationKey(value, clock);

const source = (
  clock: VirtualClock,
  entries: readonly Omit<ConfigurationEntry, "source" | "loadedAt">[],
  sourceId = "release-test",
) =>
  new StaticConfigurationSource({
    clock,
    descriptor: {
      sourceId: configurationSourceId(sourceId),
      sourceType: "TEST",
      name: sourceId,
      criticality: "REQUIRED",
      failurePolicy: "FAIL_CLOSED",
      priority: 0,
    },
    entries,
  });

const createHarness = (
  clock: VirtualClock,
  promotionPolicies: readonly ConfigurationPromotionPolicy[] = foundationalPromotionPolicies(),
) => {
  const configurationRegistry = new ConfigurationRegistry(clock);
  for (const definition of foundationalConfigurationDefinitions(clock)) {
    expect(configurationRegistry.register(definition).ok).toBe(true);
  }
  const schemaRegistry = new ConfigurationSchemaRegistry(clock);
  expect(
    registerConfigurationSchemas(schemaRegistry, foundationalConfigurationSchemas(clock)).ok,
  ).toBe(true);
  const capabilityRegistry = new CapabilityRegistry(clock);
  expect(
    registerCapabilityDefinitions(capabilityRegistry, foundationalCapabilityDefinitions()).ok,
  ).toBe(true);
  const flagRegistry = new FeatureFlagRegistry(clock, capabilityRegistry);
  expect(
    registerFeatureFlagDefinitions(flagRegistry, foundationalFeatureFlagDefinitions(clock)).ok,
  ).toBe(true);
  const approvalPolicyRegistry = new ConfigurationApprovalPolicyRegistry(clock);
  expect(registerApprovalPolicies(approvalPolicyRegistry, foundationalApprovalPolicies()).ok).toBe(
    true,
  );
  const releasePolicyRegistry = new ConfigurationPromotionPolicyRegistry(clock);
  expect(registerPromotionPolicies(releasePolicyRegistry, promotionPolicies).ok).toBe(true);
  const versionStore: MutableConfigurationVersionStore = createEmptyConfigurationVersionStore();
  const versionRepository = new InMemoryConfigurationVersionRepository({
    clock,
    runtimeMode: "DEVELOPMENT",
    schemaRegistry,
    store: versionStore,
  });
  const releaseRepository = new InMemoryConfigurationReleaseRepository({
    clock,
    store: createEmptyConfigurationReleaseStore(),
  });
  const approvalRepository = new InMemoryConfigurationApprovalRepository({
    clock,
    store: createEmptyConfigurationApprovalStore(),
  });
  const authorityResolver = new StaticApprovalAuthorityResolver({
    clock,
    grants: {
      [checker.actorId as string]: ["SENSITIVE_CONFIGURATION_CHECKER"],
    },
  });
  const approvalService = createConfigurationApprovalService({
    runtimeMode: "DEVELOPMENT",
    clock,
    policyRegistry: approvalPolicyRegistry,
    repository: approvalRepository,
    authorityResolver,
    schemaRegistry,
    capabilityRegistry,
    featureFlagRegistry: flagRegistry,
  });
  const releaseService = createConfigurationReleaseService({
    runtimeMode: "DEVELOPMENT",
    clock,
    registry: configurationRegistry,
    schemaRegistry,
    versionRepository,
    releaseRepository,
    policyRegistry: releasePolicyRegistry,
    approvalService,
    authorityResolver,
    capabilityRegistry,
    featureFlagRegistry: flagRegistry,
  });
  const repositoryFor = (runtimeMode: RuntimeMode) =>
    new InMemoryConfigurationVersionRepository({
      clock,
      runtimeMode,
      schemaRegistry,
      store: versionStore,
    });
  return {
    configurationRegistry,
    schemaRegistry,
    versionRepository,
    releaseRepository,
    approvalService,
    releaseService,
    repositoryFor,
  };
};

const snapshotFor = async (
  clock: VirtualClock,
  registry: ConfigurationRegistry,
  runtimeMode: RuntimeMode,
  logLevel: string,
  diagnosticsEnabled = true,
  extraEntries: readonly Omit<ConfigurationEntry, "source" | "loadedAt">[] = [],
) =>
  buildConfigurationSnapshot({
    registry,
    clock,
    sources: [
      source(clock, [
        configurationEntry({
          key: key("system.runtimeMode", clock),
          scopeType: "SYSTEM",
          value: runtimeMode,
        }),
        configurationEntry({
          key: key("system.logLevel", clock),
          scopeType: "SYSTEM",
          value: logLevel,
        }),
        configurationEntry({
          key: key("system.feature.capabilityDiagnosticsEnabled", clock),
          scopeType: "SYSTEM",
          value: diagnosticsEnabled,
        }),
        ...extraEntries,
      ]),
    ],
  });

const appendVersion = async (
  clock: VirtualClock,
  harness: ReturnType<typeof createHarness>,
  runtimeMode: RuntimeMode,
  logLevel: string,
  diagnosticsEnabled = true,
  actorInput = maker,
  extraEntries: readonly Omit<ConfigurationEntry, "source" | "loadedAt">[] = [],
) => {
  const snapshot = await snapshotFor(
    clock,
    harness.configurationRegistry,
    runtimeMode,
    logLevel,
    diagnosticsEnabled,
    extraEntries,
  );
  expect(snapshot.ok).toBe(true);
  const repository = harness.repositoryFor(runtimeMode);
  const current = repository.getCurrent();
  const version = repository.append({
    snapshot: snapshot.ok ? snapshot.value : (undefined as never),
    schemaFingerprint: harness.schemaRegistry.fingerprint(),
    ...(current.ok ? { expectedParentVersionId: current.value.versionId } : {}),
    actor: actorInput,
    origin: "OPERATOR",
    reason: `Create ${runtimeMode} ${logLevel}/${diagnosticsEnabled}`,
  });
  expect(version.ok).toBe(true);
  return version.ok ? version.value : (undefined as never);
};

const requestPlanAndExecute = (
  harness: ReturnType<typeof createHarness>,
  sourceVersion: ConfigurationVersion,
  destinationEnvironment: RuntimeMode,
) => {
  const request = harness.releaseService.createPromotionRequest({
    sourceVersionId: sourceVersion.versionId,
    sourceEnvironment: sourceVersion.runtimeMode,
    destinationEnvironment,
    requestedBy: maker,
    reason: `Promote ${sourceVersion.runtimeMode} to ${destinationEnvironment}`,
  });
  expect(request.ok).toBe(true);
  const plan = harness.releaseService.createPromotionPlan({
    requestId: request.ok ? request.value.requestId : (undefined as never),
    plannedBy: maker,
  });
  expect(plan.ok).toBe(true);
  const execution = harness.releaseService.executePromotion({
    planId: plan.ok ? plan.value.planId : (undefined as never),
    executedBy: maker,
  });
  if (!execution.ok) {
    throw new Error(
      `${execution.error.code}: ${execution.error.message} ${JSON.stringify(execution.error.details)}`,
    );
  }
  expect(execution.ok).toBe(true);
  return { request, plan, execution };
};

describe("Prompt 12 configuration promotion and rollback", () => {
  it("uses an explicit canonical environment graph and rejects skipped transitions", () => {
    const graph = new ConfigurationPromotionGraph();

    expect(graph.allows("DEVELOPMENT", "RESEARCH")).toBe(true);
    expect(graph.allows("RESEARCH", "BACKTEST")).toBe(true);
    expect(graph.allows("BACKTEST", "SIMULATION")).toBe(true);
    expect(graph.allows("SIMULATION", "PAPER")).toBe(true);
    expect(graph.allows("PAPER", "LIVE")).toBe(true);
    expect(graph.allows("DEVELOPMENT", "LIVE")).toBe(false);
    expect(graph.allows("RESEARCH", "PAPER")).toBe(false);
    expect(graph.allows("SIMULATION", "LIVE")).toBe(false);
  });

  it("creates immutable requests and plans without mutating destination active state", async () => {
    const clock = makeClock();
    const harness = createHarness(clock);
    const devVersion = await appendVersion(clock, harness, "DEVELOPMENT", "info");

    const request = harness.releaseService.createPromotionRequest({
      sourceVersionId: devVersion.versionId,
      sourceEnvironment: "DEVELOPMENT",
      destinationEnvironment: "RESEARCH",
      requestedBy: maker,
      reason: "Prepare research promotion",
      idempotencyKey: "dev-research-request",
    });
    const retry = harness.releaseService.createPromotionRequest({
      sourceVersionId: devVersion.versionId,
      sourceEnvironment: "DEVELOPMENT",
      destinationEnvironment: "RESEARCH",
      requestedBy: maker,
      reason: "Prepare research promotion",
      idempotencyKey: "dev-research-request",
    });
    expect(request.ok).toBe(true);
    expect(retry.ok && request.ok ? retry.value.requestId : undefined).toBe(
      request.ok ? request.value.requestId : undefined,
    );

    const plan = harness.releaseService.createPromotionPlan({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      plannedBy: maker,
    });
    expect(plan.ok).toBe(true);
    expect(plan.ok ? plan.value.eligibility.eligible : false).toBe(true);
    expect(harness.releaseRepository.environmentState("RESEARCH")).toBeUndefined();
  });

  it("activates atomically with explicit active pointer and proves latest is not active", async () => {
    const clock = makeClock();
    const harness = createHarness(clock);
    const first = await appendVersion(clock, harness, "DEVELOPMENT", "info");
    const latest = await appendVersion(clock, harness, "DEVELOPMENT", "warn");

    requestPlanAndExecute(harness, first, "RESEARCH");
    const active = harness.releaseService.explainActiveConfiguration("RESEARCH");
    expect(active.ok ? active.value.activeVersionId : undefined).toBe(first.versionId);
    expect(active.ok ? active.value.activeVersionId : undefined).not.toBe(latest.versionId);
    expect(active.ok ? active.value.activeConfigurationFingerprint : undefined).toBeDefined();
    expect(harness.repositoryFor("DEVELOPMENT").getCurrent().ok).toBe(true);
  });

  it("detects destination drift and prevents stale plans from overwriting active state", async () => {
    const clock = makeClock();
    const harness = createHarness(clock);
    const first = await appendVersion(clock, harness, "DEVELOPMENT", "info");
    const second = await appendVersion(clock, harness, "DEVELOPMENT", "warn");
    const third = await appendVersion(clock, harness, "DEVELOPMENT", "error");

    requestPlanAndExecute(harness, first, "RESEARCH");
    const staleRequest = harness.releaseService.createPromotionRequest({
      sourceVersionId: second.versionId,
      sourceEnvironment: "DEVELOPMENT",
      destinationEnvironment: "RESEARCH",
      requestedBy: maker,
      reason: "Prepare stale plan",
    });
    expect(staleRequest.ok).toBe(true);
    const stalePlan = harness.releaseService.createPromotionPlan({
      requestId: staleRequest.ok ? staleRequest.value.requestId : (undefined as never),
      plannedBy: maker,
    });
    expect(stalePlan.ok).toBe(true);

    requestPlanAndExecute(harness, third, "RESEARCH");
    const staleExecution = harness.releaseService.executePromotion({
      planId: stalePlan.ok ? stalePlan.value.planId : (undefined as never),
      executedBy: maker,
    });
    expect(staleExecution.ok ? staleExecution.value.status : undefined).toBe("FAILED");
    const active = harness.releaseService.explainActiveConfiguration("RESEARCH");
    expect(active.ok ? active.value.activeVersionId : undefined).toBe(third.versionId);
  });

  it("blocks non-promotable configuration from crossing environments", async () => {
    const clock = makeClock();
    const harness = createHarness(clock);
    const localDefinition: ConfigurationDefinition = {
      key: key("system.localEndpoint", clock),
      domain: "SYSTEM",
      displayName: "Local Endpoint",
      description: "Environment-local endpoint placeholder.",
      valueType: "STRING",
      required: false,
      failClosed: false,
      allowedScopes: ["SYSTEM"],
      mergePolicy: "REPLACE",
      sensitivity: "INTERNAL",
    };
    expect(harness.configurationRegistry.register(localDefinition).ok).toBe(true);
    expect(
      registerConfigurationSchemas(harness.schemaRegistry, [
        configurationSchemaFromDefinition(localDefinition, {
          metadata: {
            releaseScope: "NON_PROMOTABLE",
            promotionHelpText: "Endpoint placeholders are destination-local.",
          },
        }),
      ]).ok,
    ).toBe(true);
    const sourceVersion = await appendVersion(clock, harness, "DEVELOPMENT", "info", true, maker, [
      configurationEntry({
        key: localDefinition.key,
        scopeType: "SYSTEM",
        value: "https://dev.invalid",
      }),
    ]);

    const request = harness.releaseService.createPromotionRequest({
      sourceVersionId: sourceVersion.versionId,
      sourceEnvironment: "DEVELOPMENT",
      destinationEnvironment: "RESEARCH",
      requestedBy: maker,
      reason: "Attempt non-promotable release",
    });
    expect(request.ok).toBe(true);
    const plan = harness.releaseService.createPromotionPlan({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      plannedBy: maker,
    });
    expect(plan.ok ? plan.value.eligibility.eligible : true).toBe(false);
    expect(plan.ok ? plan.value.eligibility.reasonCodes : []).toContain(
      "NON_PROMOTABLE_CONFIGURATION",
    );
  });

  it("integrates approval eligibility for stricter destination promotion", async () => {
    const clock = makeClock();
    const harness = createHarness(clock);
    const paperVersion = await appendVersion(clock, harness, "PAPER", "info", false);

    const request = harness.releaseService.createPromotionRequest({
      sourceVersionId: paperVersion.versionId,
      sourceEnvironment: "PAPER",
      destinationEnvironment: "LIVE",
      requestedBy: maker,
      reason: "Prepare live configuration governance release",
    });
    expect(request.ok).toBe(true);
    const blockedPlan = harness.releaseService.createPromotionPlan({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      plannedBy: maker,
    });
    expect(blockedPlan.ok ? blockedPlan.value.eligibility.eligible : true).toBe(false);
    expect(blockedPlan.ok ? blockedPlan.value.eligibility.reasonCodes : []).toContain(
      "APPROVAL_NOT_SATISFIED",
    );

    const approvalRequest = harness.approvalService.createApprovalRequest({
      version: paperVersion,
      reason: "Approve live-bound sensitive flag change",
    });
    expect(approvalRequest.ok).toBe(true);
    expect(
      harness.approvalService.submitDecision({
        requestId: approvalRequest.ok ? approvalRequest.value.requestId : (undefined as never),
        checker,
        decision: "APPROVE",
        reason: "Independent approval",
      }).ok,
    ).toBe(true);
    const approvedPlan = harness.releaseService.createPromotionPlan({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      plannedBy: maker,
    });
    expect(approvedPlan.ok ? approvedPlan.value.eligibility.eligible : false).toBe(true);
  });

  it("supports destination promotion approval with requester/checker separation", async () => {
    const clock = makeClock();
    const customPolicy: ConfigurationPromotionPolicy = {
      policyId: configurationPromotionPolicyId("configuration.release.simulationToPaperChecked"),
      displayName: "Simulation to Paper Checked",
      description: "Test promotion-specific checker approval.",
      version: 1,
      enabled: true,
      source: "SIMULATION",
      destination: "PAPER",
      allowSameEnvironmentRelease: false,
      approvalRequirement: "PROMOTION_APPROVAL",
      requiredPromotionAuthority: "SENSITIVE_CONFIGURATION_CHECKER",
      requiredPromotionApprovalCount: 1,
      rollbackRequiresApproval: false,
      allowSchemaFingerprintChange: true,
      allowRestartRequiredActivation: true,
    };
    const policies = [
      ...foundationalPromotionPolicies().filter(
        (policy) => !(policy.source === "SIMULATION" && policy.destination === "PAPER"),
      ),
      customPolicy,
    ];
    const harness = createHarness(clock, policies);
    const version = await appendVersion(clock, harness, "SIMULATION", "info");
    const request = harness.releaseService.createPromotionRequest({
      sourceVersionId: version.versionId,
      sourceEnvironment: "SIMULATION",
      destinationEnvironment: "PAPER",
      requestedBy: maker,
      reason: "Promotion-specific checker test",
    });
    expect(request.ok).toBe(true);
    const blockedPlan = harness.releaseService.createPromotionPlan({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      plannedBy: maker,
    });
    expect(blockedPlan.ok ? blockedPlan.value.eligibility.eligible : true).toBe(false);
    const selfDecision = harness.releaseService.submitPromotionDecision({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      checker: maker,
      decision: "APPROVE",
      reason: "Self approval",
    });
    expect(selfDecision.ok ? undefined : selfDecision.error.code).toBe(
      "PROMOTION_APPROVAL_INVALID",
    );
    expect(
      harness.releaseService.submitPromotionDecision({
        requestId: request.ok ? request.value.requestId : (undefined as never),
        checker,
        decision: "APPROVE",
        reason: "Independent promotion approval",
      }).ok,
    ).toBe(true);
    const approvedPlan = harness.releaseService.createPromotionPlan({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      plannedBy: maker,
    });
    expect(approvedPlan.ok ? approvedPlan.value.eligibility.eligible : false).toBe(true);
  });

  it("records restart-pending release state for restart-required capability changes", async () => {
    const clock = makeClock();
    const harness = createHarness(clock);
    const initial = await appendVersion(clock, harness, "DEVELOPMENT", "info", true);
    requestPlanAndExecute(harness, initial, "RESEARCH");

    const changed = await appendVersion(clock, harness, "DEVELOPMENT", "info", false);
    requestPlanAndExecute(harness, changed, "RESEARCH");
    const active = harness.releaseService.explainActiveConfiguration("RESEARCH");
    expect(active.ok ? active.value.restartPending : false).toBe(true);
    expect(active.ok ? active.value.runningVersionId : undefined).toBe(initial.versionId);
    expect(active.ok ? active.value.targetPostRestartVersionId : undefined).toBe(changed.versionId);
  });

  it("rolls back only to exact known-good targets and preserves rollback history", async () => {
    const clock = makeClock();
    const harness = createHarness(clock);
    const first = await appendVersion(clock, harness, "DEVELOPMENT", "info");
    const second = await appendVersion(clock, harness, "DEVELOPMENT", "warn");
    requestPlanAndExecute(harness, first, "RESEARCH");
    requestPlanAndExecute(harness, second, "RESEARCH");

    const rollbackRequest = harness.releaseService.createRollbackRequest({
      environment: "RESEARCH",
      targetVersionId: first.versionId,
      requestedBy: maker,
      reason: "Operator-requested recovery",
    });
    expect(rollbackRequest.ok).toBe(true);
    const rollbackPlan = harness.releaseService.createRollbackPlan({
      requestId: rollbackRequest.ok ? rollbackRequest.value.requestId : (undefined as never),
      plannedBy: maker,
    });
    if (rollbackPlan.ok && !rollbackPlan.value.eligibility.eligible) {
      throw new Error(JSON.stringify(rollbackPlan.value.eligibility.blockers));
    }
    expect(rollbackPlan.ok ? rollbackPlan.value.eligibility.eligible : false).toBe(true);
    const rollbackExecution = harness.releaseService.executeRollback({
      planId: rollbackPlan.ok ? rollbackPlan.value.planId : (undefined as never),
      executedBy: maker,
    });
    expect(rollbackExecution.ok).toBe(true);
    const active = harness.releaseService.explainActiveConfiguration("RESEARCH");
    expect(active.ok ? active.value.activeVersionId : undefined).toBe(first.versionId);
    expect(harness.releaseRepository.activationHistory("RESEARCH")).toHaveLength(3);
  });

  it("records release state authority and safe events without enabling trading", () => {
    const clock = makeClock();
    const authority = new StateAuthorityRegistry(clock);
    expect(registerConfigurationStateAuthority(authority, ["DEVELOPMENT"]).ok).toBe(true);
    expect(registerConfigurationVersionHistoryStateAuthority(authority, ["DEVELOPMENT"]).ok).toBe(
      true,
    );
    expect(
      registerConfigurationCapabilityControlStateAuthority(authority, ["DEVELOPMENT"]).ok,
    ).toBe(true);
    expect(registerConfigurationApprovalStateAuthority(authority, ["DEVELOPMENT"]).ok).toBe(true);
    expect(registerConfigurationReleaseStateAuthority(authority, ["DEVELOPMENT"]).ok).toBe(true);
    expect(authority.all().map((entry) => entry.stateDomain)).toEqual(
      expect.arrayContaining(["configuration.release"]),
    );

    const eventRegistry = new EventRegistry(clock);
    for (const registration of configurationEventRegistrations) {
      const registered = eventRegistry.register(registration);
      if (!registered.ok) {
        throw new Error(`${registration.eventType}: ${registered.error.message}`);
      }
      expect(registered.ok).toBe(true);
    }
    expect(eventRegistry.all().map((registration) => registration.eventType)).toEqual(
      expect.arrayContaining([
        "configuration.promotion.requested.v1",
        "configuration.promotion.planned.v1",
        "configuration.promotion.promoted.v1",
        "configuration.rollback.requested.v1",
        "configuration.rollback.completed.v1",
        "configuration.known-good.recorded.v1",
      ]),
    );
  });
});
