# Repository Structure

Prompt 1 starts from an initial repository containing only `README.md`. The foundation structure is
intentionally modest: it creates durable places for documentation, configuration records, tooling,
tests, and future implementation without inventing business modules.

```text
.
├── apps/
│   └── README.md
├── config/
│   ├── capabilities.json
│   └── capabilities.schema.json
├── deployment/
│   └── README.md
├── docs/
│   ├── adr/
│   ├── architecture/
│   ├── configuration/
│   ├── development/
│   ├── help/
│   ├── integrations/
│   ├── operations/
│   ├── security/
│   └── testing/
├── mt5/
│   └── README.md
├── packages/
│   └── README.md
├── scripts/
│   └── check-secret-hygiene.mjs
├── tests/
│   └── foundation/
└── README.md
```

## Directory responsibilities

### `apps/`

Future deployable applications such as an API service, workers, and Control Center frontend. No
application is implemented in Prompt 1.

### `packages/`

Future shared packages for domain, application contracts, infrastructure adapters, UI/design system,
and test utilities.

Prompt 2 adds `packages/domain` as the authoritative core domain-language package. It defines
contracts and validation only; it does not implement trading behavior.

Prompt 3 adds `packages/runtime` as the authoritative application runtime/lifecycle package. It
manages composition, lifecycle, health/readiness, degradation and shutdown only; it does not
implement trading services.

Prompt 4 adds `packages/events` as the authoritative internal event architecture package. It
implements typed event registration, factory creation, routing, delivery, idempotency, ordering,
retry, dead-letter, diagnostics and runtime-service integration only; it does not implement durable
event persistence, external brokers, market data, MT5 or trading behavior.

Prompt 5 adds `packages/persistence` as the authoritative persistence/state authority foundation. It
implements transactions, state ownership, expected-version writes, append-only history/audit,
transactional outbox, durable inbox, durable dead letters, migrations, diagnostics and runtime
integration only; it does not implement market-data storage, instrument registry, trading accounts,
risk/portfolio/execution engines, MT5 or live trading.

Prompt 6 adds `packages/time` as the authoritative clock/time foundation. It implements UTC instant
normalization, system/virtual/simulation/replay clocks, monotonic duration support, IANA timezone
conversion, freshness calculation, clock-quality monitoring, deterministic scheduling and runtime
integration only; it does not implement market calendars, sessions, market-data replay engines,
trading services, MT5 or live trading.

Prompt 7 adds `packages/configuration` as the authoritative hierarchical configuration foundation.
It implements domains, keys, scopes, context, source abstraction, deterministic precedence,
inheritance, conflict detection, provenance, explanations, immutable snapshots, fingerprints,
bounded cache, runtime integration and safe diagnostics only.

Prompt 8 extends `packages/configuration` with schema registry authority, deterministic schema
fingerprints, type/range/enum/object/list validation, dependency and conditional rules, cross-field
rules, validation reports and runtime invalid-candidate rejection; it does not implement Prompt 9
version lifecycle, feature flags, approvals, promotion/rollback or frontend editing.

Prompt 9 extends `packages/configuration` with immutable configuration version history, runtime-mode
version streams, current-version pointer, parent lineage, historical derivation, change sets,
semantic diffs, attribution, reconstruction, integrity verification and bounded history queries; it
does not implement feature flags, maker-checker approval, promotion/rollback or frontend editing.

Prompt 10 extends `packages/configuration` with feature flags and capability control. It implements
a build-truth capability registry, managed configuration-backed feature flags, deterministic
effective capability snapshots, dependency/runtime-mode gating, restart-required visibility, safe
events, state-authority registration and diagnostics; it does not implement maker-checker approval,
promotion/rollback, market data, MT5, execution, frontend editing or trading.

### `mt5/`

Future MetaTrader 5 gateway and Connector EA artifacts. Prompt 1 documents the boundary only.

### `docs/`

Version-controlled architecture, ADRs, operations, security, testing, development, integration,
configuration, and help documentation.

### `config/`

Machine-readable project governance records such as the capability manifest. Secret-bearing runtime
configuration does not belong here.

### `tests/`

Automated tests. Prompt 1 adds foundation tests validating documentation and capability
truthfulness. Prompt 4 adds event architecture tests under `tests/events`. Prompt 5 adds
persistence/state authority tests under `tests/persistence`. Prompt 6 adds temporal integrity tests
under `tests/time`. Prompts 7-10 add hierarchical configuration, schema validation, versioning and
capability-control tests under `tests/configuration`.

### `scripts/`

Repository automation such as secret hygiene scanning.

### `deployment/`

Future deployment assets and runbooks. Prompt 1 does not implement production deployment.

## Empty-module rule

Do not create empty business modules merely to mirror the roadmap. Introduce modules when a prompt
requires implementation and an authoritative boundary exists.
