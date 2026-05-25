import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyMessage } from "viem";
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
    it("should return PAYMENT-SIGNATURE header with cryptographically valid signature", async () => {
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

      const result = await signer.signPayment(paymentRequired);

      expect(result).toHaveProperty("PAYMENT-SIGNATURE");
      expect(typeof result["PAYMENT-SIGNATURE"]).toBe("string");
      expect(result["PAYMENT-SIGNATURE"]).toMatch(/^0x[a-fA-F0-9]+$/);

      // Verify the signature cryptographically recovers the signer's address
      const expectedMessage = [
        "x402 Payment Authorization",
        "Version: 2",
        "Network: eip155:8453",
        "PayTo: 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
        "Amount: 1000000",
        "Asset: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "Resource: /v1/chat/completions",
        "Timeout: 300s",
        `Chain: ${signer.chainId}`,
      ].join("\n");

      const isValid = await verifyMessage({
        address: TEST_ADDRESS as `0x${string}`,
        message: expectedMessage,
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

    it("should produce deterministic signature for same payload", async () => {
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

      // Without timestamp, same payload must produce identical signatures
      expect(result1["PAYMENT-SIGNATURE"]).toBe(result2["PAYMENT-SIGNATURE"]);
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

      const result = await signer.signPayment(paymentRequired);

      expect(result).toHaveProperty("PAYMENT-SIGNATURE");
      expect(result["PAYMENT-SIGNATURE"]).toMatch(/^0x[a-fA-F0-9]+$/);

      // Verify maxAmountRequired appears in the signed message
      const expectedMessage = [
        "x402 Payment Authorization",
        "Version: 1",
        "Network: base-sepolia",
        "PayTo: 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
        "MaxAmount: 1000000",
        "Resource: /v1/chat/completions",
        `Chain: ${signer.chainId}`,
      ].join("\n");

      const isValid = await verifyMessage({
        address: TEST_ADDRESS as `0x${string}`,
        message: expectedMessage,
        signature: result["PAYMENT-SIGNATURE"] as `0x${string}`,
      });

      expect(isValid).toBe(true);
    });
  });
});
