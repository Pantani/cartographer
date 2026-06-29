import { afterEach, describe, expect, it, vi } from "vitest";

const command = vi.hoisted(() => ({
  runCli: vi.fn(),
}));

vi.mock("./command.js", () => ({ runCli: command.runCli }));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

async function importEntrypoint(): Promise<void> {
  vi.resetModules();
  await import("./index.js");
  await Promise.resolve();
}

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  command.runCli.mockReset();
  vi.restoreAllMocks();
});

describe("CLI entrypoint", () => {
  it("passes process argv to runCli", async () => {
    process.argv = ["node", "cartographer", "trace"];
    command.runCli.mockResolvedValue(undefined);

    await importEntrypoint();

    expect(command.runCli).toHaveBeenCalledWith(process.argv);
  });

  it("prints Error rejections and marks the process as failed", async () => {
    process.argv = ["node", "cartographer", "trace"];
    command.runCli.mockRejectedValue(new Error("boom"));
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await importEntrypoint();

    expect(err).toHaveBeenCalledWith("cartographer: boom\n");
    expect(process.exitCode).toBe(1);
  });

  it("stringifies non-Error rejections before printing", async () => {
    process.argv = ["node", "cartographer", "trace"];
    command.runCli.mockRejectedValue("plain failure");
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await importEntrypoint();

    expect(err).toHaveBeenCalledWith("cartographer: plain failure\n");
    expect(process.exitCode).toBe(1);
  });
});
