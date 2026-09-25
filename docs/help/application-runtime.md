# Help: Application Runtime

## Runtime overview

ATE Runtime starts, supervises, degrades, recovers, snapshots, and stops runtime-managed services in
deterministic dependency order.

Prompt 3 runtime services are harmless foundation/dummy services in tests only. No market
connectivity or trading exists.

## Runtime states

- `CREATED`: runtime constructed but not started.
- `INITIALIZING`: services are initializing.
- `STARTING`: services are starting.
- `RUNNING`: startup admission passed.
- `DEGRADED`: one or more services/capabilities are degraded but operation may continue within
  limits.
- `RECOVERING`: explicit recovery is underway.
- `STOPPING`: controlled shutdown is underway.
- `STOPPED`: shutdown completed.
- `FAILED`: startup/admission/recovery failure made runtime unsafe.

## Service states

- `REGISTERED`
- `INITIALIZING`
- `INITIALIZED`
- `STARTING`
- `RUNNING`
- `DEGRADED`
- `RECOVERING`
- `STOPPING`
- `STOPPED`
- `FAILED`

## Runtime modes

Modes are DEVELOPMENT, RESEARCH, BACKTEST, SIMULATION, PAPER, and LIVE.

Mode must be explicit. Missing or invalid mode fails closed. LIVE mode does not grant live trading
capability.

## Health vs readiness

Health means a service appears alive/functioning.

Readiness means it is safe/capable for its workload.

Example: A future MT5 gateway process may be alive but not ready if broker state is unsynchronized.

## Service criticality

- `CRITICAL`: unsafe if failed.
- `REQUIRED`: needed for normal readiness.
- `OPTIONAL`: can fail with controlled degradation.

## Graceful degradation

Degradation records the service, reason, affected capabilities, affected dependants, recoverability,
and current readiness.

## Startup failure

Common causes:

- invalid runtime mode;
- duplicate service ID;
- missing dependency;
- circular dependency;
- unsupported service/mode;
- initialization/start timeout;
- critical service unhealthy;
- required service not ready.

## Shutdown

Shutdown stops services in reverse dependency order, aggregates errors, disposes resources, and is
idempotent.

## Recovery

Recovery is explicit and bounded. The runtime does not retry forever.

## Troubleshooting

- Invalid mode: verify typed composition options and do not rely on environment fallback.
- Dependency cycle: inspect service descriptors.
- Missing dependency: register required service before startup.
- Startup timeout: inspect service initialization/start hooks.
- Degraded runtime: inspect degradation report and affected capabilities.
- Shutdown timeout: inspect service stop/dispose hooks.

## Configuration

Prompt 3 runtime options:

| Option              | Purpose                                   | Type                    | Default                          | Safety implication                  |
| ------------------- | ----------------------------------------- | ----------------------- | -------------------------------- | ----------------------------------- |
| `runtimeInstanceId` | Stable identity for this runtime instance | UUID string             | None                             | Required for observability          |
| `mode`              | Runtime mode                              | RuntimeMode             | None                             | Missing/invalid fails closed        |
| `services`          | Services to manage                        | RuntimeManagedService[] | `[]`                             | Invalid graph rejects startup       |
| `defaultTimeoutMs`  | Lifecycle timeout                         | positive integer ms     | `5000`                           | Prevents indefinite lifecycle hangs |
| `capabilities`      | Base runtime capabilities                 | string[]                | CORE_RUNTIME, FOUNDATION_RUNTIME | Does not include live execution     |

Prompt 7 will later source these from the authoritative configuration engine.

## Audit information

Prompt 3 does not implement durable audit storage. Lifecycle records contain timestamp, runtime ID,
service ID, transition, runtime mode, correlation ID, and structured error data so future
observability/audit can consume them.
