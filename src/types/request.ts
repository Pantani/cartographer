import type { XcmProgram, XcmVersion } from "./xcm.js";
import type { Location } from "./location.js";

/** SCALE-encoded hex (e.g. an encoded extrinsic call). */
export type HexString = `0x${string}`;

/** Output format selected on the CLI. */
export type OutputFormat = "human" | "json";

/**
 * Origin under which to dry-run: a signed `account` (for `dry_run_call`) or a
 * `location` (for `dry_run_xcm`). Mirrors the two runtime-API entry points (ADR-0001).
 */
export type Origin =
  | { readonly kind: "account"; readonly account: string }
  | { readonly kind: "location"; readonly location: Location };

export function accountOrigin(account: string): Origin {
  return { kind: "account", account };
}

export function locationOrigin(loc: Location): Origin {
  return { kind: "location", location: loc };
}

/**
 * A trace request as parsed from the CLI. Exactly one of `call` | `xcm` is set:
 * `call` drives `dry_run_call`, `xcm` drives `dry_run_xcm`.
 */
export interface TraceRequest {
  readonly rpc: string;
  readonly origin: Origin;
  readonly resultXcmVersion: XcmVersion;
  readonly format: OutputFormat;
  readonly call?: HexString;
  readonly xcm?: XcmProgram;
}
