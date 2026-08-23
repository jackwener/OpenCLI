import * as net from 'node:net';
import { FrameReader, encodeFrame } from '../host-protocol.js';

export async function requestHost(
  sockPath: string,
  payload: unknown,
  opts: { timeout?: number } = {},
): Promise<Record<string, unknown>> {
  const timeout = opts.timeout ?? 2000;
  return await new Promise((resolve, reject) => {
    const socket = net.connect(sockPath);
    const reader = new FrameReader();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error('Host RPC timed out'), { code: 'ETIMEDOUT' }));
    }, timeout);
    const done = (err?: Error, value?: Record<string, unknown>) => {
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value!);
    };
    socket.on('connect', () => {
      try {
        socket.write(encodeFrame(payload));
      } catch (err) {
        done(err instanceof Error ? err : new Error(String(err)));
      }
    });
    socket.on('data', (chunk) => {
      try {
        for (const msg of reader.push(Buffer.from(chunk))) {
          done(undefined, msg as Record<string, unknown>);
          return;
        }
      } catch (err) {
        done(err instanceof Error ? err : new Error(String(err)));
      }
    });
    socket.on('error', (err) => done(err));
    socket.on('end', () => {
      done(Object.assign(new Error('Host closed the socket'), { code: 'EPIPE' }));
    });
  });
}

export const PRE_CONNECT_SOCKET_CODES = new Set([
  'ENOENT',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTSOCK',
  'EADDRNOTAVAIL',
]);

export function isPreConnectSocketError(err: unknown): boolean {
  const queue: unknown[] = [err];
  const seen = new Set<unknown>();
  while (queue.length) {
    const current = queue.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const { code, cause, errors } = current as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof code === 'string' && PRE_CONNECT_SOCKET_CODES.has(code)) return true;
    if (cause) queue.push(cause);
    if (Array.isArray(errors)) queue.push(...errors);
  }
  return false;
}
