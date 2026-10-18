import type { TypedInsight, Fact, JsonValue } from "./facts.js";
export type OwnerReadObservation = TypedInsight<"OwnerReadObservation">;
export type NativeResultEvidence = Omit<
  TypedInsight<"NativeResultEvidence">,
  "selectedDiscriminator"
> &
  (
    | Readonly<{ selectedDiscriminator: true; selectedValueRef: Fact }>
    | Readonly<{
        selectedDiscriminator: false;
        selectedFailure: Readonly<{ family: string; code: string; detail: JsonValue }>;
      }>
  );
export type ConsistencyEvidence = TypedInsight<"ConsistencyEvidence">;
