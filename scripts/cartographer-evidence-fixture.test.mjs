import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extractEvidenceBlocks,
  main,
  renderDiagnosticsFixtureModule,
  resolveInputPath,
  toDiagnosticsFixture,
} from "./cartographer-evidence-fixture.mjs";

const tmpDirs = [];

const evidence = {
  label: "happy call",
  input: { account: "<ACCOUNT>", callBytes: 2, resultXcmVersion: 4 },
  rawDryRun: { success: true, value: {} },
  rawShape: { wrappedResult: true, topLevelKeys: ["success", "value"], effectsKeys: [] },
  normalizedEffects: {
    executionResult: { kind: "success" },
    xcmVersion: 4,
    events: [{ pallet: "PolkadotXcm", name: "Sent", data: { count: "1" } }],
    forwardedXcms: [],
  },
  fees: { kind: "skipped", reason: "dry_run_call returned no local_xcm" },
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeTempLog(contents) {
  const dir = await mkdtemp(join(tmpdir(), "cartographer-evidence-"));
  tmpDirs.push(dir);
  const file = join(dir, "evidence.log");
  await writeFile(file, contents, "utf8");
  return file;
}

describe("cartographer evidence fixture ingestion", () => {
  it("extracts pretty-printed CARTOGRAPHER_IT_EVIDENCE blocks from mixed logs", () => {
    const log = [
      "before",
      `CARTOGRAPHER_IT_EVIDENCE ${JSON.stringify(evidence, null, 2)}`,
      "after",
    ].join("\n");

    expect(extractEvidenceBlocks(log)).toEqual([evidence]);
  });

  it("keeps braces and escaped quotes inside evidence strings", () => {
    const weirdEvidence = {
      ...evidence,
      label: 'route with {"quoted"} braces',
      normalizedEffects: {
        ...evidence.normalizedEffects,
        executionResult: { kind: "success", detail: 'kept {"as text"} and "quoted"' },
      },
    };
    const log = `CARTOGRAPHER_IT_EVIDENCE ${JSON.stringify(weirdEvidence, null, 2)}`;

    expect(extractEvidenceBlocks(log)).toEqual([weirdEvidence]);
  });

  it("rejects evidence markers not followed by a JSON object", () => {
    expect(() => extractEvidenceBlocks("CARTOGRAPHER_IT_EVIDENCE []")).toThrow(/JSON object/);
  });

  it("rejects unterminated evidence JSON blocks", () => {
    expect(() => extractEvidenceBlocks('CARTOGRAPHER_IT_EVIDENCE {"normalizedEffects":')).toThrow(/Unterminated/);
  });

  it("converts one evidence envelope into a named diagnostics fixture", () => {
    expect(toDiagnosticsFixture(evidence)).toEqual({
      name: "happyCall",
      effects: evidence.normalizedEffects,
    });
  });

  it("renders a deterministic TypeScript fixture module", () => {
    expect(renderDiagnosticsFixtureModule([evidence])).toContain(
      'export const liveDryRunFixtures = {\n  happyCall: {\n    "executionResult": {',
    );
    expect(renderDiagnosticsFixtureModule([evidence])).toContain("satisfies Record<string, DryRunEffects>;");
  });

  it("writes a fixture module from an evidence log path", async () => {
    const file = await writeTempLog(`CARTOGRAPHER_IT_EVIDENCE ${JSON.stringify(evidence, null, 2)}`);
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await main(["node", "cartographer-evidence-fixture.mjs", file]);

    expect(write).toHaveBeenCalledWith(expect.stringContaining("happyCall"));
  });

  it("writes a fixture module from stdin when no evidence log path is provided", async () => {
    const write = vi.fn();

    await main(["node", "cartographer-evidence-fixture.mjs"], {
      readFile: async () => {
        throw new Error("readFile should not be called for stdin input.");
      },
      readStdin: async () => `CARTOGRAPHER_IT_EVIDENCE ${JSON.stringify(evidence, null, 2)}`,
      write,
    });

    expect(write).toHaveBeenCalledWith(expect.stringContaining("happyCall"));
  });

  it("rejects evidence without normalized effects", () => {
    expect(() => toDiagnosticsFixture({ label: "broken" })).toThrow(/normalizedEffects/i);
  });

  it("ignores package-manager separators when resolving the optional input path", () => {
    expect(resolveInputPath(["node", "script", "--", "evidence.log"])).toBe("evidence.log");
    expect(resolveInputPath(["node", "script", "--"])).toBeUndefined();
  });
});
