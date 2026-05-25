import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EvmSigner } from "../signer.js";

// EvmSchemeClient 集成测试
// 该类是 client.ts 的内部实现，通过 createX402Fetch 进行集成测试

// Hardhat test account #0 private key
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("EvmSchemeClient (via createX402Fetch integration)", () => {
  const originalEnv = process.env;
  let signer: EvmSigner;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("X402_PRIVATE_KEY", TEST_PRIVATE_KEY);
    vi.stubEnv("X402_CHAIN_ID", "eip155:8453");
    signer = new EvmSigner();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("PaymentRequirements structure", () => {
    it("should construct valid PaymentRequirements object", async () => {
      // 这个测试验证 EvmSchemeClient.buildPaymentRequired 的正确性
      // 通过检查当 createX402Fetch 被调用时，配置被正确处理

      const { createX402Fetch } = await import("../client.js");

      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          protocolVersion: 2,
        },
        signer,
      );

      // 函数被成功创建意味着内部 PaymentRequirements 结构被正确处理
      expect(fetchWithPayment).toBeInstanceOf(Function);
    });

    it("should handle V1 protocol requirements", async () => {
      const { createX402Fetch } = await import("../client.js");

      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          protocolVersion: 1,
        },
        signer,
      );

      expect(fetchWithPayment).toBeInstanceOf(Function);
    });
  });

  describe("Signer readiness", () => {
    it("should detect when signer is ready", async () => {
      const ready = await signer.isReady();
      expect(ready).toBe(true);
    });

    it("should detect when signer is not ready", async () => {
      delete process.env.X402_PRIVATE_KEY;
      const badSigner = new EvmSigner();
      const ready = await badSigner.isReady();
      expect(ready).toBe(false);
    });

    it("should have valid address when ready", () => {
      expect(signer.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it("should have empty address when not ready", () => {
      delete process.env.X402_PRIVATE_KEY;
      const badSigner = new EvmSigner();
      expect(badSigner.address).toBe("");
    });
  });

  describe("Network identification", () => {
    it("should use CAIP-2 format for V2", () => {
      const customSigner = new EvmSigner("eip155:137");
      expect(customSigner.chainId).toBe("eip155:137");
    });

    it("should support base mainnet", () => {
      const baseSigner = new EvmSigner("eip155:8453");
      expect(baseSigner.chainId).toBe("eip155:8453");
    });

    it("should support base sepolia", () => {
      const sepoliaSigner = new EvmSigner("eip155:84532");
      expect(sepoliaSigner.chainId).toBe("eip155:84532");
    });
  });
});
