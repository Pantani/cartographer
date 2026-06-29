import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const clientEnvNames = ["CARTOGRAPHER_IT_RPC", "CARTOGRAPHER_IT_ACCOUNT", "CARTOGRAPHER_IT_CALL"];
export const fullEnvNames = [...clientEnvNames, "CARTOGRAPHER_IT_CALL_OK", "CARTOGRAPHER_IT_CALL_FAIL"];

const cliEnvNames = ["CARTOGRAPHER_IT_RPC", "CARTOGRAPHER_IT_ACCOUNT"];
const callEnvNames = new Set(["CARTOGRAPHER_IT_CALL", "CARTOGRAPHER_IT_CALL_OK", "CARTOGRAPHER_IT_CALL_FAIL"]);
const callHexPattern = /^0x(?:[0-9a-fA-F]{2})+$/;
const placeholderValues = new Map([
  ["CARTOGRAPHER_IT_RPC", "wss://asset-hub-polkadot-rpc.example"],
  ["CARTOGRAPHER_IT_ACCOUNT", "5..."],
  ["CARTOGRAPHER_IT_CALL", "0x..."],
  ["CARTOGRAPHER_IT_CALL_OK", "0x..."],
  ["CARTOGRAPHER_IT_CALL_FAIL", "0x..."],
]);

/** Finds required env vars that are absent or still set to example placeholders. */
export function findMissingEnv(names, env = process.env) {
  return names.filter((name) => !isUsableEnvValue(name, env[name]));
}

/** Formats a fail-fast live command error for unusable env vars. */
export function formatMissingEnvMessage(commandName, missing) {
  const joined = missing.join(", ");
  return `${commandName} requires real values for ${joined}. Export real values and rerun the command.`;
}

/** Builds the live CLI argv from validated env values. */
export function buildTraceArgs(env = process.env) {
  const missing = findMissingEnv(cliEnvNames, env);
  const call = firstUsableCallValue(env.CARTOGRAPHER_IT_CALL_OK, env.CARTOGRAPHER_IT_CALL);
  if (!isUsableCallValue(call)) missing.push("CARTOGRAPHER_IT_CALL_OK or CARTOGRAPHER_IT_CALL");
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

function isUsableEnvValue(name, value) {
  if (typeof value !== "string" || value.trim() === "" || value === placeholderValues.get(name)) return false;
  if (callEnvNames.has(name)) return isUsableCallValue(value);
  return true;
}

function isUsableCallValue(value) {
  return typeof value === "string" && callHexPattern.test(value);
}

function firstUsableCallValue(...values) {
  return values.find(isUsableCallValue);
}

function checkEnv(commandName, names) {
  const missing = findMissingEnv(names);
  if (missing.length === 0) return;
  console.error(formatMissingEnvMessage(commandName, missing));
  process.exit(1);
}

function checkCliEnv() {
  try {
    buildTraceArgs();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
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
  if (command === "check-cli") {
    checkCliEnv();
    return;
  }
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
  console.error("Usage: node scripts/cartographer-live.mjs check-cli|check-client|check-full|run-cli");
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
