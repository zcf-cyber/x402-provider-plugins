import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type {
  Network,
  PaymentPayloadContext,
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import type { X402AuditSink, X402ClientConfig, X402Signer } from "./types.js";

/**
 * EVM scheme client implementing SchemeNetworkClient interface.
 *
 * Wraps an X402Signer to create payment payloads for EVM networks.
 * Used by x402Client to create payment signatures for x402 protocol.
 */
class EvmSchemeClient implements SchemeNetworkClient {
  readonly scheme: string;
  private signer: X402Signer;

  constructor(scheme: string, signer: X402Signer) {
    this.scheme = scheme;
    this.signer = signer;
  }

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
    context?: PaymentPayloadContext,
  ): Promise<PaymentPayloadResult> {
    const ready = await this.signer.isReady();
    if (!ready) {
      throw new Error(
        "x402: signer not ready — set X402_PRIVATE_KEY environment variable",
      );
    }

    const paymentRequired = this.buildPaymentRequired(
      x402Version,
      paymentRequirements,
      context,
    );

    const signatureHeaders = await this.signer.signPayment(paymentRequired);
    const signature =
      signatureHeaders["PAYMENT-SIGNATURE"] || signatureHeaders["X-PAYMENT"];

    if (!signature) {
      throw new Error("x402: signer did not return a valid signature header");
    }

    return {
      x402Version,
      payload: { signature },
    };
  }

  private buildPaymentRequired(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
    context?: PaymentPayloadContext,
  ): Record<string, unknown> {
    const acceptsEntry: Record<string, unknown> = {
      network: paymentRequirements.network,
      scheme: paymentRequirements.scheme,
      payTo: paymentRequirements.payTo,
      amount: paymentRequirements.amount,
      asset: paymentRequirements.asset,
      maxTimeoutSeconds: paymentRequirements.maxTimeoutSeconds,
    };

    const extra = paymentRequirements.extra as
      | Record<string, unknown>
      | undefined;
    if (extra?.maxAmountRequired) {
      acceptsEntry.maxAmountRequired = extra.maxAmountRequired;
    }
    if (extra?.resource) {
      acceptsEntry.resource = extra.resource;
    }

    return {
      x402Version,
      accepts: [acceptsEntry],
      extensions: context?.extensions,
    };
  }
}

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

  // Create x402Client with scheme registration
  const x402ClientInstance = new x402Client();

  if (protocolVersion === 1) {
    x402ClientInstance.registerV1(networkId, schemeClient);
  } else {
    // Cast to Network type which expects `${string}:${string}` format
    x402ClientInstance.register(networkId as Network, schemeClient);
  }

  // Create HTTP client wrapper
  const httpClient = new x402HTTPClient(x402ClientInstance);

  // Wrap the base fetch with payment handling
  const wrappedFetch = wrapFetchWithPayment(baseFetch, httpClient);

  // Return a fetch function with timeout and retry logic
  return async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Awaited<ReturnType<typeof fetch>>> => {
    const requestId = generateRequestId();

    // Register audit hook if provided (moved inside to share requestId)
    if (audit) {
      x402ClientInstance.onAfterPaymentCreation(async (context) => {
        audit({
          at: new Date().toISOString(),
          requestId, // Use the same requestId for correlation
          phase: "signed",
          detail: `payment created for ${context.paymentRequired.resource}`,
        });
      });

      x402ClientInstance.onPaymentResponse(async (context) => {
        const phase = context.settleResponse
          ? context.settleResponse.success
            ? "settled"
            : "error"
          : "retry";
        audit({
          at: new Date().toISOString(),
          requestId, // Use the same requestId for correlation
          phase,
          detail: phase === "error" ? "payment failed" : `payment ${phase}`,
        });
      });
    }

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
