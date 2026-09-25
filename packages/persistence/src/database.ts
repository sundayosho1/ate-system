import { redactDetails } from "./errors.js";

export type PostgresConnectionSettings = Readonly<{
  host: string;
  port: number;
  database: string;
  user: string;
  passwordSecretRef: string;
  sslMode: "disable" | "prefer" | "require";
  connectionTimeoutMs: number;
  poolMin: number;
  poolMax: number;
  poolIdleTimeoutMs: number;
}>;

export type SafePostgresConnectionDiagnostics = Readonly<{
  host: string;
  port: number;
  database: string;
  user: string;
  passwordSecretRef: "[REDACTED]";
  sslMode: PostgresConnectionSettings["sslMode"];
  connectionTimeoutMs: number;
  poolMin: number;
  poolMax: number;
  poolIdleTimeoutMs: number;
}>;

export const safePostgresDiagnostics = (
  settings: PostgresConnectionSettings,
): SafePostgresConnectionDiagnostics => ({
  host: settings.host,
  port: settings.port,
  database: settings.database,
  user: settings.user,
  passwordSecretRef: "[REDACTED]",
  sslMode: settings.sslMode,
  connectionTimeoutMs: settings.connectionTimeoutMs,
  poolMin: settings.poolMin,
  poolMax: settings.poolMax,
  poolIdleTimeoutMs: settings.poolIdleTimeoutMs,
});

export const postgresSchemaNamespaces = ["core", "events", "audit"] as const;

export const foundationalPostgresDdl = [
  "create schema if not exists core",
  "create schema if not exists events",
  "create schema if not exists audit",
  "create table core.schema_migrations (migration_id text primary key, checksum text not null, description text not null, applied_at timestamptz not null)",
  "create table core.state_records (state_id uuid primary key, state_domain text not null, owner text not null, runtime_mode text not null, version integer not null check (version > 0), payload jsonb not null, created_at timestamptz not null, updated_at timestamptz not null)",
  "create table core.state_history (history_id uuid primary key, state_id uuid not null, state_domain text not null, owner text not null, runtime_mode text not null, prior_version integer, new_version integer not null check (new_version > 0), transition text not null, occurred_at timestamptz not null, actor jsonb not null, correlation_id uuid, causation_id uuid, reason text, metadata jsonb not null)",
  "create table audit.audit_records (audit_id uuid primary key, occurred_at timestamptz not null, runtime_mode text not null, actor jsonb not null, action text not null, outcome text not null check (outcome in ('SUCCESS','FAILURE')), affected_resource text not null, correlation_id uuid, causation_id uuid, event_id uuid, reason text, metadata jsonb not null)",
  "create table events.outbox (outbox_id uuid primary key, event_id uuid not null unique, event_type text not null, event_version integer not null check (event_version > 0), envelope jsonb not null, payload jsonb not null, state text not null, runtime_mode text not null, created_at timestamptz not null, attempt_count integer not null check (attempt_count >= 0), next_attempt_at timestamptz, published_at timestamptz, claimed_at timestamptz, failure jsonb)",
  "create table events.inbox (subscription_id text not null, idempotency_key text not null, event_id uuid not null, state text not null, runtime_mode text not null, attempts integer not null check (attempts >= 0), received_at timestamptz not null, updated_at timestamptz not null, claim_expires_at timestamptz, failure jsonb, primary key (subscription_id, idempotency_key))",
  "create table events.dead_letters (dead_letter_id uuid primary key, event jsonb not null, subscription_id text not null, failure jsonb not null, attempts integer not null check (attempts >= 0), first_failure_at timestamptz not null, final_failure_at timestamptz not null, correlation_id uuid not null, causation_id uuid, subscriber_id text not null, runtime_mode text not null, replay_count integer not null check (replay_count >= 0), replayed_at timestamptz)",
] as const;

export const parameterizedSqlOnlyNotice =
  "Persistence implementations must use parameterized SQL/bind values. Arbitrary raw SQL from application modules is prohibited.";

export const redactConnectionDiagnostics = (
  details: Record<string, unknown>,
): Record<string, unknown> => redactDetails(details);
