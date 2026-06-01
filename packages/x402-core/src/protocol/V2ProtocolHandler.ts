import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { Network, SchemeNetworkClient } from "@x402/core/types";
import type { X402AuditSink } from "../types.js";
import type { ProtocolHandler } from "./ProtocolHandler.js";

/**
 * V2 x402 protocol handler wrapping @x402/fetch and @x402/core.
 *
 * Encapsulates scheme registration, x402Client lifecycle, HTTP client
 * creation, and audit hook wiring — previously spread across
 * createX402Fetch in client.ts.
 */
export class V2ProtocolHandler implements ProtocolHandler {
  private x402ClientInstance: x402Client;
  private httpClient: x402HTTPClient;

  constructor(
    networkId: string,
    protocolVersion: number,
    schemeClient: SchemeNetworkClient,
  ) {
    this.x402ClientInstance = new x402Client();

    if (protocolVersion === 1) {
      this.x402ClientInstance.registerV1(networkId, schemeClient);
    } else {
      this.x402ClientInstance.register(networkId as Network, schemeClient);
    }

    this.httpClient = new x402HTTPClient(this.x402ClientInstance);
  }

  /** Wrap the native fetch with 402 → payment → retry handling */
  wrapFetch(baseFetch: typeof fetch): typeof fetch {
    return wrapFetchWithPayment(baseFetch, this.httpClient);
  }

  /**
   * Register audit hooks for the full payment lifecycle.
   *
   * Hooks are registered ONCE on the x402Client instance (not per-request)
   * to prevent listener accumulation across multiple fetch calls.
   * The `getRequestId` closure provides per-request correlation.
   */
  registerAuditHooks(
    audit: X402AuditSink,
    getRequestId: () => string,
  ): void {
    this.x402ClientInstance.onAfterPaymentCreation(async (context) => {
      audit({
        at: new Date().toISOString(),
        requestId: getRequestId(),
        phase: "signed",
        detail: `payment created for ${context.paymentRequired.resource}`,
      });
    });

    this.x402ClientInstance.onPaymentResponse(async (context) => {
      const phase = context.settleResponse
        ? context.settleResponse.success
          ? "settled"
          : "error"
        : "retry";
      audit({
        at: new Date().toISOString(),
        requestId: getRequestId(),
        phase,
        detail: phase === "error" ? "payment failed" : `payment ${phase}`,
      });
    });
  }
}
