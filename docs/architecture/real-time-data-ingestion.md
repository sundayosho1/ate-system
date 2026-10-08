# Real-Time Market Data Ingestion

Prompt 17 introduces @ate/realtime-data without trading authority.

Provider callback → session/subscription fence → bounded raw ingress → adapter normalization →
Prompt 13 validation → temporal/sequence/identity evidence → bounded canonical consumer channels and
capture → explicit Prompt 14/15/16 handoff.

Provider-specific data remains behind adapter normalization. Desired/applied subscriptions are
separate; session generations fence callbacks and acknowledgements. Arrival order is preserved per
provider. Consecutive sequence evidence is per subscription/session; event time is never rewritten.
Independent provider and consumer queues prevent cross-source failure and slow-consumer blockage.

The injected Prompt 6 scheduler controls monitors, operation deadlines and retry backoff. The host
must drive it; no parallel clock authority or independent timer exists. Ingestion options derive
from Prompts 7–12 effective configuration and are immutable for session/capture provenance.

Control summaries integrate through Prompt 4; observations never enter a per-tick governance log.
Capture has a separate content/manifest commit marker and does not own governed dataset storage,
quality certification or catalogue registration. Runtime service integration is optional;
required-source policy affects capability readiness without treating absent optional providers as
ATE-wide failure.

See ../help/real-time-data-ingestion.md for settings, lifecycle, security, recovery, limitations and
examples.
