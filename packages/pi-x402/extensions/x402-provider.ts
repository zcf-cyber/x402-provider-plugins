import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createX402Fetch, EvmSigner } from "@x402-plugins/core";
import { resolveConfig, registerConfigUI } from "../src/profile.js";

export default function registerX402Provider(pi: ExtensionAPI): void {
  registerConfigUI(pi);

  const config = resolveConfig(
    pi as unknown as { getFlag?: (name: string) => string | undefined },
  );

  const signer = new EvmSigner(config.chainId, config.privateKey || null);
  const fetchWithPayment = createX402Fetch(
    { gatewayBaseUrl: config.gatewayUrl, maxRetries: 2 },
    signer,
  );

  async function* streamSimple(
    params: {
      model: string;
      messages: Array<{ role: string; content: string }>;
      temperature?: number;
      max_tokens?: number;
    },
    ctx?: ExtensionContext,
  ): AsyncGenerator<{ content: string; role?: string }> {
    const baseUrl = config.providerUrl || config.gatewayUrl;
    const url = `${baseUrl}/v1/chat/completions`;
    const body = JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: true,
      temperature: params.temperature,
      max_tokens: params.max_tokens,
    });

    let response: Response;
    try {
      response = await fetchWithPayment(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui?.notify(`[x402] Provider error: ${message}`, "error");
      throw new Error(`x402: provider fetch failed — ${message}`);
    }

    if (!response.ok) {
      const errorMsg = `x402: gateway returned ${response.status}`;
      ctx.ui?.notify(`[x402] ${errorMsg}`, "error");
      throw new Error(errorMsg);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      const errorMsg = "x402: gateway returned empty body";
      ctx.ui?.notify(`[x402] ${errorMsg}`, "error");
      throw new Error(errorMsg);
    }

    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") return;
          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              yield { content: delta.content, role: delta.role };
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui?.notify(`[x402] Stream error: ${message}`, "error");
      throw new Error(`x402: stream read failed — ${message}`);
    } finally {
      reader.releaseLock();
    }
  }

  pi.registerProvider("x402", {
    name: "X402 Gateway",
    baseUrl: config.providerUrl || config.gatewayUrl,
    apiKey: "X402_WALLET",
    api: "openai-completions",
    models: [
      {
        id: config.modelName,
        name: `x402: ${config.modelName}`,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 8_192,
      },
    ],
    streamSimple,
  });

  pi.on("session_start", async (_event, ctx) => {
    const ready = await signer.isReady();
    if (ready) {
      const addr = signer.address;
      const masked = addr.length >= 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
      ctx.ui?.notify(
        `[x402] Provider "x402" registered, wallet ${masked}`,
        "info",
      );
    } else {
      ctx.ui?.notify(
        `[x402] Provider "x402" registered — wallet not configured. Run /x402-config edit to set up.`,
        "warning",
      );
    }
  });
}
