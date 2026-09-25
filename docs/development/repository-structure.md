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
and test utilities. No trading package is implemented in Prompt 1.

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
truthfulness.

### `scripts/`

Repository automation such as secret hygiene scanning.

### `deployment/`

Future deployment assets and runbooks. Prompt 1 does not implement production deployment.

## Empty-module rule

Do not create empty business modules merely to mirror the roadmap. Introduce modules when a prompt
requires implementation and an authoritative boundary exists.
