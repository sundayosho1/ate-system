# Research insights foundation

Static offline knowledge, source-linked glossary and qualified projection schemas. No owner queries,
report engine, listener, commands, authentication service or frontend. Root application version and
capability snapshot remain historical; this package is0.1.0-insights-foundation.1, pending
independent technical and governance acceptance.

## Setup and workflow

Use the existing checkout and supported Node>=22/npm>=10. Authenticate the exact source and required
history objects before tests; frozen npm ci; VITEST_MAX_WORKERS=2 npm run verify. No root
build/CLI/server command or portable browser distribution is provided. Import only the package
public root in the accepted TypeScript/Vitest workflow. Run tests/research-insights for examples.
Never launch owner services just to read help.

Use createKnowledgeCatalogue with a bounded operation context, explicit source manifest and explicit
bounded corpus, then searchKnowledge. Supplied timestamps do not read a clock; captureGeneratedAt
uses injected P6now exactly once. Query search is ASCII casefold, fixed ASCII whitespace tokens,
deterministic ID/revision ordering, no market ranking. Unicode is retained exactly. Unknown/missing
facets remain explicit.

## Limits and exhaustion

R1bytes mean UTF8, KiB1024/MiB1048576. Operation descriptor64KiB/depth16/10000nodes; catalogue
corpus10000records/16MiB/32KiB perrecord with depth16/10000nodes perrecord. Track total across
batches; no reset. Search query256bytes/20tokens, maxHits1..100(default20). Cancellation is
cooperative, not synchronous preemption. Cycle/accessor exceptions become structured issues; no
toJSON hooks are invoked. An8MiB export cap can reject a valid16MiB catalogue export. Do not
silently split, truncate or increase ceilings.

Future-only profile fields remain frozen but unsupported:64total/8perowner calls,32total/8perowner
pages,20default/50max page results, concurrency1,1MiB/depth32/50000nodes native
response,4MiBreport/1000refs/2000facets,8MiBexport/100files/no recursion,100reports/256MiBmanual
retention, refresh disabled/60sminimum,5swait/no preemption. No invocation, pagination, refresh,
filesystem resolution or report retention is implemented. Lower accepted source limits always win in
any later authorized adapter.

## Errors and safe next steps

INSIGHT_SCHEMA_INVALID/UNSUPPORTED: inspect exact family/version and required tagged fields.
INSIGHT_INPUT_BOUNDS: supply a supported bounded request/corpus, never raise caps.
INSIGHT_SOURCE_REFERENCE_INVALID/REFERENCE_UNRESOLVED: authenticate source/hash/help/qualification
references. INSIGHT_DUPLICATE_IDENTITY: fix conflicting revisions without erasing history.
INSIGHT_TEMPORAL_INCONSISTENCY: correct cutoffs, never use future knowledge.
INSIGHT_AUTHORITY_UNESTABLISHED/COVERAGE_UNESTABLISHED: preserve unknown, request genuine owner
evidence. INSIGHT_CANCELLED: no completed output claimed. INSIGHT_EXPORT_LIMIT_EXCEEDED: explicitly
request a smaller scoped export. INSIGHT_ACCESSOR_REJECTED/CYCLIC_INPUT: provide plain detached
projection data; this does not redefine native owner Result representation rules.
INSIGHT_CLOCK_UNAVAILABLE: no wall-clock fallback. No error triggers automatic repair, retry,
journal deletion, approval or debt settlement.

## Qualifications

See docs/knowledge/qualifications.json: all49preservation rows and12B-Rrisks remain.
A26-Q01admission fairness and A26C-L01pagination remain OPEN; F05Windows and F06production/powerloss
unqualified; T01trusted owners/root/singlewriter, M02current registry, O-C01/O-C02and
historical/current authority remain. No financial execution or futureP28–30 functionality.

canonicalInsightBytes accepts an optional cancellation boolean after the explicit artifact scope. It
is a pure cancellation intent value, never a callback or a guarantee that an event-loop event can
interrupt synchronous work. Validation checks it before/after traversal and at256-node checkpoints;
no owner operation or storage commitment is affected.

## Foundation integrity remediation

Source-manifest hashes identify bytes at the manifest's declared accepted baseline, including
historical architecture tests that have since changed. Authenticate maintenance inputs against that
exact Git commit and line identity; a well-formed manifest alone remains supplied metadata, not a
filesystem resolver or external trust anchor. The permanent integrity regressions perform this
explicit offline check without adding operational owner calls to the library.

Traceability dimensions have field-specific types: owner and row identities are bounded identifiers;
contract/documentation references and glossary terms are nonempty string arrays; coverage,
configuration, diagnostic and readiness descriptions are bounded text. Explicit qualified UNKNOWN or
UNSUPPORTED descriptions remain valid metadata. Null, nested objects and numeric substitutes cannot
stand in for mandatory dimensions. A successful validation does not authenticate an owner record.

Catalogue relationships refer to entry IDs rather than a particular revision. All retained revisions
contribute outgoing edges for that ID; none is silently chosen as current. Self-references and
directed cycles, including cycles across revisions, reject the whole build. Iterative traversal
visits each ID and deduplicated edge once within the already bounded corpus, avoiding recursive
stack exhaustion or revision cross-product expansion. Output retains the original relationships and
exact revisions. Cancellation remains cooperative: already-cancelled work rejects, and periodic
graph checks do not promise synchronous event-loop preemption.

Ordering compares namespace, entry type and ID separately using deterministic JavaScript string
comparison, then numeric revision. Delimiters in components cannot collapse distinct tuples. This
corrects collection ordering for affected inputs; historical source and canonical artifacts remain
unchanged. Backtest, Rollback Request, Backpressure and Known-good rollback now have term-specific
current explanations while their original source definitions remain preserved.
