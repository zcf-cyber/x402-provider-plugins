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

  it("discover: returns empty on empty keyword", async () => {
    input.mockResolvedValue("");
    registerX402Discovery(pi);
    await cmds["discover"].handler(null, ctx);
    expect(notify).not.toHaveBeenCalled();
  });

  it("discover: filters by keyword client-side and shows results with cost", async () => {
    input.mockResolvedValue("openai");
    registerX402Discovery(pi);
    await cmds["discover"].handler(null, ctx);
    expect(fetch).toHaveBeenCalledWith(expect.not.stringContaining("?q="), expect.any(Object));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("discovered 1 service(s)"), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("OpenAI Gateway"), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("$0.001 - $0.01"), "info");
  });

  it("discover: warns when no keyword match or fetch fails", async () => {
    (globalThis.fetch as Mock).mockRejectedValue(new Error("down"));
    input.mockResolvedValue("anything");
    registerX402Discovery(pi);
    await cmds["discover"].handler(null, ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("no services found matching"), "warning");
  });

  it("discover: warns when all services filtered by allowlist", async () => {
    process.env.X402_ALLOWLIST = "https://blocked.example.com";
    input.mockResolvedValue("gateway");
    registerX402Discovery(pi);
    await cmds["discover"].handler(null, ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("found 2 service(s) but none are in allowlist"), "warning");
  });

  it("list_services: returns all services with cost when no filters", async () => {
    registerX402Discovery(pi);
    const r = (await tools["x402_list_services"].execute("r1", { keyword: undefined }, null, null, ctx)) as { content: Array<{ text: string }> };
    expect(r.content[0].text).toContain("OpenAI Gateway");
    expect(r.content[0].text).toContain("($0.001 - $0.01)");
    expect(r.content[0].text).toContain("(free)");
  });

  it("list_services: filters by keyword and allowlist", async () => {
    process.env.X402_ALLOWLIST = "https://api.anthropic.com";
    registerX402Discovery(pi);
    const r = (await tools["x402_list_services"].execute("r2", { keyword: "local" }, null, null, ctx)) as { content: Array<{ text: string }> };
    // keyword "local" matches Local LLM, but allowlist only has Anthropic
    expect(r.content[0].text).toBe("[x402] no allowlisted services found");
  });

  it("list_services: shows fallback on fetch failure or empty index", async () => {
    delete process.env.X402_ALLOWLIST;
    (globalThis.fetch as Mock).mockRejectedValue(new Error("timeout"));
    registerX402Discovery(pi);
    const r = (await tools["x402_list_services"].execute("r3", { keyword: undefined }, null, null, ctx)) as { content: Array<{ text: string }> };
    expect(r.content[0].text).toBe("[x402] discovery index returned no services");
  });
});
