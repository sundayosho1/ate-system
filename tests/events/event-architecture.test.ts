import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { CausationId, SourceId, UtcTimestamp } from "@ate/domain";
import {
  buildCausationChain,
  createEventBusRuntimeService,
  defaultDeliveryPolicy,
  EventFactory,
  EventRegistry,
  InternalEventBus,
  publishLifecycleRecord,
  registerLifecycleBridgeEvent,
  subscriptionId,
  type ATEEvent,
  type EventSubscription,
  type EventTypeRegistration,
} from "@ate/events";
import { buildRuntime, type RuntimeClock } from "@ate/runtime";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const root = process.cwd();

const ids = Array.from(
  { length: 200 },
  (_, index) => `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

const fakeClock = (): RuntimeClock => {
  let tick = 0;
  return {
    now: () =>
      `2026-09-25T01:${String(Math.floor(tick / 60)).padStart(2, "0")}:${String(tick++ % 60).padStart(2, "0")}.000Z` as UtcTimestamp,
  };
};

const baseRegistry = (clock: RuntimeClock): EventRegistry => {
  const registry = new EventRegistry(clock);
  const registrations: EventTypeRegistration[] = [
    {
      eventType: "runtime.service.started.v1",
      category: "OPERATIONAL" as const,
      version: 1,
      schema: z.object({ service: z.string() }).strict(),
      description: "Runtime service started.",
      owner: "@ate/runtime",
    },
    {
      eventType: "workflow.step.completed.v1",
      category: "APPLICATION" as const,
      version: 1,
      schema: z.object({ step: z.string(), sequence: z.number().int().optional() }).strict(),
      description: "Deterministic non-trading workflow step completed.",
      owner: "@ate/events",
    },
    {
      eventType: "workflow.child.created.v1",
      category: "APPLICATION" as const,
      version: 1,
      schema: z.object({ child: z.string() }).strict(),
      description: "Deterministic non-trading child event.",
      owner: "@ate/events",
    },
  ];
  for (const registration of registrations) {
    const result = registry.register(registration);
    expect(result.ok).toBe(true);
  }
  return registry;
};

const makeHarness = (options: Partial<InternalEventBus["options"]> = {}) => {
  const clock = fakeClock();
  let idCursor = 0;
  const registry = baseRegistry(clock);
  const factory = new EventFactory(registry, {
    runtimeMode: "SIMULATION",
    source: {
      sourceId: "40000000-0000-4000-8000-000000000900" as SourceId,
      sourceType: "SYSTEM",
      name: "event-test",
    },
    actor: {
      actorType: "SERVICE",
      displayName: "event-test-service",
    },
    clock,
    idGenerator: () => ids[idCursor++] ?? ids.at(-1)!,
    maxCausationDepth: options.maximumCausationDepth ?? 8,
  });
  const bus = new InternalEventBus({ registry, factory, clock, options });
  bus.start();
  return { clock, registry, factory, bus };
};

const createRoot = (
  factory: EventFactory,
  eventType = "workflow.step.completed.v1",
  payload: Record<string, unknown> = { step: "A" },
  metadata: Record<string, unknown> = {},
): ATEEvent => {
  const event = factory.createRootEvent({
    eventType,
    payload,
    metadata,
  });
  expect(event.ok).toBe(true);
  return event.ok ? event.value : (undefined as never);
};

const subscribe = (
  bus: InternalEventBus,
  partial: Partial<EventSubscription> & Pick<EventSubscription, "subscriptionId" | "handler">,
): void => {
  const result = bus.register({
    subscriberId: partial.subscriberId ?? "test-subscriber",
    description: partial.description ?? "test subscription",
    eventTypes: partial.eventTypes ?? ["workflow.step.completed.v1"],
    criticality: partial.criticality ?? "OPTIONAL",
    policy: partial.policy ?? defaultDeliveryPolicy,
    ...partial,
  });
  expect(result.ok).toBe(true);
};

describe("Prompt 4 event architecture", () => {
  it("constructs registry and rejects duplicate registrations, bad naming, bad versions, and invalid payloads", async () => {
    const { clock, registry, factory, bus } = makeHarness();
    expect(
      registry.register({
        eventType: "workflow.step.completed.v1",
        category: "APPLICATION",
        version: 1,
        schema: z.object({}).strict(),
        description: "duplicate",
        owner: "test",
      }).ok,
    ).toBe(false);
    expect(
      registry.register({
        eventType: "statusChanged",
        category: "APPLICATION",
        version: 1,
        schema: z.object({}).strict(),
        description: "bad",
        owner: "test",
      }).ok,
    ).toBe(false);
    expect(
      registry.register({
        eventType: "bad.version.example.v2",
        category: "APPLICATION",
        version: 1,
        schema: z.object({}).strict(),
        description: "bad version",
        owner: "test",
      }).ok,
    ).toBe(false);

    const unknown = factory.createRootEvent({ eventType: "unknown.event.test.v1", payload: {} });
    expect(unknown.ok).toBe(false);
    const invalid = factory.createRootEvent({
      eventType: "workflow.step.completed.v1",
      payload: { step: 1 },
    });
    expect(invalid.ok).toBe(false);

    const valid = createRoot(factory);
    const result = await bus.publish(valid);
    expect(result.status).toBe("DELIVERED");
    expect(result.subscriberCount).toBe(0);
    expect(clock.now()).toMatch(/Z$/u);
  });

  it("creates root and child events with correlation, causation, mode preservation, and chain reconstruction", async () => {
    const { factory, bus } = makeHarness();
    const events: ATEEvent[] = [];
    subscribe(bus, {
      subscriptionId: subscriptionId("sub-a"),
      eventTypes: ["workflow.step.completed.v1"],
      handler: async (context) => {
        events.push(context.event);
        await context.publishChild({
          eventType: "workflow.child.created.v1",
          payload: { child: "B" },
        });
      },
    });
    subscribe(bus, {
      subscriptionId: subscriptionId("sub-b"),
      eventTypes: ["workflow.child.created.v1"],
      handler: (context) => {
        events.push(context.event);
      },
    });
    const rootEvent = createRoot(factory, "workflow.step.completed.v1", { step: "A" });
    const result = await bus.publish(rootEvent);
    expect(result.status).toBe("DELIVERED");
    expect(events).toHaveLength(2);
    expect(events[0]?.envelope.runtimeMode).toBe("SIMULATION");
    expect(events[1]?.envelope.correlationId).toBe(rootEvent.envelope.correlationId);
    expect(events[1]?.envelope.causationId).toBe(rootEvent.envelope.eventId);
    expect(buildCausationChain([rootEvent, ...events])).toEqual([
      rootEvent.envelope.eventId,
      events[1]?.envelope.eventId,
    ]);
  });

  it("rejects self-causation and excessive causation depth", async () => {
    const { factory, bus } = makeHarness({ maximumCausationDepth: 0 });
    const rootEvent = createRoot(factory);
    const child = factory.createChildEvent({
      parent: rootEvent,
      eventType: "workflow.child.created.v1",
      payload: { child: "B" },
    });
    expect(child.ok).toBe(false);

    const malformed = {
      ...rootEvent,
      envelope: {
        ...rootEvent.envelope,
        causationId: rootEvent.envelope.eventId as string as CausationId,
      },
    };
    const result = await bus.publish(malformed);
    expect(result.status).toBe("REJECTED");
    expect(result.errors[0]?.code).toBe("CAUSATION_INVALID");
  });

  it("routes exact events, isolates subscribers, freezes event views, and reports critical failure", async () => {
    const { factory, bus } = makeHarness();
    const observed: string[] = [];
    subscribe(bus, {
      subscriptionId: subscriptionId("sub-success-a"),
      handler: (context) => {
        expect(Object.isFrozen(context.event)).toBe(true);
        expect(() => {
          (context.event.payload as { step: string }).step = "MUTATED";
        }).toThrow();
        observed.push("A");
      },
    });
    subscribe(bus, {
      subscriptionId: subscriptionId("sub-fail-b"),
      criticality: "CRITICAL",
      handler: () => ({ status: "NON_RETRYABLE_FAILURE", reason: "expected failure" }),
    });
    subscribe(bus, {
      subscriptionId: subscriptionId("sub-success-c"),
      handler: (context) => {
        expect((context.event.payload as { step: string }).step).toBe("A");
        observed.push("C");
      },
    });
    const result = await bus.publish(createRoot(factory));
    expect(observed).toEqual(["A", "C"]);
    expect(result.subscriberCount).toBe(3);
    expect(result.successfulDeliveries).toBe(2);
    expect(result.deadLettered).toBe(true);
    expect(bus.health()).toBe("DEGRADED");
  });

  it("detects duplicate publication and subscriber-scoped concurrent idempotency", async () => {
    const { factory, bus } = makeHarness();
    let effects = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    subscribe(bus, {
      subscriptionId: subscriptionId("idempotent-sub"),
      handler: async () => {
        effects += 1;
        await barrier;
      },
    });
    const event = createRoot(
      factory,
      "workflow.step.completed.v1",
      { step: "A" },
      { idempotencyKey: "same-key" },
    );
    const first = bus.publish(event);
    const secondEvent = createRoot(
      factory,
      "workflow.step.completed.v1",
      { step: "A2" },
      { idempotencyKey: "same-key" },
    );
    const second = bus.publish(secondEvent);
    await Promise.resolve();
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(effects).toBe(1);
    expect(
      [firstResult.duplicateSkips, secondResult.duplicateSkips].reduce(
        (sum, value) => sum + value,
        0,
      ),
    ).toBe(1);

    const duplicate = await bus.publish(event);
    expect(duplicate.status).toBe("DUPLICATE");
    expect(effects).toBe(1);
  });

  it("retries retryable failures, avoids unnecessary retry for final failures, dead-letters poison events, and replays explicitly", async () => {
    const { factory, bus } = makeHarness();
    let retryAttempts = 0;
    subscribe(bus, {
      subscriptionId: subscriptionId("retry-sub"),
      eventTypes: ["runtime.service.started.v1"],
      policy: {
        ...defaultDeliveryPolicy,
        retry: { ...defaultDeliveryPolicy.retry, enabled: true, maximumAttempts: 2 },
      },
      handler: () => {
        retryAttempts += 1;
        return retryAttempts === 1
          ? { status: "RETRYABLE_FAILURE", reason: "transient" }
          : { status: "SUCCESS" };
      },
    });
    const retryResult = await bus.publish(
      createRoot(factory, "runtime.service.started.v1", { service: "x" }),
    );
    expect(retryResult.status).toBe("DELIVERED");
    expect(retryAttempts).toBe(2);
    expect(retryResult.retries).toBe(1);

    let finalAttempts = 0;
    subscribe(bus, {
      subscriptionId: subscriptionId("poison-sub"),
      eventTypes: ["workflow.child.created.v1"],
      policy: {
        ...defaultDeliveryPolicy,
        retry: { ...defaultDeliveryPolicy.retry, enabled: true, maximumAttempts: 2 },
      },
      handler: () => {
        finalAttempts += 1;
        return { status: "RETRYABLE_FAILURE", reason: "poison" };
      },
    });
    const poison = await bus.publish(
      createRoot(factory, "workflow.child.created.v1", { child: "poison" }),
    );
    expect(poison.status).toBe("DEAD_LETTERED");
    expect(finalAttempts).toBe(2);
    const deadLetter = bus.deadLetterRecords()[0];
    expect(deadLetter?.correlationId).toBeDefined();
    expect(deadLetter?.attempts).toBe(2);
    finalAttempts = 0;
    const replay = await bus.replayDeadLetter(deadLetter!.deadLetterId);
    expect(replay.status).toBe("DEAD_LETTERED");
    expect(finalAttempts).toBe(2);
  });

  it("preserves per-key ordering without globally blocking independent keys", async () => {
    const { factory, bus } = makeHarness();
    const order: string[] = [];
    subscribe(bus, {
      subscriptionId: subscriptionId("ordered-sub"),
      policy: { ...defaultDeliveryPolicy, ordered: true },
      handler: async (context) => {
        const payload = context.event.payload as { step: string };
        order.push(`start:${payload.step}`);
        await Promise.resolve();
        order.push(`end:${payload.step}`);
      },
    });
    const events = [
      createRoot(
        factory,
        "workflow.step.completed.v1",
        { step: "A1" },
        { orderingKey: "instrument:A" },
      ),
      createRoot(
        factory,
        "workflow.step.completed.v1",
        { step: "B1" },
        { orderingKey: "instrument:B" },
      ),
      createRoot(
        factory,
        "workflow.step.completed.v1",
        { step: "A2" },
        { orderingKey: "instrument:A" },
      ),
      createRoot(
        factory,
        "workflow.step.completed.v1",
        { step: "B2" },
        { orderingKey: "instrument:B" },
      ),
    ];
    await Promise.all(events.map((event) => bus.publish(event)));
    expect(order.indexOf("end:A1")).toBeLessThan(order.indexOf("start:A2"));
    expect(order.indexOf("end:B1")).toBeLessThan(order.indexOf("start:B2"));
  });

  it("applies backpressure, handler timeout cancellation, drain rejection, and immutable topology snapshots", async () => {
    const { factory, bus } = makeHarness({
      maxPendingEvents: 1,
      handlerTimeoutMs: 10,
      drainTimeoutMs: 10,
    });
    let firstRelease!: () => void;
    subscribe(bus, {
      subscriptionId: subscriptionId("slow-sub"),
      policy: { ...defaultDeliveryPolicy, handlerTimeoutMs: 10, deadLetterOnFailure: false },
      handler: async (context) => {
        await new Promise<void>((resolve) => {
          firstRelease = resolve;
        });
        expect(context.signal.aborted).toBe(false);
      },
    });
    const first = bus.publish(createRoot(factory));
    await Promise.resolve();
    const saturated = await bus.publish(
      createRoot(factory, "workflow.step.completed.v1", { step: "saturated" }),
    );
    expect(saturated.status).toBe("REJECTED");
    expect(saturated.errors[0]?.code).toBe("QUEUE_SATURATED");
    firstRelease();
    await first;

    const timeoutBus = makeHarness({ handlerTimeoutMs: 5 }).bus;
    subscribe(timeoutBus, {
      subscriptionId: subscriptionId("timeout-sub"),
      policy: { ...defaultDeliveryPolicy, handlerTimeoutMs: 5, deadLetterOnFailure: false },
      handler: async (context) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(context.signal.aborted).toBe(true);
      },
    });
    const timeoutResult = await timeoutBus.publish(createRoot(makeHarness().factory));
    expect(timeoutResult.failures[0]?.status).toBe("TIMEOUT");

    await bus.stop();
    const rejectedDuringDrain = await bus.publish(
      createRoot(factory, "workflow.step.completed.v1", { step: "after-stop" }),
    );
    expect(rejectedDuringDrain.status).toBe("REJECTED");
    const snapshot = bus.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.diagnostics.totalFailed).toBeGreaterThanOrEqual(0);
  });

  it("integrates as a runtime managed service and publishes lifecycle records without recursive bootstrap", async () => {
    const { registry, factory, bus, clock } = makeHarness();
    registerLifecycleBridgeEvent(registry);
    const built = buildRuntime({
      runtimeInstanceId: "40000000-0000-4000-8000-000000000777",
      runtimeVersion: "0.4.0-events.1",
      mode: "SIMULATION",
      services: [createEventBusRuntimeService(bus)],
      clock,
    });
    expect(built.ok).toBe(true);
    const runtime = built.ok ? built.runtime : (undefined as never);
    const start = await runtime.start();
    expect(start.ok).toBe(true);
    expect(start.readiness.status).toBe("READY");
    const lifecycleRecord = runtime.getLifecycleRecords().at(-1);
    expect(lifecycleRecord).toBeDefined();
    const lifecycleResult = await publishLifecycleRecord(bus, factory, lifecycleRecord!);
    expect(lifecycleResult.status).toBe("DELIVERED");
    expect(
      bus
        .snapshot()
        .registeredEventTypes.some((entry) => entry.eventType === "runtime.lifecycle.recorded.v1"),
    ).toBe(true);
    const stop = await runtime.stop();
    expect(stop.ok).toBe(true);
  });

  it("keeps events architecture inside approved dependency boundaries and bounded diagnostics", async () => {
    const { factory, bus } = makeHarness({
      idempotencyRetention: 2,
      deadLetterCapacity: 1,
      diagnosticRetention: 2,
    });
    subscribe(bus, {
      subscriptionId: subscriptionId("dead-letter-sub"),
      handler: () => ({ status: "NON_RETRYABLE_FAILURE", reason: "bounded" }),
    });
    await bus.publish(createRoot(factory, "workflow.step.completed.v1", { step: "one" }));
    await bus.publish(createRoot(factory, "workflow.step.completed.v1", { step: "two" }));
    await bus.publish(createRoot(factory, "workflow.step.completed.v1", { step: "three" }));
    expect(bus.deadLetterRecords()).toHaveLength(1);
    expect(bus.snapshot().errors.length).toBeLessThanOrEqual(2);

    const domainSources = readdirSync(join(root, "packages/domain/src"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(join(root, "packages/domain/src", file), "utf8"))
      .join("\n");
    expect(domainSources).not.toContain("@ate/events");

    const eventSources = readdirSync(join(root, "packages/events/src"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(join(root, "packages/events/src", file), "utf8"))
      .join("\n");
    for (const forbidden of [
      "mt5",
      "mql5",
      "metatrader",
      "react",
      "pg",
      "postgres",
      "kafka",
      "rabbitmq",
      "nats",
    ]) {
      expect(eventSources.toLowerCase()).not.toContain(forbidden);
    }
  });
});
