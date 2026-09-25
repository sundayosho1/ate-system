# ADR-0063 — Quality Score and Qualification Boundary

## Status

Accepted

## Decision

Quality scores and qualifications are diagnostic classifications for explicit non-live intended-use
categories. They never authorize trading or bypass future strategy, risk, portfolio, execution,
mandate or capital-protection controls.

Reports must carry `doesNotAuthorizeTrading: true`.

## Consequences

- A high score can help select data for research review, but it is not execution eligibility.
- Fitness for purpose remains a separate downstream assessment.
- Live eligibility is not represented by Prompt 15 intended-use categories.
