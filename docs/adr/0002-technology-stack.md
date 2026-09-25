# ADR-0002: TypeScript-First Foundation with npm Workspaces

## Status

Accepted

## Context

The inspected repository had no implementation stack. Prompt 1 must choose a maintainable foundation
for backend, frontend, contracts, tests, documentation, and Windows-compatible development without
implementing future business logic.

Selection criteria:

- reliability;
- type safety;
- deterministic testing;
- ecosystem maturity;
- Windows VPS compatibility;
- MT5 integration feasibility;
- quantitative/research extensibility;
- maintainability;
- performance;
- developer tooling;
- long-term scalability.

## Decision

Use a TypeScript-first monorepo foundation with npm workspaces.

Planned stack direction:

- Backend/control plane: Node.js + TypeScript, framework to be selected when the API prompt requires
  it.
- Frontend: React + TypeScript, likely Vite-based, to be finalized when frontend implementation
  begins.
- Database: PostgreSQL as primary relational persistence when persistence is implemented.
- Migrations: controlled versioned migration tooling selected with the persistence prompt.
- Cache/queue/event infrastructure: selected only when requirements justify it.
- Testing: Vitest for TypeScript unit/foundation tests.
- Formatting/linting/type checking: Prettier, ESLint, TypeScript strict mode.
- Package management: npm workspaces for broad Windows compatibility and low bootstrap complexity.

## Alternatives Considered

- Python-first backend: strong research ecosystem, but frontend/API contract type sharing would
  require more cross-language tooling.
- .NET-first backend: strong Windows compatibility, but less direct frontend contract sharing and
  heavier initial setup.
- Polyglot from Prompt 1: rejected as premature.
- pnpm/yarn: capable, but npm is universal with Node and Windows-friendly.

## Consequences

- One language can cover early contracts, API, tests, and frontend.
- Future Python research workers remain possible through adapter boundaries.
- Numeric precision must be handled deliberately through decimal/value-object libraries when
  calculations are implemented.

## Security Impact

npm dependency governance and audits are required. Secrets must remain outside package scripts and
config files.

## Operational Impact

Node.js runs on Windows VPS and Linux development environments. MT5 integration will remain
adapter-based.

## Reversibility

Moderate. Core contracts and adapters can support future polyglot workers.
