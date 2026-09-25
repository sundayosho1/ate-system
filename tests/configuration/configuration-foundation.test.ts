import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Actor, SourceId, UtcTimestamp } from "@ate/domain";
import { EventFactory, EventRegistry, InternalEventBus } from "@ate/events";
import { StateAuthorityRegistry } from "@ate/persistence";
import { buildRuntime } from "@ate/runtime";
import {
  buildConfigurationSnapshot,
  bootstrapConfiguration,
  configurationEntry,
  configurationEventRegistrations,
  configurationKey,
  configurationSourceId,
  ConfigurationRegistry,
  configurationScope,
  ConfigurationResolver,
  createConfigurationRuntimeService,
  defaultScopePrecedencePolicy,
  foundationalConfigurationDefinitions,
  foundationalConfigurationKey,
  registerConfigurationStateAuthority,
  StaticConfigurationSource,
  type ConfigurationDefinition,
  type ConfigurationEntry,
  type ConfigurationKey,
} from "@ate/configuration";
import { createClockRuntimeService, durationMs, mustParseUtc, VirtualClock } from "@ate/time";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const readText = (relativePath: string): string => readFileSync(join(root, relativePath), "utf8");

const walkFiles = (relativeDirectory: string, extension: string): string[] => {
  const absoluteDirectory = join(root, relativeDirectory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(relativePath, extension);
    }
    return entry.isFile() && entry.name.endsWith(extension) ? [relativePath] : [];
  });
};

const utc = (value: string): UtcTimestamp => mustParseUtc(value);

const makeClock = () => new VirtualClock(utc("2026-09-25T07:00:00.000Z"));

const registerFoundationalDefinitions = (clock: VirtualClock): ConfigurationRegistry => {
  const registry = new ConfigurationRegistry(clock);
  for (const definition of foundationalConfigurationDefinitions(clock)) {
    const result = registry.register(definition);
    expect(result.ok).toBe(true);
  }
  return registry;
};

const key = (value: string, clock: VirtualClock): ConfigurationKey =>
  foundationalConfigurationKey(value, clock);

const source = (
  clock: VirtualClock,
  entries: readonly Omit<ConfigurationEntry, "source" | "loadedAt">[],
  sourceId = "built-in",
) =>
  new StaticConfigurationSource({
    clock,
    descriptor: {
      sourceId: configurationSourceId(sourceId),
      sourceType: "BUILT_IN",
      name: sourceId,
      criticality: "REQUIRED",
      failurePolicy: "FAIL_CLOSED",
      priority: 0,
    },
    entries,
  });

const actor: Actor = { actorType: "SERVICE", displayName: "configuration-test" };

describe("Prompt 7 hierarchical configuration engine foundation", () => {
  it("models canonical domains, lower-first camel-case keys, scopes, bootstrap boundary, and partial contexts", () => {
    const clock = makeClock();
    expect(configurationKey("risk.maxExposure", clock.now()).ok).toBe(true);
    expect(configurationKey("MaxRisk", clock.now()).ok).toBe(false);
    expect(configurationKey("max_risk", clock.now()).ok).toBe(false);
    expect(configurationKey("unknown.value", clock.now()).ok).toBe(false);
    expect(configurationScope("SYSTEM")).toEqual({ scopeType: "SYSTEM" });
    expect(configurationScope("ENVIRONMENT", "PAPER")).toEqual({
      scopeType: "ENVIRONMENT",
      scopeId: "PAPER",
    });
    expect(() => configurationScope("ENVIRONMENT", "prod")).toThrow(/runtime mode/u);
    expect(
      bootstrapConfiguration({
        runtimeMode: "SIMULATION",
        sourceRefs: ["configuration-source:built-in"],
        logLevel: "info",
      }),
    ).toMatchObject({ runtimeMode: "SIMULATION", sourceRefs: ["configuration-source:built-in"] });
  });

  it("resolves inherited values, scoped overrides, provenance, and explanation deterministically", async () => {
    const clock = makeClock();
    const registry = registerFoundationalDefinitions(clock);
    const runtimeMode = key("system.runtimeMode", clock);
    const retries = key("execution.maxRetryAttempts", clock);
    const entries = [
      configurationEntry({ key: runtimeMode, scopeType: "SYSTEM", value: "PAPER" }),
      configurationEntry({ key: retries, scopeType: "SYSTEM", value: 3 }),
      configurationEntry({ key: retries, scopeType: "ENVIRONMENT", scopeId: "PAPER", value: 5 }),
      configurationEntry({ key: retries, scopeType: "ACCOUNT", scopeId: "account-a", value: 7 }),
      configurationEntry({
        key: retries,
        scopeType: "INSTRUMENT",
        scopeId: "FX:EURUSD",
        value: 9,
      }),
    ];
    const snapshot = await buildConfigurationSnapshot({
      registry,
      sources: [source(clock, entries)],
      clock,
    });
    expect(snapshot.ok).toBe(true);
    const resolver = new ConfigurationResolver(
      registry,
      snapshot.ok ? snapshot.value : (undefined as never),
      clock,
    );
    const resolved = resolver.resolve({
      runtimeMode: "PAPER",
      accountId: "account-a",
      instrumentId: "FX:EURUSD",
    });
    expect(resolved.ok).toBe(true);
    const value = resolved.ok ? resolved.value.values.get(retries) : undefined;
    expect(value?.value).toBe(9);
    expect(value?.provenance.winningScope).toEqual({
      scopeType: "INSTRUMENT",
      scopeId: "FX:EURUSD",
    });
    expect(value?.provenance.overridden.map((entry) => entry.value)).toEqual([3, 5, 7]);
    const explanation = resolver.explain(retries, {
      runtimeMode: "PAPER",
      accountId: "account-a",
      instrumentId: "FX:EURUSD",
    });
    expect(explanation.ok).toBe(true);
    expect(
      explanation.ok
        ? explanation.value.candidates.filter((candidate) => candidate.applicable)
        : [],
    ).toHaveLength(4);
  });

  it("keeps source precedence separate from scope precedence and rejects equal-rank conflicts", async () => {
    const clock = makeClock();
    const registry = registerFoundationalDefinitions(clock);
    const accountVsInstrument: ConfigurationDefinition = {
      key: key("risk.maxExposure", clock),
      domain: "RISK",
      displayName: "Max Exposure",
      description: "Conflict test only; no risk engine is implemented.",
      valueType: "DECIMAL",
      required: false,
      failClosed: false,
      allowedScopes: ["SYSTEM", "ACCOUNT", "INSTRUMENT"],
      mergePolicy: "REPLACE",
      sensitivity: "SENSITIVE",
      precedence: {
        policyId: "equal-account-instrument-test",
        rules: [
          { scopeType: "SYSTEM", rank: 0, reason: "base" },
          { scopeType: "ACCOUNT", rank: 10, reason: "account explicit" },
          { scopeType: "INSTRUMENT", rank: 10, reason: "instrument explicit" },
        ],
      },
    };
    expect(registry.register(accountVsInstrument).ok).toBe(true);
    const snapshot = await buildConfigurationSnapshot({
      registry,
      sources: [
        source(clock, [
          configurationEntry({
            key: key("system.runtimeMode", clock),
            scopeType: "SYSTEM",
            value: "PAPER",
          }),
          configurationEntry({
            key: accountVsInstrument.key,
            scopeType: "ACCOUNT",
            scopeId: "account-a",
            value: "0.01",
          }),
          configurationEntry({
            key: accountVsInstrument.key,
            scopeType: "INSTRUMENT",
            scopeId: "FX:EURUSD",
            value: "0.02",
          }),
        ]),
      ],
      clock,
    });
    expect(snapshot.ok).toBe(true);
    const resolver = new ConfigurationResolver(
      registry,
      snapshot.ok ? snapshot.value : (undefined as never),
      clock,
    );
    const resolved = resolver.resolve({
      runtimeMode: "PAPER",
      accountId: "account-a",
      instrumentId: "FX:EURUSD",
    });
    expect(resolved.ok).toBe(true);
    expect(resolved.ok ? resolved.value.conflicts.map((conflict) => conflict.type) : []).toContain(
      "EQUAL_PRECEDENCE_CONFLICT",
    );
  });

  it("is input-order independent and produces stable semantic fingerprints", async () => {
    const clock = makeClock();
    const registry = registerFoundationalDefinitions(clock);
    const runtimeMode = key("system.runtimeMode", clock);
    const logLevel = key("system.logLevel", clock);
    const entries = [
      configurationEntry({ key: runtimeMode, scopeType: "SYSTEM", value: "SIMULATION" }),
      configurationEntry({ key: logLevel, scopeType: "SYSTEM", value: "info" }),
      configurationEntry({
        key: logLevel,
        scopeType: "ENVIRONMENT",
        scopeId: "SIMULATION",
        value: "debug",
      }),
    ];
    const first = await buildConfigurationSnapshot({
      registry,
      sources: [source(clock, entries)],
      clock,
    });
    const second = await buildConfigurationSnapshot({
      registry,
      sources: [source(clock, [...entries].reverse())],
      clock,
    });
    expect(first.ok && second.ok && first.value.fingerprint).toBe(
      second.ok ? second.value.fingerprint : undefined,
    );
    const firstResolved = new ConfigurationResolver(
      registry,
      first.ok ? first.value : (undefined as never),
      clock,
    ).resolve({ runtimeMode: "SIMULATION" });
    const secondResolved = new ConfigurationResolver(
      registry,
      second.ok ? second.value : (undefined as never),
      clock,
    ).resolve({ runtimeMode: "SIMULATION" });
    expect(firstResolved.ok && secondResolved.ok && firstResolved.value.fingerprint).toBe(
      secondResolved.ok ? secondResolved.value.fingerprint : undefined,
    );
  });

  it("detects unknown keys, duplicate entries, invalid scopes, required missing values, and secret misuse", async () => {
    const clock = makeClock();
    const registry = registerFoundationalDefinitions(clock);
    const runtimeMode = key("system.runtimeMode", clock);
    const snapshot = await buildConfigurationSnapshot({
      registry,
      sources: [
        source(clock, [
          configurationEntry({ key: runtimeMode, scopeType: "SYSTEM", value: "PAPER" }),
          configurationEntry({ key: runtimeMode, scopeType: "SYSTEM", value: "SIMULATION" }),
          configurationEntry({
            key: key("system.logLevel", clock),
            scopeType: "ACCOUNT",
            scopeId: "account-a",
            value: "debug",
          }),
        ]),
      ],
      clock,
    });
    expect(snapshot.ok).toBe(true);
    expect(snapshot.ok ? snapshot.value.conflicts.map((conflict) => conflict.type) : []).toEqual(
      expect.arrayContaining(["DUPLICATE_ENTRY", "INVALID_SCOPE"]),
    );

    const missingRequired = await buildConfigurationSnapshot({
      registry,
      sources: [source(clock, [])],
      clock,
    });
    expect(missingRequired.ok).toBe(true);
    const resolved = new ConfigurationResolver(
      registry,
      missingRequired.ok ? missingRequired.value : (undefined as never),
      clock,
    ).resolve({});
    expect(resolved.ok ? resolved.value.conflicts.map((conflict) => conflict.type) : []).toContain(
      "MISSING_REQUIRED_CONFIGURATION",
    );

    const secretDefinition: ConfigurationDefinition = {
      key: key("system.databaseSecretRef", clock),
      domain: "SYSTEM",
      displayName: "Database Secret Reference",
      description: "Secret reference test.",
      valueType: "SECRET_REFERENCE",
      required: false,
      failClosed: false,
      allowedScopes: ["SYSTEM", "ENVIRONMENT"],
      mergePolicy: "REPLACE",
      sensitivity: "SECRET_REFERENCE",
    };
    expect(registry.register(secretDefinition).ok).toBe(true);
    const secretSnapshot = await buildConfigurationSnapshot({
      registry,
      sources: [
        source(clock, [
          configurationEntry({ key: runtimeMode, scopeType: "SYSTEM", value: "PAPER" }),
          configurationEntry({
            key: secretDefinition.key,
            scopeType: "SYSTEM",
            value: "plain-secret-value",
          }),
        ]),
      ],
      clock,
    });
    expect(secretSnapshot.ok).toBe(true);
    const secretResolved = new ConfigurationResolver(
      registry,
      secretSnapshot.ok ? secretSnapshot.value : (undefined as never),
      clock,
    ).resolve({ runtimeMode: "PAPER" });
    expect(
      secretResolved.ok ? secretResolved.value.conflicts.map((conflict) => conflict.type) : [],
    ).toContain("SECRET_VALUE_FORBIDDEN");
  });

  it("supports explicit merge policies and unset semantics without silent magic values", async () => {
    const clock = makeClock();
    const registry = registerFoundationalDefinitions(clock);
    const objectDefinition: ConfigurationDefinition = {
      key: key("system.operatorHelp", clock),
      domain: "SYSTEM",
      displayName: "Operator Help",
      description: "Merge policy test.",
      valueType: "OBJECT",
      required: false,
      failClosed: false,
      allowedScopes: ["SYSTEM", "ENVIRONMENT"],
      mergePolicy: "DEEP_MERGE",
      sensitivity: "INTERNAL",
    };
    expect(registry.register(objectDefinition).ok).toBe(true);
    const snapshot = await buildConfigurationSnapshot({
      registry,
      sources: [
        source(clock, [
          configurationEntry({
            key: key("system.runtimeMode", clock),
            scopeType: "SYSTEM",
            value: "PAPER",
          }),
          configurationEntry({
            key: objectDefinition.key,
            scopeType: "SYSTEM",
            value: { labels: { current: "Current", inherited: "Inherited" } },
          }),
          configurationEntry({
            key: objectDefinition.key,
            scopeType: "ENVIRONMENT",
            scopeId: "PAPER",
            value: { labels: { inherited: "Inherited From" } },
          }),
        ]),
      ],
      clock,
    });
    expect(snapshot.ok).toBe(true);
    const resolved = new ConfigurationResolver(
      registry,
      snapshot.ok ? snapshot.value : (undefined as never),
      clock,
    ).resolve({ runtimeMode: "PAPER" });
    expect(
      resolved.ok ? resolved.value.values.get(objectDefinition.key)?.value : undefined,
    ).toEqual({
      labels: { current: "Current", inherited: "Inherited From" },
    });

    const unsetSnapshot = await buildConfigurationSnapshot({
      registry,
      sources: [
        source(clock, [
          configurationEntry({
            key: key("system.runtimeMode", clock),
            scopeType: "SYSTEM",
            value: "PAPER",
          }),
          configurationEntry({
            key: key("system.logLevel", clock),
            scopeType: "SYSTEM",
            value: "warn",
          }),
          configurationEntry({
            key: key("system.logLevel", clock),
            scopeType: "ENVIRONMENT",
            scopeId: "PAPER",
            operation: "UNSET",
          }),
        ]),
      ],
      clock,
    });
    expect(unsetSnapshot.ok).toBe(true);
    const unsetResolved = new ConfigurationResolver(
      registry,
      unsetSnapshot.ok ? unsetSnapshot.value : (undefined as never),
      clock,
    ).resolve({ runtimeMode: "PAPER" });
    expect(
      unsetResolved.ok
        ? unsetResolved.value.values.get(key("system.logLevel", clock))?.present
        : true,
    ).toBe(false);
  });

  it("enforces environment isolation and partial-context sparse overrides", async () => {
    const clock = makeClock();
    const registry = registerFoundationalDefinitions(clock);
    const logLevel = key("system.logLevel", clock);
    const snapshot = await buildConfigurationSnapshot({
      registry,
      sources: [
        source(clock, [
          configurationEntry({
            key: key("system.runtimeMode", clock),
            scopeType: "SYSTEM",
            value: "LIVE",
          }),
          configurationEntry({ key: logLevel, scopeType: "SYSTEM", value: "info" }),
          configurationEntry({
            key: logLevel,
            scopeType: "ENVIRONMENT",
            scopeId: "RESEARCH",
            value: "debug",
          }),
          configurationEntry({
            key: logLevel,
            scopeType: "ENVIRONMENT",
            scopeId: "LIVE",
            value: "warn",
          }),
        ]),
      ],
      clock,
    });
    expect(snapshot.ok).toBe(true);
    const resolver = new ConfigurationResolver(
      registry,
      snapshot.ok ? snapshot.value : (undefined as never),
      clock,
    );
    const live = resolver.resolve({ runtimeMode: "LIVE" });
    const paper = resolver.resolve({ runtimeMode: "PAPER" });
    expect(live.ok).toBe(true);
    expect(live.ok ? live.value.values.get(logLevel)?.value : undefined).toBe("warn");
    expect(paper.ok ? paper.value.values.get(logLevel)?.value : undefined).toBe("info");
  });

  it("publishes runtime snapshots atomically, preserves last-known-good on failed refresh, and uses context-aware cache", async () => {
    const clock = makeClock();
    const registry = registerFoundationalDefinitions(clock);
    const runtimeMode = key("system.runtimeMode", clock);
    const logLevel = key("system.logLevel", clock);
    const service = createConfigurationRuntimeService({
      runtimeMode: "SIMULATION",
      clock,
      registry,
      sources: [
        source(clock, [
          configurationEntry({ key: runtimeMode, scopeType: "SYSTEM", value: "SIMULATION" }),
          configurationEntry({ key: logLevel, scopeType: "SYSTEM", value: "info" }),
          configurationEntry({
            key: logLevel,
            scopeType: "ENVIRONMENT",
            scopeId: "SIMULATION",
            value: "debug",
          }),
        ]),
      ],
      cacheMaxEntries: 2,
    });
    expect((await service.initialize()).ok).toBe(true);
    expect(service.checkReadiness().status).toBe("READY");
    const first = service.resolve({ runtimeMode: "SIMULATION" });
    const second = service.resolve({ runtimeMode: "SIMULATION" });
    expect(first.ok && second.ok && first.value.fingerprint).toBe(
      second.ok ? second.value.fingerprint : undefined,
    );
    expect(service.diagnostics().cache.hits).toBeGreaterThanOrEqual(1);

    const failedRefresh = await service.refresh([
      source(clock, [
        configurationEntry({ key: runtimeMode, scopeType: "SYSTEM", value: "SIMULATION" }),
        configurationEntry({ key: runtimeMode, scopeType: "SYSTEM", value: "PAPER" }),
      ]),
    ]);
    expect(failedRefresh.ok).toBe(false);
    const afterFailure = service.resolve({ runtimeMode: "SIMULATION" });
    expect(afterFailure.ok ? afterFailure.value.values.get(logLevel)?.value : undefined).toBe(
      "debug",
    );
  });

  it("integrates with runtime lifecycle, time authority, event registrations, and persistence state authority", async () => {
    const clock = makeClock();
    const registry = registerFoundationalDefinitions(clock);
    const configurationService = createConfigurationRuntimeService({
      runtimeMode: "SIMULATION",
      clock,
      registry,
      sources: [
        source(clock, [
          configurationEntry({
            key: key("system.runtimeMode", clock),
            scopeType: "SYSTEM",
            value: "SIMULATION",
          }),
        ]),
      ],
    });
    const timeService = createClockRuntimeService({
      clock,
      options: {
        runtimeMode: "SIMULATION",
        clockMode: "VIRTUAL",
        maximumFutureSkewMs: durationMs(1_000),
        clockJumpWarningThresholdMs: durationMs(500),
        clockJumpCriticalThresholdMs: durationMs(2_000),
        schedulerMaxTasks: 10,
      },
    });
    const runtime = buildRuntime({
      runtimeInstanceId: "70000000-0000-4000-8000-000000000001",
      runtimeVersion: "0.7.0-config.1",
      mode: "SIMULATION",
      services: [timeService.managedService, configurationService.managedService],
      clock,
    });
    expect(runtime.ok).toBe(true);
    const started = await (runtime.ok
      ? runtime.runtime.start()
      : Promise.reject(new Error("runtime failed")));
    expect(started.ok).toBe(true);
    expect(started.readiness.status).toBe("READY");

    const eventRegistry = new EventRegistry(clock);
    for (const registration of configurationEventRegistrations) {
      expect(eventRegistry.register(registration).ok).toBe(true);
    }
    const factory = new EventFactory(eventRegistry, {
      runtimeMode: "SIMULATION",
      source: {
        sourceId: "70000000-0000-4000-8000-000000000900" as SourceId,
        sourceType: "SYSTEM",
        name: "configuration-test",
      },
      actor,
      clock,
      idGenerator: () => "70000000-0000-4000-8000-000000000901",
      maxCausationDepth: 8,
    });
    const eventBus = new InternalEventBus({ registry: eventRegistry, factory, clock });
    eventBus.start();
    const configurationEvent = factory.createRootEvent({
      eventType: "configuration.snapshot.published.v1",
      payload: {
        snapshotId: configurationService.diagnostics().activeSnapshotId,
        fingerprint: configurationService.diagnostics().activeFingerprint,
        keyCount: registry.keys().length,
        sourceCount: 1,
        runtimeMode: "SIMULATION",
      },
    });
    expect(configurationEvent.ok).toBe(true);
    const published = await eventBus.publish(
      configurationEvent.ok ? configurationEvent.value : (undefined as never),
    );
    expect(published.status).toBe("DELIVERED");

    const authority = new StateAuthorityRegistry(clock);
    expect(registerConfigurationStateAuthority(authority, ["SIMULATION"]).ok).toBe(true);
    expect(authority.all()[0]?.writeAuthority).toBe("@ate/configuration");
  });

  it("keeps direct environment reads and module-local configuration authority out of business packages", () => {
    const packageFiles = walkFiles("packages", ".ts");
    const processEnvReaders = packageFiles
      .filter((file) => !file.startsWith("packages/configuration/src/bootstrap"))
      .filter((file) => readText(file).includes("process.env"));
    expect(processEnvReaders).toEqual([]);

    const domainIndex = readText("packages/domain/src/index.ts");
    expect(domainIndex).not.toContain("@ate/configuration");
    expect(defaultScopePrecedencePolicy.policyId).toContain("default-foundation");
  });
});
