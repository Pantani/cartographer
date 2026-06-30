import type { ChainRef, Hop, TraceResult } from "../types/index.js";

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

interface RouteHopSummary {
  readonly index: number;
  readonly label: string;
  readonly chain: ChainRef;
  readonly status: Hop["diagnosis"]["status"];
}

interface FailingHopSummary extends RouteHopSummary {
  readonly ruleId?: string;
  readonly rootCause?: string;
}

/** A `JSON.stringify` replacer that encodes every `bigint` as `{ $bigint: "<decimal>" }`. */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? { [BIGINT_TAG]: value.toString(10) } : value;
}

/** Display label matching the human report's chain fallback order. */
function chainLabel(chain: ChainRef): string {
  return chain.name ?? chain.rpc ?? "unknown chain";
}

/** Compact summary for one hop in the top-level route view. */
function routeHopSummary(h: Hop): RouteHopSummary {
  return {
    index: h.index,
    label: chainLabel(h.chain),
    chain: h.chain,
    status: h.diagnosis.status,
  };
}

/** Compact summary for the decisive failing hop, if any. */
function failingHopSummary(hops: readonly Hop[]): FailingHopSummary | null {
  const failing = hops.find((h) => h.diagnosis.status === "failure");
  if (failing === undefined) return null;
  return {
    ...routeHopSummary(failing),
    ...(failing.diagnosis.ruleId !== undefined ? { ruleId: failing.diagnosis.ruleId } : {}),
    ...(failing.diagnosis.rootCause !== undefined ? { rootCause: failing.diagnosis.rootCause } : {}),
  };
}

/** Add report-specific route summaries while preserving the TraceResult payload. */
function jsonTrace(result: TraceResult): object {
  return {
    route: result.hops.map(routeHopSummary),
    failingHop: failingHopSummary(result.hops),
    ...result,
  };
}

/**
 * Render a `TraceResult` to deterministic, pretty-printed JSON.
 * Invariant: stable output (2-space indent, bigint-tagged) suitable for snapshots.
 */
export function renderJson(result: TraceResult): string {
  return JSON.stringify(jsonTrace(result), bigintReplacer, 2);
}
