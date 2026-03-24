/**
 * Daemon authentication token — shared secret between CLI, daemon, and extension.
 *
 * On first run, a random token is generated and stored at ~/.opencli/token.
 * The daemon requires this token on all HTTP and WebSocket connections.
 * The CLI and extension read the file to authenticate.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const TOKEN_DIR = path.join(os.homedir(), '.opencli');
const TOKEN_PATH = path.join(TOKEN_DIR, 'token');
const TOKEN_LENGTH = 32; // 32 random bytes → 64-char hex string
const TOKEN_REGEX = /^[0-9a-f]{64}$/; // exactly 64 hex chars

/**
 * Constant-time token comparison to prevent timing attacks.
 * Returns false if either value is missing or they differ in length.
 */
export function verifyToken(clientToken: string | undefined | null, serverToken: string): boolean {
  if (!clientToken) return false;
  const a = Buffer.from(clientToken, 'utf-8');
  const b = Buffer.from(serverToken, 'utf-8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Restrict file/directory to current user only on Windows.
 * On Unix, mode 0o600/0o700 set during creation is sufficient.
 */
function restrictPermissions(filePath: string): void {
  if (process.platform !== 'win32') return;
  try {
    execSync(`icacls "${filePath}" /inheritance:r /grant:r "%USERNAME%:F"`, {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    console.error(`[token] Warning: could not restrict permissions on ${filePath}`);
  }
}

/**
 * Get the current daemon token, creating one if it doesn't exist.
 * Uses O_EXCL for atomic creation to prevent race conditions when
 * multiple daemon processes start simultaneously.
 */
export function getOrCreateToken(): string {
  // If token file exists and is valid, return it
  try {
    const existing = fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
    if (TOKEN_REGEX.test(existing)) return existing;
    // File exists but is corrupted — will be recreated below
    console.error('[token] Token file corrupted, regenerating');
  } catch {
    // File doesn't exist or can't be read — create a new one
  }

  const token = randomBytes(TOKEN_LENGTH).toString('hex');

  // Ensure directory exists with restrictive permissions
  try {
    fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
    restrictPermissions(TOKEN_DIR);
  } catch (err) {
    throw new Error(
      `Cannot create token directory ${TOKEN_DIR}: ${(err as Error).message}. ` +
      `Ensure the home directory is writable.`,
    );
  }

  try {
    // O_CREAT | O_EXCL | O_WRONLY — fails atomically if file already exists
    const fd = fs.openSync(TOKEN_PATH, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeSync(fd, token);
    fs.closeSync(fd);
    restrictPermissions(TOKEN_PATH);
    return token;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Another process won the race — read their token
      const existing = fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
      if (TOKEN_REGEX.test(existing)) return existing;
    }
    throw new Error(
      `Cannot write token file ${TOKEN_PATH}: ${(err as Error).message}. ` +
      `Ensure ${TOKEN_DIR} is writable.`,
    );
  }
}

/**
 * Read the existing token. Returns null if no token file exists or is invalid.
 * Used by clients that should not create a token (only the daemon creates it).
 */
export function readToken(): string | null {
  try {
    const token = fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
    return TOKEN_REGEX.test(token) ? token : null;
  } catch {
    return null;
  }
}

/**
 * Generate a new token, replacing the existing one.
 * Running daemons must be restarted to pick up the new token.
 */
export function rotateToken(): string {
  const token = randomBytes(TOKEN_LENGTH).toString('hex');
  fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  const tmpPath = TOKEN_PATH + '.tmp';
  fs.writeFileSync(tmpPath, token, { mode: 0o600 });
  fs.renameSync(tmpPath, TOKEN_PATH);
  restrictPermissions(TOKEN_PATH);
  return token;
}

/** Header name used to pass the token */
export const TOKEN_HEADER = 'x-opencli-token';
