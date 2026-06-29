import type { NormalizedValue } from "./json.js";
import type { XcmProgram, ForwardedXcm, XcmVersion } from "./xcm.js";

/**
 * A normalized runtime event from `emitted_events`. `pallet`/`name` identify the
 * variant (e.g. "PolkadotXcm"/"Attempted", "Balances"/"Withdraw"); `data` holds its
 * decoded fields. Diagnostic rules match on these.
 */
export interface NormalizedEvent {
  readonly pallet: string;
  readonly name: string;
  readonly data: Readonly<Record<string, NormalizedValue>>;
}

export function normalizedEvent(
  pallet: string,
  name: string,
  data: Readonly<Record<string, NormalizedValue>> = {},
): NormalizedEvent {
  return { pallet, name, data };
}

/**
 * Normalized error of a dry-run execution. `type` is a source-populated tag (the
 * client fills it from the decoded error — it is NOT an invented enum); `raw` keeps
 * the decoded original so the `unknown` diagnosis can dump it for inspection.
 */
export interface ExecutionError {
  readonly type: string;
  readonly detail?: string;
  readonly raw?: NormalizedValue;
}

export function executionError(
  type: string,
  opts: { detail?: string; raw?: NormalizedValue } = {},
): ExecutionError {
  return {
    type,
    ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
    ...(opts.raw !== undefined ? { raw: opts.raw } : {}),
  };
}

/** Outcome of the dry-run `execution_result`. */
export type ExecutionResult =
  | { readonly kind: "success" }
  | { readonly kind: "failure"; readonly error: ExecutionError };

export function executionSuccess(): ExecutionResult {
  return { kind: "success" };
}

export function executionFailure(error: ExecutionError): ExecutionResult {
  return { kind: "failure", error };
}

/**
 * Normalized `CallDryRunEffects` (ADR-0001): the contract that diagnostics rules
 * match against. `client/` produces this from PAPI output; nothing downstream sees PAPI.
 */
export interface DryRunEffects {
  readonly executionResult: ExecutionResult;
  readonly events: readonly NormalizedEvent[];
  readonly xcmVersion: XcmVersion;
  readonly localXcm?: XcmProgram;
  readonly forwardedXcms: readonly ForwardedXcm[];
}

export function dryRunEffects(params: {
  executionResult: ExecutionResult;
  xcmVersion: XcmVersion;
  events?: readonly NormalizedEvent[];
  localXcm?: XcmProgram;
  forwardedXcms?: readonly ForwardedXcm[];
}): DryRunEffects {
  return {
    executionResult: params.executionResult,
    xcmVersion: params.xcmVersion,
    events: params.events ?? [],
    forwardedXcms: params.forwardedXcms ?? [],
    ...(params.localXcm ? { localXcm: params.localXcm } : {}),
  };
}
