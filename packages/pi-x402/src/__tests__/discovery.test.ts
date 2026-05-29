import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

vi.mock("typebox", () => ({
  Type: {
    Object: (s: unknown) => s,
    Optional: (s: unknown) => s,
    String: (o?: unknown) => ({ type: "string", ...(o as object ?? {}) }),
  },
}));

import registerX402Discovery from "../../extensions/x402-discovery.js";

const MOCK_SVC = [
  { name: "OpenAI Gateway", endpoint: "https://api.openai.com", cost_range: "$0.001 - $0.01" },
  { name: "Claude Gateway", endpoint: "https://api.anthropic.com", cost_range: "$0.002 - $0.05" },
  { name: "Local LLM", endpoint: "http://localhost:11434", cost_range: "free" },
];

function okJson(services = MOCK_SVC) {
  (globalThis.fetch as Mock).mockResolvedValue({ ok: true, json: () => Promise.resolve({ services }) });
}

describe("registerX402Discovery", () => {
  const origFetch = globalThis.fetch;
  let notify: Mock, input: Mock, ctx: ExtensionContext, pi: ExtensionAPI;
  let cmds: Record<string, { handler: (...a: unknown[]) => unknown }>;
  let tools: Record<string, { execute: (...a: unknown[]) => unknown }>;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
    notify = vi.fn();
    input = vi.fn();
    ctx = { ui: { notify, confirm: vi.fn(), input } } as unknown as ExtensionContext;
    cmds = {};
    tools = {};
    pi = {
      registerProvider: vi.fn(),
      on: vi.fn(),
      registerCommand: vi.fn((n: string, s: { handler: (...a: unknown[]) => unknown }) => { cmds[n] = s; }),
      registerTool: vi.fn((s: { name: string; execute: (...a: unknown[]) => unknown }) => { tools[s.name] = s; }),
    } as unknown as ExtensionAPI;
    okJson();
    delete process.env.X402_ALLOWLIST;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = origFetch;
    delete process.env.X402_ALLOWLIST;
  });

  it("registers discover command and list_services tool", () => {
    registerX402Discovery(pi);
    expect(pi.registerCommand).toHaveBeenCalledWith("discover", expect.objectContaining({ description: expect.stringContaining("关键字搜索") }));
    expect(pi.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: "x402_list_services" }));
  });

  it("discover: does nothing on empty keyword", async () => {
    input.mockResolvedValue("");
    registerX402Discovery(pi);
    await cmds["discover"].handler(null, ctx);
    expect(notify).not.toHaveBeenCalled();
  });

  it("discover: queries index with keyword and displays filtered results", async () => {
    input.mockResolvedValue("openai");
    registerX402Discovery(pi);
    await cmds["discover"].handler(null, ctx);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("q=openai"), expect.any(Object));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("发现 3 个服务"), "info");
  });

  it("discover: shows warning when index empty or network fails", async () => {
    (globalThis.fetch as Mock).mockRejectedValue(new Error("down"));
    input.mockResolvedValue("any");
    registerX402Discovery(pi);
    await cmds["discover"].handler(null, ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("未找到匹配"), "warning");
  });

  it("discover: respects allowlist and warns when all filtered", async () => {
    process.env.X402_ALLOWLIST = "https://api.openai.com";
    input.mockResolvedValue("gateway");
    registerX402Discovery(pi);
    await cmds["discover"].handler(null, ctx);
    const msg = notify.mock.calls.find((c: unknown[]) => (c[0] as string).includes("发现"))?.[0] as string;
    expect(msg).toContain("OpenAI Gateway");
    expect(msg).not.toContain("Claude");
    process.env.X402_ALLOWLIST = "https://blocked.example.com";
    input.mockResolvedValue("gateway");
    registerX402Discovery(pi);
    await cmds["discover"].handler(null, ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("均不在白名单中"), "warning");
  });

  it("list_services: returns all services with cost info", async () => {
    registerX402Discovery(pi);
    const r = await tools["x402_list_services"].execute("r1", { keyword: undefined }, null, null, ctx) as { content: Array<{ text: string }> };
    expect(r.content[0].text).toContain("OpenAI Gateway");
    expect(r.content[0].text).toContain("Claude Gateway");
    expect(r.content[0].text).toContain("($0.001 - $0.01)");
  });

  it("list_services: filters by keyword", async () => {
    registerX402Discovery(pi);
    const r = await tools["x402_list_services"].execute("r2", { keyword: "local" }, null, null, ctx) as { content: Array<{ text: string }> };
    expect(r.content[0].text).toContain("Local LLM");
    expect(r.content[0].text).not.toContain("OpenAI");
  });

  it("list_services: applies allowlist and shows fallback messages", async () => {
    process.env.X402_ALLOWLIST = "https://api.anthropic.com";
    registerX402Discovery(pi);
    const r = await tools["x402_list_services"].execute("r3", { keyword: undefined }, null, null, ctx) as { content: Array<{ text: string }> };
    expect(r.content[0].text).toContain("Claude Gateway");
    expect(r.content[0].text).not.toContain("OpenAI");
    (globalThis.fetch as Mock).mockResolvedValue({ ok: true, json: () => Promise.resolve({ services: [] }) });
    const r2 = await tools["x402_list_services"].execute("r4", { keyword: undefined }, null, null, ctx) as { content: Array<{ text: string }> };
    expect(r2.content[0].text).toContain("无白名单匹配的服务");
  });

  it("list_services: handles empty index and fetch failure", async () => {
    delete process.env.X402_ALLOWLIST;
    (globalThis.fetch as Mock).mockRejectedValue(new Error("timeout"));
    registerX402Discovery(pi);
    const r = await tools["x402_list_services"].execute("r5", { keyword: undefined }, null, null, ctx) as { content: Array<{ text: string }> };
    expect(r.content[0].text).toBe("[x402] discovery index 无可用服务");
  });
});
