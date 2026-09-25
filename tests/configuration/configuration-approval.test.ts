import type { Actor, ActorId, UtcTimestamp } from "@ate/domain";
import { EventRegistry } from "@ate/events";
import { StateAuthorityRegistry } from "@ate/persistence";
import { durationMs, mustParseUtc, VirtualClock } from "@ate/time";
import {
  buildConfigurationSnapshot,
  CapabilityRegistry,
  ConfigurationApprovalPolicyRegistry,
  configurationApprovalPolicyId,
  configurationEntry,
  configurationEventRegistrations,
  configurationSchemaFromDefinition,
  configurationSourceId,
  ConfigurationRegistry,
  ConfigurationSchemaRegistry,
  createConfigurationApprovalService,
  createEmptyConfigurationApprovalStore,
  createEmptyConfigurationVersionStore,
  createGovernedConfigurationPublicationGate,
  FeatureFlagRegistry,
  foundationalApprovalPolicies,
  foundationalCapabilityDefinitions,
  foundationalConfigurationDefinitions,
  foundationalConfigurationKey,
  foundationalConfigurationSchemas,
  foundationalFeatureFlagDefinitions,
  InMemoryConfigurationApprovalRepository,
  InMemoryConfigurationVersionRepository,
  registerApprovalPolicies,
  registerCapabilityDefinitions,
  registerConfigurationApprovalStateAuthority,
  registerConfigurationCapabilityControlStateAuthority,
  registerConfigurationSchemas,
  registerConfigurationStateAuthority,
  registerConfigurationVersionHistoryStateAuthority,
  registerFeatureFlagDefinitions,
  StaticApprovalAuthorityResolver,
  StaticConfigurationSource,
  type ConfigurationApprovalPolicy,
  type ConfigurationDefinition,
  type ConfigurationEntry,
  type ConfigurationKey,
} from "@ate/configuration";
import { describe, expect, it } from "vitest";

const utc = (value: string): UtcTimestamp => mustParseUtc(value);
const makeClock = () => new VirtualClock(utc("2026-09-25T11:00:00.000Z"));

const actor = (actorId: string, displayName: string): Actor => ({
  actorType: "USER",
  actorId: actorId as ActorId,
  displayName,
});

const maker = actor("actor-maker", "Maker");
const checker = actor("actor-checker", "Checker");
const criticalChecker = actor("actor-critical-checker", "Critical Checker");
const unauthorized = actor("actor-unauthorized", "Unauthorized");

const key = (value: string, clock: VirtualClock): ConfigurationKey =>
  foundationalConfigurationKey(value, clock);

const source = (
  clock: VirtualClock,
  entries: readonly Omit<ConfigurationEntry, "source" | "loadedAt">[],
  sourceId = "approval-test",
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

const createHarness = (clock: VirtualClock, policies = foundationalApprovalPolicies()) => {
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
  const policyRegistry = new ConfigurationApprovalPolicyRegistry(clock);
  expect(registerApprovalPolicies(policyRegistry, policies).ok).toBe(true);
  const versionRepository = new InMemoryConfigurationVersionRepository({
    clock,
    runtimeMode: "SIMULATION",
    schemaRegistry,
    store: createEmptyConfigurationVersionStore(),
  });
  const approvalRepository = new InMemoryConfigurationApprovalRepository({
    clock,
    store: createEmptyConfigurationApprovalStore(),
  });
  const authorityResolver = new StaticApprovalAuthorityResolver({
    clock,
    grants: {
      [checker.actorId as string]: ["SENSITIVE_CONFIGURATION_CHECKER"],
      [criticalChecker.actorId as string]: ["CRITICAL_CONFIGURATION_CHECKER"],
    },
  });
  const service = createConfigurationApprovalService({
    runtimeMode: "SIMULATION",
    clock,
    policyRegistry,
    repository: approvalRepository,
    authorityResolver,
    schemaRegistry,
    capabilityRegistry,
    featureFlagRegistry: flagRegistry,
  });
  return {
    configurationRegistry,
    schemaRegistry,
    capabilityRegistry,
    flagRegistry,
    policyRegistry,
    versionRepository,
    approvalRepository,
    service,
  };
};

const snapshotFor = async (
  clock: VirtualClock,
  registry: ConfigurationRegistry,
  logLevel: string,
  diagnosticsEnabled?: boolean,
) =>
  buildConfigurationSnapshot({
    registry,
    clock,
    sources: [
      source(clock, [
        configurationEntry({
          key: key("system.runtimeMode", clock),
          scopeType: "SYSTEM",
          value: "SIMULATION",
        }),
        configurationEntry({
          key: key("system.logLevel", clock),
          scopeType: "SYSTEM",
          value: logLevel,
        }),
        ...(diagnosticsEnabled === undefined
          ? []
          : [
              configurationEntry({
                key: key("system.feature.capabilityDiagnosticsEnabled", clock),
                scopeType: "SYSTEM",
                value: diagnosticsEnabled,
              }),
            ]),
      ]),
    ],
  });

const appendVersion = async (
  clock: VirtualClock,
  harness: ReturnType<typeof createHarness>,
  logLevel: string,
  diagnosticsEnabled: boolean | undefined,
  expectedParentVersionId?: Parameters<
    typeof harness.versionRepository.append
  >[0]["expectedParentVersionId"],
) => {
  const snapshot = await snapshotFor(
    clock,
    harness.configurationRegistry,
    logLevel,
    diagnosticsEnabled,
  );
  expect(snapshot.ok).toBe(true);
  const version = harness.versionRepository.append({
    snapshot: snapshot.ok ? snapshot.value : (undefined as never),
    schemaFingerprint: harness.schemaRegistry.fingerprint(),
    actor: maker,
    origin: "OPERATOR",
    reason: `Change configuration to ${logLevel}/${String(diagnosticsEnabled)}`,
    ...(expectedParentVersionId === undefined ? {} : { expectedParentVersionId }),
  });
  expect(version.ok).toBe(true);
  return {
    snapshot: snapshot.ok ? snapshot.value : (undefined as never),
    version: version.ok ? version.value : (undefined as never),
  };
};

describe("Prompt 11 maker-checker configuration approval", () => {
  it("classifies standard, sensitive, critical and conflicting policies deterministically", async () => {
    const clock = makeClock();
    const harness = createHarness(clock);
    const root = await appendVersion(clock, harness, "info", undefined);
    const standard = harness.service.evaluateApprovalRequirement(root.version);
    expect(standard.ok).toBe(true);
    expect(standard.ok ? standard.value.approvalRequired : true).toBe(false);
    expect(standard.ok ? standard.value.classification : undefined).toBe("STANDARD");

    const sensitive = await appendVersion(clock, harness, "info", false, root.version.versionId);
    const sensitiveEvaluation = harness.service.evaluateApprovalRequirement(sensitive.version);
    expect(sensitiveEvaluation.ok).toBe(true);
    expect(sensitiveEvaluation.ok ? sensitiveEvaluation.value.approvalRequired : false).toBe(true);
    expect(sensitiveEvaluation.ok ? sensitiveEvaluation.value.classification : undefined).toBe(
      "SENSITIVE",
    );
    expect(sensitiveEvaluation.ok ? sensitiveEvaluation.value.affectedCapabilities : []).toContain(
      "configuration.capabilityDiagnostics",
    );

    const governanceDefinition: ConfigurationDefinition = {
      key: key("system.approval.minimumCheckers", clock),
      domain: "SYSTEM",
      displayName: "Minimum Checkers",
      description: "Test governance policy key.",
      valueType: "INTEGER",
      required: false,
      failClosed: false,
      allowedScopes: ["SYSTEM"],
      mergePolicy: "REPLACE",
      sensitivity: "INTERNAL",
    };
    expect(harness.configurationRegistry.register(governanceDefinition).ok).toBe(true);
    expect(
      registerConfigurationSchemas(harness.schemaRegistry, [
        configurationSchemaFromDefinition(governanceDefinition, {
          metadata: {
            approvalClassification: "CRITICAL",
            approvalRequired: true,
            governanceCategory: "SENSITIVE",
          },
        }),
      ]).ok,
    ).toBe(true);
    const governanceSnapshot = await buildConfigurationSnapshot({
      registry: harness.configurationRegistry,
      clock,
      sources: [
        source(clock, [
          configurationEntry({
            key: key("system.runtimeMode", clock),
            scopeType: "SYSTEM",
            value: "SIMULATION",
          }),
          configurationEntry({
            key: governanceDefinition.key,
            scopeType: "SYSTEM",
            value: 2,
          }),
        ]),
      ],
    });
    expect(governanceSnapshot.ok).toBe(true);
    const governanceVersion = harness.versionRepository.append({
      snapshot: governanceSnapshot.ok ? governanceSnapshot.value : (undefined as never),
      schemaFingerprint: harness.schemaRegistry.fingerprint(),
      expectedParentVersionId: sensitive.version.versionId,
      actor: maker,
      origin: "OPERATOR",
      reason: "Attempt governance policy change",
    });
    expect(governanceVersion.ok).toBe(true);
    const critical = harness.service.evaluateApprovalRequirement(
      governanceVersion.ok ? governanceVersion.value : (undefined as never),
    );
    expect(critical.ok ? critical.value.classification : undefined).toBe("CRITICAL");
    expect(critical.ok ? critical.value.requiredAuthority : undefined).toBe(
      "CRITICAL_CONFIGURATION_CHECKER",
    );
  });

  it("creates immutable exact-version requests and rejects maker self-approval or unauthorized checkers", async () => {
    const clock = makeClock();
    const harness = createHarness(clock);
    const root = await appendVersion(clock, harness, "info", undefined);
    const sensitive = await appendVersion(clock, harness, "info", false, root.version.versionId);
    const request = harness.service.createApprovalRequest({
      version: sensitive.version,
      reason: "Review capability diagnostics flag change",
      idempotencyKey: "request-sensitive",
    });
    const duplicate = harness.service.createApprovalRequest({
      version: sensitive.version,
      reason: "Review capability diagnostics flag change again",
      idempotencyKey: "request-sensitive",
    });
    expect(request.ok).toBe(true);
    expect(duplicate.ok && request.ok ? duplicate.value.requestId : undefined).toBe(
      request.ok ? request.value.requestId : undefined,
    );
    expect(request.ok ? request.value.versionId : undefined).toBe(sensitive.version.versionId);
    expect(request.ok ? request.value.configurationFingerprint : undefined).toBe(
      sensitive.version.configurationFingerprint,
    );
    expect(Object.isFrozen(request.ok ? request.value : {})).toBe(true);

    const selfApproval = harness.service.submitDecision({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      checker: maker,
      decision: "APPROVE",
      reason: "I made this and approve it",
    });
    expect(selfApproval.ok ? undefined : selfApproval.error.code).toBe(
      "APPROVAL_MAKER_CHECKER_CONFLICT",
    );

    const unauthorizedApproval = harness.service.submitDecision({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      checker: unauthorized,
      decision: "APPROVE",
      reason: "Unauthorized approval attempt",
    });
    expect(unauthorizedApproval.ok ? undefined : unauthorizedApproval.error.code).toBe(
      "APPROVAL_CHECKER_UNAUTHORIZED",
    );
  });

  it("records approvals, prevents conflicting decisions, and validates exact fingerprint binding", async () => {
    const clock = makeClock();
    const harness = createHarness(clock);
    const root = await appendVersion(clock, harness, "info", undefined);
    const sensitive = await appendVersion(clock, harness, "info", false, root.version.versionId);
    const request = harness.service.createApprovalRequest({
      version: sensitive.version,
      reason: "Sensitive flag review",
    });
    expect(request.ok).toBe(true);
    const decision = harness.service.submitDecision({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      checker,
      decision: "APPROVE",
      reason: "Change is acceptable",
      idempotencyKey: "approve-sensitive",
    });
    const retry = harness.service.submitDecision({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      checker,
      decision: "APPROVE",
      reason: "Retry",
      idempotencyKey: "approve-sensitive",
    });
    expect(decision.ok).toBe(true);
    expect(retry.ok && decision.ok ? retry.value.decisionId : undefined).toBe(
      decision.ok ? decision.value.decisionId : undefined,
    );
    const rejectAfterApprove = harness.service.submitDecision({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      checker: criticalChecker,
      decision: "REJECT",
      reason: "Too late",
    });
    expect(rejectAfterApprove.ok ? undefined : rejectAfterApprove.error.code).toBe(
      "APPROVAL_ALREADY_DECIDED",
    );

    const eligibility = harness.service.isApprovalSatisfied(sensitive.version);
    expect(eligibility.ok ? eligibility.value.eligible : false).toBe(true);
    expect(eligibility.ok ? eligibility.value.validDecisionIds : []).toContain(
      decision.ok ? decision.value.decisionId : undefined,
    );

    const successor = await appendVersion(
      clock,
      harness,
      "info",
      true,
      sensitive.version.versionId,
    );
    const successorEligibility = harness.service.isApprovalSatisfied(successor.version);
    expect(successorEligibility.ok ? successorEligibility.value.eligible : true).toBe(false);
    expect(successorEligibility.ok ? successorEligibility.value.status : undefined).toBe("PENDING");
  });

  it("keeps multi-checker requests pending until enough distinct checkers approve", async () => {
    const clock = makeClock();
    const twoCheckerPolicy: ConfigurationApprovalPolicy = {
      policyId: configurationApprovalPolicyId("configuration.approval.twoCheckerSensitive"),
      displayName: "Two Checker Sensitive",
      description: "Sensitive changes require two independent checker identities.",
      version: 1,
      enabled: true,
      classification: "SENSITIVE",
      approvalRequired: true,
      requiredAuthority: "SENSITIVE_CONFIGURATION_CHECKER",
      requiredApprovalCount: 2,
      conditions: [{ keyPrefixes: ["system.feature."] }],
      reasonCodes: ["SENSITIVE_KEY_CHANGED"],
    };
    const harness = createHarness(clock, [foundationalApprovalPolicies()[0]!, twoCheckerPolicy]);
    const root = await appendVersion(clock, harness, "info", undefined);
    const sensitive = await appendVersion(clock, harness, "info", false, root.version.versionId);
    const request = harness.service.createApprovalRequest({
      version: sensitive.version,
      reason: "Two-checker sensitive flag review",
    });
    expect(request.ok).toBe(true);

    const firstApproval = harness.service.submitDecision({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      checker,
      decision: "APPROVE",
      reason: "First checker approval",
    });
    expect(firstApproval.ok).toBe(true);
    const afterFirst = harness.service.isApprovalSatisfied(sensitive.version);
    expect(afterFirst.ok ? afterFirst.value.status : undefined).toBe("PENDING");
    expect(afterFirst.ok ? afterFirst.value.eligible : true).toBe(false);

    const secondApproval = harness.service.submitDecision({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      checker: criticalChecker,
      decision: "APPROVE",
      reason: "Second checker approval",
    });
    expect(secondApproval.ok).toBe(true);
    const afterSecond = harness.service.isApprovalSatisfied(sensitive.version);
    expect(afterSecond.ok ? afterSecond.value.status : undefined).toBe("APPROVED");
    expect(afterSecond.ok ? afterSecond.value.validDecisionIds : []).toHaveLength(2);
  });

  it("supports policy-controlled expiry, revocation, and reapproval without rewriting history", async () => {
    const clock = makeClock();
    const expiringPolicy: ConfigurationApprovalPolicy = {
      policyId: configurationApprovalPolicyId("configuration.approval.expiringSensitive"),
      displayName: "Expiring Sensitive",
      description: "Test expiring sensitive policy.",
      version: 1,
      enabled: true,
      classification: "SENSITIVE",
      approvalRequired: true,
      requiredAuthority: "SENSITIVE_CONFIGURATION_CHECKER",
      requiredApprovalCount: 1,
      conditions: [{ keyPrefixes: ["system.feature."] }],
      reasonCodes: ["SENSITIVE_KEY_CHANGED"],
      expiresAfterMs: 1_000,
    };
    const harness = createHarness(clock, [foundationalApprovalPolicies()[0]!, expiringPolicy]);
    const root = await appendVersion(clock, harness, "info", undefined);
    const sensitive = await appendVersion(clock, harness, "info", false, root.version.versionId);
    const request = harness.service.createApprovalRequest({
      version: sensitive.version,
      reason: "Expiring approval request",
    });
    expect(request.ok).toBe(true);
    const approval = harness.service.submitDecision({
      requestId: request.ok ? request.value.requestId : (undefined as never),
      checker,
      decision: "APPROVE",
      reason: "Time-limited approval",
    });
    expect(approval.ok).toBe(true);
    expect(harness.service.isApprovalSatisfied(sensitive.version).ok).toBe(true);
    expect(clock.advanceBy(durationMs(1_001)).ok).toBe(true);
    const expired = harness.service.isApprovalSatisfied(sensitive.version);
    expect(expired.ok ? expired.value.status : undefined).toBe("EXPIRED");

    const secondRequest = harness.service.createApprovalRequest({
      version: sensitive.version,
      reason: "Reapproval after expiry",
      idempotencyKey: "reapproval",
    });
    expect(secondRequest.ok).toBe(true);
    const secondApproval = harness.service.submitDecision({
      requestId: secondRequest.ok ? secondRequest.value.requestId : (undefined as never),
      checker,
      decision: "APPROVE",
      reason: "Reapproved",
    });
    expect(secondApproval.ok).toBe(true);
    const revocation = harness.service.revokeApproval({
      requestId: secondRequest.ok ? secondRequest.value.requestId : (undefined as never),
      decisionId: secondApproval.ok ? secondApproval.value.decisionId : (undefined as never),
      revokedBy: checker,
      reason: "Operational concern",
    });
    expect(revocation.ok).toBe(true);
    const revoked = harness.service.isApprovalSatisfied(sensitive.version);
    expect(revoked.ok ? revoked.value.status : undefined).toBe("REVOKED");
    expect(
      harness.approvalRepository.decisionsByRequest(
        secondRequest.ok ? secondRequest.value.requestId : (undefined as never),
      ),
    ).toHaveLength(1);
  });

  it("blocks approval-required proposed configuration from becoming applied before approval", async () => {
    const clock = makeClock();
    const harness = createHarness(clock);
    const root = await appendVersion(clock, harness, "info", undefined);
    const sensitive = await appendVersion(clock, harness, "info", false, root.version.versionId);
    const gate = createGovernedConfigurationPublicationGate({
      approvalService: harness.service,
      initialAppliedVersion: root.version,
      initialAppliedSnapshot: root.snapshot,
    });
    const pendingApply = gate.applyIfEligible(sensitive.version, sensitive.snapshot);
    expect(pendingApply.ok ? pendingApply.value.applied : true).toBe(false);
    expect(gate.appliedVersionId()).toBe(root.version.versionId);
    expect(gate.appliedSnapshot()?.fingerprint).toBe(root.snapshot.fingerprint);

    const request = harness.service.createApprovalRequest({
      version: sensitive.version,
      reason: "Review before applying desired capability change",
    });
    expect(request.ok).toBe(true);
    expect(
      harness.service.submitDecision({
        requestId: request.ok ? request.value.requestId : (undefined as never),
        checker,
        decision: "APPROVE",
        reason: "Approved for same-environment application eligibility",
      }).ok,
    ).toBe(true);
    const approvedApply = gate.applyIfEligible(sensitive.version, sensitive.snapshot);
    expect(approvedApply.ok ? approvedApply.value.applied : false).toBe(true);
    expect(gate.appliedVersionId()).toBe(sensitive.version.versionId);
  });

  it("records approval state authority and safe events without implementing promotion or RBAC", () => {
    const clock = makeClock();
    const authority = new StateAuthorityRegistry(clock);
    expect(registerConfigurationStateAuthority(authority, ["SIMULATION"]).ok).toBe(true);
    expect(registerConfigurationVersionHistoryStateAuthority(authority, ["SIMULATION"]).ok).toBe(
      true,
    );
    expect(registerConfigurationCapabilityControlStateAuthority(authority, ["SIMULATION"]).ok).toBe(
      true,
    );
    expect(registerConfigurationApprovalStateAuthority(authority, ["SIMULATION"]).ok).toBe(true);
    expect(authority.all().map((entry) => entry.stateDomain)).toEqual(
      expect.arrayContaining([
        "configuration.controlplane",
        "configuration.versionhistory",
        "configuration.capabilitycontrol",
        "configuration.approval",
      ]),
    );

    const eventRegistry = new EventRegistry(clock);
    for (const registration of configurationEventRegistrations) {
      expect(eventRegistry.register(registration).ok).toBe(true);
    }
    expect(eventRegistry.all().map((registration) => registration.eventType)).toEqual(
      expect.arrayContaining([
        "configuration.approval.requested.v1",
        "configuration.approval.approved.v1",
        "configuration.approval.rejected.v1",
        "configuration.approval.revoked.v1",
        "configuration.approval.invalidated.v1",
      ]),
    );
  });

  it("reports approval service diagnostics and fail-closed readiness for invalid policies", () => {
    const clock = makeClock();
    const harness = createHarness(clock);
    expect(harness.service.checkReadiness().status).toBe("READY");
    expect(harness.service.diagnostics().policyCount).toBeGreaterThan(0);

    const invalidRegistry = new ConfigurationApprovalPolicyRegistry(clock);
    const invalidRegistration = invalidRegistry.register({
      policyId: configurationApprovalPolicyId("configuration.approval.invalid"),
      displayName: "Invalid",
      description: "Invalid test policy.",
      version: 1,
      enabled: true,
      classification: "SENSITIVE",
      approvalRequired: true,
      requiredAuthority: "SENSITIVE_CONFIGURATION_CHECKER",
      requiredApprovalCount: 0,
      conditions: [{ minimumChangeCount: 1 }],
      reasonCodes: ["SENSITIVE_KEY_CHANGED"],
    });
    expect(invalidRegistration.ok).toBe(false);
  });
});
