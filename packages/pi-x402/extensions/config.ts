import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONFIG_PATH = `${process.env.HOME}/.pi/x402-config.json`;

export interface X402Config {
  gatewayUrl: string;
  chainId: string;
  privateKey: string;
  providerId: string;
  discoveryUrl: string;
  allowlist: string;
}

const DEFAULTS: X402Config = {
  gatewayUrl: "http://127.0.0.1:8080",
  chainId: "eip155:8453",
  privateKey: "",
  providerId: "x402-gateway",
  discoveryUrl: "",
  allowlist: "*",
};

function readRawConfig(): Partial<X402Config> | null {
  try {
    const { existsSync, readFileSync } = require("node:fs");
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return null;
}

export function loadConfig(): X402Config {
  const raw = readRawConfig();
  return raw ? { ...DEFAULTS, ...raw } : { ...DEFAULTS };
}

export function saveConfig(partial: Partial<X402Config>): void {
  const { existsSync, writeFileSync, mkdirSync } = require("node:fs");
  const { dirname } = require("node:path");
  const merged = { ...loadConfig(), ...partial };
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");
}

const FLAG_MAP: Record<keyof X402Config, { flag: string; env: string } | null> = {
  gatewayUrl: { flag: "x402-gateway-url", env: "X402_GATEWAY_URL" },
  chainId: { flag: "x402-chain-id", env: "X402_CHAIN_ID" },
  privateKey: { flag: "x402-private-key", env: "X402_PRIVATE_KEY" },
  providerId: { flag: "x402-provider-id", env: "X402_PROVIDER_ID" },
  discoveryUrl: { flag: "x402-discovery-url", env: "X402_DISCOVERY_URL" },
  allowlist: null,
};

export function resolveConfig(pi?: { getFlag?: (name: string) => string | undefined }): X402Config {
  const fileValues = readRawConfig();
  const getCli = (flag: string) => pi?.getFlag?.(flag);

  const resolve = (key: keyof X402Config): string => {
    const mapping = FLAG_MAP[key];
    const cliVal = mapping ? getCli(mapping.flag) : undefined;
    const fileVal = fileValues?.[key];
    const envVal = mapping ? process.env[mapping.env] : undefined;
    return cliVal ?? fileVal ?? envVal ?? DEFAULTS[key];
  };

  const allowlist = fileValues?.allowlist ?? process.env.X402_ALLOWLIST ?? DEFAULTS.allowlist;

  return {
    gatewayUrl: resolve("gatewayUrl"),
    chainId: resolve("chainId"),
    privateKey: resolve("privateKey"),
    providerId: resolve("providerId"),
    discoveryUrl: resolve("discoveryUrl"),
    allowlist,
  };
}

export function registerConfigUI(pi: ExtensionAPI): void {
  const registerFlag = (pi as Record<string, unknown>).registerFlag as ((name: string, opts: Record<string, unknown>) => void) | undefined;
  if (typeof registerFlag === "function") {
    const flags: [string, string][] = [
      ["x402-gateway-url", "x402 Gateway URL"],
      ["x402-chain-id", "Chain ID (e.g. eip155:8453)"],
      ["x402-private-key", "EVM private key for signing"],
      ["x402-provider-id", "Provider identifier"],
      ["x402-discovery-url", "Discovery service URL"],
    ];
    for (const [name, desc] of flags) registerFlag(name, { description: desc });
  }

  pi.registerCommand("x402-config", {
    description: "Configure x402 wallet and provider",
    handler: async (args: string[], ctx) => {
      const subCmd = args[0] ?? "";
      if (subCmd === "edit") await editWizard(ctx);
      else if (subCmd === "status") await showStatus(ctx);
      else ctx.ui?.notify?.("[x402] Usage: /x402-config edit | /x402-config status", "info");
    },
  });
}

async function editWizard(ctx: { ui?: { input?: (t: string, p: string) => Promise<string | undefined>; notify?: (m: string, l: string) => void } }): Promise<void> {
  const config = loadConfig();

  const gatewayUrl = ctx.ui?.input ? await ctx.ui.input("x402 Gateway URL", config.gatewayUrl) : undefined;
  const chainPrompt = ["eip155:8453  (Base)", "eip155:84532 (Sepolia)", "eip155:1     (Ethereum)", "", `Current: ${config.chainId}`].join("\n");
  const chainId = ctx.ui?.input ? await ctx.ui.input("Chain ID", chainPrompt) : undefined;
  const pkPlaceholder = config.privateKey ? `${config.privateKey.slice(0, 6)}...${config.privateKey.slice(-4)} (set)` : "0x... (not set)";
  const privateKey = ctx.ui?.input ? await ctx.ui.input("EVM Private Key", pkPlaceholder) : undefined;

  const updates: Partial<X402Config> = {};
  if (gatewayUrl !== undefined && gatewayUrl !== "") updates.gatewayUrl = gatewayUrl;
  if (chainId !== undefined && chainId !== "") updates.chainId = chainId;
  if (privateKey !== undefined && privateKey !== "") updates.privateKey = privateKey;

  if (Object.keys(updates).length > 0) {
    saveConfig(updates);
    ctx.ui?.notify?.("[x402] Configuration saved to ~/.pi/x402-config.json\nRun /reload to apply changes.", "info");
  } else {
    ctx.ui?.notify?.("[x402] No changes made.", "info");
  }
}

async function showStatus(ctx: { ui?: { notify?: (m: string, l: string) => void } }): Promise<void> {
  const config = resolveConfig();
  const pkDisplay = config.privateKey ? `${config.privateKey.slice(0, 6)}...${config.privateKey.slice(-4)}` : "(not set)";
  const lines = [
    "x402 Configuration Status",
    `Gateway URL  : ${config.gatewayUrl} ${config.privateKey ? "✓" : "✗"}`,
    `Provider ID  : ${config.providerId}`,
    `Chain ID     : ${config.chainId}`,
    `Private Key  : ${pkDisplay}`,
    `Config file  : ~/.pi/x402-config.json`,
  ];
  ctx.ui?.notify?.(lines.join("\n"), "info");
}
