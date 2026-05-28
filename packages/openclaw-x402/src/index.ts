/**
 * OpenClaw plugin entry (FR-CL1).
 * @see https://documentation.openclaw.ai/plugins/building-plugins
 */
import { createX402Fetch, EvmSigner } from "@x402-plugins/core";
import type { X402ClientConfig } from "@x402-plugins/core";

export interface OpenClawX402Config extends X402ClientConfig {
  providerId?: string;
}

export function registerOpenClawX402(api: {
  registerProvider: (def: unknown) => void;
  log?: (msg: string) => void;
}, config: OpenClawX402Config): void {
  const providerId = config.providerId ?? "x402-gateway";
  const signer = new EvmSigner();
  const x402Fetch = createX402Fetch(config, signer);

  api.registerProvider({
    id: providerId,
    name: "X402 Gateway Provider",
    config: {
      gatewayBaseUrl: config.gatewayBaseUrl,
      protocolVersion: config.protocolVersion ?? 2,
    },
    async runAttempt(params: { prompt: string }) {
      const url = `${config.gatewayBaseUrl}/v1/chat/completions`;
      const body = JSON.stringify({
        model: "default",
        messages: [{ role: "user", content: params.prompt }],
        stream: false,
      });

      api.log?.(`[x402] runAttempt start — provider="${providerId}"`);

      let response: Response;
      try {
        response = await x402Fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        api.log?.(`[x402] runAttempt error: ${message}`);
        throw new Error(`x402: runAttempt failed — ${message}`);
      }

      if (!response.ok) {
        const msg = `x402: gateway returned ${response.status}`;
        api.log?.(`[x402] ${msg}`);
        throw new Error(msg);
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        api.log?.(`[x402] runAttempt parse error: ${message}`);
        throw new Error(`x402: failed to parse gateway response — ${message}`);
      }

      const text = extractText(data);
      api.log?.(`[x402] runAttempt completed — provider="${providerId}"`);
      return { text, raw: data };
    },
  });

  api.log?.(`[x402] registered provider "${providerId}"`);
}

function extractText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  const choices = d.choices as Array<Record<string, unknown>> | undefined;
  if (!choices || !choices.length) return "";
  const first = choices[0];
  if (first.message && typeof first.message === "object") {
    const msg = first.message as Record<string, unknown>;
    if (typeof msg.content === "string") return msg.content;
  }
  if (typeof first.text === "string") return first.text;
  return "";
}

export default function createPlugin() {
  return {
    id: "x402-plugins/openclaw-x402",
    register(api: { registerProvider: (def: unknown) => void; log?: (msg: string) => void }) {
      registerOpenClawX402(api, {
        gatewayBaseUrl: process.env.X402_GATEWAY_URL ?? "http://127.0.0.1:8080",
        protocolVersion: 2,
      });
    },
  };
}
