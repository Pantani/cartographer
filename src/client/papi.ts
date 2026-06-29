// client/ — IMPURE I/O layer. The only place that opens a connection and invokes the
// runtime APIs. It returns ONLY types/ domain models; PAPI types stay inside this file
// and papi-shapes.ts (architecture rules 2 & 6).
//
// Connection + call conventions are verified against official PAPI/polkadot-sdk docs.
// Decoded live payload shapes still need an opt-in integration capture against an
// API-capable chain; those gaps stay marked as verify TODOs in papi-shapes.ts.

import { Binary, createClient, Enum } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";

import type { DryRunEffects, FeeEstimate, HexString, Origin, XcmProgram, XcmVersion } from "../types/index.js";
import { normalizeEffects, normalizeFees } from "./normalize.js";
import type { PapiCallDryRunEffects, PapiEnum, PapiFeePayload, PapiVersionedAssetId, PapiVersionedXcm, PapiWeight } from "./papi-shapes.js";

/** A connected chain client, scoped to one RPC endpoint. Close it with `disconnect`. */
export interface ChainClient {
  readonly dryRunCall: (origin: Origin, call: HexString, resultXcmVersion: XcmVersion) => Promise<DryRunEffects>;
  readonly estimateFees: (xcm: XcmProgram) => Promise<FeeEstimate>;
  readonly disconnect: () => void;
}

/**
 * Minimal structural view of the PAPI client surface we use. We rely on the documented
 * `getUnsafeApi()` (callable without generated descriptors) plus `destroy()`.
 * Sources: https://papi.how/unsafe , https://papi.how/client .
 */
interface PapiClient {
  getUnsafeApi: () => UnsafeApi;
  destroy: () => void;
}

/**
 * The slice of the untyped unsafe-API we call. `apis.<Api>.<method>(...args, opts?)`
 * returns `Promise<Payload>` (https://papi.how/typed/apis). Without descriptors there is
 * no type inference, so we describe only the methods we invoke and assert the decoded
 * payloads to our papi-shapes interfaces at this single boundary.
 */
interface UnsafeApi {
  readonly apis: {
    readonly DryRunApi: {
      readonly dry_run_call: (...args: unknown[]) => Promise<unknown>;
    };
    readonly XcmPaymentApi: {
      readonly query_acceptable_payment_assets: (...args: unknown[]) => Promise<unknown>;
      readonly query_weight_to_asset_fee: (...args: unknown[]) => Promise<unknown>;
      readonly query_xcm_weight: (...args: unknown[]) => Promise<unknown>;
    };
  };
  readonly txFromCallData: (callData: Binary) => Promise<{ readonly decodedCall: unknown }>;
}

/** Open a PAPI client against `rpcUrl`. WS + polkadot-sdk compat layer per PAPI docs. */
function connect(rpcUrl: string): PapiClient {
  const provider = withPolkadotSdkCompat(getWsProvider(rpcUrl));
  // createClient returns the full PolkadotClient; we narrow to the surface we use.
  return createClient(provider) as unknown as PapiClient;
}

/**
 * Invoke `DryRunApi.dry_run_call` and return its decoded payload. PAPI examples pass
 * `{ type: "system", value: { type: "Signed", value: account } }`, `tx.decodedCall`,
 * and the result XCM version to `api.apis.DryRunApi.dry_run_call(...)`.
 * Sources: https://docs.polkadot.com/chain-interactions/send-transactions/interoperability/debug-and-preview-xcms/
 * and https://paritytech.github.io/polkadot-sdk/master/xcm_runtime_apis/dry_run/trait.DryRunApi.html
 */
async function callDryRunCall(
  api: UnsafeApi,
  origin: Origin,
  call: HexString,
  resultXcmVersion: XcmVersion,
): Promise<PapiCallDryRunEffects> {
  const originArg = originToArg(origin);
  const tx = await api.txFromCallData(Binary.fromHex(call));
  const raw = await api.apis.DryRunApi.dry_run_call(originArg, tx.decodedCall, resultXcmVersion);
  return unwrapDryRun(raw);
}

/**
 * The runtime API returns `Result<CallDryRunEffects, Error>`. Outer transport errors
 * (API unimplemented on the chain) surface as a thrown rejection; an `Err` from the call
 * itself surfaces as `success: false`. We treat the latter as a hard failure of the
 * dry-run setup (distinct from a *successful* dry-run whose `execution_result` failed).
 *
 * PAPI `Result` codecs decode as `{ success, value }`; some call surfaces may unwrap
 * success values, so the boundary accepts both decoded forms.
 * Sources: https://papi.how/types and https://papi.how/ink
 */
function unwrapDryRun(raw: unknown): PapiCallDryRunEffects {
  return unwrapRuntimeResult(raw, "DryRunApi.dry_run_call") as PapiCallDryRunEffects;
}

function isResultShape(value: unknown): value is { success: boolean; value: unknown } {
  return value !== null && typeof value === "object" && "success" in value;
}

function unwrapRuntimeResult(raw: unknown, label: string): unknown {
  if (isResultShape(raw)) {
    if (!raw.success) throw new Error(`${label} returned Err: ${stringifyUnknown(raw.value)}`);
    return raw.value;
  }
  // Some descriptors unwrap Ok automatically; accept the payload as-is.
  return raw;
}

function stringifyUnknown(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item));
}

/**
 * Map a domain `Origin` to the runtime-API origin argument.
 * Invariant: `dry_run_call` accepts `OriginCaller`, not an XCM `Location`; location
 * origins belong to `dry_run_xcm`, which is outside S0-T3.
 */
function originToArg(origin: Origin): unknown {
  if (origin.kind === "account") return Enum("system", Enum("Signed", origin.account));
  throw new Error("Location origin is not valid for dryRunCall; use DryRunApi.dry_run_xcm for XCM location origins.");
}

/**
 * Invoke `XcmPaymentApi` to estimate execution fees for `xcm`: calculate XCM weight,
 * choose the first runtime-accepted payment asset for the XCM version, then convert the
 * weight to that asset's fee amount.
 * Sources: https://docs.polkadot.com/chain-interactions/send-transactions/interoperability/debug-and-preview-xcms/
 * and https://paritytech.github.io/polkadot-sdk/master/xcm_runtime_apis/fees/trait.XcmPaymentApi.html
 */
async function callXcmPayment(api: UnsafeApi, xcm: XcmProgram): Promise<PapiFeePayload> {
  const versionedXcm = xcmToPapiVersionedXcm(xcm);
  const weight = unwrapRuntimeResult(
    await api.apis.XcmPaymentApi.query_xcm_weight(versionedXcm),
    "XcmPaymentApi.query_xcm_weight",
  ) as PapiWeight;
  const asset = firstPaymentAsset(
    unwrapRuntimeResult(
      await api.apis.XcmPaymentApi.query_acceptable_payment_assets(xcm.version),
      "XcmPaymentApi.query_acceptable_payment_assets",
    ) as readonly PapiVersionedAssetId[],
  );
  const fee = unwrapRuntimeResult(
    await api.apis.XcmPaymentApi.query_weight_to_asset_fee(weight, asset),
    "XcmPaymentApi.query_weight_to_asset_fee",
  ) as bigint;
  return { fee, asset, weight };
}

function firstPaymentAsset(assets: readonly PapiVersionedAssetId[]): PapiVersionedAssetId {
  const [asset] = assets;
  if (!asset) throw new Error("XcmPaymentApi.query_acceptable_payment_assets returned no payment assets.");
  return asset;
}

function xcmToPapiVersionedXcm(xcm: XcmProgram): PapiVersionedXcm {
  return {
    type: xcmVersionTag(xcm.version),
    value: xcm.instructions.map(xcmInstructionToPapi),
  };
}

function xcmVersionTag(version: XcmVersion): string {
  switch (version) {
    case 2:
      return "V2";
    case 3:
      return "V3";
    case 4:
      return "V4";
    case 5:
      return "V5";
  }
}

function xcmInstructionToPapi(instruction: XcmProgram["instructions"][number]): PapiEnum {
  if (instruction.args === undefined) return { type: instruction.kind };
  return { type: instruction.kind, value: instruction.args };
}

/**
 * Open a `ChainClient` against `rpcUrl`. Public entry point of the I/O layer.
 * Invariant: every method returns a `types/` domain model; PAPI types never escape.
 */
export function openChainClient(rpcUrl: string): ChainClient {
  const client = connect(rpcUrl);
  const api = client.getUnsafeApi();
  return {
    dryRunCall: async (origin, call, resultXcmVersion) =>
      normalizeEffects(await callDryRunCall(api, origin, call, resultXcmVersion), resultXcmVersion),
    estimateFees: async (xcm) => normalizeFees(await callXcmPayment(api, xcm)),
    disconnect: () => {
      client.destroy();
    },
  };
}
