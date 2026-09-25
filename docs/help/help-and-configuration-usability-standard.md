# Help & Configuration Usability Standard

This standard is part of the permanent Definition of Done from Prompt 1 through Prompt 84.

## Principle

ATE may be complex internally, but it must be understandable operationally. Operators should not
need to read source code to understand important states, settings, consequences, or actions.

## Required help content for applicable features

Each applicable module or feature must include:

1. **Overview** — what the feature does.
2. **Purpose** — why it exists.
3. **Workflow** — how it behaves.
4. **Usage** — step-by-step operational guidance where applicable.
5. **Configuration Help** — important settings with name, purpose, type, default, allowed
   range/values, dependencies, effect, risk implications, restart/reload implications, scope, and
   override behavior.
6. **State Help** — statuses and states.
7. **Warnings** — dangerous or capital-sensitive changes.
8. **Troubleshooting** — diagnostic guidance.
9. **Related Features** — contextual navigation.
10. **Audit Information** — where sensitive changes/actions are recorded.

## Configuration UX standard

Configuration pages should favor:

- toggles;
- dropdowns/selectors;
- validated numeric fields;
- explicit units;
- tooltips;
- inline descriptions;
- safe defaults;
- warnings;
- dependency indicators;
- current/proposed value comparison;
- validation feedback;
- reset controls;
- version history;
- approval state;
- rollback controls.

Avoid unexplained generic text inputs for structured configuration.

## Help architecture

Help content should be version-controlled and maintainable with code. Future implementation should
support:

- contextual help;
- tooltips;
- module help pages;
- searchable Help Center;
- configuration explanations;
- troubleshooting articles;
- operational runbooks;
- developer documentation.

Avoid scattering hard-coded help text unpredictably throughout the frontend.

## Completion rule

An applicable feature is not complete until help and configuration usability are materially current.

## Prompt 1 help foundation

Prompt 1 establishes:

- this permanent standard;
- `docs/help/` as the version-controlled help foundation;
- README links to major governance/help documents.

The complete Help Center UI is future scope.
