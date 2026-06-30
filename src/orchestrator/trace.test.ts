import { describe, it, expect, vi } from "vitest";
import type { ChainClient } from "../client/index.js";
import { createStaticRegistry } from "../registry/index.js";
import type { TraceDeps } from "./index.js";
import { trace } from "./index.js";
import { threeHopRouteFixture } from "./__fixtures__/routes.js";
import type { DryRunEffects, TraceRequest } from "../types/index.js";
import {
  accountOrigin,
  assetId,
  dryRunEffects,
  executionError,
  executionFailure,
  executionSuccess,
  feeEstimate,
  forwardedXcm,
  location,
  locationOrigin,
  normalizedEvent,
  xcmInstruction,
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
    dryRunXcm: () => Promise.resolve(effects),
    estimateFees: () => Promise.resolve(feeEstimate({ fee: 1_000n, asset: assetId({ symbol: "DOT" }) })),
    disconnect,
  };
  return { client, disconnect };
}

function fakeClientWith(params: {
  dryRunCall?: ChainClient["dryRunCall"];
  dryRunXcm?: ChainClient["dryRunXcm"];
  estimateFees?: ChainClient["estimateFees"];
}): { client: ChainClient; disconnect: ReturnType<typeof vi.fn> } {
  const disconnect = vi.fn();
  return {
    client: {
      dryRunCall: params.dryRunCall ?? (() => Promise.reject(new Error("unexpected dryRunCall"))),
      dryRunXcm: params.dryRunXcm ?? (() => Promise.reject(new Error("unexpected dryRunXcm"))),
      estimateFees: params.estimateFees ?? (() => Promise.resolve(feeEstimate({ fee: 1n, asset: assetId({}) }))),
      disconnect,
    },
    disconnect,
  };
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
  it("dry-runs a raw XCM program with a location origin and still disconnects", async () => {
    const effects = dryRunEffects({ executionResult: executionSuccess(), xcmVersion: 4 });
    const { client, disconnect } = fakeClient(effects);
    const dryRunXcm = vi.spyOn(client, "dryRunXcm");
    const xcmRequest: TraceRequest = {
      rpc: "wss://example.test",
      origin: locationOrigin(location(1)),
      resultXcmVersion: 4,
      format: "human",
      xcm: xcmProgram(4, []),
    };

    const result = await trace(xcmRequest, deps(client));

    expect(result.diagnosis.status).toBe("success");
    expect(dryRunXcm).toHaveBeenCalledWith(locationOrigin(location(1)), xcmProgram(4, []));
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

describe("trace (multi-hop)", () => {
  it("traces a representative three-hop relay to destination fixture", async () => {
    const originClient = fakeClientWith({
      dryRunCall: () => Promise.resolve(threeHopRouteFixture.originEffects),
    });
    const assetHubDryRun = vi.fn(() => Promise.resolve(threeHopRouteFixture.assetHubEffects));
    const assetHubClient = fakeClientWith({ dryRunXcm: assetHubDryRun });
    const destinationDryRun = vi.fn(() => Promise.resolve(threeHopRouteFixture.destinationEffects));
    const destinationClient = fakeClientWith({ dryRunXcm: destinationDryRun });
    const openClient = vi.fn((rpc: string) => {
      if (rpc === "wss://relay.test") return originClient.client;
      if (rpc === "wss://asset-hub.test") return assetHubClient.client;
      return destinationClient.client;
    });

    const result = await trace(
      { ...request(), rpc: "wss://relay.test" },
      {
        openClient,
        registry: threeHopRouteFixture.registry,
        maxDepth: 3,
      },
    );

    expect(result.hops.map((h) => h.chain.name ?? h.chain.rpc)).toEqual([
      "wss://relay.test",
      "Asset Hub",
      "Destination Para",
    ]);
    expect(result.diagnosis.status).toBe("success");
    expect(assetHubDryRun).toHaveBeenCalledWith(
      locationOrigin(threeHopRouteFixture.assetHubLocation),
      threeHopRouteFixture.toAssetHub,
    );
    expect(destinationDryRun).toHaveBeenCalledWith(
      locationOrigin(threeHopRouteFixture.destinationLocation),
      threeHopRouteFixture.toDestination,
    );
  });

  it("follows forwarded XCM through a resolved destination endpoint", async () => {
    const destination = location(1, { X1: { Parachain: 1000 } });
    const message = xcmProgram(4, [xcmInstruction("ClearOrigin")]);
    const firstEffects = dryRunEffects({
      executionResult: executionSuccess(),
      xcmVersion: 4,
      forwardedXcms: [forwardedXcm(destination, [message])],
    });
    const secondEffects = dryRunEffects({ executionResult: executionSuccess(), xcmVersion: 4 });
    const originClient = fakeClientWith({ dryRunCall: () => Promise.resolve(firstEffects) });
    const destinationDryRun = vi.fn(() => Promise.resolve(secondEffects));
    const destinationClient = fakeClientWith({ dryRunXcm: destinationDryRun });
    const openClient = vi.fn((rpc: string) =>
      rpc === "wss://origin.test" ? originClient.client : destinationClient.client,
    );

    const result = await trace(
      { ...request(), rpc: "wss://origin.test" },
      {
        openClient,
        registry: createStaticRegistry([
          { location: destination, rpc: "wss://asset-hub.test", name: "Asset Hub" },
        ]),
      },
    );

    expect(result.hops).toHaveLength(2);
    expect(result.hops[1]?.chain).toEqual({
      rpc: "wss://asset-hub.test",
      name: "Asset Hub",
      location: destination,
    });
    expect(destinationDryRun).toHaveBeenCalledWith(locationOrigin(destination), message);
    expect(originClient.disconnect).toHaveBeenCalledOnce();
    expect(destinationClient.disconnect).toHaveBeenCalledOnce();
  });

  it("fails rather than silently dropping unresolved forwarded XCM when a registry is configured", async () => {
    const destination = location(1, { X1: { Parachain: 2000n } });
    const effects = dryRunEffects({
      executionResult: executionSuccess(),
      xcmVersion: 4,
      forwardedXcms: [forwardedXcm(destination, [xcmProgram(4)])],
    });
    const { client, disconnect } = fakeClientWith({ dryRunCall: () => Promise.resolve(effects) });

    await expect(
      trace(request(), { openClient: () => client, registry: createStaticRegistry([]) }),
    ).rejects.toThrow(/unresolved/i);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("fails on a repeated forwarded XCM cycle before re-running the same route edge", async () => {
    const destination = location(1, { X1: { Parachain: 1000 } });
    const message = xcmProgram(4, [xcmInstruction("ClearOrigin", { repeat: 1n })]);
    const firstEffects = dryRunEffects({
      executionResult: executionSuccess(),
      xcmVersion: 4,
      forwardedXcms: [forwardedXcm(destination, [message])],
    });
    const cyclicEffects = dryRunEffects({
      executionResult: executionSuccess(),
      xcmVersion: 4,
      forwardedXcms: [forwardedXcm(destination, [message])],
    });
    const originClient = fakeClientWith({ dryRunCall: () => Promise.resolve(firstEffects) });
    const destinationDryRun = vi.fn(() => Promise.resolve(cyclicEffects));
    const destinationClient = fakeClientWith({ dryRunXcm: destinationDryRun });
    const openClient = vi.fn((rpc: string) =>
      rpc === "wss://origin.test" ? originClient.client : destinationClient.client,
    );

    await expect(
      trace(
        { ...request(), rpc: "wss://origin.test" },
        {
          openClient,
          registry: createStaticRegistry([
            { location: destination, rpc: "wss://asset-hub.test", name: "Asset Hub" },
          ]),
        },
      ),
    ).rejects.toThrow(/cycle/i);

    expect(destinationDryRun).toHaveBeenCalledOnce();
    expect(originClient.disconnect).toHaveBeenCalledOnce();
    expect(destinationClient.disconnect).toHaveBeenCalledOnce();
  });

  it("does not follow descendants from a failing forwarded hop", async () => {
    const assetHub = location(1, { X1: { Parachain: 1000 } });
    const parachain = location(1, { X1: { Parachain: 2000 } });
    const firstMessage = xcmProgram(4, [xcmInstruction("ClearOrigin")]);
    const descendantMessage = xcmProgram(4, [xcmInstruction("DepositAsset")]);
    const firstEffects = dryRunEffects({
      executionResult: executionSuccess(),
      xcmVersion: 4,
      forwardedXcms: [forwardedXcm(assetHub, [firstMessage])],
    });
    const failingEffects = dryRunEffects({
      executionResult: executionFailure(executionError("Barrier", { detail: "denied" })),
      xcmVersion: 4,
      forwardedXcms: [forwardedXcm(parachain, [descendantMessage])],
    });
    const originClient = fakeClientWith({ dryRunCall: () => Promise.resolve(firstEffects) });
    const assetHubDryRun = vi.fn(() => Promise.resolve(failingEffects));
    const assetHubClient = fakeClientWith({ dryRunXcm: assetHubDryRun });
    const parachainDryRun = vi.fn(() => Promise.resolve(dryRunEffects({ executionResult: executionSuccess(), xcmVersion: 4 })));
    const parachainClient = fakeClientWith({ dryRunXcm: parachainDryRun });
    const openClient = vi.fn((rpc: string) => {
      if (rpc === "wss://origin.test") return originClient.client;
      if (rpc === "wss://asset-hub.test") return assetHubClient.client;
      return parachainClient.client;
    });

    const result = await trace(
      { ...request(), rpc: "wss://origin.test" },
      {
        openClient,
        registry: createStaticRegistry([
          { location: assetHub, rpc: "wss://asset-hub.test", name: "Asset Hub" },
          { location: parachain, rpc: "wss://para.test", name: "Parachain 2000" },
        ]),
      },
    );

    expect(result.hops).toHaveLength(2);
    expect(result.diagnosis.status).toBe("failure");
    expect(result.diagnosis.ruleId).toBe("barrier-blocked");
    expect(assetHubDryRun).toHaveBeenCalledOnce();
    expect(parachainDryRun).not.toHaveBeenCalled();
    expect(parachainClient.disconnect).not.toHaveBeenCalled();
  });

  it("fails before following more hops than maxDepth allows", async () => {
    const destination = location(1, { X1: { Parachain: 1000 } });
    const effects = dryRunEffects({
      executionResult: executionSuccess(),
      xcmVersion: 4,
      forwardedXcms: [forwardedXcm(destination, [xcmProgram(4)])],
    });
    const { client, disconnect } = fakeClientWith({ dryRunCall: () => Promise.resolve(effects) });

    await expect(
      trace(request(), {
        openClient: () => client,
        registry: createStaticRegistry([{ location: destination, rpc: "wss://asset-hub.test" }]),
        maxDepth: 1,
      }),
    ).rejects.toThrow(/maxDepth=1/);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
