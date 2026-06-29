import type { NormalizedValue } from "./json.js";

/**
 * A normalized XCM MultiLocation: relative `parents` + `interior` junctions.
 * Invariant: `parents >= 0`. `interior` is kept structural (e.g. "Here" | { X1: ... })
 * so an XCM-version change in junction encoding does not break the domain model.
 */
export interface Location {
  readonly parents: number;
  readonly interior: NormalizedValue;
}

/** Build a Location. `interior` defaults to "Here" (the chain referring to itself). */
export function location(parents: number, interior: NormalizedValue = "Here"): Location {
  return { parents, interior };
}
