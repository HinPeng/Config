# Codex Responses API 本地模型网关

这个网关让 Codex 只连接一个本地 provider，然后根据 Responses API 请求中的 `model` 选择不同的上游凭据和请求级配置。

当前模板包含：

- `gpt-5.6-luna` → WeCoding-Luna，强制 `reasoning.effort = "max"`，并设置 `store = false`；
- `gpt-5.6-sol` → WeCoding-Plus，删除显式 `reasoning.effort`，保留 Codex 的默认存储行为；
- `gpt-5.6-sol-plus` → 一个示例别名，发送给上游时改回 `gpt-5.6-sol`。

## 1. 准备环境变量

在本目录复制 `.env.example` 为 `.env`，填入：

- `CODEX_GATEWAY_API_KEY`：本地网关密钥；
- `WECODING_LUNA_BASE_URL` / `WECODING_LUNA_API_KEY`：WeCoding-Luna provider 的上游地址和 Key；
- `WECODING_PLUS_BASE_URL` / `WECODING_PLUS_API_KEY`：WeCoding-Plus provider 的上游地址和 Key。

不要把真实 Key 写入 `routes.json` 或提交到 Git。

网关会自动补齐 Responses API 的 `/v1` 路径，因此上游地址既可以填 `https://example.com`，也可以填 `https://example.com/v1`。

## 2. 检查并启动

需要 Node.js 18 或更新版本：

```bash
cd /Users/hp/codex-responses-gateway
node gateway.mjs --check
node gateway.mjs
```

看到 `listening on http://127.0.0.1:8787` 后，网关已经启动。

可以用下面的命令检查某个模型的路由，输出不会包含 Key：

```bash
node gateway.mjs --print-route gpt-5.6-luna
node gateway.mjs --print-route gpt-5.6-sol
```

### 后台运行与停止

先给脚本执行权限：

```bash
chmod +x start-gateway.sh stop-gateway.sh
```

后台启动：

```bash
./start-gateway.sh
```

脚本会把 PID 写入 `gateway.pid`，日志写入 `gateway.log`。需要停止时执行：

```bash
./stop-gateway.sh
```

停止脚本会先确认 PID 对应的确实是本目录的网关进程，不会直接终止其他服务。

## 3. 在 cc-switch 中创建单一 Gateway provider

新建一个 Codex provider，把 `codex-gateway.config.toml` 的内容作为配置，或者手动设置：

```toml
model_provider = "codex_gateway"
model = "gpt-5.6-luna"

[model_providers.codex_gateway]
name = "Local Codex Model Gateway"
base_url = "http://127.0.0.1:8787"
wire_api = "responses"
```

在该 provider 的 API Key 字段填入与 `CODEX_GATEWAY_API_KEY` 完全相同的值，然后将这个 Gateway provider 设为当前 Codex provider。

项目权限仍由 Codex 本地配置管理，不需要迁移到网关。

## 4. 添加更多分组

在 `routes.json` 增加模型路由即可：

```json
"gpt-5.6-sol-pro": {
  "baseUrlEnv": "WECODING_PRO_BASE_URL",
  "apiKeyEnv": "WECODING_PRO_API_KEY",
  "upstreamModel": "gpt-5.6-sol",
  "reasoningEffort": "high",
  "store": false
}
```

字段含义：

- `reasoningEffort` 为字符串：覆盖请求的 `reasoning.effort`；
- `reasoningEffort` 为 `false`：删除请求中的显式 effort；
- 不写 `reasoningEffort` 或写 `null`：保留 Codex 发来的值；
- `store` 为布尔值：覆盖 Responses API 的 `store`；
- `store` 为 `null` 或不写：保留 Codex 发来的值；
- `upstreamModel`：本地使用别名，转发给上游时改成实际模型名。

如果多个 cc-switch 分组使用同一个模型名，网关无法仅凭模型名区分它们。请为这些分组使用不同的本地别名，例如 `gpt-5.6-sol-plus` 和 `gpt-5.6-sol-pro`，再通过 `upstreamModel` 改回真实上游模型名。

## 5. 支持范围与限制

网关会原样转发 Responses API 请求、工具调用和 SSE 流式响应，并支持 `/v1/responses`、`/responses` 以及 Responses compact 路径。

网关可以覆盖请求级字段，例如 `model`、`reasoning.effort` 和 `store`；它不能改变 Codex 已经在本地生成的项目权限、通知程序或完整客户端配置。需要切换这类客户端行为时，应继续保留在统一的 Gateway provider 中，或者为它们建立独立的 Codex 配置。

网关默认只监听 `127.0.0.1`，不要把监听地址改成公网地址，除非同时增加 TLS、访问控制和反向代理层。
