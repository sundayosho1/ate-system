# Research Workspace Integration

`@ate/research-workspace@0.1.0-integration.1` is a private static-first research projection library.
It composes bounded supplied knowledge and accepted reporting artifacts without invoking running
owners. Technical and governance acceptance remain PENDING.

Use the root public entry only. Exports: `createWorkspacePolicy`, `validateReleaseOverlay`,
`composeWorkspace`, `queryWorkspace`, `projectWorkspaceDiagnostics`, `projectImprovementView`,
`buildHandoverDescriptors`, `serializeWorkspaceExport`, plus W1/baseline constants and public types.

[Architecture and preserved qualifications](../../docs/architecture/research-workspace.md),
[researcher/admin help](../../docs/help/research-workspace.md),
[Cursor handover](../../docs/integration/research-workspace-cursor-handover.md).

Three identities remain distinct: knowledge6307f53…, reporting validation2cb81c1…,
governancefe587fb…. An overlay is non-authoritative; trusted caller-supplied source bindings are
required. Self-consistent hashes do not authenticate external truth or current authority. Full
original catalogue/source manifest is not promised in one composite call: bounded subsets must be
source-bound and explicitly partial.

All four passive owner reads remain DISABLED. No server, UI, IAM, filesystem loader, live
connectivity, broker action, financial execution or automatic remediation is implemented.
Prompts28–30remain unauthorized. Existing23package authorities are preserved; no root application
version, capability or governance update is part of this implementation.

Run frozen `npm ci`, `VITEST_MAX_WORKERS=2 npm run verify`, full/production-only audit and
`npm ls --all`. New tests are under `tests/research-workspace`; inherited guards have only the exact
owner-approved seven-test compatibility patch.
