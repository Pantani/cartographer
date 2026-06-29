import { spawn, spawnSync } from "node:child_process";
import { openSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEV_ACCOUNT = "//Alice";
const STATE_FILE = "current.json";
const DEFAULT_BOOT_TIMEOUT_MS = 120_000;
const DEFAULT_SEND_TIMEOUT_MS = 120_000;
const CALL_HEX_PATTERN = /^0x(?:[0-9a-fA-F]{2})+$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const defaultLocalConfig = {
  stateDir: ".cartographer-local",
  evidenceDir: "_workspace/local-xcm",
  relayConfig: "infra/chopsticks/westend.yml",
  parachainConfigs: ["infra/chopsticks/westend-asset-hub.yml", "infra/chopsticks/westend-people.yml"],
  endpoints: {
    origin: "ws://127.0.0.1:8000",
    destination: "ws://127.0.0.1:8001",
    relay: "ws://127.0.0.1:8002",
  },
};

export function splitConfigList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function makeLocalConfig(env = process.env, cwd = process.cwd()) {
  const parachainConfigs = parseParachainConfigs(env);
  return {
    stateDir: resolveFrom(cwd, env.CARTOGRAPHER_LOCAL_STATE_DIR || defaultLocalConfig.stateDir),
    evidenceDir: resolveFrom(cwd, env.CARTOGRAPHER_LOCAL_EVIDENCE_DIR || defaultLocalConfig.evidenceDir),
    relayConfig: resolveOptional(cwd, env.CARTOGRAPHER_LOCAL_RELAY_CONFIG, defaultLocalConfig.relayConfig),
    parachainConfigs: parachainConfigs.map((config) => resolveFrom(cwd, config)),
    endpoints: {
      origin: env.CARTOGRAPHER_LOCAL_ORIGIN_RPC || defaultLocalConfig.endpoints.origin,
      destination: env.CARTOGRAPHER_LOCAL_DEST_RPC || defaultLocalConfig.endpoints.destination,
      relay: env.CARTOGRAPHER_LOCAL_RELAY_RPC || defaultLocalConfig.endpoints.relay,
    },
    cwd,
  };
}

export function buildChopsticksArgs(config) {
  const relayArgs = config.relayConfig ? ["--relaychain", config.relayConfig] : [];
  const parachainArgs = config.parachainConfigs.flatMap((parachain) => ["--parachain", parachain]);
  return ["exec", "chopsticks", "xcm", ...relayArgs, ...parachainArgs];
}

export function isCallHex(value) {
  return typeof value === "string" && CALL_HEX_PATTERN.test(value);
}

export function assertLocalEndpoint(label, endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`${label} endpoint must be a valid URL.`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`${label} endpoint must be local for this workflow.`);
  }
}

export function httpUrlFromRpc(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  return url.toString();
}

export function buildHealthRequest(endpoint) {
  return {
    url: httpUrlFromRpc(endpoint),
    body: { id: 1, jsonrpc: "2.0", method: "chain_getHeader", params: [] },
  };
}

export function buildSendPlan(state, env = process.env) {
  const call = env.CARTOGRAPHER_LOCAL_CALL || state.evidence?.lastCall;
  if (!isCallHex(call)) {
    throw new Error("xcm-send requires CARTOGRAPHER_LOCAL_CALL with a 0x-prefixed even-length SCALE call.");
  }
  assertLocalEndpoint("origin", state.endpoints.origin);
  return {
    rpcUrl: state.endpoints.origin,
    accountUri: env.CARTOGRAPHER_LOCAL_ACCOUNT || DEV_ACCOUNT,
    call,
    evidenceDir: state.evidence.runDir,
  };
}

export function buildCliTraceArgs(state, env = process.env) {
  const call = env.CARTOGRAPHER_LOCAL_CALL || state.evidence?.lastCall;
  if (!isCallHex(call)) {
    throw new Error("xcm-cli requires a local call from CARTOGRAPHER_LOCAL_CALL or prior xcm-send evidence.");
  }
  assertLocalEndpoint("origin", state.endpoints.origin);
  return [
    "dist/cli/index.js",
    "trace",
    "--rpc",
    state.endpoints.origin,
    "--origin",
    env.CARTOGRAPHER_LOCAL_ACCOUNT || DEV_ACCOUNT,
    "--call",
    call,
    "--format",
    env.CARTOGRAPHER_LOCAL_FORMAT || "json",
  ];
}

export function buildRunPaths(evidenceDir, isoString, sha) {
  const stamp = isoString.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const runId = `${stamp}-${sha || "unknown"}`;
  const runDir = path.join(evidenceDir, "runs", runId);
  return {
    runId,
    runDir,
    stdoutLog: path.join(runDir, "chopsticks.stdout.log"),
    stderrLog: path.join(runDir, "chopsticks.stderr.log"),
  };
}

export function formatStatus(status) {
  const alive = status.processAlive ? "alive" : "not alive";
  const lines = [`state: ${status.statePath}`, `pid: ${status.pid ?? "missing"} (${alive})`];
  for (const [label, endpoint] of Object.entries(status.endpoints)) {
    const health = status.health[label] ?? { ok: false, detail: "not checked" };
    lines.push(`${label}: ${endpoint} health=${health.ok ? "ok" : "fail"} ${health.detail}`);
  }
  return lines.join("\n");
}

async function commandUp(config, env = process.env) {
  await assertConfigFiles(config);
  await fs.mkdir(config.stateDir, { recursive: true });
  await fs.mkdir(config.evidenceDir, { recursive: true });

  const statePath = path.join(config.stateDir, STATE_FILE);
  const existing = await readState(statePath);
  if (existing && isPidAlive(existing.pid)) {
    throw new Error(`Local Chopsticks infra is already running with pid ${existing.pid}. Run make infra-status.`);
  }

  const runPaths = buildRunPaths(config.evidenceDir, new Date().toISOString(), gitSha(config.cwd));
  await fs.mkdir(runPaths.runDir, { recursive: true });

  const child = spawn("pnpm", buildChopsticksArgs(config), {
    cwd: config.cwd,
    detached: true,
    env,
    stdio: [
      "ignore",
      openSync(runPaths.stdoutLog, "a"),
      openSync(runPaths.stderrLog, "a"),
    ],
  });
  child.unref();

  const state = {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    command: ["pnpm", ...buildChopsticksArgs(config)],
    config: {
      relayConfig: config.relayConfig,
      parachainConfigs: config.parachainConfigs,
    },
    endpoints: config.endpoints,
    evidence: {
      runId: runPaths.runId,
      runDir: runPaths.runDir,
      stdoutLog: runPaths.stdoutLog,
      stderrLog: runPaths.stderrLog,
    },
  };
  await writeJson(statePath, state);

  const timeoutMs = Number(env.CARTOGRAPHER_LOCAL_BOOT_TIMEOUT_MS || DEFAULT_BOOT_TIMEOUT_MS);
  const health = await waitForHealthy(config.endpoints, timeoutMs);
  if (!allHealthy(health)) {
    await killTrackedProcess(state.pid);
    throw new Error(`Chopsticks did not become healthy within ${timeoutMs}ms.\n${formatStatus({
      statePath,
      pid: state.pid,
      processAlive: isPidAlive(state.pid),
      endpoints: config.endpoints,
      health,
    })}`);
  }

  return [
    "Local Chopsticks XCM infra is up.",
    formatStatus({ statePath, pid: state.pid, processAlive: true, endpoints: config.endpoints, health }),
    `evidence: ${runPaths.runDir}`,
    "next: make xcm-send, make xcm-test, make xcm-cli",
  ].join("\n");
}

async function commandStatus(config) {
  const statePath = path.join(config.stateDir, STATE_FILE);
  const state = await requireState(statePath);
  const health = await checkAllHealth(state.endpoints);
  return formatStatus({
    statePath,
    pid: state.pid,
    processAlive: isPidAlive(state.pid),
    endpoints: state.endpoints,
    health,
  });
}

async function commandDown(config) {
  const statePath = path.join(config.stateDir, STATE_FILE);
  const state = await readState(statePath);
  if (!state) return `No local Chopsticks state found at ${statePath}.`;
  const wasAlive = isPidAlive(state.pid);
  if (wasAlive) await killTrackedProcess(state.pid);
  await fs.rm(statePath, { force: true });
  return [
    `Local Chopsticks infra ${wasAlive ? "stopped" : "was not alive; stale state removed"}.`,
    `Evidence preserved at ${state.evidence?.runDir ?? "(unknown)"}.`,
  ].join("\n");
}

async function commandSend(config, env = process.env) {
  const statePath = path.join(config.stateDir, STATE_FILE);
  const state = await requireRunningState(statePath);
  const plan = buildSendPlan(state, env);
  const result = await submitLocalCall(plan, Number(env.CARTOGRAPHER_LOCAL_SEND_TIMEOUT_MS || DEFAULT_SEND_TIMEOUT_MS));
  const nextState = {
    ...state,
    evidence: {
      ...state.evidence,
      lastCall: plan.call,
      lastSendResult: path.join(plan.evidenceDir, "xcm-send-result.json"),
    },
  };
  await writeJson(nextState.evidence.lastSendResult, result);
  await writeJson(statePath, nextState);
  return formatSendResult(result, nextState.evidence.lastSendResult);
}

async function commandTest(config) {
  const statePath = path.join(config.stateDir, STATE_FILE);
  const state = await requireRunningState(statePath);
  const health = await checkAllHealth(state.endpoints);
  const sendResultPath = state.evidence?.lastSendResult;
  if (!sendResultPath) {
    throw new Error("xcm-test requires prior xcm-send evidence. Run make xcm-send after setting CARTOGRAPHER_LOCAL_CALL.");
  }
  const result = await readJson(sendResultPath);
  return [
    "Local XCM evidence:",
    formatStatus({ statePath, pid: state.pid, processAlive: true, endpoints: state.endpoints, health }),
    `send evidence: ${sendResultPath}`,
    `tx hash: ${result.txHash ?? "(unknown)"}`,
    `finalized ok: ${String(result.ok ?? false)}`,
  ].join("\n");
}

async function commandCli(config, env = process.env) {
  const state = await requireRunningState(path.join(config.stateDir, STATE_FILE));
  const result = spawnSync(process.execPath, buildCliTraceArgs(state, env), { cwd: config.cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`xcm-cli failed with status ${result.status ?? "unknown"}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function parseParachainConfigs(env) {
  if (env.CARTOGRAPHER_LOCAL_PARACHAIN_CONFIGS === undefined) return defaultLocalConfig.parachainConfigs;
  const parsed = splitConfigList(env.CARTOGRAPHER_LOCAL_PARACHAIN_CONFIGS);
  if (parsed.length === 0) throw new Error("CARTOGRAPHER_LOCAL_PARACHAIN_CONFIGS must include at least one parachain config.");
  return parsed;
}

function resolveOptional(cwd, value, fallback) {
  if (value === "") return "";
  return resolveFrom(cwd, value || fallback);
}

function resolveFrom(cwd, target) {
  return path.isAbsolute(target) ? target : path.join(cwd, target);
}

async function assertConfigFiles(config) {
  const files = [config.relayConfig, ...config.parachainConfigs].filter(Boolean);
  const missing = [];
  for (const file of files) {
    if (!(await fileExists(file))) missing.push(file);
  }
  if (missing.length > 0) {
    throw new Error(`Chopsticks config missing: ${missing.join(", ")}.`);
  }
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function requireState(statePath) {
  const state = await readState(statePath);
  if (!state) throw new Error(`Local Chopsticks state is missing at ${statePath}. Run make infra-up first.`);
  return state;
}

async function requireRunningState(statePath) {
  const state = await requireState(statePath);
  if (!isPidAlive(state.pid)) throw new Error(`Tracked Chopsticks process ${state.pid} is not alive. Run make infra-status.`);
  return state;
}

async function readState(statePath) {
  try {
    return await readJson(statePath);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForHealthy(endpoints, timeoutMs) {
  const start = Date.now();
  let last = await checkAllHealth(endpoints);
  while (!allHealthy(last) && Date.now() - start < timeoutMs) {
    await delay(1_000);
    last = await checkAllHealth(endpoints);
  }
  return last;
}

async function checkAllHealth(endpoints) {
  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([label, endpoint]) => [label, await checkHealth(endpoint)]),
  );
  return Object.fromEntries(entries);
}

async function checkHealth(endpoint) {
  try {
    assertLocalEndpoint("health", endpoint);
    const request = buildHealthRequest(endpoint);
    const response = await fetch(request.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.body),
    });
    const payload = await response.json();
    if (payload.error) return { ok: false, detail: payload.error.message || "RPC error" };
    return { ok: true, detail: `header ${payload.result?.hash ?? "ok"}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function allHealthy(health) {
  return Object.values(health).every((item) => item.ok);
}

async function killTrackedProcess(pid) {
  if (!Number.isInteger(pid)) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
  await delay(1_500);
  if (!isPidAlive(pid)) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gitSha(cwd) {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

async function submitLocalCall(plan, timeoutMs) {
  const [{ Binary, createClient }, { getWsProvider }, { withPolkadotSdkCompat }] = await Promise.all([
    import("polkadot-api"),
    import("polkadot-api/ws-provider"),
    import("polkadot-api/polkadot-sdk-compat"),
  ]);
  const client = createClient(withPolkadotSdkCompat(getWsProvider(plan.rpcUrl)));
  try {
    const api = client.getUnsafeApi();
    const tx = await api.txFromCallData(Binary.fromHex(plan.call));
    const signer = await createLocalSigner(plan.accountUri);
    const result = await withTimeout(tx.signAndSubmit(signer), timeoutMs, "xcm-send timed out waiting for finalized local tx.");
    return normalizeTxResult(result, plan);
  } finally {
    client.destroy();
  }
}

async function createLocalSigner(accountUri) {
  const [{ sr25519CreateDerive }, helpers, { getPolkadotSigner }] = await Promise.all([
    import("@polkadot-labs/hdkd"),
    import("@polkadot-labs/hdkd-helpers"),
    import("polkadot-api/signer"),
  ]);
  const phrase = process.env.CARTOGRAPHER_LOCAL_DEV_PHRASE || helpers.DEV_PHRASE;
  const miniSecret = helpers.entropyToMiniSecret(helpers.mnemonicToEntropy(phrase));
  const keyPair = sr25519CreateDerive(miniSecret)(accountUri);
  return getPolkadotSigner(keyPair.publicKey, "Sr25519", keyPair.sign);
}

async function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTxResult(result, plan) {
  return {
    ok: Boolean(result.ok),
    txHash: result.txHash,
    block: result.block,
    dispatchError: result.dispatchError,
    events: result.events,
    rpcUrl: plan.rpcUrl,
    accountUri: plan.accountUri,
    call: plan.call,
    submittedAt: new Date().toISOString(),
  };
}

function formatSendResult(result, evidencePath) {
  return [
    "Local XCM transaction submitted to Chopsticks.",
    `tx hash: ${result.txHash ?? "(unknown)"}`,
    `ok: ${String(result.ok)}`,
    `block: ${result.block?.hash ?? result.block ?? "(unknown)"}`,
    `events: ${Array.isArray(result.events) ? result.events.length : "unknown"}`,
    `evidence: ${evidencePath}`,
  ].join("\n");
}

async function main(argv, env = process.env) {
  const command = argv[2];
  const config = makeLocalConfig(env, process.cwd());
  const commands = {
    up: () => commandUp(config, env),
    status: () => commandStatus(config),
    down: () => commandDown(config),
    send: () => commandSend(config, env),
    test: () => commandTest(config),
    cli: () => commandCli(config, env),
  };
  const run = commands[command];
  if (!run) {
    throw new Error("Usage: node scripts/cartographer-local-xcm.mjs up|status|down|send|test|cli");
  }
  return run();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv)
    .then((message) => {
      if (message) process.stdout.write(`${message}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
