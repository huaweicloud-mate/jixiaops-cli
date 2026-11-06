# jixiaops

**JixiaOps 平台的 CLI 与 MCP Server**——平台控制台能做的一切，命令行都能做；agent 通过 MCP 直接调用。

`jixiaops` 是 JixiaOps 平台的命令行操作面 + agent 插件（CLI / MCP 双入口，同一内核）：

- **工作单全流程**：建单、上传总纲与产物、过闸口（批准/驳回/选择/跳过）、派发到执行节点、关闭
- **平台资源只读**：产线、节点、agent、agent 日志、平台规格、统计
- **令牌管理**（管理员）：签发/吊销平台令牌
- **总闸**：平台级 halt / resume（高危，非访客身份）
- **WS 会话代理**：与平台 agent 全双工对话（chat 一句话模式 + open/send/read/wait/status/close 细粒度控制）
- **MCP Server**：同一内核的 20 个工具，任何支持 MCP 的 agent 开箱即用

写操作默认 dry-run（`--confirm` 才执行）；人类闸口（选题/批准/驳回）无绕过参数。

## 快速开始

零配置，开箱即用（无令牌时自动以**访客身份**运行，能力随平台 GUEST_MODE）：

```bash
npx jixiaops console auth whoami
```

需要管理员/真实身份时升级凭据（三选一，优先级从高到低）：

```bash
export JIXIAOPS_TOKEN=<平台令牌>          # ① 环境变量
echo '{"token":"<平台令牌>"}' > ~/.jixiaops/config.json   # ② 配置文件
# ③ 无令牌 → 访客自动登录（默认，会话缓存 24h 复用防频控）
```

## 安装

```bash
# 临时运行（免安装）
npx jixiaops console auth whoami

# 全局安装
npm install -g jixiaops

# 从源码运行
git clone https://gitcode.com/sunzy1940/jixiaops-cli.git
cd jixiaops-cli && npm install && npm run build
node dist/bin/jixiaops.js --help
```

要求 Node ≥ 22.18（原生 TS 类型剥离，零构建依赖）。

## 各 Agent 接入 MCP

`jixiaops-mcp` 是与 CLI 同一内核的 MCP Server（stdio，20 个工具）。各家 agent 一条命令接入：

**Claude Code**：

```bash
claude mcp add jixiaops -- npx -y jixiaops mcp
```

**Cursor**：

```bash
cursor mcp add jixiaops -- npx -y jixiaops mcp
```

**Codex**：

```bash
codex mcp add jixiaops -- npx -y jixiaops mcp
```

**Gemini CLI**：

```bash
gemini mcp add jixiaops -- npx -y jixiaops mcp
```

**CodeBuddy**：

```bash
codebuddy mcp add jixiaops -- npx -y jixiaops mcp
```

**OpenCode**：

```bash
opencode mcp add jixiaops -- npx jixiaops mcp
# 注：opencode 的参数解析不认 npx 的 -y，别加；需要全局配置加 --global，注入身份加 --env JIXIAOPS_TOKEN=<令牌>
```

**其他 agent（通用 JSON 配置）**：

```json
{
  "mcpServers": {
    "jixiaops": {
      "command": "npx",
      "args": ["-y", "jixiaops", "mcp"]
    }
  }
}
```

需要管理员/指定身份时，给配置加 `env`：`"env": { "JIXIAOPS_TOKEN": "<令牌>" }`（可选，默认访客自动登录）。

## 命令总览

```
jixiaops console auth whoami | logout

工作单：
  console wo list | get <id> | new --topic <t>
  console wo brief <id> --file <md>          # 上传总纲（上传即拍板）
  console wo upload <id> --file <f> [--step <s>]
  console wo gate <id> [--gate <g> --value approved|rejected]
  console wo pick <id> --step <s> --option <n>    # 选题（"选 N" 走这里）
  console wo start <id> [--mode <m>]              # 派发
  console wo artifact url|get <id> --file <f>     # 产物签名直链 / 下载
  console wo close <id>                           # 关闭（高危）

平台只读：
  console lines | devices | agents | agent-logs | stats | spec

令牌（管理员）：console token list | issue | revoke
总闸：console halt | resume

WS 会话代理：
  console ws chat --agent <id> --text <t>    # 一次性对话
  console ws open|send|read|wait|status|close
```

全局选项：`--endpoint <url>`（默认 https://mcptest.api.hwcdeveloper.com）、`--pretty`、`--verbose`。写操作默认 dry-run，`--confirm` 才执行。

## 文档

- 架构与决策：[docs/agent-plugin-architecture.md](docs/agent-plugin-architecture.md)（D1–D7 设计决策、流程图、P0–P5 执行计划）
- CLI 参考：[docs/jixiaops-cli.md](docs/jixiaops-cli.md)

## License

UNLICENSED
