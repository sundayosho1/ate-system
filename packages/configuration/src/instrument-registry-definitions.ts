import type { Clock } from "@ate/time";
import { configurationKey } from "./keys.js";
import { configurationSchemaFromDefinition } from "./schema-types.js";
import type { ConfigurationDefinition } from "./types.js";
/** Register with the existing configuration/schema owners; required only for registry consumers. */
export function instrumentRegistryConfigurationDefinitions(
  clock: Clock,
): readonly ConfigurationDefinition[] {
  const key = configurationKey("instrument.registry.policyJson", clock.now());
  if (!key.ok) throw Error("INVALID_CONFIGURATION_KEY");
  return [
    {
      key: key.value,
      domain: "INSTRUMENT",
      displayName: "Offline instrument registry policy",
      description:
        "Versioned taxonomy, normalization, identity resolution and bounded storage/import/query policy.",
      valueType: "STRING",
      required: false,
      failClosed: true,
      allowedScopes: ["SYSTEM", "ENVIRONMENT"],
      mergePolicy: "REPLACE",
      sensitivity: "INTERNAL",
      metadata: {
        purpose: "Govern instrument description, never trading authorization.",
        riskImplication:
          "Missing or conflicting policy blocks registry admission; policy changes require explicit separate registry recovery/migration review.",
        reloadRequirement: "RESTART",
        uiHint: "JSON policy, documented in universal-instrument-registry help.",
      },
    },
  ];
}
export const instrumentRegistryConfigurationSchemas = (clock: Clock) =>
  instrumentRegistryConfigurationDefinitions(clock).map((d) =>
    configurationSchemaFromDefinition(d, {
      constraints: { minLength: 2, maxLength: 1048576 },
      metadata: { ...d.metadata, examples: ['{"version":1}'] },
    }),
  );
