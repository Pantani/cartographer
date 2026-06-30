// orchestrator/ — the trace engine. Drives the dry-run, estimates fees, runs the pure
// diagnostics, and assembles a TraceResult. The only place that knows the whole flow.
// I/O is confined to the injected ChainClient; assembly + diagnosis stay pure.

import type { ChainClient } from "../client/index.js";
import { openChainClient } from "../client/index.js";
import { diagnoseWithSeedRules } from "../diagnostics/index.js";
import type { RouteRegistry } from "../registry/index.js";
import type {
  ChainRef,
  DryRunEffects,
  FeeEstimate,
  Hop,
  Location,
  TraceRequest,
  TraceResult,
  XcmProgram,
} from "../types/index.js";
import {
  chainRef,
  diagnosisContext,
  hop,
  locationOrigin,
  singleHopTrace,
  traceResult,
} from "../types/index.js";

/** Opens a `ChainClient` for an endpoint. Injectable so the pipeline is testable without a network. */
export type ClientFactory = (rpc: string) => ChainClient;

export interface TraceDeps {
  readonly openClient: ClientFactory;
  readonly registry?: RouteRegistry;
  readonly maxDepth?: number;
}

const defaultDeps: TraceDeps = { openClient: openChainClient };
const DEFAULT_MAX_DEPTH = 8;

interface PendingXcm {
  readonly destination: Location;
  readonly xcm: XcmProgram;
}

interface ExecutedHop {
  readonly hop: Hop;
  readonly forwarded: readonly PendingXcm[];
}

/**
 * Run the origin dry-run, optionally follow forwarded XCMs through a registry, and assemble a trace.
 * Always disconnects clients. Errors propagate — no silent fallback.
 */
export async function trace(
  request: TraceRequest,
  deps: TraceDeps = defaultDeps,
): Promise<TraceResult> {
  const first = await runInitialHop(request, deps.openClient);
  if (deps.registry === undefined || first.forwarded.length === 0) return singleHopTrace(first.hop);

  const hops = [first.hop];
  await followForwarded(hops, [...first.forwarded], deps);
  return traceResult({
    hops,
    diagnosis: headlineDiagnosis(hops),
    ...(hops[0]?.fees ? { fees: hops[0].fees } : {}),
  });
}

/** Dispatch on the request kind while preserving the one-of call/xcm invariant. */
function runDryRun(client: ChainClient, request: TraceRequest): Promise<DryRunEffects> {
  if (request.call !== undefined) {
    return client.dryRunCall(request.origin, request.call, request.resultXcmVersion);
  }
  if (request.xcm !== undefined) return client.dryRunXcm(request.origin, request.xcm);
  throw new Error("TraceRequest must include exactly one of call or xcm.");
}

/** Estimate fees from the locally-executed XCM, when the dry-run produced one. */
function estimateFeesForEffects(
  client: ChainClient,
  effects: DryRunEffects,
): Promise<FeeEstimate> | undefined {
  if (effects.localXcm === undefined) return undefined;
  return client.estimateFees(effects.localXcm);
}

/** Run the user-requested origin hop and collect forwarded work. */
async function runInitialHop(
  request: TraceRequest,
  openClient: ClientFactory,
): Promise<ExecutedHop> {
  const client = openClient(request.rpc);
  try {
    const effects = await runDryRun(client, request);
    const fees = await estimateFeesForEffects(client, effects);
    const chain = chainRef({ rpc: request.rpc });
    return assembleHop(0, chain, effects, fees);
  } finally {
    client.disconnect();
  }
}

/** Follow queued forwarded XCM messages until the route is exhausted or maxDepth is reached. */
async function followForwarded(
  hops: Hop[],
  pending: PendingXcm[],
  deps: TraceDeps,
): Promise<void> {
  const maxDepth = deps.maxDepth ?? DEFAULT_MAX_DEPTH;
  while (pending.length > 0) {
    if (hops.length >= maxDepth) throw new Error(`Trace exceeded maxDepth=${String(maxDepth)}.`);
    const next = pending.shift();
    if (next !== undefined) {
      const executed = await runForwardedHop(next, hops.length, deps);
      hops.push(executed.hop);
      pending.push(...executed.forwarded);
    }
  }
}

/** Dry-run one forwarded XCM on its resolved destination endpoint. */
async function runForwardedHop(
  pending: PendingXcm,
  index: number,
  deps: TraceDeps,
): Promise<ExecutedHop> {
  const endpoint = deps.registry?.resolve(pending.destination);
  if (endpoint === undefined) throw unresolvedDestination(pending.destination);
  const client = deps.openClient(endpoint.rpc);
  try {
    const effects = await client.dryRunXcm(locationOrigin(pending.destination), pending.xcm);
    const fees = await estimateFeesForEffects(client, effects);
    const chain = chainRef({
      rpc: endpoint.rpc,
      location: endpoint.location,
      ...(endpoint.name !== undefined ? { name: endpoint.name } : {}),
    });
    return assembleHop(index, chain, effects, fees);
  } finally {
    client.disconnect();
  }
}

/** Diagnose effects and package one hop plus its queued forwarded messages. Pure. */
function assembleHop(
  index: number,
  chain: ChainRef,
  effects: DryRunEffects,
  fees: FeeEstimate | undefined,
): ExecutedHop {
  const diagnosis = diagnoseWithSeedRules(diagnosisContext(effects, fees));
  const single = hop({
    index,
    chain,
    effects,
    diagnosis,
    ...(fees ? { fees } : {}),
  });
  return { hop: single, forwarded: queuedForwarded(effects) };
}

/** Flatten runtime forwarded_xcms into the orchestrator queue. Pure. */
function queuedForwarded(effects: DryRunEffects): readonly PendingXcm[] {
  return effects.forwardedXcms.flatMap((forwarded) =>
    forwarded.messages.map((xcm) => ({ destination: forwarded.destination, xcm })),
  );
}

/** Pick the first failing hop, otherwise the last successful hop. Pure. */
function headlineDiagnosis(hops: readonly Hop[]): Hop["diagnosis"] {
  return (
    hops.find((candidate) => candidate.diagnosis.status !== "success")?.diagnosis ??
    hops.at(-1)?.diagnosis ?? {
      status: "unknown",
      ruleId: "empty-trace",
      rootCause: "Trace produced no hops.",
    }
  );
}

/** Build an unresolved-route error without silently dropping forwarded messages. */
function unresolvedDestination(destination: Location): Error {
  return new Error(`Unresolved forwarded XCM destination: ${JSON.stringify(destination)}`);
}
