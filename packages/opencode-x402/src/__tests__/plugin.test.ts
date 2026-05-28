import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("@x402-plugins/core", () => ({
  createX402Fetch: vi.fn(),
  EvmSigner: vi.fn(),
}));

import { createOpenCodeX402Hooks } from "../index.js";
import plugin from "../index.js";
import { createX402Fetch, EvmSigner } from "@x402-plugins/core";

describe("createOpenCodeX402Hooks", () => {
  let mockFetch: Mock<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.mocked(createX402Fetch).mockReturnValue(mockFetch);
  });

  function mockSigner(ready: boolean) {
    vi.mocked(EvmSigner).mockImplementation(function () {
      return {
        address: "0xABCD1234ABCD1234ABCD1234ABCD1234ABCD1234",
        chainId: "eip155:8453",
        isReady: vi.fn().mockResolvedValue(ready),
      } as unknown as InstanceType<typeof EvmSigner>;
    });
  }

  it("exports expected shape (name, version, onProviderRequest, toolExecuteBefore, fetch)", () => {
    mockSigner(true);
    const hooks = createOpenCodeX402Hooks({
      gatewayBaseUrl: "http://127.0.0.1:8080",
      enabled: true,
    });
    expect(hooks.name).toBe("@x402-plugins/opencode-x402");
    expect(hooks.version).toBe("0.1.0");
    expect(typeof hooks.onProviderRequest).toBe("function");
    expect(typeof hooks.toolExecuteBefore).toBe("function");
    expect(hooks.fetch).toBe(mockFetch);
  });

  it("onProviderRequest injects x402 fetch wrapper when enabled", async () => {
    mockSigner(true);
    const hooks = createOpenCodeX402Hooks({
      gatewayBaseUrl: "http://127.0.0.1:8080",
      enabled: true,
    });
    const init: RequestInit = { method: "POST", headers: { "Content-Type": "application/json" } };
    const result = await hooks.onProviderRequest(init);
    expect(result).toEqual({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-x402-plugin": "opencode-x402/0.1.0",
      },
    });
    expect(hooks.fetch).toBe(mockFetch);
  });

  it("onProviderRequest passes through when enabled is false", async () => {
    mockSigner(true);
    const hooks = createOpenCodeX402Hooks({
      gatewayBaseUrl: "http://127.0.0.1:8080",
      enabled: false,
    });
    const init: RequestInit = { method: "GET", headers: { Authorization: "Bearer token" } };
    const result = await hooks.onProviderRequest(init);
    expect(result).toEqual(init);
    expect(result.headers).toEqual({ Authorization: "Bearer token" });
  });

  it("toolExecuteBefore blocks when signer not ready", async () => {
    mockSigner(false);
    const hooks = createOpenCodeX402Hooks({
      gatewayBaseUrl: "http://127.0.0.1:8080",
      enabled: true,
    });
    await expect(
      hooks.toolExecuteBefore({ tool: "bash" }),
    ).rejects.toThrow("x402: connect wallet before paid tools");
  });

  it("toolExecuteBefore allows when signer is ready", async () => {
    mockSigner(true);
    const hooks = createOpenCodeX402Hooks({
      gatewayBaseUrl: "http://127.0.0.1:8080",
      enabled: true,
    });
    await expect(
      hooks.toolExecuteBefore({ tool: "bash", estimatedCost: "0.01 USDC" }),
    ).resolves.toBeUndefined();
  });
});

describe("plugin default export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createX402Fetch).mockReturnValue(
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
    vi.mocked(EvmSigner).mockImplementation(function () {
      return {
        address: "0xABCD1234ABCD1234ABCD1234ABCD1234ABCD1234",
        chainId: "eip155:8453",
        isReady: vi.fn().mockResolvedValue(true),
      } as unknown as InstanceType<typeof EvmSigner>;
    });
  });

  it("returns a plugin object with expected shape", () => {
    const p = plugin();
    expect(p.name).toBe("@x402-plugins/opencode-x402");
    expect(p.version).toBe("0.1.0");
    expect(typeof p.onProviderRequest).toBe("function");
    expect(typeof p.toolExecuteBefore).toBe("function");
  });
});
