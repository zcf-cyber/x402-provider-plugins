# @x402-plugins/openclaw-x402

OpenClaw 侧适配（FR-CL1、ADR-002）。

- **Gateway / 多渠道**：使用 `openclaw/plugin-sdk` 的 `registerProvider`（本包骨架）。
- **Embedded Pi**：优先在 OpenClaw 的 pi embedded 路径加载 `packages/pi-x402/extensions/*`，避免重复实现 402 逻辑。

在 OpenClaw 仓库内联调：

```bash
# 在 OpenClaw 工程中
npm install /path/to/x402-plugins/packages/openclaw-x402
```

M4 对接 `definePluginEntry` 与 `api.registerProvider`。
