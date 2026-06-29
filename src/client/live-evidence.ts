import type { DryRunEffects, FeeEstimate, HexString, NormalizedValue, XcmVersion } from "../types/index.js";
import { toNormalized } from "./normalize.js";

/** Captured fee outcome for live PAPI evidence; never throws while formatting. */
export type LiveFeesEvidence =
  | { readonly kind: "estimated"; readonly value: FeeEstimate; readonly raw: LiveRawFeesEvidence }
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "failed"; readonly error: string };

/** Raw XcmPaymentApi responses captured before normalization. */
export interface LiveRawFeesEvidence {
  readonly weight: unknown;
  readonly assets: unknown;
  readonly selectedAsset: unknown;
  readonly fee: unknown;
}

/** Structural summary of the decoded dry-run payload, used to close live shape TODOs. */
export interface DryRunRawShape {
  readonly wrappedResult: boolean;
  readonly topLevelKeys: readonly string[];
  readonly effectsKeys: readonly string[];
  readonly emittedEventsCount?: number;
  readonly emittedEventSample?: NormalizedValue;
  readonly localXcmSample?: NormalizedValue;
  readonly forwardedXcmsCount?: number;
  readonly forwardedXcmSample?: NormalizedValue;
}

/** Full evidence envelope printed by opt-in live integration tests. */
export interface LiveDryRunEvidence {
  readonly label: string;
  readonly input: {
    readonly account: string;
    readonly callBytes: number;
    readonly resultXcmVersion: XcmVersion;
  };
  readonly rawDryRun: unknown;
  readonly rawShape: DryRunRawShape;
  readonly normalizedEffects: DryRunEffects;
  readonly fees: LiveFeesEvidence;
}

/** Build a live dry-run evidence envelope without interpreting unverified payload shapes. */
export function makeDryRunEvidence(params: {
  readonly label: string;
  readonly account: string;
  readonly call: HexString;
  readonly resultXcmVersion: XcmVersion;
  readonly rawDryRun: unknown;
  readonly normalizedEffects: DryRunEffects;
  readonly fees: LiveFeesEvidence;
}): LiveDryRunEvidence {
  return {
    label: params.label,
    input: {
      account: params.account,
      callBytes: hexByteLength(params.call),
      resultXcmVersion: params.resultXcmVersion,
    },
    rawDryRun: params.rawDryRun,
    rawShape: describeRawDryRun(params.rawDryRun),
    normalizedEffects: params.normalizedEffects,
    fees: params.fees,
  };
}

/** Render live evidence as JSON while preserving bigint values as decimal strings. */
export function toEvidenceJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item), 2);
}

function describeRawDryRun(raw: unknown): DryRunRawShape {
  const effects = unwrapRuntimeResult(raw);
  const emittedEvents = readField(effects, "emitted_events");
  const localXcm = readField(effects, "local_xcm");
  const forwardedXcms = readField(effects, "forwarded_xcms");
  const emittedEventsCount = arrayCount(emittedEvents);
  const emittedEventSample = firstNormalized(emittedEvents);
  const localXcmSample = maybeNormalize(localXcm);
  const forwardedXcmsCount = arrayCount(forwardedXcms);
  const forwardedXcmSample = firstNormalized(forwardedXcms);
  return {
    wrappedResult: isRuntimeResult(raw),
    topLevelKeys: recordKeys(raw),
    effectsKeys: recordKeys(effects),
    ...(emittedEventsCount !== undefined ? { emittedEventsCount } : {}),
    ...(emittedEventSample !== undefined ? { emittedEventSample } : {}),
    ...(localXcmSample !== undefined ? { localXcmSample } : {}),
    ...(forwardedXcmsCount !== undefined ? { forwardedXcmsCount } : {}),
    ...(forwardedXcmSample !== undefined ? { forwardedXcmSample } : {}),
  };
}

function unwrapRuntimeResult(raw: unknown): unknown {
  return isRuntimeResult(raw) ? raw.value : raw;
}

function isRuntimeResult(value: unknown): value is { readonly success: boolean; readonly value: unknown } {
  return isRecord(value) && typeof value.success === "boolean" && "value" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordKeys(value: unknown): readonly string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

function readField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function arrayCount(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function firstNormalized(value: unknown): NormalizedValue | undefined {
  return Array.isArray(value) && value.length > 0 ? toNormalized(value[0]) : undefined;
}

function maybeNormalize(value: unknown): NormalizedValue | undefined {
  return value === undefined ? undefined : toNormalized(value);
}

function hexByteLength(hex: HexString): number {
  return (hex.startsWith("0x") ? hex.length - 2 : hex.length) / 2;
}
