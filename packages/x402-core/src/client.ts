import type { X402AuditSink, X402ClientConfig, X402Signer } from "./types.js";

/**
 * Creates a fetch function that handles HTTP 402 and official x402 headers
 * via @x402/fetch once scheme clients are wired to the signer.
 *
 * M1: replace stub with wrapFetchWithPayment from @x402/fetch.
 */
export function createX402Fetch(
  config: X402ClientConfig,
  signer: X402Signer,
  audit?: X402AuditSink,
): typeof fetch {
  const baseFetch = globalThis.fetch.bind(globalThis);

  return async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Awaited<ReturnType<typeof fetch>>> => {
    const requestId = crypto.randomUUID();
    audit?.({
      at: new Date().toISOString(),
      requestId,
      phase: "402_received",
      detail: `gateway=${config.gatewayBaseUrl} v=${config.protocolVersion ?? 2}`,
    });

    if (!(await signer.isReady())) {
      throw new Error(
        "x402: wallet signer not ready — connect wallet before paid requests (FR-CORE / FR-W1)",
      );
    }

    // TODO(M1): import { wrapFetchWithPayment } from "@x402/fetch"
    // and bind ExactEvmScheme / Solana scheme from @x402/core to signer.
    const response = await baseFetch(input, init);

    if (response.status === 402) {
      audit?.({ at: new Date().toISOString(), requestId, phase: "402_received" });
      // Stub: real implementation parses PAYMENT-REQUIRED and retries with PAYMENT-SIGNATURE
      throw new Error(
        "x402: received 402 — wire @x402/fetch in M1 (packages/x402-core/src/client.ts)",
      );
    }

    return response;
  };
}
