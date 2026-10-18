# @ate/research-reporting

Version 0.1.0-reporting-projection.1. Bounded offline supplied-evidence reporting; technical and
governance acceptance PENDING.

This package composes detached, non-authoritative reports. All four passive diagnostic routes are
DISABLED. It has no network, filesystem access, broker connection, commands, refresh, native state
reconciliation or automatic remediation. The P6 clock is a distinct bounded dependency. Start with
[the reporting help](../../../docs/help/research-reporting.md) and
[architecture](../../../docs/architecture/research-reporting.md).

Public operations: validateReportRequest, createReportingPolicy, admitReadBinding (always denies),
captureNativeEvidence, captureDigest, composeReport, queryReport, explainDiagnostic,
projectImprovementRegister, buildChartMetadata and serializeReportExport. See exported readonly
types for exact shape; only the root package export is supported. No owner object or callback can be
passed to admitReadBinding.

A trusted-context evidence anchor binds an exact captured digest/source identity for offline
projection under T01. It is not a signature, independent source verification, current owner approval
or source truth. Current-authority and cross-owner consistency remain unestablished. Self-hashed
imported reports are historical views, not authenticated current service state.
