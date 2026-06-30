// registry/ — (V2) Location → endpoint resolution + per-endpoint metadata cache.
// Used by orchestrator in V2. Imports only types/.
import type { Location } from "../types/index.js";

/** Endpoint metadata needed to open and label a chain reached by a forwarded XCM. */
export interface ChainEndpoint {
  readonly location: Location;
  readonly rpc: string;
  readonly name?: string;
}

/** Resolves an XCM destination Location to the endpoint that can dry-run that hop. */
export interface RouteRegistry {
  readonly resolve: (destination: Location) => ChainEndpoint | undefined;
}

/** Build a deterministic key for normalized Location values. */
export function locationKey(loc: Location): string {
  return JSON.stringify(loc);
}

/** Create an in-memory registry backed by structural Location equality. */
export function createStaticRegistry(entries: readonly ChainEndpoint[]): RouteRegistry {
  const byLocation = new Map(entries.map((entry) => [locationKey(entry.location), entry]));
  return { resolve: (destination) => byLocation.get(locationKey(destination)) };
}

/** Async cache keyed by endpoint RPC URL. */
export interface EndpointMetadataCache<T> {
  readonly getOrLoad: (rpc: string, load: () => Promise<T>) => Promise<T>;
}

/** Create a cache that deduplicates concurrent or repeated per-endpoint metadata loads. */
export function createEndpointMetadataCache<T>(): EndpointMetadataCache<T> {
  const values = new Map<string, Promise<T>>();
  return {
    getOrLoad: (rpc, load) => {
      const cached = values.get(rpc);
      if (cached !== undefined) return cached;
      const next = load();
      values.set(rpc, next);
      return next;
    },
  };
}
