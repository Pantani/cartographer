import { describe, expect, it, vi } from "vitest";
import { location } from "../types/index.js";
import { createEndpointMetadataCache, createStaticRegistry, locationKey } from "./index.js";

describe("registry", () => {
  it("resolves endpoints by structural Location equality", () => {
    const destination = location(1, { X1: { Parachain: 1000 } });
    const registry = createStaticRegistry([
      { location: destination, rpc: "wss://asset-hub.example", name: "Asset Hub" },
    ]);

    expect(registry.resolve(location(1, { X1: { Parachain: 1000 } }))).toEqual({
      location: destination,
      rpc: "wss://asset-hub.example",
      name: "Asset Hub",
    });
    expect(registry.resolve(location(1, { X1: { Parachain: 2000 } }))).toBeUndefined();
  });

  it("builds a stable location key from normalized structure", () => {
    expect(locationKey(location(0, "Here"))).toBe('{"parents":0,"interior":"Here"}');
  });

  it("builds a stable location key when junction data contains bigint", () => {
    expect(locationKey(location(1, { X1: { Parachain: 2000n } }))).toBe(
      '{"parents":1,"interior":{"X1":{"Parachain":{"$bigint":"2000"}}}}',
    );
  });

  it("caches endpoint metadata per RPC URL", async () => {
    const cache = createEndpointMetadataCache<string>();
    const load = vi.fn(() => Promise.resolve("metadata"));

    await expect(cache.getOrLoad("wss://asset-hub.example", load)).resolves.toBe("metadata");
    await expect(cache.getOrLoad("wss://asset-hub.example", load)).resolves.toBe("metadata");

    expect(load).toHaveBeenCalledOnce();
  });
});
