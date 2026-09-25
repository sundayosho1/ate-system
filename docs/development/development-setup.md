# Development Setup

## Repository

The authoritative repository is `sundayosho1/ate-system`.

The intended Windows local development path is:

```text
C:\wamp64\www\ate-system
```

That path must be a normal Git clone/worktree of the authoritative repository, not an unrelated
copy.

## Prerequisites

- Git
- Node.js 22 LTS or newer
- npm 10 or newer

## Install dependencies

```bash
npm install
```

## Verification

Run all Prompt 1 checks:

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

## Environment files

Copy `.env.example` to `.env` for local-only values when future prompts require runtime
configuration.

Never commit `.env` or real credentials.

## Windows VPS considerations

Future implementation must consider:

- Windows filesystem behavior;
- service/process management;
- MT5 terminal operation;
- environment variables and secret handling;
- networking and firewall rules;
- logging/monitoring;
- backups;
- startup/restart behavior;
- multiple execution nodes.

Do not hard-code local development paths into application runtime logic.
