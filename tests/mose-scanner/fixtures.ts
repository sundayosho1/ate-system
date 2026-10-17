import type { VirtualClock } from "@ate/time";
import { StateAuthorityRegistry } from "@ate/persistence";
import {
  ConfigurationRegistry,
  ConfigurationResolver,
  StaticConfigurationSource,
  buildConfigurationSnapshot,
  configurationEntry,
  configurationSourceId,
} from "@ate/configuration";
import {
  AggregationEngine,
  MemoryAggregationRepository,
  TimeframeRegistry,
  utcCalendar,
  defaultOptions,
  CalendarBoundaryResolver,
} from "@ate/multitimeframe";
import {
  MultiSpeedScannerRuntime,
  MemoryScanRepository,
  scannerConfigurationDefinitions,
  scannerStateOwnership,
  defaultScannerPolicy,
  fingerprint,
  type ScannerPolicy,
  type ScanCheckpointRepository,
  type ScanSubscription,
  type ScannerPorts,
  type ScanPlan,
} from "@ate/mose-scanner";
import { fixture as moseFixture, owners, take, time } from "../mose-core/fixtures.js";
export { take, owners, time };
export async function config(clock: VirtualClock, policy: ScannerPolicy, plan?: ScanPlan) {
  const registry = new ConfigurationRegistry(clock),
    defs = scannerConfigurationDefinitions(clock);
  for (const d of defs) take(registry.register(d));
  const source = new StaticConfigurationSource({
    clock,
    descriptor: {
      sourceId: configurationSourceId("scanner-test"),
      sourceType: "TEST",
      name: "Governed scanner test",
      criticality: "REQUIRED",
      failurePolicy: "FAIL_CLOSED",
      priority: 1,
    },
    entries: [
      configurationEntry({ key: defs[0]!.key, scopeType: "SYSTEM", value: JSON.stringify(policy) }),
      ...(plan
        ? [
            configurationEntry({
              key: defs[1]!.key,
              scopeType: "SYSTEM",
              value: JSON.stringify(plan),
            }),
          ]
        : []),
    ],
  });
  const snapshot = take(await buildConfigurationSnapshot({ registry, sources: [source], clock }));
  return take(
    new ConfigurationResolver(registry, snapshot, clock).resolve({ runtimeMode: "RESEARCH" }),
  );
}
export async function fixture(
  base: Awaited<ReturnType<typeof owners>>,
  changes: Partial<ScannerPolicy> = {},
  repository: ScanCheckpointRepository = new MemoryScanRepository(),
) {
  const mose = await moseFixture(base),
    universe = await mose.setup();
  take(await mose.start());
  const clock = mose.clock,
    authority = new StateAuthorityRegistry(clock);
  take(authority.register(scannerStateOwnership()));
  const subscription = (patch: Partial<ScanSubscription> = {}): ScanSubscription => ({
    id: "ticks",
    sessionId: "session-A",
    universe: universe.fingerprint,
    instrumentId: base.context.instrumentId,
    timeframe: "M15",
    streamId: null,
    mode: "TICK_EVENT",
    dependencies: ["source"],
    priority: 1,
    cadenceMs: null,
    anchor: clock.now(),
    schedule: null,
    ...patch,
  });
  let installedPlan: ScanPlan = {
    id: "plan",
    dependencies: [{ id: "source", parents: [] }],
    subscriptions: [subscription()],
  };
  const policy = { ...defaultScannerPolicy, ...changes };
  let configuration = await config(clock, policy, installedPlan);
  const engine = new AggregationEngine({
    clock,
    repository: new MemoryAggregationRepository(clock),
    registry: new TimeframeRegistry(),
    calendar: utcCalendar,
    configurationFingerprint: fingerprint("scanner-test"),
    options: { ...defaultOptions, enabled: true, maxSnapshotAgeMs: 604800000 },
    directTimeframes: ["M1", "M15", "H1", "H4", "D1"],
    edges: [],
  });
  take(engine.start());
  const calendar = new CalendarBoundaryResolver(utcCalendar);
  const ports: ScannerPorts = {
    clock,
    authority,
    configuration: () => configuration,
    mose: mose.service,
    aggregation: engine,
    calendar,
    repository,
    replayEvidence: mose.ports.replayEvidence,
  };
  const scanner = new MultiSpeedScannerRuntime(ports);
  take(await scanner.initialize());
  const plan = async (
    subs: ScanSubscription[] = [subscription()],
    dependencies: ScanPlan["dependencies"] = [{ id: "source", parents: [] }],
  ) => {
    const value = { id: "plan", dependencies, subscriptions: subs };
    installedPlan = value;
    configuration = await config(clock, policy, value);
    return take(await scanner.createPlan("plan", value));
  };
  const start = () => scanner.transition("start", "START");
  const trigger = (
    index = 0,
    sub = "ticks",
    kind: "EVENT" | "DEADLINE" | "BAR_FINALITY" | "TIMEFRAME" | "RESEARCH_RESCAN" = "EVENT",
  ) => {
    const e = universe.plan[index]!,
      preview = take(scanner.preview(sub, clock.now(), kind === "EVENT" ? e.eventId : undefined));
    return {
      id: "request-" + index + "-" + sub,
      subscriptionId: sub,
      boundary: clock.now(),
      kind,
      actor: null,
      cause: kind === "EVENT" ? e.eventId : kind === "DEADLINE" ? sub : preview.cause,
      evidence: preview.evidence,
    };
  };
  return {
    scanner,
    mose,
    universe,
    clock,
    ports,
    engine,
    policy,
    repository,
    calendar,
    subscription,
    plan,
    start,
    trigger,
    configuredPlan: () => installedPlan,
    setConfiguration: (c: typeof configuration) => {
      configuration = c;
    },
  };
}
