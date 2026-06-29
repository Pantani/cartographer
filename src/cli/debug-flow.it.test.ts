// Integration test (opt-in, behind `pnpm test:debug-flow`). This is the
// user-visible debug-flow proof: it drives the real CLI through the orchestrator,
// client, diagnostics, report, and JSON rendering. It is skipped unless the
// operator supplies endpoint, account, and both known-good and known-failing
// encoded call data.

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "./command.js";

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe.skipIf(ready)("cartographer debug flow (live integration setup)", () => {
  it(`skips live debug-flow tests until required env is set: ${MISSING_INPUTS.join(", ")}`, () => {
    expect(MISSING_INPUTS).not.toHaveLength(0);
  });
});

describe.skipIf(!ready)("cartographer debug flow (live integration)", () => {
  it(
    "runs a known-good call through the CLI and reports success",
    async () => {
      const result = await runTraceJson(requireEnv(HAPPY_CALL, ENV.callOk));

      expect(result.hops).not.toHaveLength(0);
      expect(result.diagnosis.status).toBe("success");
    },
    60_000,
  );

  it(
    "runs a known-failing call through the CLI and reports a root cause",
    async () => {
      const result = await runTraceJson(requireEnv(FAILING_CALL, ENV.callFail));

      expect(result.hops).not.toHaveLength(0);
      expect(result.diagnosis.status).toBe("failure");
      expect(result.diagnosis.rootCause).toBeTypeOf("string");
      expect(result.diagnosis.rootCause).not.toHaveLength(0);
    },
    60_000,
  );
});

interface RenderedTrace {
  readonly hops: readonly unknown[];
  readonly diagnosis: {
    readonly status: unknown;
    readonly rootCause?: unknown;
  };
}

async function runTraceJson(call: string): Promise<RenderedTrace> {
  const output: string[] = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
    output.push(String(chunk));
    return true;
  });

  try {
    await buildProgram().parseAsync(
      [
        "trace",
        "--rpc",
        requireEnv(RPC, ENV.rpc),
        "--origin",
        requireEnv(ACCOUNT, ENV.account),
        "--call",
        call,
        "--format",
        "json",
      ],
      { from: "user" },
    );
  } finally {
    stdout.mockRestore();
  }

  return parseRenderedTrace(output.join(""));
}

function requireEnv(value: string | undefined, name: string): string {
  if (value !== undefined) return value;
  throw new Error(`${name} is required for debug-flow integration. Missing: ${MISSING_INPUTS.join(", ")}.`);
}

function parseRenderedTrace(output: string): RenderedTrace {
  const parsed = JSON.parse(output) as RenderedTrace;
  if (!Array.isArray(parsed.hops)) throw new Error("CLI JSON output did not include a hops array.");
  if (!isRecord(parsed.diagnosis)) throw new Error("CLI JSON output did not include a diagnosis object.");
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
