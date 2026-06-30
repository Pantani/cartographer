// Deterministic TraceResult fixtures for report snapshot tests.
// Built only from types/ constructors. ESLint ignores __fixtures__.
import {
  assetId,
  chainRef,
  dryRunEffects,
  executionError,
  executionFailure,
  executionSuccess,
  failureDiagnosis,
  feeEstimate,
  forwardedXcm,
  hop,
  location,
  normalizedEvent,
  singleHopTrace,
  successDiagnosis,
  traceResult,
  unknownDiagnosis,
  weight,
  type TraceResult,
  xcmInstruction,
  xcmProgram,
} from "../../types/index.js";

const DOT = assetId({ symbol: "DOT", decimals: 10 });

/** SUCCESS: a clean single-hop trace carrying a fee estimate (with weight). */
export const successTrace: TraceResult = singleHopTrace(
  hop({
    index: 0,
    chain: chainRef({ name: "Asset Hub", rpc: "wss://asset-hub.example" }),
    effects: dryRunEffects({
      executionResult: executionSuccess(),
      xcmVersion: 4,
      events: [
        normalizedEvent("Balances", "Withdraw", { who: "0xabc", amount: 1_000_000_000n }),
        normalizedEvent("PolkadotXcm", "Attempted", { outcome: "Complete" }),
      ],
    }),
    diagnosis: successDiagnosis({ explanation: "All instructions executed; holding register empty." }),
    fees: feeEstimate({
      fee: 12_345_678_900n,
      asset: DOT,
      weight: weight(2_000_000_000n, 65_536n),
    }),
  }),
);

/** FAILURE: a barrier-blocked diagnosis with root cause, explanation, and suggestions. */
export const failureTrace: TraceResult = singleHopTrace(
  hop({
    index: 0,
    chain: chainRef({ name: "Bridge Hub", rpc: "wss://bridge-hub.example" }),
    effects: dryRunEffects({
      executionResult: executionFailure(
        executionError("Barrier", { detail: "origin not allowed by entry barrier" }),
      ),
      xcmVersion: 4,
      events: [normalizedEvent("PolkadotXcm", "Attempted", { outcome: "Error" })],
    }),
    diagnosis: failureDiagnosis({
      ruleId: "barrier-blocked",
      rootCause: "The destination's entry barrier rejected the message.",
      explanation: "The origin location is not in the destination's allowed-origin set.",
      suggestions: [
        "Verify the origin chain is trusted by the destination.",
        "Check the destination's barrier / allowed-origin configuration.",
      ],
    }),
    fees: feeEstimate({ fee: 9_876_543_210n, asset: DOT }),
  }),
);

/** UNKNOWN: an unrecognized failure — status unknown, events present for the raw dump. */
export const unknownTrace: TraceResult = singleHopTrace(
  hop({
    index: 0,
    chain: chainRef({ name: "Parachain 2000" }),
    effects: dryRunEffects({
      executionResult: executionFailure(
        executionError("Unknown", { detail: "unmapped XCM error variant", raw: { code: 255n } }),
      ),
      xcmVersion: 3,
      events: [
        normalizedEvent("System", "ExtrinsicFailed", { error: "Module(7)" }),
        normalizedEvent("PolkadotXcm", "Attempted", { outcome: "Incomplete" }),
      ],
    }),
    diagnosis: unknownDiagnosis(),
  }),
);

/** FORWARDED: a successful hop that queued one XCM message for another chain. */
export const forwardedTrace: TraceResult = singleHopTrace(
  hop({
    index: 0,
    chain: chainRef({ name: "Relay Chain", rpc: "wss://relay.example" }),
    effects: dryRunEffects({
      executionResult: executionSuccess(),
      xcmVersion: 4,
      events: [normalizedEvent("PolkadotXcm", "Sent", { count: 1n })],
      forwardedXcms: [
        forwardedXcm(
          location(1, { X1: { Parachain: 2000n } }),
          [
            xcmProgram(4, [
              xcmInstruction("ReserveAssetDeposited", [{ id: "DOT", fun: 500_000_000n }]),
              xcmInstruction("ClearOrigin"),
            ]),
          ],
        ),
      ],
    }),
    diagnosis: successDiagnosis({
      explanation: "The first hop executed and queued a message for the next destination.",
    }),
  }),
);

/** MULTI-HOP FAILURE: a route where the second hop is the decisive failure. */
export const multiHopFailureTrace: TraceResult = traceResult({
  hops: [
    hop({
      index: 0,
      chain: chainRef({ name: "Relay Chain", rpc: "wss://relay.example" }),
      effects: dryRunEffects({
        executionResult: executionSuccess(),
        xcmVersion: 4,
        forwardedXcms: [forwardedXcm(location(1, { X1: { Parachain: 1000 } }), [xcmProgram(4)])],
      }),
      diagnosis: successDiagnosis(),
    }),
    hop({
      index: 1,
      chain: chainRef({
        name: "Asset Hub",
        rpc: "wss://asset-hub.example",
        location: location(1, { X1: { Parachain: 1000 } }),
      }),
      effects: dryRunEffects({
        executionResult: executionFailure(executionError("Barrier", { detail: "origin denied" })),
        xcmVersion: 4,
        events: [normalizedEvent("PolkadotXcm", "Attempted", { outcome: "Error" })],
      }),
      diagnosis: failureDiagnosis({
        ruleId: "barrier-blocked",
        rootCause: "The destination's entry barrier rejected the message.",
      }),
    }),
  ],
  diagnosis: failureDiagnosis({
    ruleId: "barrier-blocked",
    rootCause: "The destination's entry barrier rejected the message.",
  }),
});
