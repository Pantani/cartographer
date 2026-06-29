import type {
  AssetId,
  Diagnosis,
  DryRunEffects,
  ExecutionResult,
  FeeEstimate,
  ForwardedXcm,
  NormalizedEvent,
  Weight,
  XcmProgram,
} from "../types/index.js";

/** JSON replacer that renders any `bigint` as its decimal string. */
function bigintToString(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString(10) : value;
}

/** Stable, locale-free serialization of a normalized value for human display. */
function stringifyValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "string") return value;
  return JSON.stringify(value, bigintToString);
}

/** Human label for an asset: prefer `symbol`, else its location, else "unknown asset". */
function assetLabel(asset: AssetId): string {
  if (asset.symbol !== undefined) return asset.symbol;
  if (asset.location) return `location ${stringifyValue(asset.location)}`;
  return "unknown asset";
}

/** One-line weight summary, or empty string when absent. */
function formatWeight(w: Weight | undefined): string {
  if (!w) return "";
  return ` (weight: refTime=${w.refTime.toString(10)}, proofSize=${w.proofSize.toString(10)})`;
}

/** Human fee line. Returns null when no estimate is present (caller omits the line). */
export function formatFees(fees: FeeEstimate | undefined): string | null {
  if (!fees) return null;
  return `Fee: ${fees.fee.toString(10)} ${assetLabel(fees.asset)}${formatWeight(fees.weight)}`;
}

/** Render a list of suggestions as indented bullet lines. */
function formatSuggestions(suggestions: readonly string[]): readonly string[] {
  return suggestions.map((s) => `  - ${s}`);
}

const STATUS_HEADLINE: Readonly<Record<Diagnosis["status"], string>> = {
  success: "SUCCESS — the message executed without error.",
  failure: "FAILURE — the message did not execute as intended.",
  unknown: "UNKNOWN — no diagnostic rule matched; inspect the raw effects below.",
};

/** Verdict-specific diagnosis block (root cause, explanation, suggestions). */
export function formatDiagnosis(d: Diagnosis): readonly string[] {
  const lines: string[] = [STATUS_HEADLINE[d.status]];
  if (d.rootCause !== undefined) lines.push(`Root cause: ${d.rootCause}`);
  if (d.explanation !== undefined) lines.push(`Explanation: ${d.explanation}`);
  if (d.ruleId !== undefined) lines.push(`Rule: ${d.ruleId}`);
  if (d.suggestions && d.suggestions.length > 0) {
    lines.push("Suggestions:", ...formatSuggestions(d.suggestions));
  }
  return lines;
}

/** One line per event: "pallet.name {data}". */
export function formatEvents(events: readonly NormalizedEvent[]): readonly string[] {
  if (events.length === 0) return ["  (no events emitted)"];
  return events.map((e) => `  ${e.pallet}.${e.name} ${stringifyValue(e.data)}`);
}

/** Event block for a hop; always present so a quiet dry-run is explicit. */
export function formatEventBlock(events: readonly NormalizedEvent[]): readonly string[] {
  return ["Events:", ...formatEvents(events)];
}

/** Compact one-line summary of a queued XCM program. */
function formatXcmProgram(program: XcmProgram): string {
  const instructions = program.instructions.map((i) => i.kind).join(", ");
  return `v${program.version.toString(10)} ${instructions || "(empty)"}`;
}

/** Lines describing one forwarded destination and the messages queued for it. */
function formatForwardedEntry(entry: ForwardedXcm): readonly string[] {
  const messages = entry.messages.map(
    (message, index) => `    message ${index.toString(10)}: ${formatXcmProgram(message)}`,
  );
  return [`  destination ${stringifyValue(entry.destination)}`, ...messages];
}

/** Forwarded-XCM block for a hop; empty queues are explicit in human output. */
export function formatForwardedXcms(forwards: readonly ForwardedXcm[]): readonly string[] {
  if (forwards.length === 0) return ["Forwarded XCM: none"];
  return ["Forwarded XCM:", ...forwards.flatMap(formatForwardedEntry)];
}

/** Human form of the execution result outcome. */
function formatExecutionResult(execution: ExecutionResult): string {
  if (execution.kind === "success") return "  executionResult: success";
  const { error } = execution;
  const detail = error.detail !== undefined ? `: ${error.detail}` : "";
  return `  executionResult: failure (${error.type}${detail})`;
}

/** Raw-effects dump for `unknown` status (ADR-0003): execution result + events. */
export function formatRawEffects(effects: DryRunEffects): readonly string[] {
  return [
    "Raw effects:",
    formatExecutionResult(effects.executionResult),
    "  events:",
    ...formatEvents(effects.events),
  ];
}
