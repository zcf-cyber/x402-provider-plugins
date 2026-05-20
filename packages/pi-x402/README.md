# @x402-plugins/pi-x402

Pi 运行时适配：通过 `pi.registerProvider` 与 extensions 挂载 x402。

## 扩展文件（开发时）

- `extensions/x402-provider.ts` — 注册 `x402-gateway` provider（M2）
- `extensions/x402-wallet.ts` — 钱包会话与扣费确认（M2）
- `extensions/x402-discovery.ts` — `/discover` 与渐进发现（M5）

安装到 Pi：

```bash
npm run install:pi-extensions   # 仓库根目录
# 或
pi -e ./packages/pi-x402/extensions/x402-provider.ts
```

依赖宿主已安装 `pi` / `@earendil-works/pi-coding-agent`。
