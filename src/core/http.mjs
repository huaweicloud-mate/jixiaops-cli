// core/http.mjs —— HTTP 封装：JSON 输出 / 错误语义化 / 退出码映射 / 裸 body（upload/brief）
import { resolveIdentity, defaultEndpoint, mask } from "./auth.mjs";

async function _req(method, p, { body, rawBody, contentType } = {}) {
  const ep = defaultEndpoint();
  const id = await resolveIdentity(ep);
  const headers = { "Authorization": "Bearer " + id.token };
  if (body) headers["Content-Type"] = "application/json";
  if (contentType) headers["Content-Type"] = contentType;
  const r = await fetch(ep + p, { method, headers, body: rawBody ?? (body ? JSON.stringify(body) : undefined) });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { /* 非 JSON（404 桩等） */ }
  if (!r.ok) {
    const e = new Error(j?.error || text.slice(0, 160) || `HTTP ${r.status}`);
    e.http = r.status;
    e.hint = j?.hint || HINTS[r.status] || null;
    e.exit = EXIT[r.status] || 1;
    throw e;
  }
  return { j: j ?? { ok: true }, identity: id };
}

/** JSON API 调用。返回解析后的 JSON（附 _identity 供 whoami 类命令展示；数组响应不展开）。 */
export async function api(method, p, { body } = {}) {
  const { j, identity } = await _req(method, p, { body });
  if (Array.isArray(j)) return { data: j, _identity: { kind: identity.kind, source: identity.source, token_masked: mask(identity.token) } };
  return { ...j, _identity: { kind: identity.kind, source: identity.source, token_masked: mask(identity.token) } };
}

/** 裸 body 调用（/api/upload 二进制、/api/brief markdown）。 */
export async function apiRaw(method, p, buf, contentType) {
  const { j } = await _req(method, p, { rawBody: buf, contentType });
  return j;
}

const EXIT = { 401: 2, 403: 3, 409: 4, 429: 5 };
const HINTS = {
  401: "令牌失效——重新登录（ainative auth login）或检查 AINATIVE_TOKEN",
  403: "权限不足——访客只读或高危操作；whoami 查看当前身份",
  409: "资源冲突——见 error/hint 详情（如产线占用会附空闲产线列表）",
  429: "请求过频——访客登录有频控，会话缓存应已复用，稍后再试",
};
