import type { PaymentPayloadContext, PaymentRequirements } from "@x402/core/types";

/**
 * Abstraction for building payment-required message bodies.
 *
 * Decouples message construction from the signing scheme so that different
 * message formats (x402 V2, V1, or custom) can be plugged in without
 * modifying EvmSchemeClient or ProtocolHandler code.
 */
export interface MessageBuilder {
  /**
   * Build a payment-required message body from requirements and context.
   *
   * @param x402Version - protocol version (1 or 2)
   * @param paymentRequirements - scheme-resolved payment requirements
   * @param context - optional context with server-declared extensions
   * @returns the message body to be passed to the signer
   */
  buildMessage(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
    context?: PaymentPayloadContext,
  ): Record<string, unknown>;
}
