#!/usr/bin/env node
/**
 * Cross-package integration smoke test.
 *
 * 1. Starts the mock x402 gateway.
 * 2. Runs the test suite for each package.
 * 3. Stops the mock gateway.
 * 4. Reports pass/fail summary.
 */

import { spawn } from "child_process";

const PACKAGES = ["x402-core", "pi-x402", "opencode-x402", "openclaw-x402"];

function startMockGateway(port) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["scripts/mock-gateway.mjs", `--port=${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const timer = setTimeout(() => { proc.kill(); reject(new Error("Gateway startup timeout")); }, 5000);
    const onData = (data) => {
      out += data.toString();
      if (out.includes("listening on")) { clearTimeout(timer); resolve({ proc, port }); }
      if (out.includes("EADDRINUSE")) { clearTimeout(timer); proc.kill(); reject(new Error("EADDRINUSE")); }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => { clearTimeout(timer); if (code) reject(new Error(`Gateway exited ${code}`)); });
  });
}

async function tryStartGateway() {
  for (let p = 18080; p <= 18085; p++) {
    try { return await startMockGateway(p); } catch (e) { if (e.message !== "EADDRINUSE") throw e; }
  }
  throw new Error("No available port found");
}

function runTests(pkg) {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["vitest", "run", `packages/${pkg}/src/__tests__/`], { stdio: "inherit" });
    proc.on("exit", (code) => resolve(code === 0));
  });
}

async function main() {
  console.log("=== x402 Cross-Package Smoke Test ===\n");

  let gateway;
  try {
    gateway = await tryStartGateway();
    console.log(`Mock gateway started on port ${gateway.port}\n`);
  } catch (err) {
    console.error(`Failed to start mock gateway: ${err.message}`);
    process.exit(1);
  }

  const results = [];
  for (const pkg of PACKAGES) {
    console.log(`\n--- Running tests for ${pkg} ---`);
    results.push({ pkg, passed: await runTests(pkg) });
  }

  console.log("\n--- Stopping mock gateway ---");
  if (gateway.proc && !gateway.proc.killed) gateway.proc.kill();

  console.log("\n=== Smoke Test Summary ===");
  let allPassed = true;
  for (const { pkg, passed } of results) {
    console.log(`  ${pkg}: ${passed ? "PASS" : "FAIL"}`);
    if (!passed) allPassed = false;
  }

  console.log(`\nOverall: ${allPassed ? "ALL GREEN" : "SOME FAILED"}`);
  process.exit(allPassed ? 0 : 1);
}

main();
