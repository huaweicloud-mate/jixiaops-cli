#!/usr/bin/env node
// bin/ainative.mjs —— CLI 入口 v0.3.0（P2 全量命令 + WS 会话代理）
import { api, apiRaw } from "../src/core/http.mjs";
import { defaultEndpoint, logout } from "../src/core/auth.mjs";
import { wsOpen, wsSend, wsRead, wsWait, wsStatus, wsClose } from "../src/core/wsproxy.mjs";
import fs from "node:fs";
import process from "node:process";

const args = process.argv.slice(2);
const opt = {}; const pos = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    if (["confirm", "pretty", "verbose", "json"].includes(k)) opt[k] = true;
    else opt[k] = args[++i];
  } else pos.push(a);
}
if (opt.endpoint) process.env.AINATIVE_ENDPOINT = opt.endpoint;

const HELP = `ainative v0.3.0 —— OperationAINative 平台 CLI

用法: ainative <group> <command> [args] [options]

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
  console wo pick <id> --step <s> --option <n> [--input <t>]
  console wo skip <id> --step <s> [--reason <r>]
  console wo start <id> [--mode <m>]      派发（自动轮询至脱离 dispatching）
  console wo bind <id> --agent <a>        绑定执行节点
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

全局: --endpoint <url>  --pretty  --verbose
写操作默认 dry-run，--confirm 才执行（D4）；人类闸口无绕过参数。`;

function out(j) { console.log(opt.pretty ? JSON.stringify(j, null, 2) : JSON.stringify(j)); }
function fail(e) {
  console.error(JSON.stringify({ error: e.message, hint: e.hint || undefined, http: e.http || undefined }));
  process.exit(e.exit || 1);
}
function need(v, msg) { if (!v) { console.error(JSON.stringify({ error: msg })); process.exit(1); } }

async function main() {
  const [g, c, ...rest] = pos;
  if (!g || g === "help" || g === "--help") { console.log(HELP); return; }

  // ---------- 认证 ----------
  if (g === "console" && c === "auth" && rest[0] === "whoami") {
    out({ ...(await api("GET", "/api/me")), endpoint: defaultEndpoint() }); return;
  }
  if (g === "console" && c === "auth" && rest[0] === "logout") {
    logout(); out({ ok: true, cleared: "local session cache" }); return;
  }

  // ---------- 工作单 ----------
  if (g === "console" && c === "wo") {
    const sub = rest[0];
    if (sub === "list") { const j = await api("GET", "/api/lines"); out(j.data ?? j); return; }
    if (sub === "get") {
      need(rest[1], "缺工作单 id");
      const j = await api("GET", `/api/wo/${rest[1]}`);
      if (opt.section) out({ [opt.section]: j[opt.section] ?? null }); else out(j);
      return;
    }
    if (sub === "new") {
      need(opt.topic, "缺 --topic");
      const body = { topic: opt.topic, platforms: opt.platforms || "bilibili" };
      if (opt.line) body.line = opt.line;
      if (!opt.confirm) { out({ dry_run: true, will_post: "/api/new", body, hint: "加 --confirm 执行" }); return; }
      out(await api("POST", "/api/new", { body })); return;
    }
    if (sub === "brief") {
      need(rest[1] && opt.file, "用法: wo brief <id> --file <md>");
      const text = fs.readFileSync(opt.file, "utf8");
      if (!opt.confirm) { out({ dry_run: true, will_post: `/api/brief?wo=${rest[1]}`, bytes: Buffer.byteLength(text), hint: "上传即拍板（快进分镜）——加 --confirm 执行" }); return; }
      out(await apiRaw("POST", `/api/brief?wo=${encodeURIComponent(rest[1])}`, Buffer.from(text), "text/plain; charset=utf-8")); return;
    }
    if (sub === "upload") {
      need(rest[1] && opt.file, "用法: wo upload <id> --file <f> [--as <name>] [--step <s>]");
      const fname = (opt.as || opt.file.split(/[\\/]/).pop()).replace(/\\/g, "/");
      const qs = `wo=${encodeURIComponent(rest[1])}&file=${encodeURIComponent(fname)}${opt.step ? `&step=${encodeURIComponent(opt.step)}` : ""}`;
      if (!opt.confirm) { out({ dry_run: true, will_post: `/api/upload?${qs}`, bytes: fs.statSync(opt.file).size, hint: "加 --confirm 执行" }); return; }
      out(await apiRaw("POST", `/api/upload?${qs}`, fs.readFileSync(opt.file), "application/octet-stream")); return;
    }
    if (sub === "gate") {
      need(rest[1], "缺工作单 id");
      if (opt.value === undefined && opt.pick === undefined) { // 只看闸口
        const j = await api("GET", `/api/wo/${rest[1]}`);
        out({ status: j.status, gates: j.gates, gate_comments: j.gate_comments, gate_files: j.gate_files });
        return;
      }
      need(opt.gate, "--value 需同时指定 --gate <名>（如 topic/hook/publish）");
      const value = opt.value || opt.pick;   // 兼容旧写法
      if (!["approved", "rejected"].includes(value)) {
        const e = new Error("闸口值只允许 approved / rejected（候选选择用 wo pick）"); e.exit = 1; throw e;
      }
      const body = { gate: opt.gate, value, id: rest[1] };
      if (opt.comment) body.comment = opt.comment;
      if (!opt.confirm) { out({ dry_run: true, will_post: "/api/gate", body }); return; }
      out(await api("POST", "/api/gate", { body })); return;
    }
    if (sub === "pick") {
      need(rest[1] && opt.step && opt.option !== undefined, "用法: wo pick <id> --step <s> --option <n> [--input <t>]");
      const body = { step: opt.step, wo: rest[1], option: String(opt.option) };
      if (opt.input) body.input = opt.input;
      if (!opt.confirm) { out({ dry_run: true, will_post: "/api/pick", body }); return; }
      out(await api("POST", "/api/pick", { body })); return;
    }
    if (sub === "skip") {
      need(rest[1] && opt.step, "用法: wo skip <id> --step <s>");
      const body = { step: opt.step, wo: rest[1], skipped: true };
      if (opt.reason) body.note = opt.reason;
      if (!opt.confirm) { out({ dry_run: true, will_post: "/api/skip", body }); return; }
      out(await api("POST", "/api/skip", { body })); return;
    }
    if (sub === "start") {
      need(rest[1], "缺工作单 id");
      const body = { wo: rest[1] };
      if (opt.mode) body.mode = opt.mode;
      if (!opt.confirm) { out({ dry_run: true, will_post: "/api/start", body, hint: "派发前确认节点在线（console agents）" }); return; }
      const j = await api("POST", "/api/start", { body });
      out(j); return;   // 服务端同步返回派发结果或 502/504，无需 CLI 二次轮询
    }
    if (sub === "bind") {
      need(rest[1] && opt.agent, "用法: wo bind <id> --agent <a>");
      // bind-agent 按 line 维度；先取工作单所在产线
      const w = await api("GET", `/api/wo/${rest[1]}`);
      const body = { line: w.line || opt.line, agent: opt.agent };
      if (!opt.confirm) { out({ dry_run: true, will_post: "/api/bind-agent", body }); return; }
      out(await api("POST", "/api/bind-agent", { body })); return;
    }
    if (sub === "close") {
      need(rest[1], "缺工作单 id");
      const body = { id: rest[1], reason: opt.reason || "" };
      if (!opt.confirm) { out({ dry_run: true, will_post: "/api/wo-close", body, warning: "关闭后成品档案只读，高危操作" }); return; }
      out(await api("POST", "/api/wo-close", { body })); return;
    }
  }

  // ---------- 只读 ----------
  const READONLY = { lines: "/api/lines", devices: "/api/devices", agents: "/api/agents",
    "agent-logs": "/api/agent-logs", stats: "/api/stats", spec: "/api/spec" };
  if (g === "console" && READONLY[c]) { out(await api("GET", READONLY[c])); return; }

  // ---------- 令牌（高危） ----------
  if (g === "console" && c === "token") {
    const me = await api("GET", "/api/me");
    if (me.kind === "guest" && !me.admin) {
      const e = new Error("令牌管理需要管理员或 GitCode 身份（当前为访客）");
      e.hint = "ainative auth login 或 export AINATIVE_TOKEN=<管理员令牌>"; e.exit = 3;
      throw e;
    }
    if (rest[0] === "list") { out(await api("GET", "/api/tokens")); return; }
    if (rest[0] === "issue") {
      need(opt.name && opt.lines, "用法: token issue --name <n> --lines <l1,l2> [--confirm]");
      const body = { user_name: opt.name, line_ids: opt.lines.split(",") };
      if (!opt.confirm) { out({ dry_run: true, will_post: "/api/token-issue", body }); return; }
      out(await api("POST", "/api/token-issue", { body })); return;
    }
    if (rest[0] === "revoke") {
      need(opt.hash, "用法: token revoke --hash <h> --confirm");
      if (!opt.confirm) { out({ dry_run: true, will_post: "/api/token-revoke", body: { token_hash: opt.hash } }); return; }
      out(await api("POST", "/api/token-revoke", { body: { token_hash: opt.hash } })); return;
    }
  }

  // ---------- 总闸 ----------
  if (g === "console" && (c === "halt" || c === "resume")) {
    if (!opt.confirm) { out({ dry_run: true, will_post: `/api/${c === "halt" ? "h" : "resume"}`, warning: "总刹车影响全部工作单推进" }); return; }
    out(await api("POST", `/api/${c === "halt" ? "h" : "resume"}`, { body: {} })); return;
  }

  // ---------- WS 会话代理 ----------
  if (g === "console" && c === "ws") {
    const sub = rest[0], sid = rest[1];
    if (sub === "chat") {
      need(opt.agent && opt.text, "用法: ws chat --agent <id> --text <t> [--resume <sid>]");
      const o = await wsOpen({ agent: opt.agent, resume: opt.resume, verbose: true });
      if (!o.chat_id) { out({ ...o, hint: o.hint || "会话未就绪" }); return; }
      await wsSend(o.session, opt.text);
      // 等回合结束：ACP turn 结束标志 = 收到含 stopReason 的 jsonrpc result 帧
      const deadline = Date.now() + 120000;
      const frames = [];
      while (Date.now() < deadline) {
        const r = await wsWait(o.session, 15000);
        if (r.error || r.timeout) break;
        frames.push(...r.frames);
        if (frames.some(f => f.result?.stopReason || f.ch === "stop")) break;
      }
      const texts = frames
        .flatMap(f => [f.msg?.update?.sessionUpdate === "agent_message_chunk" ? f.msg.update.content?.text : null,
                       f.ch === "prompt_reply" ? f.text : null].filter(Boolean));
      out({ session: o.session, sid: o.sid, replies: texts.length ? texts : frames.slice(-5), frames_total: frames.length });
      await wsClose(o.session);
      return;
    }
    if (sub === "open") {
      need(opt.agent, "用法: ws open --agent <agent_id> [--resume <sid>]");
      out(await wsOpen({ agent: opt.agent, resume: opt.resume, verbose: opt.verbose }));
      return;
    }
    if (sub === "send") { need(sid && opt.text, "用法: ws send <session> --text <t>"); out(await wsSend(sid, opt.text)); return; }
    if (sub === "read") { need(sid, "用法: ws read <session>"); out(await wsRead(sid)); return; }
    if (sub === "wait") { need(sid, "用法: ws wait <session> [--timeout ms]"); out(await wsWait(sid, parseInt(opt.timeout || "10000"))); return; }
    if (sub === "status") { need(sid, "用法: ws status <session>"); out(wsStatus(sid)); return; }
    if (sub === "close") { need(sid, "用法: ws close <session>"); out(await wsClose(sid)); return; }
  }

  console.error(JSON.stringify({ error: `未知命令: ${pos.join(" ")}`, hint: "ainative help 查看用法" }));
  process.exit(1);
}

main().catch(fail);
