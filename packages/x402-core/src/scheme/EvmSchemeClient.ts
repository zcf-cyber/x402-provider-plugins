import type {
  PaymentPayloadContext,
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import type { X402Signer } from "../types.js";

/**
 * EVM scheme client implementing SchemeNetworkClient interface.
 *
 * Wraps an X402Signer to create payment payloads for EVM networks.
 * Used by x402Client to create payment signatures for x402 protocol.
 *
 * Extracted from client.ts to keep scheme logic independent of the
 * fetch wrapper and ProtocolHandler plumbing (Fix-P1-PR1 Phase 2).
 */
export class EvmSchemeClient implements SchemeNetworkClient {
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
