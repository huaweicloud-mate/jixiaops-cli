# ainative-cli

OperationAINative 平台的命令行操作面 + agent 插件（CLI / MCP 双入口，同一内核）。

**平台控制台能做的一切，命令行都能做。**

- 架构与决策：`docs/agent-plugin-architecture.md`（D1–D7 设计决策、5 张流程图、P0–P5 执行计划）
- CLI 参考：`docs/ainative-cli.md`

## 快速开始（零配置）

```bash
npx .                    # 仓库内直接跑
node bin/ainative.ts console auth whoami   # 首次运行自动访客登录
```

无令牌时自动以**访客身份**使用（能力随平台 GUEST_MODE）；需要管理员/真实身份：

```bash
export AINATIVE_TOKEN=<令牌>     # 或 ~/.ainative/config.json
```

## 当前状态（v0.1.0 垂直切片）

- ✅ 凭据解析链（env → config → 访客自动登录+缓存复用防频控）
- ✅ `console auth whoami/logout`、`wo get/new`、`lines/devices/agents/agent-logs/stats/overview/spec`
- ✅ `wo artifact url|get`（2026-11-06）：产物签名直链签发与下载——worker 回报产物链接不再拼长期 token
- ✅ 写操作默认 dry-run（D4）
- ⏳ P1: openapi.yaml + asyncapi.yaml ｜ P2 续: 全部写命令 ｜ P4: MCP Server + WS 会话代理 ｜ P5: 本地包实测分发

## 决策记录（2026-11-05 拍板）

1. 独立代码仓（先个人仓，后续按需迁移）
2. 发包渠道暂缓——本地 `npm pack` 打包实测
3. v1 砍掉 OAuth 登录（访客默认 + 令牌注入已覆盖）
