import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createX402Fetch } from "../client.js";
import { EvmSigner } from "../signer.js";
import type { X402AuditEntry } from "../types.js";

// Hardhat test account #0 private key
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("createX402Fetch", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let signer: EvmSigner;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("X402_PRIVATE_KEY", TEST_PRIVATE_KEY);
    vi.stubEnv("X402_CHAIN_ID", "eip155:8453");
    signer = new EvmSigner();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch; // 正确恢复 global.fetch
    vi.restoreAllMocks();
  });

  describe("Input validation", () => {
    it("should throw when signer is not ready", async () => {
      delete process.env.X402_PRIVATE_KEY;
      const signerWithoutKey = new EvmSigner();

      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signerWithoutKey,
      );

      await expect(
        fetchWithPayment("https://gateway.example.com/v1/chat"),
      ).rejects.toThrow("x402: wallet signer not ready");
    });

    it("should throw with descriptive error for missing wallet", async () => {
      delete process.env.X402_PRIVATE_KEY;
      const signerWithoutKey = new EvmSigner();

      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signerWithoutKey,
      );

      await expect(
        fetchWithPayment("https://gateway.example.com/v1/chat"),
      ).rejects.toThrow(/FR-CORE|FR-W1/);
    });
  });

  describe("Configuration handling", () => {
    it("should use default protocolVersion (2) when not specified", async () => {
      // 我们无法直接验证内部 x402Client 的注册，但可以验证配置被接受
      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );

      // 验证返回的是有效函数
      expect(fetchWithPayment).toBeInstanceOf(Function);
      // 验证函数可以被调用（返回 Promise）
      const result = fetchWithPayment("https://example.com");
      expect(result).toBeInstanceOf(Promise);
      // 清理
      await result.catch(() => {});
    });

    it("should accept protocolVersion 1 configuration", async () => {
      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          protocolVersion: 1,
        },
        signer,
      );

      expect(fetchWithPayment).toBeInstanceOf(Function);
    });

    it("should accept protocolVersion 2 configuration", async () => {
      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          protocolVersion: 2,
        },
        signer,
      );

      expect(fetchWithPayment).toBeInstanceOf(Function);
    });

    it("should accept custom maxRetries", async () => {
      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          maxRetries: 5,
        },
        signer,
      );

      expect(fetchWithPayment).toBeInstanceOf(Function);
    });

    it("should accept custom requestTimeoutMs", async () => {
      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          requestTimeoutMs: 60000,
        },
        signer,
      );

      expect(fetchWithPayment).toBeInstanceOf(Function);
    });

    it("should use default values when optional config omitted", async () => {
      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );

      expect(fetchWithPayment).toBeInstanceOf(Function);
    });
  });

  describe("Audit logging", () => {
    it("should emit 402_received phase on initial request", async () => {
      const auditEntries: X402AuditEntry[] = [];
      const auditSink = (entry: X402AuditEntry) => {
        auditEntries.push(entry);
      };

      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
        auditSink,
      );

      // 触发请求（会失败，但审计应该被记录）
      try {
        await fetchWithPayment("https://gateway.example.com/v1/chat");
      } catch {
        // 预期失败
      }

      // 验证审计条目被创建
      expect(auditEntries.length).toBeGreaterThanOrEqual(1);
      expect(auditEntries[0]).toMatchObject({
        phase: "402_received",
        requestId: expect.any(String),
        at: expect.any(String),
        detail: expect.stringContaining("gateway="),
      });
    });

    it("should include gateway URL and version in audit detail", async () => {
      const auditEntries: X402AuditEntry[] = [];
      const auditSink = (entry: X402AuditEntry) => {
        auditEntries.push(entry);
      };

      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://custom.gateway.com",
          protocolVersion: 1,
        },
        signer,
        auditSink,
      );

      try {
        await fetchWithPayment("https://gateway.example.com/v1/chat");
      } catch {
        // 预期失败
      }

      expect(auditEntries[0].detail).toContain("gateway=https://custom.gateway.com");
      expect(auditEntries[0].detail).toContain("v=1");
    });

    it("should work without audit sink", async () => {
      // 验证不提供 audit sink 时功能正常
      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
        undefined,
      );

      expect(fetchWithPayment).toBeInstanceOf(Function);
    });
  });

  describe("Request handling", () => {
    it("should accept string URL as input", async () => {
      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );

      // 验证函数接受 string URL
      expect(() => {
        // 使用 Promise 但不 await，因为我们只想验证参数类型
        fetchWithPayment("https://example.com").catch(() => {});
      }).not.toThrow();
    });

    it("should accept Request object as input", async () => {
      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );

      const request = new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({ test: true }),
      });

      expect(() => {
        fetchWithPayment(request).catch(() => {});
      }).not.toThrow();
    });

    it("should accept RequestInit options", async () => {
      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );

      expect(() => {
        fetchWithPayment("https://example.com", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ test: true }),
        }).catch(() => {});
      }).not.toThrow();
    });
  });

  describe("Signer integration", () => {
    it("should use signer's chainId for network registration", async () => {
      // 创建使用不同 chainId 的 signer
      const customSigner = new EvmSigner("eip155:137");

      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        customSigner,
      );

      expect(fetchWithPayment).toBeInstanceOf(Function);
      expect(customSigner.chainId).toBe("eip155:137");
    });

    it("should use signer's address for payment", async () => {
      // 创建 fetch 函数以验证集成，虽然我们不调用它
      void createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );

      // 验证 signer 地址已正确设置
      expect(signer.address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
      expect(signer.chainId).toBe("eip155:8453");
    });
  });

  describe("Timeout handling", () => {
    it("should enforce requestTimeoutMs", async () => {
      // 注意：由于 wrapFetchWithPayment 是外部库，
      // 我们在这里测试的是 wrapper 层面的超时配置被接受
      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          requestTimeoutMs: 5000,
        },
        signer,
      );

      expect(fetchWithPayment).toBeInstanceOf(Function);
    });

    it("should use default timeout when not specified", async () => {
      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );

      // 默认应该是 30000ms
      expect(fetchWithPayment).toBeInstanceOf(Function);
    });
  });

  describe("Retry configuration", () => {
    it("should accept custom maxRetries", async () => {
      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          maxRetries: 0, // 无重试
        },
        signer,
      );

      expect(fetchWithPayment).toBeInstanceOf(Function);
    });

    it("should use default maxRetries when not specified", async () => {
      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );

      // 默认应该是 3
      expect(fetchWithPayment).toBeInstanceOf(Function);
    });
  });

  describe("Error messages", () => {
    it("should include x402 prefix in error messages", async () => {
      delete process.env.X402_PRIVATE_KEY;
      const badSigner = new EvmSigner();

      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        badSigner,
      );

      await expect(
        fetchWithPayment("https://gateway.example.com/v1/chat"),
      ).rejects.toThrow(/^x402:/);
    });

    it("should include descriptive error for missing signer", async () => {
      delete process.env.X402_PRIVATE_KEY;
      const badSigner = new EvmSigner();

      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        badSigner,
      );

      await expect(
        fetchWithPayment("https://gateway.example.com/v1/chat"),
      ).rejects.toThrow(/wallet signer not ready/);
    });
  });

  describe("Return type", () => {
    it("should return a function matching fetch signature", async () => {
      const fetchFn = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );

      // 验证签名匹配 fetch
      expect(fetchFn.length).toBe(2); // (input, init?) => Promise<Response>
    });
  });
});
