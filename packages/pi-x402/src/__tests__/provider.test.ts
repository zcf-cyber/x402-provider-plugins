import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

function mockModelsResponse(modelIds: string[]) {
  return new Response(JSON.stringify({ data: modelIds.map((id) => ({ id })) }), { status: 200 });
}

describe("registerX402Provider", () => {
  let registered: Record<string, unknown> | undefined;
  let notify: Mock<(message: string, level: string) => void>;
  let ctx: ExtensionContext;
  let pi: ExtensionAPI;
  let rawFetch: Mock<typeof fetch>;

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
    rawFetch = vi.fn().mockResolvedValue(mockModelsResponse(["gpt-4o", "claude-3"]));
    globalThis.fetch = rawFetch as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers provider with expected id", async () => {
    await registerX402Provider(pi);
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
    await registerX402Provider(pi);
    const streamSimple = registered!.streamSimple as (
      model: Record<string, unknown>, context: Record<string, unknown>,
    ) => AsyncGenerator<{ content: string; role?: string }>;
    for await (const _ of streamSimple(
      { id: "gpt-4o" }, { messages: [{ role: "user", content: "hello" }] },
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
    await registerX402Provider(pi);
    const streamSimple = registered!.streamSimple as (
      model: Record<string, unknown>, context: Record<string, unknown>,
    ) => AsyncGenerator<{ content: string; role?: string }>;
    const chunks: Array<{ content: string; role?: string }> = [];
    for await (const chunk of streamSimple(
      { id: "gpt-4o" }, { messages: [{ role: "user", content: "hi" }] },
    )) chunks.push(chunk);
    expect(chunks).toEqual([{ content: "Hello ", role: "assistant" }, { content: "world" }]);
  });

  it("throws on non-200 gateway response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.mocked(createX402Fetch).mockReturnValue(fetchFn);
    await registerX402Provider(pi);
    const streamSimple = registered!.streamSimple as (
      model: Record<string, unknown>, context: Record<string, unknown>,
    ) => AsyncGenerator<{ content: string; role?: string }>;
    await expect(
      (async () => {
        for await (const _ of streamSimple({ id: "gpt-4o" }, { messages: [] })) { /* consume */ }
      })(),
    ).rejects.toThrow("x402: gateway returned 500");
  });

  it("throws on empty response body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.mocked(createX402Fetch).mockReturnValue(fetchFn);
    await registerX402Provider(pi);
    const streamSimple = registered!.streamSimple as (
      model: Record<string, unknown>, context: Record<string, unknown>,
    ) => AsyncGenerator<{ content: string; role?: string }>;
    await expect(
      (async () => {
        for await (const _ of streamSimple({ id: "gpt-4o" }, { messages: [] })) { /* consume */ }
      })(),
    ).rejects.toThrow("x402: gateway returned empty body");
  });

  it("surfaces fetch errors as thrown exception", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network timeout"));
    vi.mocked(createX402Fetch).mockReturnValue(fetchFn);
    await registerX402Provider(pi);
    const streamSimple = registered!.streamSimple as (
      model: Record<string, unknown>, context: Record<string, unknown>,
    ) => AsyncGenerator<{ content: string; role?: string }>;
    await expect(
      (async () => {
        for await (const _ of streamSimple({ id: "gpt-4o" }, { messages: [] })) { /* consume */ }
      })(),
    ).rejects.toThrow("x402: provider fetch failed");
  });

  // ── Model discovery tests ────────────────────────────────

  it("fetches models from /v1/models and registers them", async () => {
    await registerX402Provider(pi);

    expect(rawFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/models",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const models = registered!.models as Array<{ id: string }>;
    expect(models.length).toBe(2);
    expect(models[0].id).toBe("gpt-4o");
  });

  it("throws when /v1/models returns non-200", async () => {
    rawFetch.mockResolvedValue(new Response(null, { status: 502 }));
    await expect(registerX402Provider(pi)).rejects.toThrow("invalid x402 gateway URL");
  });

  it("throws when /v1/models fetch fails", async () => {
    rawFetch.mockRejectedValue(new Error("network timeout"));
    await expect(registerX402Provider(pi)).rejects.toThrow("invalid x402 gateway URL");
  });

  it("throws when /v1/models returns empty list", async () => {
    rawFetch.mockResolvedValue(mockModelsResponse([]));
    await expect(registerX402Provider(pi)).rejects.toThrow("empty model list");
  });

  it("throws when modelName not in discovered models", async () => {
    process.env.X402_MODEL_NAME = "nonexistent";
    await expect(registerX402Provider(pi)).rejects.toThrow(
      'x402: model "nonexistent" not found at this gateway',
    );
    delete process.env.X402_MODEL_NAME;
  });

  it("streamSimple rejects unknown model", async () => {
    await registerX402Provider(pi);
    const streamSimple = registered!.streamSimple as (
      model: Record<string, unknown>, context: Record<string, unknown>,
    ) => AsyncGenerator<{ content: string; role?: string }>;
    await expect(
      (async () => {
        for await (const _ of streamSimple({ id: "bad" }, { messages: [] })) { /* consume */ }
      })(),
    ).rejects.toThrow('x402: model "bad" not found');
  });
});
