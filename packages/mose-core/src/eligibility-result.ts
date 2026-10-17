import type { InstrumentEligibility, Result } from "@ate/instrument-eligibility";

type EligibilityValue = Extract<
  Awaited<ReturnType<InstrumentEligibility["getEligibility"]>>,
  { ok: true }
>["value"];

// The accepted contract is structural: arrays/inherited fields are not excluded merely
// by their representation. Read the envelope fields once before interpreting authority.
const objectLike = (value: unknown): value is Record<string, unknown> =>
  value !== null && (typeof value === "object" || typeof value === "function");

export function readEligibilityResult(raw: unknown): Result<EligibilityValue> {
  if (!objectLike(raw)) throw Error("REPLAY_EVIDENCE_INVALID");
  const discriminator = raw.ok,
    value = raw.value,
    error = raw.error;
  if (discriminator === true) {
    if (!objectLike(value) || error !== undefined) throw Error("REPLAY_EVIDENCE_INVALID");
    // The existing consumer checks the actual subject, assessment and context in ownerEligibility.
    return { ok: true, value: value as EligibilityValue };
  }
  if (discriminator !== false || value !== undefined || !objectLike(error))
    throw Error("REPLAY_EVIDENCE_INVALID");
  const code = error.code,
    commitment = error.commitment;
  if (typeof code !== "string" || (commitment !== "NONE" && commitment !== "UNKNOWN"))
    throw Error("REPLAY_EVIDENCE_INVALID");
  return { ok: false, error: { code, commitment } };
}
