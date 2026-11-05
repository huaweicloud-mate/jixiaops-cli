// core/http.mjs —— HTTP 封装：JSON 输出 / 错误语义化 / 退出码映射（架构文档 §3.1、§3.5）
import { resolveIdentity, defaultEndpoint, mask } from "./auth.mjs";

/** 统一请求。返回解析后的 JSON；失败抛带 exit 码与 hint 的 Error。 */
export async function api(method, p, { body, endpoint, raw = false } = {}) {
  const ep = endpoint || defaultEndpoint();
  const id = await resolveIdentity(ep);
  const r = await fetch(ep + p, {
    method,
    headers: {
      "Authorization": "Bearer " + id.token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { /* 非 JSON 响应（404 桩等） */ }

  if (!r.ok) {
    const e = new Error(j?.error || text.slice(0, 160) || `HTTP ${r.status}`);
    e.http = r.status;
    e.hint = j?.hint || HINTS[r.status] || null;
    e.exit = EXIT[r.status] || 1;
    throw e;
  }
  if (raw) return { data: text, identity: id };
  return { ...j, _identity: { kind: id.kind, source: id.source, token_masked: mask(id.token) } };
}

const EXIT = { 401: 2, 403: 3, 409: 4, 429: 5 };
const HINTS = {
  401: "令牌失效——重新登录（ainative auth login）或检查 AINATIVE_TOKEN",
  403: "权限不足——访客只读或高危操作；whoami 查看当前身份",
  409: "资源冲突——见 error/hint 详情（如产线占用会附空闲产线列表）",
  429: "请求过频——访客登录有频控，会话缓存应已复用，稍后再试",
};
