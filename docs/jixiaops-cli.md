# jixiaops CLI 参考文档

> 版本：v1.0 · 对应架构文档 `docs/agent-plugin-architecture.md`
> 一句话：**OperationAINative 平台的命令行操作面**——平台控制台能做的一切，命令行都能做；也是 MCP Server（`jixiaops-mcp`）的同一套内核。

---

## 1. 安装与运行

```bash
# 临时使用（推荐 agent 场景）
npx jixiaops --help

# 全局安装
npm install -g jixiaops
jixiaops --help
```

- 运行环境：Node.js ≥ 18
- 无需任何预配置——首次使用自动以**访客身份**登录（见 §4）

---

## 2. 快速开始

```bash
# 1. 零配置：直接用（自动访客登录，能力随平台 GUEST_MODE）
jixiaops console wo get wo-20261105-001

# 2. 看看我是谁、有什么权限
jixiaops console auth whoami
# {"kind":"guest","mode":"open","ro":false,"lines":["line-1"]}

# 3. 建单（写操作默认 dry-run 预览）
jixiaops console wo new --topic "AI Native 运营范式" --line line-1
# [dry-run] 将执行: POST /api/new {topic, platforms, line}
# 加 --confirm 真正执行

# 4. 需要管理员/真实身份时（三选一，见 §4）
export JIXIAOPS_TOKEN=<管理员令牌>     # 方式一：环境变量
jixiaops auth login                    # 方式二：交互式引导（GitCode OAuth）
vim ~/.jixiaops/config.json            # 方式三：配置文件
```

---

## 3. 全局约定

### 3.1 输出格式

- **所有命令默认输出 JSON**（机器可读，agent 友好），`--pretty` 美化，`--no-json` 人类可读表格。
- 错误也是 JSON：`{"error": "...", "hint": "...", "http": 409}`——`hint` 是语义化建议（如 409 产线占用时列出空闲产线）。

### 3.2 写操作三原则（D4）

| 原则 | 行为 |
|---|---|
| 默认 dry-run | 所有写命令先打印将要发出的请求，**不落库**；`--confirm` 才执行 |
| 人类闸口只读 | 标记为人类闸口的操作（发布等），平台闸口未过时 CLI 只展示状态，**没有绕过参数** |
| 高危操作身份护栏 | `token issue/revoke`、`wo close` 要求非访客身份（`x-jixiaops-min-identity: admin`），访客调用直接拒绝并提示升级 |

### 3.3 端点选择（D6）

```bash
--endpoint-public    # WAF/域名（默认）：https://mcptest.api.hwcdeveloper.com
--endpoint-internal  # 内网直连：http://<host>:8081（同网 agent 推荐，绕 WAF 超时与 CDN）
```

环境变量 `JIXIAOPS_ENDPOINT` / `JIXIAOPS_ENDPOINT_INTERNAL` 可持久化。

### 3.4 全局选项（所有命令可用）

| 选项 | 说明 |
|---|---|
| `--json / --no-json` | 输出格式（默认 JSON） |
| `--pretty` | JSON 美化缩进 |
| `--confirm` | 写操作真正执行（省略即 dry-run） |
| `--timeout <ms>` | 请求超时（默认 15000；`wo start` 类长操作内部自动转轮询） |
| `--retries <n>` | 失败重试次数（默认 2，仅幂等读操作自动重试） |
| `--endpoint-*` | 端点覆盖（见 3.3） |
| `--verbose` | 调试输出（**token 自动脱敏为前 8 位**） |

### 3.5 退出码

| 码 | 含义 | 典型场景 |
|---|---|---|
| 0 | 成功 | — |
| 1 | 一般错误 | 网络失败、参数错误 |
| 2 | 鉴权失败 | 401（token 失效）→ 提示重新登录 |
| 3 | 权限不足 | 403（访客只读 / 高危操作访客被拒） |
| 4 | 资源冲突 | 409（产线独占占用） |
| 5 | 频控 | 429（访客登录过频）→ 提示使用缓存会话 |

---

## 4. 认证：身份解析链（D3）

CLI 启动时按以下顺序解析身份，**命中即停**：

```
① 环境变量 JIXIAOPS_TOKEN
② 配置文件 ~/.jixiaops/config.json（权限 600）
③ 凭据库（企业环境，cred 集成）
④ 访客自动登录（零配置默认）→ 会话缓存 ~/.jixiaops/session.json（600 权限，24h TTL）
```

> **频控保护**：访客会话缓存复用，24h 内绝不重复登录；缓存文件加锁防多实例并发重登。

### `console auth whoami`

当前身份与权限。

```bash
$ jixiaops console auth whoami
{"kind":"guest","name":"访客-a1b2","mode":"open","ro":false,
 "high_risk_unlocked":false,"endpoint":"https://mcptest..."}
```

### `console auth login`

交互式登录引导（覆盖访客默认，升级身份）：

```bash
jixiaops auth login                  # 交互菜单：GitCode OAuth / 粘贴管理员令牌
jixiaops auth login --gitcode        # 打开浏览器走 OAuth，本地起临时回调监听完成签收
jixiaops auth login --token          # 安全输入令牌（不回显、不进 shell 历史）
```

### `console auth logout`

吊销当前会话（访客/GitCode 会话调平台吊销；管理员令牌仅清除本地缓存，幂等）。

### 配置文件 `~/.jixiaops/config.json`

```json
{
  "endpoint": "https://mcptest.api.hwcdeveloper.com",
  "endpoint_internal": "http://10.0.0.5:8081",
  "token": "可选：固定身份令牌",
  "defaults": { "line": "line-1", "platforms": "bilibili,xiaohongshu" }
}
```

> 文件权限自动收紧为 600；检测到过宽权限时拒绝读取并告警。

---

## 5. 命令参考 —— `console` 组（ops-web 控制台面）

### 5.1 工作单（核心命令组）

#### `console wo get <id>`

工作单详情，**含 artifacts 投影、闸口状态**（ADR-0005：DB=投影，一切以本命令返回为准）。

```bash
jixiaops console wo get wo-20261105-001
jixiaops console wo get wo-20261105-001 --section gate      # 只看闸口区
jixiaops console wo get wo-20261105-001 --section artifacts # 只看产物
```

#### `console wo new --topic <t> [--line <id>] [--platforms <list>]`

建单。产线独占校验（一条产线同一时刻只允许一张在产单）：

- 409 时 `hint` 自动列出空闲产线；
- `--line` 省略时取 config `defaults.line`。

```bash
jixiaops console wo new --topic "AI Native 运营范式" --confirm
```

#### `console wo brief <id> --file <path>`

上传总纲。**上传即拍板**并快进分镜段（#20 语义）——因此该命令属写操作，默认 dry-run。

#### `console wo upload <id> --file <path> [--kind artifact]`

上传产物（multipart 二进制）。大文件显示进度（`--no-progress` 关闭）。

#### `console wo gate <id> [--pick <n>]`

查看闸口状态；`--pick` 参与拍板类闸口（选题三选一等）。
**人类闸口**（发布确认等）：仅展示 `pending_human` 状态与等待指引，无绕过参数。

#### `console wo pick <id> --n <n>` / `console wo skip <id> [--reason <r>]`

闸口候选选择 / 跳过当前段。写操作，默认 dry-run。

#### `console wo start <id> [--agent <name>]`

派发执行。内部行为：同步发起 → 返回后自动进入**轮询模式**（15s 节律，对齐前端）直到状态离开 `dispatching`，避免 WAF 超时误判（#24 教训）。`--no-wait` 关闭轮询。

```bash
jixiaops console wo start wo-20261105-001 --confirm
jixiaops console wo start wo-20261105-001 --confirm --no-wait   # 只发起不轮询
```

#### `console wo resume <id>` / `console wo close <id>`

恢复中断会话 / 关闭工作单（**高危**：需非访客身份 + `--confirm` 双确认）。

#### `console wo bind-agent <id> --agent <name>`

绑定执行 agent。

### 5.2 产线与节点（只读）

```bash
jixiaops console lines            # 产线状态（含 running/ready 判定，#23 语义）
jixiaops console devices          # 设备清单
jixiaops console agents           # 网关节点实况（fleet 快照）
jixiaops console agent-logs --node <id> [--tail 100]   # 节点日志
```

### 5.3 令牌（**高危**，非访客身份专用）

```bash
jixiaops console tokens                     # 列表（hash 脱敏显示）
jixiaops console token issue --name <n> --lines <l> [--expire <h>]
jixiaops console token revoke <id>
```

访客身份调用 → 退出码 3 + `"hint": "令牌管理需要管理员或 GitCode 身份（jixiaops auth login）"`。

### 5.4 面板与元信息（只读）

```bash
jixiaops console stats       # 全局统计
jixiaops console overview    # 总览（工作单列表视图）
jixiaops console spec        # 平台自述（版本/能力协商，D7 握手数据源）
```

### 5.5 chat 与 WS 会话（D5 全双工，不降级）

CLI 与 MCP 共用同一会话代理内核；CLI 侧是流式子命令，MCP 侧是 `ws_*` toolset。

```bash
# 建立代理会话（真实 WS 长连接，服务端缓冲 + 自动重连 + resume 续接）
jixiaops console ws open --wo <id>          # → {"session":"s1","state":"connected"}

# 发送 / 收取
jixiaops console ws send s1 --text "第二段节奏快一点"
jixiaops console ws read s1                 # 排空缓冲：期间到达的帧全量返回
jixiaops console ws wait s1 --timeout 5000  # 长等下一帧（发一句等回复的主用形态）

# 运维
jixiaops console ws status s1   # 连接状态/缓冲水位/重连次数
jixiaops console ws close s1

# 人类直连形态（不走代理，本地终端直接当聊天窗）
jixiaops console chat stream --wo <id>
```

---

## 6. 命令参考 —— `gw` 组（ai-native-serve 数据面）

> ⚠️ **P0 待盘点项**：网关为 Go 预编译二进制，精确路径/参数在 P0 阶段从运行时补全后锁定。以下为当前已知能力的命令形态预告：

```bash
jixiaops gw workers                 # worker 注册表与心跳实况
jixiaops gw dispatch <wo> --agent <a>   # 直连网关派发（信封令牌，#17 语义）
jixiaops gw token verify <t>        # agent 令牌校验探测
```

`gw` 组默认走 `--endpoint-internal`（数据面不经公网 WAF）。

---

## 7. 与 MCP Server 的关系

| | `jixiaops`（CLI） | `jixiaops-mcp`（MCP） |
|---|---|---|
| 面向 | 人 / agent shell | agent 原生工具协议 |
| 内核 | 同一套 core（auth 链 / http / 安全闸 / WS 代理） | 同左 |
| 写操作 | `--confirm` | tool 参数 `confirm: true` |
| WS | 流式子命令 | `ws_open/send/read/wait/status/close` + 资源订阅推送 |
| 适用 | 脚本、CI、临时排查 | opencode/codex/claude code 常驻接入 |

MCP 接入配置见架构文档附录 A。

---

## 8. 安全须知（使用者也需遵守）

1. **令牌不入 shell 历史**：`auth login --token` 走安全输入；`export JIXIAOPS_TOKEN=...` 写入 shell profile 的行为 CLI 会检测并告警。
2. **`--verbose` 已脱敏**，但请不要把任何 CLI 输出贴到公开渠道前不做检查。
3. **访客身份的能力边界由平台决定**（`GUEST_MODE`），CLI 不做本地放大；`whoami` 永远可以自检当前权限。
4. 缓存文件（`session.json` / `config.json`）位于用户目录、权限 600，请勿共享机器时使用同一账户目录。

---

## 9. 待定项清单（P0/P1 已全部关闭 · 2026-11-05 实测）

| 项 | 状态 | 实测结论 |
|---|---|---|
| `gw` 组精确路径与参数 | ✅ 关闭 | `/health` `/api/nodes` `/api/dispatch?agent=`（同步 1min）+ WS `/ws/node/{id}` `/ws/chat/{id}`；auth `?token=` 或 Bearer |
| `wo` 列表命令形态 | ✅ 关闭 | `/api/lines` 即工作单全量列表（数组）；`/api/overview` 不存在（是 HTML 页面路由） |
| GitCode OAuth 本地回调端口 | ✅ 关闭 | v1 砍 OAuth（访客默认 + 令牌注入已覆盖）；平台侧 OAuth 仅关系控制台登录 |
| 闸口操作的精确参数名 | ✅ 关闭 | `/api/gate` form: `gate,value(approved/rejected),id,comment`；候选"选 N"走 `/api/pick` (step,wo,option,input)；闸口 locked 时拍板 409 |
| 跳过工位范围 | ✅ 关闭 | 仅 `tts`/`subtitle`/`adapt` 可跳，其余 400 |
| 关闭单条件 | ✅ 关闭 | 仅 `new`（放弃）/终态/总刹车在途可完结，其余 409；关闭后成品档案只读 |

## 10. 规格文件

- `docs/openapi.yaml` — console + gw 双后端全端点（3.1，含 x-jixiaops-write / x-jixiaops-min-identity 扩展）
- `docs/asyncapi.yaml` — chat WS 信封协议（ready/prompt/acp/error/pong/cancel/ping）
- 契约测试（schemathesis 对本地 8091 靶场）为 P5 项
