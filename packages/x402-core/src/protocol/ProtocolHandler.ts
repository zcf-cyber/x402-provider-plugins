import type { X402AuditSink } from "../types.js";

/**
 * Protocol-level abstraction for x402 payment flow integration.
 *
 * Decouples the x402 protocol plumbing from the fetch wrapper so that
 * different protocol versions, mock handlers, and test doubles can be
 * injected without touching client.ts.
 */
export interface ProtocolHandler {
  /** Wrap a base fetch function with 402 → pay → retry handling */
  wrapFetch(baseFetch: typeof fetch): typeof fetch;

  /** Register lifecycle hooks for audit / observability */
  registerAuditHooks(
    audit: X402AuditSink,
    getRequestId: () => string,
  ): void;
}
