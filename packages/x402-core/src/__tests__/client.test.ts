import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createX402Fetch } from "../client.js";
import { EvmSigner } from "../signer.js";
import type { X402AuditEntry } from "../types.js";

// Hardhat test account #0 private key
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("createX402Fetch", () => {
  const originalEnv = process.env;
  let signer: EvmSigner;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("X402_PRIVATE_KEY", TEST_PRIVATE_KEY);
    vi.stubEnv("X402_CHAIN_ID", "eip155:8453");

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;

    signer = new EvmSigner();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("Basic functionality", () => {
    it("should create a fetch function", async () => {
      mockFetch.mockResolvedValue(
        new Response('{"result": "ok"}', { status: 200 }),
      );

      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );

      expect(typeof fetchWithPayment).toBe("function");
    });

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
  });

  describe("Audit sink", () => {
    it("should call audit sink with 402_received phase", async () => {
      const auditEntries: X402AuditEntry[] = [];
      const auditSink = (entry: X402AuditEntry) => {
        auditEntries.push(entry);
      };

      // Mock fetch to return 402 then 200
      mockFetch
        .mockRejectedValueOnce(new Error("402 Payment Required"))
        .mockResolvedValueOnce(new Response('{"ok": true}', { status: 200 }));

      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
        auditSink,
      );

      // We expect this to fail due to retry logic, but audit should be called
      try {
        await fetchWithPayment("https://gateway.example.com/v1/chat");
      } catch {
        // Expected to fail
      }

      // Should have at least the initial 402_received event
      expect(auditEntries.length).toBeGreaterThanOrEqual(1);
      expect(auditEntries[0].phase).toBe("402_received");
      expect(auditEntries[0].requestId).toBeDefined();
    });
  });

  describe("Configuration options", () => {
    it("should accept V1 protocol version", async () => {
      mockFetch.mockResolvedValue(new Response('{"ok": true}', { status: 200 }));

      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          protocolVersion: 1,
        },
        signer,
      );

      expect(typeof fetchWithPayment).toBe("function");
    });

    it("should accept maxRetries configuration", async () => {
      mockFetch.mockRejectedValue(new Error("402 Payment Required"));

      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          maxRetries: 1,
        },
        signer,
      );

      // Should throw after retries are exhausted
      await expect(
        fetchWithPayment("https://gateway.example.com/v1/chat"),
      ).rejects.toThrow();
    });

    it("should accept requestTimeoutMs configuration", async () => {
      // Create a slow response
      mockFetch.mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Timeout")), 200);
          }),
      );

      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          requestTimeoutMs: 100,
        },
        signer,
      );

      await expect(
        fetchWithPayment("https://gateway.example.com/v1/chat"),
      ).rejects.toThrow();
    });
  });

  describe("Error handling", () => {
    it("should handle non-402 errors", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );

      await expect(
        fetchWithPayment("https://gateway.example.com/v1/chat"),
      ).rejects.toThrow("Network error");
    });

    it("should handle Request object input", async () => {
      mockFetch.mockResolvedValue(new Response('{"ok": true}', { status: 200 }));

      const fetchWithPayment = createX402Fetch(
        { gatewayBaseUrl: "https://gateway.example.com" },
        signer,
      );

      const request = new Request("https://gateway.example.com/v1/chat");
      const response = await fetchWithPayment(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Retry behavior", () => {
    it("should retry on 402 errors up to maxRetries", async () => {
      mockFetch.mockRejectedValue(new Error("402 Payment Required"));

      const fetchWithPayment = createX402Fetch(
        {
          gatewayBaseUrl: "https://gateway.example.com",
          maxRetries: 2,
        },
        signer,
      );

      await expect(
        fetchWithPayment("https://gateway.example.com/v1/chat"),
      ).rejects.toThrow();

      // Should be called 3 times: initial + 2 retries
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
