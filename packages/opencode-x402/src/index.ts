/**
 * OpenCode plugin entry (FR-O1, FR-O2).
 * @see https://open-code.ai/docs/plugins
 *
 * Provides x402 payment flow integration for OpenCode runtime.
 */
import { createX402Fetch, EvmSigner } from "@x402-plugins/core";
import type { X402ClientConfig } from "@x402-plugins/core";

export interface OpenCodeX402PluginConfig extends X402ClientConfig {
  /** When true, wrap outbound model fetch with x402 payment flow */
  enabled?: boolean;
}

export function createOpenCodeX402Hooks(config: OpenCodeX402PluginConfig) {
  const signer = new EvmSigner(config.protocolVersion === 1 ? undefined : undefined);
  const x402Fetch = createX402Fetch(config, signer);

  return {
    name: "@x402-plugins/opencode-x402",
    version: "0.1.0",

    /** x402-wrapped fetch for the host to use as transport */
    fetch: x402Fetch,

    /** Called by host before model/provider HTTP — inject x402 headers when enabled */
    async onProviderRequest(init: RequestInit): Promise<RequestInit> {
      if (config.enabled === false) return init;
      return {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          "x-x402-plugin": "opencode-x402/0.1.0",
        },
      };
    },

    /** Called by host before executing a paid tool — gate on wallet readiness */
    async toolExecuteBefore(ctx: { tool: string; estimatedCost?: string }) {
      const ready = await signer.isReady();
      if (!ready) {
        throw new Error("x402: connect wallet before paid tools — set X402_PRIVATE_KEY");
      }
      // If the host supports cost estimates, include them in the confirmation
      const cost = ctx.estimatedCost ?? "gateway quote";
      if (cost) {
        // Note: actual confirmation UI is delegated to the host.
        // This hook verifies the signer is ready; budget enforcement is host responsibility.
      }
    },
  };
}

/** Default export shape expected by opencode.json plugin loader */
export default function plugin() {
  return createOpenCodeX402Hooks({
    gatewayBaseUrl: process.env.X402_GATEWAY_URL ?? "http://127.0.0.1:8080",
    protocolVersion: 2,
    enabled: process.env.X402_ENABLED !== "false",
  });
}
