import { describe, it, expect } from "vitest";
import { render, renderHuman, renderJson } from "./index.js";
import { formatEvents, formatForwardedXcms, formatRawEffects } from "./format.js";
import {
  assetId,
  chainRef,
  dryRunEffects,
  executionError,
  executionFailure,
  executionSuccess,
  feeEstimate,
  forwardedXcm,
  hop,
  location,
  normalizedEvent,
  singleHopTrace,
  successDiagnosis,
  traceResult,
  xcmProgram,
} from "../types/index.js";
import {
  failureTrace,
  forwardedTrace,
  successTrace,
  unknownTrace,
} from "./__fixtures__/traces.js";

const fixtures = [
  ["success", successTrace],
  ["failure", failureTrace],
  ["unknown", unknownTrace],
  ["forwarded", forwardedTrace],
] as const;

describe("renderHuman", () => {
  for (const [name, trace] of fixtures) {
    it(`renders the ${name} trace deterministically`, () => {
      expect(renderHuman(trace)).toMatchSnapshot();
    });
  }

  it("surfaces events and forwarded XCM details for a single hop", () => {
    const rendered = renderHuman(forwardedTrace);
    expect(rendered).toContain("Events:");
    expect(rendered).toContain("PolkadotXcm.Sent {\"count\":\"1\"}");
    expect(rendered).toContain("Forwarded XCM:");
    expect(rendered).toContain("destination {\"parents\":1,\"interior\":{\"X1\":{\"Parachain\":\"2000\"}}}");
    expect(rendered).toContain("message 0: v4 ReserveAssetDeposited, ClearOrigin");
  });

  it("uses rpc and unknown-chain fallbacks when a hop has no chain name", () => {
    const effects = dryRunEffects({ executionResult: executionSuccess(), xcmVersion: 4 });
    const withRpc = singleHopTrace(
      hop({ index: 0, chain: chainRef({ rpc: "wss://relay.example" }), effects, diagnosis: successDiagnosis() }),
    );
    const unknown = singleHopTrace(
      hop({ index: 1, chain: chainRef(), effects, diagnosis: successDiagnosis() }),
    );

    expect(renderHuman(withRpc)).toContain("Hop 0 @ wss://relay.example");
    expect(renderHuman(unknown)).toContain("Hop 1 @ unknown chain");
  });

  it("renders trace-level fees with location and unknown asset labels", () => {
    const effects = dryRunEffects({ executionResult: executionSuccess(), xcmVersion: 4 });
    const baseHop = hop({ index: 0, chain: chainRef({ name: "Relay" }), effects, diagnosis: successDiagnosis() });
    const withLocationFee = traceResult({
      hops: [baseHop],
      diagnosis: baseHop.diagnosis,
      fees: feeEstimate({ fee: 1n, asset: assetId({ location: { parents: 0, interior: "Here" } }) }),
    });
    const withUnknownFee = traceResult({
      hops: [baseHop],
      diagnosis: baseHop.diagnosis,
      fees: feeEstimate({ fee: 2n, asset: assetId({}) }),
    });

    expect(renderHuman(withLocationFee)).toContain('Fee: 1 location {"parents":0,"interior":"Here"}');
    expect(renderHuman(withUnknownFee)).toContain("Fee: 2 unknown asset");
  });

  it("formats defensive normalized event values", () => {
    expect(
      formatEvents([
        { pallet: "System", name: "Remarked", data: 1n as unknown as ReturnType<typeof normalizedEvent>["data"] },
        { pallet: "System", name: "Remarked", data: "raw" as unknown as ReturnType<typeof normalizedEvent>["data"] },
      ]),
    ).toEqual(["  System.Remarked 1", "  System.Remarked raw"]);
  });

  it("formats empty forwarded XCM programs explicitly", () => {
    expect(formatForwardedXcms([forwardedXcm(location(1), [xcmProgram(4)])])).toContain("    message 0: v4 (empty)");
  });

  it("formats raw effects for success and failures without details", () => {
    expect(formatRawEffects(dryRunEffects({ executionResult: executionSuccess(), xcmVersion: 4 }))).toContain(
      "  executionResult: success",
    );
    expect(
      formatRawEffects(
        dryRunEffects({ executionResult: executionFailure(executionError("Barrier")), xcmVersion: 4 }),
      ),
    ).toContain("  executionResult: failure (Barrier)");
  });
});

describe("renderJson", () => {
  for (const [name, trace] of fixtures) {
    it(`renders the ${name} trace deterministically`, () => {
      expect(renderJson(trace)).toMatchSnapshot();
    });
  }

  it("encodes bigint as a tagged decimal string and round-trips", () => {
    const parsed = JSON.parse(renderJson(successTrace)) as Record<string, unknown>;
    const hops = parsed["hops"] as ReadonlyArray<Record<string, unknown>>;
    const fees = hops[0]?.["fees"] as Record<string, unknown>;
    expect(fees["fee"]).toEqual({ $bigint: "12345678900" });
  });
});

describe("render dispatcher", () => {
  it("matches renderHuman for the human format", () => {
    expect(render(successTrace, "human")).toBe(renderHuman(successTrace));
  });

  it("matches renderJson for the json format", () => {
    expect(render(successTrace, "json")).toBe(renderJson(successTrace));
  });
});
