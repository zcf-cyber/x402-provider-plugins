#!/usr/bin/env node
/**
 * Mock x402 gateway for local integration testing.
 *
 * Standalone Node.js HTTP server (no external dependencies).
 * Simulates HTTP 402 Payment Required responses and validates
 * PAYMENT-SIGNATURE headers for the x402 protocol v2.
 *
 * Usage:
 *   node scripts/mock-gateway.mjs --port=8080 --require-amount=1000000
 */

import http from "http";
import crypto from "crypto";

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith("--port="))?.split("=")[1] ?? "8080";
const port = parseInt(portArg, 10);
if (isNaN(port) || port < 1 || port > 65535) {
  console.error(`x402: invalid port "${portArg}" — must be 1–65535`);
  process.exit(1);
}
const requireAmount =
  args.find((a) => a.startsWith("--require-amount="))?.split("=")[1] ??
  "1000000";

const PAY_TO = "0x0000000000000000000000000000000000000000";
const ASSET = "0x0000000000000000000000000000000000000000";
const NETWORK = "eip155:8453";

function log(method, pathname, status, note = "") {
  const ts = new Date().toISOString();
  const extra = note ? ` | ${note}` : "";
  console.log(`[${ts}] ${method} ${pathname} → ${status}${extra}`);
}

function createPaymentRequired() {
  const payload = {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact_evm",
        network: NETWORK,
        payTo: PAY_TO,
        amount: requireAmount,
        asset: ASSET,
        maxTimeoutSeconds: 300,
        extra: {
          quote_id: `mock-quote-${crypto.randomUUID()}`,
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          request_hash: "0x" + crypto.randomBytes(16).toString("hex"),
          challenge_token: `mock-challenge-${crypto.randomBytes(4).toString("hex")}`,
        },
      },
    ],
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function createChatCompletion() {
  return JSON.stringify({
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "x402-mock",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Hello from x402 mock gateway!",
        },
        finish_reason: "stop",
      },
    ],
  });
}

function isValidSignature(headerValue) {
  if (!headerValue || typeof headerValue !== "string") {
    return false;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(headerValue, "base64").toString("utf-8"),
    );
    return (
      decoded.payload &&
      typeof decoded.payload.signature === "string" &&
      decoded.payload.signature.startsWith("0x")
    );
  } catch {
    return false;
  }
}

/**
 * Process an incoming request through the x402 payment protocol.
 *
 * Encapsulates protocol logic (payment check, signature validation,
 * response construction) separately from HTTP transport — mirroring
 * the ProtocolHandler abstraction pattern from x402-core.
 *
 * @param {http.IncomingMessage} req
 * @returns {{ status: number, headers: Record<string, string>, body: string, note: string }}
 */
function processRequest(req) {
  const sig = req.headers["payment-signature"] || req.headers["x-payment"];

  if (!sig) {
    return {
      status: 402,
      headers: { "PAYMENT-REQUIRED": createPaymentRequired() },
      body: JSON.stringify({ error: "Payment required" }),
      note: "PAYMENT-REQUIRED",
    };
  }

  if (!isValidSignature(sig)) {
    return {
      status: 402,
      headers: { "PAYMENT-REQUIRED": createPaymentRequired() },
      body: JSON.stringify({ error: "Invalid payment signature" }),
      note: "INVALID-SIGNATURE",
    };
  }

  return {
    status: 200,
    headers: {},
    body: createChatCompletion(),
    note: "SETTLED",
  };
}

const server = http.createServer((req, res) => {
  const host = req.headers.host;
  if (!host) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing Host header" }));
    return;
  }

  let url;
  try {
    url = new URL(req.url, `http://${host}`);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid URL" }));
    return;
  }

  const result = processRequest(req);

  log(req.method, url.pathname, result.status, result.note);

  res.writeHead(result.status, {
    "Content-Type": "application/json",
    ...result.headers,
  });
  res.end(result.body);
});

server.listen(port, () => {
  console.log(`Mock x402 gateway listening on http://127.0.0.1:${port}`);
  console.log(
    `Endpoints: any path returns 402 → 200 on retry with PAYMENT-SIGNATURE`,
  );
});

server.timeout = 30000;
