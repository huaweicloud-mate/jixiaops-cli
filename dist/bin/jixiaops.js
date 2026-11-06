#!/usr/bin/env node
// bin/jixiaops.ts —— CLI 入口 v0.5.0（P2 全量命令 + WS 会话代理；TS 重构，行为与 0.3.x 对齐）
// 运行：Node ≥22.18 原生 type stripping，零构建零依赖。
import { api, apiRaw, apiBuf } from "../src/core/http.js";
import { defaultEndpoint, logout } from "../src/core/auth.js";
import { wsOpen, wsSend, wsRead, wsWait, wsStatus, wsClose } from "../src/core/wsproxy.js";
import { apiErr } from "../src/core/types.js";
import fs from "node:fs";
import process from "node:process";
const args = process.argv.slice(2);
const opt = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
        const k = a.slice(2);
        if (["confirm", "pretty", "verbose", "json"].includes(k))
            opt[k] = true;
        else
            opt[k] = args[++i];
    }
    else
        pos.push(a);
}
if (opt.endpoint)
    process.env.JIXIAOPS_ENDPOINT = String(opt.endpoint);
const s = (k) => { const v = opt[k]; return typeof v === "string" ? v : undefined; };
const flag = (k) => opt[k] === true;
const HELP = `jixiaops v0.5.2 —— JixiaOps 平台 CLI

用法: jixiaops <group> <command> [args] [options]

认证:
  console auth whoami                     当前身份与权限
  console auth logout                     吊销会话/清缓存
工作单:
  console wo list                         全量工作单（含 agents/artifacts/gates 投影）
  console wo get <id> [--section gate|artifacts|agents]
  console wo new --topic <t> [--line <l>] [--platforms <p>]
  console wo brief <id> --file <md>       上传总纲（上传即拍板，快进分镜）
  console wo upload <id> --file <f> [--as <name>] [--step <step>]
  console wo gate <id>                     闸口状态
  console wo gate <id> --gate <g> --value approved|rejected [--comment <c>]
  console wo pick <id> --step <s> --option <n> [--input <t>]   候选选择（选题"选 N"走这里）
  console wo skip <id> --step <s> [--reason <r>]
  console wo start <id> [--mode <m>]      派发（自动轮询至脱离 dispatching）
  console wo bind <id> --agent <a>        绑定执行节点
  console wo artifact url <id> --file <f> [--ttl s]   产物签名直链（点开即看，免登录）
  console wo artifact get <id> --file <f> [--out p]   下载产物到本地
  console wo close <id> [--reason <r>]    关闭（高危·非访客身份）
产线/节点（只读）:
  console lines|devices|agents|agent-logs|stats|spec
令牌（高危·非访客身份）:
  console token list | issue --name <n> --lines <l1,l2> | revoke --hash <h>
总闸:
  console halt [--confirm] | console resume
WS 会话代理（chat 全双工，D5）:
  console ws chat --agent <id> --text <t> [--resume <sid>]   一次性对话（开→发→等回合结束→关）
  console ws open --agent <agent_id> [--resume <sid>]        （MCP 常驻宿主用；CLI 单命令进程会话不跨进程）
  console ws send <session> --text <t>
  console ws read <session>               排空收件缓冲
  console ws wait <session> [--timeout 10000]
  console ws status <session> | console ws close <session>

MCP Server:
  mcp                                     启动 MCP Server（stdio，等价于 jixiaops-mcp）

全局: --endpoint <url>  --pretty  --verbose
写操作默认 dry-run，--confirm 才执行（D4）；人类闸口无绕过参数。`;
function out(j) {
    console.log(flag("pretty") ? JSON.stringify(j, null, 2) : JSON.stringify(j));
}
function fail(e) {
    const err = e;
    console.error(JSON.stringify({ error: err.message, hint: err.hint || undefined, http: err.http || undefined }));
    process.exit(err.exit || 1);
}
function need(v, msg) {
    if (!v) {
        console.error(JSON.stringify({ error: msg }));
        process.exit(1);
    }
}
async function main() {
    const [g, c, ...rest] = pos;
    if (!g || g === "help" || g === "--help") {
        console.log(HELP);
        return;
    }
    // ---------- MCP Server（同内核第二入口：jixiaops mcp → jixiaops-mcp）----------
    if (g === "mcp") {
        await import("./jixiaops-mcp.js");
        return; // 该模块 import 即启动 stdio 服务
    }
    // ---------- 认证 ----------
    if (g === "console" && c === "auth" && rest[0] === "whoami") {
        out({ ...(await api("GET", "/api/me")), endpoint: defaultEndpoint() });
        return;
    }
    if (g === "console" && c === "auth" && rest[0] === "logout") {
        logout();
        out({ ok: true, cleared: "local session cache" });
        return;
    }
    // ---------- 工作单 ----------
    if (g === "console" && c === "wo") {
        const sub = rest[0];
        if (sub === "list") {
            const j = await api("GET", "/api/lines");
            out(j.data ?? j);
            return;
        }
        if (sub === "get") {
            need(rest[1], "缺工作单 id");
            const j = await api("GET", `/api/wo/${rest[1]}`);
            const section = s("section");
            if (section)
                out({ [section]: j[section] ?? null });
            else
                out(j);
            return;
        }
        if (sub === "new") {
            need(s("topic"), "缺 --topic");
            const body = { topic: s("topic"), platforms: s("platforms") || "bilibili" };
            if (s("line"))
                body.line = s("line");
            if (!flag("confirm")) {
                out({ dry_run: true, will_post: "/api/new", body, hint: "加 --confirm 执行" });
                return;
            }
            out(await api("POST", "/api/new", { body }));
            return;
        }
        if (sub === "brief") {
            need(rest[1] && s("file"), "用法: wo brief <id> --file <md>");
            const text = fs.readFileSync(s("file"), "utf8");
            if (!flag("confirm")) {
                out({ dry_run: true, will_post: `/api/brief?wo=${rest[1]}`, bytes: Buffer.byteLength(text), hint: "上传即拍板（快进分镜）——加 --confirm 执行" });
                return;
            }
            out(await apiRaw("POST", `/api/brief?wo=${encodeURIComponent(rest[1])}`, Buffer.from(text), "text/plain; charset=utf-8"));
            return;
        }
        if (sub === "upload") {
            need(rest[1] && s("file"), "用法: wo upload <id> --file <f> [--as <name>] [--step <s>]");
            const file = s("file");
            const fname = (s("as") || file.split(/[\\/]/).pop() || "").replace(/\\/g, "/");
            const step = s("step");
            const qs = `wo=${encodeURIComponent(rest[1])}&file=${encodeURIComponent(fname)}${step ? `&step=${encodeURIComponent(step)}` : ""}`;
            if (!flag("confirm")) {
                out({ dry_run: true, will_post: `/api/upload?${qs}`, bytes: fs.statSync(file).size, hint: "加 --confirm 执行" });
                return;
            }
            out(await apiRaw("POST", `/api/upload?${qs}`, fs.readFileSync(file), "application/octet-stream"));
            return;
        }
        if (sub === "gate") {
            need(rest[1], "缺工作单 id");
            if (s("value") === undefined && s("pick") === undefined) { // 只看闸口
                const j = await api("GET", `/api/wo/${rest[1]}`);
                out({ status: j.status, gates: j.gates, gate_comments: j.gate_comments, gate_files: j.gate_files });
                return;
            }
            need(s("gate"), "--value 需同时指定 --gate <名>（如 topic/hook/publish）");
            const value = s("value") || s("pick") || ""; // 兼容旧写法（--pick）
            if (!["approved", "rejected"].includes(value)) {
                throw apiErr("闸口值只允许 approved / rejected（候选选择用 wo pick）", { exit: 1 });
            }
            const body = { gate: s("gate"), value, id: rest[1] };
            if (s("comment"))
                body.comment = s("comment");
            if (!flag("confirm")) {
                out({ dry_run: true, will_post: "/api/gate", body });
                return;
            }
            out(await api("POST", "/api/gate", { body }));
            return;
        }
        if (sub === "pick") {
            need(rest[1] && s("step") && s("option") !== undefined, "用法: wo pick <id> --step <s> --option <n> [--input <t>]");
            const body = { step: s("step"), wo: rest[1], option: String(s("option")) };
            if (s("input"))
                body.input = s("input");
            if (!flag("confirm")) {
                out({ dry_run: true, will_post: "/api/pick", body });
                return;
            }
            out(await api("POST", "/api/pick", { body }));
            return;
        }
        if (sub === "skip") {
            need(rest[1] && s("step"), "用法: wo skip <id> --step <s>");
            const body = { step: s("step"), wo: rest[1], skipped: true };
            if (s("reason"))
                body.note = s("reason");
            if (!flag("confirm")) {
                out({ dry_run: true, will_post: "/api/skip", body });
                return;
            }
            out(await api("POST", "/api/skip", { body }));
            return;
        }
        if (sub === "start") {
            need(rest[1], "缺工作单 id");
            const body = { wo: rest[1] };
            if (s("mode"))
                body.mode = s("mode");
            if (!flag("confirm")) {
                out({ dry_run: true, will_post: "/api/start", body, hint: "派发前确认节点在线（console agents）" });
                return;
            }
            const j = await api("POST", "/api/start", { body });
            out(j);
            return; // 服务端同步返回派发结果或 502/504，无需 CLI 二次轮询
        }
        if (sub === "bind") {
            need(rest[1] && s("agent"), "用法: wo bind <id> --agent <a>");
            // bind-agent 按 line 维度；先取工作单所在产线
            const w = (await api("GET", `/api/wo/${rest[1]}`));
            const body = { line: w.line || s("line"), agent: s("agent") };
            if (!flag("confirm")) {
                out({ dry_run: true, will_post: "/api/bind-agent", body });
                return;
            }
            out(await api("POST", "/api/bind-agent", { body }));
            return;
        }
        if (sub === "close") {
            need(rest[1], "缺工作单 id");
            const body = { id: rest[1], reason: s("reason") || "" };
            if (!flag("confirm")) {
                out({ dry_run: true, will_post: "/api/wo-close", body, warning: "关闭后成品档案只读，高危操作" });
                return;
            }
            out(await api("POST", "/api/wo-close", { body }));
            return;
        }
        if (sub === "artifact") {
            // wo artifact url <id> --file <rel> [--ttl s]   → 签名直链（点开即看，不暴露长期 token）
            // wo artifact get <id> --file <rel> [--out p]  → 下载到本地
            const act = rest[1];
            if (act !== "url" && act !== "get") {
                throw apiErr("用法: wo artifact url|get <id> --file <rel> [--ttl s | --out p]", { exit: 1 });
            }
            need(rest[2] && s("file"), "用法: wo artifact url|get <id> --file <rel> [--ttl s | --out p]");
            const rel = s("file").replace(/\\/g, "/").replace(/^\/+/, "");
            const qs = `wo=${encodeURIComponent(rest[2])}&file=${encodeURIComponent(rel)}${s("ttl") ? `&ttl=${s("ttl")}` : ""}`;
            const j = await api("GET", `/api/artifact/sign?${qs}`);
            const urlPath = typeof j.url === "string" ? j.url : "";
            if (act === "url") {
                out(j);
                return;
            }
            const dest = (s("out") || rel.split("/").pop() || "artifact.bin");
            const buf = await apiBuf(urlPath);
            fs.writeFileSync(dest, buf);
            out({ ok: true, file: dest, bytes: buf.length, source: urlPath });
            return;
        }
    }
    // ---------- 只读 ----------
    const READONLY = { lines: "/api/lines", devices: "/api/devices", agents: "/api/agents",
        "agent-logs": "/api/agent-logs", stats: "/api/stats", spec: "/api/spec" };
    if (g === "console" && c && READONLY[c]) {
        out(await api("GET", READONLY[c]));
        return;
    }
    // ---------- 令牌（高危） ----------
    if (g === "console" && c === "token") {
        const me = (await api("GET", "/api/me"));
        if (me.kind === "guest" && !me.admin) {
            throw apiErr("令牌管理需要管理员或 GitCode 身份（当前为访客）", {
                hint: "jixiaops auth login 或 export JIXIAOPS_TOKEN=<管理员令牌>", exit: 3,
            });
        }
        if (rest[0] === "list") {
            out(await api("GET", "/api/tokens"));
            return;
        }
        if (rest[0] === "issue") {
            need(s("name") && s("lines"), "用法: token issue --name <n> --lines <l1,l2> [--confirm]");
            const body = { user_name: s("name"), line_ids: (s("lines") || "").split(",") };
            if (!flag("confirm")) {
                out({ dry_run: true, will_post: "/api/token-issue", body });
                return;
            }
            out(await api("POST", "/api/token-issue", { body }));
            return;
        }
        if (rest[0] === "revoke") {
            need(s("hash"), "用法: token revoke --hash <h> --confirm");
            if (!flag("confirm")) {
                out({ dry_run: true, will_post: "/api/token-revoke", body: { token_hash: s("hash") } });
                return;
            }
            out(await api("POST", "/api/token-revoke", { body: { token_hash: s("hash") } }));
            return;
        }
    }
    // ---------- 总闸 ----------
    if (g === "console" && (c === "halt" || c === "resume")) {
        if (!flag("confirm")) {
            out({ dry_run: true, will_post: `/api/${c === "halt" ? "h" : "resume"}`, warning: "总刹车影响全部工作单推进" });
            return;
        }
        out(await api("POST", `/api/${c === "halt" ? "h" : "resume"}`, { body: {} }));
        return;
    }
    // ---------- WS 会话代理 ----------
    if (g === "console" && c === "ws") {
        const sub = rest[0], sid = rest[1];
        if (sub === "chat") {
            need(s("agent") && s("text"), "用法: ws chat --agent <id> --text <t> [--resume <sid>]");
            const o = await wsOpen({ agent: s("agent"), resume: s("resume"), verbose: true });
            if (!o.chat_id) {
                out({ ...o, hint: o.hint || "会话未就绪" });
                return;
            }
            await wsSend(o.session, s("text"));
            // 等回合结束：ACP turn 结束标志 = 收到含 stopReason 的 jsonrpc result 帧
            const deadline = Date.now() + 120000;
            const frames = [];
            while (Date.now() < deadline) {
                const r = await wsWait(o.session, 15000);
                if (r.error || r.timeout)
                    break;
                frames.push(...(r.frames ?? []));
                if (frames.some(f => f.result?.stopReason || f.ch === "stop"))
                    break;
            }
            const texts = frames
                .map((f) => {
                const upd = f.msg?.update;
                if (upd?.sessionUpdate === "agent_message_chunk")
                    return upd.content?.text ?? null;
                if (f.ch === "prompt_reply")
                    return f.text ?? null;
                return null;
            })
                .filter((t) => Boolean(t));
            out({ session: o.session, sid: o.sid, replies: texts.length ? texts : frames.slice(-5), frames_total: frames.length });
            await wsClose(o.session);
            return;
        }
        if (sub === "open") {
            need(s("agent"), "用法: ws open --agent <agent_id> [--resume <sid>]");
            out(await wsOpen({ agent: s("agent"), resume: s("resume"), verbose: flag("verbose") }));
            return;
        }
        if (sub === "send") {
            need(sid && s("text"), "用法: ws send <session> --text <t>");
            out(await wsSend(sid, s("text")));
            return;
        }
        if (sub === "read") {
            need(sid, "用法: ws read <session>");
            out(wsRead(sid));
            return;
        }
        if (sub === "wait") {
            need(sid, "用法: ws wait <session> [--timeout ms]");
            out(await wsWait(sid, parseInt(s("timeout") || "10000", 10)));
            return;
        }
        if (sub === "status") {
            need(sid, "用法: ws status <session>");
            out(wsStatus(sid));
            return;
        }
        if (sub === "close") {
            need(sid, "用法: ws close <session>");
            out(wsClose(sid));
            return;
        }
    }
    console.error(JSON.stringify({ error: `未知命令: ${pos.join(" ")}`, hint: "jixiaops help 查看用法" }));
    process.exit(1);
}
main().catch(fail);
