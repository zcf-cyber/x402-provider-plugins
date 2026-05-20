/**
 * OpenCode plugin entry (FR-O1, FR-O2).
 * @see https://open-code.ai/docs/plugins
 *
 * M3: replace stubs with host `Plugin` contract from @opencode-ai/plugin.
 */
import { createX402Fetch, type X402ClientConfig, type X402Signer } from "@x402-plugins/core";

export interface OpenCodeX402PluginConfig extends X402ClientConfig {
  /** When true, wrap outbound model fetch with x402 payment flow */
  enabled?: boolean;
}

/** Stub signer — replace with wallet module in M2 */
export const stubSigner: X402Signer = {
  address: process.env.X402_WALLET_ADDRESS ?? "0x0000000000000000000000000000000000000000",
  chainId: process.env.X402_CHAIN_ID ?? "eip155:8453",
  async isReady() {
    return Boolean(process.env.X402_WALLET_ADDRESS);
  },
  async signPayment() {
    throw new Error("x402: stubSigner — implement wallet signing (M2)");
  },
};

export function createOpenCodeX402Hooks(config: OpenCodeX402PluginConfig) {
  const x402Fetch = createX402Fetch(config, stubSigner);

  return {
    name: "@x402-plugins/opencode-x402",
    version: "0.1.0",

    /** Called by host before model/provider HTTP — inject wrapped fetch */
    async onProviderRequest(init: RequestInit): Promise<RequestInit> {
      if (config.enabled === false) return init;
      return {
        ...init,
        // M3: host-specific hook to use x402Fetch as transport
        headers: {
          ...(init.headers as Record<string, string>),
          "x-x402-plugin": "opencode-x402/0.1.0",
        },
      };
    },

    async toolExecuteBefore(_ctx: { tool: string }) {
      if (!(await stubSigner.isReady())) {
        throw new Error("x402: connect wallet before paid tools (FR-W1)");
      }
    },

    /** Exposed for integration tests */
    x402Fetch,
  };
}

/** Default export shape expected by opencode.json plugin loader (M3 align with host) */
export default function plugin() {
  return createOpenCodeX402Hooks({
    gatewayBaseUrl: process.env.X402_GATEWAY_URL ?? "http://127.0.0.1:8080",
    protocolVersion: 2,
    enabled: process.env.X402_ENABLED !== "false",
  });
}
