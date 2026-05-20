const PROVIDER_ID = process.env.X402_PROVIDER_ID ?? "x402-gateway";
export default function registerX402Provider(pi) {
    pi.registerProvider(PROVIDER_ID, {
        name: "X402 Gateway",
        baseUrl: process.env.X402_GATEWAY_URL ?? "http://127.0.0.1:8080",
        apiKey: "X402_WALLET", // wallet path; not a static API key (FR-W1)
        api: "openai-completions",
        models: [
            {
                id: "default",
                name: "X402 Default",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128_000,
                maxTokens: 8_192,
            },
        ],
    });
    pi.on("session_start", async (_event, ctx) => {
        ctx.ui.notify(`[x402] Provider "${PROVIDER_ID}" registered — wire streamSimple in M2`, "info");
    });
}
//# sourceMappingURL=x402-provider.js.map