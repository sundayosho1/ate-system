import type { RuntimeMode } from "@ate/domain";

import { lifecycleError } from "./primitives.js";
import type { LifecycleError, RuntimeClock, RuntimeManagedService, ServiceId } from "./types.js";

export type RuntimeGraph = Readonly<{
  servicesById: ReadonlyMap<ServiceId, RuntimeManagedService>;
  startupOrder: readonly ServiceId[];
  shutdownOrder: readonly ServiceId[];
  dependantsById: ReadonlyMap<ServiceId, readonly ServiceId[]>;
}>;

export type GraphValidationResult =
  | Readonly<{
      ok: true;
      graph: RuntimeGraph;
    }>
  | Readonly<{
      ok: false;
      errors: readonly LifecycleError[];
    }>;

export const buildDependencyGraph = (
  services: readonly RuntimeManagedService[],
  mode: RuntimeMode,
  clock: RuntimeClock,
): GraphValidationResult => {
  const errors: LifecycleError[] = [];
  const servicesById = new Map<ServiceId, RuntimeManagedService>();

  for (const service of services) {
    const { serviceId } = service.descriptor;
    if (servicesById.has(serviceId)) {
      errors.push(
        lifecycleError(
          "DUPLICATE_SERVICE",
          `duplicate service ID: ${serviceId}`,
          clock.now(),
          serviceId,
        ),
      );
      continue;
    }
    servicesById.set(serviceId, service);
  }

  for (const service of services) {
    const { serviceId, dependencies, optionalDependencies, supportedModes } = service.descriptor;

    if (!supportedModes.includes(mode)) {
      errors.push(
        lifecycleError(
          "UNSUPPORTED_RUNTIME_MODE",
          `service ${serviceId} does not support runtime mode ${mode}`,
          clock.now(),
          serviceId,
        ),
      );
    }

    for (const dependencyId of dependencies) {
      if (dependencyId === serviceId || !servicesById.has(dependencyId)) {
        errors.push(
          lifecycleError(
            "MISSING_DEPENDENCY",
            `service ${serviceId} requires missing dependency ${dependencyId}`,
            clock.now(),
            serviceId,
            { dependencyId },
          ),
        );
      }
    }

    for (const dependencyId of optionalDependencies) {
      if (dependencyId === serviceId) {
        errors.push(
          lifecycleError(
            "MISSING_DEPENDENCY",
            `service ${serviceId} declares itself as an optional dependency`,
            clock.now(),
            serviceId,
            { dependencyId },
          ),
        );
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const sortedIds = Array.from(servicesById.keys()).sort();
  const visiting = new Set<ServiceId>();
  const visited = new Set<ServiceId>();
  const startupOrder: ServiceId[] = [];

  const visit = (serviceId: ServiceId, path: ServiceId[]): void => {
    if (visited.has(serviceId)) {
      return;
    }
    if (visiting.has(serviceId)) {
      errors.push(
        lifecycleError(
          "CIRCULAR_DEPENDENCY",
          `circular dependency detected: ${[...path, serviceId].join(" -> ")}`,
          clock.now(),
          serviceId,
          { path: [...path, serviceId] },
        ),
      );
      return;
    }

    visiting.add(serviceId);
    const service = servicesById.get(serviceId);
    if (service === undefined) {
      return;
    }

    for (const dependencyId of [...service.descriptor.dependencies].sort()) {
      visit(dependencyId, [...path, serviceId]);
    }

    visiting.delete(serviceId);
    visited.add(serviceId);
    startupOrder.push(serviceId);
  };

  for (const serviceId of sortedIds) {
    visit(serviceId, []);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const dependantsById = new Map<ServiceId, ServiceId[]>();
  for (const serviceId of sortedIds) {
    dependantsById.set(serviceId, []);
  }
  for (const service of servicesById.values()) {
    for (const dependencyId of service.descriptor.dependencies) {
      dependantsById.get(dependencyId)?.push(service.descriptor.serviceId);
    }
  }
  for (const [serviceId, dependants] of dependantsById) {
    dependantsById.set(serviceId, dependants.sort());
  }

  return {
    ok: true,
    graph: {
      servicesById,
      startupOrder,
      shutdownOrder: [...startupOrder].reverse(),
      dependantsById,
    },
  };
};
