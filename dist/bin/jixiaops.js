#!/usr/bin/env node
// bin/jixiaops.ts —— CLI 入口 v0.5.0（P2 全量命令 + WS 会话代理；TS 重构，行为与 0.3.x 对齐）
// 运行：Node ≥22.18 原生 type stripping，零构建零依赖。
import { api, apiRaw, apiBuf } from "../src/core/http.js";
import { defaultEndpoint, logout } from "../src/core/auth.js";
import { wsOpen, wsSend, wsRead, wsWait, wsStatus, wsClose } from "../src/core/wsproxy.js";
import { apiErr } from "../src/core/types.js";
import { pkgVersion } from "../src/core/version.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
const args = process.argv.slice(2);
const opt = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
        const k = a.slice(2);
        if (["confirm", "pretty", "verbose", "json", "once"].includes(k))
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
const HELP = `jixiaops v${pkgVersion()} —— JixiaOps 平台 CLI

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
值班监控（只读·常驻进程，补「会话外无人触达用户」的洞）:
  console watch [--wo <id>] [--interval s] [--stall min] [--once] [--max s]
                [--notify <url>] [--exec <cmd>]
                                  盯工作单：闸口 pending_human→拍板提醒、状态推进、疑似停摆（updated_at 不动超时）
                                  通知出口：stdout+蜂鸣；--notify webhook（URL 含 feishu/larksuite 自动用飞书格式）；
                                            --exec <cmd>（经 JIXIAOPS_WATCH_MESSAGE 环境变量传消息）
                                  快照落盘 ~/.jixiaops/watch-<wo>.json（与 agent 断点续盯文件共用）
                                  对平台零写操作（默认只通知不动手）；--once 单次检查退出（适合 cron）；Ctrl+C 退出
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
        const me = (await api("GET", "/api/me"));
        if (me.kind === "guest" && !me.admin) {
            me.hint = "当前为访客身份（只读，零配置自动登录）。需要写权限：向平台管理员申请令牌（普通用户无法自行签发，告知名字+需要的产线，由管理员执行签发并交付 token）→ 配置 export JIXIAOPS_TOKEN=<令牌> 或 ~/.jixiaops/config.json {\"token\":\"<令牌>\"} → 重新 whoami 验证";
        }
        out({ ...me, endpoint: defaultEndpoint() });
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
    // ---------- watch（常驻值班：盯状态 + 叫人 + 落盘快照；对平台零写操作） ----------
    if (g === "console" && c === "watch") {
        await cmdWatch();
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
const WATCH_TERMINAL = new Set(["closed", "failed", "cancelled"]);
/** 事件 → 用户可读消息 */
function watchMsg(ev, w, extra) {
    const base = `【JixiaOps·${ev}】${w.id || "?"}（${w.topic || "无主题"}）status=${w.status || "?"}`;
    return extra && Object.keys(extra).length ? `${base} ${JSON.stringify(extra)}` : base;
}
/** webhook 出口：URL 含 feishu/larksuite 时自动用飞书自定义机器人格式，其余发 {text} */
async function watchPost(url, msg) {
    const body = /feishu|larksuite/i.test(url)
        ? { msg_type: "text", content: { text: msg } }
        : { text: msg };
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok)
        throw new Error(`webhook HTTP ${r.status}`);
}
/** console watch 主循环 */
async function cmdWatch() {
    const wo = s("wo");
    const intervalMs = Math.max(3, parseInt(s("interval") || "15", 10)) * 1000;
    const stallMin = parseFloat(s("stall") || "10"); // 分钟，支持小数（测试用 0.05 = 3s）
    const notifyUrl = s("notify");
    const execCmd = s("exec");
    const once = flag("once");
    const maxMs = s("max") ? parseInt(s("max"), 10) * 1000 : 0;
    const deadline = maxMs ? Date.now() + maxMs : 0;
    const snapDir = path.join(os.homedir(), ".jixiaops");
    /** 上轮快照：status/gates/updated_at + 停摆时钟 */
    const prev = new Map();
    /** 收工标记：单工位终态/到时后置位，让事件循环自然退出（Windows 上 process.exit 会撞 stdout 管道断言） */
    let stopped = null;
    const emit = async (msg, bell) => {
        out({ event: msg });
        if (bell)
            process.stdout.write("\x07");
        if (notifyUrl)
            await watchPost(notifyUrl, msg).catch((e) => console.error(JSON.stringify({ warn: `notify 失败: ${e instanceof Error ? e.message : String(e)}` })));
        if (execCmd) {
            try {
                spawn(execCmd, [], { shell: true, stdio: "ignore", env: { ...process.env, JIXIAOPS_WATCH_MESSAGE: msg } });
            }
            catch { /* 通知失败不影响值班 */ }
        }
    };
    const check = async () => {
        let rows;
        if (wo) {
            rows = [(await api("GET", `/api/wo/${wo}`))];
        }
        else {
            const j = (await api("GET", "/api/lines"));
            rows = (j.data ?? []);
        }
        for (const w of rows) {
            const id = String(w.id || "");
            if (!id)
                continue;
            const status = String(w.status ?? "");
            const gatesJson = JSON.stringify(w.gates ?? {});
            const updated = String(w.updated_at ?? "");
            const old = prev.get(id);
            const isBaseline = !old;
            const gatesObj = (w.gates ?? {});
            const pending = Object.entries(gatesObj).filter(([, v]) => v === "pending_human").map(([k]) => k);
            const oldPending = old ? (Object.entries(JSON.parse(old.gates)).filter(([, v]) => v === "pending_human").map(([k]) => k)) : [];
            const freshPending = pending.filter((g) => !oldPending.includes(g));
            const isTerminal = WATCH_TERMINAL.has(status);
            // 停摆时钟：updated_at 首次被观察到的时间（变了就重置）
            const firstSeen = old && old.updated_at === updated ? old.first_seen : Date.now();
            let stallNotified = old && old.updated_at === updated ? old.stall_notified : false;
            // 1) 拍板请求：闸口进入 pending_human（基线也报——cron/once 场景首轮即有用）
            if (freshPending.length)
                await emit(watchMsg("拍板请求", w, { gates: freshPending, hint: "平台在等你决策，去控制台或回复 agent" }), true);
            // 2) 状态推进（跳过基线，避免首轮刷屏）
            if (!isBaseline && status !== old.status)
                await emit(watchMsg("状态推进", w, { from: old.status, to: status }), false);
            // 3) 任务终态（单工位模式基线也报；全量模式基线不报，避免历史 closed 刷屏）
            if (isTerminal && (!isBaseline || Boolean(wo)))
                await emit(watchMsg("任务终态", w), false);
            // 4) 疑似停摆：updated_at 超过 stall 分钟不动、且不在等拍板/终态（每轮只报一次）
            if (!isBaseline && !isTerminal && !pending.length && !stallNotified && stallMin > 0 && Date.now() - firstSeen >= stallMin * 60000) {
                await emit(watchMsg("疑似停摆", w, { updated_at: updated, minutes: stallMin, hint: "编辑器/节点可能未自动推进，需人工查看（本进程不动手，只提醒）" }), true);
                stallNotified = true;
            }
            // 快照落盘（与 agent 断点续盯文件共用）
            try {
                fs.writeFileSync(path.join(snapDir, `watch-${id}.json`), JSON.stringify({
                    id, topic: w.topic, status, gates: gatesObj, updated_at: updated,
                    watched_at: new Date().toISOString(),
                    note: "jixiaops watch 快照：agent 回合恢复/续盯时先读此文件，不从零重查",
                }, null, 2));
            }
            catch { /* 落盘尽力而为 */ }
            prev.set(id, { status, gates: gatesJson, updated_at: updated, first_seen: firstSeen, stall_notified: stallNotified || (isTerminal ? true : false) });
            // 单工位模式：终态即收工（置标记自然退出，不硬 process.exit）
            if (wo && isTerminal) {
                out({ ok: true, exit_reason: "terminal", wo: id, status });
                stopped = "terminal";
                return;
            }
        }
    };
    out({
        ok: true, mode: wo ? `single:${wo}` : "all-active", interval_s: intervalMs / 1000,
        stall_min: stallMin, once, max_s: maxMs ? maxMs / 1000 : null,
        notify: notifyUrl ? "webhook" : execCmd ? "exec" : "stdout",
        readonly: true, hint: "对平台零写操作；Ctrl+C 退出；快照在 ~/.jixiaops/watch-<wo>.json",
    });
    const tick = async () => {
        try {
            await check();
        }
        catch (e) {
            console.error(JSON.stringify({ warn: `本轮查询失败，下轮继续: ${e instanceof Error ? e.message : String(e)}` }));
        }
        if (deadline && Date.now() >= deadline)
            stopped = "max";
    };
    await tick();
    if (once || stopped)
        return;
    // 注意：不 unref——这个 interval 就是值班进程的生命线，事件循环空了进程也不许退
    const timer = setInterval(() => {
        if (stopped) {
            clearInterval(timer);
            return;
        }
        void tick();
    }, intervalMs);
}
main().catch(fail);
