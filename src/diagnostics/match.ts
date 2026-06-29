import type { DiagnosisContext, ExecutionError, NormalizedEvent } from "../types/index.js";

/**
 * Pure matching helpers shared by the seed rules. They exist so each rule's
 * `matches` stays a trivial one-liner (well under the complexity ceiling) and so
 * the defensive, source-unverified string matching lives in one auditable place.
 *
 * Matching is deliberately defensive: until a real dry-run regression corpus
 * exists (ADR-0003), we match case-insensitively on substrings of the
 * normalized error `type`/`detail` and event `pallet`/`name`, never on an exact
 * identifier we cannot yet confirm.
 */

/** The failure `ExecutionError`, or `undefined` when the dry-run did not fail. */
export function failureError(ctx: DiagnosisContext): ExecutionError | undefined {
  const result = ctx.effects.executionResult;
  return result.kind === "failure" ? result.error : undefined;
}

/** True when the dry-run reports a top-level execution failure. */
export function isFailure(ctx: DiagnosisContext): boolean {
  return ctx.effects.executionResult.kind === "failure";
}

/** Lower-cased haystack built from the error's `type` and `detail`. */
export function errorText(error: ExecutionError): string {
  return `${error.type} ${error.detail ?? ""}`.toLowerCase();
}

/** True when the failure error's text contains any of `needles` (case-insensitive). */
export function errorMentions(ctx: DiagnosisContext, needles: readonly string[]): boolean {
  const error = failureError(ctx);
  if (error === undefined) return false;
  const text = errorText(error);
  return needles.some((needle) => text.includes(needle.toLowerCase()));
}

/** Lower-cased haystack for a single event: "pallet name". */
export function eventText(event: NormalizedEvent): string {
  return `${event.pallet} ${event.name}`.toLowerCase();
}

/** True when any emitted event's "pallet name" contains every needle of one row. */
export function hasEventMatching(
  ctx: DiagnosisContext,
  needles: readonly string[],
): boolean {
  return ctx.events.some((event) => {
    const text = eventText(event);
    return needles.every((needle) => text.includes(needle.toLowerCase()));
  });
}
