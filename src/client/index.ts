// client/ — PAPI wrapper over DryRunApi + XcmPaymentApi. The only module that does
// network I/O (architecture rule 2). PAPI types must not leak past here (rule 6): the
// public surface below returns only types/ domain models.

export type { ChainClient } from "./papi.js";
export { openChainClient } from "./papi.js";

// Pure normalizers are exported for unit testing and for an orchestrator that already
// holds PAPI-decoded data (none today). They take papi-shapes inputs, which are internal.
export {
  normalizeEffects,
  normalizeFees,
  normalizeEvent,
  normalizeProgram,
  normalizeLocation,
  normalizeExecutionResult,
  xcmVersionFromTag,
  toNormalized,
} from "./normalize.js";
