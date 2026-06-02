import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";
import type { X402Signer } from "./types.js";

/**
 * EVM wallet signer implementing the X402Signer interface.
 *
 * Reads the private key from an explicit parameter first, then falls back
 * to the X402_PRIVATE_KEY environment variable. Uses personal_sign message
 * signing for x402 payment authorization.
 *
 * @example
 * ```typescript
 * // From env var
 * const signer = new EvmSigner("eip155:8453");
 * // From explicit key
 * const signer2 = new EvmSigner("eip155:8453", "0xabc...");
 * if (await signer.isReady()) {
 *   const signature = await signer.signPayment(paymentRequired);
 * }
 * ```
 */
export class EvmSigner implements X402Signer {
  private account: PrivateKeyAccount | null = null;
  private _address: string = "";
  private _chainId: string;

  constructor(
    chainId: string = process.env.X402_CHAIN_ID ?? "eip155:8453",
    privateKey?: string | null,
  ) {
    this._chainId = chainId;
    this.loadKey(privateKey);
  }

  /**
   * Update the private key at runtime (e.g. after TUI configuration).
   * Pass null to clear the key and revert to env var lookup.
   */
  setPrivateKey(key: string | null): void {
    this.loadKey(key);
  }

  /**
   * Load the private key with priority: explicit key > environment variable.
   * When passed a non-null key, tries it first; falls back to env var on failure.
   * When passed null or undefined, reads from X402_PRIVATE_KEY env var.
   */
  private loadKey(explicitKey?: string | null): void {
    const candidateKey = explicitKey ?? process.env.X402_PRIVATE_KEY;
    const privateKey = candidateKey ?? undefined;
    if (!privateKey) {
      this.account = null;
      this._address = "";
      return;
    }

    try {
      const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
      this.account = privateKeyToAccount(key as `0x${string}`);
      this._address = this.account.address;
    } catch {
      this.account = null;
      this._address = "";
    }
  }

  get address(): string {
    return this._address;
  }

  get chainId(): string {
    return this._chainId;
  }

  async isReady(): Promise<boolean> {
    return this.account !== null;
  }

  /**
   * Sign a payment authorization message using personal_sign.
   * Returns a PAYMENT-SIGNATURE header record for x402 retry.
   * @throws If the signer is not ready.
   */
  async signPayment(
    paymentRequiredRaw: unknown,
  ): Promise<Record<string, string>> {
    if (!this.account) {
      throw new Error(
        "x402: signer not ready — set X402_PRIVATE_KEY environment variable",
      );
    }

    const message = this.createSignMessage(paymentRequiredRaw);
    const signature = await this.account.signMessage({ message });

    return {
      "PAYMENT-SIGNATURE": signature,
    };
  }

  private createSignMessage(paymentRequiredRaw: unknown): string {
    if (!paymentRequiredRaw || typeof paymentRequiredRaw !== "object") {
      throw new Error("x402: invalid payment requirements — expected object");
    }

    const req = paymentRequiredRaw as Record<string, unknown>;
    const parts: string[] = ["x402 Payment Authorization"];

    if (req.x402Version !== undefined) {
      parts.push(`Version: ${String(req.x402Version)}`);
    }

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

    if (req.expires_at) parts.push(`Expires: ${String(req.expires_at)}`);
    if (req.challenge_token)
      parts.push(`Challenge: ${String(req.challenge_token)}`);

    parts.push(`Chain: ${this._chainId}`);

    return parts.join("\n");
  }
}
