# Pi 联调示例

```bash
# 仓库根目录
npm run install:pi-extensions

export X402_GATEWAY_URL=http://127.0.0.1:8080
export X402_WALLET_ADDRESS=0xYourAddress

pi -e ../../packages/pi-x402/extensions/x402-provider.ts
pi -e ../../packages/pi-x402/extensions/x402-wallet.ts
```

或使用全局扩展目录（见 `scripts/install-pi-extensions.mjs`）。
