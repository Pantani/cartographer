import type { NormalizedValue } from "./json.js";
import type { Location } from "./location.js";

/** XCM version tag. v3/v4/v5 per ADR-0002; v2 retained as the legacy baseline. */
export type XcmVersion = 2 | 3 | 4 | 5;

/**
 * A single XCM instruction (opcode), e.g. "WithdrawAsset", "BuyExecution",
 * "DepositAsset", "Transact". `args` holds the decoded operands, normalized.
 */
export interface XcmInstruction {
  readonly kind: string;
  readonly args?: NormalizedValue;
}

export function xcmInstruction(kind: string, args?: NormalizedValue): XcmInstruction {
  return { kind, ...(args !== undefined ? { args } : {}) };
}

/** A versioned XCM program: an ordered list of instructions. */
export interface XcmProgram {
  readonly version: XcmVersion;
  readonly instructions: readonly XcmInstruction[];
}

export function xcmProgram(
  version: XcmVersion,
  instructions: readonly XcmInstruction[] = [],
): XcmProgram {
  return { version, instructions };
}

/**
 * One entry of `forwarded_xcms`: the messages a hop queued to a destination chain.
 * Maps the Rust `(VersionedLocation, Vec<VersionedXcm<()>>)`. V2 follows these.
 */
export interface ForwardedXcm {
  readonly destination: Location;
  readonly messages: readonly XcmProgram[];
}

export function forwardedXcm(
  destination: Location,
  messages: readonly XcmProgram[] = [],
): ForwardedXcm {
  return { destination, messages };
}
