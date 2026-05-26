import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { spawn } from "child_process";
import { createServer } from "http";
import type { ChildProcess } from "child_process";
import { createX402Fetch } from "../client.js";
import { EvmSigner } from "../signer.js";
import type { X402AuditEntry } from "../types.js";

const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const MOCK_GATEWAY_PORT = 18042;

function startMockGateway(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["scripts/mock-gateway.mjs", `--port=${MOCK_GATEWAY_PORT}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("Mock gateway startup timeout"));
    }, 5000);
    const onData = (data: Buffer) => {
      stdout += data.toString();
      if (stdout.includes("listening on")) {
        clearTimeout(timer);
        resolve(proc);
      }
      if (stdout.includes("EADDRINUSE")) {
        clearTimeout(timer);
        proc.kill();
        reject(new Error(`Port ${MOCK_GATEWAY_PORT} in use`));
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== null && code !== 0) reject(new Error(`Gateway exited ${code}`));
    });
  });
}

describe("x402-core integration against mock gateway", () => {
  let gatewayProc: ChildProcess;
  let signer: EvmSigner;
  const originalEnv = process.env;

  beforeAll(async () => {
    gatewayProc = await startMockGateway();
  }, 10000);

  afterAll(() => {
    if (gatewayProc && !gatewayProc.killed) gatewayProc.kill();
  });

  beforeEach(() => {
    vi.stubEnv("X402_PRIVATE_KEY", TEST_PRIVATE_KEY);
    vi.stubEnv("X402_CHAIN_ID", "eip155:8453");
    signer = new EvmSigner();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("completes 402 -> sign -> 200 end-to-end", async () => {
    const auditEntries: X402AuditEntry[] = [];
    const fetchWithPayment = createX402Fetch(
      { gatewayBaseUrl: `http://127.0.0.1:${MOCK_GATEWAY_PORT}` },
      signer,
      (e) => auditEntries.push(e),
    );

    const resp = await fetchWithPayment(
      `http://127.0.0.1:${MOCK_GATEWAY_PORT}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      },
    );

    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "Hello from x402 mock gateway!" } }],
    });

    const phases = auditEntries.map((e) => e.phase);
    expect(phases).toContain("402_received");
    expect(phases).toContain("signed");
    expect(phases).toContain("retry");
    expect(new Set(auditEntries.map((e) => e.requestId)).size).toBe(1);
  });

  it("handles permanent 402 (insufficient funds)", async () => {
    const server = createServer((_req, res) => {
      const payload = Buffer.from(
        JSON.stringify({
          x402Version: 2,
          accepts: [
            {
              scheme: "exact_evm",
              network: "eip155:8453",
              payTo: "0x0",
              amount: "1",
              asset: "0x0",
              maxTimeoutSeconds: 300,
            },
          ],
        }),
      ).toString("base64");
      res.writeHead(402, { "Content-Type": "application/json", "PAYMENT-REQUIRED": payload });
      res.end(JSON.stringify({ error: "Insufficient funds" }));
    });

    const port = await new Promise<number>((resolve) =>
      server.listen(0, () => {
        const addr = server.address();
        resolve(typeof addr === "string" ? parseInt(addr.split(":").pop()!) : addr!.port);
      }),
    );

    const auditEntries: X402AuditEntry[] = [];
    const fetchWithPayment = createX402Fetch(
      { gatewayBaseUrl: `http://127.0.0.1:${port}`, maxRetries: 0 },
      signer,
      (e) => auditEntries.push(e),
    );

    const resp = await fetchWithPayment(`http://127.0.0.1:${port}/v1/chat/completions`);
    expect(resp.status).toBe(402);

    const phases = auditEntries.map((e) => e.phase);
    expect(phases).toContain("402_received");
    expect(phases).toContain("signed");
    expect(phases).toContain("retry");

    server.closeAllConnections?.();
    server.close();
  });

  it("handles gateway timeout", async () => {
    const server = createServer(() => {
      // Never respond — forces AbortError after requestTimeoutMs
    });

    const port = await new Promise<number>((resolve) =>
      server.listen(0, () => {
        const addr = server.address();
        resolve(typeof addr === "string" ? parseInt(addr.split(":").pop()!) : addr!.port);
      }),
    );

    const fetchWithPayment = createX402Fetch(
      { gatewayBaseUrl: `http://127.0.0.1:${port}`, requestTimeoutMs: 300, maxRetries: 0 },
      signer,
    );

    await expect(
      fetchWithPayment(`http://127.0.0.1:${port}/v1/chat/completions`),
    ).rejects.toSatisfy((err: Error) => {
      // Must be an abort/timeout error, not a generic failure
      return (
        err.name === "AbortError" ||
        /aborted|timeout|signal/i.test(err.message)
      );
    });

    server.closeAllConnections?.();
    server.close();
  });
});
