import type { DryRunEffects, NormalizedEvent } from "./effects.js";
import type { FeeEstimate } from "./assets.js";

export type DiagnosisStatus = "success" | "failure" | "unknown";

/** A human-readable verdict produced by the diagnostics engine (ADR-0003). */
export interface Diagnosis {
  readonly status: DiagnosisStatus;
  readonly ruleId?: string;
  readonly rootCause?: string;
  readonly explanation?: string;
  readonly suggestions?: readonly string[];
}

/**
 * Input to a diagnostic rule. Invariant: `events === effects.events` (the constructor
 * enforces it). `fees` is present when `XcmPaymentApi` returned an estimate.
 */
export interface DiagnosisContext {
  readonly effects: DryRunEffects;
  readonly events: readonly NormalizedEvent[];
  readonly fees?: FeeEstimate;
}

export function diagnosisContext(effects: DryRunEffects, fees?: FeeEstimate): DiagnosisContext {
  return {
    effects,
    events: effects.events,
    ...(fees ? { fees } : {}),
  };
}

/**
 * An ordered, pure rule: `matches` decides applicability against the context,
 * `explain` produces the diagnosis. Adding a diagnosis = adding a rule (ADR-0003).
 */
export interface DiagnosticRule {
  readonly id: string;
  readonly matches: (ctx: DiagnosisContext) => boolean;
  readonly explain: (ctx: DiagnosisContext) => Diagnosis;
}

export function successDiagnosis(opts: { ruleId?: string; explanation?: string } = {}): Diagnosis {
  return {
    status: "success",
    ...(opts.ruleId !== undefined ? { ruleId: opts.ruleId } : {}),
    ...(opts.explanation !== undefined ? { explanation: opts.explanation } : {}),
  };
}

export function failureDiagnosis(params: {
  ruleId: string;
  rootCause: string;
  explanation?: string;
  suggestions?: readonly string[];
}): Diagnosis {
  return {
    status: "failure",
    ruleId: params.ruleId,
    rootCause: params.rootCause,
    ...(params.explanation !== undefined ? { explanation: params.explanation } : {}),
    ...(params.suggestions ? { suggestions: params.suggestions } : {}),
  };
}

/**
 * The honest default when no rule matched (ADR-0003): status `unknown`, no invented
 * cause. `report/` surfaces the raw effects so the user can inspect them.
 */
export function unknownDiagnosis(
  opts: { explanation?: string; suggestions?: readonly string[] } = {},
): Diagnosis {
  return {
    status: "unknown",
    explanation:
      opts.explanation ?? "No diagnostic rule matched. Inspect the raw effects below.",
    ...(opts.suggestions ? { suggestions: opts.suggestions } : {}),
  };
}
