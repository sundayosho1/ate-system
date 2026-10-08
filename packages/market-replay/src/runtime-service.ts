import { z } from "zod";
import { schemas } from "@ate/domain";
import type { EffectiveConfiguration } from "@ate/configuration";
import type { Clock } from "@ate/time";
import { buildRuntime, serviceDescriptor, serviceId } from "@ate/runtime";
import type { RuntimeManagedService, BuildRuntimeInput } from "@ate/runtime";
import { stateDomain, stateOwner } from "@ate/persistence";
import type { StateAuthorityRegistry } from "@ate/persistence";
import type {
  EventRegistry,
  EventFactory,
  InternalEventBus,
  EventTypeRegistration,
  ATEEvent,
} from "@ate/events";
import { canonicalRevisionId, hash, freeze } from "@ate/multitimeframe";
import { createGovernedReplaySpecification } from "./specification.js";
import { replayFromEffective } from "./configuration.js";
import { ReplayController } from "./controller.js";
import type { ReplayCommandResult } from "./controller.js";
import type { ReplayCheckpointRepository } from "./repository.js";
import type {
  ReplayResolvedInputs,
  ReplaySessionSpecification,
  ReplayCheckpoint,
} from "./types.js";
export const replayControlEvent = {
  eventType: "data.replay.control.v1",
  version: 1,
  category: "OPERATIONAL",
  schema: z
    .object({
      sessionId: z.string().max(128),
      checkpointId: z.string().regex(/^[a-f0-9]{64}$/u),
      state: z.string().max(32),
      logicalTime: schemas.timestamp,
      cursor: z.number().int().nonnegative(),
      researchOnly: z.literal(true),
    })
    .strict(),
  description: "Replay checkpoint summaries; durable state remains with the replay repository.",
  owner: "@ate/market-replay",
} satisfies EventTypeRegistration;
export function registerReplayAuthority(registry: StateAuthorityRegistry) {
  return registry.register({
    stateDomain: stateDomain("data.replay.sessions"),
    owner: stateOwner("marketreplay"),
    authorityType: "DERIVED",
    writeAuthority: "@ate/market-replay",
    readers: [
      "@ate/runtime",
      "@ate/historical-data",
      "@ate/data-quality",
      "@ate/dataset-catalogue",
    ],
    durable: true,
    historyRequired: true,
    reconciliationRequired: true,
    runtimeModes: ["DEVELOPMENT", "RESEARCH", "SIMULATION"],
    description:
      "Owned offline session/cursor/checkpoint/branch state; no financial execution authority.",
  });
}
export type ReplayRuntimePorts = Readonly<{
  clock: Clock;
  configuration: () => EffectiveConfiguration;
  authority: StateAuthorityRegistry;
  eventRegistry: EventRegistry;
  eventFactory: EventFactory;
  eventBus: InternalEventBus;
}>;
export class ReplayRuntimeService {
  public readonly managedService: RuntimeManagedService;
  private lifecycle: "CREATED" | "READY" | "STOPPING" | "STOPPED" | "FAILED" = "CREATED";
  private busy = false;
  private readonly sessions = new Map<string, ReplayController>();
  private readonly pendingEvents = new Map<string, ReplayCheckpoint>();
  private readonly pendingEnvelopes = new Map<string, ATEEvent>();
  public constructor(private readonly ports: ReplayRuntimePorts) {
    const id = serviceId("data.replay");
    this.managedService = {
      descriptor: serviceDescriptor({
        serviceId: id,
        name: "Deterministic Market-Data Replay",
        version: "0.19.0-market-replay.1",
        description: "Bounded offline research session orchestration.",
        criticality: "OPTIONAL",
        supportedModes: ["DEVELOPMENT", "RESEARCH", "SIMULATION"],
        capabilities: ["MARKET_DATA_READ"],
        degradationPolicy: "CONTINUE_WITHOUT_CAPABILITY",
        healthCapability: true,
        readinessCapability: true,
        recoverable: true,
      }),
      initialize: async () => {
        await Promise.resolve();
        if (this.lifecycle !== "CREATED") throw Error("REPLAY_RUNTIME_LIFECYCLE");
        const owned = registerReplayAuthority(this.ports.authority);
        if (!owned.ok) throw Error(owned.error.code);
        const registered = this.ports.eventRegistry.register(replayControlEvent);
        if (!registered.ok) throw Error(registered.error.code);
        this.lifecycle = "READY";
      },
      stop: () => this.shutdown(),
      checkHealth: async () => {
        await Promise.resolve();
        const ready = this.ready();
        return {
          serviceId: id,
          timestamp: this.ports.clock.now(),
          status: ready ? "HEALTHY" : "DEGRADED",
          reason: ready
            ? "Offline session authorities ready"
            : "Lifecycle, configuration, event or recovery obligation",
          details: this.diagnostics(),
        };
      },
      checkReadiness: async () => {
        await Promise.resolve();
        return {
          serviceId: id,
          timestamp: this.ports.clock.now(),
          status: this.ready() ? "READY" : "NOT_READY",
          reason: "Offline research only; no trading approval",
          details: this.diagnostics(),
        };
      },
    };
  }
  public diagnostics() {
    return freeze({
      lifecycle: this.lifecycle,
      sessions: this.sessions.size,
      pendingControlEvents: this.pendingEvents.size,
      busy: this.busy,
      researchOnly: true,
      tradingAuthorized: false,
      sessionStates: [...this.sessions.values()].map((c) => c.diagnostics()),
    });
  }
  private ready(): boolean {
    const effective = this.ports.configuration();
    return (
      this.lifecycle === "READY" &&
      !this.busy &&
      !this.pendingEvents.size &&
      replayFromEffective(effective).enabled &&
      [...this.sessions.values()].every(
        (c) =>
          c.specification.configurationFingerprint === effective.fingerprint &&
          !c.diagnostics().obligation &&
          !c.diagnostics().pendingConsumerReads &&
          !["FAILED", "STOPPING", "RECOVERY_REQUIRED"].includes(c.diagnostics().state),
      )
    );
  }
  public async admit(
    raw: unknown,
    inputs: ReplayResolvedInputs,
    repository: ReplayCheckpointRepository,
  ): Promise<ReplayController> {
    if (this.lifecycle !== "READY" || this.busy) throw Error("REPLAY_ADMISSION_NOT_READY");
    if (this.pendingEvents.size) throw Error("CONTROL_PUBLICATION_REQUIRED");
    const specification = createGovernedReplaySpecification(raw, this.ports.configuration());
    if (this.sessions.has(specification.sessionId)) throw Error("SESSION_IDENTITY_CONFLICT");
    if (this.sessions.size >= specification.resourceLimits.maxSessions)
      throw Error("SESSION_CAPACITY");
    this.busy = true;
    try {
      // Construction is pure, but can reject incompatible immutable inputs.
      // Every operation after acquiring the lock must share its cleanup guard.
      const controller = new ReplayController(specification, inputs, repository);
      this.sessions.set(specification.sessionId, controller);
      const initialized = await controller.initialize();
      if (!initialized.ok) {
        // Cancellation without an acknowledged checkpoint or repository obligation
        // can remove its side-effect-free provisional registration; retain
        // failures with checkpoint content or uncertain repository commitments.
        if (
          initialized.code === "STOP_REQUESTED" &&
          !controller.currentCheckpoint() &&
          !controller.diagnostics().obligation
        )
          this.sessions.delete(specification.sessionId);
        throw Error(initialized.code);
      }
      if (this.lifecycle !== "READY") throw Error("SHUTDOWN_DURING_ADMISSION");
      await this.emit(initialized.checkpoint);
      return controller;
    } finally {
      this.busy = false;
    }
  }
  public async adoptVerifiedBranch(controller: ReplayController): Promise<void> {
    if (this.lifecycle !== "READY" || this.busy) throw Error("REPLAY_ADMISSION_NOT_READY");
    if (this.pendingEvents.size) throw Error("CONTROL_PUBLICATION_REQUIRED");
    const { fingerprint: _fp, ...raw } = controller.specification;
    createGovernedReplaySpecification(raw, this.ports.configuration());
    const cp = controller.currentCheckpoint();
    if (
      !cp?.branch ||
      controller.diagnostics().busy ||
      controller.diagnostics().obligation ||
      controller.diagnostics().pendingConsumerReads
    )
      throw Error("UNVERIFIED_BRANCH_ADMISSION");
    if (this.sessions.has(cp.sessionId)) throw Error("SESSION_IDENTITY_CONFLICT");
    if (this.sessions.size >= replayFromEffective(this.ports.configuration()).limits.maxSessions)
      throw Error("SESSION_CAPACITY");
    this.busy = true;
    this.sessions.set(cp.sessionId, controller);
    try {
      await this.emit(cp);
    } finally {
      this.busy = false;
    }
  }
  public async command(
    sessionId: string,
    operation: (controller: ReplayController) => Promise<ReplayCommandResult>,
  ): Promise<ReplayCommandResult> {
    if (this.lifecycle !== "READY" || this.busy) throw Error("REPLAY_RUNTIME_NOT_READY");
    if (this.pendingEvents.size) throw Error("CONTROL_PUBLICATION_REQUIRED");
    const c = this.sessions.get(sessionId);
    if (!c) throw Error("SESSION_NOT_FOUND");
    if (c.specification.configurationFingerprint !== this.ports.configuration().fingerprint)
      throw Error("CONFIGURATION_DRIFT");
    this.busy = true;
    try {
      const result = await operation(c);
      if (result.ok) await this.emit(result.checkpoint);
      return result;
    } finally {
      this.busy = false;
    }
  }
  private async emit(cp: ReplayCheckpoint): Promise<void> {
    // Bound unacknowledged checkpoint summaries; never overwrite an earlier publication obligation.
    const key = hash({
      session: cp.sessionId,
      generation: cp.generation,
      fingerprint: cp.fingerprint,
    });
    const limit = replayFromEffective(this.ports.configuration()).limits.maxEvidenceRecords;
    if (!this.pendingEvents.has(key) && this.pendingEvents.size >= limit)
      throw Error("CONTROL_EVENT_CAPACITY");
    this.pendingEvents.set(key, cp);
    const cached = this.pendingEnvelopes.get(key);
    const event = cached
      ? { ok: true as const, value: cached }
      : this.ports.eventFactory.createRootEvent({
          eventType: replayControlEvent.eventType,
          eventId: schemas.eventId.parse(
            canonicalRevisionId(
              hash({
                session: cp.sessionId,
                generation: cp.generation,
                fingerprint: cp.fingerprint,
              }),
            ),
          ),
          payload: {
            sessionId: cp.sessionId,
            checkpointId: cp.checkpointId,
            state: cp.state,
            logicalTime: cp.logicalTime,
            cursor: cp.cursor,
            researchOnly: true,
          },
        });
    if (!event.ok) throw Error(event.error.code);
    if (!["DEVELOPMENT", "RESEARCH", "SIMULATION"].includes(event.value.envelope.runtimeMode))
      throw Error("REPLAY_EVENT_MODE");
    this.pendingEnvelopes.set(key, event.value);
    const published = await this.ports.eventBus.publish(event.value);
    if (!["DELIVERED", "ACCEPTED", "DUPLICATE"].includes(published.status))
      throw Error("REPLAY_CONTROL_PUBLICATION_FAILED");
    this.pendingEvents.delete(key);
    this.pendingEnvelopes.delete(key);
  }
  public async retryControlEvents(): Promise<void> {
    for (const cp of [...this.pendingEvents.values()]) await this.emit(cp);
  }
  public async shutdown(): Promise<void> {
    if (this.lifecycle === "STOPPED") return;
    this.lifecycle = "STOPPING";
    let failed = this.busy;
    for (const c of this.sessions.values()) {
      if (c.diagnostics().state === "COMPLETED" && !c.diagnostics().obligation) continue;
      const stopped = await c.stop();
      if (!stopped.ok) failed = true;
      else {
        try {
          await this.emit(stopped.checkpoint);
        } catch {
          failed = true;
        }
      }
    }
    if (this.pendingEvents.size) failed = true;
    if (failed) throw Error("REPLAY_SHUTDOWN_OBLIGATION");
    this.lifecycle = "STOPPED";
  }
  public sessionSpecifications(): readonly ReplaySessionSpecification[] {
    return freeze([...this.sessions.values()].map((c) => c.specification));
  }
}
/** Compose through the existing Prompt 3 application runtime; no second lifecycle authority. */
export function buildReplayResearchRuntime(
  service: ReplayRuntimeService,
  input: Omit<BuildRuntimeInput, "services" | "capabilities">,
) {
  return buildRuntime({
    ...input,
    services: [service.managedService],
    capabilities: ["MARKET_DATA_READ"],
  });
}
