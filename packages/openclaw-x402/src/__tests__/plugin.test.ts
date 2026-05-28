import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("@x402-plugins/core", () => ({
  createX402Fetch: vi.fn(),
  EvmSigner: vi.fn(),
}));

import { registerOpenClawX402 } from "../index.js";
import createPlugin from "../index.js";
import { createX402Fetch, EvmSigner } from "@x402-plugins/core";

describe("registerOpenClawX402", () => {
  let registered: Record<string, unknown> | undefined;
  let log: Mock<(msg: string) => void>;
  let api: { registerProvider: Mock; log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    log = vi.fn();
    registered = undefined;
    api = {
      registerProvider: vi.fn((_def) => {
        registered = _def as Record<string, unknown>;
      }),
      log,
    };
    vi.mocked(EvmSigner).mockImplementation(function () {
      return {
        address: "0xABCD1234ABCD1234ABCD1234ABCD1234ABCD1234",
        chainId: "eip155:8453",
        isReady: vi.fn().mockResolvedValue(true),
      } as unknown as InstanceType<typeof EvmSigner>;
    });
  });

  it("calls registerProvider with correct provider id and config", () => {
    registerOpenClawX402(api, { gatewayBaseUrl: "http://127.0.0.1:8080" });
    expect(api.registerProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "x402-gateway",
        name: "X402 Gateway Provider",
      }),
    );
    expect(registered).toBeDefined();
    expect(registered!.config).toEqual({
      gatewayBaseUrl: "http://127.0.0.1:8080",
      protocolVersion: 2,
    });
    expect(typeof registered!.runAttempt).toBe("function");
  });

  it("runAttempt calls wrapped fetch", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "hello" } }] }),
        { status: 200 },
      ),
    );
    vi.mocked(createX402Fetch).mockReturnValue(fetchFn);
    registerOpenClawX402(api, { gatewayBaseUrl: "http://127.0.0.1:8080" });
    const runAttempt = registered!.runAttempt as (params: {
      prompt: string;
    }) => Promise<unknown>;
    await runAttempt({ prompt: "test" });
    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining('"stream":false'),
      }),
    );
  });

  it("runAttempt returns response in expected format", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hi there" } }],
        }),
        { status: 200 },
      ),
    );
    vi.mocked(createX402Fetch).mockReturnValue(fetchFn);
    registerOpenClawX402(api, { gatewayBaseUrl: "http://127.0.0.1:8080" });
    const runAttempt = registered!.runAttempt as (params: {
      prompt: string;
    }) => Promise<unknown>;
    const result = await runAttempt({ prompt: "hello" });
    expect(result).toEqual({
      text: "hi there",
      raw: { choices: [{ message: { content: "hi there" } }] },
    });
  });

  it("error path logs and throws appropriately", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    vi.mocked(createX402Fetch).mockReturnValue(fetchFn);
    registerOpenClawX402(api, { gatewayBaseUrl: "http://127.0.0.1:8080" });
    const runAttempt = registered!.runAttempt as (params: {
      prompt: string;
    }) => Promise<unknown>;
    await expect(runAttempt({ prompt: "test" })).rejects.toThrow(
      "x402: runAttempt failed",
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("network down"),
    );
  });
});

describe("createPlugin default export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createX402Fetch).mockReturnValue(
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
    vi.mocked(EvmSigner).mockImplementation(function () {
      return {
        address: "0x1234",
        chainId: "eip155:8453",
        isReady: vi.fn().mockResolvedValue(true),
      } as unknown as InstanceType<typeof EvmSigner>;
    });
  });

  it("returns a plugin object with expected shape", () => {
    const p = createPlugin();
    expect(p.id).toBe("x402-plugins/openclaw-x402");
    expect(typeof p.register).toBe("function");
  });
});
