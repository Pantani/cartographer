import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const pipeline = vi.hoisted(() => ({
  trace: vi.fn(),
  render: vi.fn(),
}));

vi.mock("../orchestrator/index.js", () => ({ trace: pipeline.trace }));
vi.mock("../report/index.js", () => ({ render: pipeline.render }));

import { buildProgram, runCli } from "./command.js";
import type { TraceRequest, TraceResult } from "../types/index.js";

/** Parse user-level args (no node/script prefix) through a program with an injected runner. */
async function run(
  args: readonly string[],
  runner: (req: TraceRequest) => Promise<string>,
): Promise<void> {
  await buildProgram(runner).parseAsync(Array.from(args), { from: "user" });
}

async function runTraceAction(
  raw: Readonly<Record<string, unknown>>,
  runner: (req: TraceRequest) => Promise<string> = () => Promise.resolve(""),
): Promise<void> {
  const command = buildProgram(runner).commands[0] as unknown as {
    readonly _actionHandler: (args: readonly unknown[]) => Promise<void>;
    readonly setOptionValue: (key: string, value: unknown) => void;
  };
  for (const [key, value] of Object.entries(raw)) {
    command.setOptionValue(key, value);
  }
  await command._actionHandler([]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cartographer trace — request building", () => {
  it("builds a TraceRequest from flags and prints the rendered output", async () => {
    const seen: TraceRequest[] = [];
    const runner = (req: TraceRequest): Promise<string> => {
      seen.push(req);
      return Promise.resolve("RENDERED");
    };
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await run(["trace", "--rpc", "wss://x.test", "--origin", "//Alice", "--call", "0x0100", "--format", "json"], runner);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      rpc: "wss://x.test",
      origin: { kind: "account", account: "//Alice" },
      resultXcmVersion: 4,
      format: "json",
      call: "0x0100",
    });
    expect(out).toHaveBeenCalledWith("RENDERED\n");
  });

  it("defaults --format to human", async () => {
    let captured: TraceRequest | undefined;
    const runner = (req: TraceRequest): Promise<string> => {
      captured = req;
      return Promise.resolve("");
    };
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await run(["trace", "--rpc", "wss://x.test", "--origin", "//Alice", "--call", "0x01"], runner);

    expect(captured?.format).toBe("human");
  });
});

describe("cartographer trace — CLI runner", () => {
  it("parses process-style argv through the default trace/render pipeline", async () => {
    const result: TraceResult = { hops: [], diagnosis: { status: "success" } };
    pipeline.trace.mockResolvedValue(result);
    pipeline.render.mockReturnValue("PIPELINE");
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runCli(["node", "cartographer", "trace", "--rpc", "wss://x.test", "--origin", "//Alice", "--call", "0x0100"]);

    expect(pipeline.trace).toHaveBeenCalledWith({
      rpc: "wss://x.test",
      origin: { kind: "account", account: "//Alice" },
      resultXcmVersion: 4,
      format: "human",
      call: "0x0100",
    });
    expect(pipeline.render).toHaveBeenCalledWith(result, "human");
    expect(out).toHaveBeenCalledWith("PIPELINE\n");
  });
});

describe("cartographer trace — validation", () => {
  const noop = (): Promise<string> => Promise.resolve("");

  it("rejects when neither --call nor --xcm is given", async () => {
    await expect(run(["trace", "--rpc", "wss://x", "--origin", "//Alice"], noop)).rejects.toThrow(
      /exactly one of --call or --xcm/,
    );
  });

  it("rejects when both --call and --xcm are given", async () => {
    await expect(
      run(["trace", "--rpc", "wss://x", "--origin", "//Alice", "--call", "0x01", "--xcm", "p.json"], noop),
    ).rejects.toThrow(/exactly one of --call or --xcm/);
  });

  it("rejects the unsupported --xcm path", async () => {
    await expect(
      run(["trace", "--rpc", "wss://x", "--origin", "//Alice", "--xcm", "p.json"], noop),
    ).rejects.toThrow(/not supported/i);
  });

  it("rejects a non-hex --call", async () => {
    await expect(
      run(["trace", "--rpc", "wss://x", "--origin", "//Alice", "--call", "deadbeef"], noop),
    ).rejects.toThrow(/0x-prefixed/);
  });

  it("rejects a --call with non-hex characters after the prefix", async () => {
    await expect(
      run(["trace", "--rpc", "wss://x", "--origin", "//Alice", "--call", "0xzz"], noop),
    ).rejects.toThrow(/hex/);
  });

  it("rejects a --call that does not contain complete bytes", async () => {
    await expect(
      run(["trace", "--rpc", "wss://x", "--origin", "//Alice", "--call", "0x1"], noop),
    ).rejects.toThrow(/even-length/);
  });

  it("rejects an unknown --format", async () => {
    await expect(
      run(["trace", "--rpc", "wss://x", "--origin", "//Alice", "--call", "0x01", "--format", "yaml"], noop),
    ).rejects.toThrow(/Unknown --format/);
  });

  it("rejects malformed commander option bags defensively", async () => {
    await expect(runTraceAction({ origin: "//Alice", call: "0x01" })).rejects.toThrow(/--rpc/);
  });

  it("defaults a non-string internal format value to human", async () => {
    let captured: TraceRequest | undefined;

    await runTraceAction(
      { rpc: "wss://x.test", origin: "//Alice", call: "0x01", format: 4 },
      (request) => {
        captured = request;
        return Promise.resolve("");
      },
    );

    expect(captured?.format).toBe("human");
  });
});
