/**
 * Optional browser launcher: when the Browser Bridge is not connected, OpenCLI
 * starts the browser itself (once, bounded) instead of failing straight away.
 *
 * Configured in <config dir>/browser-launcher.json (config dir: OPENCLI_CONFIG_DIR
 * or ~/.opencli):
 *   {
 *     "start": ["systemctl", "--user", "start", "chromium.service"],
 *     "profileDir": "/path/to/chromium/Default"
 *   }
 * "start" runs without a shell and should start the existing browser profile
 * (a service manager unit, an app launcher, ...). "profileDir" lets OpenCLI drop
 * the saved "OpenCLI Browser" tab groups Chromium keeps from earlier runs.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface BrowserLauncherConfig {
  start?: string[];
  profileDir?: string;
}

const OPENCLI_GROUP_TITLE = Buffer.from('OpenCLI Browser');
const SAVED_GROUP_PREFIX = Buffer.from('saved_tab_group-dt-');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

export function launcherConfigPath(): string {
  const baseDir = process.env.OPENCLI_CONFIG_DIR || path.join(os.homedir(), '.opencli');
  return path.join(baseDir, 'browser-launcher.json');
}

export function loadLauncherConfig(): BrowserLauncherConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(launcherConfigPath(), 'utf-8')) as Record<string, unknown>;
    const start = Array.isArray(raw.start) && raw.start.length > 0 && raw.start.every(arg => typeof arg === 'string')
      ? raw.start as string[]
      : undefined;
    const profileDir = typeof raw.profileDir === 'string' && raw.profileDir.trim() ? raw.profileDir : undefined;
    return { ...(start && { start }), ...(profileDir && { profileDir }) };
  } catch {
    return {};
  }
}

/** Runs the configured start command. Returns false when none is configured or it fails. */
export function startConfiguredBrowser(config: BrowserLauncherConfig = loadLauncherConfig()): boolean {
  if (!config.start) return false;
  if (config.profileDir) cleanSavedOpenCLIGroups(config.profileDir);
  const [command, ...args] = config.start;
  const result = spawnSync(command, args, { stdio: 'ignore', timeout: 60_000 });
  return result.status === 0;
}

/**
 * True while a Chromium instance holds the profile: its user-data-dir
 * SingletonLock points at "<host>-<pid>" of a live process.
 */
export function isProfileInUse(profileDir: string): boolean {
  const lock = path.join(path.dirname(profileDir), 'SingletonLock');
  let target: string;
  try {
    target = fs.readlinkSync(lock);
  } catch {
    return false;
  }
  const pid = Number(target.slice(target.lastIndexOf('-') + 1));
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Chromium saves every tab group still open when its window closes and pins it
 * to the bookmarks bar, so each restart during an OpenCLI task leaves another
 * "OpenCLI Browser" chip. Saved groups live alone in "Sync Data/LevelDB" when
 * sync is off. The database is removed only while the browser is stopped and
 * every saved group there is an OpenCLI group; anything else keeps it.
 */
export function cleanSavedOpenCLIGroups(profileDir: string): { removed: boolean; reason: string } {
  const dbDir = path.join(profileDir, 'Sync Data', 'LevelDB');
  if (isProfileInUse(profileDir)) return { removed: false, reason: 'browser is running' };
  let files: string[];
  try {
    files = fs.readdirSync(dbDir);
  } catch {
    return { removed: false, reason: 'no saved tab group database' };
  }
  // Compacted tables are not parsed here; keep everything rather than guess.
  if (files.some(name => name.endsWith('.ldb'))) return { removed: false, reason: 'database is compacted' };
  const live = new Map<string, Buffer>();
  for (const name of files.filter(file => file.endsWith('.log')).sort()) {
    for (const [key, value] of readLevelDbLog(fs.readFileSync(path.join(dbDir, name)))) {
      if (value === null) live.delete(key);
      else live.set(key, value);
    }
  }
  const entries = [...live].filter(([key]) => Buffer.from(key, 'latin1').subarray(0, SAVED_GROUP_PREFIX.length).equals(SAVED_GROUP_PREFIX));
  if (entries.length === 0) return { removed: false, reason: 'no saved tab groups' };
  // Tab entries reference their group's id; group entries reference only themselves.
  const groups = entries.filter(([key, value]) => {
    const own = key.slice(SAVED_GROUP_PREFIX.length);
    return !(value.toString('latin1').match(UUID) ?? []).some(ref => ref !== own);
  });
  if (!groups.every(([, value]) => value.includes(OPENCLI_GROUP_TITLE))) {
    return { removed: false, reason: 'saved groups include non-OpenCLI groups' };
  }
  fs.rmSync(dbDir, { recursive: true, force: true });
  return { removed: true, reason: `removed ${groups.length} saved OpenCLI groups (${entries.length} entries)` };
}

function readVarint(buf: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  for (;;) {
    const byte = buf[offset++];
    result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if (byte < 0x80) return [result, offset];
  }
}

/** Yields [key, value] puts and [key, null] deletes from a LevelDB write-ahead log. */
function* readLevelDbLog(data: Buffer): Generator<[string, Buffer | null]> {
  const BLOCK = 32768;
  let pending = Buffer.alloc(0);
  let pos = 0;
  while (pos + 7 <= data.length) {
    const left = BLOCK - (pos % BLOCK);
    if (left < 7) { pos += left; continue; }
    const length = data.readUInt16LE(pos + 4);
    const kind = data[pos + 6];
    if (kind === 0 && length === 0) { pos += left; continue; }
    pending = Buffer.concat([pending, data.subarray(pos + 7, pos + 7 + length)]);
    pos += 7 + length;
    if (kind !== 1 && kind !== 4) continue;
    const batch = pending;
    pending = Buffer.alloc(0);
    let i = 12;
    const count = batch.readUInt32LE(8);
    for (let n = 0; n < count && i < batch.length; n++) {
      const tag = batch[i++];
      let keyLength: number;
      [keyLength, i] = readVarint(batch, i);
      const key = batch.subarray(i, i + keyLength).toString('latin1');
      i += keyLength;
      if (tag === 1) {
        let valueLength: number;
        [valueLength, i] = readVarint(batch, i);
        yield [key, batch.subarray(i, i + valueLength)];
        i += valueLength;
      } else {
        yield [key, null];
      }
    }
  }
}
