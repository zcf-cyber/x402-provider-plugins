export default function registerX402Wallet(pi) {
    pi.on("session_start", async (_event, ctx) => {
        // M2: connect signer from env / hardware wallet module
        const ready = Boolean(process.env.X402_WALLET_ADDRESS);
        if (!ready) {
            ctx.ui.notify("[x402] 未配置钱包 — 设置 X402_WALLET_ADDRESS 或实现 signer（FR-W1）", "warning");
            return;
        }
        ctx.ui.notify(`[x402] 钱包 ${process.env.X402_WALLET_ADDRESS}`, "info");
    });
    pi.on("tool_call", async (event, ctx) => {
        if (!process.env.X402_WALLET_ADDRESS) {
            return {
                block: true,
                reason: "x402: wallet required before paid tool execution",
            };
        }
        if (event.toolName === "bash" && String(event.input?.command ?? "").includes("rm -rf")) {
            const ok = await ctx.ui.confirm("x402", "允许危险 shell？");
            if (!ok)
                return { block: true, reason: "Blocked by x402-wallet policy" };
        }
    });
}
//# sourceMappingURL=x402-wallet.js.map