import { describe, it, expect, vi, beforeEach } from "vitest";

import { openChainClient } from "./papi.js";
import { accountOrigin, location, locationOrigin, xcmInstruction, xcmProgram, type HexString } from "../types/index.js";

const mocks = vi.hoisted(() => ({
  dryRunCall: vi.fn(),
  queryAcceptablePaymentAssets: vi.fn(),
  queryWeightToAssetFee: vi.fn(),
  queryXcmWeight: vi.fn(),
  txFromCallData: vi.fn(),
  destroy: vi.fn(),
  createClient: vi.fn(),
  getWsProvider: vi.fn(),
  withPolkadotSdkCompat: vi.fn(),
}));

vi.mock("polkadot-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("polkadot-api")>();
  return {
    ...original,
    createClient: mocks.createClient,
  };
});

vi.mock("polkadot-api/ws-provider", () => ({
  getWsProvider: mocks.getWsProvider,
}));

vi.mock("polkadot-api/polkadot-sdk-compat", () => ({
  withPolkadotSdkCompat: mocks.withPolkadotSdkCompat,
}));

const CALL = "0x1234" as HexString;

function mockApi() {
  return {
    apis: {
      DryRunApi: { dry_run_call: mocks.dryRunCall },
      XcmPaymentApi: {
        query_acceptable_payment_assets: mocks.queryAcceptablePaymentAssets,
        query_weight_to_asset_fee: mocks.queryWeightToAssetFee,
        query_xcm_weight: mocks.queryXcmWeight,
      },
    },
    txFromCallData: mocks.txFromCallData,
  };
}

function ok<T>(value: T) {
  return { success: true, value };
}

describe("openChainClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWsProvider.mockReturnValue("provider");
    mocks.withPolkadotSdkCompat.mockReturnValue("compat-provider");
    mocks.createClient.mockReturnValue({
      getUnsafeApi: () => mockApi(),
      destroy: mocks.destroy,
    });
    mocks.txFromCallData.mockResolvedValue({
      decodedCall: { type: "PolkadotXcm", value: { type: "limited_reserve_transfer_assets", value: {} } },
    });
    mocks.dryRunCall.mockResolvedValue(ok({ execution_result: ok({ result: "Ok" }), emitted_events: [], forwarded_xcms: [] }));
  });

  it("opens PAPI through the websocket provider and destroys the client", () => {
    const client = openChainClient("wss://example.test");

    client.disconnect();

    expect(mocks.getWsProvider).toHaveBeenCalledWith("wss://example.test");
    expect(mocks.withPolkadotSdkCompat).toHaveBeenCalledWith("provider");
    expect(mocks.createClient).toHaveBeenCalledWith("compat-provider");
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("decodes call data and invokes DryRunApi.dry_run_call with a signed origin caller", async () => {
    const client = openChainClient("wss://example.test");

    const effects = await client.dryRunCall(accountOrigin("5Alice"), CALL, 5);

    expect(mocks.txFromCallData).toHaveBeenCalledOnce();
    expect(mocks.dryRunCall).toHaveBeenCalledWith(
      { type: "system", value: { type: "Signed", value: "5Alice" } },
      { type: "PolkadotXcm", value: { type: "limited_reserve_transfer_assets", value: {} } },
      5,
    );
    expect(effects.executionResult.kind).toBe("success");
  });

  it("accepts an already-unwrapped dry-run effects payload", async () => {
    mocks.dryRunCall.mockResolvedValue({ execution_result: ok({ result: "Ok" }), emitted_events: [], forwarded_xcms: [] });
    const client = openChainClient("wss://example.test");

    const effects = await client.dryRunCall(accountOrigin("5Alice"), CALL, 4);

    expect(effects.executionResult.kind).toBe("success");
  });

  it("rejects a DryRunApi runtime Err with the decoded payload attached", async () => {
    mocks.dryRunCall.mockResolvedValue({ success: false, value: { type: "Unsupported", value: 7n } });
    const client = openChainClient("wss://example.test");

    await expect(client.dryRunCall(accountOrigin("5Alice"), CALL, 4)).rejects.toThrow(
      'DryRunApi.dry_run_call returned Err: {"type":"Unsupported","value":"7"}',
    );
  });

  it("rejects a location origin for dryRunCall because it is not an OriginCaller", async () => {
    const client = openChainClient("wss://example.test");

    await expect(client.dryRunCall(locationOrigin(location(0)), CALL, 4)).rejects.toThrow(/location origin/i);

    expect(mocks.dryRunCall).not.toHaveBeenCalled();
  });

  it("estimates execution fees using xcm weight, acceptable asset, then weight-to-asset fee", async () => {
    mocks.queryXcmWeight.mockResolvedValue(ok({ ref_time: 100n, proof_size: 2n }));
    mocks.queryAcceptablePaymentAssets.mockResolvedValue(ok([{ type: "V4", value: { parents: 0, interior: "Here" } }]));
    mocks.queryWeightToAssetFee.mockResolvedValue(ok(12_345n));
    const client = openChainClient("wss://example.test");
    const xcm = xcmProgram(4, [xcmInstruction("ClearOrigin")]);

    const fees = await client.estimateFees(xcm);

    const versionedXcm = { type: "V4", value: [{ type: "ClearOrigin" }] };
    const asset = { type: "V4", value: { parents: 0, interior: "Here" } };
    expect(mocks.queryXcmWeight).toHaveBeenCalledWith(versionedXcm);
    expect(mocks.queryAcceptablePaymentAssets).toHaveBeenCalledWith(4);
    expect(mocks.queryWeightToAssetFee).toHaveBeenCalledWith({ ref_time: 100n, proof_size: 2n }, asset);
    expect(fees).toEqual({
      fee: 12_345n,
      asset: { location: { parents: 0, interior: "Here" } },
      weight: { refTime: 100n, proofSize: 2n },
    });
  });

  it.each([
    [2, "V2"],
    [3, "V3"],
    [5, "V5"],
  ] as const)("encodes XCM v%s programs before fee estimation", async (version, tag) => {
    mocks.queryXcmWeight.mockResolvedValue(ok({ ref_time: 100n, proof_size: 2n }));
    mocks.queryAcceptablePaymentAssets.mockResolvedValue(ok([{ type: "V4", value: { parents: 0, interior: "Here" } }]));
    mocks.queryWeightToAssetFee.mockResolvedValue(ok(12_345n));
    const client = openChainClient("wss://example.test");

    await client.estimateFees(xcmProgram(version, [xcmInstruction("WithdrawAsset", [{ id: "DOT" }])]));

    expect(mocks.queryXcmWeight).toHaveBeenCalledWith({
      type: tag,
      value: [{ type: "WithdrawAsset", value: [{ id: "DOT" }] }],
    });
  });

  it("rejects fee estimation when the runtime returns no acceptable payment assets", async () => {
    mocks.queryXcmWeight.mockResolvedValue(ok({ ref_time: 100n, proof_size: 2n }));
    mocks.queryAcceptablePaymentAssets.mockResolvedValue(ok([]));
    const client = openChainClient("wss://example.test");

    await expect(client.estimateFees(xcmProgram(4, [xcmInstruction("ClearOrigin")]))).rejects.toThrow(
      /no payment assets/,
    );
    expect(mocks.queryWeightToAssetFee).not.toHaveBeenCalled();
  });
});
