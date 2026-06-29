import { describe, it, expect } from "vitest";
import { diagnoseWithSeedRules } from "./engine.js";
import { errorText, isFailure } from "./match.js";
import { diagnosisContext, executionError } from "../types/index.js";
import {
  successEffects,
  barrierBlockedEffects,
  versionMismatchEffects,
  untrustedReserveEffects,
  insufficientWeightEffects,
  feesUnpayableEffects,
  barrierAndFeeOverlapEffects,
  versionAndTrapOverlapEffects,
  assetTrappedEffects,
  unrecognizedFailureEffects,
} from "./__fixtures__/effects.js";

const diag = (effects: Parameters<typeof diagnosisContext>[0]) =>
  diagnoseWithSeedRules(diagnosisContext(effects));

describe("success path", () => {
  it("yields status 'success' for a clean dry-run (not 'unknown')", () => {
    const d = diag(successEffects);
    expect(d.status).toBe("success");
    expect(d.ruleId).toBe("success");
  });

  it("does NOT classify a clean dry-run as any failure", () => {
    expect(diag(successEffects).status).not.toBe("failure");
  });

  it("reports the top-level execution result through the shared matcher", () => {
    expect(isFailure(diagnosisContext(successEffects))).toBe(false);
    expect(isFailure(diagnosisContext(barrierBlockedEffects))).toBe(true);
  });

  it("builds searchable error text when detail is absent", () => {
    expect(errorText(executionError("Barrier"))).toBe("barrier ");
  });
});

describe("unknown path", () => {
  it("returns 'unknown' for an unrecognized failure, never crashing", () => {
    const d = diag(unrecognizedFailureEffects);
    expect(d.status).toBe("unknown");
    expect(d.ruleId).toBeUndefined();
    expect(d.rootCause).toBeUndefined();
    expect(d.explanation).toBeDefined();
  });

  it("does not over-match the unrecognized failure to a seed rule", () => {
    expect(diag(unrecognizedFailureEffects).ruleId).toBeUndefined();
  });
});

describe("barrier-blocked", () => {
  it("matches the barrier fixture with a failure diagnosis", () => {
    const d = diag(barrierBlockedEffects);
    expect(d.status).toBe("failure");
    expect(d.ruleId).toBe("barrier-blocked");
    expect(d.suggestions?.length ?? 0).toBeGreaterThan(0);
  });

  it("does NOT match a fee-failure fixture", () => {
    expect(diag(feesUnpayableEffects).ruleId).not.toBe("barrier-blocked");
  });
});

describe("version-mismatch", () => {
  it("matches the version fixture and surfaces the source version", () => {
    const d = diag(versionMismatchEffects);
    expect(d.ruleId).toBe("version-mismatch");
    expect(d.explanation).toContain("v2");
  });

  it("does NOT match the barrier fixture", () => {
    expect(diag(barrierBlockedEffects).ruleId).not.toBe("version-mismatch");
  });
});

describe("untrusted-reserve", () => {
  it("matches the reserve-trust fixture", () => {
    expect(diag(untrustedReserveEffects).ruleId).toBe("untrusted-reserve");
  });

  it("does NOT match the weight fixture", () => {
    expect(diag(insufficientWeightEffects).ruleId).not.toBe("untrusted-reserve");
  });
});

describe("insufficient-weight", () => {
  it("matches the weight fixture", () => {
    expect(diag(insufficientWeightEffects).ruleId).toBe("insufficient-weight");
  });

  it("does NOT match the reserve fixture", () => {
    expect(diag(untrustedReserveEffects).ruleId).not.toBe("insufficient-weight");
  });
});

describe("fees-unpayable", () => {
  it("matches the fee fixture", () => {
    expect(diag(feesUnpayableEffects).ruleId).toBe("fees-unpayable");
  });

  it("does NOT match the success fixture", () => {
    expect(diag(successEffects).ruleId).not.toBe("fees-unpayable");
  });
});

describe("asset-trapped", () => {
  it("matches a top-level success that still trapped assets", () => {
    const d = diag(assetTrappedEffects);
    expect(d.status).toBe("failure");
    expect(d.ruleId).toBe("asset-trapped");
  });

  it("does NOT fire on a clean success with no trap event", () => {
    expect(diag(successEffects).ruleId).not.toBe("asset-trapped");
  });
});

describe("rule ordering", () => {
  it("keeps barrier-blocked ahead of fees-unpayable when synthetic signals overlap", () => {
    const d = diag(barrierAndFeeOverlapEffects);
    expect(d.status).toBe("failure");
    expect(d.ruleId).toBe("barrier-blocked");
  });

  it("keeps error-keyed rules ahead of asset-trapped when a trap event also exists", () => {
    const d = diag(versionAndTrapOverlapEffects);
    expect(d.status).toBe("failure");
    expect(d.ruleId).toBe("version-mismatch");
  });
});
