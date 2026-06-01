import type { X402AuditSink, X402ClientConfig, X402Signer } from "./types.js";
import { V2ProtocolHandler } from "./protocol/V2ProtocolHandler.js";
import { EvmSchemeClient } from "./scheme/EvmSchemeClient.js";

/**
 * Creates a fetch function that handles HTTP 402 and official x402 headers
 * via @x402/fetch with scheme clients wired to the signer.
 *
 * Wraps the native fetch to automatically handle 402 Payment Required responses
 * by creating and sending payment headers. Supports both V1 and V2 x402 protocol.
 *
 * @param config - Client configuration including gateway URL and protocol version
 * @param signer - The X402Signer implementation for signing payments
 * @param audit - Optional audit sink for logging payment flow events
 * @returns A wrapped fetch function that handles 402 responses automatically
 *
 * @example
 * ```typescript
 * const signer = new EvmSigner("eip155:8453");
 * const fetchWithPayment = createX402Fetch(
 *   { gatewayBaseUrl: "https://gateway.example.com" },
 *   signer
 * );
 *
 * const response = await fetchWithPayment("https://gateway.example.com/v1/chat");
 * ```
 */
export function createX402Fetch(
  config: X402ClientConfig,
  signer: X402Signer,
  audit?: X402AuditSink,
): typeof fetch {
  const baseFetch = globalThis.fetch.bind(globalThis);
  const protocolVersion = config.protocolVersion ?? 2;
  const maxRetries = config.maxRetries ?? 3;
  const requestTimeoutMs = config.requestTimeoutMs ?? 30000;

  // Create the scheme client wrapping the signer
  // Use "exact_evm" as the scheme name for EVM payments
  const schemeClient = new EvmSchemeClient("exact_evm", signer);

  // Determine the network identifier based on protocol version
  const networkId = getNetworkId(signer.chainId, protocolVersion);

  // Delegate protocol plumbing to V2ProtocolHandler
  const protocolHandler = new V2ProtocolHandler(
    networkId,
    protocolVersion,
    schemeClient,
  );

  // Wrap the base fetch with 402 → pay → retry handling
  const wrappedFetch = protocolHandler.wrapFetch(baseFetch);

  // Per-request context for audit correlation.
  // Updated before each call so hooks reference the current requestId.
  let currentRequestId = "";

  // Register audit hooks once at creation time (not per-request) to prevent accumulation.
  // Uses currentRequestId closure for per-request correlation.
  if (audit) {
    protocolHandler.registerAuditHooks(audit, () => currentRequestId);
  }

  // Return a fetch function with timeout and retry logic
  return async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Awaited<ReturnType<typeof fetch>>> => {
    const requestId = generateRequestId();
    // Update the shared requestId so hooks reference the current request
    currentRequestId = requestId;

    // Check if signer is ready before making request
    if (!(await signer.isReady())) {
      throw new Error(
        "x402: wallet signer not ready — connect wallet before paid requests (FR-CORE / FR-W1)",
      );
    }

    // Emit initial audit event
    audit?.({
      at: new Date().toISOString(),
      requestId,
      phase: "402_received",
      detail: `gateway=${config.gatewayBaseUrl} v=${protocolVersion}`,
    });

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, requestTimeoutMs);

    try {
      // Merge signal with user-provided init if any
      const mergedInit: RequestInit = {
        ...init,
        signal: init?.signal
          ? // If user provided a signal, we need to handle both
            abortOnAnySignal(controller.signal, init.signal)
          : controller.signal,
      };

      let lastError: Error | undefined;

      // Retry loop
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await wrappedFetch(input, mergedInit);

          // If we got here, the request succeeded (either no 402 or payment succeeded)
          return response;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          // Don't retry on the last attempt
          if (attempt === maxRetries) {
            break;
          }

          // Only retry on 402 or network errors
          if (
            lastError.message.includes("402") ||
            lastError.message.includes("Payment Required") ||
            lastError.message.includes("network") ||
            lastError.message.includes("timeout")
          ) {
            audit?.({
              at: new Date().toISOString(),
              requestId,
              phase: "retry",
              detail: `attempt ${attempt + 1}/${maxRetries}`,
            });
            // Wait a bit before retrying (exponential backoff)
            await delay(1000 * Math.pow(2, attempt));
            continue;
          }

          // For other errors, throw immediately
          throw lastError;
        }
      }

      // All retries exhausted
      throw (
        lastError ||
        new Error(`x402: max retries (${maxRetries}) exceeded`)
      );
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

/**
 * Generate a unique request ID for audit logging.
 */
function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Get the network identifier for x402 client registration.
 *
 * For V2: uses CAIP-2 format (eip155:8453)
 * For V1: uses simplified format (base-sepolia)
 */
function getNetworkId(chainId: string, protocolVersion: number): string {
  if (protocolVersion === 1) {
    // V1 uses simplified network identifiers
    if (chainId === "eip155:8453") {
      return "base";
    }
    if (chainId === "eip155:84532") {
      return "base-sepolia";
    }
    // Extract chain ID number from CAIP-2 format
    const match = chainId.match(/eip155:(\d+)/);
    if (match) {
      // Map common chain IDs to V1 names
      const chainNum = match[1];
      if (chainNum === "1") return "ethereum";
      if (chainNum === "137") return "polygon";
      if (chainNum === "42161") return "arbitrum";
      if (chainNum === "10") return "optimism";
      // Note: 8453 (base) and 84532 (base-sepolia) are already handled above
    }
    return chainId.replace("eip155:", "");
  }

  // V2 uses CAIP-2 format directly
  return chainId;
}

/**
 * Create an abort signal that aborts when either signal aborts.
 */
function abortOnAnySignal(
  signal1: AbortSignal,
  signal2: AbortSignal,
): AbortSignal {
  const controller = new AbortController();

  const onAbort = () => {
    controller.abort();
    signal1.removeEventListener("abort", onAbort);
    signal2.removeEventListener("abort", onAbort);
  };

  if (signal1.aborted || signal2.aborted) {
    controller.abort();
    return controller.signal;
  }

  signal1.addEventListener("abort", onAbort);
  signal2.addEventListener("abort", onAbort);

  return controller.signal;
}

/**
 * Delay for a specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
