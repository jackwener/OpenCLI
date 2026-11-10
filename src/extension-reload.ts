/**
 * Check or reload the OpenCLI extension without the browser's extensions page.
 *
 * PROBLEM: an unpacked extension keeps running its old code after a rebuild
 * until someone clicks reload, and agents cannot click that page.
 * DESIGN: ask the extension which build it runs, compare it with
 * extension/dist/build-id.txt, ask it to reload itself (it refuses while a
 * command runs), then poll until it answers with the on-disk build. A browser
 * that never comes back is reported, not retried: a build that fails to load
 * never reconnects, and only its extensions page shows why.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ExtensionInfo {
  version?: string;
  buildId?: string;
  contextId?: string;
  runningCommands?: number;
  interactiveSessions?: string[];
}

export type ExtensionSend = (
  action: 'extension-info' | 'reload-extension',
  params: Record<string, unknown>,
) => Promise<unknown>;

export interface ReloadOptions {
  send: ExtensionSend;
  diskBuildId: string | null;
  /** Profile routing params (`{ contextId }` for an explicit --profile). */
  route: Record<string, unknown>;
  force?: boolean;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface ReloadReport {
  status: 'reloaded' | 'already_current';
  profile?: string;
  before?: string;
  after?: string;
  disk: string;
  windows?: unknown;
}

export class ExtensionReloadError extends Error {
  constructor(message: string, readonly code: string, readonly hint?: string) {
    super(message);
    this.name = 'ExtensionReloadError';
  }
}

export const PREDATES_RELOAD_HINT = 'This browser runs an OpenCLI extension from before self-reload. '
  + 'Reload it once by hand: open chrome://extensions (edge://extensions in Edge), find OpenCLI, and press its reload icon. '
  + 'From then on `opencli extension reload` does it.';

const POLL_INTERVAL_MS = 750;
const PREDATES_RELOAD_ERROR = /Unknown action: extension-info|Browser session is required/;
const BUILD_ID = /^[0-9a-f]{16}$/;

export function readDiskBuildId(
  packageRoot: string,
  readFile: (filePath: string) => string = (filePath) => fs.readFileSync(filePath, 'utf-8'),
): string | null {
  try {
    const value = readFile(path.join(packageRoot, 'extension', 'dist', 'build-id.txt')).trim();
    return BUILD_ID.test(value) ? value : null;
  } catch {
    return null;
  }
}

export async function readExtensionInfo(send: ExtensionSend, route: Record<string, unknown>): Promise<ExtensionInfo> {
  try {
    return ((await send('extension-info', route)) ?? {}) as ExtensionInfo;
  } catch (err) {
    // Builds before self-reload parse a session before the action switch, so
    // they answer "Browser session is required" rather than "Unknown action".
    if (err instanceof Error && PREDATES_RELOAD_ERROR.test(err.message)) {
      throw new ExtensionReloadError('The loaded OpenCLI extension predates self-reload.', 'extension_predates_reload', PREDATES_RELOAD_HINT);
    }
    throw err;
  }
}

export async function reloadExtension(opts: ReloadOptions): Promise<ReloadReport> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const disk = opts.diskBuildId;
  if (!disk) {
    throw new ExtensionReloadError(
      'No extension build on disk (extension/dist/build-id.txt is missing).',
      'extension_build_missing',
      'Build it first: cd extension && npm run build',
    );
  }

  const before = await readExtensionInfo(opts.send, opts.route);
  if (before.buildId === disk) {
    return { status: 'already_current', profile: before.contextId, before: before.buildId, after: before.buildId, disk };
  }

  // A refusal (extension_busy) propagates: nothing was reloaded.
  const reply = (await opts.send('reload-extension', { ...opts.route, ...(opts.force ? { force: true } : {}) })) as { windows?: unknown } | undefined;

  const deadline = now() + timeoutMs;
  let lastSeen: string | undefined;
  while (now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let info: ExtensionInfo;
    try {
      const remainingSeconds = Math.max(1, Math.ceil((deadline - now()) / 1000));
      info = await readExtensionInfo(opts.send, { ...opts.route, timeout: remainingSeconds });
    } catch {
      // The profile is disconnected while the extension reloads.
      continue;
    }
    lastSeen = info.buildId;
    if (info.buildId === disk) {
      return { status: 'reloaded', profile: info.contextId, before: before.buildId, after: info.buildId, disk, windows: reply?.windows };
    }
  }
  throw new ExtensionReloadError(
    `The extension did not come back with build ${disk} within ${Math.round(timeoutMs / 1000)}s (last seen: ${lastSeen ?? 'none'}).`,
    'extension_reload_timeout',
    'A build that fails to load never reconnects. Open the browser\'s extensions page, read the OpenCLI errors, fix the build, and reload it once by hand.',
  );
}
