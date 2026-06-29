// client/ — PURE normalization: PAPI-decoded shapes → types/ domain models.
// No I/O here. These functions are the unit-tested boundary that guarantees PAPI types
// never leak past client/ (architecture rule 6). Keep them total and side-effect free.

import {
  dryRunEffects,
  executionFailure,
  executionSuccess,
  assetId,
  feeEstimate,
  forwardedXcm,
  location,
  normalizedEvent,
  executionError,
  xcmInstruction,
  xcmProgram,
} from "../types/index.js";
import type {
  DryRunEffects,
  ExecutionError,
  ExecutionResult,
  FeeEstimate,
  ForwardedXcm,
  AssetId,
  Location,
  NormalizedEvent,
  NormalizedValue,
  XcmInstruction,
  XcmProgram,
  XcmVersion,
} from "../types/index.js";
import type {
  PapiCallDryRunEffects,
  PapiEnum,
  PapiEventEntry,
  PapiFeePayload,
  PapiResult,
  PapiVersionedAssetId,
  PapiVersionedLocation,
  PapiVersionedXcm,
} from "./papi-shapes.js";

/** Map a PAPI version tag ("V2".."V5") to the domain `XcmVersion`. Throws on unknown tags. */
export function xcmVersionFromTag(tag: string): XcmVersion {
  switch (tag) {
    case "V2":
      return 2;
    case "V3":
      return 3;
    case "V4":
      return 4;
    case "V5":
      return 5;
    default:
      throw new Error(`unknown XCM version tag: ${tag}`);
  }
}

/**
 * Coerce arbitrary PAPI-decoded data into a `NormalizedValue` (JSON + bigint).
 * Recurses through arrays/objects; preserves bigint; renders an Enum `{type,value}`
 * structurally. Anything non-representable collapses to its string form — this keeps
 * the model total without inventing typed fields. Complexity kept low via early returns.
 */
export function toNormalized(input: unknown): NormalizedValue {
  if (input === null || input === undefined) return null;
  const t = typeof input;
  if (t === "bigint" || t === "number" || t === "string" || t === "boolean") {
    return input as NormalizedValue;
  }
  if (Array.isArray(input)) return input.map(toNormalized);
  if (t === "object") return normalizeObject(input as Record<string, unknown>);
  // Unreachable for decoded SCALE data (symbol/function). Stringify defensively.
  return t === "symbol" ? (input as symbol).toString() : "[unrepresentable]";
}

/** Normalize a plain object's entries. Split out to keep `toNormalized` within CC bounds. */
function normalizeObject(obj: Record<string, unknown>): NormalizedValue {
  const out: Record<string, NormalizedValue> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = toNormalized(value);
  }
  return out;
}

/** True when a normalized value is a struct record (not array/primitive/null). */
function isRecord(value: NormalizedValue): value is { readonly [key: string]: NormalizedValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A PAPI enum's decoded fields as a normalized record (the `value` of `{type,value}`). */
function enumData(decoded: PapiEnum): Record<string, NormalizedValue> {
  const normalized = toNormalized(decoded.value ?? null);
  if (isRecord(normalized)) return { ...normalized };
  // Non-struct payload (tuple/primitive): keep it under a stable key for rules to read.
  return { value: normalized };
}

/**
 * Normalize one `emitted_events` entry. Outer enum carries the pallet name; its inner
 * enum carries the event name + decoded fields.
 * TODO(verify: emitted_events nesting — see papi-shapes.ts PapiEventEntry.)
 */
export function normalizeEvent(entry: PapiEventEntry): NormalizedEvent {
  return normalizedEvent(entry.type, entry.value.type, enumData(entry.value));
}

/** Normalize a decoded `execution_result` (Rust `Result`) into the domain outcome. */
export function normalizeExecutionResult(result: PapiResult): ExecutionResult {
  if (result.success) return executionSuccess();
  return executionFailure(normalizeError(result.value));
}

/** Normalize the decoded error payload of a failed dry-run. `type` is source-populated. */
function normalizeError(value: unknown): ExecutionError {
  if (value !== null && typeof value === "object" && "type" in value) {
    const tag = (value as PapiEnum).type;
    return executionError(tag, { raw: toNormalized(value) });
  }
  return executionError("Unknown", { raw: toNormalized(value) });
}

/** Normalize a decoded `VersionedLocation` into the domain `Location`. */
export function normalizeLocation(loc: PapiVersionedLocation): Location {
  return location(loc.value.parents, toNormalized(loc.value.interior));
}

/** Normalize a decoded `VersionedXcm` into a domain `XcmProgram`. */
export function normalizeProgram(program: PapiVersionedXcm): XcmProgram {
  const version = xcmVersionFromTag(program.type);
  const instructions: XcmInstruction[] = program.value.map((instr) =>
    xcmInstruction(instr.type, toNormalized(instr.value ?? null)),
  );
  return xcmProgram(version, instructions);
}

/** Normalize one `forwarded_xcms` tuple `(location, messages)` into a `ForwardedXcm`. */
function normalizeForwarded(
  entry: readonly [PapiVersionedLocation, readonly PapiVersionedXcm[]],
): ForwardedXcm {
  const [dest, messages] = entry;
  return forwardedXcm(normalizeLocation(dest), messages.map(normalizeProgram));
}

/**
 * Normalize a decoded `CallDryRunEffects` into the domain `DryRunEffects`.
 * `resultXcmVersion` is the version requested in `dry_run_call` and applied as the
 * effects' `xcmVersion` (the forwarded/local programs carry their own version tags).
 */
export function normalizeEffects(
  effects: PapiCallDryRunEffects,
  resultXcmVersion: XcmVersion,
): DryRunEffects {
  return dryRunEffects({
    executionResult: normalizeExecutionResult(effects.execution_result),
    xcmVersion: resultXcmVersion,
    events: effects.emitted_events.map(normalizeEvent),
    forwardedXcms: effects.forwarded_xcms.map(normalizeForwarded),
    ...(effects.local_xcm ? { localXcm: normalizeProgram(effects.local_xcm) } : {}),
  });
}

/** Normalize a decoded fee payload from `XcmPaymentApi` into a domain `FeeEstimate`. */
export function normalizeFees(payload: PapiFeePayload): FeeEstimate {
  const asset = normalizeFeeAsset(payload);
  const weightPart = payload.weight
    ? { weight: { refTime: payload.weight.ref_time, proofSize: payload.weight.proof_size } }
    : {};
  return feeEstimate({ fee: payload.fee, asset, ...weightPart });
}

/** Normalize the selected payment asset when the decoded shape carries a concrete location. */
function normalizeFeeAsset(payload: PapiFeePayload): AssetId {
  if (payload.assetLocation) {
    return assetId({ location: location(payload.assetLocation.parents, payload.assetLocation.interior) });
  }
  return assetLocationFromVersioned(payload.asset);
}

/** Extract a fee asset location from a decoded `VersionedAssetId`, if its shape is known. */
function assetLocationFromVersioned(asset?: PapiVersionedAssetId): AssetId {
  if (!asset) return assetId({});
  const loc = locationFromNormalized(toNormalized(asset.value));
  return loc ? assetId({ location: loc }) : assetId({});
}

/** Detect the common PAPI-decoded XCM `Location` shape `{ parents, interior }`. */
function locationFromNormalized(value: NormalizedValue): Location | undefined {
  if (!isRecord(value)) return undefined;
  const { parents, interior } = value;
  if (typeof parents === "number" && interior !== undefined) {
    return location(parents, interior);
  }
  const nested = value.value;
  if (nested !== undefined && isRecord(nested)) return locationFromNormalized(nested);
  return undefined;
}
