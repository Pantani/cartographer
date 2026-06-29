import type { TraceResult } from "../types/index.js";

/**
 * Marker wrapping the decimal-string form of a `bigint` in JSON output.
 *
 * Rationale: `NormalizedValue`, fees, and weights carry `bigint` (u64/u128 chain
 * values) that `JSON.stringify` cannot serialize. We emit each `bigint` as an
 * object `{ "$bigint": "<decimal>" }` rather than a bare string so the output is
 * (a) lossless — full precision preserved as a decimal string — and (b)
 * unambiguous — a consumer can distinguish an original `bigint` from a string
 * that merely looks numeric, enabling a faithful reverse mapping back to
 * `bigint`. Deterministic by construction: no locale, no `Number` coercion.
 */
export const BIGINT_TAG = "$bigint";

/** A `JSON.stringify` replacer that encodes every `bigint` as `{ $bigint: "<decimal>" }`. */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? { [BIGINT_TAG]: value.toString(10) } : value;
}

/**
 * Render a `TraceResult` to deterministic, pretty-printed JSON.
 * Invariant: stable output (2-space indent, bigint-tagged) suitable for snapshots.
 */
export function renderJson(result: TraceResult): string {
  return JSON.stringify(result, bigintReplacer, 2);
}
