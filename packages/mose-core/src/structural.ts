import type { Command, Policy, Session, State } from "./contracts.js";

const pending = (s: Session) =>
  s.observations.some((o) => o.outcome === "PENDING" || o.outcome === "DEFERRED");

/** Historical structure only. Current owner authority and local shutdown intent stay outside. */
export function validateTransition(
  state: State,
  command: Command,
  policy: Policy,
  previousCommand: Command | undefined,
): void {
  if (previousCommand?.kind === "STOP") throw Error("RUNTIME_NOT_READY");
  if (command.kind === "CREATE") {
    if (
      state.sessions.length >= policy.maxSessions ||
      state.sessions.some((s) => s.universe.sessionId === command.sessionId)
    )
      throw Error("RESOURCE_BUDGET_EXCEEDED");
    if (
      command.instruments.length > policy.maxInstruments ||
      new Set(command.instruments.map((i) => i.instrumentId)).size !== command.instruments.length ||
      command.maker.actorId === command.checker.actorId ||
      !command.maker.actorId ||
      !command.checker.actorId
    )
      throw Error("UNIVERSE_NOT_AUTHORIZED");
    if (command.previousUniverse !== null) {
      const predecessor = state.sessions.find(
        (s) => s.universe.fingerprint === command.previousUniverse,
      );
      if (
        !predecessor ||
        !["PAUSED", "COMPLETED", "STOPPED"].includes(predecessor.status) ||
        pending(predecessor)
      )
        throw Error("UNIVERSE_NOT_AUTHORIZED");
    }
    return;
  }
  if (command.kind === "STOP") {
    if (state.sessions.some(pending)) throw Error("PROCESSING_DEFERRED");
    return;
  }
  const session = state.sessions.find((s) => s.universe.sessionId === command.sessionId);
  if (!session) throw Error("UNIVERSE_NOT_AUTHORIZED");
  if (command.kind === "START") {
    if (!["READY", "RUNNING", "PAUSED"].includes(session.status)) throw Error("RUNTIME_NOT_READY");
  } else if (command.kind === "PAUSE") {
    if (!["RUNNING", "PAUSED"].includes(session.status)) throw Error("RUNTIME_NOT_READY");
  } else if (command.kind === "COMPLETE") {
    if (
      !["RUNNING", "PAUSED"].includes(session.status) ||
      session.cursor !== session.universe.plan.length ||
      pending(session) ||
      session.universe.members.some((m) => m.eligible && !m.sourceReady)
    )
      throw Error("PROCESSING_DEFERRED");
  } else if (command.kind === "RECEIVE") {
    if (
      !["RUNNING", "PAUSED"].includes(session.status) ||
      command.universeSnapshot !== session.universe.fingerprint
    )
      throw Error("UNIVERSE_NOT_AUTHORIZED");
    if (
      session.observations.some(
        (o) => o.plan.eventId === command.eventId && o.instrumentId === command.instrumentId,
      )
    )
      throw Error("DUPLICATE_OBSERVATION");
    const next = session.universe.plan[session.cursor];
    if (!next || next.eventId !== command.eventId || next.instrumentId !== command.instrumentId)
      throw Error("OUT_OF_ORDER_OBSERVATION");
    if (
      state.sessions.reduce((n, s) => n + s.observations.length, 0) >= policy.maxRetained ||
      state.sessions.reduce(
        (n, s) =>
          n + s.observations.filter((o) => ["PENDING", "DEFERRED"].includes(o.outcome)).length,
        0,
      ) >= policy.maxQueued
    )
      throw Error("RESOURCE_BUDGET_EXCEEDED");
  } else if (
    command.kind === "PROCESS" &&
    (command.limit > policy.maxBatch ||
      command.limit > policy.maxAuditBatch ||
      !["RUNNING", "PAUSED"].includes(session.status))
  )
    throw Error("RESOURCE_BUDGET_EXCEEDED");
  // PAUSED processing is structurally possible during local shutdown drain. Live dispatch
  // separately requires that local intent; recovery cannot invent or replay volatile intent.
}
