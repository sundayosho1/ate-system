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
import { validateReplayCheckpoint } from "./checkpoint.js";
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
type ControlPublication = {
  readonly checkpoint: ReplayCheckpoint;
  readonly specification: ReplaySessionSpecification;
  phase: "PENDING" | "PREPARING" | "PUBLISHING" | "FAILED" | "UNCERTAIN";
  uncertain: boolean;
  envelope?: ATEEvent;
};
export class ReplayRuntimeService {
  public readonly managedService: RuntimeManagedService;
  private lifecycle: "CREATED" | "READY" | "STOPPING" | "STOPPED" | "FAILED" = "CREATED";
  private busy = false;
  private readonly sessions = new Map<string, ReplayController>();
  private readonly pendingEvents = new Map<string, ControlPublication>();
  private readonly disposedAdmissions: Readonly<{
    sessionId: string;
    specificationFingerprint: string;
    at: ReturnType<Clock["now"]>;
    failureCode: string;
    sourceVerification: string;
    repositoryPhase: string;
  }>[] = [];
  private evictedAdmissionDiagnostics = 0;
  private failedAdmissionDiagnosticSamples = 0;
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
      controlPublications: [...this.pendingEvents.values()].map((p) => ({
        sessionId: p.checkpoint.sessionId,
        checkpointId: p.checkpoint.checkpointId,
        generation: p.checkpoint.generation,
        configurationFingerprint: p.specification.configurationFingerprint,
        phase: p.phase,
        uncertain: p.uncertain,
      })),
      busy: this.busy,
      researchOnly: true,
      tradingAuthorized: false,
      sessionStates: [...this.sessions.values()].map((c) => c.diagnostics()),
      disposedAdmissions: [...this.disposedAdmissions],
      evictedAdmissionDiagnostics: this.evictedAdmissionDiagnostics,
      failedAdmissionDiagnosticSamples: this.failedAdmissionDiagnosticSamples,
    });
  }
  private ready(): boolean {
    // An unresolved operation is unavailable without invoking another fallible reader.
    if (this.lifecycle !== "READY" || this.busy || this.pendingEvents.size) return false;
    const effective = this.ports.configuration();
    return (
      this.lifecycle === "READY" &&
      !this.busy &&
      !this.pendingEvents.size &&
      replayFromEffective(effective).enabled &&
      [...this.sessions.values()].every((c) => {
        const diagnostic = c.diagnostics();
        return (
          c.specification.configurationFingerprint === effective.fingerprint &&
          !!c.currentCheckpoint() &&
          diagnostic.sourceVerification === "VERIFIED" &&
          !diagnostic.busy &&
          !diagnostic.obligation &&
          !diagnostic.pendingConsumerReads &&
          ["READY", "RUNNING", "PAUSED", "STOPPED", "COMPLETED"].includes(diagnostic.state)
        );
      })
    );
  }
  private disposeProvisionalAdmission(controller: ReplayController, failureCode: string): void {
    const specification = controller.specification;
    if (
      !controller.canDisposeProvisionalAdmission() ||
      this.sessions.get(specification.sessionId) !== controller ||
      [...this.pendingEvents.values()].some(
        (p) => p.checkpoint.sessionId === specification.sessionId,
      )
    )
      return;
    // Exact-owner disposal is complete before optional sampling, under the lock.
    this.sessions.delete(specification.sessionId);
    try {
      const diagnostic = controller.diagnostics();
      this.disposedAdmissions.push(
        freeze({
          sessionId: specification.sessionId,
          specificationFingerprint: specification.fingerprint,
          at: this.ports.clock.now(),
          failureCode: diagnostic.lastFailureCode ?? failureCode,
          sourceVerification: diagnostic.sourceVerification,
          repositoryPhase: diagnostic.repositoryPhase,
        }),
      );
      const excess =
        this.disposedAdmissions.length - specification.resourceLimits.maxEvidenceRecords;
      if (excess > 0) {
        this.disposedAdmissions.splice(0, excess);
        this.evictedAdmissionDiagnostics = Math.min(
          Number.MAX_SAFE_INTEGER,
          this.evictedAdmissionDiagnostics + excess,
        );
      }
    } catch {
      // No fabricated timestamp or sample; failed sampling is a bounded scalar.
      this.failedAdmissionDiagnosticSamples = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.failedAdmissionDiagnosticSamples + 1,
      );
    }
  }
  public async admit(
    raw: unknown,
    inputs: ReplayResolvedInputs,
    repository: ReplayCheckpointRepository,
  ): Promise<ReplayController> {
    if (this.lifecycle !== "READY" || this.busy) throw Error("REPLAY_ADMISSION_NOT_READY");
    this.busy = true;
    try {
      const specification = createGovernedReplaySpecification(raw, this.ports.configuration());
      if (this.lifecycle !== "READY") throw Error("REPLAY_ADMISSION_NOT_READY");
      if (this.sessions.has(specification.sessionId)) throw Error("SESSION_IDENTITY_CONFLICT");
      if (this.pendingEvents.size) throw Error("CONTROL_PUBLICATION_REQUIRED");
      if (this.sessions.size >= specification.resourceLimits.maxSessions)
        throw Error("SESSION_CAPACITY");
      this.requirePublicationCapacity(specification);
      // Construction is pure, but can reject incompatible immutable inputs.
      // Every operation after acquiring the lock must share its cleanup guard.
      const controller = new ReplayController(specification, inputs, repository);
      this.sessions.set(specification.sessionId, controller);
      let initialized: ReplayCommandResult;
      try {
        initialized = await controller.initialize();
      } catch (error) {
        // An unexpected rejection is not a repository certificate. The controller
        // finalizes from its own provenance; only proven provisional owners go.
        initialized = controller.containInitializationException(error);
      }
      if (!initialized.ok) {
        const acknowledged = controller.currentCheckpoint();
        if (acknowledged) this.retainPublication(acknowledged, specification);
        this.disposeProvisionalAdmission(controller, initialized.code);
        throw Error(initialized.code);
      }
      const publication = this.retainPublication(initialized.checkpoint, specification);
      if (this.lifecycle !== "READY") throw Error("SHUTDOWN_DURING_ADMISSION");
      await this.emit(publication);
      if (this.lifecycle !== "READY") throw Error("SHUTDOWN_DURING_ADMISSION");
      return controller;
    } finally {
      this.busy = false;
    }
  }
  public async adoptVerifiedBranch(controller: ReplayController): Promise<void> {
    if (this.lifecycle !== "READY" || this.busy) throw Error("REPLAY_ADMISSION_NOT_READY");
    if (this.pendingEvents.size) throw Error("CONTROL_PUBLICATION_REQUIRED");
    this.busy = true;
    try {
      const { fingerprint: _fp, ...raw } = controller.specification;
      const specification = createGovernedReplaySpecification(raw, this.ports.configuration());
      if (this.lifecycle !== "READY") throw Error("REPLAY_ADMISSION_NOT_READY");
      const cp = controller.currentCheckpoint();
      if (
        !cp?.branch ||
        controller.diagnostics().busy ||
        controller.diagnostics().obligation ||
        controller.diagnostics().pendingConsumerReads
      )
        throw Error("UNVERIFIED_BRANCH_ADMISSION");
      if (this.sessions.has(cp.sessionId)) throw Error("SESSION_IDENTITY_CONFLICT");
      if (this.sessions.size >= specification.resourceLimits.maxSessions)
        throw Error("SESSION_CAPACITY");
      this.requirePublicationCapacity(specification);
      this.sessions.set(cp.sessionId, controller);
      await this.emit(this.retainPublication(cp, specification));
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
    this.busy = true;
    const previous = c.currentCheckpoint();
    try {
      if (c.specification.configurationFingerprint !== this.ports.configuration().fingerprint)
        throw Error("CONFIGURATION_DRIFT");
      if (this.lifecycle !== "READY") throw Error("REPLAY_RUNTIME_NOT_READY");
      this.requirePublicationCapacity(c.specification);
      const result = await operation(c);
      // The callback reports an operation; only this owner certifies its ACK.
      // Retain before inspecting even result.ok or any reported checkpoint getter.
      const publication = this.retainAdvancedCheckpoint(c, previous);
      const ok = result.ok;
      if (ok === true) {
        const acknowledged = publication?.checkpoint ?? c.currentCheckpoint();
        const diagnostic = c.diagnostics();
        if (
          !acknowledged ||
          diagnostic.busy ||
          diagnostic.obligation ||
          !["READY", "RUNNING", "PAUSED", "STOPPED", "COMPLETED"].includes(diagnostic.state)
        )
          throw Error("REPLAY_COMMAND_ACKNOWLEDGEMENT_REQUIRED");
        // Validate the report after retention, then reconcile valid stale success
        // to the actual ACK. A no-op cannot claim a different acknowledged identity.
        const reported = validateReplayCheckpoint(result.checkpoint, c.specification);
        if (
          !publication &&
          (reported.generation !== acknowledged.generation ||
            reported.fingerprint !== acknowledged.fingerprint)
        )
          throw Error("REPLAY_COMMAND_RESULT_MISMATCH");
        if (publication) await this.emit(publication);
        return { ok: true, checkpoint: acknowledged };
      }
      if (ok !== false) throw Error("REPLAY_COMMAND_RESULT_INVALID");
      return result;
    } catch (error) {
      // A caller can reject after its owner acknowledged real work. Do not infer
      // noncommitment from that rejection or lose the last actual acknowledgement.
      this.retainAdvancedCheckpoint(c, previous);
      throw error;
    } finally {
      this.busy = false;
    }
  }
  private retainAdvancedCheckpoint(
    controller: ReplayController,
    previous: ReplayCheckpoint | undefined,
  ): ControlPublication | undefined {
    const acknowledged = controller.currentCheckpoint();
    // Semantic checkpointId excludes generation/state. For this same immutable
    // owner, generation and full fingerprint identify the existing storage ACK
    // without another fallible hash/configuration/diagnostic call before retention.
    if (
      acknowledged &&
      (acknowledged.generation !== previous?.generation ||
        acknowledged.fingerprint !== previous?.fingerprint)
    )
      return this.retainPublication(acknowledged, controller.specification);
    return undefined;
  }
  private publicationCapacity(specification: ReplaySessionSpecification): number {
    return Math.min(
      specification.resourceLimits.maxEvidenceRecords,
      ...[...this.sessions.values()].map((c) => c.specification.resourceLimits.maxEvidenceRecords),
    );
  }
  private requirePublicationCapacity(specification: ReplaySessionSpecification): void {
    // Check the authenticated immutable limit before requesting a new acknowledgement.
    if (this.pendingEvents.size >= this.publicationCapacity(specification))
      throw Error("CONTROL_EVENT_CAPACITY");
  }
  private retainPublication(
    checkpoint: ReplayCheckpoint,
    specification: ReplaySessionSpecification,
  ): ControlPublication {
    // Linearization point: under the runtime lock, immediately after acknowledgement,
    // before configuration, hashing, envelope preparation or any external callback.
    const key = checkpoint.checkpointId;
    const existing = this.pendingEvents.get(key);
    if (existing) return existing;
    const publication: ControlPublication = {
      checkpoint,
      specification,
      phase: "PENDING",
      uncertain: false,
    };
    this.pendingEvents.set(key, publication);
    return publication;
  }
  private async emit(publication: ControlPublication): Promise<void> {
    if (this.pendingEvents.values().next().value !== publication)
      throw Error("CONTROL_PUBLICATION_ORDER");
    const cp = publication.checkpoint;
    let dispatchStarted = false;
    let dispatchSettled = false;
    publication.phase = "PREPARING";
    try {
      const { fingerprint: _fp, ...raw } = publication.specification;
      createGovernedReplaySpecification(raw, this.ports.configuration());
      const cached = publication.envelope;
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
      publication.envelope = event.value;
      publication.phase = "PUBLISHING";
      dispatchStarted = true;
      const published = await this.ports.eventBus.publish(event.value);
      const status = published.status;
      if (["REJECTED", "DEAD_LETTERED"].includes(status)) dispatchSettled = true;
      if (!["DELIVERED", "ACCEPTED", "DUPLICATE"].includes(status))
        throw Error("REPLAY_CONTROL_PUBLICATION_FAILED");
      dispatchSettled = true;
      this.pendingEvents.delete(cp.checkpointId);
    } catch (error) {
      // Rejected dispatch may have delivered before reporting failed. Preparation
      // failures cannot erase that prior uncertainty, or the original envelope.
      publication.uncertain ||= dispatchStarted && !dispatchSettled;
      publication.phase = publication.uncertain ? "UNCERTAIN" : "FAILED";
      throw error;
    }
  }
  public async retryControlEvents(): Promise<void> {
    if (this.busy) throw Error("REPLAY_RUNTIME_NOT_READY");
    this.busy = true;
    try {
      // Insertion order; first failure preserves the failed suffix and stops retry.
      for (const publication of [...this.pendingEvents.values()]) await this.emit(publication);
    } finally {
      this.busy = false;
    }
  }
  public async shutdown(): Promise<void> {
    if (this.lifecycle === "STOPPED") return;
    this.lifecycle = "STOPPING";
    if (this.busy) {
      // Signal active owner cancellation, but never start a second checkpoint write.
      for (const c of this.sessions.values()) c.requestStop();
      throw Error("REPLAY_SHUTDOWN_OBLIGATION");
    }
    if (this.pendingEvents.size) throw Error("REPLAY_SHUTDOWN_OBLIGATION");
    this.busy = true;
    try {
      let failed = false;
      for (const c of this.sessions.values()) {
        if (c.diagnostics().state === "COMPLETED" && !c.diagnostics().obligation) continue;
        // At capacity, defer untouched owners instead of acknowledging an unretainable summary.
        if (this.pendingEvents.size >= this.publicationCapacity(c.specification)) {
          failed = true;
          break;
        }
        const stopped = await c.stop();
        if (!stopped.ok) failed = true;
        else {
          try {
            await this.emit(this.retainPublication(stopped.checkpoint, c.specification));
          } catch {
            failed = true;
          }
        }
      }
      if (this.pendingEvents.size) failed = true;
      if (failed) throw Error("REPLAY_SHUTDOWN_OBLIGATION");
      this.lifecycle = "STOPPED";
    } finally {
      this.busy = false;
    }
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
