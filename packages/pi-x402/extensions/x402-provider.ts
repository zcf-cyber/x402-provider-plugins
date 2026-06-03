import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createX402Fetch, EvmSigner } from "@x402-plugins/core";
import { resolveConfig, registerConfigUI } from "../src/profile.js";

export default async function registerX402Provider(pi: ExtensionAPI): Promise<void> {
  registerConfigUI(pi);

  const config = resolveConfig(
    pi as unknown as { getFlag?: (name: string) => string | undefined },
  );

  // Dynamic model discovery via /v1/models (connectivity check)
  let availableModelIds: string[];
  const modelsUrl = `${config.gatewayUrl}/v1/models`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const modelsResponse = await fetch(modelsUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!modelsResponse.ok) {
      throw new Error(`x402: invalid x402 gateway URL — /v1/models returned ${modelsResponse.status}`);
    }
    const modelsData = (await modelsResponse.json()) as { data?: Array<{ id: string }> };
    if (!modelsData.data || !Array.isArray(modelsData.data) || modelsData.data.length === 0) {
      throw new Error("x402: invalid x402 gateway URL — /v1/models returned empty model list");
    }
    availableModelIds = modelsData.data.map((m) => m.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`x402: invalid x402 gateway URL — ${message}`);
  }

  // Validate explicitly-set modelName against discovered models
  if (config.modelName && !availableModelIds.includes(config.modelName)) {
    throw new Error(
      `x402: model "${config.modelName}" not found at this gateway.\nAvailable: ${availableModelIds.join(", ")}`,
    );
  }

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
    // Validate model name against discovered models
    if (!availableModelIds.includes(params.model)) {
      const modelList = availableModelIds.map((m) => `  - ${m}`).join("\n");
      const errMsg = `x402: model "${params.model}" not found.\nAvailable models:\n${modelList}`;
      ctx.ui?.notify?.(
        `[x402] model "${params.model}" is not available at this gateway.\nAvailable: ${availableModelIds.join(", ")}`,
        "error",
      );
      throw new Error(errMsg);
    }

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

  // Build models: preferred modelName first if set and available
  let modelIds = availableModelIds;
  if (config.modelName && availableModelIds.includes(config.modelName)) {
    modelIds = [config.modelName, ...availableModelIds.filter((id) => id !== config.modelName)];
  }
  const dynamicModels = modelIds.map((id) => ({
    id,
    name: `x402: ${id}`,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  }));

  pi.registerProvider("x402", {
    name: "X402 Gateway",
    baseUrl: config.providerUrl || config.gatewayUrl,
    apiKey: "X402_WALLET",
    api: "openai-completions",
    models: dynamicModels,
    streamSimple,
  });

  pi.on("session_start", async (_event, ctx) => {
    const ready = await signer.isReady();
    const count = availableModelIds.length;
    const s = count !== 1 ? "s" : "";
    if (ready) {
      const addr = signer.address;
      const masked = addr.length >= 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
      ctx.ui?.notify(
        `[x402] Provider "x402" registered with ${count} model${s}, wallet ${masked}`,
        "info",
      );
    } else {
      ctx.ui?.notify(
        `[x402] Provider "x402" registered with ${count} model${s} — wallet not configured. Run /x402-config edit to set up.`,
        "warning",
      );
    }
  });
}
