import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const clientEnvNames = ["CARTOGRAPHER_IT_RPC", "CARTOGRAPHER_IT_ACCOUNT", "CARTOGRAPHER_IT_CALL"];
export const fullEnvNames = [...clientEnvNames, "CARTOGRAPHER_IT_CALL_OK", "CARTOGRAPHER_IT_CALL_FAIL"];

const cliEnvNames = ["CARTOGRAPHER_IT_RPC", "CARTOGRAPHER_IT_ACCOUNT"];

export function findMissingEnv(names, env = process.env) {
  return names.filter((name) => !env[name]);
}

export function formatMissingEnvMessage(commandName, missing) {
  const joined = missing.join(", ");
  return `${commandName} requires ${joined}. Export the missing values and rerun the command.`;
}

export function buildTraceArgs(env = process.env) {
  const missing = findMissingEnv(cliEnvNames, env);
  const call = env.CARTOGRAPHER_IT_CALL_OK || env.CARTOGRAPHER_IT_CALL;
  if (!call) missing.push("CARTOGRAPHER_IT_CALL_OK or CARTOGRAPHER_IT_CALL");
  if (missing.length > 0) throw new Error(formatMissingEnvMessage("xcm:cli", missing));

  return [
    "dist/cli/index.js",
    "trace",
    "--rpc",
    env.CARTOGRAPHER_IT_RPC,
    "--origin",
    env.CARTOGRAPHER_IT_ACCOUNT,
    "--call",
    call,
    "--format",
    env.CARTOGRAPHER_IT_FORMAT || "json",
  ];
}

function checkEnv(commandName, names) {
  const missing = findMissingEnv(names);
  if (missing.length === 0) return;
  console.error(formatMissingEnvMessage(commandName, missing));
  process.exit(1);
}

function runCli() {
  try {
    const result = spawnSync(process.execPath, buildTraceArgs(), { stdio: "inherit" });
    process.exit(result.status ?? 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function main(argv) {
  const command = argv[2];
  if (command === "check-client") {
    checkEnv("xcm:test", clientEnvNames);
    return;
  }
  if (command === "check-full") {
    checkEnv("test:live", fullEnvNames);
    return;
  }
  if (command === "run-cli") {
    runCli();
    return;
  }
  console.error("Usage: node scripts/cartographer-live.mjs check-client|check-full|run-cli");
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
