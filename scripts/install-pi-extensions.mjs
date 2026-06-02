#!/usr/bin/env node
/**
 * Symlink Pi extensions into ~/.pi/agent/extensions/
 * Usage: npm run install:pi-extensions
 */
import { cpSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
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

// Also symlink @x402-plugins/core so Pi can resolve imports
const corePkgPath = join(root, "packages", "x402-core");
const piModuleDir = join(homedir(), ".pi", "agent", "node_modules", "@x402-plugins");
mkdirSync(piModuleDir, { recursive: true });
const coreSymlink = join(piModuleDir, "core");
if (!existsSync(coreSymlink)) {
  symlinkSync(corePkgPath, coreSymlink, "dir");
  console.log(`linked @x402-plugins/core → ${corePkgPath}`);
} else {
  console.log(`@x402-plugins/core already linked`);
}

// Also copy profile.ts to ~/.pi/agent/src/ so extensions can import from ../src/profile.js
const profileSrc = join(root, "packages", "pi-x402", "src", "profile.ts");
const piSrcDir = join(homedir(), ".pi", "agent", "src");
mkdirSync(piSrcDir, { recursive: true });
cpSync(profileSrc, join(piSrcDir, "profile.ts"), { force: true });
console.log(`installed profile to ${piSrcDir}/profile.ts`);
