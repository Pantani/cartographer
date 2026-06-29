import type { Location } from "./location.js";

/**
 * Weight v2: computational `refTime` + PoV `proofSize`. Both are `u64` on-chain → `bigint`.
 * Source: Substrate `sp_weights::Weight` (polkadot-sdk).
 */
export interface Weight {
  readonly refTime: bigint;
  readonly proofSize: bigint;
}

export function weight(refTime: bigint, proofSize: bigint): Weight {
  return { refTime, proofSize };
}

/**
 * An XCM asset identity. In XCM v3+ an `AssetId` is a `Location` (Concrete only);
 * `symbol`/`decimals` are display aids populated when known.
 */
export interface AssetId {
  readonly location?: Location;
  readonly symbol?: string;
  readonly decimals?: number;
}

export function assetId(params: {
  location?: Location;
  symbol?: string;
  decimals?: number;
}): AssetId {
  return {
    ...(params.location ? { location: params.location } : {}),
    ...(params.symbol !== undefined ? { symbol: params.symbol } : {}),
    ...(params.decimals !== undefined ? { decimals: params.decimals } : {}),
  };
}

/**
 * A fee estimate from `XcmPaymentApi`: `fee` is denominated in `asset`'s smallest unit;
 * `weight` is the execution weight when the API returns it.
 */
export interface FeeEstimate {
  readonly fee: bigint;
  readonly asset: AssetId;
  readonly weight?: Weight;
}

export function feeEstimate(params: {
  fee: bigint;
  asset: AssetId;
  weight?: Weight;
}): FeeEstimate {
  return {
    fee: params.fee,
    asset: params.asset,
    ...(params.weight ? { weight: params.weight } : {}),
  };
}
