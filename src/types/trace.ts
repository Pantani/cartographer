import type { DryRunEffects } from "./effects.js";
import type { Diagnosis } from "./diagnosis.js";
import type { FeeEstimate } from "./assets.js";
import type { Location } from "./location.js";

/** Identifies the chain a hop executed on. `rpc`/`name` for display, `location` for V2 routing. */
export interface ChainRef {
  readonly rpc?: string;
  readonly name?: string;
  readonly location?: Location;
}

export function chainRef(
  params: { rpc?: string; name?: string; location?: Location } = {},
): ChainRef {
  return {
    ...(params.rpc !== undefined ? { rpc: params.rpc } : {}),
    ...(params.name !== undefined ? { name: params.name } : {}),
    ...(params.location ? { location: params.location } : {}),
  };
}

/** One hop of a trace: a single chain's dry-run effects, fees, and per-hop diagnosis. */
export interface Hop {
  readonly index: number;
  readonly chain: ChainRef;
  readonly effects: DryRunEffects;
  readonly diagnosis: Diagnosis;
  readonly fees?: FeeEstimate;
}

export function hop(params: {
  index: number;
  chain: ChainRef;
  effects: DryRunEffects;
  diagnosis: Diagnosis;
  fees?: FeeEstimate;
}): Hop {
  return {
    index: params.index,
    chain: params.chain,
    effects: params.effects,
    diagnosis: params.diagnosis,
    ...(params.fees ? { fees: params.fees } : {}),
  };
}

/**
 * A complete trace. Hop-list-shaped from day one (ADR-0001) so V2 multi-hop is additive.
 * `diagnosis` is the headline verdict — the decisive hop (failing hop, or overall success).
 */
export interface TraceResult {
  readonly hops: readonly Hop[];
  readonly diagnosis: Diagnosis;
  readonly fees?: FeeEstimate;
}

export function traceResult(params: {
  hops: readonly Hop[];
  diagnosis: Diagnosis;
  fees?: FeeEstimate;
}): TraceResult {
  return {
    hops: params.hops,
    diagnosis: params.diagnosis,
    ...(params.fees ? { fees: params.fees } : {}),
  };
}

/** MVP convenience: a single-hop trace whose headline diagnosis/fees are the hop's own. */
export function singleHopTrace(single: Hop): TraceResult {
  return {
    hops: [single],
    diagnosis: single.diagnosis,
    ...(single.fees ? { fees: single.fees } : {}),
  };
}
