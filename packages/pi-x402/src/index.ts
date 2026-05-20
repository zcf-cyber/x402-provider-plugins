/**
 * Programmatic exports for bundling Pi extensions (optional).
 */
export const PI_EXTENSION_PATHS = {
  provider: new URL("../extensions/x402-provider.ts", import.meta.url).pathname,
  wallet: new URL("../extensions/x402-wallet.ts", import.meta.url).pathname,
  discovery: new URL("../extensions/x402-discovery.ts", import.meta.url).pathname,
} as const;
