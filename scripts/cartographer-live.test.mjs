import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildTraceArgs,
  clientEnvNames,
  findMissingEnv,
  fullEnvNames,
  formatMissingEnvMessage,
  main,
} from "./cartographer-live.mjs";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cartographer live command helpers", () => {
  it("finds missing env vars for the client live dry-run", () => {
    const env = {
      CARTOGRAPHER_IT_RPC: "wss://example",
      CARTOGRAPHER_IT_ACCOUNT: "5Example",
    };

    expect(findMissingEnv(clientEnvNames, env)).toEqual(["CARTOGRAPHER_IT_CALL"]);
  });

  it("rejects unchanged placeholder values for the client live dry-run", () => {
    const env = {
      CARTOGRAPHER_IT_RPC: "wss://asset-hub-polkadot-rpc.example",
      CARTOGRAPHER_IT_ACCOUNT: "5...",
      CARTOGRAPHER_IT_CALL: "0x...",
    };

    expect(findMissingEnv(clientEnvNames, env)).toEqual([
      "CARTOGRAPHER_IT_RPC",
      "CARTOGRAPHER_IT_ACCOUNT",
      "CARTOGRAPHER_IT_CALL",
    ]);
  });

  it.each(["deadbeef", "0xzz", "0x1", "0x"])("rejects invalid live call hex '%s'", (call) => {
    const env = {
      CARTOGRAPHER_IT_RPC: "wss://example",
      CARTOGRAPHER_IT_ACCOUNT: "5Example",
      CARTOGRAPHER_IT_CALL: call,
    };

    expect(findMissingEnv(clientEnvNames, env)).toEqual(["CARTOGRAPHER_IT_CALL"]);
  });

  it("requires full live trace inputs for the full integration suite", () => {
    const env = {
      CARTOGRAPHER_IT_RPC: "wss://example",
      CARTOGRAPHER_IT_ACCOUNT: "5Example",
      CARTOGRAPHER_IT_CALL: "0x0102",
      CARTOGRAPHER_IT_CALL_OK: "0x0304",
    };

    expect(findMissingEnv(fullEnvNames, env)).toEqual(["CARTOGRAPHER_IT_CALL_FAIL"]);
  });

  it("formats a command-ready missing env message", () => {
    expect(formatMissingEnvMessage("xcm:test", ["CARTOGRAPHER_IT_CALL"])).toBe(
      "xcm:test requires real values for CARTOGRAPHER_IT_CALL. Export real values and rerun the command.",
    );
  });

  it("builds CLI args from live env and prefers CARTOGRAPHER_IT_CALL_OK", () => {
    const args = buildTraceArgs({
      CARTOGRAPHER_IT_RPC: "wss://example",
      CARTOGRAPHER_IT_ACCOUNT: "5Example",
      CARTOGRAPHER_IT_CALL: "0x0102",
      CARTOGRAPHER_IT_CALL_OK: "0x0304",
    });

    expect(args).toEqual([
      "dist/cli/index.js",
      "trace",
      "--rpc",
      "wss://example",
      "--origin",
      "5Example",
      "--call",
      "0x0304",
      "--format",
      "json",
    ]);
  });

  it("builds raw-XCM CLI args when a raw XCM file is configured", () => {
    const args = buildTraceArgs({
      CARTOGRAPHER_IT_RPC: "wss://example",
      CARTOGRAPHER_IT_XCM_ORIGIN: "{\"parents\":1,\"interior\":\"Here\"}",
      CARTOGRAPHER_IT_XCM_FILE: "./program.json",
      CARTOGRAPHER_IT_FORMAT: "human",
    });

    expect(args).toEqual([
      "dist/cli/index.js",
      "trace",
      "--rpc",
      "wss://example",
      "--origin",
      "{\"parents\":1,\"interior\":\"Here\"}",
      "--xcm",
      "./program.json",
      "--format",
      "human",
    ]);
  });

  it("appends static registry and max-depth args when configured", () => {
    const args = buildTraceArgs({
      CARTOGRAPHER_IT_RPC: "wss://example",
      CARTOGRAPHER_IT_ACCOUNT: "5Example",
      CARTOGRAPHER_IT_CALL: "0x0102",
      CARTOGRAPHER_IT_REGISTRY: "./registry.json",
      CARTOGRAPHER_IT_MAX_DEPTH: "4",
    });

    expect(args).toEqual([
      "dist/cli/index.js",
      "trace",
      "--rpc",
      "wss://example",
      "--origin",
      "5Example",
      "--call",
      "0x0102",
      "--registry",
      "./registry.json",
      "--max-depth",
      "4",
      "--format",
      "json",
    ]);
  });

  it("rejects raw-XCM CLI args when the location origin is missing", () => {
    expect(() =>
      buildTraceArgs({
        CARTOGRAPHER_IT_RPC: "wss://example",
        CARTOGRAPHER_IT_XCM_FILE: "./program.json",
      }),
    ).toThrow("xcm:cli requires real values for CARTOGRAPHER_IT_XCM_ORIGIN.");
  });

  it("rejects invalid live max depth values", () => {
    expect(() =>
      buildTraceArgs({
        CARTOGRAPHER_IT_RPC: "wss://example",
        CARTOGRAPHER_IT_ACCOUNT: "5Example",
        CARTOGRAPHER_IT_CALL: "0x0102",
        CARTOGRAPHER_IT_MAX_DEPTH: "0",
      }),
    ).toThrow("CARTOGRAPHER_IT_MAX_DEPTH");
  });

  it("falls back to CARTOGRAPHER_IT_CALL when CARTOGRAPHER_IT_CALL_OK is absent", () => {
    const args = buildTraceArgs({
      CARTOGRAPHER_IT_RPC: "wss://example",
      CARTOGRAPHER_IT_ACCOUNT: "5Example",
      CARTOGRAPHER_IT_CALL: "0x0102",
    });

    expect(args).toContain("0x0102");
  });

  it("falls back to CARTOGRAPHER_IT_CALL when CARTOGRAPHER_IT_CALL_OK is unchanged placeholder text", () => {
    const args = buildTraceArgs({
      CARTOGRAPHER_IT_RPC: "wss://example",
      CARTOGRAPHER_IT_ACCOUNT: "5Example",
      CARTOGRAPHER_IT_CALL: "0x0102",
      CARTOGRAPHER_IT_CALL_OK: "0x...",
    });

    expect(args).toContain("0x0102");
  });

  it("falls back to CARTOGRAPHER_IT_CALL when CARTOGRAPHER_IT_CALL_OK is invalid hex", () => {
    const args = buildTraceArgs({
      CARTOGRAPHER_IT_RPC: "wss://example",
      CARTOGRAPHER_IT_ACCOUNT: "5Example",
      CARTOGRAPHER_IT_CALL: "0x0102",
      CARTOGRAPHER_IT_CALL_OK: "0x1",
    });

    expect(args).toContain("0x0102");
  });

  it("rejects CLI args when no live call is configured", () => {
    expect(() =>
      buildTraceArgs({
        CARTOGRAPHER_IT_RPC: "wss://example",
        CARTOGRAPHER_IT_ACCOUNT: "5Example",
      }),
    ).toThrow("xcm:cli requires real values for CARTOGRAPHER_IT_CALL_OK or CARTOGRAPHER_IT_CALL.");
  });

  it("rejects CLI args when all configured calls are invalid hex", () => {
    expect(() =>
      buildTraceArgs({
        CARTOGRAPHER_IT_RPC: "wss://example",
        CARTOGRAPHER_IT_ACCOUNT: "5Example",
        CARTOGRAPHER_IT_CALL: "0x1",
      }),
    ).toThrow("xcm:cli requires real values for CARTOGRAPHER_IT_CALL_OK or CARTOGRAPHER_IT_CALL.");
  });

  it("dispatches check-cli without exiting when raw-XCM env is configured", () => {
    vi.stubEnv("CARTOGRAPHER_IT_RPC", "wss://example");
    vi.stubEnv("CARTOGRAPHER_IT_XCM_ORIGIN", "{\"parents\":1,\"interior\":\"Here\"}");
    vi.stubEnv("CARTOGRAPHER_IT_XCM_FILE", "./program.json");
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("unexpected exit");
    });

    main(["node", "cartographer-live.mjs", "check-cli"]);

    expect(exit).not.toHaveBeenCalled();
  });

  it("dispatches check-cli failures through injected runtime", () => {
    const runtime = {
      env: { CARTOGRAPHER_IT_RPC: "wss://example" },
      error: vi.fn(),
      exit: vi.fn((code) => {
        throw new Error(`exit:${String(code)}`);
      }),
      spawnSync: vi.fn(),
      execPath: "/node",
    };

    expect(() => main(["node", "cartographer-live.mjs", "check-cli"], runtime)).toThrow("exit:1");
    expect(runtime.error).toHaveBeenCalledWith(
      "xcm:cli requires real values for CARTOGRAPHER_IT_ACCOUNT, CARTOGRAPHER_IT_CALL_OK or CARTOGRAPHER_IT_CALL. Export real values and rerun the command.",
    );
  });

  it("dispatches check-client through injected runtime env", () => {
    const runtime = {
      env: {
        CARTOGRAPHER_IT_RPC: "wss://example",
        CARTOGRAPHER_IT_ACCOUNT: "5Example",
        CARTOGRAPHER_IT_CALL: "0x0102",
      },
      error: vi.fn(),
      exit: vi.fn((code) => {
        throw new Error(`exit:${String(code)}`);
      }),
      spawnSync: vi.fn(),
      execPath: "/node",
    };

    main(["node", "cartographer-live.mjs", "check-client"], runtime);

    expect(runtime.error).not.toHaveBeenCalled();
    expect(runtime.exit).not.toHaveBeenCalled();
  });

  it("dispatches check-full missing-env failures through injected runtime", () => {
    const runtime = {
      env: {
        CARTOGRAPHER_IT_RPC: "wss://example",
        CARTOGRAPHER_IT_ACCOUNT: "5Example",
        CARTOGRAPHER_IT_CALL: "0x0102",
      },
      error: vi.fn(),
      exit: vi.fn((code) => {
        throw new Error(`exit:${String(code)}`);
      }),
      spawnSync: vi.fn(),
      execPath: "/node",
    };

    expect(() => main(["node", "cartographer-live.mjs", "check-full"], runtime)).toThrow("exit:1");
    expect(runtime.error).toHaveBeenCalledWith(
      "test:live requires real values for CARTOGRAPHER_IT_CALL_OK, CARTOGRAPHER_IT_CALL_FAIL. Export real values and rerun the command.",
    );
  });

  it("runs the built CLI through injected spawn and exits with the child status", () => {
    const runtime = {
      env: {
        CARTOGRAPHER_IT_RPC: "wss://example",
        CARTOGRAPHER_IT_ACCOUNT: "5Example",
        CARTOGRAPHER_IT_CALL: "0x0102",
      },
      error: vi.fn(),
      exit: vi.fn((code) => {
        throw new Error(`exit:${String(code)}`);
      }),
      spawnSync: vi.fn(() => ({ status: 0 })),
      execPath: "/node",
    };

    expect(() => main(["node", "cartographer-live.mjs", "run-cli"], runtime)).toThrow("exit:0");
    expect(runtime.spawnSync).toHaveBeenCalledWith(
      "/node",
      [
        "dist/cli/index.js",
        "trace",
        "--rpc",
        "wss://example",
        "--origin",
        "5Example",
        "--call",
        "0x0102",
        "--format",
        "json",
      ],
      { stdio: "inherit" },
    );
  });

  it("runs the raw-XCM CLI handoff with static registry args through injected spawn", () => {
    const runtime = {
      env: {
        CARTOGRAPHER_IT_RPC: "wss://example",
        CARTOGRAPHER_IT_XCM_ORIGIN: "{\"parents\":1,\"interior\":\"Here\"}",
        CARTOGRAPHER_IT_XCM_FILE: "./program.json",
        CARTOGRAPHER_IT_REGISTRY: "./registry.json",
        CARTOGRAPHER_IT_MAX_DEPTH: "4",
        CARTOGRAPHER_IT_FORMAT: "human",
      },
      error: vi.fn(),
      exit: vi.fn((code) => {
        throw new Error(`exit:${String(code)}`);
      }),
      spawnSync: vi.fn(() => ({ status: 0 })),
      execPath: "/node",
    };

    expect(() => main(["node", "cartographer-live.mjs", "run-cli"], runtime)).toThrow("exit:0");
    expect(runtime.spawnSync).toHaveBeenCalledWith(
      "/node",
      [
        "dist/cli/index.js",
        "trace",
        "--rpc",
        "wss://example",
        "--origin",
        "{\"parents\":1,\"interior\":\"Here\"}",
        "--xcm",
        "./program.json",
        "--registry",
        "./registry.json",
        "--max-depth",
        "4",
        "--format",
        "human",
      ],
      { stdio: "inherit" },
    );
  });

  it("reports run-cli spawn errors through injected runtime", () => {
    const runtime = {
      env: {
        CARTOGRAPHER_IT_RPC: "wss://example",
        CARTOGRAPHER_IT_ACCOUNT: "5Example",
        CARTOGRAPHER_IT_CALL: "0x0102",
      },
      error: vi.fn(),
      exit: vi.fn((code) => {
        throw new Error(`exit:${String(code)}`);
      }),
      spawnSync: vi.fn(() => {
        throw new Error("spawn failed");
      }),
      execPath: "/node",
    };

    expect(() => main(["node", "cartographer-live.mjs", "run-cli"], runtime)).toThrow("exit:1");
    expect(runtime.error).toHaveBeenCalledWith("spawn failed");
  });

  it("prints usage and exits for unknown commands", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit:${String(code)}`);
    });

    expect(() => main(["node", "cartographer-live.mjs", "wat"])).toThrow("exit:1");
    expect(error).toHaveBeenCalledWith(
      "Usage: node scripts/cartographer-live.mjs check-cli|check-client|check-full|run-cli",
    );
  });
});
