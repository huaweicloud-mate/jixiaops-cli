#!/usr/bin/env node
// bin/ainative.mjs —— CLI 入口 v0.1.0（垂直切片）
// 已实现：auth whoami/logout · wo get/new · lines/devices/agents/agent-logs · stats/overview/spec
// 未实现（见 docs/ainative-cli.md §9）：wo brief/upload/gate/pick/skip/start/resume/close、ws_*、gw 组
import { api } from "../src/core/http.mjs";
import { defaultEndpoint, logout, mask } from "../src/core/auth.mjs";
import process from "node:process";

const args = process.argv.slice(2);
const opt = {}; const pos = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    if (k === "confirm" || k === "pretty" || k === "verbose") opt[k] = true;
    else opt[k] = args[++i];
  } else pos.push(a);
}
if (opt.endpoint) process.env.AINATIVE_ENDPOINT = opt.endpoint;

const HELP = `ainative v0.1.0 —— OperationAINative 平台 CLI

用法: ainative <group> <command> [args] [options]

命令组:
  console auth whoami              当前身份与权限
  console auth logout              吊销当前会话/清除缓存
  console wo get <id> [--section gate|artifacts]
  console wo new --topic <t> [--line <l>] [--platforms <p>] [--confirm]
  console lines|devices|agents|agent-logs|stats|overview|spec
全局选项:
  --endpoint <url>  覆盖端点（默认 https://mcptest.api.hwcdeveloper.com）
  --pretty          JSON 美化   --verbose 调试（token 脱敏）
写操作默认 dry-run，--confirm 才真正执行（架构文档 D4）`;

function out(j) { console.log(opt.pretty ? JSON.stringify(j, null, 2) : JSON.stringify(j)); }
function fail(e) {
  console.error(JSON.stringify({ error: e.message, hint: e.hint || undefined, http: e.http || undefined }));
  process.exit(e.exit || 1);
}

async function main() {
  const [g, c, ...rest] = pos;
  if (!g || g === "help" || g === "--help") { console.log(HELP); return; }

  if (g === "console" && c === "auth" && rest[0] === "whoami") {
    const j = await api("GET", "/api/me");
    out({ ...j, endpoint: defaultEndpoint() }); return;
  }
  if (g === "console" && c === "auth" && rest[0] === "logout") {
    logout(); out({ ok: true, cleared: "local session cache" }); return;
  }
  if (g === "console" && c === "wo" && rest[0] === "get") {
    const id = rest[1];
    if (!id) { console.error(JSON.stringify({ error: "缺工作单 id" })); process.exit(1); }
    const j = await api("GET", `/api/wo/${id}`);
    if (opt.section) out({ [opt.section]: j[opt.section] ?? null });
    else out(j);
    return;
  }
  if (g === "console" && c === "wo" && rest[0] === "new") {
    if (!opt.topic) { console.error(JSON.stringify({ error: "缺 --topic" })); process.exit(1); }
    const body = { topic: opt.topic, platforms: opt.platforms || "bilibili" };
    if (opt.line) body.line = opt.line;
    if (!opt.confirm) {
      out({ dry_run: true, will_post: "/api/new", body, hint: "加 --confirm 真正执行（产线独占校验在服务端）" });
      return;
    }
    const j = await api("POST", "/api/new", { body });
    out(j); return;
  }
  const READONLY = { lines: "/api/lines", devices: "/api/devices", agents: "/api/agents",
    "agent-logs": "/api/agent-logs", stats: "/api/stats", overview: "/api/overview", spec: "/api/spec" };
  if (g === "console" && READONLY[c]) { out(await api("GET", READONLY[c])); return; }

  console.error(JSON.stringify({ error: `未知命令: ${pos.join(" ")}`, hint: "ainative help 查看用法" }));
  process.exit(1);
}

main().catch(fail);
