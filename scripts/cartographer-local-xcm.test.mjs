import { EventEmitter } from "node:events";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertLocalEndpoint,
  assertHealthyStatus,
  assertSuccessfulTx,
  buildDefaultXcmTransferArgs,
  buildChopsticksArgs,
  buildCliTraceArgs,
  checkHealth,
  buildHealthRequest,
  buildRunPaths,
  buildSendPlan,
  defaultLocalConfig,
  deriveLocalAccountAddress,
  formatStatus,
  httpUrlFromRpc,
  isCallHex,
  jsonStringify,
  makeLocalConfig,
  splitConfigList,
  watchBootProcess,
} from "./cartographer-local-xcm.mjs";

const cwd = "/repo/cartographer";

describe("cartographer local XCM helpers", () => {
  it("keeps the default Chopsticks XCM topology deterministic", () => {
    const config = makeLocalConfig({}, cwd);

    expect(config.relayConfig).toBe(path.join(cwd, "infra/chopsticks/westend.yml"));
    expect(config.parachainConfigs).toEqual([
      path.join(cwd, "infra/chopsticks/westend-asset-hub.yml"),
      path.join(cwd, "infra/chopsticks/westend-people.yml"),
    ]);
    expect(config.endpoints).toEqual({
      origin: "ws://127.0.0.1:8000",
      destination: "ws://127.0.0.1:8001",
      relay: "ws://127.0.0.1:8002",
    });
  });

  it("accepts explicit relay, parachain, state, evidence, and endpoint overrides", () => {
    const config = makeLocalConfig(
      {
        CARTOGRAPHER_LOCAL_RELAY_CONFIG: "infra/custom/relay.yml",
        CARTOGRAPHER_LOCAL_PARACHAIN_CONFIGS: "infra/custom/a.yml, infra/custom/b.yml",
        CARTOGRAPHER_LOCAL_STATE_DIR: ".state",
        CARTOGRAPHER_LOCAL_EVIDENCE_DIR: "_evidence/xcm",
        CARTOGRAPHER_LOCAL_ORIGIN_RPC: "ws://localhost:9100",
        CARTOGRAPHER_LOCAL_DEST_RPC: "ws://127.0.0.1:9101",
        CARTOGRAPHER_LOCAL_RELAY_RPC: "ws://127.0.0.1:9102",
      },
      cwd,
    );

    expect(config.stateDir).toBe(path.join(cwd, ".state"));
    expect(config.evidenceDir).toBe(path.join(cwd, "_evidence/xcm"));
    expect(config.relayConfig).toBe(path.join(cwd, "infra/custom/relay.yml"));
    expect(config.parachainConfigs).toEqual([
      path.join(cwd, "infra/custom/a.yml"),
      path.join(cwd, "infra/custom/b.yml"),
    ]);
    expect(config.endpoints.origin).toBe("ws://localhost:9100");
  });

  it("splits comma-separated config lists and rejects an empty parachain list", () => {
    expect(splitConfigList(" a.yml, b.yml ,, c.yml ")).toEqual(["a.yml", "b.yml", "c.yml"]);
    expect(() => makeLocalConfig({ CARTOGRAPHER_LOCAL_PARACHAIN_CONFIGS: " , " }, cwd)).toThrow(
      "CARTOGRAPHER_LOCAL_PARACHAIN_CONFIGS must include at least one parachain config.",
    );
  });

  it("builds the pinned Chopsticks xcm argv without reordering parachains", () => {
    const args = buildChopsticksArgs({
      relayConfig: "/relay.yml",
      parachainConfigs: ["/asset.yml", "/people.yml"],
    });

    expect(args).toEqual([
      "exec",
      "chopsticks",
      "xcm",
      "--relaychain",
      "/relay.yml",
      "--parachain",
      "/asset.yml",
      "--parachain",
      "/people.yml",
    ]);
  });

  it("omits relaychain args when the relay config is intentionally empty", () => {
    expect(buildChopsticksArgs({ relayConfig: "", parachainConfigs: ["/a.yml"] })).toEqual([
      "exec",
      "chopsticks",
      "xcm",
      "--parachain",
      "/a.yml",
    ]);
  });

  it.each(["0x00", "0x0102", "0xabcdef"])("accepts even-length call hex %s", (hex) => {
    expect(isCallHex(hex)).toBe(true);
  });

  it.each(["", "0x", "0x1", "0xzz", "0102"])("rejects invalid call hex %s", (hex) => {
    expect(isCallHex(hex)).toBe(false);
  });

  it("rejects non-local RPC endpoints for local send and CLI workflows", () => {
    expect(() => assertLocalEndpoint("origin", "wss://asset-hub-westend.example")).toThrow(
      "origin endpoint must be local for this workflow.",
    );
  });

  it("rejects local RPC endpoints that are not WebSocket URLs", () => {
    expect(() => assertLocalEndpoint("origin", "http://127.0.0.1:8000")).toThrow(
      "origin endpoint must use ws:// or wss:// for this workflow.",
    );
  });

  it("converts ws endpoints to HTTP JSON-RPC endpoints for health checks", () => {
    expect(httpUrlFromRpc("ws://127.0.0.1:8000")).toBe("http://127.0.0.1:8000/");
    expect(httpUrlFromRpc("wss://localhost:9443/path")).toBe("https://localhost:9443/path");
  });

  it("builds a simple chain_getHeader health request", () => {
    expect(buildHealthRequest("ws://127.0.0.1:8000")).toEqual({
      url: "http://127.0.0.1:8000/",
      body: { id: 1, jsonrpc: "2.0", method: "chain_getHeader", params: [] },
    });
  });

  it("bounds hanging health checks with a per-request timeout", async () => {
    const health = await checkHealth("ws://127.0.0.1:8000", 1, (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    );

    expect(health).toEqual({ ok: false, detail: "aborted" });
  });

  it("fails local evidence validation when any RPC health check is bad", () => {
    expect(() =>
      assertHealthyStatus({
        statePath: "/state/current.json",
        pid: 123,
        processAlive: true,
        endpoints: defaultLocalConfig.endpoints,
        health: {
          origin: { ok: true, detail: "header ok" },
          destination: { ok: false, detail: "ECONNREFUSED" },
          relay: { ok: true, detail: "header ok" },
        },
      }),
    ).toThrow("Local XCM health check failed.");
  });

  it("builds local send input from a configured call and running state", () => {
    const plan = buildSendPlan(
      {
        pid: 123,
        endpoints: defaultLocalConfig.endpoints,
        evidence: { runDir: "/runs/one" },
      },
      {
        CARTOGRAPHER_LOCAL_CALL: "0x0102",
        CARTOGRAPHER_LOCAL_ACCOUNT: "//Bob",
      },
    );

    expect(plan).toEqual({
      rpcUrl: "ws://127.0.0.1:8000",
      destinationRpcUrl: "ws://127.0.0.1:8001",
      accountUri: "//Bob",
      call: "0x0102",
      callSource: "env",
      evidenceDir: "/runs/one",
      amount: 10_000_000_000n,
    });
  });

  it("plans default SCALE call generation when call material is absent", () => {
    const plan = buildSendPlan(
      { pid: 123, endpoints: defaultLocalConfig.endpoints, evidence: { runDir: "/runs/one" } },
      {},
    );

    expect(plan).toEqual({
      rpcUrl: "ws://127.0.0.1:8000",
      destinationRpcUrl: "ws://127.0.0.1:8001",
      accountUri: "//Alice",
      call: undefined,
      callSource: "generated-default",
      evidenceDir: "/runs/one",
      amount: 10_000_000_000n,
    });
  });

  it("uses saved local call evidence before generating another default call", () => {
    const plan = buildSendPlan(
      {
        pid: 123,
        endpoints: defaultLocalConfig.endpoints,
        evidence: { runDir: "/runs/one", lastCall: "0x0102" },
      },
      {},
    );

    expect(plan.call).toBe("0x0102");
    expect(plan.callSource).toBe("state");
  });

  it("rejects invalid local XCM amount overrides", () => {
    expect(() =>
      buildSendPlan(
        { pid: 123, endpoints: defaultLocalConfig.endpoints, evidence: { runDir: "/runs/one" } },
        { CARTOGRAPHER_LOCAL_XCM_AMOUNT: "1.5" },
      ),
    ).toThrow("CARTOGRAPHER_LOCAL_XCM_AMOUNT must be a non-negative integer.");
  });

  it("builds default PolkadotXcm limited_teleport_assets arguments", () => {
    const recipientPublicKey = new Uint8Array(32);
    recipientPublicKey[0] = 212;

    const args = buildDefaultXcmTransferArgs({
      destinationParaId: 1004,
      recipientPublicKey,
      amount: 10_000_000_000n,
    });

    expect(args.dest.value).toEqual({
      parents: 1,
      interior: { type: "X1", value: { type: "Parachain", value: 1004 } },
    });
    expect(args.beneficiary.value.interior.value.value.id.asHex()).toBe(
      "0xd400000000000000000000000000000000000000000000000000000000000000",
    );
    expect(args.assets.value[0].id).toEqual({ parents: 1, interior: { type: "Here" } });
    expect(args.assets.value[0].fun).toEqual({ type: "Fungible", value: 10_000_000_000n });
    expect(args.fee_asset_item).toBe(0);
    expect(args.weight_limit).toEqual({ type: "Unlimited" });
  });

  it("serializes bigint values in evidence JSON", () => {
    expect(jsonStringify({ amount: 10_000_000_000n })).toBe('{\n  "amount": "10000000000"\n}');
  });

  it("fails local transaction validation when finalized result is not ok", () => {
    expect(() =>
      assertSuccessfulTx(
        { ok: false, dispatchError: { type: "Module", value: { pallet: "PolkadotXcm" } } },
        "Local XCM transaction submitted to Chopsticks.",
      ),
    ).toThrow("dispatch error");
  });

  it("turns early Chopsticks process exit into a boot failure", async () => {
    const child = new EventEmitter();
    const watcher = watchBootProcess(child);

    child.emit("exit", 1, null);

    await expect(watcher.failure).rejects.toThrow("Chopsticks exited before local RPCs became healthy");
    watcher.cleanup();
  });

  it("derives the local dev account SS58 address for DryRunApi origins", () => {
    expect(deriveLocalAccountAddress("//Alice")).toBe("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
  });

  it("builds Cartographer CLI args against the local origin endpoint and saved call", () => {
    const args = buildCliTraceArgs(
      {
        endpoints: defaultLocalConfig.endpoints,
        evidence: { lastCall: "0x0102" },
      },
      { CARTOGRAPHER_LOCAL_ACCOUNT: "//Alice", CARTOGRAPHER_LOCAL_FORMAT: "human" },
    );

    expect(args).toEqual([
      "dist/cli/index.js",
      "trace",
      "--rpc",
      "ws://127.0.0.1:8000",
      "--origin",
      "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
      "--call",
      "0x0102",
      "--format",
      "human",
    ]);
  });

  it("creates stable run paths from injected time and git sha", () => {
    expect(buildRunPaths("/repo", "2026-06-29T10:11:12.000Z", "88ebcf9")).toEqual({
      runId: "20260629T101112Z-88ebcf9",
      runDir: path.join("/repo", "runs/20260629T101112Z-88ebcf9"),
      stdoutLog: path.join("/repo", "runs/20260629T101112Z-88ebcf9/chopsticks.stdout.log"),
      stderrLog: path.join("/repo", "runs/20260629T101112Z-88ebcf9/chopsticks.stderr.log"),
    });
  });

  it("formats status with process and RPC health evidence", () => {
    const status = formatStatus({
      statePath: "/state/current.json",
      pid: 321,
      processAlive: true,
      endpoints: defaultLocalConfig.endpoints,
      health: {
        origin: { ok: true, detail: "header 0xabc" },
        destination: { ok: false, detail: "ECONNREFUSED" },
        relay: { ok: true, detail: "header 0xdef" },
      },
    });

    expect(status).toContain("state: /state/current.json");
    expect(status).toContain("pid: 321 (alive)");
    expect(status).toContain("origin: ws://127.0.0.1:8000 health=ok header 0xabc");
    expect(status).toContain("destination: ws://127.0.0.1:8001 health=fail ECONNREFUSED");
  });
});
