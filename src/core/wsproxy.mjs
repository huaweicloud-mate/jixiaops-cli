// core/wsproxy.mjs —— WS 会话代理（架构文档 D5 / §5.2.1）
// MCP Server / CLI 常驻进程内维护真实 WS 长连接；agent 通过会话句柄全双工收发。
// 关键机制：per-session 环形缓冲（不丢帧）+ 心跳看门狗 + 指数退避重连 + resume_sid 续接。
import { defaultEndpoint } from "./auth.mjs";

const SESSIONS = new Map();     // id -> session
const BUF_MAX = 500;
let SEQ = 0;

function epWs(endpoint) {
  const u = new URL(endpoint || defaultEndpoint());
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${u.host}`;
}

function newSession(agent, resume) {
  return {
    id: "ws" + (++SEQ) + "-" + Math.random().toString(36).slice(2, 6),
    agent, resume: resume || null,
    sid: resume || null, chatId: null, state: "connecting",
    buffer: [],                       // [{ts, frame}] 环形缓冲
    reconnects: 0, closed: false, lastError: null,
    waiters: [],                      // ws_wait 的 waiter 队列
  };
}

function push(s, frame) {
  s.buffer.push({ ts: Date.now(), frame });
  if (s.buffer.length > BUF_MAX) s.buffer.shift();
  // 唤醒 waiter（ws_wait）
  for (const w of s.waiters.splice(0)) {
    clearTimeout(w.timer);
    w.resolve({ frames: drain(s), state: s.state, sid: s.sid });
  }
}
function drain(s) { return s.buffer.splice(0).map(x => x.frame); }

async function connect(s, verbose, retried = false) {
  const base = epWs(process.env.AINATIVE_ENDPOINT);
  const { resolveIdentity, logout } = await import("./auth.mjs");
  const id = await resolveIdentity(process.env.AINATIVE_ENDPOINT);
  const url = `${base}/ws/chat/${encodeURIComponent(s.agent)}?token=${encodeURIComponent(id.token)}` +
    (s.sid ? `&resume_sid=${encodeURIComponent(s.sid)}` : "");
  const ws = new WebSocket(url);
  s.ws = ws; s.state = "connecting";
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("WS 握手超时")), 15000);
      ws.onopen = () => { clearTimeout(t); resolve(); };
      ws.onerror = (e) => { clearTimeout(t); reject(new Error("WS 错误")); };
    });
  } catch (e) {
    // 缓存会话失效（服务端重启/内存会话清空）——同 http.mjs 的 401 自愈：清缓存重登一次
    if (!retried && id.source.startsWith("cache:")) {
      logout();
      return connect(s, verbose, true);
    }
    throw e;
  }
  s.state = "connected";
  // 信封协议（P0 实测）：ready → 捕获 sid/chat_id
  ws.onmessage = (ev) => {
    let f; try { f = JSON.parse(ev.data); } catch { f = { raw: String(ev.data).slice(0, 500) }; }
    if (f.ch === "ready") { s.chatId = f.chat_id; s.sid = f.sid || s.sid; if (verbose) console.error(`[ws] ready chat_id=${f.chat_id} sid=${s.sid} resumed=${f.resumed}`); }
    if (f.ch === "error") { s.lastError = f.err; }
    push(s, f);
  };
  ws.onclose = () => { if (!s.closed) reconnectLoop(s, verbose); };
  // 心跳：serve 侧用 WS 协议层 ping（gorilla pingLoop），Node 端自动 pong——无需应用层心跳。
  // （曾发 {ch:"ping"} 应用层信封，serve 不识别，看门狗误杀连接——已移除，见 gw 日志"未知信封"。）
}

async function reconnectLoop(s, verbose, max = 6) {
  s.state = "reconnecting";
  while (!s.closed && s.reconnects < max) {
    const delay = Math.min(30000, 1000 * 2 ** s.reconnects);
    s.reconnects++;
    await new Promise(r => setTimeout(r, delay));
    if (s.closed) return;
    try {
      await connect(s, verbose);
      s.state = "connected";
      return;                       // resume_sid 已随连接带上，session/load 回放历史
    } catch (e) { s.lastError = e.message; }
  }
  s.state = "dead";
}

/** 建立 WS 会话（真实长连接）。返回会话句柄；ready 前阻塞（含握手+session/new）。 */
export async function wsOpen({ agent, resume, verbose }) {
  const s = newSession(agent, resume);
  SESSIONS.set(s.id, s);
  try {
    await connect(s, verbose);
  } catch (e) {
    s.lastError = e.message;
    reconnectLoop(s, verbose, 2);   // 首连失败快速失败（2 次 ~3s），不掉进长退避
  }
  // 等 ready（chat_id/sid 就绪），最多 95s（acp_open/initialize/session/new 链路 90s 上限）
  const deadline = Date.now() + 95000;
  while (!s.chatId && Date.now() < deadline && s.state !== "dead") {
    await new Promise(r => setTimeout(r, 200));
  }
  return {
    session: s.id, state: s.state, chat_id: s.chatId, sid: s.sid,
    agent: s.agent, buffer: s.buffer.length, reconnects: s.reconnects,
    hint: s.chatId ? undefined : (s.lastError || "ready 超时——节点离线？console agents 查看"),
  };
}

/** 下行发送（{ch:"prompt"} 信封）。 */
export async function wsSend(sid, text) {
  const s = SESSIONS.get(sid);
  if (!s) return { error: "会话不存在", hint: "ws open 先建立会话" };
  if (s.ws?.readyState !== 1) return { error: "连接未就绪", state: s.state, last_error: s.lastError };
  s.ws.send(JSON.stringify({ ch: "prompt", text }));
  return { ok: true, session: sid, sent_bytes: Buffer.byteLength(text), hint: "ws wait/read 收取回复" };
}

/** 排空收件缓冲。 */
export function wsRead(sid) {
  const s = SESSIONS.get(sid);
  if (!s) return { error: "会话不存在" };
  return { session: sid, state: s.state, sid: s.sid, frames: drain(s), buffer_left: s.buffer.length };
}

/** 长等下一帧（发一句等回复的主用形态）。 */
export function wsWait(sid, timeoutMs = 10000) {
  const s = SESSIONS.get(sid);
  if (!s) return Promise.resolve({ error: "会话不存在" });
  if (s.buffer.length) return Promise.resolve({ frames: drain(s), state: s.state, sid: s.sid });
  return new Promise(resolve => {
    const w = {
      timer: setTimeout(() => {
        s.waiters = s.waiters.filter(x => x !== w);
        resolve({ timeout: true, timeout_ms: timeoutMs, state: s.state, sid: s.sid,
          hint: s.state !== "connected" ? `连接状态 ${s.state}（${s.lastError || "无错误"}）` : undefined });
      }, timeoutMs),
      resolve,
    };
    s.waiters.push(w);
  });
}

export function wsStatus(sid) {
  const s = SESSIONS.get(sid);
  if (!s) return { error: "会话不存在", sessions: [...SESSIONS.keys()] };
  return { session: sid, state: s.state, agent: s.agent, chat_id: s.chatId, sid: s.sid,
    buffer: s.buffer.length, reconnects: s.reconnects, last_error: s.lastError,
    sessions_total: SESSIONS.size };
}

export function wsClose(sid) {
  const s = SESSIONS.get(sid);
  if (!s) return { error: "会话不存在" };
  s.closed = true; s.state = "closed";
  try { s.ws?.close(); } catch {}
  drain(s);                        // 丢弃未读帧（显式关闭语义）
  SESSIONS.delete(sid);
  return { ok: true, session: sid };
}

export function wsList() { return [...SESSIONS.values()].map(s => ({ id: s.id, state: s.state, agent: s.agent, sid: s.sid })); }
