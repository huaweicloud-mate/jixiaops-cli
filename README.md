# JixiaOps - 运营AI Native平台

**JixiaOps 平台的 CLI 与 MCP Server**——平台控制台能做的一切，命令行都能做；agent 通过 MCP 直接调用。

`jixiaops` 是 JixiaOps 平台的命令行操作面 + agent 插件（CLI / MCP 双入口，同一内核）：

- **工作单全流程**：建单、上传总纲与产物、过闸口（批准/驳回/选择/跳过）、派发到执行节点、关闭
- **平台资源只读**：产线、节点、agent、agent 日志、平台规格、统计
- **令牌管理**（管理员）：签发/吊销平台令牌
- **总闸**：平台级 halt / resume（高危，非访客身份）
- **WS 会话代理**：与平台 agent 全双工对话（chat 一句话模式 + open/send/read/wait/status/close 细粒度控制）
- **值班监控 `console watch`**：常驻只读进程盯工作单——闸口等拍板/状态推进/疑似停摆时通过 stdout、webhook（飞书兼容）或自定义命令触达用户，快照落盘供 agent 断点续盯；补上「会话外无人触达」的洞
- **MCP Server**：同一内核的 20 个工具，任何支持 MCP 的 agent 开箱即用

写操作默认 dry-run（`--confirm` 才执行）；人类闸口（选题/批准/驳回）无绕过参数。

### 值班监控（agent 会话外触达用户）

```bash
# 盯一张单：闸口等你拍板 / 状态推进 / 疑似停摆时，stdout+蜂鸣提醒
npx jixiaops console watch --wo wo-20261106-001

# 停摆阈值 5 分钟，变化推飞书机器人 webhook（对平台零写操作，只提醒不动手）
npx jixiaops console watch --wo wo-20261106-001 --stall 5 \
  --notify https://open.feishu.cn/open-apis/bot/v2/hook/xxx

# 全量盯所有工作单，单次检查退出（适合 cron 每分钟跑）
npx jixiaops console watch --once
```

快照落盘 `~/.jixiaops/watch-<wo>.json`，agent 断点续盯时先读此文件即可恢复现场。

## 快速开始

两步：全局安装，然后一行验证（无令牌时自动以**访客身份**运行，能力随平台 GUEST_MODE）：

```bash
npm install -g jixiaops
jixiaops console auth whoami
# │        │       │    └─ 具体命令："我是谁"——查当前身份
# │        │       └─ 子命令组：认证
# │        └─ 命令组：平台控制台（console 下还有 wo/lines/token/ws 等）
# └─ CLI 命令名（全局安装后进 PATH；MCP Server 入口是 jixiaops-mcp，同样进 PATH）
#
# 一行同时验证四件事：npm 全局安装成功 ✚ CLI 能运行 ✚ 凭据链能通（无令牌自动访客登录）
# ✚ 平台端点可达。返回 JSON 里的 _identity.source 标明本次用的是哪条凭据。
```

需要管理员/真实身份时升级凭据（三选一，优先级从高到低）：

> 令牌获取：**向平台管理员申请**（告知名字 + 需要的产线）——签发命令 `jixiaops console token issue` 仅管理员可执行，普通用户无法自行签发。

```bash
export JIXIAOPS_TOKEN=<平台令牌>          # ① 环境变量
echo '{"token":"<平台令牌>"}' > ~/.jixiaops/config.json   # ② 配置文件
# ③ 无令牌 → 访客自动登录（默认，会话缓存 24h 复用防频控）
```

## 安装

```bash
# 推荐：全局安装（jixiaops + jixiaops-mcp 双命令进 PATH）
npm install -g jixiaops

# 升级
npm install -g jixiaops@latest

# 仅试用、不安装（临时下载直接跑，不进 PATH；缓存版本可能滞后于 npm latest）
npx jixiaops console auth whoami

# 从源码运行
git clone https://gitcode.com/sunzy1940/jixiaops-cli.git
cd jixiaops-cli && npm install && npm run build
node dist/bin/jixiaops.js --help
```

要求 Node ≥ 22.18（原生 TS 类型剥离，零构建依赖）。全局安装的前提是 npm 全局 bin 目录在 PATH 中（默认即满足；nvm 用户确认当前 node 版本已启用）。

## 各 Agent 接入 MCP

全局安装后，`jixiaops-mcp`（与 CLI 同一内核的 MCP Server，stdio，20 个工具）已在 PATH 中，各家 agent 一条命令接入，写法完全统一：

**Claude Code**：

```bash
claude mcp add jixiaops -- jixiaops-mcp
```

**Cursor**：

```bash
cursor mcp add jixiaops -- jixiaops-mcp
```

**Codex**：

```bash
codex mcp add jixiaops -- jixiaops-mcp
```

**Gemini CLI**：

```bash
gemini mcp add jixiaops -- jixiaops-mcp
```

**CodeBuddy**：

```bash
codebuddy mcp add jixiaops -- jixiaops-mcp
```

**OpenCode**：

```bash
opencode mcp add jixiaops -- jixiaops-mcp
# 需要全局配置加 --global，注入身份加 --env JIXIAOPS_TOKEN=<令牌>
```

**其他 agent（通用 JSON 配置）**：

```json
{
  "mcpServers": {
    "jixiaops": {
      "command": "jixiaops-mcp"
    }
  }
}
```

需要管理员/指定身份时，给配置加 `env`：`"env": { "JIXIAOPS_TOKEN": "<令牌>" }`（可选，默认访客自动登录）。

> **给 agent 执行者**：用户说「安装/接入插件」但未指明 agent 时，默认安装到**你自己**——即当前正在读本文档并执行操作的 agent，不要替用户装给其他 agent；用户明确指定了目标 agent 时，以用户指定为准；仅当执行者无法确认自身身份时，才检测本机已安装的 agent（`opencode` / `claude` / `cursor` 等命令在 PATH 中，或 `opencode.json` / `.claude.json` / `.cursor/` 等配置文件存在）并询问用户装哪个。

> 说明：新版 CLI 的 `jixiaops mcp` 子命令与 `jixiaops-mcp` 等价。若未全局安装、坚持免安装试用，可将上述命令中的 `jixiaops-mcp` 换成 `npx -y jixiaops mcp`（注意 OpenCode 的参数解析不认 `npx` 的 `-y`，别加）。

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
