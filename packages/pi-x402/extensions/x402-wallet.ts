/**
 * Pi extension: wallet-native session gates (FR-W1–W3).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EvmSigner } from "@x402-plugins/core";
import { resolveConfig } from "./config.js";

function maskAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function registerX402Wallet(pi: ExtensionAPI): void {
  // Resolve config with priority: CLI flags > file > env > defaults
  const config = resolveConfig(
    pi as unknown as { getFlag?: (name: string) => string | undefined },
  );
  const signer = new EvmSigner(config.chainId, config.privateKey || null);

  pi.on("session_start", async (_event, ctx) => {
    const ready = await signer.isReady();
    if (!ready) {
      ctx.ui?.notify(
        "[x402] 未配置钱包 — 设置 X402_PRIVATE_KEY 环境变量以启用支付签名",
        "warning",
      );
      return;
    }
    ctx.ui?.notify(`[x402] 钱包已就绪 ${maskAddress(signer.address)}`, "info");
  });

  pi.on("tool_call", async (event, ctx) => {
    const ready = await signer.isReady();
    if (!ready) {
      return {
        block: true,
        reason: "x402: wallet required before paid tool execution",
      };
    }

    const toolName = event.toolName ?? "unknown";
    const ok = ctx.ui
      ? await ctx.ui.confirm(
          "x402",
          `Authorize paid tool "${toolName}"? Estimated cost depends on gateway quote.`,
        )
      : true;
    if (!ok) {
      return { block: true, reason: "x402: user declined payment authorization" };
    }
  });
}
