# Codex Responses API 本地模型网关

客户端连接一个本地网关，网关根据请求中的 `model`，使用 CC Switch 对应 **Codex** 配置的 `base_url` 和 `auth.OPENAI_API_KEY`：

| 模型 | CC Switch 配置 |
| --- | --- |
| `glm-*`、`deepseek-*` | HeroHao-CN |
| `gpt-*` | WeCoding-Pin |

前缀匹配不区分大小写，模型名称原样传给上游。未指定模型时使用 `gpt-6-astra`；未配置的模型请求返回 400。按模型家族路由不代表上游支持该家族中的所有模型。

## 启动

需要 Node.js 18+ 和 Python 3.11+（标准库 SQLite / TOML 解析，无需安装依赖）；Python 3.9 / 3.10 需额外安装 `tomli`。默认使用当前环境 `PATH` 中的 `python3`；也可通过 `PYTHON_BIN` 指定 Python 可执行文件，例如 `PYTHON_BIN=/opt/homebrew/bin/python3 ./start-gateway.sh`。

1. 首次使用时复制 `.env.example` 为 `.env`，设置 `CODEX_GATEWAY_API_KEY`。已有 `.env` 可以继续使用。
2. 确认 CC Switch 中存在名为 `HeroHao-CN` 和 `WeCoding-Pin` 的 Codex 配置。
3. 检查并启动：

```bash
node gateway.mjs --check
node gateway.mjs --print-route glm-5.3
node gateway.mjs --print-route deepseek-v3.2
node gateway.mjs --print-route gpt-6-astra
./start-gateway.sh
```

默认监听 `http://127.0.0.1:8787`，日志写入 `gateway.log`，PID 写入 `gateway.pid`。停止使用 `./stop-gateway.sh`，前台运行使用 `node gateway.mjs`。

网关启动时只读 `~/.cc-switch/cc-switch.db`，按配置名和 `app_type = codex` 读取凭据，不依赖 CC Switch 当前选中哪个配置。真实上游 Key 不写入路由文件，也不在路由检查中输出。数据库中修改地址或 Key 后，重启网关生效。

可在 `routes.json` 顶层设置 `ccSwitchDatabase` 为其他数据库的绝对路径。`--check` 检查路由及实际 CC Switch 配置；本地网关 Key 在启动时验证。

## 客户端配置

在 CC Switch 新建单独的 Codex Gateway 配置，使用本目录的 `codex-gateway.config.toml`，API Key 填 `.env` 中的 `CODEX_GATEWAY_API_KEY`，然后选用该配置。客户端切换模型后，请求会自动路由到对应上游。

```toml
model_provider = "codex_gateway"
model = "gpt-6-astra"

[model_providers.codex_gateway]
name = "Local Codex Model Gateway"
base_url = "http://127.0.0.1:8787"
wire_api = "responses"
```

## 路由配置

`models` 支持精确模型名和末尾 `*` 前缀匹配；精确匹配优先，其次选择最长前缀。当前配置保留请求的 `reasoning.effort`、`store` 和模型名。

路由可使用 `ccSwitchProvider` 引用配置，或使用原有的 `baseUrlEnv` / `apiKeyEnv` 读取环境变量（同一路由不能混用）。旧 `.env` 中的 `WECODING_LUNA_*` / `WECODING_PLUS_*` 不再被默认路由使用。

可选覆盖字段：

- `upstreamModel`：发送给上游时替换模型名，适合本地别名。
- `reasoningEffort`：字符串覆盖 effort，`false` 删除 effort，`null` 或省略保留原值。
- `store`：布尔值覆盖，`null` 或省略保留原值。

## 支持范围

支持 Responses API、工具调用、SSE 流式响应及 `/responses/compact`。上游 URL 自动补齐 `/v1`。CC Switch 上游配置必须使用 `wire_api = "responses"`；网关不转换协议，不迁移上游配置中的项目权限、通知、模型目录等客户端设置。

验证路由、鉴权及流式转发：`python3 -m unittest discover -s tests -v`。测试仅连接本地模拟上游。
