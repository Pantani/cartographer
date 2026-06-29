// diagnostics/ — effects → root cause via a data-driven rule registry. Pure: no
// network, no PAPI, no orchestrator/client imports (architecture rule 2).
export { diagnose, diagnoseWithSeedRules } from "./engine.js";
export { seedRules, seedRules as rules } from "./rules.js";
export {
  failureError,
  isFailure,
  errorMentions,
  hasEventMatching,
} from "./match.js";
