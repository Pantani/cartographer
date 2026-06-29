/**
 * A normalized, transport-agnostic value: JSON plus `bigint`.
 *
 * Chain data carries `u128`/`u64` balances and weights that exceed `Number.MAX_SAFE_INTEGER`,
 * so the normalized model preserves them as `bigint`. `report/` is responsible for
 * serializing `bigint` when rendering JSON (it is not natively JSON-serializable).
 */
export type NormalizedValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | readonly NormalizedValue[]
  | { readonly [key: string]: NormalizedValue };
