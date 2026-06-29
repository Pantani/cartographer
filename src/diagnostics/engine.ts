import type { Diagnosis, DiagnosisContext, DiagnosticRule } from "../types/index.js";
import { unknownDiagnosis } from "../types/index.js";
import { seedRules } from "./rules.js";

/**
 * Walk `rules` in order and return the first matching rule's diagnosis; if none
 * match, return the honest `unknown` diagnosis (ADR-0003). Pure: no I/O.
 * Invariant: order encodes specificity — callers pass most-specific rules first.
 */
export function diagnose(
  ctx: DiagnosisContext,
  rules: readonly DiagnosticRule[],
): Diagnosis {
  for (const rule of rules) {
    if (rule.matches(ctx)) return rule.explain(ctx);
  }
  return unknownDiagnosis();
}

/** Convenience: diagnose using the project's ordered seed rule registry. */
export function diagnoseWithSeedRules(ctx: DiagnosisContext): Diagnosis {
  return diagnose(ctx, seedRules);
}
