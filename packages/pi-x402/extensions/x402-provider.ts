import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createX402Fetch, EvmSigner } from "@x402-plugins/core";

const PROVIDER_ID = process.env.X402_PROVIDER_ID ?? "x402-gateway";
const GATEWAY_URL = process.env.X402_GATEWAY_URL ?? "http://127.0.0.1:8080";
const CHAIN_ID = process.env.X402_CHAIN_ID ?? "eip155:8453";

export default function registerX402Provider(pi: ExtensionAPI): void {
  const signer = new EvmSigner(CHAIN_ID);
  const fetchWithPayment = createX402Fetch(
    { gatewayBaseUrl: GATEWAY_URL, maxRetries: 2 },
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
    const url = `${GATEWAY_URL}/v1/chat/completions`;
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
      ctx?.ui.notify(`[x402] Provider error: ${message}`, "error");
      throw new Error(`x402: provider fetch failed — ${message}`);
    }

    if (!response.ok) {
      const errorMsg = `x402: gateway returned ${response.status}`;
      ctx?.ui.notify(`[x402] ${errorMsg}`, "error");
      throw new Error(errorMsg);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      const errorMsg = "x402: gateway returned empty body";
      ctx?.ui.notify(`[x402] ${errorMsg}`, "error");
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
      ctx?.ui.notify(`[x402] Stream error: ${message}`, "error");
      throw new Error(`x402: stream read failed — ${message}`);
    } finally {
      reader.releaseLock();
    }
  }

  pi.registerProvider(PROVIDER_ID, {
    name: "X402 Gateway",
    baseUrl: GATEWAY_URL,
    apiKey: "X402_WALLET",
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
    streamSimple,
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify(`[x402] Provider "${PROVIDER_ID}" registered`, "info");
  });
}
