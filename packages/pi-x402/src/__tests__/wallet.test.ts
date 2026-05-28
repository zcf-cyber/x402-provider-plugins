import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

vi.mock("@x402-plugins/core", () => ({
  EvmSigner: vi.fn(),
}));

import registerX402Wallet from "../../extensions/x402-wallet.js";
import { EvmSigner } from "@x402-plugins/core";

describe("registerX402Wallet", () => {
  let notify: Mock<(message: string, level: string) => void>;
  let confirm: Mock<(title: string, message: string) => Promise<boolean>>;
  let ctx: ExtensionContext;
  let pi: ExtensionAPI;
  let handlers: Record<
    string,
    (event: unknown, ctx: ExtensionContext) => Promise<unknown>
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    notify = vi.fn();
    confirm = vi.fn();
    ctx = { ui: { notify, confirm, input: vi.fn() } } as unknown as ExtensionContext;
    handlers = {};
    pi = {
      registerProvider: vi.fn(),
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    } as unknown as ExtensionAPI;
  });

  function mockSigner(ready: boolean, address?: string) {
    vi.mocked(EvmSigner).mockImplementation(function () {
      return {
        address: address ?? "0xABCD1234ABCD1234ABCD1234ABCD1234ABCD1234",
        isReady: vi.fn().mockResolvedValue(ready),
      } as unknown as InstanceType<typeof EvmSigner>;
    });
  }

  it("session_start with ready signer shows masked address", async () => {
    mockSigner(true, "0xABCD1234ABCD1234ABCD1234ABCD1234ABCD1234");
    registerX402Wallet(pi);
    await handlers["session_start"](null, ctx);
    expect(notify).toHaveBeenCalledWith(
      "[x402] 钱包已就绪 0xABCD...1234",
      "info",
    );
  });

  it("session_start without signer shows warning", async () => {
    mockSigner(false);
    registerX402Wallet(pi);
    await handlers["session_start"](null, ctx);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("未配置钱包"),
      "warning",
    );
  });

  it("tool_call with ready signer and confirm yes does not block", async () => {
    mockSigner(true);
    confirm.mockResolvedValue(true);
    registerX402Wallet(pi);
    const result = await handlers["tool_call"]({ toolName: "bash" }, ctx);
    expect(result).toBeUndefined();
    expect(confirm).toHaveBeenCalledWith(
      "x402",
      expect.stringContaining("bash"),
    );
  });

  it("tool_call with ready signer and confirm no blocks", async () => {
    mockSigner(true);
    confirm.mockResolvedValue(false);
    registerX402Wallet(pi);
    const result = await handlers["tool_call"]({ toolName: "bash" }, ctx);
    expect(result).toEqual({
      block: true,
      reason: "x402: user declined payment authorization",
    });
  });

  it("tool_call without signer blocks with wallet required", async () => {
    mockSigner(false);
    registerX402Wallet(pi);
    const result = await handlers["tool_call"]({ toolName: "bash" }, ctx);
    expect(result).toEqual({
      block: true,
      reason: "x402: wallet required before paid tool execution",
    });
  });
});
