import { describe, it, expect } from "vitest";
import {
  location,
  weight,
  assetId,
  feeEstimate,
  xcmInstruction,
  xcmProgram,
  forwardedXcm,
  normalizedEvent,
  executionError,
  executionSuccess,
  executionFailure,
  dryRunEffects,
  diagnosisContext,
  successDiagnosis,
  failureDiagnosis,
  unknownDiagnosis,
  chainRef,
  hop,
  traceResult,
  singleHopTrace,
  accountOrigin,
  locationOrigin,
} from "./index.js";

describe("location", () => {
  it("defaults interior to Here", () => {
    expect(location(1)).toEqual({ parents: 1, interior: "Here" });
  });
  it("keeps a provided interior", () => {
    expect(location(0, { X1: { Parachain: 1000 } }).interior).toEqual({
      X1: { Parachain: 1000 },
    });
  });
});

describe("assets", () => {
  it("weight carries bigint refTime/proofSize", () => {
    expect(weight(1_000n, 64n)).toEqual({ refTime: 1_000n, proofSize: 64n });
  });
  it("assetId omits absent optional keys", () => {
    const a = assetId({ symbol: "DOT" });
    expect(a).toEqual({ symbol: "DOT" });
    expect(a).not.toHaveProperty("location");
    expect(a).not.toHaveProperty("decimals");
  });
  it("feeEstimate omits weight when absent and keeps it when present", () => {
    expect(feeEstimate({ fee: 5n, asset: assetId({ symbol: "DOT" }) })).not.toHaveProperty(
      "weight",
    );
    const withW = feeEstimate({ fee: 5n, asset: assetId({}), weight: weight(1n, 2n) });
    expect(withW.weight).toEqual({ refTime: 1n, proofSize: 2n });
  });
});

describe("xcm", () => {
  it("xcmInstruction omits args when absent", () => {
    expect(xcmInstruction("BuyExecution")).toEqual({ kind: "BuyExecution" });
    expect(xcmInstruction("Transact", { call: "0x01" }).args).toEqual({ call: "0x01" });
  });
  it("xcmProgram defaults to an empty instruction list", () => {
    expect(xcmProgram(4)).toEqual({ version: 4, instructions: [] });
  });
  it("forwardedXcm defaults to empty messages", () => {
    expect(forwardedXcm(location(1)).messages).toEqual([]);
  });
});

describe("effects", () => {
  it("normalizedEvent defaults data to an empty object", () => {
    expect(normalizedEvent("PolkadotXcm", "Sent")).toEqual({
      pallet: "PolkadotXcm",
      name: "Sent",
      data: {},
    });
  });
  it("executionError omits absent optional fields", () => {
    expect(executionError("Barrier")).toEqual({ type: "Barrier" });
    expect(executionError("Barrier", { detail: "blocked", raw: { code: 1 } })).toEqual({
      type: "Barrier",
      detail: "blocked",
      raw: { code: 1 },
    });
  });
  it("executionSuccess / executionFailure tag the union", () => {
    expect(executionSuccess()).toEqual({ kind: "success" });
    const f = executionFailure(executionError("TooExpensive"));
    expect(f).toEqual({ kind: "failure", error: { type: "TooExpensive" } });
  });
  it("dryRunEffects defaults events/forwardedXcms and omits localXcm", () => {
    const e = dryRunEffects({ executionResult: executionSuccess(), xcmVersion: 4 });
    expect(e.events).toEqual([]);
    expect(e.forwardedXcms).toEqual([]);
    expect(e).not.toHaveProperty("localXcm");
  });
  it("dryRunEffects keeps a provided localXcm", () => {
    const e = dryRunEffects({
      executionResult: executionSuccess(),
      xcmVersion: 5,
      localXcm: xcmProgram(5, [xcmInstruction("WithdrawAsset")]),
    });
    expect(e.localXcm?.instructions[0]?.kind).toBe("WithdrawAsset");
  });
});

describe("diagnosis", () => {
  it("diagnosisContext mirrors events from effects (invariant)", () => {
    const ev = normalizedEvent("Balances", "Withdraw");
    const effects = dryRunEffects({
      executionResult: executionSuccess(),
      xcmVersion: 4,
      events: [ev],
    });
    const ctx = diagnosisContext(effects, feeEstimate({ fee: 1n, asset: assetId({}) }));
    expect(ctx.events).toBe(effects.events);
    expect(ctx.fees?.fee).toBe(1n);
  });
  it("diagnosisContext omits fees when absent", () => {
    const effects = dryRunEffects({ executionResult: executionSuccess(), xcmVersion: 4 });
    expect(diagnosisContext(effects)).not.toHaveProperty("fees");
  });
  it("successDiagnosis is status success", () => {
    expect(successDiagnosis()).toEqual({ status: "success" });
    expect(successDiagnosis({ ruleId: "ok", explanation: "fine" })).toEqual({
      status: "success",
      ruleId: "ok",
      explanation: "fine",
    });
  });
  it("failureDiagnosis requires id + rootCause and carries suggestions", () => {
    expect(
      failureDiagnosis({
        ruleId: "barrier-blocked",
        rootCause: "Entry barrier rejected the message",
        suggestions: ["Check origin trust"],
      }),
    ).toEqual({
      status: "failure",
      ruleId: "barrier-blocked",
      rootCause: "Entry barrier rejected the message",
      suggestions: ["Check origin trust"],
    });
  });
  it("failureDiagnosis omits optional explanation and suggestions when absent", () => {
    expect(failureDiagnosis({ ruleId: "unknown", rootCause: "No matching rule" })).toEqual({
      status: "failure",
      ruleId: "unknown",
      rootCause: "No matching rule",
    });
  });
  it("unknownDiagnosis has a default explanation and no rootCause", () => {
    const u = unknownDiagnosis();
    expect(u.status).toBe("unknown");
    expect(u.explanation).toContain("No diagnostic rule matched");
    expect(u).not.toHaveProperty("rootCause");
  });
  it("unknownDiagnosis carries explicit explanation and suggestions", () => {
    expect(unknownDiagnosis({ explanation: "Inspect manually", suggestions: ["Capture live evidence"] })).toEqual({
      status: "unknown",
      explanation: "Inspect manually",
      suggestions: ["Capture live evidence"],
    });
  });
});

describe("trace", () => {
  const sampleHop = hop({
    index: 0,
    chain: chainRef({ name: "Asset Hub" }),
    effects: dryRunEffects({ executionResult: executionSuccess(), xcmVersion: 4 }),
    diagnosis: successDiagnosis(),
    fees: feeEstimate({ fee: 7n, asset: assetId({ symbol: "DOT" }) }),
  });

  it("chainRef omits absent fields", () => {
    expect(chainRef()).toEqual({});
    expect(chainRef({ name: "Relay" })).toEqual({ name: "Relay" });
    expect(chainRef({ location: location(1) })).toEqual({ location: { parents: 1, interior: "Here" } });
  });
  it("hop omits fees when absent", () => {
    const h = hop({
      index: 1,
      chain: chainRef(),
      effects: dryRunEffects({ executionResult: executionSuccess(), xcmVersion: 4 }),
      diagnosis: successDiagnosis(),
    });
    expect(h).not.toHaveProperty("fees");
  });
  it("traceResult carries hops + headline diagnosis", () => {
    const r = traceResult({ hops: [sampleHop], diagnosis: sampleHop.diagnosis });
    expect(r.hops).toHaveLength(1);
    expect(r.diagnosis.status).toBe("success");
  });
  it("traceResult carries trace-level fees", () => {
    const r = traceResult({
      hops: [sampleHop],
      diagnosis: sampleHop.diagnosis,
      fees: feeEstimate({ fee: 3n, asset: assetId({}) }),
    });
    expect(r.fees?.fee).toBe(3n);
  });
  it("singleHopTrace lifts the hop's diagnosis and fees", () => {
    const r = singleHopTrace(sampleHop);
    expect(r.hops[0]).toBe(sampleHop);
    expect(r.diagnosis).toBe(sampleHop.diagnosis);
    expect(r.fees?.fee).toBe(7n);
  });
});

describe("request origins", () => {
  it("accountOrigin tags an account", () => {
    expect(accountOrigin("//Alice")).toEqual({ kind: "account", account: "//Alice" });
  });
  it("locationOrigin tags a location", () => {
    expect(locationOrigin(location(1))).toEqual({
      kind: "location",
      location: { parents: 1, interior: "Here" },
    });
  });
});

describe("runtime-empty modules", () => {
  it("loads placeholder/type-only modules without exported runtime state", async () => {
    await expect(import("../registry/index.js").then(Object.keys)).resolves.toEqual([]);
    await expect(import("./json.js").then(Object.keys)).resolves.toEqual([]);
  });
});
