// orchestrator/ — the trace engine. Drives the dry-run, estimates fees, runs the pure
// diagnostics, and assembles a TraceResult. The only place that knows the whole flow.
// I/O is confined to the injected ChainClient; assembly + diagnosis stay pure.

import type { ChainClient } from "../client/index.js";
import { openChainClient } from "../client/index.js";
import { diagnoseWithSeedRules } from "../diagnostics/index.js";
import type { DryRunEffects, FeeEstimate, TraceRequest, TraceResult } from "../types/index.js";
import { chainRef, diagnosisContext, hop, singleHopTrace } from "../types/index.js";

/** Opens a `ChainClient` for an endpoint. Injectable so the pipeline is testable without a network. */
export type ClientFactory = (rpc: string) => ChainClient;

export interface TraceDeps {
  readonly openClient: ClientFactory;
}

const defaultDeps: TraceDeps = { openClient: openChainClient };

/**
 * Single-hop trace (ADR-0001 MVP data flow): dryRunCall → estimateFees → diagnose →
 * assemble TraceResult. Always disconnects the client. Errors propagate — no silent fallback.
 */
export async function trace(
  request: TraceRequest,
  deps: TraceDeps = defaultDeps,
): Promise<TraceResult> {
  const client = deps.openClient(request.rpc);
  try {
    const effects = await runDryRun(client, request);
    const fees = await estimateFeesForEffects(client, effects);
    return assembleTrace(request, effects, fees);
  } finally {
    client.disconnect();
  }
}

/** Dispatch on the request kind. The raw-XCM path needs a client method not built in Sprint 0. */
function runDryRun(client: ChainClient, request: TraceRequest): Promise<DryRunEffects> {
  if (request.call !== undefined) {
    return client.dryRunCall(request.origin, request.call, request.resultXcmVersion);
  }
  // TODO(verify: raw-XCM tracing needs client.dryRunXcm (DryRunApi.dry_run_xcm), not built in
  // S0-T3 — only dryRunCall + estimateFees exist. Wire it before enabling the --xcm path.)
  throw new Error("Raw XCM tracing (--xcm) is not supported in this build; pass --call.");
}

/** Estimate fees from the locally-executed XCM, when the dry-run produced one. */
function estimateFeesForEffects(
  client: ChainClient,
  effects: DryRunEffects,
): Promise<FeeEstimate> | undefined {
  if (effects.localXcm === undefined) return undefined;
  return client.estimateFees(effects.localXcm);
}

/** Diagnose the effects and wrap everything in a single-hop TraceResult. Pure. */
function assembleTrace(
  request: TraceRequest,
  effects: DryRunEffects,
  fees: FeeEstimate | undefined,
): TraceResult {
  const diagnosis = diagnoseWithSeedRules(diagnosisContext(effects, fees));
  const singleHop = hop({
    index: 0,
    chain: chainRef({ rpc: request.rpc }),
    effects,
    diagnosis,
    ...(fees ? { fees } : {}),
  });
  return singleHopTrace(singleHop);
}
