# Application Runtime & Lifecycle

Prompt 3 establishes `@ate/runtime`, the ATE operational kernel for composing, starting,
health-checking, degrading, recovering, stopping, and snapshotting runtime-managed services.

It does not implement trading, market-data ingestion, MT5 connectivity, risk, portfolio,
persistence, APIs, frontend, or live execution.

## Runtime lifecycle

```text
CONFIGURATION INPUT
RUNTIME MODE RESOLUTION
COMPOSITION
DEPENDENCY VALIDATION
SERVICE REGISTRATION
INITIALIZATION
STARTUP ADMISSION
START SERVICES IN DEPENDENCY ORDER
HEALTH / READINESS EVALUATION
RUNNING / DEGRADED
CONTROLLED SHUTDOWN
STOP SERVICES IN REVERSE DEPENDENCY ORDER
DISPOSE RESOURCES
TERMINATED
```

## Composition root

`buildRuntime` is the Prompt 3 composition root. It validates:

- explicit runtime instance ID;
- explicit runtime mode;
- lifecycle timeout options;
- service dependency graph;
- service mode eligibility.

Construction is explicit. Future services should not create unrelated service instances throughout
arbitrary modules.

## Runtime states

- `CREATED`
- `COMPOSING`
- `INITIALIZING`
- `STARTING`
- `RUNNING`
- `DEGRADED`
- `RECOVERING`
- `STOPPING`
- `STOPPED`
- `FAILED`

Illegal transitions return structured lifecycle errors.

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

Service state is distinct from health.

## Service descriptors

Each service declares:

- stable service ID;
- name;
- version;
- description;
- criticality;
- required dependencies;
- optional dependencies;
- supported runtime modes;
- startup/shutdown policy;
- degradation policy;
- capabilities;
- health/readiness capability;
- recoverability.

## Criticality

- `CRITICAL`: failure can make the runtime unsafe for its mission.
- `REQUIRED`: needed for normal operation and readiness.
- `OPTIONAL`: failure may degrade capabilities without invalidating the whole runtime.

Criticality is not current health.

## Dependency graph

Dependencies start before dependants. Shutdown reverses startup order.

Invalid graphs fail before startup:

- duplicate service IDs;
- missing required dependencies;
- circular dependencies;
- unsupported runtime-mode registrations.

## Runtime modes

The runtime reuses Prompt 2 modes:

- DEVELOPMENT
- RESEARCH
- BACKTEST
- SIMULATION
- PAPER
- LIVE

Mode is explicit and immutable for a runtime instance. Missing or invalid mode fails closed. `LIVE`
never appears as a fallback.

## Capability model

Runtime mode and capability are distinct.

`mode === LIVE` does not grant `LIVE_EXECUTION`. Future live operation must also require capability,
readiness, authorization, and protection approval.

## Health vs readiness

Health answers whether a service/runtime appears alive and functioning.

Readiness answers whether it is safe/capable of doing its intended workload.

A runtime can be alive but not ready.

## Graceful degradation

Degradation records:

- affected service;
- criticality;
- affected capabilities;
- affected dependants;
- reason;
- recoverability;
- whether operation may continue;
- current readiness.

Optional failures can degrade the runtime while preserving unrelated capabilities. Critical failures
fail closed.

## Recovery

Recovery is explicit. The runtime does not retry forever. Recoverable services can move from
`DEGRADED`/`FAILED` to `RECOVERING` to `RUNNING` when their contract permits.

## Graceful shutdown

Shutdown:

1. transitions to `STOPPING`;
2. aborts cooperative cancellation signals;
3. stops services in reverse dependency order;
4. disposes resources;
5. aggregates stop/dispose failures;
6. reaches `STOPPED` where possible.

Repeated shutdown is idempotent.

## Runtime snapshot

Snapshots include:

- runtime ID;
- version;
- mode;
- state;
- health;
- readiness;
- start/observation time;
- lifecycle generation;
- service snapshots;
- available/degraded capabilities;
- failures;
- degradations.

Snapshots must not contain secrets.

## Lifecycle events

Prompt 3 provides in-memory lifecycle records and observers compatible with the Prompt 2
event-envelope direction. Prompt 4 remains authoritative for event bus publication and routing.

## Windows VPS readiness

The runtime is compatible with future Windows VPS hosting because it supports:

- explicit lifecycle control;
- process-signal adapter boundary;
- graceful termination;
- structured startup/shutdown reports;
- service timeouts;
- cancellation;
- restart-policy contracts.

Prompt 3 does not install or configure Windows services.

## Configuration boundary

Prompt 3 consumes explicit typed construction options only. Prompt 7 establishes hierarchical
configuration resolution. Prompt 8 adds schema validation and runtime publication gates. Prompt 9
adds immutable configuration version history. Prompt 10 adds feature-flag and capability-control
evaluation. Prompt 11 adds maker-checker approval governance. Prompt 12 adds controlled promotion,
activation, known-good and rollback release governance.

Prompts 7-8 provide the configuration runtime service foundation. Future services should depend on
that managed service for configuration rather than reading environment variables or local files
directly.

## Time service integration

Prompt 6 adds `@ate/time` as a runtime-managed service boundary. The clock service participates in
health/readiness and exposes diagnostics for:

- current UTC instant;
- clock mode and source;
- runtime mode compatibility;
- monotonic availability;
- clock quality and last detected jump;
- deterministic scheduler queue counts;
- recent temporal errors.

Runtime lifecycle timestamps continue to come from the runtime's injected clock. Elapsed lifecycle
durations in the Prompt 3 implementation still use infrastructure-level host duration measurement;
business services should consume `@ate/time` clocks and scheduler APIs instead of direct ambient
time.

## Configuration service integration

`@ate/configuration` can run as a runtime-managed service. It depends on time authority, loads
configuration sources, publishes a coherent active snapshot, exposes a resolver, reports
health/readiness and clears its non-authoritative cache on shutdown. It must not report `READY`
until a coherent snapshot exists and blocking conflicts are absent.

## Capability-control integration

Prompt 10 adds a runtime-managed capability-control service descriptor. The service consumes
effective configuration, feature-flag definitions and capability registry records to publish safe
capability diagnostics. Runtime service readiness may degrade effective capability state, but it
does not mutate configuration, version history or implementation truth.

## Approval service integration

Prompt 11 adds a runtime-managed approval service descriptor. Pending approval is normal governance
state and should not automatically make the whole runtime unhealthy. Functionality depending on an
approval-required configuration version must remain blocked by the governed publication gate until
approval eligibility is satisfied.
