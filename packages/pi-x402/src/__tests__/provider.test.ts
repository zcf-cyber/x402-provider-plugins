import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

vi.mock("@x402-plugins/core", () => ({
  createX402Fetch: vi.fn(),
  EvmSigner: vi.fn(),
}));

import registerX402Provider from "../../extensions/x402-provider.js";
import { createX402Fetch, EvmSigner } from "@x402-plugins/core";

function mockResponse(chunks: string[]) {
  let i = 0;
  return new Response(
    new ReadableStream({
      pull(c) {
        if (i < chunks.length) c.enqueue(new TextEncoder().encode(chunks[i++]));
        else c.close();
      },
    }),
  );
}

describe("registerX402Provider", () => {
  let registered: Record<string, unknown> | undefined;
  let notify: Mock<(message: string, level: string) => void>;
  let ctx: ExtensionContext;
  let pi: ExtensionAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    notify = vi.fn();
    ctx = { ui: { notify, confirm: vi.fn(), input: vi.fn() } };
    registered = undefined;
    pi = {
      registerProvider: vi.fn((_id, config) => { registered = config; }),
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
    vi.mocked(EvmSigner).mockImplementation(function () {
      return { address: "0x1234", chainId: "eip155:8453", isReady: vi.fn().mockResolvedValue(true) };
    });
  });

  it("registers provider with expected id", () => {
    registerX402Provider(pi);
    expect(pi.registerProvider).toHaveBeenCalledWith(
      "x402",
      expect.objectContaining({ name: "X402 Gateway", api: "openai-completions" }),
    );
    expect(registered).toBeDefined();
    expect(registered!.streamSimple).toBeInstanceOf(Function);
  });

  it("streamSimple calls wrapped fetch with correct URL", async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
    ]));
    vi.mocked(createX402Fetch).mockReturnValue(fetchFn);
    registerX402Provider(pi);
    const streamSimple = registered!.streamSimple as (
      params: Record<string, unknown>, ctx?: ExtensionContext,
    ) => AsyncGenerator<{ content: string; role?: string }>;
    for await (const _ of streamSimple(
      { model: "default", messages: [{ role: "user", content: "hello" }] }, ctx,
    )) { /* consume */ }
    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining('"stream":true'),
      }),
    );
  });

  it("streamSimple returns chunks in expected format", async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse([
      'data: {"choices":[{"delta":{"content":"Hello ","role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      "data: [DONE]\n\n",
    ]));
    vi.mocked(createX402Fetch).mockReturnValue(fetchFn);
    registerX402Provider(pi);
    const streamSimple = registered!.streamSimple as (
      params: Record<string, unknown>, ctx?: ExtensionContext,
    ) => AsyncGenerator<{ content: string; role?: string }>;
    const chunks: Array<{ content: string; role?: string }> = [];
    for await (const chunk of streamSimple(
      { model: "default", messages: [{ role: "user", content: "hi" }] }, ctx,
    )) chunks.push(chunk);
    expect(chunks).toEqual([{ content: "Hello ", role: "assistant" }, { content: "world" }]);
  });

  it("throws on non-200 gateway response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.mocked(createX402Fetch).mockReturnValue(fetchFn);
    registerX402Provider(pi);
    const streamSimple = registered!.streamSimple as (
      params: Record<string, unknown>, ctx?: ExtensionContext,
    ) => AsyncGenerator<{ content: string; role?: string }>;
    await expect(
      (async () => {
        for await (const _ of streamSimple({ model: "default", messages: [] }, ctx)) { /* consume */ }
      })(),
    ).rejects.toThrow("x402: gateway returned 500");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("500"), "error");
  });

  it("throws on empty response body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.mocked(createX402Fetch).mockReturnValue(fetchFn);
    registerX402Provider(pi);
    const streamSimple = registered!.streamSimple as (
      params: Record<string, unknown>, ctx?: ExtensionContext,
    ) => AsyncGenerator<{ content: string; role?: string }>;
    await expect(
      (async () => {
        for await (const _ of streamSimple({ model: "default", messages: [] }, ctx)) { /* consume */ }
      })(),
    ).rejects.toThrow("x402: gateway returned empty body");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("empty body"), "error");
  });

  it("surfaces fetch errors via ctx.ui.notify", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network timeout"));
    vi.mocked(createX402Fetch).mockReturnValue(fetchFn);
    registerX402Provider(pi);
    const streamSimple = registered!.streamSimple as (
      params: Record<string, unknown>, ctx?: ExtensionContext,
    ) => AsyncGenerator<{ content: string; role?: string }>;
    await expect(
      (async () => {
        for await (const _ of streamSimple({ model: "default", messages: [] }, ctx)) { /* consume */ }
      })(),
    ).rejects.toThrow("x402: provider fetch failed");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("network timeout"), "error");
  });
});
