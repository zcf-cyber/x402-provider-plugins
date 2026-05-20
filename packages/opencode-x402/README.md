# @x402-plugins/opencode-x402

OpenCode 插件入口：在模型 HTTP 出口注入 `@x402-plugins/core` 包装的 fetch / 自定义 provider 头。

## 配置示例

见 `examples/opencode/opencode.json`。

## 宿主依赖

在 OpenCode 工程内安装本包后，于 `opencode.json` 的 `plugin` 数组引用构建产物 `dist/index.js`。

M3 将对接 OpenCode Plugin API（`tool.execute.before`、provider hooks）。类型以宿主 `@opencode-ai/plugin` 为准。
