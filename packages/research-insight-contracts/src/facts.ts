import type { contractDefinitions } from "./validation.js";
export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type Fact<T = JsonValue> =
  | Readonly<{ kind: "KNOWN"; value: T; evidenceIds: readonly string[] }>
  | Readonly<{ kind: "UNKNOWN" | "UNSUPPORTED"; reasonIds: readonly string[] }>
  | Readonly<{ kind: "NOT_APPLICABLE"; justification: string }>;
export type InsightRecord = Readonly<{ schema: string; [key: string]: JsonValue }>;

/** Strong projection field types; never replace the native owner schemas. */
type Field<T extends string> = T extends "boolean"
  ? boolean
  : T extends "count"
    ? number
    : T extends "ids" | "nonemptyIds" | "personas"
      ? readonly string[]
      : T extends "array"
        ? readonly JsonValue[]
        : T extends "fact" | `${string}Fact`
          ? Fact
          : T extends "json" | "times" | "interval"
            ? JsonValue
            : string;
export type TypedInsight<K extends keyof typeof contractDefinitions> = Readonly<
  { schema: `ate.insights.${(typeof contractDefinitions)[K][0]}/1` } & {
    [P in keyof (typeof contractDefinitions)[K][1]]: Field<
      (typeof contractDefinitions)[K][1][P] & string
    >;
  }
>;
