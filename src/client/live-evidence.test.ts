import { describe, expect, it } from "vitest";

import { makeDryRunEvidence, toEvidenceJson, type LiveFeesEvidence } from "./live-evidence.js";
import type { DryRunEffects, HexString } from "../types/index.js";

const CALL = "0x1234" as HexString;

function effects(): DryRunEffects {
  return {
    executionResult: { kind: "success" },
    xcmVersion: 4,
    events: [{ pallet: "PolkadotXcm", name: "Sent", data: { count: 1n } }],
    forwardedXcms: [],
  };
}

describe("makeDryRunEvidence", () => {
  it("summarizes raw dry-run shape while preserving raw and normalized payloads", () => {
    const rawDryRun = {
      success: true,
      value: {
        execution_result: { success: true, value: undefined },
        emitted_events: [{ type: "PolkadotXcm", value: { type: "Sent", value: { count: 1n } } }],
        local_xcm: { type: "V4", value: [{ type: "ClearOrigin" }] },
        forwarded_xcms: [[{ type: "V4", value: { parents: 1, interior: "Here" } }, []]],
      },
    };
    const fees: LiveFeesEvidence = {
      kind: "estimated",
      value: { fee: 10n, asset: { location: { parents: 0, interior: "Here" } } },
      raw: {
        weight: { success: true, value: { ref_time: 1n, proof_size: 2n } },
        assets: { success: true, value: [{ type: "V4", value: { parents: 0, interior: "Here" } }] },
        selectedAsset: { type: "V4", value: { parents: 0, interior: "Here" } },
        fee: { success: true, value: 10n },
      },
    };

    const evidence = makeDryRunEvidence({
      label: "happy",
      account: "5Alice",
      call: CALL,
      resultXcmVersion: 4,
      rawDryRun,
      normalizedEffects: effects(),
      fees,
    });

    expect(evidence.input).toEqual({ account: "5Alice", callBytes: 2, resultXcmVersion: 4 });
    expect(evidence.rawShape).toEqual({
      wrappedResult: true,
      topLevelKeys: ["success", "value"],
      effectsKeys: ["execution_result", "emitted_events", "local_xcm", "forwarded_xcms"],
      emittedEventsCount: 1,
      emittedEventSample: { type: "PolkadotXcm", value: { type: "Sent", value: { count: 1n } } },
      localXcmSample: { type: "V4", value: [{ type: "ClearOrigin" }] },
      forwardedXcmsCount: 1,
      forwardedXcmSample: [{ type: "V4", value: { parents: 1, interior: "Here" } }, []],
    });
    expect(evidence.rawDryRun).toEqual(rawDryRun);
    expect(evidence.normalizedEffects).toEqual(effects());
    expect(evidence.fees).toBe(fees);
  });

  it("summarizes an unwrapped dry-run with empty optional collections", () => {
    const rawDryRun = {
      execution_result: { success: true },
      emitted_events: [],
      forwarded_xcms: [],
    };

    const evidence = makeDryRunEvidence({
      label: "unwrapped",
      account: "5Alice",
      call: "1234" as HexString,
      resultXcmVersion: 4,
      rawDryRun,
      normalizedEffects: effects(),
      fees: { kind: "skipped", reason: "no local xcm" },
    });

    expect(evidence.input.callBytes).toBe(2);
    expect(evidence.rawShape).toEqual({
      wrappedResult: false,
      topLevelKeys: ["execution_result", "emitted_events", "forwarded_xcms"],
      effectsKeys: ["execution_result", "emitted_events", "forwarded_xcms"],
      emittedEventsCount: 0,
      forwardedXcmsCount: 0,
    });
  });

  it("keeps a primitive raw payload describable without optional shape fields", () => {
    const evidence = makeDryRunEvidence({
      label: "primitive",
      account: "5Alice",
      call: CALL,
      resultXcmVersion: 4,
      rawDryRun: "not a record",
      normalizedEffects: effects(),
      fees: { kind: "failed", error: "payment unavailable" },
    });

    expect(evidence.rawShape).toEqual({
      wrappedResult: false,
      topLevelKeys: [],
      effectsKeys: [],
    });
  });
});

describe("toEvidenceJson", () => {
  it("renders bigint values as strings so live evidence can be printed as JSON", () => {
    expect(toEvidenceJson({ amount: 10n })).toBe('{\n  "amount": "10"\n}');
  });
});
