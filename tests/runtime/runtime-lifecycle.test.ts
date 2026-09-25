import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { CorrelationId, RuntimeMode, UtcTimestamp } from "@ate/domain";
import {
  buildRuntime,
  createBackgroundTask,
  registerProcessSignalHandlers,
  serviceDescriptor,
  serviceId,
  type HealthReport,
  type ProcessSignal,
  type ReadinessReport,
  type RuntimeClock,
  type RuntimeManagedService,
  type ServiceCriticality,
  type ServiceId,
} from "@ate/runtime";

const root = process.cwd();
const runtimeInstanceId = "20000000-0000-4000-8000-000000000001";
const correlationId = "20000000-0000-4000-8000-000000000002" as CorrelationId;

const fakeClock = (): RuntimeClock => {
  let tick = 0;
  return {
    now: () => `2026-09-25T00:00:${String(tick++).padStart(2, "0")}.000Z` as UtcTimestamp,
  };
};

const allModes: RuntimeMode[] = [
  "DEVELOPMENT",
  "RESEARCH",
  "BACKTEST",
  "SIMULATION",
  "PAPER",
  "LIVE",
];

type TestServiceOptions = Readonly<{
  serviceId: ServiceId;
  criticality?: ServiceCriticality;
  dependencies?: readonly ServiceId[];
  optionalDependencies?: readonly ServiceId[];
  supportedModes?: readonly RuntimeMode[];
  capabilities?: readonly string[];
  health?: HealthReport["status"];
  readiness?: ReadinessReport["status"];
  recoverable?: boolean;
  failOn?: "initialize" | "start" | "stop" | "dispose" | "recover" | "health" | "readiness";
  blockInitialize?: Promise<void>;
  blockStop?: Promise<void>;
  log: string[];
}>;

const makeService = (options: TestServiceOptions): RuntimeManagedService => ({
  descriptor: serviceDescriptor({
    serviceId: options.serviceId,
    name: options.serviceId,
    version: "test",
    description: "test runtime service",
    criticality: options.criticality ?? "REQUIRED",
    dependencies: options.dependencies,
    optionalDependencies: options.optionalDependencies,
    supportedModes: options.supportedModes ?? allModes,
    capabilities: options.capabilities,
    recoverable: options.recoverable,
  }),
  initialize: async () => {
    options.log.push(`initialize:${options.serviceId}`);
    if (options.blockInitialize !== undefined) {
      await options.blockInitialize;
    }
    if (options.failOn === "initialize") {
      throw new Error(`initialize failed: ${options.serviceId}`);
    }
  },
  start: () => {
    options.log.push(`start:${options.serviceId}`);
    if (options.failOn === "start") {
      throw new Error(`start failed: ${options.serviceId}`);
    }
  },
  stop: async () => {
    options.log.push(`stop:${options.serviceId}`);
    if (options.blockStop !== undefined) {
      await options.blockStop;
    }
    if (options.failOn === "stop") {
      throw new Error(`stop failed: ${options.serviceId}`);
    }
  },
  dispose: () => {
    options.log.push(`dispose:${options.serviceId}`);
    if (options.failOn === "dispose") {
      throw new Error(`dispose failed: ${options.serviceId}`);
    }
  },
  checkHealth: ({ now }) => {
    if (options.failOn === "health") {
      throw new Error(`health failed: ${options.serviceId}`);
    }
    return {
      status: options.health ?? "HEALTHY",
      timestamp: now(),
      serviceId: options.serviceId,
    };
  },
  checkReadiness: ({ now }) => {
    if (options.failOn === "readiness") {
      throw new Error(`readiness failed: ${options.serviceId}`);
    }
    return {
      status: options.readiness ?? "READY",
      timestamp: now(),
      serviceId: options.serviceId,
    };
  },
  recover: () => {
    options.log.push(`recover:${options.serviceId}`);
    if (options.failOn === "recover") {
      throw new Error(`recover failed: ${options.serviceId}`);
    }
  },
});

const build = (services: readonly RuntimeManagedService[], mode: RuntimeMode = "SIMULATION") =>
  buildRuntime({
    runtimeInstanceId,
    runtimeVersion: "0.3.0-runtime.1",
    mode,
    services,
    clock: fakeClock(),
    defaultTimeoutMs: 25,
  });

describe("runtime construction, graph validation, and mode gates", () => {
  it("constructs a runtime and rejects duplicate, missing, circular, and unsupported services", () => {
    const log: string[] = [];
    const a = serviceId("foundation.a");
    const b = serviceId("foundation.b");
    const valid = build([
      makeService({ serviceId: a, log }),
      makeService({ serviceId: b, dependencies: [a], log }),
    ]);
    expect(valid.ok).toBe(true);

    expect(build([makeService({ serviceId: a, log }), makeService({ serviceId: a, log })]).ok).toBe(
      false,
    );
    expect(build([makeService({ serviceId: b, dependencies: [a], log })]).ok).toBe(false);
    expect(
      build([
        makeService({ serviceId: a, dependencies: [b], log }),
        makeService({ serviceId: b, dependencies: [a], log }),
      ]).ok,
    ).toBe(false);
    expect(
      build([makeService({ serviceId: a, supportedModes: ["RESEARCH"], log })], "LIVE").ok,
    ).toBe(false);
  });

  it("requires explicit valid runtime mode and never defaults to LIVE", () => {
    expect(
      buildRuntime({
        runtimeInstanceId,
        runtimeVersion: "0.3.0-runtime.1",
        services: [],
        clock: fakeClock(),
      }).ok,
    ).toBe(false);
    expect(
      buildRuntime({
        runtimeInstanceId,
        runtimeVersion: "0.3.0-runtime.1",
        mode: "PRODUCTION",
        services: [],
        clock: fakeClock(),
      }).ok,
    ).toBe(false);

    for (const mode of allModes) {
      expect(build([], mode).ok, `${mode} should be a valid explicit mode`).toBe(true);
    }
  });

  it("does not infer live execution capability from LIVE mode", async () => {
    const built = build([], "LIVE");
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const started = await built.runtime.start(correlationId);
    const manifest = JSON.parse(
      readFileSync(join(root, "config", "capabilities.json"), "utf8"),
    ) as {
      capabilities: Record<string, boolean>;
    };

    expect(started.availableCapabilities).not.toContain("LIVE_EXECUTION");
    expect(manifest.capabilities.broker_order_submission).toBe(false);
    expect(manifest.capabilities.live_trading).toBe(false);
  });
});

describe("runtime lifecycle, startup admission, shutdown, and rollback", () => {
  it("runs the representative non-trading runtime journey in dependency order", async () => {
    const log: string[] = [];
    const a = serviceId("foundation.a");
    const b = serviceId("foundation.b");
    const c = serviceId("foundation.c");
    const built = build([
      makeService({ serviceId: a, capabilities: ["CORE_RUNTIME"], log }),
      makeService({ serviceId: b, dependencies: [a], capabilities: ["FOUNDATION_RUNTIME"], log }),
      makeService({ serviceId: c, dependencies: [b], log }),
    ]);

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const start = await built.runtime.start(correlationId);
    const snapshot = built.runtime.snapshot();
    const stop = await built.runtime.stop(correlationId);

    expect(start.ok).toBe(true);
    expect(snapshot.state).toBe("RUNNING");
    expect(snapshot.health.status).toBe("HEALTHY");
    expect(snapshot.readiness.status).toBe("READY");
    expect(stop.ok).toBe(true);
    expect(log.filter((entry) => entry.startsWith("start:"))).toEqual([
      "start:foundation.a",
      "start:foundation.b",
      "start:foundation.c",
    ]);
    expect(log.filter((entry) => entry.startsWith("stop:"))).toEqual([
      "stop:foundation.c",
      "stop:foundation.b",
      "stop:foundation.a",
    ]);
  });

  it("fails closed when a critical service is unhealthy at startup admission", async () => {
    const log: string[] = [];
    const critical = serviceId("foundation.critical");
    const built = build([
      makeService({
        serviceId: critical,
        criticality: "CRITICAL",
        health: "UNHEALTHY",
        log,
      }),
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const result = await built.runtime.start(correlationId);
    expect(result.ok).toBe(false);
    expect(result.state).toBe("FAILED");
    expect(result.readiness.status).not.toBe("READY");
  });

  it("rolls back initialized resources in reverse order when startup fails midway", async () => {
    const log: string[] = [];
    const a = serviceId("rollback.a");
    const b = serviceId("rollback.b");
    const c = serviceId("rollback.c");
    const built = build([
      makeService({ serviceId: a, log }),
      makeService({ serviceId: b, dependencies: [a], log }),
      makeService({ serviceId: c, dependencies: [b], failOn: "initialize", log }),
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const result = await built.runtime.start(correlationId);
    expect(result.ok).toBe(false);
    expect(log).toContain("dispose:rollback.b");
    expect(log).toContain("dispose:rollback.a");
    expect(log.indexOf("dispose:rollback.b")).toBeLessThan(log.indexOf("dispose:rollback.a"));
  });

  it("continues shutdown after stop failure and aggregates errors", async () => {
    const log: string[] = [];
    const a = serviceId("shutdown.a");
    const b = serviceId("shutdown.b");
    const c = serviceId("shutdown.c");
    const built = build([
      makeService({ serviceId: a, log }),
      makeService({ serviceId: b, dependencies: [a], log }),
      makeService({ serviceId: c, dependencies: [b], failOn: "stop", log }),
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await built.runtime.start(correlationId);
    const result = await built.runtime.stop(correlationId);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.serviceId)).toContain(c);
    expect(log.filter((entry) => entry.startsWith("stop:"))).toEqual([
      "stop:shutdown.c",
      "stop:shutdown.b",
      "stop:shutdown.a",
    ]);
  });

  it("makes shutdown idempotent and avoids double disposal", async () => {
    const log: string[] = [];
    const a = serviceId("shutdown.idempotent");
    const built = build([makeService({ serviceId: a, log })]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await built.runtime.start(correlationId);
    const first = await built.runtime.stop(correlationId);
    const second = await built.runtime.stop(correlationId);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(log.filter((entry) => entry === `dispose:${a}`)).toHaveLength(1);
  });
});

describe("degradation, capabilities, recovery, readiness, and snapshots", () => {
  it("degrades optional service capability without destroying core readiness and then recovers", async () => {
    const log: string[] = [];
    const core = serviceId("runtime.core");
    const optional = serviceId("runtime.optional");
    const built = build([
      makeService({
        serviceId: core,
        criticality: "CRITICAL",
        capabilities: ["CORE_RUNTIME"],
        log,
      }),
      makeService({
        serviceId: optional,
        criticality: "OPTIONAL",
        dependencies: [core],
        capabilities: ["NEWS_INTELLIGENCE"],
        recoverable: true,
        log,
      }),
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await built.runtime.start(correlationId);
    const degraded = await built.runtime.degradeService(
      optional,
      "optional provider unavailable",
      correlationId,
    );
    const degradedSnapshot = built.runtime.snapshot();
    const recovered = await built.runtime.recoverService(optional, correlationId);

    expect(degraded.ok).toBe(true);
    expect(degradedSnapshot.state).toBe("DEGRADED");
    expect(degradedSnapshot.availableCapabilities).toContain("CORE_RUNTIME");
    expect(degradedSnapshot.availableCapabilities).not.toContain("NEWS_INTELLIGENCE");
    expect(degradedSnapshot.degradedCapabilities).toContain("NEWS_INTELLIGENCE");
    expect(recovered.ok).toBe(true);
    expect(built.runtime.snapshot().state).toBe("RUNNING");
  });

  it("propagates dependency readiness loss transitively", async () => {
    const log: string[] = [];
    const a = serviceId("ready.a");
    const b = serviceId("ready.b");
    const built = build([
      makeService({ serviceId: a, capabilities: ["UPSTREAM"], log }),
      makeService({ serviceId: b, dependencies: [a], capabilities: ["DOWNSTREAM"], log }),
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await built.runtime.start(correlationId);
    await built.runtime.degradeService(a, "upstream failed", correlationId);
    const snapshot = built.runtime.snapshot();
    const dependant = snapshot.services.find((service) => service.descriptor.serviceId === b);
    expect(dependant?.readiness.status).toBe("NOT_READY");
    expect(snapshot.degradedCapabilities).toContain("DOWNSTREAM");
  });

  it("can represent RUNNING but NOT_READY when readiness capability reports not ready", async () => {
    const log: string[] = [];
    const optional = serviceId("ready.optional");
    const built = build([
      makeService({
        serviceId: optional,
        criticality: "OPTIONAL",
        readiness: "NOT_READY",
        log,
      }),
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const started = await built.runtime.start(correlationId);
    const snapshot = built.runtime.snapshot();
    expect(started.ok).toBe(true);
    expect(snapshot.state).toBe("RUNNING");
    expect(snapshot.readiness.status).toBe("DEGRADED_READY");
  });

  it("returns immutable secret-free runtime snapshots", async () => {
    const log: string[] = [];
    const a = serviceId("snapshot.a");
    const built = build([makeService({ serviceId: a, log })]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await built.runtime.start(correlationId);
    const snapshot = built.runtime.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(JSON.stringify(snapshot).toLowerCase()).not.toContain("password");
    expect(snapshot.services[0]?.descriptor.serviceId).toBe(a);
  });
});

describe("timeouts, concurrency, cancellation, host boundary, and architecture", () => {
  it("fails startup on initialization timeout and shutdown on stop timeout", async () => {
    const log: string[] = [];
    const never = new Promise<void>(() => undefined);
    const slowInit = serviceId("timeout.init");
    const initRuntime = buildRuntime({
      runtimeInstanceId,
      runtimeVersion: "0.3.0-runtime.1",
      mode: "SIMULATION",
      services: [makeService({ serviceId: slowInit, blockInitialize: never, log })],
      clock: fakeClock(),
      defaultTimeoutMs: 1,
    });
    expect(initRuntime.ok).toBe(true);
    if (!initRuntime.ok) return;
    expect((await initRuntime.runtime.start(correlationId)).ok).toBe(false);

    const slowStop = serviceId("timeout.stop");
    const stopRuntime = buildRuntime({
      runtimeInstanceId,
      runtimeVersion: "0.3.0-runtime.1",
      mode: "SIMULATION",
      services: [makeService({ serviceId: slowStop, blockStop: never, log })],
      clock: fakeClock(),
      defaultTimeoutMs: 1,
    });
    expect(stopRuntime.ok).toBe(true);
    if (!stopRuntime.ok) return;
    await stopRuntime.runtime.start(correlationId);
    const stop = await stopRuntime.runtime.stop(correlationId);
    expect(stop.ok).toBe(false);
    expect(stop.errors.some((error) => error.code === "SHUTDOWN_TIMEOUT")).toBe(true);
  });

  it("rejects concurrent start and joins concurrent stop without duplicate cleanup", async () => {
    const log: string[] = [];
    let releaseStart!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const service = serviceId("concurrent.service");
    const built = build([makeService({ serviceId: service, blockInitialize: blocker, log })]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const firstStart = built.runtime.start(correlationId);
    const secondStart = await built.runtime.start(correlationId);
    expect(secondStart.ok).toBe(false);
    expect(secondStart.errors[0]?.code).toBe("LIFECYCLE_CONFLICT");
    releaseStart();
    await firstStart;

    let releaseStop!: () => void;
    const stopBlocker = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const stopRuntime = build([
      makeService({ serviceId: serviceId("concurrent.stop"), blockStop: stopBlocker, log }),
    ]);
    expect(stopRuntime.ok).toBe(true);
    if (!stopRuntime.ok) return;
    await stopRuntime.runtime.start(correlationId);
    const firstStop = stopRuntime.runtime.stop(correlationId);
    const secondStop = stopRuntime.runtime.stop(correlationId);
    releaseStop();
    await Promise.all([firstStop, secondStop]);
    expect(log.filter((entry) => entry === "stop:concurrent.stop")).toHaveLength(1);
  });

  it("keeps start/stop race deterministic with a lifecycle conflict", async () => {
    const log: string[] = [];
    let releaseStart!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const built = build([
      makeService({ serviceId: serviceId("race.service"), blockInitialize: blocker, log }),
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const start = built.runtime.start(correlationId);
    const stop = await built.runtime.stop(correlationId);
    releaseStart();
    await start;
    expect(stop.ok).toBe(false);
    expect(stop.errors[0]?.code).toBe("LIFECYCLE_CONFLICT");
  });

  it("supports cooperative background task cancellation", async () => {
    const clock = fakeClock();
    let aborted = false;
    const task = createBackgroundTask({
      name: "test-task",
      clock,
      stopTimeoutMs: 25,
      run: (signal) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return Promise.resolve();
      },
    });

    await task.start();
    const errors = await task.stop();
    expect(errors).toHaveLength(0);
    expect(aborted).toBe(true);
    expect(task.state()).toBe("STOPPED");
  });

  it("registers process signal handlers through an adapter boundary", () => {
    const handlers = new Map<ProcessSignal, () => void>();
    const received: ProcessSignal[] = [];
    const registration = registerProcessSignalHandlers(
      {
        onSignal: (signal, handler) => handlers.set(signal, handler),
        offSignal: (signal) => handlers.delete(signal),
      },
      (signal) => received.push(signal),
    );

    handlers.get("SIGINT")?.();
    registration.dispose();
    expect(received).toEqual(["SIGINT"]);
    expect(handlers.size).toBe(0);
  });

  it("enforces package dependency direction and prohibited runtime imports", () => {
    const domainSource = join(root, "packages", "domain", "src");
    const runtimeSource = join(root, "packages", "runtime", "src");

    for (const file of readdirSync(domainSource).filter((entry) => entry.endsWith(".ts"))) {
      const content = readFileSync(join(domainSource, file), "utf8");
      expect(content).not.toContain("@ate/runtime");
    }

    const prohibitedRuntimeImports = [
      /mt5/iu,
      /mql5/iu,
      /metatrader/iu,
      /^react$/iu,
      /postgres/iu,
      /prisma/iu,
      /typeorm/iu,
    ];
    const importPattern = /from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/gu;
    for (const file of readdirSync(runtimeSource).filter((entry) => entry.endsWith(".ts"))) {
      const content = readFileSync(join(runtimeSource, file), "utf8");
      const importedModules = Array.from(
        content.matchAll(importPattern),
        (match) => match[1] ?? match[2] ?? "",
      );
      for (const importedModule of importedModules) {
        for (const prohibitedImport of prohibitedRuntimeImports) {
          expect(
            prohibitedImport.test(importedModule),
            `${file} should not import ${importedModule}`,
          ).toBe(false);
        }
      }
    }
  });
});
