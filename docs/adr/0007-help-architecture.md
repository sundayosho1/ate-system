# ADR-0007: Documentation-as-Code Help Foundation

## Status

Accepted

## Context

ATE will become operationally sophisticated. Help must be maintained with the application and be
available contextually to operators.

## Decision

Use documentation-as-code as the Prompt 1 help foundation. `docs/help/` will contain help and
configuration usability standards. Future module help, tooltips, runbooks, and searchable Help
Center content should be versioned with code and linked to features.

## Alternatives Considered

- External-only documentation: rejected because it can drift from implemented behavior.
- Hard-coded scattered frontend text: rejected because it is difficult to audit, search, and
  maintain.
- Full Help Center in Prompt 1: rejected as premature.

## Consequences

- Future prompts must update help content alongside features.
- Tests may verify required help content exists for completed modules.

## Security Impact

Help content must not include secrets or sensitive operational credentials.

## Operational Impact

Operators should receive understandable guidance, warnings, troubleshooting steps, related concepts,
and audit locations.

## Reversibility

Moderate. Content can later be indexed or rendered by a Help Center UI.
