import { describe, it, expect } from "vitest";
import { transitionRule } from "../../packages/mose-opportunities/src/transitions.js";
import type { OpportunityState } from "../../packages/mose-opportunities/src/contracts.js";
const names: OpportunityState[] = [
  "DORMANT",
  "OBSERVING",
  "INTERESTING",
  "SETUP_FORMING",
  "CANDIDATE",
  "QUALIFIED",
  "INVALIDATED",
  "EXPIRED",
];
// Independent transcription of the approved 64-cell design; never derive expected values from production.
const expected = [
  ["I", "T1", "DENY", "DENY", "DENY", "DENY", "T8", "T9"],
  ["T7", "I", "T2", "DENY", "DENY", "DENY", "T8", "T9"],
  ["DENY", "T6", "I", "T3", "DENY", "DENY", "T8", "T9"],
  ["DENY", "DENY", "T6", "I", "T4", "DENY", "T8", "T9"],
  ["DENY", "DENY", "DENY", "T6", "I", "T5", "T8", "T9"],
  ["DENY", "DENY", "DENY", "DENY", "T6", "I", "T8", "T9"],
  ["DENY", "DENY", "DENY", "DENY", "DENY", "DENY", "I", "DENY"],
  ["DENY", "DENY", "DENY", "DENY", "DENY", "DENY", "DENY", "I"],
];
describe("approved transition topology (conditional edges do not authorize promotion)", () => {
  for (const [i, from] of names.entries())
    for (const [j, to] of names.entries())
      it(`${from} -> ${to}`, () => expect(transitionRule(from, to)).toBe(expected[i]?.[j]));
});
