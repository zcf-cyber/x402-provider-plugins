/**
 * Runtime-agnostic x402 configuration.
 * Header encode/decode is delegated to @x402/core and @x402/fetch.
 */

export type X402ProtocolVersion = 1 | 2;

export interface X402ClientConfig {
  /** Base URL of your x402-gateway or resource server */
  gatewayBaseUrl: string;
  protocolVersion?: X402ProtocolVersion;
  requestTimeoutMs?: number;
  maxRetries?: number;
}

/**
 * Signs payment payloads for PAYMENT-SIGNATURE (V2) or X-PAYMENT (V1).
 * Implement with local key, hardware wallet, or remote signer service.
 */
export interface X402Signer {
  readonly address: string;
  readonly chainId: string;
  /** Returns true when the signer can authorize payments */
  isReady(): Promise<boolean>;
  /**
   * Build scheme-specific payment authorization from 402 requirements.
   * @param paymentRequiredRaw - decoded or raw PAYMENT-REQUIRED / body from 402 response
   */
  signPayment(paymentRequiredRaw: unknown): Promise<Record<string, string>>;
}

export interface X402AuditEntry {
  at: string;
  requestId: string;
  phase: "402_received" | "signed" | "retry" | "settled" | "error";
  detail?: string;
}

export type X402AuditSink = (entry: X402AuditEntry) => void;
