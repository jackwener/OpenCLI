/**
 * OpenCLI native host protocol.
 *
 * Chrome spawns the host via Native Messaging (4-byte LE length + JSON).
 * CLI clients use the same framing on a per-profile unix socket (or Windows
 * named pipe). There is no TCP, no HTTP, no WebSocket.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Buffer } from 'node:buffer';

/** Native Messaging host name registered with Chrome. */
export const NATIVE_HOST_NAME = 'com.opencli.host';

/** Chrome Web Store extension id (packed). */
export const STORE_EXTENSION_ID = 'ildkmabpimmkaediidaifkhjpohdnifk';

/**
 * Unpacked extension id, derived from the public `key` in
 * extension/manifest.json. Native host allowed_origins includes both.
 */
export const UNPACKED_EXTENSION_ID = 'pbppfkccdocgpnchcgjicgmhahemhnkj';

export const EXTENSION_ID = UNPACKED_EXTENSION_ID;
export const EXTENSION_ORIGIN = `chrome-extension://${UNPACKED_EXTENSION_ID}/`;
export const EXTENSION_ORIGINS = [
  `chrome-extension://${STORE_EXTENSION_ID}/`,
  `chrome-extension://${UNPACKED_EXTENSION_ID}/`,
];

/** Chrome kills a native host that writes a frame larger than 1 MiB. */
export const NATIVE_MAX_FRAME_BYTES = 1024 * 1024;

/**
 * JSON-text slice size for native chunks, in UTF-8 bytes. Must stay well under
 * 1MiB after JSON.stringify of the envelope (no base64 — that inflated 4/3 and
 * overflowed the cap at 768KiB raw).
 */
export const NATIVE_CHUNK_TEXT_BYTES = 512 * 1024;

export const CHUNK_TYPE = '__chunk__';
export const PAYLOAD_TOO_LARGE_CODE = 'payload_too_large';

export type HostState = {
  pid: number;
  sock: string;
  contextId: string;
  hostVersion: string;
  extensionVersion: string | null;
  extensionCompatRange: string | null;
  startedAt: number;
};

export type ChunkEnvelope = {
  type: typeof CHUNK_TYPE;
  id: string;
  i: number;
  n: number;
  data: string;
};

export function opencliHome(): string {
  return process.env.OPENCLI_CONFIG_DIR || path.join(os.homedir(), '.opencli');
}

export function runtimeDir(): string {
  return path.join(opencliHome(), 'run');
}

export function hostStatePath(contextId: string): string {
  return path.join(runtimeDir(), `host-${sanitizeContextId(contextId)}.json`);
}

/**
 * Per-process socket path. A stable `host-<id>.sock` name is unsafe: Node's
 * `server.close()` unlinks unix sockets by path, so a shutting-down host would
 * delete a replacement host's file at the same path.
 *
 * Names stay short: macOS `sockaddr_un.sun_path` is 104 bytes, and tmp testdirs
 * are already ~75 characters.
 */
export function instanceSocketPath(contextId: string, pid: number, dir = runtimeDir()): string {
  const id = sanitizeContextId(contextId).slice(0, 16);
  if (process.platform === 'win32') return `\\\\.\\pipe\\opencli-h-${id}-${pid}`;
  return path.join(dir, `h-${id}-${pid}.sock`);
}

export function sanitizeContextId(contextId: string): string {
  const trimmed = contextId.trim();
  if (!trimmed) return 'default';
  return trimmed.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
}

export function encodeFrame(value: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

/** Slice a UTF-8 string into pieces that each encode to at most `maxBytes`. */
export function splitUtf8ByBytes(s: string, maxBytes: number): string[] {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return [s];
  const parts: string[] = [];
  let offset = 0;
  while (offset < buf.length) {
    let end = Math.min(offset + maxBytes, buf.length);
    while (end > offset && (buf[end] & 0xc0) === 0x80) end--;
    if (end === offset) {
      throw Object.assign(new Error(`Native payload exceeds Chrome's 1MiB message cap (${buf.length} bytes).`), {
        code: PAYLOAD_TOO_LARGE_CODE,
      });
    }
    parts.push(buf.subarray(offset, end).toString('utf8'));
    offset = end;
  }
  return parts;
}

export function splitNativePayloads(value: unknown): unknown[] {
  const json = JSON.stringify(value);
  const direct = Buffer.byteLength(json, 'utf8');
  if (direct <= NATIVE_MAX_FRAME_BYTES - 64) return [value];
  const slices = splitUtf8ByBytes(json, NATIVE_CHUNK_TEXT_BYTES);
  const id = `chk_${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const parts: unknown[] = [];
  for (let i = 0; i < slices.length; i++) {
    const envelope: ChunkEnvelope = {
      type: CHUNK_TYPE,
      id,
      i,
      n: slices.length,
      data: slices[i],
    };
    const encoded = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
    if (encoded > NATIVE_MAX_FRAME_BYTES) {
      throw Object.assign(new Error(`Native payload exceeds Chrome's 1MiB message cap (${direct} bytes).`), {
        code: PAYLOAD_TOO_LARGE_CODE,
      });
    }
    parts.push(envelope);
  }
  return parts;
}

export function encodeNativeFrames(value: unknown): Buffer[] {
  return splitNativePayloads(value).map(encodeFrame);
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

export class FrameReader {
  private buf: Buffer = Buffer.alloc(0);
  private readonly assembler = new ChunkAssembler();

  push(chunk: Buffer | Uint8Array | string): unknown[] {
    const data = Buffer.from(chunk);
    this.buf = Buffer.concat([this.buf, data]);
    const messages: unknown[] = [];
    while (this.buf.length >= 4) {
      const size = this.buf.readUInt32LE(0);
      if (size > 32 * 1024 * 1024) {
        throw new Error(`Native frame too large (${size} bytes)`);
      }
      if (this.buf.length < 4 + size) break;
      const json = this.buf.subarray(4, 4 + size).toString('utf8');
      this.buf = this.buf.subarray(4 + size);
      const assembled = this.assembler.push(JSON.parse(json));
      if (assembled !== undefined) messages.push(assembled);
    }
    return messages;
  }
}

export function readHostStateFile(filePath: string): HostState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<HostState>;
    if (typeof parsed.pid !== 'number' || typeof parsed.contextId !== 'string' || typeof parsed.sock !== 'string') {
      return null;
    }
    return {
      pid: parsed.pid,
      sock: parsed.sock,
      contextId: parsed.contextId,
      hostVersion: typeof parsed.hostVersion === 'string' ? parsed.hostVersion : '',
      extensionVersion: typeof parsed.extensionVersion === 'string' ? parsed.extensionVersion : null,
      extensionCompatRange: typeof parsed.extensionCompatRange === 'string' ? parsed.extensionCompatRange : null,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
    };
  } catch {
    return null;
  }
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function listLiveHostStates(dir = runtimeDir()): HostState[] {
  if (!fs.existsSync(dir)) return [];
  const out: HostState[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith('host-') || !name.endsWith('.json')) continue;
    const filePath = path.join(dir, name);
    const state = readHostStateFile(filePath);
    if (!state) continue;
    if (!isPidAlive(state.pid)) {
      if (!state.sock.startsWith('\\\\.\\pipe\\')) {
        try { fs.unlinkSync(state.sock); } catch { /* stale */ }
      }
      try { fs.unlinkSync(filePath); } catch { /* stale */ }
      continue;
    }
    if (!state.sock.startsWith('\\\\.\\pipe\\') && !fs.existsSync(state.sock)) {
      try { fs.unlinkSync(filePath); } catch { /* stale */ }
      continue;
    }
    out.push(state);
  }
  return out;
}

export function nativeHostManifestPaths(): string[] {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
      path.join(home, 'Library/Application Support/Chromium/NativeMessagingHosts'),
      path.join(home, 'Library/Application Support/Microsoft Edge/NativeMessagingHosts'),
      path.join(home, 'Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts'),
      path.join(home, 'Library/Application Support/Arc/User Data/NativeMessagingHosts'),
    ];
  }
  if (process.platform === 'win32') {
    return [];
  }
  return [
    path.join(home, '.config/google-chrome/NativeMessagingHosts'),
    path.join(home, '.config/chromium/NativeMessagingHosts'),
    path.join(home, '.config/microsoft-edge/NativeMessagingHosts'),
    path.join(home, '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts'),
  ];
}

export function windowsNativeHostRegistryKeys(): string[] {
  return [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
    `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  ];
}
