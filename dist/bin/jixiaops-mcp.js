#!/usr/bin/env node
// bin/jixiaops-mcp.ts —— MCP Server（stdio，newline-delimited JSON-RPC 2.0，零依赖）
// 工具集：CLI 同内核策展视图（架构文档 D2/§7）。写工具一律要求 confirm:true（D4）。
import { api, apiRaw } from "../src/core/http.js";
import { wsOpen, wsSend, wsRead, wsWait, wsStatus, wsClose, wsList } from "../src/core/wsproxy.js";
import { pkgVersion } from "../src/core/version.js";
import fs from "node:fs";
import readline from "node:readline";
import process from "node:process";
const NEED_CONFIRM = { error: "这是写操作", hint: "调用时传 confirm:true 执行；建议先说明将产生的影响" };
// ---------- 执行指导（回合纪律） ----------
// 传递通道：① initialize.instructions（全局注入）② 工具 description（静态）③ 写操作返回值 hint（时机最准）。
// 目标行为：派发后持有回合监听，直到拿到执行结果、形成具体拍板请求才收尾——禁止空头承诺式收尾。
const TURN_DISCIPLINE = [
    "# jixiaops 执行纪律（派发/监控场景必读）",
    "产线任务是异步的：wo_start 派发后节点在后台执行，推进情况要靠你监听。规则：",
    "1. 派发/推段成功后，持有当前回合进入监听循环：首选 chat_wait 长等节点帧；无 WS 会话时退化为每 15~30s wo_get/wo_gate 轮询。",
    "2. 循环退出条件（满足其一才允许结束回合）：",
    "   a. 闸口进入 pending_human → 向用户发出具体拍板请求（附产物/预览直链 + 「过 / 改」选项）；",
    "   b. 任务到达终态（closed/failed）→ 汇报结果；",
    "   c. 异常（节点离线/费用超线/停摆超时）→ 上报现状并给出选项。",
    "3. 禁止：监听循环未达退出条件就结束回合；禁止「我继续盯着，有动静随时汇报」这类无终止承诺的收尾。",
    "4. 回合被迫中断时（宿主超时/上下文上限）：先落状态文件 ~/.jixiaops/watch-<wo_id>.json（在盯什么、循环到哪、恢复条件），",
    "   再如实告知用户「本轮监听到此暂停，回来说『继续盯』即可从断点恢复」；下一回合先读该文件再续，不从零重查。",
    "5. 宿主提供 shell 执行时：优先用现成的值班命令 `jixiaops console watch --wo <id>`（常驻进程：盯状态→通知用户→落盘快照，对平台只读）",
    "   替代手写脚本；也可另写零依赖轮询脚本，职责仅限「状态变化时通知用户（系统通知/IM webhook）+ 落盘最新快照」；",
    "   后台进程无法唤醒 agent 会话，不得以此替代规则 1 的监听循环。",
    "6. 首次建单/派发时，先用一两句向用户预告本流程的人工闸点（如选题/钩子/成片/发布等 N 处需要人工拍板），",
    "   让用户对「每一步需要人参与」有预期——不要等闸口停下才第一次告知。",
    "7. 算力口径（防误解红线）：工作单的全部生产环节（配音/编码/装配）都运行在**平台产线节点（云端 ECS worker）**上，",
    "   不占用用户本机任何算力；平台执行记录里的「本地/本机/纯本地 ffmpeg」等说法均指**该执行节点的本地**，",
    "   不是用户的电脑。向用户转述执行细节时必须带上这层说明（如「在产线节点（云端 ECS）本地计算」）。",
].join("\n");
const AFTER_DISPATCH_HINT = "已派发，节点异步执行中：进入监听循环（chat_wait 长等，或每 15~30s wo_get 轮询），" +
    "直到闸口 pending_human（发具体拍板请求）/ 任务终态 / 异常才允许结束回合；" +
    "禁止「继续盯着，有动静随时汇报」式无终止收尾。";
const AFTER_CHAT_OPEN_HINT = "会话已建立：监听主用形态是 chat_wait(session, timeout_ms) 长等下一帧；" +
    "agent 忙别的时帧进服务端缓冲不丢，回来用 chat_read 排空。" +
    "持有回合直到闸口 pending_human / 任务终态 / 异常才收尾。";
// ---------- 身份与凭据 FAQ（instructions 第二节 + whoami 访客提示） ----------
const CREDENTIAL_FAQ = [
    "# 身份与凭据（用户问「凭据/权限/怎么登录」时按此回答，不要臆造）",
    "- 插件默认**访客身份自动登录**（零配置，只读），开箱即可试用；",
    "- **凭据 = 平台令牌（token）**，由平台管理员签发：`jixiaops console token issue --name <名字> --lines <产线列表>`；",
    "- 用户配置方式（二选一）：① 环境变量 `export JIXIAOPS_TOKEN=<令牌>`；② 写入文件 `~/.jixiaops/config.json` 内容 `{\"token\":\"<令牌>\"}`；",
    "- 配置后重新调用 whoami 验证身份（_identity.source 会标明用的是哪条凭据）；",
    "- 写操作（建单/派发/拍板/令牌管理）需要非访客身份；访客被拒时按上述指引引导用户配置，不要反复重试。",
].join("\n");
const TOOLS = [
    {
        name: "whoami",
        description: "查看当前平台身份与权限（访客/管理员/GitCode），判断可执行的操作范围；访客身份时返回值带凭据配置指引",
        inputSchema: { type: "object", properties: {}, required: [] },
        read: true,
        run: async () => {
            const me = (await api("GET", "/api/me"));
            if (me.kind === "guest" && !me.admin)
                return { ...me, hint: "当前为访客身份（只读，零配置自动登录）。需要写权限时向用户解释：凭据=平台令牌，由管理员签发（jixiaops console token issue）；用户配置方式二选一：export JIXIAOPS_TOKEN=<令牌>，或写入 ~/.jixiaops/config.json {\"token\":\"<令牌>\"}，配置后重新 whoami 验证" };
            return me;
        },
    },
    {
        name: "wo_list",
        description: "列出全部工作单（含状态、产线、agents 执行记录、产物投影）",
        inputSchema: { type: "object", properties: {}, required: [] },
        read: true,
        run: async () => {
            const j = await api("GET", "/api/lines");
            const rows = (Array.isArray(j.data) ? j.data : []);
            return rows.map((w) => ({ id: w.id, line: w.line, topic: w.topic, status: w.status, gates: w.gates, artifacts: (w.artifacts || []).length }));
        },
    },
    {
        name: "wo_get",
        description: "读取单张工作单详情（状态机、闸口、产物、执行记录）",
        inputSchema: { type: "object", properties: { id: { type: "string", description: "工作单号 wo-..." } }, required: ["id"] },
        read: true,
        run: async (a) => api("GET", `/api/wo/${a.id}`),
    },
    {
        name: "wo_create",
        description: "创建工作单。产线独占：同一产线同时只允许一张在产单（409 时返回空闲产线建议）",
        inputSchema: { type: "object", properties: {
                topic: { type: "string" }, line: { type: "string" },
                platforms: { type: "string", description: "逗号分隔，默认 bilibili" },
                confirm: { type: "boolean", description: "写操作确认" }
            }, required: ["topic"] },
        run: async (a) => {
            if (a.confirm !== true)
                return NEED_CONFIRM;
            const body = { topic: a.topic, platforms: a.platforms || "bilibili" };
            if (a.line)
                body.line = a.line;
            return api("POST", "/api/new", { body });
        },
    },
    {
        name: "wo_brief",
        description: "上传总纲 markdown（上传即拍板，选题闸口自动 approved 并快进分镜段）",
        inputSchema: { type: "object", properties: {
                id: { type: "string" }, text: { type: "string", description: "总纲 markdown 全文" },
                confirm: { type: "boolean" }
            }, required: ["id", "text"] },
        run: async (a) => {
            if (a.confirm !== true)
                return NEED_CONFIRM;
            return apiRaw("POST", `/api/brief?wo=${encodeURIComponent(String(a.id))}`, Buffer.from(String(a.text), "utf8"), "text/plain; charset=utf-8");
        },
    },
    {
        name: "wo_upload_artifact",
        description: "上传产物文件到工作单 artifacts（文件名限字母数字 . _ - 与子目录，200MB 上限）",
        inputSchema: { type: "object", properties: {
                id: { type: "string" }, file: { type: "string", description: "本地文件绝对路径" },
                as: { type: "string", description: "登记名（缺省用文件名）" },
                step: { type: "string", description: "工位（protocol v2）：topic/storyboard/video/assembling..." },
                confirm: { type: "boolean" }
            }, required: ["id", "file"] },
        run: async (a) => {
            if (a.confirm !== true)
                return NEED_CONFIRM;
            const name = (typeof a.as === "string" && a.as ? a.as : (String(a.file).split(/[\\/]/).pop() || "")).replace(/\\/g, "/");
            const step = typeof a.step === "string" ? a.step : "";
            const qs = `wo=${encodeURIComponent(String(a.id))}&file=${encodeURIComponent(name)}${step ? `&step=${encodeURIComponent(step)}` : ""}`;
            return apiRaw("POST", `/api/upload?${qs}`, fs.readFileSync(String(a.file)), "application/octet-stream");
        },
    },
    {
        name: "wo_gate",
        description: "查看工作单闸口状态（gates/gate_comments/gate_files）。人类闸口（pending_human）只读展示，不可代拍",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        read: true,
        run: async (a) => {
            const j = await api("GET", `/api/wo/${a.id}`);
            return { status: j.status, gates: j.gates, gate_comments: j.gate_comments, gate_files: j.gate_files };
        },
    },
    {
        name: "wo_gate_decide",
        description: "对工作闸口拍板（value 只允许 approved/rejected；候选选择用 wo_pick 同级的 pick 流程。人类闸口由人工拍板，工具只代传达）",
        inputSchema: { type: "object", properties: {
                id: { type: "string" }, gate: { type: "string" },
                value: { type: "string", enum: ["approved", "rejected"] },
                comment: { type: "string" }, confirm: { type: "boolean" }
            }, required: ["id", "gate", "value"] },
        run: async (a) => {
            if (a.confirm !== true)
                return NEED_CONFIRM;
            const body = { gate: a.gate, value: a.value, id: a.id };
            if (a.comment)
                body.comment = a.comment;
            return api("POST", "/api/gate", { body });
        },
    },
    {
        name: "wo_skip",
        description: "跳过工作单某工位",
        inputSchema: { type: "object", properties: {
                id: { type: "string" }, step: { type: "string" }, note: { type: "string" }, confirm: { type: "boolean" }
            },
            required: ["id", "step"] },
        run: async (a) => {
            if (a.confirm !== true)
                return NEED_CONFIRM;
            const body = { step: a.step, wo: a.id, skipped: true };
            if (a.note)
                body.note = a.note;
            return api("POST", "/api/skip", { body });
        },
    },
    {
        name: "wo_start",
        description: "派发工作单到产线节点执行（同步等待网关派发回执；节点离线返回 502 + 接入指引）。派发成功后必须进入监听循环持有回合，直到闸口 pending_human / 任务终态 / 异常才允许收尾（返回值 _next 有细则）",
        inputSchema: { type: "object", properties: {
                id: { type: "string" }, mode: { type: "string" }, confirm: { type: "boolean" }
            }, required: ["id"] },
        run: async (a) => {
            if (a.confirm !== true)
                return NEED_CONFIRM;
            const body = { wo: a.id };
            if (a.mode)
                body.mode = a.mode;
            const r = await api("POST", "/api/start", { body });
            return { ...r, _next: AFTER_DISPATCH_HINT };
        },
    },
    {
        name: "wo_close",
        description: "关闭工作单（成品档案只读，高危）",
        inputSchema: { type: "object", properties: {
                id: { type: "string" }, reason: { type: "string" }, confirm: { type: "boolean" }
            }, required: ["id"] },
        run: async (a) => {
            if (a.confirm !== true)
                return NEED_CONFIRM;
            return api("POST", "/api/wo-close", { body: { id: a.id, reason: a.reason || "" } });
        },
    },
    {
        name: "lines_status",
        description: "产线与节点状态（哪些产线空闲/忙碌、节点在线）",
        inputSchema: { type: "object", properties: {}, required: [] },
        read: true,
        run: async () => api("GET", "/api/lines"),
    },
    {
        name: "agents_fleet",
        description: "网关节点实况（在线 agent 列表与负载）",
        inputSchema: { type: "object", properties: {}, required: [] },
        read: true,
        run: async () => api("GET", "/api/agents"),
    },
    {
        name: "token_issue",
        description: "签发产线令牌（高危·需管理员/GitCode 身份，访客会被拒绝）",
        inputSchema: { type: "object", properties: {
                user_name: { type: "string" }, line_ids: { type: "array", items: { type: "string" } },
                confirm: { type: "boolean" }
            }, required: ["user_name", "line_ids"] },
        run: async (a) => {
            if (a.confirm !== true)
                return NEED_CONFIRM;
            const me = (await api("GET", "/api/me"));
            if (me.kind === "guest" && !me.admin) {
                return { error: "令牌管理需要管理员或 GitCode 身份（当前为访客）", hint: "配置 JIXIAOPS_TOKEN 后重试" };
            }
            return api("POST", "/api/token-issue", { body: { user_name: a.user_name, line_ids: a.line_ids } });
        },
    },
    // ---------- WS 会话代理（D5：全双工，不降级） ----------
    {
        name: "chat_open",
        description: "与产线节点建立 chat 会话（真实 WS 长连接，服务端缓冲不丢帧；返回 session 句柄与 sid）。监听主用形态：chat_wait 长等下一帧",
        inputSchema: { type: "object", properties: {
                agent: { type: "string", description: "节点 agent_id" },
                resume: { type: "string", description: "续接历史会话的 sid（可选）" }
            }, required: ["agent"] },
        read: true,
        run: async (a) => {
            const r = await wsOpen({ agent: String(a.agent), resume: a.resume ? String(a.resume) : undefined });
            return { ...r, hint: AFTER_CHAT_OPEN_HINT };
        },
    },
    {
        name: "chat_send",
        description: "向已建立的 chat 会话发送一条消息（session/prompt）",
        inputSchema: { type: "object", properties: {
                session: { type: "string" }, text: { type: "string" }
            }, required: ["session", "text"] },
        run: async (a) => wsSend(String(a.session), String(a.text)),
    },
    {
        name: "chat_read",
        description: "排空 chat 会话收件缓冲（两次调用间到达的帧全量返回，不丢）",
        inputSchema: { type: "object", properties: { session: { type: "string" } }, required: ["session"] },
        read: true,
        run: async (a) => wsRead(String(a.session)),
    },
    {
        name: "chat_wait",
        description: "长等 chat 会话下一帧（监听循环主用形态：事件到达立即返回，无事件干等不耗 token；循环直到闸口 pending_human / 任务终态 / 异常才允许收尾）",
        inputSchema: { type: "object", properties: {
                session: { type: "string" }, timeout_ms: { type: "number", default: 10000 }
            }, required: ["session"] },
        read: true,
        run: async (a) => wsWait(String(a.session), typeof a.timeout_ms === "number" ? a.timeout_ms : 10000),
    },
    {
        name: "chat_status",
        description: "查看 chat 会话连接状态/缓冲水位/重连次数",
        inputSchema: { type: "object", properties: { session: { type: "string" } }, required: ["session"] },
        read: true,
        run: async (a) => wsStatus(String(a.session)),
    },
    {
        name: "chat_close",
        description: "关闭 chat 会话",
        inputSchema: { type: "object", properties: { session: { type: "string" } }, required: ["session"] },
        run: async (a) => wsClose(String(a.session)),
    },
];
const rl = readline.createInterface({ input: process.stdin });
function send(j) {
    process.stdout.write(JSON.stringify(j) + "\n");
}
rl.on("line", (line) => {
    let msg;
    try {
        msg = JSON.parse(line);
    }
    catch {
        return;
    }
    handle(msg).catch((e) => {
        if (msg.id !== undefined && msg.id !== null) {
            send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String(e instanceof Error ? e.message : e) } });
        }
    });
});
async function handle(msg) {
    const { id, method, params } = msg;
    switch (method) {
        case "initialize":
            send({ jsonrpc: "2.0", id, result: {
                    protocolVersion: params?.protocolVersion || "2024-11-05",
                    capabilities: { tools: {}, resources: {} },
                    serverInfo: { name: "jixiaops-mcp", version: pkgVersion() },
                    instructions: TURN_DISCIPLINE + "\n\n" + CREDENTIAL_FAQ,
                } });
            return;
        case "notifications/initialized": return;
        case "ping":
            send({ jsonrpc: "2.0", id, result: {} });
            return;
        case "tools/list":
            send({ jsonrpc: "2.0", id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
            return;
        case "tools/call": {
            const t = TOOLS.find(x => x.name === params?.name);
            if (!t) {
                send({ jsonrpc: "2.0", id, error: { code: -32602, message: `未知工具: ${params?.name}` } });
                return;
            }
            try {
                const r = await t.run(params?.arguments || {});
                send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !!(r && typeof r === "object" && "error" in r) } });
            }
            catch (e) {
                const err = e;
                send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ error: err.message, hint: err.hint, http: err.http }, null, 2) }], isError: true } });
            }
            return;
        }
        case "resources/list": {
            // workorder 只读资源（ADR-0005：DB=投影，资源读 /api/wo）
            try {
                const j = await api("GET", "/api/lines");
                const rows = (Array.isArray(j.data) ? j.data : []);
                const wos = rows.map((w) => ({ uri: `wo://${w.id}`, name: `${w.id} ${w.topic || ""}`, mimeType: "application/json" }));
                send({ jsonrpc: "2.0", id, result: { resources: wos } });
            }
            catch {
                send({ jsonrpc: "2.0", id, result: { resources: [] } });
            }
            return;
        }
        case "resources/read": {
            const m = String(params?.uri || "").match(/^wo:\/\/(\S+)$/);
            if (!m) {
                send({ jsonrpc: "2.0", id, error: { code: -32602, message: "仅支持 wo://<id>" } });
                return;
            }
            const j = await api("GET", `/api/wo/${m[1]}`);
            send({ jsonrpc: "2.0", id, result: { contents: [{ uri: params?.uri ?? `wo://${m[1]}`, mimeType: "application/json", text: JSON.stringify(j, null, 2) }] } });
            return;
        }
        default:
            if (id !== undefined && id !== null)
                send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
    }
}
process.stderr.write(`jixiaops-mcp v${pkgVersion()} ready (${TOOLS.length} tools)\n`);
