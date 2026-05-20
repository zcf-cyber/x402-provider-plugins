# x402 HTTP 头与依赖选型

规范：[HTTP 402 - x402](https://docs.x402.org/core-concepts/http-402)

## V2（默认）

| Header | 方向 |
|--------|------|
| `PAYMENT-REQUIRED` | Server → Client |
| `PAYMENT-SIGNATURE` | Client → Server |
| `PAYMENT-RESPONSE` | Server → Client |

值为 Base64 编码的 JSON。

## V1（遗留）

| V1 | V2 |
|----|-----|
| `X-PAYMENT` | `PAYMENT-SIGNATURE` |
| `X-PAYMENT-RESPONSE` | `PAYMENT-RESPONSE` |

迁移参考：[Coinbase v1 → v2](https://docs.cdp.coinbase.com/x402/migration-guide)

## 本仓库 npm 依赖

| 包 | 用途 |
|----|------|
| `@x402/core` | 类型与 scheme 客户端 |
| `@x402/fetch` | `wrapFetchWithPayment` — Pi/OpenCode 侧 fetch 出口 |
| `@x402/axios` | 可选：Axios 栈或显式 `x402Version: 1` |
| `@coinbase/x402` | 可选：Coinbase facilitator（verify/settle） |

实现集中在 `packages/x402-core`，各运行时包不得直接复制 header 字符串常量以外的协议逻辑。
