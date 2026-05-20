# x402-plugins

面向 **Pi**、**OpenCode**、**OpenClaw**（及任意支持标准 x402 HTTP 头的运行时）的 **钱包原生 x402 插件 monorepo**。

协议与头实现基于官方生态（[`@x402/core`](https://www.npmjs.com/package/@x402/core)、[`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch)），本仓库只做 **运行时薄适配**，不重复实现 `PAYMENT-*` 编解码。

## 仓库结构

```text
packages/
  x402-core/       # 共享：fetch 包装、配置、钱包 signer 接口（无 Pi/OpenCode 依赖）
  pi-x402/         # Pi extensions + registerProvider 骨架
  opencode-x402/   # OpenCode 插件入口骨架
  openclaw-x402/   # OpenClaw plugin-sdk 入口骨架（可选 facilitator）
examples/          # 本地联调示例路径
docs/              # 补充设计笔记
SPEC.md            # 需求与里程碑 SSOT
```

## 快速开始

```bash
cd /path/to/x402-plugins
npm install
npm run build
cp .env.example .env   # 填写 gateway / 链配置
```

### Pi

```bash
npm run install:pi-extensions
# 或手动将 packages/pi-x402/extensions/*.ts 链到 ~/.pi/agent/extensions/
pi -e ./packages/pi-x402/extensions/x402-provider.ts
```

### OpenCode

在 `opencode.json` 中引用构建后的 `packages/opencode-x402/dist/index.js`（见 `examples/opencode/README.md`）。

### OpenClaw

见 `packages/openclaw-x402/README.md`（依赖宿主 `openclaw/plugin-sdk`，在 OpenClaw 工程内联调）。

## 文档

- [SPEC.md](./SPEC.md) — 产品/架构规格与 FR-* 需求编号
- [docs/protocol-headers.md](./docs/protocol-headers.md) — V1/V2 头对照与依赖选型

## 许可

MIT
