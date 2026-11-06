// core/types.ts —— 共享类型（v0.4.0 TS 迁移）
// 原则：边界处（JSON 线协议/文件缓存）一次性放宽，使用点收窄；运行时零依赖。

/** 平台 JSON 值（API 响应/信封帧的叶子类型） */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** 身份解析结果（auth.ts D3 链路产物） */
export interface Identity {
  token: string;
  kind: string;
  source: string;
}

/** 带语义字段的错误：CLI 退出码映射 / MCP isError / hint 透传 */
export interface ApiError extends Error {
  http?: number;
  hint?: string;
  exit?: number;
}

/** 构造 ApiError（erasable-syntax-only：不用类参数属性） */
export function apiErr(
  message: string,
  fields: { http?: number; hint?: string | null; exit?: number } = {},
): ApiError {
  const e = new Error(message) as ApiError;
  if (fields.http !== undefined) e.http = fields.http;
  if (fields.hint) e.hint = fields.hint;
  if (fields.exit !== undefined) e.exit = fields.exit;
  return e;
}

/**
 * serve chat 信封帧（P0 实测协议）+ ACP JSON-RPC 透传。
 * 线协议无 schema——已知字段显式声明，其余走索引签名，使用点再收窄。
 */
export interface ChatFrame {
  ch?: string;
  chat_id?: string;
  sid?: string;
  resumed?: boolean;
  err?: string;
  raw?: string;
  text?: string;
  result?: { stopReason?: string } & Record<string, unknown>;
  msg?: { update?: { sessionUpdate?: string; content?: { text?: string } } } & Record<string, unknown>;
  [k: string]: unknown;
}
