import type { ChainRef, Hop, TraceResult } from "../types/index.js";
import {
  formatDiagnosis,
  formatEventBlock,
  formatFees,
  formatForwardedXcms,
  formatRawEffects,
} from "./format.js";

/** Display name for a hop's chain: `name`, else `rpc`, else "unknown chain". */
function chainLabel(chain: ChainRef): string {
  return chain.name ?? chain.rpc ?? "unknown chain";
}

/** Header line locating the (single) hop. */
function hopHeader(h: Hop): string {
  return `Hop ${h.index.toString(10)} @ ${chainLabel(h.chain)}`;
}

/** Lines for one hop: header, diagnosis, fees, and (when unknown) raw effects. */
function renderHop(h: Hop): readonly string[] {
  const lines: string[] = [hopHeader(h), ...formatDiagnosis(h.diagnosis)];
  const feeLine = formatFees(h.fees);
  if (feeLine !== null) lines.push(feeLine);
  if (h.diagnosis.status === "unknown") {
    lines.push(...formatRawEffects(h.effects));
  } else {
    lines.push(...formatEventBlock(h.effects.events));
  }
  lines.push(...formatForwardedXcms(h.effects.forwardedXcms));
  return lines;
}

/** Trace-level fee line, shown only when it is not already covered by a hop's fees. */
function traceFeeLines(result: TraceResult): readonly string[] {
  const hopHasFees = result.hops.some((h) => h.fees);
  if (hopHasFees) return [];
  const feeLine = formatFees(result.fees);
  return feeLine !== null ? [feeLine] : [];
}

/**
 * Render a `TraceResult` to readable text (S0-T5).
 * Pure and deterministic: no `Date`, no locale formatting. Surfaces raw effects
 * on `unknown` status (ADR-0003) and never throws on missing optional fields.
 */
export function renderHuman(result: TraceResult): string {
  const hopLines = result.hops.flatMap((h) => [...renderHop(h), ""]);
  const lines = [
    "Cartographer trace",
    "==================",
    ...hopLines,
    ...traceFeeLines(result),
  ];
  return lines.join("\n").trimEnd() + "\n";
}
