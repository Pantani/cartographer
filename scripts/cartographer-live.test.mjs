import { describe, expect, it } from "vitest";

import {
  buildTraceArgs,
  clientEnvNames,
  findMissingEnv,
  fullEnvNames,
  formatMissingEnvMessage,
} from "./cartographer-live.mjs";

describe("cartographer live command helpers", () => {
  it("finds missing env vars for the client live dry-run", () => {
    const env = {
      CARTOGRAPHER_IT_RPC: "wss://example",
      CARTOGRAPHER_IT_ACCOUNT: "5Example",
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
      "xcm:test requires CARTOGRAPHER_IT_CALL. Export the missing values and rerun the command.",
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

  it("falls back to CARTOGRAPHER_IT_CALL when CARTOGRAPHER_IT_CALL_OK is absent", () => {
    const args = buildTraceArgs({
      CARTOGRAPHER_IT_RPC: "wss://example",
      CARTOGRAPHER_IT_ACCOUNT: "5Example",
      CARTOGRAPHER_IT_CALL: "0x0102",
    });

    expect(args).toContain("0x0102");
  });

  it("rejects CLI args when no live call is configured", () => {
    expect(() =>
      buildTraceArgs({
        CARTOGRAPHER_IT_RPC: "wss://example",
        CARTOGRAPHER_IT_ACCOUNT: "5Example",
      }),
    ).toThrow("xcm:cli requires CARTOGRAPHER_IT_CALL_OK or CARTOGRAPHER_IT_CALL.");
  });
});
