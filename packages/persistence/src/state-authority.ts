import type { RuntimeClock } from "@ate/runtime";

import { persistenceError } from "./errors.js";
import type {
  PersistenceResult,
  StateDomain,
  StateMutation,
  StateOwner,
  StateOwnershipEntry,
} from "./types.js";

export class StateAuthorityRegistry {
  private readonly entries = new Map<StateDomain, StateOwnershipEntry>();

  public constructor(private readonly clock: RuntimeClock) {}

  public register(entry: StateOwnershipEntry): PersistenceResult<StateOwnershipEntry> {
    if (this.entries.has(entry.stateDomain)) {
      return {
        ok: false,
        error: persistenceError({
          code: "DUPLICATE_RECORD",
          message: `state authority already registered: ${entry.stateDomain}`,
          timestamp: this.clock.now(),
        }),
      };
    }
    this.entries.set(entry.stateDomain, freeze({ ...entry }));
    return { ok: true, value: entry };
  }

  public require(domain: StateDomain): PersistenceResult<StateOwnershipEntry> {
    const entry = this.entries.get(domain);
    if (entry === undefined) {
      return {
        ok: false,
        error: persistenceError({
          code: "PERSISTENCE_NOT_READY",
          message: `state domain has no registered owner: ${domain}`,
          timestamp: this.clock.now(),
        }),
      };
    }
    return { ok: true, value: entry };
  }

  public validateMutation(mutation: StateMutation): PersistenceResult<StateOwnershipEntry> {
    const entry = this.require(mutation.stateDomain);
    if (!entry.ok) {
      return entry;
    }
    if (entry.value.owner !== mutation.owner) {
      return {
        ok: false,
        error: persistenceError({
          code: "ENVIRONMENT_ISOLATION_VIOLATION",
          message: `state mutation owner ${mutation.owner} does not match authority ${entry.value.owner}`,
          timestamp: this.clock.now(),
        }),
      };
    }
    if (!entry.value.runtimeModes.includes(mutation.runtimeMode)) {
      return {
        ok: false,
        error: persistenceError({
          code: "ENVIRONMENT_ISOLATION_VIOLATION",
          message: `state domain ${mutation.stateDomain} is not authorized in runtime mode ${mutation.runtimeMode}`,
          timestamp: this.clock.now(),
        }),
      };
    }
    return entry;
  }

  public all(): readonly StateOwnershipEntry[] {
    return freeze([...this.entries.values()].map((entry) => ({ ...entry })));
  }
}

export const stateDomain = (value: string): StateDomain => {
  if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/u.test(value)) {
    throw new Error(`invalid state domain: ${value}`);
  }
  return value as StateDomain;
};

export const stateOwner = (value: string): StateOwner => {
  if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/u.test(value)) {
    throw new Error(`invalid state owner: ${value}`);
  }
  return value as StateOwner;
};

export const freeze = <T>(value: T): T => {
  if (value instanceof AbortSignal) {
    return value;
  }
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      freeze(nested);
    }
  }
  return value;
};
