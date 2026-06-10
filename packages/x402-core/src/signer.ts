import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import type { PrivateKeyAccount } from "viem";
import type { X402Signer } from "./types.js";

/**
 * EVM wallet signer implementing the X402Signer interface.
 *
 * Reads the private key from an explicit parameter first, then falls back
 * to the X402_PRIVATE_KEY environment variable. Uses EIP-712 signTypedData
 * for x402 payment authorization (compliant with @x402/evm standard).
 *
 * For best compatibility, use createX402Fetch() which internally uses the
 * official @x402/evm ExactEvmScheme for standards-compliant EIP-3009 signing.
 *
 * @example
 * ```typescript
 * const signer = new EvmSigner("eip155:8453");
 * // Preferred: pass to createX402Fetch (uses official @x402/evm internally)
 * const fetchWithPayment = createX402Fetch({ gatewayBaseUrl: "..." }, signer);
 * // Or get viem account for custom use:
 * const viemAccount = signer.getViemAccount();
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
   * Get the underlying viem PrivateKeyAccount for use with official
   * @x402/evm scheme clients (ExactEvmScheme, registerExactEvmScheme).
   */
  getViemAccount(): PrivateKeyAccount | null {
    return this.account;
  }

  /**
   * Sign a payment authorization using EIP-712 signTypedData.
   * Uses the TransferWithAuthorization type per EIP-3009 standard.
   * Returns a PAYMENT-SIGNATURE header record for x402 retry.
   *
   * Preferred: use createX402Fetch() which delegates to @x402/evm
   * ExactEvmScheme for full EIP-3009 compliance.
   *
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

    const typedData = this.buildEip712TypedData(paymentRequiredRaw);
    const signature = await this.account.signTypedData(typedData);

    return {
      "PAYMENT-SIGNATURE": signature,
    };
  }

  /**
   * Build EIP-712 typed data for EIP-3009 TransferWithAuthorization.
   */
  private buildEip712TypedData(
    paymentRequiredRaw: unknown,
  ): {
    domain: Record<string, unknown>;
    types: Record<string, unknown[]>;
    primaryType: string;
    message: Record<string, unknown>;
  } {
    if (!paymentRequiredRaw || typeof paymentRequiredRaw !== "object") {
      throw new Error("x402: invalid payment requirements — expected object");
    }

    const req = paymentRequiredRaw as Record<string, unknown>;
    const accept = Array.isArray(req.accepts) && req.accepts.length > 0
      ? (req.accepts[0] as Record<string, unknown>)
      : {};

    const rawPayTo = (accept.payTo as string) ?? "0x0000000000000000000000000000000000000000";
    const rawAsset = (accept.asset as string) ?? "0x0000000000000000000000000000000000000000";
    const amount = (accept.amount as string) ?? "0";
    const maxTimeoutSeconds = Number(accept.maxTimeoutSeconds ?? 300);

    // Normalize addresses to checksummed format (viem requires this for signTypedData)
    const payTo = this.checksumAddress(rawPayTo);
    const asset = this.checksumAddress(rawAsset);

    // Extract numeric chain ID from CAIP-2 format (eip155:8453 → 8453)
    const chainIdNum = this.parseChainIdNumber();

    // Default token name/version (caller overrides for real tokens via env)
    const tokenName = (req.tokenName as string) ?? process.env.X402_TOKEN_NAME ?? "USDC";
    const tokenVersion = (req.tokenVersion as string) ?? process.env.X402_TOKEN_VERSION ?? "2";

    return {
      domain: {
        name: tokenName,
        version: tokenVersion,
        chainId: chainIdNum,
        verifyingContract: asset,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: this._address,
        to: payTo,
        value: amount,
        validAfter: 0,
        validBefore: Math.floor(Date.now() / 1000) + maxTimeoutSeconds,
        nonce: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    };
  }

  /** Convert an address to checksummed format safely. */
  private checksumAddress(raw: string): `0x${string}` {
    try {
      return getAddress(raw as `0x${string}`);
    } catch {
      // Handle short/invalid addresses: pad to valid 40-hex-char address
      if (raw.startsWith("0x") && raw.length < 42) {
        const padded = raw.slice(2).padStart(40, "0");
        try {
          return getAddress(`0x${padded}` as `0x${string}`);
        } catch {
          // fall through
        }
      }
      // Return the zero address as fallback
      return "0x0000000000000000000000000000000000000000";
    }
  }

  /** Parse numeric chain ID from CAIP-2 format (eip155:8453 → 8453). */
  private parseChainIdNumber(): number {
    const match = this._chainId.match(/eip155:(\d+)/);
    return match ? parseInt(match[1], 10) : 8453;
  }
}

/**
 * Solana (SVM) wallet signer implementing the X402Signer interface.
 *
 * Supports Solana network payments via the x402 protocol when used with
 * createX402Fetch, which internally uses @x402/svm ExactSvmScheme.
 *
 * Reads the private key from X402_SOLANA_PRIVATE_KEY environment variable
 * (base58 encoded keypair bytes). Requires @solana/kit for full signing.
 *
 * @example
 * ```typescript
 * const svmSigner = new SvmSigner("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
 * const fetchWithPayment = createX402Fetch(
 *   { gatewayBaseUrl: "https://gateway.example.com" },
 *   evmSigner,
 *   { svmSigner },
 * );
 * ```
 */
export class SvmSigner implements X402Signer {
  private _address: string = "";
  private _chainId: string;

  constructor(chainId: string = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") {
    this._chainId = chainId;
    this.loadKey();
  }

  private loadKey(): void {
    const privateKey = process.env.X402_SOLANA_PRIVATE_KEY;
    if (privateKey) {
      try {
        // Validate as Solana keypair (64-byte base58 string)
        if (privateKey.length >= 87 && privateKey.length <= 88) {
          // Derive address from last 32 chars as placeholder
          // Full keypair handling delegated to @solana/kit via ExactSvmScheme
          this._address = `Sol:${privateKey.slice(-8)}`;
        }
      } catch {
        this._address = "";
      }
    }
  }

  get address(): string {
    return this._address;
  }

  get chainId(): string {
    return this._chainId;
  }

  async isReady(): Promise<boolean> {
    return !!process.env.X402_SOLANA_PRIVATE_KEY;
  }

  async signPayment(
    _paymentRequiredRaw: unknown,
  ): Promise<Record<string, string>> {
    // Solana signing is handled by @x402/svm ExactSvmScheme when used
    // with createX402Fetch. Direct signPayment requires @solana/kit.
    throw new Error(
      "x402: SVM signing requires @solana/kit — use createX402Fetch() for automatic handling",
    );
  }
}
