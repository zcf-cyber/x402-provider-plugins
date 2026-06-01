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
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "discover",
      expect.objectContaining({ description: expect.stringContaining("x402") }),
    );
    expect(pi.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: "x402_list_services" }));
  });

  it("discover: returns empty on empty keyword", async () => {
    input.mockResolvedValue("");
    registerX402Discovery(pi);
    await cmds["discover"].handler(null, ctx);
    expect(notify).not.toHaveBeenCalled();
  });

  it("discover: filters by keyword client-side and shows results with cost", async () => {
    process.env.X402_ALLOWLIST = "https://api.openai.com,https://api.anthropic.com,http://localhost:11434";
    input.mockResolvedValue("openai");
    registerX402Discovery(pi);
    await cmds["discover"].handler(null, ctx);
    // Verify the discovery index was queried without URL search params
    expect(fetch).toHaveBeenCalledWith(
      "https://discovery.x402.network/v1/services",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("discovered 1 service(s)"), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("OpenAI Gateway"), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("$0.001 - $0.01"), "info");
  });

  it("discover: warns when no keyword match", async () => {
    input.mockResolvedValue("nonexistent");
    registerX402Discovery(pi);
    await cmds["discover"].handler(null, ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("no services found matching"), "warning");
  });

  it("discover: shows error when discovery index is unreachable", async () => {
    (globalThis.fetch as Mock).mockRejectedValue(new Error("down"));
    input.mockResolvedValue("anything");
    registerX402Discovery(pi);
    await cmds["discover"].handler(null, ctx);
    expect(notify).toHaveBeenCalledWith("[x402] discovery index unreachable", "error");
  });

  it("discover: warns when all services filtered by allowlist", async () => {
    process.env.X402_ALLOWLIST = "https://blocked.example.com";
    input.mockResolvedValue("gateway");
    registerX402Discovery(pi);
    await cmds["discover"].handler(null, ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("found 2 service(s) but none are in allowlist"), "warning");
  });

  it("list_services: returns no services when allowlist is empty (default-deny per FR-D3)", async () => {
    registerX402Discovery(pi);
    const r = (await tools["x402_list_services"].execute("r1", { keyword: undefined }, null, null, ctx)) as { content: Array<{ text: string }> };
    expect(r.content[0].text).toBe("[x402] discovery index returned no services");
  });

  it("list_services: returns allowlisted services when allowlist is set", async () => {
    process.env.X402_ALLOWLIST = "https://api.openai.com,http://localhost:11434";
    registerX402Discovery(pi);
    const r = (await tools["x402_list_services"].execute("r1b", { keyword: undefined }, null, null, ctx)) as { content: Array<{ text: string }> };
    expect(r.content[0].text).toContain("OpenAI Gateway");
    expect(r.content[0].text).toContain("($0.001 - $0.01)");
    expect(r.content[0].text).toContain("(free)");
    // Should NOT include Claude Gateway (not in allowlist)
    expect(r.content[0].text).not.toContain("Claude Gateway");
  });

  it("list_services: filters by keyword and allowlist", async () => {
    process.env.X402_ALLOWLIST = "https://api.anthropic.com";
    registerX402Discovery(pi);
    const r = (await tools["x402_list_services"].execute("r2", { keyword: "local" }, null, null, ctx)) as { content: Array<{ text: string }> };
    // keyword "local" matches Local LLM, but allowlist only has Anthropic
    expect(r.content[0].text).toBe("[x402] no allowlisted services found");
  });

  it("list_services: shows unreachable on network error", async () => {
    delete process.env.X402_ALLOWLIST;
    (globalThis.fetch as Mock).mockRejectedValue(new Error("timeout"));
    registerX402Discovery(pi);
    const r = (await tools["x402_list_services"].execute("r3", { keyword: undefined }, null, null, ctx)) as { content: Array<{ text: string }> };
    expect(r.content[0].text).toBe("[x402] discovery index unreachable");
  });
});
