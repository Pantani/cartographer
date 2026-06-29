/**
 * Hand-crafted `DryRunEffects` fixtures for unit tests. Built only with the
 * type constructors from ../../types — sample data, no logic. These stand in
 * until the CLIENT agent commits a real dry-run regression corpus (ADR-0003);
 * the error tags / event names here mirror the defensive matchers in ../match.ts
 * and are NOT confirmed against on-chain output.
 */
import {
  dryRunEffects,
  executionFailure,
  executionSuccess,
  executionError,
  normalizedEvent,
  location,
  forwardedXcm,
  xcmProgram,
  xcmInstruction,
  type DryRunEffects,
} from "../../types/index.js";

/** A clean dry-run: top-level success, benign events, one forwarded message. */
export const successEffects: DryRunEffects = dryRunEffects({
  executionResult: executionSuccess(),
  xcmVersion: 4,
  events: [
    normalizedEvent("PolkadotXcm", "Attempted", { outcome: "Complete" }),
    normalizedEvent("Balances", "Withdraw", { amount: 1_000_000n }),
  ],
  localXcm: xcmProgram(4, [
    xcmInstruction("WithdrawAsset"),
    xcmInstruction("BuyExecution"),
    xcmInstruction("DepositAsset"),
  ]),
  forwardedXcms: [
    forwardedXcm(location(1), [xcmProgram(4, [xcmInstruction("ReserveAssetDeposited")])]),
  ],
});

/** Barrier rejected the message before execution. */
export const barrierBlockedEffects: DryRunEffects = dryRunEffects({
  executionResult: executionFailure(
    executionError("Barrier", { detail: "ShouldExecute returned NotAllowed" }),
  ),
  xcmVersion: 4,
  events: [normalizedEvent("PolkadotXcm", "Attempted", { outcome: "Error" })],
});

/** XCM version conversion failed at the destination. */
export const versionMismatchEffects: DryRunEffects = dryRunEffects({
  executionResult: executionFailure(
    executionError("UnhandledXcmVersion", { detail: "destination rejected version" }),
  ),
  xcmVersion: 2,
});

/** Reserve/teleport trust mismatch for the moved asset. */
export const untrustedReserveEffects: DryRunEffects = dryRunEffects({
  executionResult: executionFailure(
    executionError("UntrustedReserveLocation", { detail: "reserve not trusted by dest" }),
  ),
  xcmVersion: 4,
});

/** BuyExecution bought too little weight. */
export const insufficientWeightEffects: DryRunEffects = dryRunEffects({
  executionResult: executionFailure(
    executionError("TooExpensive", { detail: "weight limit reached before completion" }),
  ),
  xcmVersion: 4,
});

/** Fee asset not accepted / balance too low to pay fees. */
export const feesUnpayableEffects: DryRunEffects = dryRunEffects({
  executionResult: executionFailure(
    executionError("FeesNotMet", { detail: "fee asset not withdrawable" }),
  ),
  xcmVersion: 4,
});

/**
 * Synthetic overlap: both barrier and fee words are present. This is not a real
 * capture; it exists only to prove the current ordered registry keeps the more
 * specific earlier rule stable until real payloads replace it.
 */
export const barrierAndFeeOverlapEffects: DryRunEffects = dryRunEffects({
  executionResult: executionFailure(
    executionError("Barrier", { detail: "blocked before fees were met" }),
  ),
  xcmVersion: 4,
});

/**
 * Synthetic overlap: a version error plus a trapped-assets event. This is not a
 * real capture; it proves error-keyed rules above `asset-trapped` keep priority
 * when a failure event is also present.
 */
export const versionAndTrapOverlapEffects: DryRunEffects = dryRunEffects({
  executionResult: executionFailure(
    executionError("UnhandledXcmVersion", { detail: "version rejected after assets trapped" }),
  ),
  xcmVersion: 2,
  events: [normalizedEvent("PolkadotXcm", "AssetsTrapped", { hash: "0xdef" })],
});

/** Top-level success, but assets were left in holding and trapped. */
export const assetTrappedEffects: DryRunEffects = dryRunEffects({
  executionResult: executionSuccess(),
  xcmVersion: 4,
  events: [
    normalizedEvent("PolkadotXcm", "AssetsTrapped", {
      hash: "0xabc",
      origin: { parents: 1, interior: "Here" },
    }),
  ],
});

/** A failure whose error matches no seed rule → must diagnose as `unknown`. */
export const unrecognizedFailureEffects: DryRunEffects = dryRunEffects({
  executionResult: executionFailure(
    executionError("SomeBrandNewRuntimeError", { detail: "no seed rule covers this", raw: { code: 7 } }),
  ),
  xcmVersion: 4,
  events: [normalizedEvent("System", "ExtrinsicFailed", {})],
});
