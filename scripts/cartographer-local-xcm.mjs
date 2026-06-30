import { spawn, spawnSync } from "node:child_process";
import { openSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy, ss58Address } from "@polkadot-labs/hdkd-helpers";
import { Binary } from "polkadot-api";

const DEV_ACCOUNT = "//Alice";
const STATE_FILE = "current.json";
const DEFAULT_BOOT_TIMEOUT_MS = 120_000;
const DEFAULT_SEND_TIMEOUT_MS = 120_000;
const DEFAULT_HEALTH_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_XCM_AMOUNT = 10_000_000_000n;
const DEFAULT_SS58_PREFIX = 42;
const CALL_HEX_PATTERN = /^0x(?:[0-9a-fA-F]{2})+$/;
const NON_NEGATIVE_INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/;
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
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`${label} endpoint must use ws:// or wss:// for this workflow.`);
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
  assertLocalEndpoint("origin", state.endpoints.origin);
  assertLocalEndpoint("destination", state.endpoints.destination);
  const call = selectLocalCall(env.CARTOGRAPHER_LOCAL_CALL, state.evidence?.lastCall);
  return {
    rpcUrl: state.endpoints.origin,
    destinationRpcUrl: state.endpoints.destination,
    accountUri: env.CARTOGRAPHER_LOCAL_ACCOUNT || DEV_ACCOUNT,
    call: call.value,
    callSource: call.source,
    evidenceDir: state.evidence.runDir,
    amount: parseLocalXcmAmount(env.CARTOGRAPHER_LOCAL_XCM_AMOUNT),
  };
}

/** Build runtime-typed XCM transfer args for the pinned local Asset Hub to People topology. */
export function buildDefaultXcmTransferArgs({ destinationParaId, recipientPublicKey, amount }) {
  return {
    dest: versionedXcm(location(1, { type: "X1", value: { type: "Parachain", value: destinationParaId } })),
    beneficiary: versionedXcm(
      location(0, {
        type: "X1",
        value: { type: "AccountId32", value: { network: undefined, id: Binary.fromBytes(recipientPublicKey) } },
      }),
    ),
    assets: versionedXcm([
      {
        id: location(1, { type: "Here" }),
        fun: { type: "Fungible", value: amount },
      },
    ]),
    fee_asset_item: 0,
    weight_limit: { type: "Unlimited" },
  };
}

/** Serialize local evidence without losing bigint values returned by runtime APIs. */
export function jsonStringify(value) {
  return JSON.stringify(value, jsonReplacer, 2);
}

/** Derive the SS58 account string required by DryRunApi from a local dev SURI. */
export function deriveLocalAccountAddress(accountUri, phrase = process.env.CARTOGRAPHER_LOCAL_DEV_PHRASE || DEV_PHRASE) {
  return ss58Address(createLocalKeyPair(accountUri, phrase).publicKey, DEFAULT_SS58_PREFIX);
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
    deriveLocalAccountAddress(env.CARTOGRAPHER_LOCAL_ACCOUNT || DEV_ACCOUNT),
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

/** Throw when a local evidence status contains any failed RPC health check. */
export function assertHealthyStatus(status) {
  if (allHealthy(status.health)) return;
  throw new Error(`Local XCM health check failed.\n${formatStatus(status)}`);
}

/** Throw when a finalized local transaction result is not successful. */
export function assertSuccessfulTx(result, summary) {
  if (result.ok === true) return;
  throw new Error(`${summary}\nLocal XCM transaction did not finalize successfully.${formatDispatchError(result.dispatchError)}`);
}

function formatDispatchError(dispatchError) {
  if (dispatchError === undefined) return "";
  return `\ndispatch error: ${jsonStringify(dispatchError)}`;
}

/** Watch Chopsticks boot and reject if the child cannot spawn or exits too early. */
export function watchBootProcess(child) {
  let onError = () => {};
  let onExit = () => {};
  const failure = new Promise((_, reject) => {
    onError = (error) => reject(new Error(`Failed to start Chopsticks: ${error.message}`));
    onExit = (code, signal) =>
      reject(new Error(`Chopsticks exited before local RPCs became healthy (code ${code ?? "unknown"}, signal ${signal ?? "none"}).`));
    child.once("error", onError);
    child.once("exit", onExit);
  });
  return {
    failure,
    cleanup: () => {
      child.off("error", onError);
      child.off("exit", onExit);
    },
  };
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
  const bootWatch = watchBootProcess(child);
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
  const healthTimeoutMs = Number(env.CARTOGRAPHER_LOCAL_HEALTH_TIMEOUT_MS || DEFAULT_HEALTH_REQUEST_TIMEOUT_MS);
  let health;
  try {
    health = await Promise.race([waitForHealthy(config.endpoints, timeoutMs, healthTimeoutMs), bootWatch.failure]);
  } catch (error) {
    await cleanupBootFailure(statePath, state.pid);
    throw error;
  } finally {
    bootWatch.cleanup();
  }
  if (!allHealthy(health)) {
    await cleanupBootFailure(statePath, state.pid);
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
      lastCall: result.call,
      lastGeneratedCall: result.generatedCall,
      lastSendResult: path.join(plan.evidenceDir, "xcm-send-result.json"),
    },
  };
  await writeJson(nextState.evidence.lastSendResult, result);
  await writeJson(statePath, nextState);
  const summary = formatSendResult(result, nextState.evidence.lastSendResult);
  assertSuccessfulTx(result, summary);
  return summary;
}

async function commandTest(config) {
  const statePath = path.join(config.stateDir, STATE_FILE);
  const state = await requireRunningState(statePath);
  const health = await checkAllHealth(state.endpoints);
  const healthStatus = { statePath, pid: state.pid, processAlive: true, endpoints: state.endpoints, health };
  assertHealthyStatus(healthStatus);
  const sendResultPath = state.evidence?.lastSendResult;
  if (!sendResultPath) {
    throw new Error("xcm-test requires prior xcm-send evidence. Run make xcm-send first.");
  }
  const result = await readJson(sendResultPath);
  const lines = [
    "Local XCM evidence:",
    formatStatus(healthStatus),
    `send evidence: ${sendResultPath}`,
    `tx hash: ${result.txHash ?? "(unknown)"}`,
    `finalized ok: ${String(result.ok ?? false)}`,
  ];
  const summary = lines.join("\n");
  assertSuccessfulTx(result, summary);
  return summary;
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
  await fs.writeFile(file, `${jsonStringify(value)}\n`);
}

async function cleanupBootFailure(statePath, pid) {
  await killTrackedProcess(pid);
  await fs.rm(statePath, { force: true });
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

async function waitForHealthy(endpoints, timeoutMs, healthTimeoutMs = DEFAULT_HEALTH_REQUEST_TIMEOUT_MS) {
  const start = Date.now();
  let last = await checkAllHealth(endpoints, healthTimeoutMs);
  while (!allHealthy(last) && Date.now() - start < timeoutMs) {
    await delay(1_000);
    last = await checkAllHealth(endpoints, healthTimeoutMs);
  }
  return last;
}

async function checkAllHealth(endpoints, timeoutMs = DEFAULT_HEALTH_REQUEST_TIMEOUT_MS) {
  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([label, endpoint]) => [label, await checkHealth(endpoint, timeoutMs)]),
  );
  return Object.fromEntries(entries);
}

export async function checkHealth(endpoint, timeoutMs = DEFAULT_HEALTH_REQUEST_TIMEOUT_MS, fetchImpl = fetch) {
  try {
    assertLocalEndpoint("health", endpoint);
    const request = buildHealthRequest(endpoint);
    const response = await fetchHealth(request, timeoutMs, fetchImpl);
    const payload = await response.json();
    if (payload.error) return { ok: false, detail: payload.error.message || "RPC error" };
    return { ok: true, detail: `header ${payload.result?.hash ?? "ok"}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchHealth(request, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(request.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
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
  const prepared = await prepareLocalCall(plan);
  const [{ createClient }, { getWsProvider }, { withPolkadotSdkCompat }] = await Promise.all([
    import("polkadot-api"),
    import("polkadot-api/ws-provider"),
    import("polkadot-api/polkadot-sdk-compat"),
  ]);
  const client = createClient(withPolkadotSdkCompat(getWsProvider(prepared.rpcUrl)));
  try {
    const api = client.getUnsafeApi();
    const tx = await api.txFromCallData(Binary.fromHex(prepared.call));
    const signer = await createLocalSigner(prepared.accountUri);
    const result = await withTimeout(tx.signAndSubmit(signer), timeoutMs, "xcm-send timed out waiting for finalized local tx.");
    return normalizeTxResult(result, prepared);
  } finally {
    client.destroy();
  }
}

async function prepareLocalCall(plan) {
  if (plan.call) return plan;
  const generated = await generateDefaultLocalXcmCall(plan);
  return { ...plan, call: generated.call, generatedCall: generated.details };
}

async function generateDefaultLocalXcmCall(plan) {
  const [{ createClient }, { getWsProvider }, { withPolkadotSdkCompat }] = await Promise.all([
    import("polkadot-api"),
    import("polkadot-api/ws-provider"),
    import("polkadot-api/polkadot-sdk-compat"),
  ]);
  const destinationParaId = await readDestinationParaId(plan.destinationRpcUrl, {
    createClient,
    getWsProvider,
    withPolkadotSdkCompat,
  });
  const keyPair = await createLocalKeyPair(plan.accountUri);
  const client = createClient(withPolkadotSdkCompat(getWsProvider(plan.rpcUrl)));
  try {
    const api = client.getUnsafeApi();
    await api.runtimeToken;
    const args = buildDefaultXcmTransferArgs({
      destinationParaId,
      recipientPublicKey: keyPair.publicKey,
      amount: plan.amount,
    });
    const tx = api.tx.PolkadotXcm.limited_teleport_assets(args);
    const encoded = await tx.getEncodedData();
    return {
      call: encoded.asHex(),
      details: {
        pallet: "PolkadotXcm",
        method: "limited_teleport_assets",
        destinationParaId,
        recipientAccountUri: plan.accountUri,
        amount: plan.amount,
      },
    };
  } finally {
    client.destroy();
  }
}

async function readDestinationParaId(rpcUrl, sdk) {
  const client = sdk.createClient(sdk.withPolkadotSdkCompat(sdk.getWsProvider(rpcUrl)));
  try {
    const api = client.getUnsafeApi();
    await api.runtimeToken;
    return await api.query.ParachainInfo.ParachainId.getValue();
  } finally {
    client.destroy();
  }
}

async function createLocalSigner(accountUri) {
  const [keyPair, { getPolkadotSigner }] = await Promise.all([
    createLocalKeyPair(accountUri),
    import("polkadot-api/signer"),
  ]);
  return getPolkadotSigner(keyPair.publicKey, "Sr25519", keyPair.sign);
}

function createLocalKeyPair(accountUri, phrase = process.env.CARTOGRAPHER_LOCAL_DEV_PHRASE || DEV_PHRASE) {
  const miniSecret = entropyToMiniSecret(mnemonicToEntropy(phrase));
  return sr25519CreateDerive(miniSecret)(accountUri);
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
    callSource: plan.callSource,
    generatedCall: plan.generatedCall,
    amount: plan.amount,
    submittedAt: new Date().toISOString(),
  };
}

function formatSendResult(result, evidencePath) {
  return [
    "Local XCM transaction submitted to Chopsticks.",
    `call source: ${result.callSource}`,
    `tx hash: ${result.txHash ?? "(unknown)"}`,
    `ok: ${String(result.ok)}`,
    `block: ${result.block?.hash ?? result.block ?? "(unknown)"}`,
    `events: ${Array.isArray(result.events) ? result.events.length : "unknown"}`,
    `evidence: ${evidencePath}`,
  ].join("\n");
}

function selectLocalCall(envCall, stateCall) {
  if (envCall) return requireCallHex(envCall, "CARTOGRAPHER_LOCAL_CALL", "env");
  if (stateCall) return requireCallHex(stateCall, "saved local call", "state");
  return { value: undefined, source: "generated-default" };
}

function requireCallHex(value, label, source) {
  if (!isCallHex(value)) {
    throw new Error(`${label} must be a 0x-prefixed even-length SCALE call.`);
  }
  return { value, source };
}

function parseLocalXcmAmount(value) {
  if (value === undefined || value === "") return DEFAULT_XCM_AMOUNT;
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(value)) {
    throw new Error("CARTOGRAPHER_LOCAL_XCM_AMOUNT must be a non-negative integer.");
  }
  return BigInt(value);
}

function location(parents, interior) {
  return { parents, interior };
}

function versionedXcm(value) {
  return { type: "V4", value };
}

function jsonReplacer(_key, value) {
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value.asHex === "function") return value.asHex();
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString("hex")}`;
  return value;
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
