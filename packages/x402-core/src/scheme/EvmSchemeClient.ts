import type {
  PaymentPayloadContext,
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import type { X402Signer } from "../types.js";
import type { MessageBuilder } from "../message/MessageBuilder.js";
import { TemplateMessageBuilder } from "../message/TemplateMessageBuilder.js";

/**
 * EVM scheme client implementing SchemeNetworkClient interface.
 *
 * Wraps an X402Signer to create payment payloads for EVM networks.
 * Used by x402Client to create payment signatures for x402 protocol.
 *
 * Extracted from client.ts to keep scheme logic independent of the
 * fetch wrapper and ProtocolHandler plumbing (Fix-P1-PR1 Phase 2).
 *
 * Phase 3: message body construction delegated to pluggable MessageBuilder.
 */
export class EvmSchemeClient implements SchemeNetworkClient {
  readonly scheme: string;
  private signer: X402Signer;
  private messageBuilder: MessageBuilder;

  constructor(
    scheme: string,
    signer: X402Signer,
    messageBuilder?: MessageBuilder,
  ) {
    this.scheme = scheme;
    this.signer = signer;
    this.messageBuilder = messageBuilder ?? new TemplateMessageBuilder();
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

    const paymentRequired = this.messageBuilder.buildMessage(
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
}
