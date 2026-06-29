import type { OutputFormat, TraceResult } from "../types/index.js";
import { renderHuman } from "./human.js";
import { renderJson } from "./json.js";

/**
 * Dispatch a `TraceResult` to the requested output format.
 * Exhaustive over `OutputFormat`; adding a format is a compile error until handled.
 */
export function render(result: TraceResult, format: OutputFormat): string {
  switch (format) {
    case "human":
      return renderHuman(result);
    case "json":
      return renderJson(result);
  }
}
