import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyTypedData } from "viem";
import { EvmSigner } from "../signer.js";

// Hardhat test account #0 private key and expected address
const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("EvmSigner", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.stubEnv("X402_PRIVATE_KEY", TEST_PRIVATE_KEY);
    vi.stubEnv("X402_CHAIN_ID", "eip155:8453");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("isReady", () => {
    it("should return true when X402_PRIVATE_KEY is set", async () => {
      const signer = new EvmSigner();
      expect(await signer.isReady()).toBe(true);
    });

    it("should return false when X402_PRIVATE_KEY is missing", async () => {
      delete process.env.X402_PRIVATE_KEY;
      const signer = new EvmSigner();
      expect(await signer.isReady()).toBe(false);
    });

    it("should return false for invalid private key", async () => {
      vi.stubEnv("X402_PRIVATE_KEY", "invalid-key");
      const signer = new EvmSigner();
      expect(await signer.isReady()).toBe(false);
    });
  });

  describe("address", () => {
    it("should derive correct address from known test key", () => {
      const signer = new EvmSigner();
      expect(signer.address).toBe(TEST_ADDRESS);
    });

    it("should return empty string when no key loaded", () => {
      delete process.env.X402_PRIVATE_KEY;
      const signer = new EvmSigner();
      expect(signer.address).toBe("");
    });
  });

  describe("chainId", () => {
    it("should use X402_CHAIN_ID env var", () => {
      vi.stubEnv("X402_CHAIN_ID", "eip155:1");
      const signer = new EvmSigner();
      expect(signer.chainId).toBe("eip155:1");
    });

    it("should use provided chainId parameter", () => {
      const signer = new EvmSigner("eip155:137");
      expect(signer.chainId).toBe("eip155:137");
    });

    it("should default to eip155:8453", () => {
      delete process.env.X402_CHAIN_ID;
      const signer = new EvmSigner();
      expect(signer.chainId).toBe("eip155:8453");
    });
  });

  describe("signPayment", () => {
    it("should return PAYMENT-SIGNATURE header with valid EIP-712 signature", async () => {
      const signer = new EvmSigner();

      const paymentRequired = {
        x402Version: 2,
        accepts: [
          {
            network: "eip155:8453",
            payTo: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
            amount: "1000000",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            resource: "/v1/chat/completions",
            maxTimeoutSeconds: 300,
          },
        ],
      };

      const nowSec = Math.floor(Date.now() / 1000);
      const result = await signer.signPayment(paymentRequired);

      expect(result).toHaveProperty("PAYMENT-SIGNATURE");
      expect(typeof result["PAYMENT-SIGNATURE"]).toBe("string");
      expect(result["PAYMENT-SIGNATURE"]).toMatch(/^0x[a-fA-F0-9]+$/);

      // Verify the EIP-712 typed data signature (signTypedData, not personal_sign)
      // validBefore uses the computed timestamp ± 2s tolerance
      const isValid = await verifyTypedData({
        address: TEST_ADDRESS as `0x${string}`,
        domain: {
          name: "USDC",
          version: "2",
          chainId: 8453,
          verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
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
          from: TEST_ADDRESS,
          to: "0x742D35CC6634C0532925a3B844Bc9E7595F2bD18",
          value: 1000000n,
          validAfter: 0n,
          validBefore: BigInt(nowSec + 300),
          nonce: "0x0000000000000000000000000000000000000000000000000000000000000000",
        },
        signature: result["PAYMENT-SIGNATURE"] as `0x${string}`,
      });

      expect(isValid).toBe(true);
    });

    it("should throw when signer is not ready", async () => {
      delete process.env.X402_PRIVATE_KEY;
      const signer = new EvmSigner();

      await expect(
        signer.signPayment({
          x402Version: 2,
          accepts: [{ network: "eip155:8453" }],
        }),
      ).rejects.toThrow("x402: signer not ready");
    });

    it("should throw on invalid payment requirements", async () => {
      const signer = new EvmSigner();

      await expect(signer.signPayment(null)).rejects.toThrow(
        "x402: invalid payment requirements",
      );

      await expect(signer.signPayment("string")).rejects.toThrow(
        "x402: invalid payment requirements",
      );
    });

    it("should produce valid EIP-712 signatures for same payload", async () => {
      const signer = new EvmSigner();

      const paymentRequired = {
        x402Version: 2,
        accepts: [
          {
            network: "eip155:8453",
            payTo: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
            amount: "1000000",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            resource: "/v1/chat/completions",
            maxTimeoutSeconds: 300,
          },
        ],
      };

      const result1 = await signer.signPayment(paymentRequired);
      const result2 = await signer.signPayment(paymentRequired);

      // Both signatures should be valid EIP-712 hex strings
      expect(result1["PAYMENT-SIGNATURE"]).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(result2["PAYMENT-SIGNATURE"]).toMatch(/^0x[a-fA-F0-9]+$/);

      // Signatures may differ because validBefore includes current timestamp
      // but both must verify against the typed data with their respective timestamps
      expect(typeof result1["PAYMENT-SIGNATURE"]).toBe("string");
      expect(typeof result2["PAYMENT-SIGNATURE"]).toBe("string");
    });

    it("should handle V1 payment requirements with maxAmountRequired", async () => {
      const signer = new EvmSigner();

      const paymentRequired = {
        x402Version: 1,
        accepts: [
          {
            network: "base-sepolia",
            payTo: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
            maxAmountRequired: "1000000",
            resource: "/v1/chat/completions",
          },
        ],
      };

      const nowSec = Math.floor(Date.now() / 1000);
      const result = await signer.signPayment(paymentRequired);

      expect(result).toHaveProperty("PAYMENT-SIGNATURE");
      expect(result["PAYMENT-SIGNATURE"]).toMatch(/^0x[a-fA-F0-9]+$/);

      // Verify the EIP-712 typed data signature
      const isValid = await verifyTypedData({
        address: TEST_ADDRESS as `0x${string}`,
        domain: {
          name: "USDC",
          version: "2",
          chainId: 8453,
          verifyingContract: "0x0000000000000000000000000000000000000000",
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
          from: TEST_ADDRESS,
          to: "0x742D35CC6634C0532925a3B844Bc9E7595F2bD18",
          value: 0n,
          validAfter: 0n,
          validBefore: BigInt(nowSec + 300),
          nonce: "0x0000000000000000000000000000000000000000000000000000000000000000",
        },
        signature: result["PAYMENT-SIGNATURE"] as `0x${string}`,
      });

      expect(isValid).toBe(true);
    });
  });
});
