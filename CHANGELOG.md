# 更新日志（Changelog）

所有重要变更记录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

npm 包：[jixiaops](https://www.npmjs.com/package/jixiaops) ｜ 仓库：gitcode.com/sunzy1940/jixiaops-cli

## [0.6.1] - 2026-11-07

### 新增
- `console watch` 支持 `--out <目录>`：快照落盘目录可自定义（默认 `~/.jixiaops`），启动输出带 `snap_dir` 字段，多级目录自动创建——服务化/容器/多环境场景不再依赖 HOME；MCP 派发 hint 与回合纪律规则 5 同步提及

## [0.6.0] - 2026-11-07

npm 上 0.5.9 之后的第一个正式版（本地 0.6.1~0.6.3 迭代并入本版）。

### 新增
- **`console watch` 常驻值班进程**（只读，对平台零写操作）：盯工作单状态——闸口 `pending_human`→拍板提醒、状态推进、疑似停摆（`updated_at` 超时不动，每轮只报一次）、任务终态（单工位模式自动收工）；通知出口 stdout+蜂鸣 / `--notify` webhook（URL 含 feishu/larksuite 自动用飞书格式）/ `--exec` 自定义命令（经 `JIXIAOPS_WATCH_MESSAGE` 传消息）；快照落盘 `~/.jixiaops/watch-<wo>.json`（含 `events` 事件时间线，最近 50 条），供 agent 断点续盯。`--once` 单次检查退出（适合 cron），`--max <秒>` 限时运行
- **MCP 回合纪律指导三通道**：`initialize.instructions`（回合纪律 + 身份凭据 FAQ）、关键工具 description 补执行策略（`wo_start`/`chat_open`/`chat_wait`）、写操作返回值带 `_next`/`hint`（派发后自拉起 watch 的命令模板 + 监听收尾条件）。核心条款：派发后持有回合监听直到闸口/终态/异常才收尾；禁止「我继续盯着，有动静随时汇报」式无终止承诺；首次派发预告人工闸点；算力口径红线（平台记录的「本地/本机」指产线执行节点云端 ECS，不占用户本机算力）；长任务由 agent 自拉起的值班进程兜底，用户零感知
- **凭据指引分角色**：`whoami` 访客身份返回值自带 hint；403 错误 hint 补升级路径。口径：凭据=平台令牌，**普通用户无法自行签发**（`token issue` 仅管理员可执行），向管理员申请（名字+产线）后配置 `JIXIAOPS_TOKEN` 或 `~/.jixiaops/config.json`
- README 补「升级与验证」指导（更新后必须重启宿主 agent；运行中 MCP 版本验证三法）

### 修复
- watch 子进程 `interval.unref()` 导致首轮后静默退出
- Windows 上 `process.exit()` 撞 stdout 管道 libuv 断言（exit code -1073740791）——改为停止标记自然退出
- 停摆去重状态未写回快照导致重复告警

## [0.5.9] - 2026-11-06
- 版本号单一来源：CLI 横幅与 MCP serverInfo 从 package.json 现读

## [0.5.7] - 2026-11-06
- CLI 补 `jixiaops mcp` 子命令（与 `jixiaops-mcp` 等价）

## [0.5.0] - 2026-11-06
- 更名 ainative → jixiaops：包名去 scope（`@yuanbeyond/jixiaops` → `jixiaops`）、bin、配置目录（`~/.ainative` → `~/.jixiaops`）、env（`AINATIVE_*` → `JIXIAOPS_*`），旧环境零迁移
- 0.5.2–0.5.6：README 接入文档标准化（各 agent 一条命令接入）

## [0.4.0] - 2026-11-06
- 全仓 JavaScript 迁移 TypeScript（Node ≥22.18 原生类型剥离，零构建依赖）
- 新增 `console wo artifact url|get`：产物签名直链与下载

## [0.3.0] - 2026-11-05
- P0–P4 全量落地：CLI 全命令 + WS 会话代理（D5：chat_open/send/read/wait/status/close，服务端环形缓冲不丢帧）+ MCP Server（stdio JSON-RPC，20 工具）+ openapi.yaml 规格
- 修复 WS 会话代理两处自愈缺陷

## [0.1.0] - 2026-11-05
- 垂直切片：CLI 双入口骨架 + 凭据解析链（env → config → 访客自动登录）+ 首批命令
