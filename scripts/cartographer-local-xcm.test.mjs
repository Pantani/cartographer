import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertLocalEndpoint,
  buildChopsticksArgs,
  buildCliTraceArgs,
  buildHealthRequest,
  buildRunPaths,
  buildSendPlan,
  defaultLocalConfig,
  formatStatus,
  httpUrlFromRpc,
  isCallHex,
  makeLocalConfig,
  splitConfigList,
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
      accountUri: "//Bob",
      call: "0x0102",
      evidenceDir: "/runs/one",
    });
  });

  it("fails send planning before any local submission when call material is absent", () => {
    expect(() =>
      buildSendPlan(
        { pid: 123, endpoints: defaultLocalConfig.endpoints, evidence: { runDir: "/runs/one" } },
        {},
      ),
    ).toThrow("xcm-send requires CARTOGRAPHER_LOCAL_CALL");
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
      "//Alice",
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
