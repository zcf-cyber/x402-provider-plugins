/**
 * x402 Configuration Manager — persists to ~/.pi/x402-config.json.
 * Priority: CLI flags > config file > environment variables > defaults.
 * Supports CLI flags, TUI wizard (/x402-config edit), and CLI status (/x402-config status).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── Types & Constants ────────────────────────────────────────

export interface X402Config {
  gatewayUrl: string;
  chainId: string;
  privateKey: string;
  providerUrl: string;
  modelName: string;
  discoveryUrl: string;
  allowlist: string;
}

const CONFIG_PATH = join(homedir(), ".pi", "x402-config.json");

const DEFAULTS: X402Config = {
  gatewayUrl: "http://127.0.0.1:8080",
  chainId: "eip155:8453",
  privateKey: "",
  providerUrl: "",
  modelName: "",
  discoveryUrl: "",
  allowlist: "*",
};

// ── File I/O ─────────────────────────────────────────────────

function readRawConfig(): Partial<X402Config> | null {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<X402Config>;
    }
  } catch { /* corrupted — treat as missing */ }
  return null;
}

export function loadConfig(): X402Config {
  const raw = readRawConfig();
  return raw ? { ...DEFAULTS, ...raw } : { ...DEFAULTS };
}

export function saveConfig(partial: Partial<X402Config>): void {
  const merged = { ...loadConfig(), ...partial };
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");
}

// ── Resolution ───────────────────────────────────────────────

const FLAG_MAP: Record<keyof X402Config, { flag: string; env: string } | null> = {
  gatewayUrl: { flag: "x402-gateway-url", env: "X402_GATEWAY_URL" },
  chainId: { flag: "x402-chain-id", env: "X402_CHAIN_ID" },
  privateKey: { flag: "x402-private-key", env: "X402_PRIVATE_KEY" },
  providerUrl: { flag: "x402-provider-url", env: "X402_PROVIDER_URL" },
  modelName: { flag: "x402-model-name", env: "X402_MODEL_NAME" },
  discoveryUrl: { flag: "x402-discovery-url", env: "X402_DISCOVERY_URL" },
  allowlist: null, // allowlist uses dedicated resolution (no CLI flag)
};

export function resolveConfig(pi?: {
  getFlag?: (name: string) => string | undefined;
}): X402Config {
  const fileValues = readRawConfig();
  const getCli = (flag: string) => pi?.getFlag?.(flag);

  const resolve = (key: keyof X402Config): string => {
    const mapping = FLAG_MAP[key];
    const cliVal = mapping ? getCli(mapping.flag) : undefined;
    const fileVal = fileValues?.[key];
    const envVal = mapping ? process.env[mapping.env] : undefined;
    return cliVal ?? fileVal ?? envVal ?? DEFAULTS[key];
  };

  // allowlist uses a different resolution: file > env > default (no CLI)
  const allowlist = fileValues?.allowlist ??
    process.env.X402_ALLOWLIST ??
    DEFAULTS.allowlist;

  return {
    gatewayUrl: resolve("gatewayUrl"),
    chainId: resolve("chainId"),
    privateKey: resolve("privateKey"),
    providerUrl: resolve("providerUrl"),
    modelName: resolve("modelName"),
    discoveryUrl: resolve("discoveryUrl"),
    allowlist,
  };
}

// ── TUI / CLI Registration ───────────────────────────────────

export function registerConfigUI(pi: ExtensionAPI): void {
  // Register CLI flags (gracefully handle absence of registerFlag)
  const registerFlag = (pi as unknown as Record<string, unknown>)
    .registerFlag as
    | ((name: string, opts: Record<string, unknown>) => void)
    | undefined;
  if (typeof registerFlag === "function") {
    const flags: [string, string][] = [
      ["x402-gateway-url", "x402 Gateway URL"],
      ["x402-chain-id", "Chain ID (e.g. eip155:8453)"],
      ["x402-private-key", "EVM private key for signing"],
      ["x402-provider-url", "Provider API base URL (optional)"],
      ["x402-model-name", "Model name/ID to use (e.g. gpt-4)"],
      ["x402-discovery-url", "Discovery service URL"],
    ];
    for (const [name, desc] of flags) registerFlag(name, { description: desc });
  }

  // Register /x402-config command
  pi.registerCommand("x402-config", {
    description: "Configure x402 wallet and provider",
    handler: async (...rawArgs: unknown[]) => {
      const args = (rawArgs[0] as string[] | undefined) ?? [];
      const ctx = rawArgs[1] as { ui?: { input?: (title: string, placeholder: string) => Promise<string | undefined>; notify?: (message: string, level: string) => void } };
      const subCmd = args[0] ?? "";
      if (subCmd === "edit") await editWizard(ctx);
      else if (subCmd === "status") await showStatus(ctx);
      else if (subCmd === "set") await handleSet(ctx, args.slice(1));
      else ctx.ui?.notify?.(
        "[x402] Usage: /x402-config edit | /x402-config status | /x402-config set <key> <value>",
        "info",
      );
    },
  });

  // Register /x402-status shortcut command
  pi.registerCommand("x402-status", {
    description: "Show x402 configuration status (shortcut for /x402-config status)",
    handler: async (...rawArgs: unknown[]) => {
      const ctx = rawArgs[1] as { ui?: { notify?: (message: string, level: string) => void } };
      await showStatus(ctx);
    },
  });

  // Register /x402-models command — gateway model dynamic discovery
  pi.registerCommand("x402-models", {
    description: "List available models from the configured x402 gateway",
    handler: async (...rawArgs: unknown[]) => {
      const ctx = rawArgs[1] as { ui?: { notify?: (message: string, level: string) => void } };
      const config = resolveConfig();
      if (!config.gatewayUrl) {
        ctx.ui?.notify?.("[x402] No gateway URL configured. Run /x402-config edit to set up.", "warning");
        return;
      }
      try {
        const modelsUrl = `${config.gatewayUrl}/v1/models`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const resp = await fetch(modelsUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (!resp.ok) {
          ctx.ui?.notify?.(
            `[x402] Gateway at ${config.gatewayUrl} returned ${resp.status}`,
            "error",
          );
          return;
        }
        const data = (await resp.json()) as { data?: Array<{ id: string }> };
        if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
          ctx.ui?.notify?.(
            `[x402] No models available at ${config.gatewayUrl}`,
            "warning",
          );
          return;
        }
        const modelNames = data.data.map((m) => m.id);
        const lines = [`x402 Models at ${config.gatewayUrl}:`];
        for (const name of modelNames) lines.push(`  - ${name}`);
        ctx.ui?.notify?.(lines.join("\n"), "info");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          ctx.ui?.notify?.(
            `[x402] Gateway request timed out (10s) — ${config.gatewayUrl}`,
            "error",
          );
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui?.notify?.(
          `[x402] Failed to fetch models — ${message}`,
          "error",
        );
      }
    },
  });
}

// ── set Command ───────────────────────────────────────────────

const VALID_SET_KEYS = new Set<string>([
  "gatewayUrl", "chainId", "privateKey",
  "providerUrl", "modelName", "discoveryUrl", "allowlist",
]);

async function handleSet(
  ctx: { ui?: { notify?: (message: string, level: string) => void } },
  args: string[],
): Promise<void> {
  const key = args[0] ?? "";
  const value = args.slice(1).join(" ");

  if (!key || !value) {
    ctx.ui?.notify?.(
      "[x402] Usage: /x402-config set <key> <value>\nKeys: gatewayUrl, chainId, privateKey, providerUrl, modelName, discoveryUrl, allowlist",
      "info",
    );
    return;
  }

  if (!VALID_SET_KEYS.has(key)) {
    ctx.ui?.notify?.(
      `[x402] Unknown key "${key}".\nValid: ${[...VALID_SET_KEYS].join(", ")}`,
      "error",
    );
    return;
  }

  saveConfig({ [key]: value });
  ctx.ui?.notify?.(`[x402] ${key} → ${value}`, "info");
}

// ── TUI Wizard ───────────────────────────────────────────────

async function editWizard(ctx: {
  ui?: {
    input?: (title: string, placeholder: string) => Promise<string | undefined>;
    notify?: (message: string, level: string) => void;
  };
}): Promise<void> {
  const config = loadConfig();
  const updates: Partial<X402Config> = {};

  // 1. Gateway URL
  const gatewayUrl = ctx.ui?.input
    ? await ctx.ui.input("1/7 — x402 Gateway URL", config.gatewayUrl)
    : undefined;
  if (gatewayUrl !== undefined && gatewayUrl !== "") updates.gatewayUrl = gatewayUrl;

  // 2. Provider URL (optional — falls back to gateway URL if empty)
  const providerUrlPlaceholder = config.providerUrl || "(same as gateway URL)";
  const providerUrl = ctx.ui?.input
    ? await ctx.ui.input("2/7 — Provider API URL (optional)", providerUrlPlaceholder)
    : undefined;
  if (providerUrl !== undefined) updates.providerUrl = providerUrl;

  // 3. Model name/ID
  const modelName = ctx.ui?.input
    ? await ctx.ui.input("3/7 — Model name/ID", config.modelName)
    : undefined;
  if (modelName !== undefined && modelName !== "") updates.modelName = modelName;

  // 4. Chain ID (with suggestions)
  const chainPrompt = [
    "eip155:8453  (Base)",
    "eip155:84532 (Sepolia)",
    "eip155:1     (Ethereum)",
    "",
    `Current: ${config.chainId}`,
  ].join("\n");
  const chainId = ctx.ui?.input
    ? await ctx.ui.input("4/7 — Chain ID", chainPrompt)
    : undefined;
  if (chainId !== undefined && chainId !== "") updates.chainId = chainId;

  // 5. Private Key
  const pkPlaceholder = config.privateKey
    ? `${config.privateKey.slice(0, 6)}...${config.privateKey.slice(-4)} (set)`
    : "0x... (not set)";
  const privateKey = ctx.ui?.input
    ? await ctx.ui.input("5/7 — EVM Private Key", pkPlaceholder)
    : undefined;
  if (privateKey !== undefined && privateKey !== "") updates.privateKey = privateKey;

  // 6. Discovery URL (optional)
  const discoPlaceholder = config.discoveryUrl || "(not set)";
  const discoveryUrl = ctx.ui?.input
    ? await ctx.ui.input("6/7 — Discovery URL (optional)", discoPlaceholder)
    : undefined;
  if (discoveryUrl !== undefined) updates.discoveryUrl = discoveryUrl;

  // 7. Allowlist (optional, comma-separated or * for all)
  const allowlistPlaceholder = config.allowlist || "*";
  const allowlist = ctx.ui?.input
    ? await ctx.ui.input("7/7 — Allowlist (* or comma-separated URLs)", allowlistPlaceholder)
    : undefined;
  if (allowlist !== undefined) updates.allowlist = allowlist;

  if (Object.keys(updates).length > 0) {
    saveConfig(updates);
    ctx.ui?.notify?.(
      "[x402] Configuration saved to ~/.pi/x402-config.json\nRun /reload to apply changes.",
      "info",
    );
  } else {
    ctx.ui?.notify?.("[x402] No changes made.", "info");
  }
}

// ── Status Display ───────────────────────────────────────────

async function showStatus(ctx: {
  ui?: { notify?: (message: string, level: string) => void };
}): Promise<void> {
  const config = resolveConfig();
  const pkDisplay = config.privateKey
    ? `${config.privateKey.slice(0, 6)}...${config.privateKey.slice(-4)}`
    : "(not set)";
  const providerUrlDisplay = config.providerUrl || "(same as gateway URL)";
  const discoveryUrlDisplay = config.discoveryUrl || "(not set)";
  const lines = [
    "x402 Configuration Status",
    `Gateway URL   : ${config.gatewayUrl}`,
    `Provider URL  : ${providerUrlDisplay}`,
    `Model Name    : ${config.modelName}`,
    `Chain ID      : ${config.chainId}`,
    `Private Key   : ${pkDisplay} ${config.privateKey ? "✓" : "✗"}`,
    `Discovery URL : ${discoveryUrlDisplay}`,
    `Allowlist     : ${config.allowlist}`,
    `Config file   : ~/.pi/x402-config.json`,
  ];
  ctx.ui?.notify?.(lines.join("\n"), "info");
}
