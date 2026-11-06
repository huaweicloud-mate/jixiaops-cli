// core/types.ts —— 共享类型（v0.4.0 TS 迁移）
// 原则：边界处（JSON 线协议/文件缓存）一次性放宽，使用点收窄；运行时零依赖。
/** 构造 ApiError（erasable-syntax-only：不用类参数属性） */
export function apiErr(message, fields = {}) {
    const e = new Error(message);
    if (fields.http !== undefined)
        e.http = fields.http;
    if (fields.hint)
        e.hint = fields.hint;
    if (fields.exit !== undefined)
        e.exit = fields.exit;
    return e;
}
