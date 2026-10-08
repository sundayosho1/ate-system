import { dataSourceRefSchema, marketObservationKinds } from "@ate/domain";
import { z } from "zod";
import type { Clock } from "@ate/time";
import { boundedInput, failure, immutable, safeId } from "./primitives.js";
import type {
  AdapterCapabilities,
  AdapterContext,
  NativeMessage,
  ProviderAdapter,
  RealtimeResult,
  SubscriptionRequest,
} from "./types.js";

export const adapterCapabilitiesSchema = z
  .object({
    observationKinds: z.array(z.enum(marketObservationKinds)).min(1).max(5),
    subscriptionModes: z
      .array(z.enum(["STREAM", "SNAPSHOT"]))
      .min(1)
      .max(2),
    sourceTimestamps: z.boolean(),
    sequences: z.enum(["NONE", "PER_SUBSCRIPTION_CONSECUTIVE", "PER_SUBSCRIPTION_OPAQUE"]),
    eventIds: z.boolean(),
    heartbeats: z.boolean(),
    snapshots: z.boolean(),
    flowControl: z.boolean(),
    reconnect: z.literal("NEW_SESSION"),
    subscriptionConfirmation: z.boolean(),
    entitlementRef: z.string().min(1).max(128),
    redistributionAllowed: z.boolean(),
  })
  .strict();
export class AdapterRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();
  public constructor(
    private readonly clock: Clock,
    private readonly capacity: number,
  ) {}
  public register(adapter: ProviderAdapter): RealtimeResult<void> {
    if (
      !safeId(adapter.adapterId) ||
      !safeId(adapter.version) ||
      this.adapters.size >= this.capacity ||
      this.adapters.has(adapter.source.sourceId) ||
      !dataSourceRefSchema.safeParse(adapter.source).success ||
      !adapterCapabilitiesSchema.safeParse(adapter.capabilities).success ||
      [...this.adapters.values()].some((a) => a.adapterId === adapter.adapterId)
    )
      return failure(this.clock, "INVALID_ADAPTER", "registry");
    try {
      boundedInput(adapter.source, 2048, 4, 128);
      boundedInput(adapter.capabilities, 2048, 4, 128);
    } catch {
      return failure(this.clock, "INVALID_ADAPTER", "registry");
    }
    const source = boundedInput(adapter.source, 2048, 4, 128) as ProviderAdapter["source"];
    const capabilities = boundedInput(adapter.capabilities, 2048, 4, 128) as AdapterCapabilities;
    this.adapters.set(
      source.sourceId,
      Object.freeze({
        adapterId: adapter.adapterId,
        version: adapter.version,
        source,
        capabilities,
        connect: adapter.connect.bind(adapter),
        disconnect: adapter.disconnect.bind(adapter),
        subscribe: adapter.subscribe.bind(adapter),
        unsubscribe: adapter.unsubscribe.bind(adapter),
        normalize: adapter.normalize.bind(adapter),
      }),
    );
    return { ok: true, value: undefined };
  }
  public values(): readonly ProviderAdapter[] {
    return [...this.adapters.values()].sort((a, b) => a.adapterId.localeCompare(b.adapterId));
  }
  public get(sourceId: string): ProviderAdapter | undefined {
    return this.adapters.get(sourceId);
  }
}
export const scriptedCapabilities: AdapterCapabilities = immutable({
  observationKinds: ["QUOTE", "TICK", "TRADE", "BAR", "MARKET_STATUS"],
  subscriptionModes: ["STREAM"],
  sourceTimestamps: true,
  sequences: "PER_SUBSCRIPTION_CONSECUTIVE",
  eventIds: true,
  heartbeats: true,
  snapshots: false,
  flowControl: false,
  reconnect: "NEW_SESSION",
  subscriptionConfirmation: true,
  entitlementRef: "offline-test-only",
  redistributionAllowed: false,
});

// Script steps are explicitly released by tests; no real connections or wall-clock sleeps.
export class ScriptedAdapter implements ProviderAdapter {
  public readonly adapterId: string;
  public readonly version = "1.0.0";
  public readonly callbacks: AdapterContext[] = [];
  public readonly applied = new Set<string>();
  public failConnectCount = 0;
  public failSubscriptions = new Set<string>();
  public connectGate: (() => Promise<void>) | undefined;
  public subscribeGate: (() => Promise<void>) | undefined;
  public disconnectGate: (() => Promise<void>) | undefined;
  public disconnectCount = 0;
  public constructor(
    public readonly source: ProviderAdapter["source"],
    public readonly capabilities: AdapterCapabilities = scriptedCapabilities,
  ) {
    this.adapterId = `scripted-${source.sourceId}`;
  }
  public async connect(context: AdapterContext): Promise<void> {
    this.callbacks.push(context);
    if (this.callbacks.length > 32) this.callbacks.shift();
    await this.connectGate?.();
    if (context.signal.aborted) throw new Error("cancelled");
    this.applied.clear();
    if (this.failConnectCount > 0) {
      this.failConnectCount--;
      throw new Error("scripted failure");
    }
  }
  public async disconnect(signal: AbortSignal): Promise<void> {
    await this.disconnectGate?.();
    if (signal.aborted) throw new Error("cancelled");
    this.disconnectCount++;
    this.applied.clear();
    await Promise.resolve();
  }
  public async subscribe(
    request: SubscriptionRequest,
    signal: AbortSignal,
  ): Promise<"CONFIRMED" | "UNCERTAIN"> {
    await this.subscribeGate?.();
    if (signal.aborted || this.failSubscriptions.has(request.subscriptionId))
      throw new Error("scripted failure");
    this.applied.add(request.subscriptionId);
    return this.capabilities.subscriptionConfirmation ? "CONFIRMED" : "UNCERTAIN";
  }
  public async unsubscribe(request: SubscriptionRequest, _signal: AbortSignal): Promise<void> {
    this.applied.delete(request.subscriptionId);
    await Promise.resolve();
  }
  public normalize(payload: unknown): unknown {
    return payload;
  }
  public emit(message: NativeMessage, index = this.callbacks.length - 1): RealtimeResult<string> {
    const context = this.callbacks[index];
    if (!context) throw new Error("not connected");
    return context.callbacks.observation(message);
  }
  public heartbeat(index = this.callbacks.length - 1): void {
    this.callbacks[index]?.callbacks.heartbeat();
  }
  public interrupt(index = this.callbacks.length - 1): void {
    this.callbacks[index]?.callbacks.disconnected();
  }
}
