/**
 * Pi extension: progressive x402 service discovery (FR-D1–D3, P2).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveConfig } from "../src/profile.js";

// ── Helpers ────────────────────────────────────────────────────

function getAllowlist(raw: string): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

function filterByKeyword(
  services: Array<{ name: string; endpoint: string; cost: string }>,
  keyword: string,
) {
  if (!keyword) return services;
  const lower = keyword.toLowerCase();
  return services.filter(
    (s) => s.name.toLowerCase().includes(lower) || s.endpoint.toLowerCase().includes(lower),
  );
}

function filterByAllowlist(
  services: Array<{ name: string; endpoint: string; cost: string }>,
  allowlist: Set<string>,
) {
  if (allowlist.size === 0) return [];
  if (allowlist.has("*")) return services; // wildcard: allow all
  return services.filter((s) => allowlist.has(s.endpoint));
}

async function queryDiscoveryIndex(discoveryUrl: string): Promise<Array<{ name: string; endpoint: string; cost: string }>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const resp = await fetch(discoveryUrl, { signal: ctrl.signal });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { services?: Array<{ name: string; endpoint: string; cost_range?: string }> };
    return (data.services ?? []).map((s) => ({
      name: s.name,
      endpoint: s.endpoint,
      cost: s.cost_range ?? "unknown",
    }));
  } catch {
    throw new Error("x402: discovery index unreachable");
  } finally {
    clearTimeout(timer);
  }
}

function formatList(items: Array<{ name: string; endpoint: string; cost: string }>): string {
  return items.map((s) => `- ${s.name}: ${s.endpoint} (${s.cost})`).join("\n");
}

// ── Registration ───────────────────────────────────────────────

export default function registerX402Discovery(pi: ExtensionAPI): void {
  const config = resolveConfig(
    pi as unknown as { getFlag?: (name: string) => string | undefined },
  );
  const discoveryUrl = config.discoveryUrl || "https://discovery.x402.network/v1/services";
  const allowlist = getAllowlist(config.allowlist);

  // ── /discover command (interactive keyword search) ───────
  pi.registerCommand("discover", {
    description: "关键字搜索 x402 服务（渐进披露）",
    handler: async (_args, ctx) => {
      const keyword = await ctx.ui?.input("发现", "关键字");
      if (!keyword) return;

      let services;
      try {
        services = await queryDiscoveryIndex(discoveryUrl);
      } catch {
        ctx.ui?.notify("[x402] discovery index unreachable", "error");
        return;
      }
      const matched = filterByKeyword(services, keyword);
      if (matched.length === 0) {
        ctx.ui?.notify(`[x402] no services found matching "${keyword}"`, "warning");
        return;
      }

      const filtered = filterByAllowlist(matched, allowlist);
      if (filtered.length === 0) {
        ctx.ui?.notify(
          `[x402] found ${matched.length} service(s) but none are in allowlist`,
          "warning",
        );
        return;
      }

      const lines = filtered.map(
        (s) => `- ${s.name} (${s.endpoint}) cost: ${s.cost}`,
      );
      ctx.ui?.notify(
        `[x402] discovered ${filtered.length} service(s):\n${lines.join("\n")}`,
        "info",
      );
    },
  });

  // ── x402_list_services tool (programmatic discovery) ────
  pi.registerTool({
    name: "x402_list_services",
    label: "List x402 services",
    description: "List allowlisted x402 endpoints (summary only)",
    parameters: Type.Object({
      keyword: Type.Optional(Type.String({ description: "Filter by keyword" })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      let services;
      try {
        services = await queryDiscoveryIndex(discoveryUrl);
      } catch {
        return { content: [{ type: "text", text: "[x402] discovery index unreachable" }], details: {} };
      }

      const kw = filterByKeyword(services, params.keyword ?? "");
      const al = filterByAllowlist(kw, allowlist);

      const text =
        al.length > 0
          ? formatList(al)
          : allowlist.size > 0
            ? "[x402] no allowlisted services found"
            : "[x402] discovery index returned no services";

      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
