import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockExists = vi.fn();
const mockMkdir = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExists(...args),
  readFileSync: (...args: unknown[]) => mockReadFile(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFile(...args),
  mkdirSync: (...args: unknown[]) => mockMkdir(...args),
}));

vi.mock("node:os", () => ({ homedir: () => "/home/testuser" }));

import { loadConfig, saveConfig, resolveConfig, registerConfigUI } from "../profile.js";

describe("config", () => {
  let pi: ExtensionAPI;
  let notify: Mock<(message: string, level: string) => void>;
  let input: Mock<(title: string, placeholder: string) => Promise<string | undefined>>;
  let rawFetch: Mock<typeof fetch>;
  let registeredCommands: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExists.mockReturnValue(false);
    mockReadFile.mockReturnValue("{}");
    mockWriteFile.mockReturnValue(undefined);
    mockMkdir.mockReturnValue(undefined);
    notify = vi.fn();
    input = vi.fn().mockResolvedValue(undefined); // default: return undefined (skip all fields)
    rawFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "gpt-4o" }, { id: "claude-3" }] }), { status: 200 }),
    );
    globalThis.fetch = rawFetch as unknown as typeof globalThis.fetch;
    registeredCommands = {};
    pi = {
      registerProvider: vi.fn(), on: vi.fn(), registerTool: vi.fn(),
      registerCommand: vi.fn((name, def) => { registeredCommands[name] = def; }),
    };
    ["X402_GATEWAY_URL", "X402_CHAIN_ID", "X402_PRIVATE_KEY", "X402_PROVIDER_URL", "X402_MODEL_NAME",
      "X402_DISCOVERY_URL", "X402_ALLOWLIST"].forEach((k) => delete process.env[k]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ["X402_GATEWAY_URL", "X402_CHAIN_ID", "X402_PRIVATE_KEY", "X402_PROVIDER_URL", "X402_MODEL_NAME",
      "X402_DISCOVERY_URL", "X402_ALLOWLIST"].forEach((k) => delete process.env[k]);
  });

  // ── loadConfig / saveConfig / resolveConfig ──────────────────

  it("loadConfig returns defaults when no config file", () => {
    const c = loadConfig();
    expect(c.gatewayUrl).toBe("http://127.0.0.1:8080");
    expect(c.chainId).toBe("eip155:8453");
    expect(c.allowlist).toBe("*");
  });

  it("loadConfig merges file values over defaults, survives malformed JSON", () => {
    mockExists.mockReturnValue(true);
    mockReadFile.mockReturnValue(JSON.stringify({ gatewayUrl: "https://gw.example.com" }));
    expect(loadConfig().gatewayUrl).toBe("https://gw.example.com");
    mockReadFile.mockReturnValue("bad-json{{{");
    expect(loadConfig().gatewayUrl).toBe("http://127.0.0.1:8080");
  });

  it("saveConfig merges partial into existing config", () => {
    mockExists.mockReturnValue(true);
    mockReadFile.mockReturnValue(JSON.stringify({ gatewayUrl: "https://old.example.com", chainId: "eip155:1" }));
    saveConfig({ gatewayUrl: "https://new.example.com" });
    const saved = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    expect(saved.gatewayUrl).toBe("https://new.example.com");
    expect(saved.chainId).toBe("eip155:1");
  });

  it("resolveConfig uses CLI > file > env > defaults priority", () => {
    mockExists.mockReturnValue(true);
    mockReadFile.mockReturnValue(JSON.stringify({ gatewayUrl: "https://file.example.com" }));
    process.env.X402_GATEWAY_URL = "https://env.example.com";
    const piFlags = { getFlag: (n: string) => (n === "x402-gateway-url" ? "https://cli.example.com" : undefined) };
    expect(resolveConfig(piFlags as unknown as { getFlag: (n: string) => string | undefined }).gatewayUrl).toBe("https://cli.example.com");
  });

  // ── Commands registration ────────────────────────────────────

  it("registers x402-config, x402-status, and x402-models commands", () => {
    registerConfigUI(pi);
    for (const name of ["x402-config", "x402-status", "x402-models"]) {
      expect(pi.registerCommand).toHaveBeenCalledWith(name, expect.any(Object));
    }
  });

  // ── /x402-status (wallet indicator fix) ──────────────────────

  it("/x402-status shows wallet indicator on Private Key line", async () => {
    process.env.X402_PRIVATE_KEY = "0x1234567890abcdef1234567890abcdef12345678";
    registerConfigUI(pi);
    const cmd = registeredCommands["x402-status"] as { handler: (...a: unknown[]) => Promise<void> };
    await cmd.handler([], { ui: { notify } });
    const msg = notify.mock.calls[0][0] as string;
    expect(msg).toContain("Gateway URL   : http://127.0.0.1:8080\n");
    expect(msg).toMatch(/Private Key\s+:.*✓/);
  });

  it("/x402-status shows ✗ on Private Key line when key not set", async () => {
    registerConfigUI(pi);
    const cmd = registeredCommands["x402-status"] as { handler: (...a: unknown[]) => Promise<void> };
    await cmd.handler([], { ui: { notify } });
    expect((notify.mock.calls[0][0] as string)).toMatch(/Private Key\s+:.*✗/);
  });

  // ── /x402-config set ─────────────────────────────────────────

  it("/x402-config set saves valid key to config", async () => {
    registerConfigUI(pi);
    const cmd = registeredCommands["x402-config"] as { handler: (...a: unknown[]) => Promise<void> };
    await cmd.handler(["set", "gatewayUrl", "https://custom.example.com"], { ui: { notify } });
    expect(mockWriteFile).toHaveBeenCalled();
    const saved = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    expect(saved.gatewayUrl).toBe("https://custom.example.com");
  });

  it("/x402-config set shows error for unknown key", async () => {
    registerConfigUI(pi);
    const cmd = registeredCommands["x402-config"] as { handler: (...a: unknown[]) => Promise<void> };
    await cmd.handler(["set", "badkey", "value"], { ui: { notify } });
    expect(notify.mock.calls[0][1]).toBe("error");
    expect((notify.mock.calls[0][0] as string)).toContain("Unknown key");
  });

  it("/x402-config set shows usage when args are missing", async () => {
    registerConfigUI(pi);
    const cmd = registeredCommands["x402-config"] as { handler: (...a: unknown[]) => Promise<void> };
    await cmd.handler(["set"], { ui: { notify } });
    expect((notify.mock.calls[0][0] as string)).toContain("Usage:");
  });

  // ── /x402-config edit ────────────────────────────────────────

  it("/x402-config edit saves updated gateway URL", async () => {
    input.mockResolvedValueOnce("https://new-gw.example.com"); // step 1: gateway url
    registerConfigUI(pi);
    const cmd = registeredCommands["x402-config"] as { handler: (...a: unknown[]) => Promise<void> };
    await cmd.handler(["edit"], { ui: { notify, input } });
    const saved = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    expect(saved.gatewayUrl).toBe("https://new-gw.example.com");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Configuration saved"), "info");
  });

  // ── /x402-models (gateway model dynamic discovery UI) ────────

  it("/x402-models fetches /v1/models and displays available models", async () => {
    registerConfigUI(pi);
    const cmd = registeredCommands["x402-models"] as { handler: (...a: unknown[]) => Promise<void> };
    await cmd.handler([], { ui: { notify } });
    expect(rawFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/models",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const msg = notify.mock.calls[0][0] as string;
    expect(msg).toContain("gpt-4o");
    expect(msg).toContain("claude-3");
    expect(notify.mock.calls[0][1]).toBe("info");
  });

  it("/x402-models shows error when gateway returns non-200", async () => {
    rawFetch.mockResolvedValue(new Response(null, { status: 502 }));
    registerConfigUI(pi);
    const cmd = registeredCommands["x402-models"] as { handler: (...a: unknown[]) => Promise<void> };
    await cmd.handler([], { ui: { notify } });
    expect(notify.mock.calls[0][1]).toBe("error");
    expect((notify.mock.calls[0][0] as string)).toContain("returned 502");
  });

  it("/x402-models warns on empty model list", async () => {
    rawFetch.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    registerConfigUI(pi);
    const cmd = registeredCommands["x402-models"] as { handler: (...a: unknown[]) => Promise<void> };
    await cmd.handler([], { ui: { notify } });
    expect(notify.mock.calls[0][1]).toBe("warning");
  });

  it("/x402-models handles network errors gracefully", async () => {
    rawFetch.mockRejectedValue(new Error("network timeout"));
    registerConfigUI(pi);
    const cmd = registeredCommands["x402-models"] as { handler: (...a: unknown[]) => Promise<void> };
    await cmd.handler([], { ui: { notify } });
    expect(notify.mock.calls[0][1]).toBe("error");
    expect((notify.mock.calls[0][0] as string)).toContain("network timeout");
  });

  it("/x402-models shows friendly message on AbortError (timeout)", async () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    rawFetch.mockRejectedValue(abortErr);
    registerConfigUI(pi);
    const cmd = registeredCommands["x402-models"] as { handler: (...a: unknown[]) => Promise<void> };
    await cmd.handler([], { ui: { notify } });
    expect(notify.mock.calls[0][1]).toBe("error");
    expect((notify.mock.calls[0][0] as string)).toContain("timed out (10s)");
  });
});
