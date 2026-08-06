/**
 * 浏览器操作 trace —— env-gated 结构化事件落盘（JSONL）。
 *
 * 目标：把 daemon 收到的每条浏览器命令的生命周期（dispatch / result / timeout）、扩展
 * 连接/断开、以及扩展转发来的日志，以「一行一个 JSON 事件」append 到
 * `OPENCLI_BROWSER_TRACE_FILE` 指向的文件，供下游分析「哪些开浏览器操作无效 / 浪费 / 待改进」
 * （慢命令、重复导航、stale 重试、daemon 冷启重连开销、开窗 vs 复用窗口等）。
 *
 * 设计：
 *  - env 未置位 → 所有导出函数 no-op，零开销零侵入（对正常用户完全透明）。
 *  - 用 `fs.appendFileSync`（每条同步写），不用 createWriteStream：daemon 常被调用方
 *    `pkill` 冷启，同步写保证被杀时已写的事件不丢；每 run 几百条 × ~150B 的同步 IO 完全
 *    淹没在秒级浏览器命令的噪声里。
 *  - `write()` 全程 try/catch + 只警告一次：trace 自身故障绝不影响命令执行。
 *  - 隐私铁律：只取 action / session / surface / origin+pathname；绝不写 exec 的 JS 源、
 *    insert-text 文本、cookies、cdpParams 等可能含敏感数据的字段。
 */
import { appendFileSync } from 'node:fs';
import { log } from '../logger.js';

const TRACE_FILE = process.env.OPENCLI_BROWSER_TRACE_FILE?.trim();
const enabled = !!TRACE_FILE;
let warned = false;

function write(obj: Record<string, unknown>): void {
  if (!enabled) return;
  try {
    appendFileSync(TRACE_FILE!, JSON.stringify({ t: Date.now(), ...obj }) + '\n');
  } catch (err) {
    if (!warned) {
      warned = true;
      log.warn(`[trace] failed to write browser trace to ${TRACE_FILE}: ${err instanceof Error ? err.message : String(err)} (further trace errors suppressed)`);
    }
  }
}

/** 仅对 navigate 取 url，并裁成 origin+pathname（去掉 query/fragment，避免泄露搜索词/token）。 */
function safeUrl(action: unknown, url: unknown): string | undefined {
  if (action !== 'navigate' || typeof url !== 'string' || !url) return undefined;
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return undefined;
  }
}

interface CommandBody {
  id?: unknown;
  action?: unknown;
  contextId?: unknown;
  session?: unknown;
  surface?: unknown;
  url?: unknown;
}

/** 命令已下发给扩展。 */
export function traceDispatch(body: CommandBody): void {
  if (!enabled) return;
  write({
    ev: 'dispatch',
    id: typeof body.id === 'string' ? body.id : undefined,
    action: typeof body.action === 'string' ? body.action : 'unknown',
    ctx: typeof body.contextId === 'string' ? body.contextId : undefined,
    session: typeof body.session === 'string' ? body.session : undefined,
    surface: typeof body.surface === 'string' ? body.surface : undefined,
    url: safeUrl(body.action, body.url),
  });
}

/** 命令拿到结果（成功 / 业务失败 / 断连致 result-unknown）。ms = dispatch→result 的延迟。 */
export function traceResult(id: string, ok: boolean, ms: number, errorCode?: string, page?: string): void {
  if (!enabled) return;
  write({ ev: 'result', id, ok, ms, errorCode, page });
}

/** 命令超时（daemon 侧 timeoutMs 到点仍无结果）。 */
export function traceTimeout(id: string, ms: number, action?: string): void {
  if (!enabled) return;
  write({ ev: 'timeout', id, ms, action });
}

/** 扩展（某 profile/contextId）连上 daemon。冷启后的首个 connect 即重连开销的右端点。 */
export function traceExtConnect(ctx: string, extVersion?: string | null): void {
  if (!enabled) return;
  write({ ev: 'ext-connect', ctx, extVersion: extVersion ?? undefined });
}

/** 扩展断开。与下一个 ext-connect 配对即一次重连开销。 */
export function traceExtDisconnect(ctx: string): void {
  if (!enabled) return;
  write({ ev: 'ext-disconnect', ctx });
}

/** 扩展转发来的 console 日志（Phase 2 的开窗 / 复用 / 销毁细节走这条）。 */
export function traceExtLog(level: string, msg: string): void {
  if (!enabled) return;
  write({ ev: 'ext-log', level, msg });
}
