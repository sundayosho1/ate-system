import { freeze, reject } from "./validation.js";
export const passiveCandidates = freeze([
  "events:InternalEventBus.diagnostics",
  "time:DeterministicScheduler.snapshot",
  "market-replay:ReplayController.currentCheckpoint",
  "market-replay:ReplayController.diagnostics",
]);
/** Deliberately no service object/callback argument, flag, generic invocation or activation API. */
export function admitReadBinding(_raw: unknown) {
  return reject("REPORTING:OWNER_METHOD_DENIED");
}
