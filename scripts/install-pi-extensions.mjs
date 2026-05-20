#!/usr/bin/env node
/**
 * Symlink Pi extensions into ~/.pi/agent/extensions/
 * Usage: npm run install:pi-extensions
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "packages", "pi-x402", "extensions");
const destDir = join(homedir(), ".pi", "agent", "extensions");

const files = ["x402-provider.ts", "x402-wallet.ts", "x402-discovery.ts"];

mkdirSync(destDir, { recursive: true });

for (const file of files) {
  const src = join(srcDir, file);
  const dest = join(destDir, file);
  if (!existsSync(src)) {
    console.error(`missing: ${src}`);
    process.exit(1);
  }
  cpSync(src, dest, { force: true });
  console.log(`installed ${dest}`);
}

console.log("\nReload in Pi with /reload or restart pi.");
