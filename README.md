# ATE — Autonomous Trading Engine

ATE is planned as a configurable autonomous trading, market-intelligence, risk-management,
portfolio-management, execution, research, and operational control platform.

ATE is **not** currently a trading bot, MetaTrader Expert Advisor, or live execution system. Prompt
1 establishes the repository and engineering constitution only.

## Current development status

- Phase: I — Foundation & Engineering Governance
- Prompt: 1 of 84
- Status: foundational documentation, tooling, and governance
- Trading capability: **not implemented**
- MT5 connectivity: **not implemented**
- Live execution: **not implemented**

See [`config/capabilities.json`](config/capabilities.json) for the authoritative machine-readable
capability manifest.

## Architectural target

The long-term ATE architecture is intended to support:

1. observation and validation of market/account/system state;
2. market intelligence and regime detection;
3. candidate generation by strategies;
4. risk, portfolio, protection, mandate, and execution checks;
5. account-specific allocation;
6. broker-neutral execution through adapters such as MT5;
7. reconciliation, outcome analytics, research, and controlled learning.

ATE must always be able to return `NO_ACTION` when conditions do not justify capital exposure.

## Currently implemented functionality

Prompt 1 implements only:

- repository foundation and documentation hierarchy;
- engineering constitution and safety invariants;
- core domain language contracts and runtime validation;
- application runtime lifecycle, service composition, health/readiness, graceful degradation, and
  shutdown foundations;
- architecture decision records;
- development, testing, security, configuration, help, and contribution standards;
- capability manifest and prompt ledger;
- minimal npm/TypeScript quality tooling and foundation tests.

No source module currently performs trading, market data ingestion, strategy evaluation, risk
calculation, portfolio management, account allocation, broker order submission, or MT5 execution.

## Repository structure

```text
apps/                  Future deployable applications
config/                Machine-readable project governance/config records
deployment/            Future deployment assets and runbooks
docs/                  Architecture, ADRs, help, security, testing, operations
mt5/                   Future MT5 gateway/Connector EA artifacts
packages/              Future shared packages/domain/application contracts
scripts/               Repository automation and quality scripts
tests/                 Automated tests and architecture/foundation checks
```

Detailed structure guidance is documented in
[`docs/development/repository-structure.md`](docs/development/repository-structure.md).

## Technology baseline

Prompt 1 selects a TypeScript-first repository foundation using npm workspaces for future backend,
frontend, and shared packages. The documented target stack is summarized in
[`docs/adr/0002-technology-stack.md`](docs/adr/0002-technology-stack.md).

## Setup

Prerequisites:

- Node.js 22 LTS or newer
- npm 10 or newer
- Git

Install dependencies:

```bash
npm install
```

Run verification:

```bash
npm run verify
```

Individual checks:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run security:secrets
```

## Documentation

Start with:

- [Engineering Constitution](docs/architecture/engineering-constitution.md)
- [System Architecture](docs/architecture/system-architecture.md)
- [Core Domain Contracts](docs/architecture/core-domain-contracts.md)
- [Application Runtime](docs/architecture/application-runtime.md)
- [Safety Invariants](docs/architecture/safety-invariants.md)
- [Authority Hierarchy](docs/architecture/authority-hierarchy.md)
- [Environment & Runtime Modes](docs/architecture/environment-runtime-modes.md)
- [Glossary](docs/architecture/glossary.md)
- [Development Setup](docs/development/development-setup.md)
- [Testing Strategy](docs/testing/testing-strategy.md)
- [Security Baseline](docs/security/security-baseline.md)
- [Help & Configuration Usability Standard](docs/help/help-and-configuration-usability-standard.md)

## Security warning

Never commit secrets or credentials. Do not store GitHub tokens, broker credentials, MT5 passwords,
database passwords, API keys, private keys, or production secrets in this repository.

Use `.env.example` for placeholders only. Local secret-bearing `.env` files are ignored by Git.

If a credential is discovered in tracked files:

1. do not reproduce the secret value;
2. identify the affected file safely;
3. remove the secret where safe;
4. rotate the credential;
5. add regression protection against recurrence.

## Development workflow

Development is controlled prompt-by-prompt. Each prompt must inspect the repository first, respect
existing authorities, implement only bounded scope, add appropriate tests/documentation/help, run
verification, and produce a delivery report with actual evidence.

See [`docs/development/contribution-workflow.md`](docs/development/contribution-workflow.md).

## Windows VPS compatibility

The production target must remain compatible with Windows VPS operation because MetaTrader 5
terminals are expected to run there initially. The local path `C:\wamp64\www\ate-system` is a
development clone location, not an application runtime dependency.
