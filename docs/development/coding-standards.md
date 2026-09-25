# Coding Standards

## Tooling

Prompt 1 establishes:

- Prettier for formatting;
- ESLint for linting;
- TypeScript strict mode for type checking;
- Vitest for automated tests;
- a tracked-file secret hygiene script.

## Commands

```bash
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run security:secrets
npm run verify
```

## Code principles

Future implementation should follow:

- explicitness over magic;
- small cohesive components;
- dependency inversion where external systems are involved;
- deterministic domain logic where possible;
- immutable value objects where appropriate;
- clear error handling;
- no swallowed exceptions;
- no silent fallback for safety-critical behavior;
- no unexplained constants;
- no dead code;
- no speculative abstractions without prompt need.

## Type and contract principles

- Prefer strongly typed contracts over ad hoc objects.
- Use explicit enumerations for important states.
- Keep broker/provider-specific details out of core domain types.
- Use stable identifiers rather than mutable names.
- Carry correlation IDs where operations cross boundaries.

## Financial and unit safety

Do not casually use binary floating-point arithmetic for capital, price, risk, margin, or accounting
calculations requiring deterministic decimal behavior. Represent units explicitly where practical.

## Import/dependency discipline

Core domain logic must not import infrastructure adapters, framework code, database clients, MT5
implementation code, or frontend code.

Architecture tests should be added as source modules appear.
