import type { X402AuditSink, X402ClientConfig, X402Signer } from "./types.js";
import { V2ProtocolHandler } from "./protocol/V2ProtocolHandler.js";
import { EvmSchemeClient } from "./scheme/EvmSchemeClient.js";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";
import type { Network } from "@x402/core/types";
import type { ClientEvmSigner } from "@x402/evm";

/**
 * Creates a fetch function that handles HTTP 402 and official x402 headers
 * via @x402/fetch with scheme clients wired to the signer.
 *
 * Uses official @x402/evm ExactEvmScheme when a viem ClientEvmSigner
 * is provided (enabling standards-compliant EIP-3009 signed authorization).
 * Falls back to EvmSchemeClient for backward-compatible X402Signer usage.
 *
 * @example
 * ```typescript
 * const signer = new EvmSigner("eip155:8453");
 * const fetchWithPayment = createX402Fetch(
 *   { gatewayBaseUrl: "https://gateway.example.com" },
 *   signer
 * );
 * // Or with viem account directly:
 * // const fetchWithPayment = createX402Fetch(config, signer.getViemAccount());
 * ```
 */
export function createX402Fetch(
  config: X402ClientConfig,
  signer: X402Signer | ClientEvmSigner,
  audit?: X402AuditSink,
): typeof fetch {
  const baseFetch = globalThis.fetch.bind(globalThis);
  const protocolVersion = config.protocolVersion ?? 2;
  const maxRetries = config.maxRetries ?? 3;
  const requestTimeoutMs = config.requestTimeoutMs ?? 30000;

  // Resolve whether we have a viem ClientEvmSigner (has signTypedData)
  const viemAccount = resolveViemAccount(signer);

  let wrappedFetch: typeof fetch;
  let currentRequestId = "";

  if (viemAccount) {
    // Use official @x402/evm ExactEvmScheme for standards-compliant EIP-3009 signing
    const x402ClientInstance = new x402Client();
    const evmScheme = new ExactEvmScheme(viemAccount);
    const networkId = getNetworkId(signer, protocolVersion);
    x402ClientInstance.register(networkId, evmScheme);
    const httpClient = new x402HTTPClient(x402ClientInstance);
    wrappedFetch = wrapFetchWithPayment(baseFetch, httpClient);

    if (audit) {
      x402ClientInstance.onAfterPaymentCreation(async (context) => {
        audit({
          at: new Date().toISOString(),
          requestId: currentRequestId,
          phase: "signed",
          detail: `payment created for ${context.paymentRequired.resource?.url ?? "unknown"}`,
        });
      });
      x402ClientInstance.onPaymentResponse(async (context) => {
        const phase = context.settleResponse?.success ? "settled" : "error";
        audit({
          at: new Date().toISOString(),
          requestId: currentRequestId,
          phase,
          detail: phase === "error" ? "payment failed" : `payment ${phase}`,
        });
      });
    }
  } else {
    // Backward-compatible path: use EvmSchemeClient with updated signer
    // (EvmSigner.signPayment now uses signTypedData per EIP-3009 standard)
    const x402Signer = signer as X402Signer;
    const schemeClient = new EvmSchemeClient("exact_evm", x402Signer);
    const networkId = getNetworkId(signer, protocolVersion);
    const protocolHandler = new V2ProtocolHandler(networkId, protocolVersion, schemeClient);
    wrappedFetch = protocolHandler.wrapFetch(baseFetch);
    if (audit) {
      protocolHandler.registerAuditHooks(audit, () => currentRequestId);
    }
  }

  return async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Awaited<ReturnType<typeof fetch>>> => {
    const requestId = generateRequestId();
    currentRequestId = requestId;

    // Check readiness for X402Signer interface
    if (isX402Signer(signer) && !(await signer.isReady())) {
      throw new Error(
        "x402: wallet signer not ready — connect wallet before paid requests (FR-CORE / FR-W1)",
      );
    }

    audit?.({
      at: new Date().toISOString(),
      requestId,
      phase: "402_received",
      detail: `gateway=${config.gatewayBaseUrl} v=${protocolVersion}`,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const mergedInit: RequestInit = {
        ...init,
        signal: init?.signal
          ? abortOnAnySignal(controller.signal, init.signal)
          : controller.signal,
      };

      let lastError: Error | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await wrappedFetch(input, mergedInit);
          return response;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt === maxRetries) break;
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
            await delay(1000 * Math.pow(2, attempt));
            continue;
          }
          throw lastError;
        }
      }
      throw lastError || new Error(`x402: max retries (${maxRetries}) exceeded`);
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

/** 
 * Detect if signer is a raw viem ClientEvmSigner (not our X402Signer wrapper).
 * EvmSigner (implements X402Signer) goes through the backward-compat path
 * which uses EvmSchemeClient with "exact_evm" scheme name.
 * Pure viem accounts go through the official ExactEvmScheme ("exact") path.
 */
function resolveViemAccount(signer: X402Signer | ClientEvmSigner): ClientEvmSigner | null {
  // X402Signer interface takes priority — use backward-compatible EvmSchemeClient
  if (isX402Signer(signer)) return null;
  // Raw viem account with signTypedData → use official ExactEvmScheme
  if (typeof signer === "object" && signer !== null && "signTypedData" in signer) {
    return signer as ClientEvmSigner;
  }
  return null;
}

/** Type guard for X402Signer */
function isX402Signer(s: unknown): s is X402Signer {
  return typeof s === "object" && s !== null && "isReady" in s;
}

function generateRequestId(): string {
  return crypto.randomUUID();
}

function getNetworkId(
  signer: X402Signer | ClientEvmSigner,
  protocolVersion: number,
): Network {
  const chainId = isX402Signer(signer)
    ? signer.chainId
    : "eip155:8453";

  if (protocolVersion === 1) {
    return "base" as Network;
  }
  return chainId as Network;
}

function abortOnAnySignal(signal1: AbortSignal, signal2: AbortSignal): AbortSignal {
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
