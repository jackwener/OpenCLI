/**
 * opencli browser protocol — shared types between daemon, extension, and CLI.
 *
 * 5 actions: exec, navigate, tabs, cookies, screenshot.
 * Everything else is just JS code sent via 'exec'.
 */

export type Action =
  | 'exec'
  | 'navigate'
  | 'tabs'
  | 'cookies'
  | 'screenshot'
  | 'close-window'
  | 'sessions'
  | 'set-file-input'
  | 'insert-text'
  | 'bind'
  | 'network-capture-start'
  | 'network-capture-read'
  | 'wait-download'
  | 'cdp'
  | 'frames';

export interface Command {
  /** Unique request ID */
  id: string;
  /** Action type */
  action: Action;
  /** Target page identity (targetId). Cross-layer contract with the daemon. */
  page?: string;
  /** JS code to evaluate in page context (exec action) */
  code?: string;
  /** Browser session name for tab/page continuity. */
  session?: string;
  /** Runtime surface selecting owned container policy. */
  surface?: 'browser' | 'adapter';
  /** Adapter site session lifecycle. Persistent site sessions do not idle-expire. */
  siteSession?: 'ephemeral' | 'persistent';
  /** URL to navigate to (navigate action) */
  url?: string;
  /** Sub-operation for tabs: list, new, close, select */
  op?: 'list' | 'new' | 'close' | 'select';
  /** Tab index for tabs select/close */
  index?: number;
  /** Cookie domain filter */
  domain?: string;
  /** Screenshot format: png (default) or jpeg */
  format?: 'png' | 'jpeg';
  /** JPEG quality (0-100), only for jpeg format */
  quality?: number;
  /** Whether to capture full page (not just viewport) */
  fullPage?: boolean;
  /** Override viewport width in CSS pixels for screenshot (0 / undefined = use current) */
  width?: number;
  /** Override viewport height in CSS pixels for screenshot (0 / undefined = use current; ignored when fullPage) */
  height?: number;
  /** Local file paths for set-file-input action */
  files?: string[];
  /** CSS selector for file input element (set-file-input action) */
  selector?: string;
  /** Raw text payload for insert-text action */
  text?: string;
  /** URL substring filter pattern for network capture actions */
  pattern?: string;
  /** Download wait timeout in milliseconds */
  timeoutMs?: number;
  /** CDP method name for 'cdp' action (e.g. 'Accessibility.getFullAXTree') */
  cdpMethod?: string;
  /** CDP method params for 'cdp' action */
  cdpParams?: Record<string, unknown>;
  /** Window foreground/background policy for owned Browser Bridge containers. */
  windowMode?: 'foreground' | 'background';
  /** Custom idle timeout in seconds for this session. Overrides the default. */
  idleTimeout?: number;
  /** Frame index for cross-frame operations (0-based, from 'frames' action) */
  frameIndex?: number;
  /** Browser profile/context REQUIRED by the CLI (--profile / env). Used by the daemon for strict routing. */
  contextId?: string;
  /**
   * Browser profile/context PREFERRED by the CLI (persisted config default).
   * Daemon-only routing hint: used when connected, otherwise the daemon falls
   * back to the only connected profile. The extension ignores this field.
   */
  preferredContextId?: string;
  /**
   * Daemon-side command timeout in seconds, set by the CLI transport. The
   * extension derives its CDP deadline from this so it fails just before the
   * daemon timer and its (more specific) error wins.
   * Kept alongside `deadlineAt` for older daemons; new code prefers deadlineAt.
   */
  timeout?: number;
  /**
   * Absolute command deadline (epoch ms), set by the CLI transport. All hops
   * run on the same machine, so every layer derives its remaining budget as
   * `deadlineAt - Date.now()` — queueing and service-worker wake latency are
   * absorbed instead of silently shrinking the innermost budget.
   */
  deadlineAt?: number;
}

export interface Result {
  /** Matching request ID */
  id: string;
  /** Whether the command succeeded */
  ok: boolean;
  /** Result data on success */
  data?: unknown;
  /** Error message on failure */
  error?: string;
  /** Stable machine-readable error code on failure */
  errorCode?: string;
  /** Optional recovery hint for agent-facing CLI output */
  errorHint?: string;
  /** Page identity (targetId) — present only on page-scoped command responses */
  page?: string;
}

/** Native Messaging host Chrome spawns; CLI never listen()s. */
export const NATIVE_HOST_NAME = 'com.opencli.host';

/** Chrome kills a native host that writes a frame larger than 1 MiB. */
export const NATIVE_MAX_FRAME_BYTES = 1024 * 1024;
/** JSON-text slice size for native chunks. Well under 1MiB after envelope wrap. */
export const NATIVE_CHUNK_TEXT_BYTES = 512 * 1024;
export const CHUNK_TYPE = '__chunk__';
export const PAYLOAD_TOO_LARGE_CODE = 'payload_too_large';

export type ChunkEnvelope = {
  type: typeof CHUNK_TYPE;
  id: string;
  i: number;
  n: number;
  data: string;
};

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

function utf8Len(s: string): number {
  return utf8.encode(s).length;
}

function splitUtf8ByBytes(s: string, maxBytes: number): string[] {
  const bytes = utf8.encode(s);
  if (bytes.length <= maxBytes) return [s];
  const parts: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    let end = Math.min(offset + maxBytes, bytes.length);
    while (end > offset && (bytes[end] & 0xc0) === 0x80) end--;
    if (end === offset) {
      throw Object.assign(new Error(`Native payload exceeds Chrome's 1MiB message cap (${bytes.length} bytes).`), {
        code: PAYLOAD_TOO_LARGE_CODE,
      });
    }
    parts.push(utf8Decoder.decode(bytes.subarray(offset, end)));
    offset = end;
  }
  return parts;
}

export function isChunkEnvelope(value: unknown): value is ChunkEnvelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as ChunkEnvelope;
  return v.type === CHUNK_TYPE
    && typeof v.id === 'string'
    && Number.isInteger(v.i)
    && Number.isInteger(v.n)
    && typeof v.data === 'string';
}

export function splitNativePayloads(value: unknown): unknown[] {
  const json = JSON.stringify(value);
  const direct = utf8Len(json);
  if (direct <= NATIVE_MAX_FRAME_BYTES - 64) return [value];
  const slices = splitUtf8ByBytes(json, NATIVE_CHUNK_TEXT_BYTES);
  const id = `chk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return slices.map((data, i) => {
    const envelope: ChunkEnvelope = { type: CHUNK_TYPE, id, i, n: slices.length, data };
    if (utf8Len(JSON.stringify(envelope)) > NATIVE_MAX_FRAME_BYTES) {
      throw Object.assign(new Error(`Native payload exceeds Chrome's 1MiB message cap (${direct} bytes).`), {
        code: PAYLOAD_TOO_LARGE_CODE,
      });
    }
    return envelope;
  });
}

export class ChunkAssembler {
  private chunks = new Map<string, { n: number; parts: Array<string | null> }>();

  push(parsed: unknown): unknown | undefined {
    if (!isChunkEnvelope(parsed)) return parsed;
    if (parsed.n <= 0 || parsed.n > 64) return undefined;
    let entry = this.chunks.get(parsed.id);
    if (!entry) {
      if (this.chunks.size >= 8) {
        const oldest = this.chunks.keys().next().value;
        if (oldest !== undefined) this.chunks.delete(oldest);
      }
      entry = { n: parsed.n, parts: Array.from({ length: parsed.n }, () => null) };
      this.chunks.set(parsed.id, entry);
    }
    if (parsed.i < 0 || parsed.i >= entry.n) return undefined;
    entry.parts[parsed.i] = parsed.data;
    if (entry.parts.some((p) => p === null)) return undefined;
    this.chunks.delete(parsed.id);
    return JSON.parse(entry.parts.join(''));
  }

  reset(): void {
    this.chunks.clear();
  }
}
