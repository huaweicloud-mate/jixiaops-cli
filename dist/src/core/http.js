// core/http.ts —— HTTP 封装：JSON 输出 / 错误语义化 / 退出码映射 / 裸 body（upload/brief）
import { resolveIdentity, defaultEndpoint, mask, logout } from "./auth.js";
import { apiErr } from "./types.js";
const EXIT = { 401: 2, 403: 3, 409: 4, 429: 5 };
const HINTS = {
    401: "令牌失效——重新登录（jixiaops auth login）或检查 JIXIAOPS_TOKEN",
    403: "权限不足——访客只读或高危操作。升级凭据：管理员签发平台令牌（jixiaops console token issue），用户配置 export JIXIAOPS_TOKEN=<令牌> 或写入 ~/.jixiaops/config.json {\"token\":\"<令牌>\"}；whoami 查看当前身份",
    409: "资源冲突——见 error/hint 详情（如产线占用会附空闲产线列表）",
    429: "请求过频——访客登录有频控，会话缓存应已复用，稍后再试",
};
async function _req(method, p, { body, rawBody, contentType, _retried = false } = {}) {
    const ep = defaultEndpoint();
    const id = await resolveIdentity(ep);
    const headers = { "Authorization": "Bearer " + id.token };
    if (body)
        headers["Content-Type"] = "application/json";
    if (contentType)
        headers["Content-Type"] = contentType;
    const r = await fetch(ep + p, { method, headers, body: rawBody ?? (body ? JSON.stringify(body) : undefined) });
    const text = await r.text();
    let j = null;
    try {
        j = JSON.parse(text);
    }
    catch { /* 非 JSON（404 桩等） */ }
    if (r.status === 401 && !_retried && id.source.startsWith("cache:")) {
        // 缓存会话失效（服务端重启/内存会话清空）——清缓存重解析一次（访客会自动重登）
        logout();
        return _req(method, p, { body, rawBody, contentType, _retried: true });
    }
    if (!r.ok) {
        const obj = j && !Array.isArray(j) ? j : null;
        const msg = typeof obj?.error === "string" ? obj.error : undefined;
        const hint = typeof obj?.hint === "string" ? obj.hint : undefined;
        throw apiErr(msg || text.slice(0, 160) || `HTTP ${r.status}`, {
            http: r.status,
            hint: hint || HINTS[r.status] || null,
            exit: EXIT[r.status] || 1,
        });
    }
    return { j: j ?? { ok: true }, identity: id };
}
/** JSON API 调用。返回解析后的 JSON（附 _identity 供 whoami 类命令展示；数组响应不展开）。 */
export async function api(method, p, { body } = {}) {
    const { j, identity } = await _req(method, p, { body });
    const view = { kind: identity.kind, source: identity.source, token_masked: mask(identity.token) };
    if (Array.isArray(j))
        return { data: j, _identity: view };
    return { ...j, _identity: view };
}
/** 裸 body 调用（/api/upload 二进制、/api/brief markdown）。 */
export async function apiRaw(method, p, buf, contentType) {
    const { j } = await _req(method, p, { rawBody: buf, contentType });
    return j;
}
/** 裸 GET 下载（artifact 签名直链回源等）。返回 Buffer，不解析 JSON。 */
export async function apiBuf(p) {
    const ep = defaultEndpoint();
    const id = await resolveIdentity(ep);
    const r = await fetch(ep + p, { headers: { "Authorization": "Bearer " + id.token } });
    if (!r.ok) {
        throw apiErr(`下载失败 HTTP ${r.status}`, { http: r.status, exit: EXIT[r.status] || 1 });
    }
    return Buffer.from(await r.arrayBuffer());
}
