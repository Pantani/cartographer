// dependency-cruiser config.
// Encodes the "Rules (enforced)" section of docs/architecture.md. Each forbidden
// rule below maps to a numbered architecture rule; a violating import fails CI.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Rule 5: no cycles between any modules.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "types-imports-nothing",
      comment:
        "Rule 1: types/ is the leaf. Production types import nothing outside types/ (no src module, no library). Test files are exempt (they import the test runner).",
      severity: "error",
      from: { path: "^src/types/", pathNot: "\\.test\\.ts$" },
      to: { pathNot: "^src/types/" },
    },
    {
      name: "diagnostics-report-are-pure",
      comment:
        "Rule 2: diagnostics/ and report/ are pure. They may not import client/, orchestrator/, or cli/.",
      severity: "error",
      from: { path: "^src/(diagnostics|report)/" },
      to: { path: "^src/(client|orchestrator|cli)/" },
    },
    {
      name: "pure-modules-no-network-libs",
      comment:
        "Rule 2: only client/ may touch the network. Pure / non-client modules must not import PAPI or a transport.",
      severity: "error",
      from: { path: "^src/(diagnostics|report|orchestrator|registry|types)/" },
      to: { path: "node_modules/(polkadot-api|ws|isomorphic-ws)" },
    },
    {
      name: "papi-contained-to-client",
      comment:
        "Rule 6: PAPI types do not leak past client/. Only client/ may import polkadot-api (incl. type-only imports).",
      severity: "error",
      from: { pathNot: "^src/client/" },
      to: { path: "node_modules/polkadot-api" },
    },
    {
      name: "client-never-imports-upward",
      comment: "Rule 3: client/ may not import orchestrator/ or cli/.",
      severity: "error",
      from: { path: "^src/client/" },
      to: { path: "^src/(orchestrator|cli)/" },
    },
    {
      name: "nothing-imports-cli",
      comment: "Rule 4: cli/ is the top edge. Nothing imports it.",
      severity: "error",
      from: { pathNot: "^src/cli/" },
      to: { path: "^src/cli/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    // Resolve type-only imports too, so rule 6 (PAPI type leakage) is enforced.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
