import type { DiagnosisContext, DiagnosticRule } from "../types/index.js";
import { failureDiagnosis, successDiagnosis } from "../types/index.js";
import { errorMentions, hasEventMatching, isFailure } from "./match.js";

/** Event signatures that signal a problem even when the top-level result is success. */
const FAILURE_EVENT_SIGNATURES: readonly string[] = ["trapped"];

/**
 * The ordered seed rule registry (ADR-0003). Order encodes specificity: the
 * success guard leads, then the six failure modes from most- to least-distinctive
 * matcher, so a more specific rule wins before a broader one can over-match.
 *
 * Each `matches` is a trivial delegation to ./match helpers; each `explain` is a
 * static human verdict. Adding a diagnosis means adding a rule object here —
 * never editing the engine.
 *
 * SOURCES: the on-chain event names and error identifiers these matchers key on
 * are not yet confirmed against a real dry-run capture. Matching is therefore
 * defensive (case-insensitive substrings). See the per-rule TODO(verify) notes.
 */

/**
 * Success guard. A clean dry-run (top-level success, no failure) yields status
 * "success" rather than falling through to "unknown".
 */
const successRule: DiagnosticRule = {
  id: "success",
  matches: (ctx: DiagnosisContext): boolean =>
    ctx.effects.executionResult.kind === "success" &&
    !FAILURE_EVENT_SIGNATURES.some((sig) => hasEventMatching(ctx, [sig])),
  explain: (): ReturnType<typeof successDiagnosis> =>
    successDiagnosis({
      ruleId: "success",
      explanation: "The dry-run executed without error on this hop.",
    }),
};

/**
 * Entry barrier rejected the message before execution.
 * TODO(verify): confirm against a real dry-run capture — ADR-0003 regression
 * corpus. The `Barrier`/`ShouldExecute` error wording is unconfirmed.
 */
const barrierBlockedRule: DiagnosticRule = {
  id: "barrier-blocked",
  matches: (ctx: DiagnosisContext): boolean =>
    errorMentions(ctx, ["barrier", "shouldexecute", "blocked", "notallowed"]),
  explain: (): ReturnType<typeof failureDiagnosis> =>
    failureDiagnosis({
      ruleId: "barrier-blocked",
      rootCause: "The destination's entry barrier rejected the message before execution.",
      explanation:
        "A barrier is the filter that decides whether an incoming XCM may execute at all. " +
        "It denied this message, so no instructions ran.",
      suggestions: [
        "Verify the origin is on the destination's allowed-origin / trust configuration.",
        "Confirm the message begins with the instruction the barrier expects (e.g. a paid-execution preamble).",
      ],
    }),
};

/**
 * XCM version conversion between source and destination failed.
 * TODO(verify): confirm against a real dry-run capture — ADR-0003 regression
 * corpus. The version-conversion error identifier is unconfirmed.
 */
const versionMismatchRule: DiagnosticRule = {
  id: "version-mismatch",
  matches: (ctx: DiagnosisContext): boolean =>
    errorMentions(ctx, ["version", "unhandledxcmversion", "convertorigin"]),
  explain: (ctx: DiagnosisContext): ReturnType<typeof failureDiagnosis> =>
    failureDiagnosis({
      ruleId: "version-mismatch",
      rootCause: "XCM version conversion failed between the source and destination.",
      explanation:
        `The message is encoded as XCM v${String(ctx.effects.xcmVersion)}, and the destination ` +
        "could not convert it to a version it supports.",
      suggestions: [
        "Align the message version with a version the destination accepts.",
        "Check the destination's SafeXcmVersion / supported-version configuration.",
      ],
    }),
};

/**
 * Reserve/teleport trust mismatch for the moved asset.
 * TODO(verify): confirm against a real dry-run capture — ADR-0003 regression
 * corpus. The `UntrustedReserveLocation`/`UntrustedTeleportLocation` wording is
 * unconfirmed.
 */
const untrustedReserveRule: DiagnosticRule = {
  id: "untrusted-reserve",
  matches: (ctx: DiagnosisContext): boolean =>
    errorMentions(ctx, ["untrustedreserve", "untrustedteleport", "reserve", "teleport"]),
  explain: (): ReturnType<typeof failureDiagnosis> =>
    failureDiagnosis({
      ruleId: "untrusted-reserve",
      rootCause: "The asset's reserve/teleport trust does not match the destination's configuration.",
      explanation:
        "Reserve and teleport are two asset-movement models, each requiring the destination to " +
        "trust the declared reserve/teleport location for that asset. The declared location is not trusted here.",
      suggestions: [
        "Show the expected trusted reserve for this asset and use it.",
        "Confirm whether the asset should move via reserve transfer or teleport on this route.",
      ],
    }),
};

/**
 * `BuyExecution` bought too little weight for the program.
 * TODO(verify): confirm against a real dry-run capture — ADR-0003 regression
 * corpus. The `TooExpensive`/`WeightLimitReached` wording is unconfirmed.
 */
const insufficientWeightRule: DiagnosticRule = {
  id: "insufficient-weight",
  matches: (ctx: DiagnosisContext): boolean =>
    errorMentions(ctx, ["weight", "tooexpensive", "weightnotcomputable", "exceedsstack"]),
  explain: (): ReturnType<typeof failureDiagnosis> =>
    failureDiagnosis({
      ruleId: "insufficient-weight",
      rootCause: "`BuyExecution` purchased less weight than the program needed to run.",
      explanation:
        "Execution is metered: `BuyExecution` buys a weight budget, and the program halted when it " +
        "ran out before completing.",
      suggestions: [
        "Raise the weight limit passed to `BuyExecution` (show needed vs bought).",
        "Reduce the work in the program if the extra weight cannot be paid for.",
      ],
    }),
};

/**
 * Fee asset not accepted by the destination, or balance too low to pay fees.
 * TODO(verify): confirm against a real dry-run capture — ADR-0003 regression
 * corpus. The `FeesNotMet`/`CannotPayFees` wording is unconfirmed.
 */
const feesUnpayableRule: DiagnosticRule = {
  id: "fees-unpayable",
  matches: (ctx: DiagnosisContext): boolean =>
    errorMentions(ctx, ["fee", "feesnotmet", "cannotpayfees", "notwithdrawable"]),
  explain: (): ReturnType<typeof failureDiagnosis> =>
    failureDiagnosis({
      ruleId: "fees-unpayable",
      rootCause: "The fee asset was not accepted on the destination, or the balance was too low to pay fees.",
      explanation:
        "The destination charges fees in specific assets; the asset offered for fees was either not an " +
        "accepted fee asset or insufficient to cover the cost.",
      suggestions: [
        "Show the accepted fee assets on the destination and pay in one of them.",
        "Ensure the fee-paying account holds enough of the accepted asset.",
      ],
    }),
};

/**
 * Assets left in the holding register (a missing `DepositAsset`), i.e. trapped.
 * Keyed on the emitted `AssetsTrapped` event rather than the error tag, since a
 * dry-run can succeed at the top level yet still trap leftovers.
 * TODO(verify): confirm against a real dry-run capture — ADR-0003 regression
 * corpus. The `XcmPallet`/`PolkadotXcm` "AssetsTrapped" event name is unconfirmed.
 */
const assetTrappedRule: DiagnosticRule = {
  id: "asset-trapped",
  matches: (ctx: DiagnosisContext): boolean =>
    hasEventMatching(ctx, ["trapped"]) || errorMentions(ctx, ["trapped", "holding"]),
  explain: (): ReturnType<typeof failureDiagnosis> =>
    failureDiagnosis({
      ruleId: "asset-trapped",
      rootCause: "Assets were left in the holding register and trapped (no `DepositAsset` consumed them).",
      explanation:
        "The holding register is a temporary buffer during execution; whatever is not deposited or " +
        "used by the end of the program is trapped and must be reclaimed.",
      suggestions: [
        "Add a `DepositAsset` for the leftover assets (surface the trapped asset + its location).",
        "Reclaim trapped assets via `ClaimAsset` if they are already stuck.",
      ],
    }),
};

/**
 * Ordered seed registry. Success first; then failures most- to least-distinctive.
 * `asset-trapped` is last among failures because it also inspects events and can
 * co-occur with a top-level success — the error-keyed rules above take precedence.
 */
export const seedRules: readonly DiagnosticRule[] = [
  successRule,
  barrierBlockedRule,
  versionMismatchRule,
  untrustedReserveRule,
  insufficientWeightRule,
  feesUnpayableRule,
  assetTrappedRule,
];

/** Re-export `isFailure` so consumers can pre-check without reaching into match.ts. */
export { isFailure };
