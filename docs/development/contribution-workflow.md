# Contribution & Prompt Development Workflow

ATE development is controlled prompt-by-prompt.

## Standard prompt lifecycle

1. Receive prompt.
2. Inspect repository.
3. Identify existing authorities.
4. Perform gap analysis.
5. Identify dependencies.
6. Define implementation boundary.
7. Implement bounded scope only.
8. Test.
9. Verify.
10. Document.
11. Update help.
12. Run regression.
13. Produce delivery report.

## Branch and commit standards

- Use descriptive feature branches.
- Keep commits reviewable.
- Use meaningful commit messages.
- Do not rewrite remote history unless explicitly approved.
- Do not commit generated junk, local runtime files, or secrets.

## Prompt boundaries

Implement the current prompt and strictly necessary supporting work only. Do not build future-prompt
functionality merely because it is known.

## No duplicate authorities

Before introducing a component, determine whether an authority already exists. Extend the existing
authority when appropriate.

## Delivery report

Each implementation prompt must report:

- prompt;
- implementation summary;
- files/components;
- architecture;
- database changes;
- configuration;
- security;
- risk/safety;
- frontend;
- help;
- tests;
- full verification;
- regression;
- known limitations;
- deferred scope;
- repository state;
- final status.

## Review discipline

Do not:

- delete working functionality without justification;
- weaken tests merely to pass builds;
- remove safety checks to resolve errors;
- bypass permissions;
- hard-code secrets;
- hide exceptions;
- fabricate test results;
- fabricate broker connectivity;
- claim production readiness without evidence.
