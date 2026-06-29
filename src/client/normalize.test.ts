import { describe, it, expect } from "vitest";

import {
  normalizeEffects,
  normalizeEvent,
  normalizeExecutionResult,
  normalizeFees,
  normalizeLocation,
  normalizeProgram,
  toNormalized,
  xcmVersionFromTag,
} from "./normalize.js";
import type {
  PapiCallDryRunEffects,
  PapiEventEntry,
  PapiFeePayload,
  PapiVersionedLocation,
  PapiVersionedXcm,
} from "./papi-shapes.js";

describe("xcmVersionFromTag", () => {
  it("maps known tags to the domain version", () => {
    expect(xcmVersionFromTag("V2")).toBe(2);
    expect(xcmVersionFromTag("V3")).toBe(3);
    expect(xcmVersionFromTag("V4")).toBe(4);
    expect(xcmVersionFromTag("V5")).toBe(5);
  });

  it("throws on an unknown tag", () => {
    expect(() => xcmVersionFromTag("V9")).toThrow(/unknown XCM version tag/);
  });
});

describe("toNormalized", () => {
  it("preserves bigint and primitives", () => {
    expect(toNormalized(10n)).toBe(10n);
    expect(toNormalized("x")).toBe("x");
    expect(toNormalized(true)).toBe(true);
    expect(toNormalized(undefined)).toBeNull();
  });

  it("recurses into arrays and objects, keeping bigint", () => {
    expect(toNormalized({ a: [1n, "b"], c: { d: false } })).toEqual({
      a: [1n, "b"],
      c: { d: false },
    });
  });
});

describe("normalizeExecutionResult", () => {
  it("maps an Ok result to success", () => {
    expect(normalizeExecutionResult({ success: true })).toEqual({ kind: "success" });
  });

  it("maps an Err result to a failure carrying the enum tag and raw payload", () => {
    const result = normalizeExecutionResult({
      success: false,
      value: { type: "Module", value: { index: 1n, error: "0x02" } },
    });
    expect(result).toEqual({
      kind: "failure",
      error: {
        type: "Module",
        raw: { type: "Module", value: { index: 1n, error: "0x02" } },
      },
    });
  });

  it("falls back to Unknown when the error has no enum tag", () => {
    const result = normalizeExecutionResult({ success: false, value: "boom" });
    expect(result).toEqual({ kind: "failure", error: { type: "Unknown", raw: "boom" } });
  });
});

describe("normalizeEvent", () => {
  it("maps the outer enum to pallet and the inner enum to name + decoded data", () => {
    const entry: PapiEventEntry = {
      type: "Balances",
      value: { type: "Withdraw", value: { who: "0xabc", amount: 1000n } },
    };
    expect(normalizeEvent(entry)).toEqual({
      pallet: "Balances",
      name: "Withdraw",
      data: { who: "0xabc", amount: 1000n },
    });
  });

  it("wraps a non-struct inner payload under `value`", () => {
    const entry: PapiEventEntry = { type: "System", value: { type: "ExtrinsicSuccess", value: 7n } };
    expect(normalizeEvent(entry)).toEqual({ pallet: "System", name: "ExtrinsicSuccess", data: { value: 7n } });
  });
});

describe("normalizeLocation", () => {
  it("maps parents + interior structurally", () => {
    const loc: PapiVersionedLocation = { type: "V4", value: { parents: 1, interior: { X1: { Parachain: 1000n } } } };
    expect(normalizeLocation(loc)).toEqual({ parents: 1, interior: { X1: { Parachain: 1000n } } });
  });
});

describe("normalizeProgram", () => {
  it("maps a versioned xcm to version + instructions", () => {
    const program: PapiVersionedXcm = {
      type: "V3",
      value: [
        { type: "WithdrawAsset", value: [{ id: "DOT", fun: 10n }] },
        { type: "ClearOrigin" },
      ],
    };
    expect(normalizeProgram(program)).toEqual({
      version: 3,
      instructions: [
        { kind: "WithdrawAsset", args: [{ id: "DOT", fun: 10n }] },
        { kind: "ClearOrigin", args: null },
      ],
    });
  });
});

describe("normalizeEffects", () => {
  it("normalizes a full successful dry-run with a forwarded message", () => {
    const effects: PapiCallDryRunEffects = {
      execution_result: { success: true },
      emitted_events: [{ type: "PolkadotXcm", value: { type: "Sent", value: { count: 1n } } }],
      local_xcm: { type: "V4", value: [{ type: "ClearOrigin" }] },
      forwarded_xcms: [
        [
          { type: "V4", value: { parents: 1, interior: { X1: { Parachain: 2000n } } } },
          [{ type: "V4", value: [{ type: "ReserveAssetDeposited", value: [] }] }],
        ],
      ],
    };

    const out = normalizeEffects(effects, 4);

    expect(out.executionResult).toEqual({ kind: "success" });
    expect(out.xcmVersion).toBe(4);
    expect(out.events).toEqual([{ pallet: "PolkadotXcm", name: "Sent", data: { count: 1n } }]);
    expect(out.localXcm).toEqual({ version: 4, instructions: [{ kind: "ClearOrigin", args: null }] });
    expect(out.forwardedXcms).toEqual([
      {
        destination: { parents: 1, interior: { X1: { Parachain: 2000n } } },
        messages: [{ version: 4, instructions: [{ kind: "ReserveAssetDeposited", args: [] }] }],
      },
    ]);
  });

  it("omits localXcm when absent and surfaces an execution failure", () => {
    const effects: PapiCallDryRunEffects = {
      execution_result: { success: false, value: { type: "Barrier" } },
      emitted_events: [],
      forwarded_xcms: [],
    };
    const out = normalizeEffects(effects, 3);
    expect(out.localXcm).toBeUndefined();
    expect(out.forwardedXcms).toEqual([]);
    expect(out.executionResult).toEqual({ kind: "failure", error: { type: "Barrier", raw: { type: "Barrier" } } });
  });
});

describe("normalizeFees", () => {
  it("maps fee, asset location and weight", () => {
    const payload: PapiFeePayload = {
      fee: 12_345n,
      assetLocation: { parents: 0, interior: "Here" },
      weight: { ref_time: 1_000n, proof_size: 64n },
    };
    expect(normalizeFees(payload)).toEqual({
      fee: 12_345n,
      asset: { location: { parents: 0, interior: "Here" } },
      weight: { refTime: 1_000n, proofSize: 64n },
    });
  });

  it("maps a bare fee with an empty asset when no asset/weight is provided", () => {
    expect(normalizeFees({ fee: 5n })).toEqual({ fee: 5n, asset: {} });
  });
});
