// core/auth.ts —— 凭据解析链（架构文档 D3）
// ① env AINATIVE_TOKEN → ② ~/.ainative/config.json → ③ 访客自动登录（缓存复用，防频控）
// v0.1.0：OAuth 登录已砍（v1 范围外）；凭据库接入为后续演进项。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { apiErr, type Identity } from "./types.ts";

const DIR = path.join(os.homedir(), ".ainative");
const CONFIG = path.join(DIR, "config.json");
const SESSION = path.join(DIR, "session.json");
const GUEST_TTL_MS = 24 * 3600 * 1000 - 10 * 60 * 1000; // 24h 减 10 分钟安全边距

interface ConfigFile { endpoint?: string; token?: string; [k: string]: unknown }
interface SessionFile { token?: string; endpoint?: string; expires_at?: number; [k: string]: unknown }
interface GuestLoginReply { token?: string; kind?: string; mode?: string; [k: string]: unknown }

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as T; } catch { return null; }
}

function writePrivate(p: string, obj: object): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  try { fs.chmodSync(p, 0o600); } catch { /* Windows 尽力而为 */ }
}

export function defaultEndpoint(): string {
  return process.env.AINATIVE_ENDPOINT || readJson<ConfigFile>(CONFIG)?.endpoint
    || "https://mcptest.api.hwcdeveloper.com";
}

/** 解析出 {token, kind, source}；失败抛 Error（含 hint） */
export async function resolveIdentity(endpoint: string): Promise<Identity> {
  // ① 环境变量（管理员/指定身份）
  if (process.env.AINATIVE_TOKEN) {
    return { token: process.env.AINATIVE_TOKEN, kind: "env", source: "env:AINATIVE_TOKEN" };
  }
  // ② 配置文件
  const cfg = readJson<ConfigFile>(CONFIG);
  if (cfg?.token) {
    return { token: cfg.token, kind: "config", source: "~/.ainative/config.json" };
  }
  // ③ 访客会话缓存（有效期内复用——平台访客登录有频控，严禁每命令重登）
  const cached = readJson<SessionFile>(SESSION);
  if (cached?.token && cached?.endpoint === endpoint && Date.now() < (cached.expires_at || 0)) {
    return { token: cached.token, kind: "guest", source: "cache:session.json" };
  }
  // ④ 访客自动登录（零配置默认）
  const r = await fetch(endpoint + "/api/auth/guest");
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw apiErr(`访客自动登录失败（HTTP ${r.status}）${t.slice(0, 120)}`, {
      hint: r.status === 429 ? "访客登录过频，稍后再试" : "检查 endpoint 可达性",
      exit: 5,
    });
  }
  const j = (await r.json()) as GuestLoginReply;
  if (!j.token) throw apiErr("访客登录响应缺 token", { exit: 5, hint: "检查平台版本兼容性" });
  writePrivate(SESSION, {
    token: j.token, kind: j.kind, mode: j.mode, endpoint,
    created_at: Date.now(), expires_at: Date.now() + GUEST_TTL_MS,
  });
  return { token: j.token, kind: "guest", source: "guest:auto" };
}

export function logout(): boolean {
  for (const f of [SESSION]) try { fs.unlinkSync(f); } catch { /* 文件不存在即已登出 */ }
  return true;
}

export function mask(t?: string | null): string {
  return t ? t.slice(0, 8) + "…" : "(none)";
}
