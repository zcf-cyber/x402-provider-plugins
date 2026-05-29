/**
 * Pi extension: progressive x402 service discovery (FR-D1–D3, P2).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DISCOVERY_URL = process.env.X402_DISCOVERY_URL ?? "https://discovery.x402.network/v1/services";

function getAllowlist(): Set<string> {
  const raw = process.env.X402_ALLOWLIST ?? "";
  if (!raw) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

function filterByKeyword(
  services: Array<{ name: string; endpoint: string; cost: string }>,
  keyword: string,
) {
  const lower = keyword.toLowerCase();
  return services.filter((s) => s.name.toLowerCase().includes(lower) || s.endpoint.toLowerCase().includes(lower));
}

function filterByAllowlist(
  services: Array<{ name: string; endpoint: string; cost: string }>,
  allowlist: Set<string>,
) {
  if (allowlist.size === 0) return services;
  return services.filter((s) => allowlist.has(s.endpoint));
}

async function queryDiscoveryIndex(keyword?: string): Promise<Array<{ name: string; endpoint: string; cost: string }>> {
  const url = keyword ? `${DISCOVERY_URL}?q=${encodeURIComponent(keyword)}` : DISCOVERY_URL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { services?: Array<{ name: string; endpoint: string; cost_range?: string }> };
    return (data.services ?? []).map((s) => ({ name: s.name, endpoint: s.endpoint, cost: s.cost_range ?? "unknown" }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function formatList(items: Array<{ name: string; endpoint: string; cost: string }>): string {
  return items.map((s) => `- ${s.name}: ${s.endpoint} (${s.cost})`).join("\n");
}

export default function registerX402Discovery(pi: ExtensionAPI): void {
  const allowlist = getAllowlist();

  pi.registerCommand("discover", {
    description: "关键字搜索 x402 服务（渐进披露）",
    handler: async (_args, ctx) => {
      const keyword = await ctx.ui.input("发现", "关键字");
      if (!keyword) return;

      const services = await queryDiscoveryIndex(keyword);
      if (services.length === 0) {
        ctx.ui.notify(`[x402] 未找到匹配 "${keyword}" 的服务`, "warning");
        return;
      }

      const filtered = filterByAllowlist(services, allowlist);
      if (filtered.length === 0) {
        ctx.ui.notify(`[x402] 找到 ${services.length} 个服务，但均不在白名单中`, "warning");
        return;
      }

      const lines = filtered.map((s) => `- ${s.name} (${s.endpoint}) 费用范围: ${s.cost}`);
      ctx.ui.notify(`[x402] 发现 ${filtered.length} 个服务:\n${lines.join("\n")}`, "info");
    },
  });

  pi.registerTool({
    name: "x402_list_services",
    label: "List x402 services",
    description: "List allowlisted x402 endpoints (summary only)",
    parameters: Type.Object({
      keyword: Type.Optional(Type.String({ description: "Filter by keyword" })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const services = await queryDiscoveryIndex(params.keyword);
      const kw = filterByKeyword(services, params.keyword ?? "");
      const al = filterByAllowlist(kw, allowlist);

      const text = al.length > 0
        ? formatList(al)
        : allowlist.size > 0
          ? "[x402] 无白名单匹配的服务"
          : "[x402] discovery index 无可用服务";

      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
