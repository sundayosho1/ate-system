import { domainFromKey } from "./domains.js";
import { configurationScope } from "./scopes.js";
import type {
  ConfigurationEntry,
  ConfigurationEntryOperation,
  ConfigurationEntryState,
  ConfigurationKey,
  ConfigurationScopeType,
  ConfigurationValue,
} from "./types.js";

export type ConfigurationEntryInput = Readonly<{
  key: ConfigurationKey;
  scopeType: ConfigurationScopeType;
  scopeId?: string;
  value?: ConfigurationValue;
  operation?: ConfigurationEntryOperation;
  state?: ConfigurationEntryState;
  metadata?: Readonly<Record<string, ConfigurationValue>>;
}>;

export const configurationEntry = (
  input: ConfigurationEntryInput,
): Omit<ConfigurationEntry, "source" | "loadedAt"> => {
  const domain = domainFromKey(input.key);
  if (domain === undefined) {
    throw new Error(`configuration entry key has unknown domain: ${input.key}`);
  }
  const operation = input.operation ?? "SET";
  if (operation === "SET" && input.value === undefined) {
    throw new Error(`configuration entry ${input.key} requires a value`);
  }
  return {
    key: input.key,
    domain,
    scope: configurationScope(input.scopeType, input.scopeId),
    ...(input.value === undefined ? {} : { value: input.value }),
    operation,
    state: input.state ?? "ACTIVE",
    metadata: input.metadata ?? {},
  };
};
