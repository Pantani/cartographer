// orchestrator/ — the trace engine. Drives the dry-run, collects effects, invokes
// diagnostics and report. The only module that knows the whole flow.
export { trace } from "./trace.js";
export type { TraceDeps, ClientFactory } from "./trace.js";
