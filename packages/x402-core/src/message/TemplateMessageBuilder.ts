import type { PaymentPayloadContext, PaymentRequirements } from "@x402/core/types";
import type { MessageBuilder } from "./MessageBuilder.js";

/**
 * Default x402 message builder producing standard V2 PaymentRequired bodies.
 *
 * Constructs a message body with `x402Version`, `accepts` array (derived
 * from payment requirements), and optional `extensions`. This is the same
 * logic previously embedded as a private method in EvmSchemeClient.
 */
export class TemplateMessageBuilder implements MessageBuilder {
  buildMessage(
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
