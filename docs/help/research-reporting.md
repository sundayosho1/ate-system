# Unified reporting and diagnostic help

## User and researcher

Request explicit owners, subjects, axes, historical/current mode, asOf and knowledgeCutoff. Supply
bounded evidence artifacts and a trusted local context with genuine P6 Clock. Reported native values
remain owner-scoped and source-qualified. UNKNOWN, UNSUPPORTED and PARTIAL are meaningful results,
never zero/green defaults. A COMPLETE status concerns only the explicitly requested historical
projection facets; it is not whole-system coverage, readiness, profitability or trading authority.
CURRENT requests cannot establish current authority from supplied historical artifacts.

Input envelope: `{request,evidence,charts,improvements}`. Request schema `ate.reporting.request/1`
includes id, exact source baseline, purpose, mode, canonical UTC asOf/cutoff and explicit facet
requests. Each facet identifies id,prompt,owner,subject,axis,artifactId,field,unit. No generic
method, URL or path lookup exists. Allowed axes are
LIFECYCLE,HEALTH,READINESS,QUALITY,AUTHORITY,COVERAGE,OBLIGATION. P1/P2/P13 have no invented
operational health owner; such diagnostic facets are UNSUPPORTED.

## Administrator

All diagnostic routes are disabled, even if a caller supplies enabled=true or a purported
certificate. Do not call health(), getEligibility(), replay snapshot(), initialize(), reconcile(),
stop() or a configuration setter to populate a panel. Accepted owners retain exclusive authority.
Reporting has no new identity, role, IAM grant or configuration key; persona labels are
documentation filters only. The owner source/effective configuration and lower budgets remain
authoritative.

createReportingPolicy accepts only positive integer LOWER ceilings from frozen D1. It rejects extra
fields, zero, noninteger, nonfinite or raised ceilings. No caller can activate routes, refresh or
retries. P6calls count against total calls and a maximum8 reads/report; normal supplied composition
reads twice. Clock failure, backward movement, unknown required-time input or cancellation rejects
rather than using a wall clock. Synchronous cancellation is a cooperative flag, not preemption. No
report-owned operation mutates a shared scheduler.

D1:32 native artifacts/1MiB total/depth32/50000nodes; report4MiB/1000 references/2000 facets
with4KiBreserved diagnostic space; eight charts/eight series per chart/1000 points per chart/2000
points total;256 improvement rows,1KiBdisplay detail and256 byte IDs/labels,1KiBlegends. R1export
ceiling8MiB; actual report/root descriptor/canonical/native limits can reject earlier, always
explicitly. No resource cap is a production throughput/deadline/memory-isolation qualification. No
retention/purge or filesystem export exists.

## Developer

Import only from @ate/research-reporting and accepted root public exports. captureNativeEvidence has
explicit DIRECT,DOMAIN,COMMITMENT and MOSE families. DIRECT preserves absence as
valuePresence=UNDEFINED and never fabricates a Result or native commitment. DomainResult issues stay
issues; commitment failures preserve exact NONE/UNKNOWN and MOSE audit correlation. Capture reads
the discriminator and selected branch once. Optional unused branches are not invented contract
violations. Nested DTO accessors/cycles/symbols/unsupported values are safely rejected; this is not
a hostile-JavaScript sandbox.

Artifacts include exact owner/version/sourceCommit/nativeIdentity/nativeFingerprint Fact, prompt,
subject,unit,effectiveAt,availableAt and captured representation. Raw capture is labeled
UNVERIFIED_NATIVE_CAPTURE. A derived digest is distinct from nativeFingerprint; unknown native
fingerprint stays unknown. Trusted composition anchors bind
artifactId/digest/sourceCommit/owner/reference. They are supplied trust-root inputs under T01, not
an invented source-authentication service. Availability qualification is
SOURCE_DECLARED_AVAILABILITY_NOT_INDEPENDENTLY_VERIFIED. Missing/future availability or mismatched
scope prevents a positive facet.

composeReport returns immutable request, observations, seven-axis facets, explicit missing reasons,
consistency, chart metadata, supplied improvement records, manifest/hash and budget use. Same exact
inputs and explicit P6times yield the same bytes. Sorting is exact identity order, not locale
collation. Accepted foundation canonicalization preserves its IA0309 ECMAScript integer-key
qualification; no JCS promise is added. Native source owner semantics are not reimplemented or
inferred from field names.

queryReport paginates sealed REPORT facets only, max 50 results. Its total/nextOffset are not native
P26receipt enumeration. It marks SELF_HASH_ONLY_NOT_OWNER_AUTHENTICATION and historical
current-authority unknown. serializeReportExport validates the report hash and emits only a fixed
safe metadata allowlist: baseline/time/counts/facet state labels. It omits raw native values,
subjects, labels, reasons, locators and proposal text. Redaction creates a new projection
fingerprint plus original hash; it never rewrites a native artifact. Returned UTF8text is not a
filesystem write.

Charts are inert TABLE/TIMESERIES/BAR/SCATTER/STATUS_TIMELINE metadata. Points retain exact decimal
strings, units, event/availability times, Fact gaps, finality and correction lineage. No renderer,
interpolation, zero filling or cross-owner averaging exists. A chart cannot invent source values,
timestamps, units, finality or correctionOf. Unknown denominators and authority remain unknown.

Improvement views validate supplied accepted ImprovementProposal records and linked evidence, retain
revisions and stable ordering, and explicitly expose NOT_ESTABLISHED_SUPPLIED_RECORDS_ONLY decision
authority. ReportBundle separately marks SUPPLIED_RECORDS_NOT_AUTHENTICATED_DECISIONS. A supplied
workflowStatus/decisionRef is not an owner decision or action. C-OP01 remains OPEN; no findings,
approvals or governance state are changed.

## Troubleshooting

Read the exact code and phase; projection reason namespace REPORTING never replaces native codes.
Missing help yields HELP_UNMAPPED and severity UNESTABLISHED. Source-linked help is not source
authentication. Review actual owner runbooks manually under existing authority. Do not resolve
secret refs, open paths from evidence, rerun scripts inside sealed roots, clear obligations or
increase limits to turn a partial report green.

- SOURCE_UNAUTHENTICATED: provide genuine applicable context/evidence, not a self-issued signature.
- KNOWLEDGE_CUTOFF or KNOWLEDGE_CUTOFF_UNPROVEN: show missing/future availability; never move the
  cutoff silently.
- CONTEXT_MISMATCH/FINGERPRINT_MISMATCH: preserve conflicting identities and original artifacts;
  reject joins.
- CURRENT_AUTHORITY_UNESTABLISHED/CONSISTENCY_UNESTABLISHED: use honest historical/qualified views;
  no invented global barrier or refresh.
- OWNER_METHOD_DENIED: routes remain disabled; separate authorization is required.
- BUDGET_EXHAUSTED: explicitly reduce the requested projection; retries do not raise/reset the
  policy.
- CANCELLED/REENTRANT_READ/CLOCK_MOVED_BACKWARD: reject the local operation; no owner-write UNKNOWN
  or false shutdown success is fabricated.

All existing F05/F06/T01/M02, C-Q01–04, OPEN A26-Q01/A26C-L01/C-OP01,49 qualification rows
and12B-R/12D-Rrisks remain binding. Historical ACK is not current readiness; a quality score is not
trading suitability. CODEX-014E and Prompts 28–30,frontend/API/listener/remoteIAM,live
broker/execution/production remain unauthorized. Independent technical and governance acceptance are
PENDING.
