// client/ internal — structural descriptions of the *decoded* shapes PAPI returns
// for the runtime APIs we consume. These are NOT re-exported past client/ (rule 6):
// they exist only so the pure normalizers can be typed without `any`/unsafe access.
//
// Verified PAPI decoding conventions (sources):
// - Enums decode to `{ type: string, value: T }` (discriminated). Source:
//   https://papi.how/types  ("Enums in the chain are represented as { type, value }").
// - Runtime-API calls live under `typedApi.apis.<Api>.<method>(...args, opts?)` and
//   return `Promise<Payload>`. Source: https://papi.how/typed/apis.
// - SCALE `u128`/`u64` decode to `bigint`; this is why balances/weights are bigint.
//   Source: https://papi.how/types and the typed-codecs page.
// - A Rust `Result<Ok, Err>` decodes to PAPI's Result shape `{ success: boolean; value }`
//   (same pattern as the dry-run example `response.result.success` / `.value`).
//   Source: https://papi.how/ink (ContractsApi.instantiate dry-run example).
//
// The exact live payload shapes come from runtime metadata and should be captured against
// an API-capable chain before the integration test is unskipped; see verify TODOs below.

import type { NormalizedValue } from "../types/index.js";

/** PAPI-decoded enum: discriminated `{ type, value }`. Source: https://papi.how/types */
export interface PapiEnum {
  readonly type: string;
  readonly value?: unknown;
}

/**
 * PAPI-decoded Rust `Result<T, E>`: `{ success, value }`. On success `value` is `T`,
 * on failure `value` is the decoded error `E`. Source: https://papi.how/ink dry-run example.
 */
export interface PapiResult {
  readonly success: boolean;
  readonly value?: unknown;
}

/**
 * Decoded runtime event entry as carried in `emitted_events`. The outer item is the
 * pallet-level enum (`type` = pallet name, `value` = the inner variant enum whose
 * `type` is the event name and `value` its decoded fields).
 *
 * TODO(verify: emitted_events element shape — confirm whether PAPI surfaces each entry
 * as a nested pallet-enum `{ type: pallet, value: { type: name, value: fields } }` or a
 * flattened `{ phase, event }` record. Check against a generated descriptor for an
 * API-capable chain, e.g. `typedApi.apis.DryRunApi.dry_run_call(...)` output on
 * Westend Asset Hub, or polkadot-sdk `xcm_runtime_apis::dry_run::CallDryRunEffects`.)
 */
export interface PapiEventEntry {
  readonly type: string;
  readonly value: PapiEnum;
}

/**
 * Decoded `VersionedXcm`: a versioned enum (`type` like "V3"/"V4"/"V5") whose `value`
 * is the ordered list of instruction-enums.
 *
 * TODO(verify: VersionedXcm decoded shape — confirm the version tag string set
 * ("V2".."V5") and that `value` is an array of instruction enums. Source to check:
 * generated `XcmVersionedXcm` descriptor / polkadot-sdk `xcm::VersionedXcm`.)
 */
export interface PapiVersionedXcm {
  readonly type: string;
  readonly value: readonly PapiEnum[];
}

/** Decoded `VersionedLocation`: versioned enum wrapping `{ parents, interior }`. */
export interface PapiVersionedLocation {
  readonly type: string;
  readonly value: { readonly parents: number; readonly interior: unknown };
}

/** Decoded `sp_weights::Weight`: ref time plus proof size. */
export interface PapiWeight {
  readonly ref_time: bigint;
  readonly proof_size: bigint;
}

/**
 * Decoded `VersionedAssetId` returned by `XcmPaymentApi.query_acceptable_payment_assets`.
 * For XCM v4+ the wrapped value is a `Location`; older versions may wrap a concrete
 * asset enum, which the normalizer treats conservatively.
 */
export interface PapiVersionedAssetId {
  readonly type: string;
  readonly value: unknown;
}

/**
 * Decoded `CallDryRunEffects<Event>` (ADR-0001). Field names mirror the Rust struct.
 * Source: polkadot-sdk `xcm_runtime_apis::dry_run::CallDryRunEffects`.
 */
export interface PapiCallDryRunEffects {
  readonly execution_result: PapiResult;
  readonly emitted_events: readonly PapiEventEntry[];
  readonly local_xcm?: PapiVersionedXcm;
  readonly forwarded_xcms: readonly (readonly [
    PapiVersionedLocation,
    readonly PapiVersionedXcm[],
  ])[];
}

/**
 * Decoded `XcmDryRunEffects<Event>` (ADR-0001). Unlike `CallDryRunEffects`, this
 * shape has no `local_xcm`; source:
 * polkadot-sdk `xcm_runtime_apis::dry_run::XcmDryRunEffects`.
 */
export interface PapiXcmDryRunEffects {
  readonly execution_result: PapiResult;
  readonly emitted_events: readonly PapiEventEntry[];
  readonly forwarded_xcms: readonly (readonly [
    PapiVersionedLocation,
    readonly PapiVersionedXcm[],
  ])[];
}

/**
 * Decoded fee shape assembled from `XcmPaymentApi.query_xcm_weight`,
 * `query_acceptable_payment_assets`, and `query_weight_to_asset_fee`.
 * Source: polkadot-sdk `xcm_runtime_apis::fees::XcmPaymentApi`.
 */
export interface PapiFeePayload {
  readonly fee: bigint;
  readonly asset?: PapiVersionedAssetId;
  readonly assetLocation?: { readonly parents: number; readonly interior: NormalizedValue };
  readonly weight?: PapiWeight;
}
