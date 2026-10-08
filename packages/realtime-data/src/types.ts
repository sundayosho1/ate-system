import type { DataSourceRef, MarketObservation, UtcTimestamp } from "@ate/domain";

export type ObservationKind = MarketObservation["observationKind"];
export type ConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "DEGRADED"
  | "RECONNECTING"
  | "DISCONNECTING"
  | "FAILED";
export type SubscriptionState =
  | "REQUESTED"
  | "SUBSCRIBING"
  | "ACTIVE"
  | "DEGRADED"
  | "RESUBSCRIBING"
  | "UNSUBSCRIBING"
  | "CLOSED"
  | "FAILED";
export type RealtimeErrorCode =
  | "INVALID_ADAPTER"
  | "INVALID_TRANSITION"
  | "CONNECTION_FAILED"
  | "SUBSCRIPTION_CONFLICT"
  | "SUBSCRIPTION_LIMIT"
  | "SUBSCRIPTION_FAILED"
  | "MALFORMED_PAYLOAD"
  | "INVALID_TIMESTAMP"
  | "NORMALIZATION_FAILED"
  | "DUPLICATE"
  | "IDENTITY_CONFLICT"
  | "SEQUENCE_REGRESSION"
  | "GAP_DETECTED"
  | "STREAM_STALE"
  | "HEARTBEAT_TIMEOUT"
  | "QUEUE_OVERFLOW"
  | "RECONNECT_EXHAUSTED"
  | "CAPTURE_FAILED"
  | "CAPTURE_INTEGRITY_FAILED"
  | "PERSISTENCE_FAILED"
  | "SHUTDOWN_IN_PROGRESS"
  | "OPERATION_TIMEOUT"
  | "STALE_SESSION";
export type RealtimeError = Readonly<{
  code: RealtimeErrorCode;
  scope: string;
  timestamp: UtcTimestamp;
  message: string;
}>;
export type RealtimeResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: RealtimeError }>;
export type AdapterCapabilities = Readonly<{
  observationKinds: readonly ObservationKind[];
  subscriptionModes: readonly ("STREAM" | "SNAPSHOT")[];
  sourceTimestamps: boolean;
  sequences: "NONE" | "PER_SUBSCRIPTION_CONSECUTIVE" | "PER_SUBSCRIPTION_OPAQUE";
  eventIds: boolean;
  heartbeats: boolean;
  snapshots: boolean;
  flowControl: boolean;
  reconnect: "NEW_SESSION";
  subscriptionConfirmation: boolean;
  entitlementRef: string;
  redistributionAllowed: boolean;
}>;
export type SubscriptionRequest = Readonly<{
  subscriptionId: string;
  sourceId: string;
  instrumentId: string;
  providerSymbol: string;
  observationKind: ObservationKind;
  mode: "STREAM" | "SNAPSHOT";
  channel?: string;
  timeframe?: string;
  depth?: number;
  expectedActivity: boolean;
}>;
export type SubscriptionRecord = Readonly<{
  request: SubscriptionRequest;
  desired: "ACTIVE" | "CLOSED";
  applied: "NONE" | "CONFIRMED" | "UNCERTAIN";
  state: SubscriptionState;
  sessionId?: string;
  configurationFingerprint: string;
}>;
export type NativeMessage = Readonly<{
  subscriptionId: string;
  sourceId: string;
  observationKind: ObservationKind;
  eventId?: string;
  sequence?: string;
  sourceTime?: string;
  payload: unknown;
}>;
export type AdapterCallbacks = Readonly<{
  observation: (message: NativeMessage) => RealtimeResult<string>;
  heartbeat: () => void;
  disconnected: () => void;
  error: () => void;
}>;
export type AdapterContext = Readonly<{
  sessionId: string;
  signal: AbortSignal;
  callbacks: AdapterCallbacks;
}>;
export interface ProviderAdapter {
  readonly adapterId: string;
  readonly version: string;
  readonly source: DataSourceRef;
  readonly capabilities: AdapterCapabilities;
  connect(context: AdapterContext): Promise<void>;
  disconnect(signal: AbortSignal): Promise<void>;
  subscribe(request: SubscriptionRequest, signal: AbortSignal): Promise<"CONFIRMED" | "UNCERTAIN">;
  unsubscribe(request: SubscriptionRequest, signal: AbortSignal): Promise<void>;
  normalize(payload: unknown): unknown;
}
export type IngressEnvelope = Readonly<{
  ingressId: string;
  sourceId: string;
  adapterId: string;
  adapterVersion: string;
  sessionId: string;
  subscriptionId: string;
  providerSymbol: string;
  observationKind: ObservationKind;
  eventId?: string;
  providerSequence?: string;
  sourceTime?: string;
  receivedAt: UtcTimestamp;
  localSequence: number;
  payloadFingerprint: string;
  payload: unknown;
  configurationFingerprint: string;
}>;
export type IntegrityWarning =
  | "LATE"
  | "OUT_OF_ORDER"
  | "SEQUENCE_GAP"
  | "SOURCE_TIME_MISSING"
  | "IDENTITY_UNCERTAIN"
  | "CONTINUITY_UNCERTAIN"
  | "SUBSCRIPTION_UNCERTAIN";
export type AcceptedObservation = Readonly<{
  ingress: Omit<IngressEnvelope, "payload">;
  observation: MarketObservation;
  processedAt: UtcTimestamp;
  warnings: readonly IntegrityWarning[];
}>;
export type GapRecord = Readonly<{
  gapId: string;
  sourceId: string;
  sessionId: string;
  subscriptionId?: string;
  kind: "SEQUENCE_GAP" | "TIME_GAP" | "HEARTBEAT_GAP" | "CONNECTION_GAP" | "UNKNOWN_GAP";
  expected: string;
  observed: string;
  detectedAt: UtcTimestamp;
  status: "UNRESOLVED";
  severity: "WARNING" | "ERROR";
}>;
export type ConnectionSession = Readonly<{
  sessionId: string;
  adapterId: string;
  adapterVersion: string;
  sourceId: string;
  configurationFingerprint: string;
  startedAt: UtcTimestamp;
  connectedAt?: UtcTimestamp;
  terminatedAt?: UtcTimestamp;
  terminationReason?: string;
  reconnectAttempt: number;
  healthSummary: "CONNECTING" | "CONNECTED" | "INTERRUPTED" | "STOPPED" | "FAILED";
}>;
export type ControlRecord = Readonly<{
  kind: "CONNECTION" | "SUBSCRIPTION" | "GAP" | "CAPTURE" | "HEALTH";
  sourceId: string;
  sessionId: string;
  state: string;
  timestamp: UtcTimestamp;
}>;
export const metricNames = [
  "received",
  "accepted",
  "rejected",
  "normalizationFailures",
  "duplicates",
  "late",
  "outOfOrder",
  "gaps",
  "heartbeatFailures",
  "staleTransitions",
  "reconnectAttempts",
  "subscriptionFailures",
  "overflow",
  "captureWrites",
  "captureFailures",
  "staleCallbacks",
  "controlOverflow",
  "processingLatencyMs",
  "evidenceEvictions",
] as const;
export type Metrics = Record<(typeof metricNames)[number], number>;
export type CaptureManifest = Readonly<{
  manifestFingerprint?: string;
  captureId: string;
  source: DataSourceRef;
  adapterId: string;
  adapterVersion: string;
  configurationFingerprint: string;
  startedAt: UtcTimestamp;
  endedAt?: UtcTimestamp;
  state: "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED";
  sessionIds: readonly string[];
  subscriptions: readonly SubscriptionRequest[];
  count: number;
  bytes: number;
  contentFingerprint?: string;
  eventTimeRange?: Readonly<{ start: UtcTimestamp; end: UtcTimestamp }>;
  evidence: Readonly<Pick<Metrics, "rejected" | "duplicates" | "late" | "gaps" | "overflow">>;
  storageReference: string;
}>;
export type MaterializationHandoff = Readonly<{
  manifest: CaptureManifest;
  authority: "CAPTURE_ONLY";
  historicalMaterializationRequired: true;
  qualityAssessmentRequired: true;
  catalogueRegistrationRequired: true;
  researchQualified: false;
  tradingAuthorized: false;
}>;

export type StreamIntegrityEvidence = Readonly<{
  sourceId: string;
  configurationFingerprint: string;
  measuredAt: UtcTimestamp;
  sessionId?: string;
  evidence: CaptureManifest["evidence"];
  gaps: readonly GapRecord[];
  qualityAssessmentRequired: true;
  qualityCertified: false;
  tradingAuthorized: false;
}>;
