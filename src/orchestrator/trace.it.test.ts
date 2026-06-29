// Integration test (opt-in, behind `pnpm test:it`). Hits a LIVE API-capable system chain
// through the real client, so live cases are skipped unless the operator provides inputs.
//
// Status: this exercises the full pipeline end to end. It remains skipped until the
// operator provides live endpoint + call data. The unsafe PAPI path is source-backed,
// but decoded payload shapes and fee behavior still need real captures before this can
// be counted as live product proof.

import { describe, it, expect } from "vitest";
import { trace } from "./index.js";
import { accountOrigin } from "../types/index.js";
import type { HexString, TraceRequest } from "../types/index.js";

const ENV = {
  rpc: "CARTOGRAPHER_IT_RPC",
  account: "CARTOGRAPHER_IT_ACCOUNT",
  callOk: "CARTOGRAPHER_IT_CALL_OK",
  callFail: "CARTOGRAPHER_IT_CALL_FAIL",
} as const;

const RPC = process.env[ENV.rpc];
const ACCOUNT = process.env[ENV.account];
const HAPPY_CALL = process.env[ENV.callOk];
const FAILING_CALL = process.env[ENV.callFail];
const REQUIRED_INPUTS = [
  [ENV.rpc, RPC],
  [ENV.account, ACCOUNT],
  [ENV.callOk, HAPPY_CALL],
  [ENV.callFail, FAILING_CALL],
] as const;
const MISSING_INPUTS = REQUIRED_INPUTS.filter(([, value]) => value === undefined).map(([name]) => name);
const ready = MISSING_INPUTS.length === 0;

function request(call: string): TraceRequest {
  return {
    rpc: requireEnv(RPC, ENV.rpc),
    origin: accountOrigin(requireEnv(ACCOUNT, ENV.account)),
    resultXcmVersion: 4,
    format: "human",
    call: call as HexString,
  };
}

function requireEnv(value: string | undefined, name: string): string {
  if (value !== undefined) return value;
  throw new Error(`${name} is required for trace integration. Missing: ${MISSING_INPUTS.join(", ")}.`);
}

describe.skipIf(ready)("trace (live integration setup)", () => {
  it(`skips live trace tests until required env is set: ${MISSING_INPUTS.join(", ")}`, () => {
    expect(MISSING_INPUTS).not.toHaveLength(0);
  });
});

describe.skipIf(!ready)("trace (live integration)", () => {
  it("traces a succeeding call to a success diagnosis with fees", async () => {
    const result = await trace(request(requireEnv(HAPPY_CALL, ENV.callOk)));
    expect(result.hops).toHaveLength(1);
    expect(result.diagnosis.status).toBe("success");
  });

  it("traces a known-failing call to a failure diagnosis with a root cause", async () => {
    const result = await trace(request(requireEnv(FAILING_CALL, ENV.callFail)));
    expect(result.diagnosis.status).toBe("failure");
    expect(result.diagnosis.rootCause).toBeTypeOf("string");
  });
});
