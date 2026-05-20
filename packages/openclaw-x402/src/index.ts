/**
 * OpenClaw plugin entry (FR-CL1).
 * @see https://documentation.openclaw.ai/plugins/building-plugins
 *
 * M4: import definePluginEntry from openclaw/plugin-sdk/plugin-entry
 */
import { createX402Fetch, type X402ClientConfig, type X402Signer } from "@x402-plugins/core";

export interface OpenClawX402Config extends X402ClientConfig {
  providerId?: string;
}

const defaultSigner: X402Signer = {
  address: process.env.X402_WALLET_ADDRESS ?? "0x0000000000000000000000000000000000000000",
  chainId: process.env.X402_CHAIN_ID ?? "eip155:8453",
  async isReady() {
    return Boolean(process.env.X402_WALLET_ADDRESS);
  },
  async signPayment() {
    throw new Error("x402: implement OpenClaw wallet signer (M4)");
  },
};

/**
 * Plugin registration factory — wire to OpenClaw `register(api)` in M4.
 */
export function registerOpenClawX402(api: {
  registerProvider: (def: unknown) => void;
  log?: (msg: string) => void;
}, config: OpenClawX402Config): void {
  const providerId = config.providerId ?? "x402-gateway";
  const x402Fetch = createX402Fetch(config, defaultSigner);

  api.registerProvider({
    id: providerId,
    name: "X402 Gateway Provider",
    // M4: align with OpenClaw provider plugin schema
    config: {
      gatewayBaseUrl: config.gatewayBaseUrl,
      protocolVersion: config.protocolVersion ?? 2,
    },
    // Host will call this for inference attempts
    async runAttempt(_params: { prompt: string }) {
      api.log?.(`[x402] stub runAttempt — use x402Fetch: ${typeof x402Fetch}`);
      throw new Error("x402: implement runAttempt with @x402-plugins/core (M4)");
    },
  });

  api.log?.(`[x402] registered provider "${providerId}" (skeleton)`);
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
