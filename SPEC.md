# SPEC：x402-plugins（多运行时钱包原生插件）

**文档性质**：单一事实来源（SSOT），用于里程碑、任务分解与测试用例。  
**仓库**：`/workspace/x402-plugins` monorepo（本机路径示例：`~/workspace/x402-plugins`）。  
**协议依赖**：官方 [`@x402/core`](https://www.npmjs.com/package/@x402/core)、[`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch)（V2 头：`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`）。V1 遗留头见 `docs/protocol-headers.md`。

---

## 1. 目标与非目标

### 1.1 目标（P0/P1）

| ID | 目标 |
|----|------|
| G1 | **钱包原生**：主身份为链上地址；API Key 仅 legacy 附属 |
| G2 | **x402-gateway 即用即付**：402 → 签名 → 带 `PAYMENT-SIGNATURE` 重试 |
| G3 | **多运行时插件**：Pi / OpenCode / OpenClaw 共享 `@x402-plugins/core` |
| G4 | **Provider 原生 x402**：模型 HTTP 出口统一经 x402 包装 fetch |
| G5 | **Legacy 模式**：可降级为传统 API Key provider（不经过 402） |
| G6 | **渐进式服务发现（P1）**：关键字 + 失败阶梯触发 + allowlist |

### 1.2 非目标

- 不实现完整链上浏览器 UI
- 不替代 gateway 定价/风控
- 不在本仓库 fork Pi / OpenCode / OpenClaw 本体

---

## 2. 包与运行时映射

| 包 | 运行时 | 接入方式 |
|----|--------|----------|
| `@x402-plugins/core` | 全部 | `createX402Fetch()`、`X402ClientConfig` |
| `@x402-plugins/pi-x402` | [Pi](https://github.com/earendil-works/pi) | `pi.registerProvider` + extensions |
| `@x402-plugins/opencode-x402` | [OpenCode](https://github.com/anomalyco/opencode) | `opencode.json` plugins + provider hooks |
| `@x402-plugins/openclaw-x402` | [OpenClaw](https://documentation.openclaw.ai/) | `openclaw/plugin-sdk` `registerProvider` |

---

## 3. 功能需求（FR-*）

### FR-CORE（`x402-core`）

- **FR-C1**：封装 `@x402/fetch` 的 `wrapFetchWithPayment`（或等价 API），暴露 `createX402Fetch(config, signer)`。
- **FR-C2**：支持配置 `x402Version: 1 | 2`（V1 时兼容 `X-PAYMENT` 路径，委托 `@x402/axios` 若需要）。
- **FR-C3**：`gatewayBaseUrl`、超时、重试上限、幂等键策略可配置。
- **FR-C4**：审计日志接口（无私钥）；可插拔 `signer: X402Signer`。

### FR-PI

- **FR-P1**：`x402-provider` extension 注册 provider id `x402-gateway`（可配置）。
- **FR-P2**：`x402-wallet` extension：`session_start` 检查钱包；扣费前 `ctx.ui.confirm`。
- **FR-P3**（P1）：`x402-discovery`：`/discover` 命令 + `registerTool`。

### FR-OPENCODE

- **FR-O1**：插件导出 provider 包装：在模型请求前注入 x402 fetch / 自定义 header。
- **FR-O2**：`tool.execute.before` 可选预算检查（P1）。

### FR-OPENCLAW

- **FR-CL1**：`api.registerProvider` 注册 x402 推理 provider（嵌入 Pi 场景可复用 Pi 扩展加载路径，见 ADR-002）。
- **FR-CL2**：与 OpenClaw auth profile 共存时，钱包优先策略可配置。

### FR-DISCOVERY（P1，跨包）

- **FR-D1**：Directory 抽象；默认不全链扫描。
- **FR-D2**：触发：用户命令 / 失败阶梯 / 显式开关。
- **FR-D3**：渐进披露；未入 allowlist 的 endpoint 拒绝调用。

---

## 4. 里程碑

| 阶段 | 交付 |
|------|------|
| **M0** | monorepo 骨架、`x402-core` 类型 + mock signer 测试 |
| **M1** | `x402-core` 接真实 `@x402/fetch` + gateway 集成测试 |
| **M2** | `pi-x402` provider 垂直切片（单模型） |
| **M3** | `opencode-x402` 插件垂直切片 |
| **M4** | `openclaw-x402` provider 注册 |
| **M5** | discovery + allowlist（Pi 先行） |

---

## 5. 验收标准（样例）

1. 未连接钱包时，x402 provider 不发起隐性扣费请求。
2. Mock 402：自动附加 `PAYMENT-SIGNATURE` 并重试成功。
3. Legacy 模式：同一配置下可切换至非 x402 endpoint。
4. 三运行时至少共享同一 `@x402-plugins/core` 版本号。

---

## 6. 开放问题

- 目标 gateway 协议版本（V1 vs V2）与 facilitator 归属（自建 vs `@coinbase/x402`）。
- 服务发现索引 API 形态。
- OpenClaw 场景下 Pi embedded 扩展与 OpenClaw plugin 的分工（ADR-002）。

---

## 附录 ADR

- **ADR-001**：头与编解码不自研，依赖 `@x402/*`。
- **ADR-002**：OpenClaw 已嵌入 Pi 时，优先加载 `pi-x402` extensions；独立 Gateway 场景再用 `openclaw-x402` plugin。
