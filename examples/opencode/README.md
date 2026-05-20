# OpenCode 联调示例

1. 在仓库根目录执行 `npm install && npm run build`。
2. 将本目录 `opencode.json` 复制到你的 OpenCode 项目根，或合并其中 `plugin` 字段。
3. 填写 `X402_WALLET_ADDRESS` 与 gateway URL。
4. 启动 OpenCode；M3 完成后插件将拦截 provider 请求。
