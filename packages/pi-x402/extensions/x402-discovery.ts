/**
 * Pi extension: progressive x402 service discovery (FR-D1–D3, P1).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function registerX402Discovery(pi: ExtensionAPI): void {
  pi.registerCommand("discover", {
    description: "关键字搜索 x402 服务（渐进披露）",
    handler: async (_args, ctx) => {
      const keyword = await ctx.ui.input("发现", "关键字");
      if (!keyword) return;
      // M5: query directory index; show summary rows only
      ctx.ui.notify(`[x402] 发现占位: keyword="${keyword}" — 实现 FR-D4`, "info");
    },
  });

  pi.registerTool({
    name: "x402_list_services",
    label: "List x402 services",
    description: "List allowlisted x402 endpoints (summary only)",
    parameters: Type.Object({
      keyword: Type.Optional(Type.String({ description: "Filter" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return {
        content: [
          {
            type: "text",
            text: `[stub] discovery keyword=${params.keyword ?? ""} — allowlist empty (FR-D6)`,
          },
        ],
        details: {},
      };
    },
  });
}
