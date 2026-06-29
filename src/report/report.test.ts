import { describe, it, expect } from "vitest";
import { render, renderHuman, renderJson } from "./index.js";
import {
  failureTrace,
  forwardedTrace,
  successTrace,
  unknownTrace,
} from "./__fixtures__/traces.js";

const fixtures = [
  ["success", successTrace],
  ["failure", failureTrace],
  ["unknown", unknownTrace],
  ["forwarded", forwardedTrace],
] as const;

describe("renderHuman", () => {
  for (const [name, trace] of fixtures) {
    it(`renders the ${name} trace deterministically`, () => {
      expect(renderHuman(trace)).toMatchSnapshot();
    });
  }

  it("surfaces events and forwarded XCM details for a single hop", () => {
    const rendered = renderHuman(forwardedTrace);
    expect(rendered).toContain("Events:");
    expect(rendered).toContain("PolkadotXcm.Sent {\"count\":\"1\"}");
    expect(rendered).toContain("Forwarded XCM:");
    expect(rendered).toContain("destination {\"parents\":1,\"interior\":{\"X1\":{\"Parachain\":\"2000\"}}}");
    expect(rendered).toContain("message 0: v4 ReserveAssetDeposited, ClearOrigin");
  });
});

describe("renderJson", () => {
  for (const [name, trace] of fixtures) {
    it(`renders the ${name} trace deterministically`, () => {
      expect(renderJson(trace)).toMatchSnapshot();
    });
  }

  it("encodes bigint as a tagged decimal string and round-trips", () => {
    const parsed = JSON.parse(renderJson(successTrace)) as Record<string, unknown>;
    const hops = parsed["hops"] as ReadonlyArray<Record<string, unknown>>;
    const fees = hops[0]?.["fees"] as Record<string, unknown>;
    expect(fees["fee"]).toEqual({ $bigint: "12345678900" });
  });
});

describe("render dispatcher", () => {
  it("matches renderHuman for the human format", () => {
    expect(render(successTrace, "human")).toBe(renderHuman(successTrace));
  });

  it("matches renderJson for the json format", () => {
    expect(render(successTrace, "json")).toBe(renderJson(successTrace));
  });
});
