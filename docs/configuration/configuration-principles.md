# Configuration Principles

ATE must be highly configurable without becoming unsafe or unexplained.

Prompt 1 documented principles. Prompt 7 implements the first authoritative hierarchical
configuration engine foundation in `@ate/configuration`.

## Configuration hierarchy

Configuration scopes should be designed around:

1. SYSTEM
2. ENVIRONMENT
3. BROKER
4. ACCOUNT
5. ASSET CLASS
6. INSTRUMENT
7. TIMEFRAME
8. REGIME
9. STRATEGY
10. RISK
11. PORTFOLIO
12. EXECUTION
13. SURVEILLANCE
14. DATA
15. INTEGRATIONS
16. LEARNING
17. REPORTING

Future configuration must be scope-aware and override-aware. A more specific override must not
silently bypass higher authority.

Prompt 7 distinguishes domains from scopes. A domain such as `RISK` describes what is configured. A
scope such as `ACCOUNT:account-a` describes where an entry applies. Context and explicit precedence
determine the effective value.

## Required characteristics

Configuration should be:

- typed;
- validated;
- versionable;
- explainable;
- auditable;
- scope-aware;
- override-aware;
- environment-aware;
- rollback-capable;
- secure.

## Activation principle

Invalid configuration must not silently activate. Safety-critical configuration should fail closed
when validation cannot establish safe operation.

## Sensitive configuration

Sensitive changes should show:

- current value;
- proposed value;
- expected effect;
- risk/warning;
- approval state;
- restart/reload implications;
- audit location.

## No magic values

Critical configuration must not depend on undocumented magic values. Units, ranges, defaults,
accepted values, and dependencies must be documented.

## Safe defaults

Where a safe default exists, choose the conservative default. Where no safe default exists, require
explicit operator configuration and validation.

## Secret handling

Secrets must use environment-appropriate secret management. They must not be stored in committed
configuration files, logged, exposed through APIs, or rendered in frontend responses.

## Prompt 7 boundaries

Prompt 7 provides keys, domains, scopes, entries, sources, resolution, provenance, snapshots,
fingerprints, cache semantics and runtime integration. Prompt 8 owns comprehensive schema
validation. Prompt 9 owns version history. Prompts 11-12 own approval, promotion and rollback.
