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

/** Leave room for the chunk envelope. */
const NATIVE_CHUNK_PAYLOAD_BYTES = 768 * 1024;

export const CHUNK_TYPE = '__chunk__';

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

export function hostSocketPath(contextId: string): string {
  const id = sanitizeContextId(contextId);
  if (process.platform === 'win32') return `\\\\.\\pipe\\opencli-host-${id}`;
  return path.join(runtimeDir(), `host-${id}.sock`);
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

export function encodeNativeFrames(value: unknown): Buffer[] {
  const json = Buffer.from(JSON.stringify(value), 'utf8');
  if (json.length <= NATIVE_MAX_FRAME_BYTES - 64) return [encodeFrame(value)];
  const n = Math.ceil(json.length / NATIVE_CHUNK_PAYLOAD_BYTES);
  const id = `chk_${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const frames: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    const slice = json.subarray(i * NATIVE_CHUNK_PAYLOAD_BYTES, (i + 1) * NATIVE_CHUNK_PAYLOAD_BYTES);
    const envelope: ChunkEnvelope = {
      type: CHUNK_TYPE,
      id,
      i,
      n,
      data: slice.toString('base64'),
    };
    frames.push(encodeFrame(envelope));
  }
  return frames;
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

export class FrameReader {
  private buf: Buffer = Buffer.alloc(0);
  private chunks = new Map<string, { n: number; parts: Array<Buffer | null> }>();

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
      const parsed: unknown = JSON.parse(json);
      const assembled = this.assemble(parsed);
      if (assembled !== undefined) messages.push(assembled);
    }
    return messages;
  }

  private assemble(parsed: unknown): unknown | undefined {
    if (!isChunkEnvelope(parsed)) return parsed;
    let entry = this.chunks.get(parsed.id);
    if (!entry) {
      entry = { n: parsed.n, parts: Array.from({ length: parsed.n }, () => null) };
      this.chunks.set(parsed.id, entry);
    }
    if (parsed.i < 0 || parsed.i >= entry.n) return undefined;
    entry.parts[parsed.i] = Buffer.from(parsed.data, 'base64');
    if (entry.parts.some((p) => p === null)) return undefined;
    this.chunks.delete(parsed.id);
    const body = Buffer.concat(entry.parts as Buffer[]);
    return JSON.parse(body.toString('utf8'));
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
    const state = readHostStateFile(path.join(dir, name));
    if (!state) continue;
    if (!isPidAlive(state.pid)) continue;
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
    ];
  }
  if (process.platform === 'win32') {
    return [];
  }
  return [
    path.join(home, '.config/google-chrome/NativeMessagingHosts'),
    path.join(home, '.config/chromium/NativeMessagingHosts'),
    path.join(home, '.config/microsoft-edge/NativeMessagingHosts'),
  ];
}

export function windowsNativeHostRegistryKey(): string {
  return `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
}
