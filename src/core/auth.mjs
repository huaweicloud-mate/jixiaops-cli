// core/auth.mjs —— 凭据解析链（架构文档 D3）
// ① env AINATIVE_TOKEN → ② ~/.ainative/config.json → ③ 访客自动登录（缓存复用，防频控）
// v0.1.0：OAuth 登录已砍（v1 范围外）；凭据库接入为后续演进项。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DIR = path.join(os.homedir(), ".ainative");
const CONFIG = path.join(DIR, "config.json");
const SESSION = path.join(DIR, "session.json");
const GUEST_TTL_MS = 24 * 3600 * 1000 - 10 * 60 * 1000; // 24h 减 10 分钟安全边距

export function defaultEndpoint() {
  return process.env.AINATIVE_ENDPOINT || readJson(CONFIG)?.endpoint
    || "https://mcptest.api.hwcdeveloper.com";
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function writePrivate(p, obj) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  try { fs.chmodSync(p, 0o600); } catch { /* Windows 尽力而为 */ }
}

/** 解析出 {token, kind, source}；失败抛 Error（含 hint） */
export async function resolveIdentity(endpoint) {
  // ① 环境变量（管理员/指定身份）
  if (process.env.AINATIVE_TOKEN) {
    return { token: process.env.AINATIVE_TOKEN, kind: "env", source: "env:AINATIVE_TOKEN" };
  }
  // ② 配置文件
  const cfg = readJson(CONFIG);
  if (cfg?.token) {
    return { token: cfg.token, kind: "config", source: "~/.ainative/config.json" };
  }
  // ③ 访客会话缓存（有效期内复用——平台访客登录有频控，严禁每命令重登）
  const cached = readJson(SESSION);
  if (cached?.token && cached?.endpoint === endpoint && Date.now() < (cached.expires_at || 0)) {
    return { token: cached.token, kind: "guest", source: "cache:session.json" };
  }
  // ④ 访客自动登录（零配置默认）
  const r = await fetch(endpoint + "/api/auth/guest");
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    const e = new Error(`访客自动登录失败（HTTP ${r.status}）${t.slice(0, 120)}`);
    e.hint = r.status === 429 ? "访客登录过频，稍后再试" : "检查 endpoint 可达性";
    e.exit = 5; throw e;
  }
  const j = await r.json();
  writePrivate(SESSION, {
    token: j.token, kind: j.kind, mode: j.mode, endpoint,
    created_at: Date.now(), expires_at: Date.now() + GUEST_TTL_MS,
  });
  return { token: j.token, kind: "guest", source: "guest:auto" };
}

export function logout() {
  for (const f of [SESSION]) try { fs.unlinkSync(f); } catch {}
  return true;
}

export function mask(t) { return t ? t.slice(0, 8) + "…" : "(none)"; }
