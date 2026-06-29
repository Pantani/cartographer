// Integration test (opt-in, behind `pnpm test:it`). Runs the real CLI command
// wiring through the orchestrator and live client. It is skipped unless the
// operator supplies endpoint, account, and encoded call data.

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "./command.js";

const ENV = {
  rpc: "CARTOGRAPHER_IT_RPC",
  account: "CARTOGRAPHER_IT_ACCOUNT",
  callOk: "CARTOGRAPHER_IT_CALL_OK",
} as const;

const RPC = process.env[ENV.rpc];
const ACCOUNT = process.env[ENV.account];
const HAPPY_CALL = process.env[ENV.callOk];
const REQUIRED_INPUTS = [
  [ENV.rpc, RPC],
  [ENV.account, ACCOUNT],
  [ENV.callOk, HAPPY_CALL],
] as const;
const MISSING_INPUTS = REQUIRED_INPUTS.filter(([, value]) => value === undefined).map(([name]) => name);
const ready = MISSING_INPUTS.length === 0;

afterEach(() => {
  vi.restoreAllMocks();
});

describe.skipIf(ready)("cartographer trace CLI (live integration setup)", () => {
  it(`skips live CLI tests until required env is set: ${MISSING_INPUTS.join(", ")}`, () => {
    expect(MISSING_INPUTS).not.toHaveLength(0);
  });
});

describe.skipIf(!ready)("cartographer trace CLI (live integration)", () => {
  it(
    "runs the real trace command and renders JSON for a succeeding call",
    async () => {
      const output: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
        output.push(String(chunk));
        return true;
      });

      await buildProgram().parseAsync(
        [
          "trace",
          "--rpc",
          requireEnv(RPC, ENV.rpc),
          "--origin",
          requireEnv(ACCOUNT, ENV.account),
          "--call",
          requireEnv(HAPPY_CALL, ENV.callOk),
          "--format",
          "json",
        ],
        { from: "user" },
      );

      const result = parseRenderedTrace(output.join(""));
      expect(result.hops).toHaveLength(1);
      expect(result.diagnosis.status).toBe("success");
    },
    60_000,
  );
});

interface RenderedTrace {
  readonly hops: readonly unknown[];
  readonly diagnosis: {
    readonly status: unknown;
  };
}

function requireEnv(value: string | undefined, name: string): string {
  if (value !== undefined) return value;
  throw new Error(`${name} is required for CLI integration. Missing: ${MISSING_INPUTS.join(", ")}.`);
}

function parseRenderedTrace(output: string): RenderedTrace {
  const parsed = JSON.parse(output) as RenderedTrace;
  if (!Array.isArray(parsed.hops)) throw new Error("CLI JSON output did not include a hops array.");
  return parsed;
}
