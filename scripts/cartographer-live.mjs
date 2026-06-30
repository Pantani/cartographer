import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const clientEnvNames = ["CARTOGRAPHER_IT_RPC", "CARTOGRAPHER_IT_ACCOUNT", "CARTOGRAPHER_IT_CALL"];
export const fullEnvNames = [...clientEnvNames, "CARTOGRAPHER_IT_CALL_OK", "CARTOGRAPHER_IT_CALL_FAIL"];

const cliEnvNames = ["CARTOGRAPHER_IT_RPC", "CARTOGRAPHER_IT_ACCOUNT"];
const rawXcmCliEnvNames = ["CARTOGRAPHER_IT_RPC", "CARTOGRAPHER_IT_XCM_ORIGIN", "CARTOGRAPHER_IT_XCM_FILE"];
const callEnvNames = new Set(["CARTOGRAPHER_IT_CALL", "CARTOGRAPHER_IT_CALL_OK", "CARTOGRAPHER_IT_CALL_FAIL"]);
const callHexPattern = /^0x(?:[0-9a-fA-F]{2})+$/;
const placeholderValues = new Map([
  ["CARTOGRAPHER_IT_RPC", "wss://asset-hub-polkadot-rpc.example"],
  ["CARTOGRAPHER_IT_ACCOUNT", "5..."],
  ["CARTOGRAPHER_IT_CALL", "0x..."],
  ["CARTOGRAPHER_IT_CALL_OK", "0x..."],
  ["CARTOGRAPHER_IT_CALL_FAIL", "0x..."],
]);
const defaultRuntime = {
  env: process.env,
  error: (message) => console.error(message),
  exit: (code) => process.exit(code),
  spawnSync,
  execPath: process.execPath,
};

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
  if (isConfigured(env.CARTOGRAPHER_IT_XCM_FILE)) return buildRawXcmTraceArgs(env);
  return buildCallTraceArgs(env);
}

function buildCallTraceArgs(env) {
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
    ...optionalTraceArgs(env),
    "--format",
    env.CARTOGRAPHER_IT_FORMAT || "json",
  ];
}

function buildRawXcmTraceArgs(env) {
  const missing = findMissingEnv(rawXcmCliEnvNames, env);
  if (missing.length > 0) throw new Error(formatMissingEnvMessage("xcm:cli", missing));

  return [
    "dist/cli/index.js",
    "trace",
    "--rpc",
    env.CARTOGRAPHER_IT_RPC,
    "--origin",
    env.CARTOGRAPHER_IT_XCM_ORIGIN,
    "--xcm",
    env.CARTOGRAPHER_IT_XCM_FILE,
    ...optionalTraceArgs(env),
    "--format",
    env.CARTOGRAPHER_IT_FORMAT || "json",
  ];
}

function optionalTraceArgs(env) {
  return [...registryArgs(env), ...maxDepthArgs(env)];
}

function registryArgs(env) {
  return isConfigured(env.CARTOGRAPHER_IT_REGISTRY) ? ["--registry", env.CARTOGRAPHER_IT_REGISTRY] : [];
}

function maxDepthArgs(env) {
  if (!isConfigured(env.CARTOGRAPHER_IT_MAX_DEPTH)) return [];
  if (!/^[1-9]\d*$/.test(env.CARTOGRAPHER_IT_MAX_DEPTH)) {
    throw new Error("CARTOGRAPHER_IT_MAX_DEPTH must be a positive integer.");
  }
  return ["--max-depth", env.CARTOGRAPHER_IT_MAX_DEPTH];
}

function isUsableEnvValue(name, value) {
  if (typeof value !== "string" || value.trim() === "" || value === placeholderValues.get(name)) return false;
  if (callEnvNames.has(name)) return isUsableCallValue(value);
  return true;
}

function isConfigured(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isUsableCallValue(value) {
  return typeof value === "string" && callHexPattern.test(value);
}

function firstUsableCallValue(...values) {
  return values.find(isUsableCallValue);
}

function checkEnv(commandName, names, runtime) {
  const missing = findMissingEnv(names, runtime.env);
  if (missing.length === 0) return;
  runtime.error(formatMissingEnvMessage(commandName, missing));
  runtime.exit(1);
}

function checkCliEnv(runtime) {
  try {
    buildTraceArgs(runtime.env);
  } catch (error) {
    runtime.error(error instanceof Error ? error.message : String(error));
    runtime.exit(1);
  }
}

function runCli(runtime) {
  let status;
  try {
    const result = runtime.spawnSync(runtime.execPath, buildTraceArgs(runtime.env), { stdio: "inherit" });
    status = result.status ?? 1;
  } catch (error) {
    runtime.error(error instanceof Error ? error.message : String(error));
    runtime.exit(1);
    return;
  }
  runtime.exit(status);
}

export function main(argv, runtime = defaultRuntime) {
  const command = argv[2];
  if (command === "check-cli") {
    checkCliEnv(runtime);
    return;
  }
  if (command === "check-client") {
    checkEnv("xcm:test", clientEnvNames, runtime);
    return;
  }
  if (command === "check-full") {
    checkEnv("test:live", fullEnvNames, runtime);
    return;
  }
  if (command === "run-cli") {
    runCli(runtime);
    return;
  }
  runtime.error("Usage: node scripts/cartographer-live.mjs check-cli|check-client|check-full|run-cli");
  runtime.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
