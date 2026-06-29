import { describe, it, expect, vi } from "vitest";
import type { ChainClient } from "../client/index.js";
import type { TraceDeps } from "./index.js";
import { trace } from "./index.js";
import type { DryRunEffects, TraceRequest } from "../types/index.js";
import {
  accountOrigin,
  assetId,
  dryRunEffects,
  executionError,
  executionFailure,
  executionSuccess,
  feeEstimate,
  normalizedEvent,
  xcmProgram,
} from "../types/index.js";

const HEX = "0x0100" as const;

function request(): TraceRequest {
  return {
    rpc: "wss://example.test",
    origin: accountOrigin("//Alice"),
    resultXcmVersion: 4,
    format: "human",
    call: HEX,
  };
}

/** A fake ChainClient returning canned effects/fees — keeps the pipeline test network-free. */
function fakeClient(effects: DryRunEffects): { client: ChainClient; disconnect: ReturnType<typeof vi.fn> } {
  const disconnect = vi.fn();
  const client: ChainClient = {
    dryRunCall: () => Promise.resolve(effects),
    estimateFees: () => Promise.resolve(feeEstimate({ fee: 1_000n, asset: assetId({ symbol: "DOT" }) })),
    disconnect,
  };
  return { client, disconnect };
}

function deps(client: ChainClient): TraceDeps {
  return { openClient: () => client };
}

describe("trace (happy path)", () => {
  it("diagnoses a clean dry-run as success and attaches fees from the local XCM", async () => {
    const effects = dryRunEffects({
      executionResult: executionSuccess(),
      xcmVersion: 4,
      localXcm: xcmProgram(4, []),
    });
    const { client, disconnect } = fakeClient(effects);

    const result = await trace(request(), deps(client));

    expect(result.hops).toHaveLength(1);
    expect(result.diagnosis.status).toBe("success");
    expect(result.diagnosis.ruleId).toBe("success");
    expect(result.fees?.fee).toBe(1_000n);
    expect(result.hops[0]?.chain.rpc).toBe("wss://example.test");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("omits fees when the dry-run produced no local XCM", async () => {
    const effects = dryRunEffects({ executionResult: executionSuccess(), xcmVersion: 4 });
    const { client } = fakeClient(effects);

    const result = await trace(request(), deps(client));

    expect(result).not.toHaveProperty("fees");
    expect(result.diagnosis.status).toBe("success");
  });
});

describe("trace (known failing path)", () => {
  it("diagnoses a barrier rejection as failure with the barrier-blocked rule", async () => {
    const effects = dryRunEffects({
      executionResult: executionFailure(executionError("Barrier", { detail: "ShouldExecute denied" })),
      xcmVersion: 4,
      events: [normalizedEvent("PolkadotXcm", "Attempted")],
    });
    const { client, disconnect } = fakeClient(effects);

    const result = await trace(request(), deps(client));

    expect(result.diagnosis.status).toBe("failure");
    expect(result.diagnosis.ruleId).toBe("barrier-blocked");
    expect(result.diagnosis.rootCause).toContain("barrier");
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

describe("trace (guards)", () => {
  it("rejects the unsupported raw-XCM path and still disconnects", async () => {
    const effects = dryRunEffects({ executionResult: executionSuccess(), xcmVersion: 4 });
    const { client, disconnect } = fakeClient(effects);
    const xcmRequest: TraceRequest = {
      rpc: "wss://example.test",
      origin: accountOrigin("//Alice"),
      resultXcmVersion: 4,
      format: "human",
      xcm: xcmProgram(4, []),
    };

    await expect(trace(xcmRequest, deps(client))).rejects.toThrow(/not supported/i);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
