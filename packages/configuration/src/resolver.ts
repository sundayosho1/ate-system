import type { Clock } from "@ate/time";

import { configurationContext, contextFingerprintInput, freeze } from "./context.js";
import { fail, ok } from "./errors.js";
import { precedencePolicyFor, precedenceRank, precedenceReason } from "./hierarchy.js";
import { mergeConfigurationValues } from "./merge.js";
import type { ConfigurationRegistry } from "./registry.js";
import { fingerprint } from "./serialization.js";
import { scopeAppliesToContext, scopeIdentity } from "./scopes.js";
import type {
  ConfigurationConflict,
  ConfigurationContext,
  ConfigurationEntry,
  ConfigurationExplanation,
  ConfigurationKey,
  ConfigurationProvenance,
  ConfigurationResolutionDiagnostics,
  ConfigurationResult,
  ConfigurationSnapshot,
  ConfigurationValue,
  EffectiveConfiguration,
  EffectiveConfigurationValue,
  ResolutionCandidate,
  SecretReference,
} from "./types.js";

export class ConfigurationResolver {
  public constructor(
    private readonly registry: ConfigurationRegistry,
    private readonly snapshot: ConfigurationSnapshot,
    private readonly clock: Clock,
  ) {}

  public resolve(context: ConfigurationContext): ConfigurationResult<EffectiveConfiguration> {
    const parsedContext = configurationContext(context, this.clock.now());
    if (!parsedContext.ok) {
      return parsedContext;
    }
    const values = new Map<ConfigurationKey, EffectiveConfigurationValue>();
    const conflicts: ConfigurationConflict[] = [...this.snapshot.conflicts];
    const missingRequiredKeys: ConfigurationKey[] = [];
    let consideredEntryCount = 0;

    for (const definition of this.registry.all()) {
      const resolution = this.resolveKey(definition.key, parsedContext.value);
      consideredEntryCount += resolution.explanation.candidates.length;
      conflicts.push(...resolution.conflicts);
      if (resolution.value !== undefined) {
        values.set(definition.key, resolution.value);
      } else if (definition.required || definition.failClosed) {
        missingRequiredKeys.push(definition.key);
        conflicts.push({
          type: "MISSING_REQUIRED_CONFIGURATION",
          key: definition.key,
          message: `required configuration value is missing: ${definition.key}`,
          entries: [],
        });
      }
    }

    const diagnostics: ConfigurationResolutionDiagnostics = {
      resolvedKeyCount: values.size,
      missingRequiredKeys,
      conflictCount: conflicts.length,
      consideredEntryCount,
    };
    const effective: EffectiveConfiguration = freeze({
      snapshotId: this.snapshot.snapshotId,
      fingerprint: fingerprint({
        snapshot: this.snapshot.fingerprint,
        context: contextFingerprintInput(parsedContext.value),
        values: [...values.entries()].map(([key, value]) => ({
          key,
          value: value.value,
          present: value.present,
        })),
      }),
      context: parsedContext.value,
      resolvedAt: this.clock.now(),
      values,
      conflicts,
      diagnostics,
    });
    return ok(effective);
  }

  public explain(
    key: ConfigurationKey,
    context: ConfigurationContext,
  ): ConfigurationResult<ConfigurationExplanation> {
    const definition = this.registry.require(key);
    if (!definition.ok) {
      return fail(definition.error);
    }
    const parsedContext = configurationContext(context, this.clock.now());
    if (!parsedContext.ok) {
      return parsedContext;
    }
    return ok(this.resolveKey(key, parsedContext.value).explanation);
  }

  private resolveKey(
    key: ConfigurationKey,
    context: ConfigurationContext,
  ): {
    value: EffectiveConfigurationValue | undefined;
    conflicts: readonly ConfigurationConflict[];
    explanation: ConfigurationExplanation;
  } {
    const definition = this.registry.require(key);
    if (!definition.ok) {
      return {
        value: undefined,
        conflicts: [
          {
            type: "UNKNOWN_KEY",
            key,
            message: definition.error.message,
            entries: [],
          },
        ],
        explanation: {
          key,
          context,
          candidates: [],
          conflicts: [],
          reasoning: definition.error.message,
        },
      };
    }

    const policy = precedencePolicyFor(definition.value);
    const allCandidates: ResolutionCandidate[] = this.snapshot.entries
      .filter((entry) => entry.key === key && entry.state === "ACTIVE")
      .map((entry) => {
        const rank = precedenceRank(policy, entry.scope.scopeType);
        const applicable = rank !== undefined && scopeAppliesToContext(entry.scope, context);
        return {
          entry,
          applicable,
          ...(rank === undefined ? {} : { rank }),
          reason:
            rank === undefined
              ? `No precedence rule for ${entry.scope.scopeType}.`
              : applicable
                ? precedenceReason(policy, entry.scope.scopeType)
                : `Scope ${scopeIdentity(entry.scope)} does not match context.`,
        };
      });
    const applicable = allCandidates
      .filter((candidate) => candidate.applicable && candidate.rank !== undefined)
      .sort(compareCandidates);
    const conflicts = detectEqualRankConflicts(key, applicable);
    if (conflicts.length > 0) {
      return {
        value: undefined,
        conflicts,
        explanation: {
          key,
          context,
          candidates: allCandidates,
          conflicts,
          reasoning: "Equal-precedence candidates disagree; resolution fails closed.",
        },
      };
    }

    let currentValue: ConfigurationValue | undefined = definition.value.defaultValue;
    let winningEntry: ConfigurationEntry | undefined;
    const overridden: ConfigurationEntry[] = [];
    const mergeConflicts: ConfigurationConflict[] = [];

    for (const candidate of applicable) {
      if (candidate.entry.operation === "UNSET") {
        if (winningEntry !== undefined) {
          overridden.push(winningEntry);
        }
        currentValue = undefined;
        winningEntry = candidate.entry;
        continue;
      }
      if (
        definition.value.sensitivity !== "SECRET_REFERENCE" &&
        isSecretReference(candidate.entry.value)
      ) {
        mergeConflicts.push({
          type: "SECRET_VALUE_FORBIDDEN",
          key,
          message: `secret reference is not permitted for ${key}`,
          entries: [candidate.entry],
        });
        continue;
      }
      if (
        definition.value.sensitivity === "SECRET_REFERENCE" &&
        !isSecretReference(candidate.entry.value)
      ) {
        mergeConflicts.push({
          type: "SECRET_VALUE_FORBIDDEN",
          key,
          message: `secret material is forbidden; use a secret reference for ${key}`,
          entries: [candidate.entry],
        });
        continue;
      }
      const merged = mergeConfigurationValues(
        definition.value.mergePolicy,
        currentValue,
        candidate.entry.value,
      );
      if (!merged.ok) {
        mergeConflicts.push({
          type: "MERGE_CONFLICT",
          key,
          message: merged.message,
          entries: [candidate.entry],
        });
        continue;
      }
      if (winningEntry !== undefined) {
        overridden.push(winningEntry);
      }
      currentValue = merged.value;
      winningEntry = candidate.entry;
    }

    const provenance: ConfigurationProvenance = {
      key,
      ...(currentValue === undefined ? {} : { finalValue: redactValue(currentValue) }),
      ...(winningEntry === undefined ? {} : { winningEntry }),
      ...(winningEntry === undefined ? {} : { winningScope: winningEntry.scope }),
      ...(winningEntry === undefined ? {} : { winningSource: winningEntry.source }),
      considered: allCandidates,
      overridden,
      precedencePolicy: policy,
      reasoning:
        winningEntry === undefined
          ? "No applicable entry; default or missing-value semantics apply."
          : `${scopeIdentity(winningEntry.scope)} wins by policy ${policy.policyId}.`,
    };
    const effective =
      currentValue === undefined &&
      winningEntry === undefined &&
      definition.value.defaultValue === undefined
        ? undefined
        : ({
            key,
            ...(currentValue === undefined ? {} : { value: redactValue(currentValue) }),
            present: currentValue !== undefined,
            provenance,
          } satisfies EffectiveConfigurationValue);
    const explanation: ConfigurationExplanation = {
      key,
      context,
      ...(effective === undefined ? {} : { effective }),
      candidates: allCandidates,
      conflicts: mergeConflicts,
      reasoning: provenance.reasoning,
    };
    return { value: effective, conflicts: mergeConflicts, explanation };
  }
}

const compareCandidates = (left: ResolutionCandidate, right: ResolutionCandidate): number => {
  const rankDelta = (left.rank ?? 0) - (right.rank ?? 0);
  if (rankDelta !== 0) {
    return rankDelta;
  }
  return `${left.entry.key}|${scopeIdentity(left.entry.scope)}|${left.entry.source.sourceId}`.localeCompare(
    `${right.entry.key}|${scopeIdentity(right.entry.scope)}|${right.entry.source.sourceId}`,
  );
};

const detectEqualRankConflicts = (
  key: ConfigurationKey,
  candidates: readonly ResolutionCandidate[],
): readonly ConfigurationConflict[] => {
  const byRank = new Map<number, ResolutionCandidate[]>();
  for (const candidate of candidates) {
    byRank.set(candidate.rank ?? 0, [...(byRank.get(candidate.rank ?? 0) ?? []), candidate]);
  }
  const conflicts: ConfigurationConflict[] = [];
  for (const sameRank of byRank.values()) {
    const activeSetters = sameRank.filter((candidate) => candidate.entry.operation === "SET");
    const serializedValues = new Set(
      activeSetters.map((candidate) => JSON.stringify(candidate.entry.value)),
    );
    if (serializedValues.size > 1) {
      conflicts.push({
        type: "EQUAL_PRECEDENCE_CONFLICT",
        key,
        message: `equal-precedence candidates disagree for ${key}`,
        entries: activeSetters.map((candidate) => candidate.entry),
      });
    }
  }
  return conflicts;
};

const isSecretReference = (value: ConfigurationValue | undefined): value is SecretReference =>
  value !== undefined &&
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  "kind" in value &&
  value.kind === "SECRET_REFERENCE";

const redactValue = (value: ConfigurationValue): ConfigurationValue => {
  if (isSecretReference(value)) {
    return {
      kind: "SECRET_REFERENCE",
      ref: "[REDACTED]",
      ...("provider" in value && value.provider !== undefined ? { provider: value.provider } : {}),
    };
  }
  return value;
};
