export const runtimeModes = [
  "DEVELOPMENT",
  "RESEARCH",
  "BACKTEST",
  "SIMULATION",
  "PAPER",
  "LIVE",
] as const;
export type RuntimeMode = (typeof runtimeModes)[number];

export const protectionStates = [
  "NORMAL",
  "CAUTION",
  "REDUCED_RISK",
  "DEFENSIVE",
  "NO_NEW_TRADES",
  "PROTECTED",
  "HALTED",
] as const;
export type ProtectionState = (typeof protectionStates)[number];

export const assetClasses = [
  "FOREX",
  "METAL",
  "ENERGY",
  "COMMODITY",
  "INDEX",
  "CRYPTO",
  "EQUITY",
  "CFD",
  "OTHER",
] as const;
export type AssetClass = (typeof assetClasses)[number];

export const instrumentStatuses = [
  "DISCOVERED",
  "MAPPED",
  "DATA_QUALIFIED",
  "RESEARCH_ELIGIBLE",
  "VALIDATED",
  "SIMULATION_APPROVED",
  "LIVE_ELIGIBLE",
  "ACTIVE",
  "SUSPENDED",
] as const;
export type InstrumentStatus = (typeof instrumentStatuses)[number];

export const mappingStatuses = ["UNMAPPED", "MAPPED", "VERIFIED", "REJECTED", "STALE"] as const;
export type MappingStatus = (typeof mappingStatuses)[number];

export const healthStatuses = ["HEALTHY", "DEGRADED", "UNAVAILABLE"] as const;
export type HealthStatus = (typeof healthStatuses)[number];

export const dataQualityStatuses = [
  "UNKNOWN",
  "HEALTHY",
  "DEGRADED",
  "STALE",
  "INVALID",
  "MISSING",
] as const;
export type DataQualityStatus = (typeof dataQualityStatuses)[number];

export const tradingStatuses = ["ACTIVE", "SUSPENDED", "PROTECTED", "HALTED"] as const;
export type TradingStatus = (typeof tradingStatuses)[number];

export const operationalStatuses = ["HEALTHY", "DEGRADED", "UNAVAILABLE"] as const;
export type OperationalStatus = (typeof operationalStatuses)[number];

export const marketTradingStatuses = ["OPEN", "CLOSED", "HALTED", "UNKNOWN"] as const;
export type MarketTradingStatus = (typeof marketTradingStatuses)[number];

export const strategyStatuses = [
  "DRAFT",
  "RESEARCH",
  "SIMULATION",
  "PAPER",
  "LIVE_ELIGIBLE",
  "SUSPENDED",
] as const;
export type StrategyStatus = (typeof strategyStatuses)[number];

export const setupStates = ["DETECTED", "OBSERVING", "FORMING", "INVALIDATED", "EXPIRED"] as const;
export type SetupState = (typeof setupStates)[number];

export const opportunityStates = [
  "DORMANT",
  "OBSERVING",
  "INTERESTING",
  "SETUP_FORMING",
  "CANDIDATE",
  "QUALIFIED",
  "REJECTED",
  "INVALIDATED",
  "EXPIRED",
] as const;
export type OpportunityState = (typeof opportunityStates)[number];

export const tradeDirections = ["LONG", "SHORT"] as const;
export type TradeDirection = (typeof tradeDirections)[number];

export const marketBiases = ["BULLISH", "BEARISH", "NEUTRAL", "UNCERTAIN"] as const;
export type MarketBias = (typeof marketBiases)[number];

export const candidateStates = [
  "CREATED",
  "OBSERVING",
  "QUALIFIED",
  "REJECTED",
  "INVALIDATED",
  "EXPIRED",
  "APPROVED",
] as const;
export type CandidateState = (typeof candidateStates)[number];

export const decisionOutcomes = ["APPROVE", "REJECT", "NO_ACTION", "DEFER"] as const;
export type DecisionOutcome = (typeof decisionOutcomes)[number];

export const authorityTypes = [
  "INSTITUTIONAL_MANDATE",
  "CAPITAL_PROTECTION",
  "SYSTEM_HEALTH",
  "ACCOUNT_MANDATE",
  "RISK",
  "PORTFOLIO",
  "EXECUTION_SAFETY",
  "STRATEGY_ORCHESTRATOR",
  "STRATEGY",
  "SYSTEM",
] as const;
export type AuthorityType = (typeof authorityTypes)[number];

export const reasonCategories = [
  "DATA",
  "MARKET",
  "STRATEGY",
  "RISK",
  "PORTFOLIO",
  "ACCOUNT",
  "PROTECTION",
  "EXECUTION",
  "SYSTEM",
  "CONFIGURATION",
] as const;
export type ReasonCategory = (typeof reasonCategories)[number];

export const severities = ["INFO", "WARNING", "ERROR", "CRITICAL"] as const;
export type Severity = (typeof severities)[number];

export const masterDecisionStates = ["PROPOSED", "APPROVED", "REJECTED", "DEFERRED"] as const;
export type MasterDecisionState = (typeof masterDecisionStates)[number];

export const executionIntentStates = [
  "CREATED",
  "VALIDATING",
  "READY",
  "REJECTED",
  "EXPIRED",
] as const;
export type ExecutionIntentState = (typeof executionIntentStates)[number];

export const orderSides = ["BUY", "SELL"] as const;
export type OrderSide = (typeof orderSides)[number];

export const orderTypes = ["MARKET", "LIMIT", "STOP"] as const;
export type OrderType = (typeof orderTypes)[number];

export const orderStates = [
  "CREATED",
  "VALIDATING",
  "SUBMITTED",
  "ACKNOWLEDGED",
  "PARTIALLY_FILLED",
  "FILLED",
  "REJECTED",
  "CANCEL_PENDING",
  "CANCELLED",
  "EXPIRED",
  "UNKNOWN",
  "RECONCILIATION_REQUIRED",
] as const;
export type OrderState = (typeof orderStates)[number];

export const timeInForceTypes = [
  "GOOD_TILL_CANCELLED",
  "IMMEDIATE_OR_CANCEL",
  "FILL_OR_KILL",
  "GOOD_TILL_TIME",
] as const;
export type TimeInForceType = (typeof timeInForceTypes)[number];

export const positionStates = [
  "OPENING",
  "OPEN",
  "REDUCING",
  "CLOSING",
  "CLOSED",
  "UNKNOWN",
  "RECONCILIATION_REQUIRED",
] as const;
export type PositionState = (typeof positionStates)[number];

export const tradeStates = [
  "PLANNED",
  "OPEN",
  "CLOSING",
  "CLOSED",
  "CANCELLED",
  "RECONCILIATION_REQUIRED",
] as const;
export type TradeState = (typeof tradeStates)[number];

export const volumeTypes = ["TICK", "REAL", "BROKER_REPORTED", "NOT_AVAILABLE"] as const;
export type VolumeType = (typeof volumeTypes)[number];

export const barCompletenessStates = ["FORMING", "FINAL"] as const;
export type BarCompleteness = (typeof barCompletenessStates)[number];

export const exposureDimensions = [
  "INSTRUMENT",
  "ASSET_CLASS",
  "CURRENCY",
  "STRATEGY",
  "ACCOUNT",
  "CORRELATION_CLUSTER",
] as const;
export type ExposureDimension = (typeof exposureDimensions)[number];

export const actorTypes = ["SYSTEM", "USER", "SERVICE", "INTEGRATION"] as const;
export type ActorType = (typeof actorTypes)[number];

export const timeframes = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN1"] as const;
export type Timeframe = (typeof timeframes)[number];
