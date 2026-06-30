// Synthetic route fixtures for orchestrator tests. They do not claim live-chain behavior.
import { createStaticRegistry } from "../../registry/index.js";
import {
  dryRunEffects,
  executionSuccess,
  forwardedXcm,
  location,
  normalizedEvent,
  xcmInstruction,
  xcmProgram,
} from "../../types/index.js";

const assetHubLocation = location(1, { X1: { Parachain: 1000 } });
const destinationLocation = location(1, { X1: { Parachain: 2000 } });
const toAssetHub = xcmProgram(4, [xcmInstruction("ClearOrigin")]);
const toDestination = xcmProgram(4, [xcmInstruction("DepositAsset")]);

/** Representative relay -> Asset Hub -> parachain route used to prove queue/registry behavior. */
export const threeHopRouteFixture = {
  assetHubLocation,
  destinationLocation,
  toAssetHub,
  toDestination,
  originEffects: dryRunEffects({
    executionResult: executionSuccess(),
    xcmVersion: 4,
    events: [normalizedEvent("PolkadotXcm", "Sent", { count: 1n })],
    forwardedXcms: [forwardedXcm(assetHubLocation, [toAssetHub])],
  }),
  assetHubEffects: dryRunEffects({
    executionResult: executionSuccess(),
    xcmVersion: 4,
    events: [normalizedEvent("PolkadotXcm", "Sent", { count: 1n })],
    forwardedXcms: [forwardedXcm(destinationLocation, [toDestination])],
  }),
  destinationEffects: dryRunEffects({
    executionResult: executionSuccess(),
    xcmVersion: 4,
    events: [normalizedEvent("PolkadotXcm", "Attempted", { outcome: "Complete" })],
  }),
  registry: createStaticRegistry([
    { location: assetHubLocation, rpc: "wss://asset-hub.test", name: "Asset Hub" },
    { location: destinationLocation, rpc: "wss://destination.test", name: "Destination Para" },
  ]),
};
