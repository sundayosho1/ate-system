import { parseRuntimeMode } from "@ate/runtime";

import type { BootstrapConfiguration, ConfigurationSourceId } from "./types.js";

export type BootstrapConfigurationInput = Readonly<{
  runtimeMode: unknown;
  sourceRefs?: readonly string[];
  logLevel?: string;
  secretProviderRef?: string;
}>;

export const bootstrapConfiguration = (
  input: BootstrapConfigurationInput,
): BootstrapConfiguration => {
  const runtimeMode = parseRuntimeMode(input.runtimeMode);
  if (runtimeMode === undefined) {
    throw new Error("bootstrap runtime mode is required and must be canonical");
  }
  return {
    runtimeMode,
    sourceRefs: input.sourceRefs ?? [],
    ...(input.logLevel === undefined ? {} : { logLevel: input.logLevel }),
    ...(input.secretProviderRef === undefined
      ? {}
      : { secretProviderRef: input.secretProviderRef }),
  };
};

export const bootstrapSourceRef = (sourceId: ConfigurationSourceId): string =>
  `configuration-source:${sourceId}`;
