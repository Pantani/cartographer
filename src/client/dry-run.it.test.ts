// INTEGRATION (opt-in, live RPC). Runs ONLY via `pnpm test:it` — the unit suite excludes
// `**/*.it.test.ts`. This exercises the real PAPI runtime calls against an API-capable
// system chain (e.g. Westend Asset Hub), which implements DryRunApi + XcmPaymentApi
// (ADR-0001 caveat: not every chain does).
//
// It is skipped by default because live runtime-API calls need a reachable endpoint,
// an origin account, and concrete encoded call data. Generated descriptors are the
// safer typed path, but the current unsafe PAPI path can still perform a live smoke
// once those inputs are supplied.
//
// TODO(verify: end-to-end dry_run_call + XcmPaymentApi against a live API-capable chain.
// Supply a real API-capable endpoint, origin, and encoded call(s), then use this test's
// printed `CARTOGRAPHER_IT_EVIDENCE` JSON to close the emitted_events, VersionedXcm,
// and fee-asset shape gaps. Optionally generate descriptors with `papi add` for a typed
// follow-up. Source: https://papi.how/codegen , polkadot-sdk runtime APIs.)

import { Binary, createClient, Enum } from "polkadot-api";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { getWsProvider } from "polkadot-api/ws-provider";
import { describe, it, expect } from "vitest";

import { makeDryRunEvidence, toEvidenceJson, type LiveFeesEvidence, type LiveRawFeesEvidence } from "./live-evidence.js";
import { normalizeEffects, normalizeFees } from "./normalize.js";
import type { PapiCallDryRunEffects, PapiVersionedAssetId, PapiWeight } from "./papi-shapes.js";
import { type HexString, type XcmProgram, type XcmVersion } from "../types/index.js";

const RPC = process.env.CARTOGRAPHER_IT_RPC; // e.g. wss://westend-asset-hub-rpc.polkadot.io
const ACCOUNT = process.env.CARTOGRAPHER_IT_ACCOUNT;
const RESULT_XCM_VERSION = parseResultXcmVersion(process.env.CARTOGRAPHER_IT_RESULT_XCM_VERSION);
const CALL_CASES = liveCallCases();

const ready = Boolean(RPC && ACCOUNT && CALL_CASES.length > 0);

describe.skipIf(!ready)("PAPI live evidence", () => {
  it.each(CALL_CASES)("captures raw and normalized dry-run evidence for $label", async ({ label, call }) => {
    const client = connect(RPC as string);
    try {
      const api = client.getUnsafeApi();
      const rawDryRun = await callDryRun(api, ACCOUNT as string, call, RESULT_XCM_VERSION);
      const effects = normalizeEffects(unwrapDryRun(rawDryRun), RESULT_XCM_VERSION);
      const fees = await feeEvidence(api, effects.localXcm);
      const evidence = makeDryRunEvidence({
        label,
        account: ACCOUNT as string,
        call,
        resultXcmVersion: RESULT_XCM_VERSION,
        rawDryRun,
        normalizedEffects: effects,
        fees,
      });

      console.info(`CARTOGRAPHER_IT_EVIDENCE ${toEvidenceJson(evidence)}`);

      expect(effects.xcmVersion).toBe(RESULT_XCM_VERSION);
      expect(["success", "failure"]).toContain(effects.executionResult.kind);
      expect(Array.isArray(effects.events)).toBe(true);
      if (fees.kind === "estimated") expect(fees.value.fee).toBeGreaterThanOrEqual(0n);
    } finally {
      client.destroy();
    }
  });
});

interface PapiClient {
  readonly getUnsafeApi: () => UnsafeApi;
  readonly destroy: () => void;
}

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

interface RuntimeResult {
  readonly success: boolean;
  readonly value?: unknown;
}

interface LiveCallCase {
  readonly label: string;
  readonly call: HexString;
}

function liveCallCases(): readonly LiveCallCase[] {
  const cases: LiveCallCase[] = [];
  addCallCase(cases, "call", process.env.CARTOGRAPHER_IT_CALL as HexString | undefined);
  addCallCase(cases, "happy", process.env.CARTOGRAPHER_IT_CALL_HAPPY as HexString | undefined);
  addCallCase(cases, "failure", process.env.CARTOGRAPHER_IT_CALL_FAIL as HexString | undefined);
  return cases;
}

function addCallCase(cases: LiveCallCase[], label: string, call: HexString | undefined): void {
  if (call) cases.push({ label, call });
}

function connect(rpcUrl: string): PapiClient {
  const provider = withPolkadotSdkCompat(getWsProvider(rpcUrl));
  return createClient(provider) as unknown as PapiClient;
}

async function callDryRun(
  api: UnsafeApi,
  account: string,
  call: HexString,
  resultXcmVersion: XcmVersion,
): Promise<unknown> {
  const tx = await api.txFromCallData(Binary.fromHex(call));
  return api.apis.DryRunApi.dry_run_call(Enum("system", Enum("Signed", account)), tx.decodedCall, resultXcmVersion);
}

function unwrapDryRun(raw: unknown): PapiCallDryRunEffects {
  return unwrapRuntimeResult(raw) as PapiCallDryRunEffects;
}

async function feeEvidence(api: UnsafeApi, xcm: XcmProgram | undefined): Promise<LiveFeesEvidence> {
  if (!xcm) return { kind: "skipped", reason: "dry_run_call returned no local_xcm" };
  try {
    const raw = await callFeeApis(api, xcm);
    return {
      kind: "estimated",
      raw,
      value: normalizeFees({
        fee: unwrapRuntimeResult(raw.fee) as bigint,
        asset: raw.selectedAsset as PapiVersionedAssetId,
        weight: unwrapRuntimeResult(raw.weight) as PapiWeight,
      }),
    };
  } catch (error) {
    return { kind: "failed", error: stringifyUnknown(error) };
  }
}

async function callFeeApis(api: UnsafeApi, xcm: XcmProgram): Promise<LiveRawFeesEvidence> {
  const versionedXcm = { type: xcmVersionTag(xcm.version), value: xcm.instructions.map(xcmInstructionToPapi) };
  const weight = await api.apis.XcmPaymentApi.query_xcm_weight(versionedXcm);
  const assets = await api.apis.XcmPaymentApi.query_acceptable_payment_assets(xcm.version);
  const selectedAsset = firstAsset(unwrapRuntimeResult(assets));
  const fee = await api.apis.XcmPaymentApi.query_weight_to_asset_fee(unwrapRuntimeResult(weight), selectedAsset);
  return { weight, assets, selectedAsset, fee };
}

function firstAsset(assets: unknown): unknown {
  if (!Array.isArray(assets) || !assets[0]) throw new Error("no acceptable payment asset returned");
  return assets[0];
}

function unwrapRuntimeResult(raw: unknown): unknown {
  if (!isRuntimeResult(raw)) return raw;
  if (!raw.success) throw new Error(`runtime API returned Err: ${stringifyUnknown(raw.value)}`);
  return raw.value;
}

function isRuntimeResult(value: unknown): value is RuntimeResult {
  return isRecord(value) && typeof value.success === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringifyUnknown(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item));
}

function parseResultXcmVersion(value: string | undefined): XcmVersion {
  if (value === "2" || value === "3" || value === "4" || value === "5") return Number(value) as XcmVersion;
  return 4;
}

function xcmVersionTag(version: XcmVersion): string {
  return `V${version.toString()}`;
}

function xcmInstructionToPapi(instruction: XcmProgram["instructions"][number]): { readonly type: string; readonly value?: unknown } {
  if (instruction.args === undefined) return { type: instruction.kind };
  return { type: instruction.kind, value: instruction.args };
}
