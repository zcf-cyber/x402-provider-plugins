import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";
import type { X402Signer } from "./types.js";

/**
 * EVM wallet signer implementing the X402Signer interface.
 *
 * Reads the private key from the X402_PRIVATE_KEY environment variable
 * and derives the Ethereum address. Uses personal_sign message signing
 * for x402 payment authorization.
 *
 * @example
 * ```typescript
 * const signer = new EvmSigner("eip155:8453");
 * if (await signer.isReady()) {
 *   const signature = await signer.signPayment(paymentRequired);
 * }
 * ```
 */
export class EvmSigner implements X402Signer {
  private account: PrivateKeyAccount | null = null;
  private _address: string = "";
  private _chainId: string;

  constructor(chainId: string = process.env.X402_CHAIN_ID ?? "eip155:8453") {
    this._chainId = chainId;
    this.loadKey();
  }

  /**
   * Load the private key from environment variable.
   */
  private loadKey(): void {
    const privateKey = process.env.X402_PRIVATE_KEY;
    if (!privateKey) {
      this.account = null;
      this._address = "";
      return;
    }

    try {
      // Ensure proper hex format with 0x prefix
      const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
      this.account = privateKeyToAccount(key as `0x${string}`);
      this._address = this.account.address;
    } catch {
      this.account = null;
      this._address = "";
    }
  }

  /**
   * The Ethereum address derived from the private key.
   */
  get address(): string {
    return this._address;
  }

  /**
   * The CAIP-2 chain identifier (e.g., "eip155:8453").
   */
  get chainId(): string {
    return this._chainId;
  }

  /**
   * Returns true when the signer has a valid private key loaded
   * and can derive an address.
   */
  async isReady(): Promise<boolean> {
    return this.account !== null;
  }

  /**
   * Sign a payment authorization message.
   *
   * Takes the raw PAYMENT-REQUIRED content and produces a signature
   * suitable for the PAYMENT-SIGNATURE header.
   *
   * The returned key is always "PAYMENT-SIGNATURE" regardless of protocol
   * version; header name mapping belongs to the caller (P0-PR2).
   *
   * @param paymentRequiredRaw - The decoded PAYMENT-REQUIRED header or body
   * @returns A record with the PAYMENT-SIGNATURE header
   * @throws If the signer is not ready or signing fails
   */
  async signPayment(
    paymentRequiredRaw: unknown,
  ): Promise<Record<string, string>> {
    if (!this.account) {
      throw new Error(
        "x402: signer not ready — set X402_PRIVATE_KEY environment variable",
      );
    }

    // Create a deterministic message to sign from the payment requirements
    const message = this.createSignMessage(paymentRequiredRaw);

    // Sign using personal_sign (compatible with most wallets and relayers)
    const signature = await this.account.signMessage({ message });

    return {
      "PAYMENT-SIGNATURE": signature,
    };
  }

  /**
   * Create a human-readable message from payment requirements for signing.
   *
   * This creates a structured message that can be verified by the gateway.
   */
  private createSignMessage(paymentRequiredRaw: unknown): string {
    if (!paymentRequiredRaw || typeof paymentRequiredRaw !== "object") {
      throw new Error("x402: invalid payment requirements — expected object");
    }

    const req = paymentRequiredRaw as Record<string, unknown>;

    // Build a deterministic string from the payment requirements
    const parts: string[] = ["x402 Payment Authorization"];

    if (req.x402Version !== undefined) {
      parts.push(`Version: ${String(req.x402Version)}`);
    }

    // Handle accepts array (V2 format)
    if (Array.isArray(req.accepts)) {
      for (const accept of req.accepts) {
        if (accept && typeof accept === "object") {
          const a = accept as Record<string, unknown>;
          if (a.network) parts.push(`Network: ${String(a.network)}`);
          if (a.payTo) parts.push(`PayTo: ${String(a.payTo)}`);
          if (a.amount) parts.push(`Amount: ${String(a.amount)}`);
          if (a.maxAmountRequired)
            parts.push(`MaxAmount: ${String(a.maxAmountRequired)}`);
          if (a.asset) parts.push(`Asset: ${String(a.asset)}`);
          if (a.resource) parts.push(`Resource: ${String(a.resource)}`);
          if (a.maxTimeoutSeconds)
            parts.push(`Timeout: ${String(a.maxTimeoutSeconds)}s`);
        }
      }
    }

    // Add replay-protection fields from payment requirements if available
    if (req.expires_at) parts.push(`Expires: ${String(req.expires_at)}`);
    if (req.challenge_token)
      parts.push(`Challenge: ${String(req.challenge_token)}`);

    // Add chain ID for replay protection
    parts.push(`Chain: ${this._chainId}`);

    return parts.join("\n");
  }
}
