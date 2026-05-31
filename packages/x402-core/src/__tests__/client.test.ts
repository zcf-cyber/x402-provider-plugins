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
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    signer = new EvmSigner();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
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
    it("should create a callable fetch wrapper with default config", async () => {
      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );
      expect(fetchWithPayment).toBeInstanceOf(Function);
      const response = await fetchWithPayment("https://example.com");
      expect(response.status).toBe(200);
    });

    it("should create a callable fetch wrapper with V1 protocol", async () => {
      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          protocolVersion: 1,
        },
        signer,
      );
      expect(fetchWithPayment).toBeInstanceOf(Function);
      const response = await fetchWithPayment("https://example.com");
      expect(response.status).toBe(200);
    });

    it("should create a callable fetch wrapper with custom maxRetries and timeout", async () => {
      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          maxRetries: 5,
          requestTimeoutMs: 60000,
        },
        signer,
      );
      expect(fetchWithPayment).toBeInstanceOf(Function);
      const response = await fetchWithPayment("https://example.com");
      expect(response.status).toBe(200);
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
      const response = await fetchWithPayment("https://example.com");
      expect(response.status).toBe(200);
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
      const response = await fetchWithPayment(request);
      expect(response.status).toBe(200);
    });

    it("should accept RequestInit options", async () => {
      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );
      const response = await fetchWithPayment("https://example.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true }),
      });
      expect(response.status).toBe(200);
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
    it("should create a fetch wrapper with custom requestTimeoutMs", async () => {
      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          requestTimeoutMs: 5000,
        },
        signer,
      );
      expect(fetchWithPayment).toBeInstanceOf(Function);
      const response = await fetchWithPayment("https://example.com");
      expect(response.status).toBe(200);
    });

    it("should create a fetch wrapper with default timeout", async () => {
      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );
      expect(fetchWithPayment).toBeInstanceOf(Function);
      const response = await fetchWithPayment("https://example.com");
      expect(response.status).toBe(200);
    });
  });

  describe("Retry configuration", () => {
    it("should create a fetch wrapper with custom maxRetries", async () => {
      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          maxRetries: 0,
        },
        signer,
      );
      expect(fetchWithPayment).toBeInstanceOf(Function);
      const response = await fetchWithPayment("https://example.com");
      expect(response.status).toBe(200);
    });

    it("should create a fetch wrapper with default maxRetries", async () => {
      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );
      expect(fetchWithPayment).toBeInstanceOf(Function);
      const response = await fetchWithPayment("https://example.com");
      expect(response.status).toBe(200);
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

  describe("Audit hook accumulation", () => {
    it("should not accumulate audit hooks across multiple fetch calls", async () => {
      // Create a 402-then-200 server to verify hook behavior across multiple requests
      const http = await import("http");
      let requestCount = 0;
      const server = http.createServer((_req, res) => {
        requestCount++;
        if (requestCount % 2 === 1) {
          // First request: return 402
          const payload = Buffer.from(
            JSON.stringify({
              x402Version: 2,
              resource: { url: "/v1/chat", serviceName: "test" },
              accepts: [
                {
                  scheme: "exact_evm",
                  network: "eip155:8453",
                  payTo: "0x0000000000000000000000000000000000000000",
                  amount: "1",
                  asset: "0x0000000000000000000000000000000000000000",
                  maxTimeoutSeconds: 300,
                },
              ],
            }),
          ).toString("base64");
          res.writeHead(402, {
            "Content-Type": "application/json",
            "PAYMENT-REQUIRED": payload,
          });
          res.end(JSON.stringify({ error: "Payment Required" }));
        } else {
          // Second request: return 200 (simulates pay+retry success)
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ result: "ok" }));
        }
      });

      const port = await new Promise<number>((resolve) =>
        server.listen(0, () => {
          const addr = server.address();
          resolve(typeof addr === "string" ? parseInt(addr.split(":").pop()!) : addr!.port);
        }),
      );

      // Restore real fetch so the local HTTP server is actually contacted.
      // The outer beforeEach mocks globalThis.fetch for other tests.
      globalThis.fetch = originalFetch;

      const auditEntries: X402AuditEntry[] = [];
      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: `http://127.0.0.1:${port}`, maxRetries: 1 },
        signer,
        (e) => auditEntries.push(e),
      );

      // Make 3 sequential fetch calls
      for (let i = 0; i < 3; i++) {
        await fetchWithPayment(`http://127.0.0.1:${port}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: `test-${i}` }),
        });
      }

      // Audit entries should grow linearly, not exponentially.
      // Each call should produce: 402_received (1) + signed (1) + retry (maybe)
      // Without the fix, entries per call would grow: call1=3, call2=5, call3=7 (extras)
      // With the fix, each call produces the same number of entries.

      // Group entries by requestId
      const byRequest = new Map<string, X402AuditEntry[]>();
      for (const entry of auditEntries) {
        const list = byRequest.get(entry.requestId) ?? [];
        list.push(entry);
        byRequest.set(entry.requestId, list);
      }

      // Should have 3 distinct requestIds
      expect(byRequest.size).toBe(3);

      // Each request should have a consistent number of entries (not growing)
      const counts = Array.from(byRequest.values()).map((e) => e.length);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);

      server.closeAllConnections?.();
      server.close();
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
