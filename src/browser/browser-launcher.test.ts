import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanSavedOpenCLIGroups,
  isProfileInUse,
  launcherConfigPath,
  loadLauncherConfig,
  runBrowserLauncher,
} from './browser-launcher.js';

const BLOCK = 32768;
const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const PREFIX = 'saved_tab_group-dt-';

function varint(n: number): Buffer {
  const out: number[] = [];
  while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
  return Buffer.from(out);
}

type Op = { key: string; value: string } | { key: string; del: true };

/** Encodes one LevelDB write batch (sequence, count, put/delete records). */
function batch(ops: Op[]): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt32LE(ops.length, 8);
  const parts: Buffer[] = [header];
  for (const op of ops) {
    const key = Buffer.from(op.key, 'latin1');
    if ('del' in op) {
      parts.push(Buffer.from([0]), varint(key.length), key);
    } else {
      const value = Buffer.from(op.value, 'latin1');
      parts.push(Buffer.from([1]), varint(key.length), key, varint(value.length), value);
    }
  }
  return Buffer.concat(parts);
}

function physical(type: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(7);
  head.writeUInt16LE(payload.length, 4);
  head[6] = type;
  return Buffer.concat([head, payload]);
}

/** One batch stored as a single full record. */
function fullRecord(ops: Op[]): Buffer {
  return physical(1, batch(ops));
}

/** One batch split into first/last records, the first one ending at a block boundary. */
function splitAcrossBlock(prefixLength: number, ops: Op[]): Buffer {
  const payload = batch(ops);
  const room = BLOCK - prefixLength - 7;
  return Buffer.concat([physical(2, payload.subarray(0, room)), physical(4, payload.subarray(room))]);
}

describe('browser-launcher', () => {
  let root: string;
  let profileDir: string;
  let dbDir: string;
  const savedEnv = process.env.OPENCLI_CONFIG_DIR;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-launcher-'));
    profileDir = path.join(root, 'udd', 'Default');
    dbDir = path.join(profileDir, 'Sync Data', 'LevelDB');
    fs.mkdirSync(dbDir, { recursive: true });
    process.env.OPENCLI_CONFIG_DIR = path.join(root, 'config');
    fs.mkdirSync(process.env.OPENCLI_CONFIG_DIR, { recursive: true });
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.OPENCLI_CONFIG_DIR;
    else process.env.OPENCLI_CONFIG_DIR = savedEnv;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const writeConfig = (value: unknown) =>
    fs.writeFileSync(launcherConfigPath(), typeof value === 'string' ? value : JSON.stringify(value));
  const writeLog = (data: Buffer, name = '000003.log') => fs.writeFileSync(path.join(dbDir, name), data);
  const lockPath = () => path.join(root, 'udd', 'SingletonLock');

  describe('loadLauncherConfig', () => {
    it('honors OPENCLI_CONFIG_DIR for the config path', () => {
      expect(launcherConfigPath()).toBe(path.join(root, 'config', 'browser-launcher.json'));
    });

    it('returns an empty config when the file is missing or invalid', () => {
      expect(loadLauncherConfig()).toEqual({});
      writeConfig('{not json');
      expect(loadLauncherConfig()).toEqual({});
    });

    it('reads a valid config', () => {
      writeConfig({
        start: ['browser', '--start'],
        restart: ['browser', '--restart'],
        profileDir: '/some/profile',
        unbindBoundSessions: true,
      });
      expect(loadLauncherConfig()).toEqual({
        start: ['browser', '--start'],
        restart: ['browser', '--restart'],
        profileDir: '/some/profile',
        unbindBoundSessions: true,
      });
    });

    it('drops non-array, empty and non-string-element arguments', () => {
      writeConfig({ start: 'browser', restart: ['ok', 5], profileDir: '   ', unbindBoundSessions: 'yes' });
      expect(loadLauncherConfig()).toEqual({});
      writeConfig({ start: [], restart: 'x' });
      expect(loadLauncherConfig()).toEqual({});
    });
  });

  describe('runBrowserLauncher', () => {
    it('returns false when the kind is not configured', () => {
      expect(runBrowserLauncher('start', {})).toBe(false);
      expect(runBrowserLauncher('restart', { start: ['true'] })).toBe(false);
    });

    it('reflects the command exit status', () => {
      expect(runBrowserLauncher('start', { start: ['true'] })).toBe(true);
      expect(runBrowserLauncher('start', { start: ['false'] })).toBe(false);
      expect(runBrowserLauncher('start', { start: ['opencli-no-such-command'] })).toBe(false);
    });

    it('cleans saved groups before running the command when profileDir is set', () => {
      writeLog(fullRecord([{ key: PREFIX + GROUP_ID, value: `${GROUP_ID} OpenCLI Browser` }]));
      expect(runBrowserLauncher('start', { start: ['true'], profileDir })).toBe(true);
      expect(fs.existsSync(dbDir)).toBe(false);
    });
  });

  describe('isProfileInUse', () => {
    it('is false without a SingletonLock', () => {
      expect(isProfileInUse(profileDir)).toBe(false);
    });

    it('is true when the lock points at a live pid', () => {
      fs.symlinkSync(`testhost-${process.pid}`, lockPath());
      expect(isProfileInUse(profileDir)).toBe(true);
    });

    it('is false when the lock points at a finished pid', () => {
      // Pid beyond the kernel maximum, so it can never be alive.
      fs.symlinkSync('testhost-99999999', lockPath());
      expect(isProfileInUse(profileDir)).toBe(false);
    });

    it('is true when the lock target has no usable pid', () => {
      fs.symlinkSync('garbage', lockPath());
      expect(isProfileInUse(profileDir)).toBe(true);
    });
  });

  describe('cleanSavedOpenCLIGroups', () => {
    const opencliGroup: Op = { key: PREFIX + GROUP_ID, value: `${GROUP_ID} title OpenCLI Browser` };
    const opencliTab: Op = { key: `${PREFIX}tab1`, value: `${GROUP_ID} https://example.com/` };

    it('skips while the browser is running', () => {
      writeLog(fullRecord([opencliGroup]));
      fs.symlinkSync(`testhost-${process.pid}`, lockPath());
      expect(cleanSavedOpenCLIGroups(profileDir)).toEqual({ removed: false, reason: 'browser is running' });
      expect(fs.existsSync(dbDir)).toBe(true);
    });

    it('skips when there is no database', () => {
      fs.rmSync(path.join(profileDir, 'Sync Data'), { recursive: true });
      expect(cleanSavedOpenCLIGroups(profileDir).reason).toBe('no saved tab group database');
    });

    it('keeps a compacted database', () => {
      writeLog(fullRecord([opencliGroup]));
      fs.writeFileSync(path.join(dbDir, '000005.ldb'), 'table');
      expect(cleanSavedOpenCLIGroups(profileDir)).toEqual({ removed: false, reason: 'database is compacted' });
      expect(fs.existsSync(dbDir)).toBe(true);
    });

    it('keeps a database without saved tab groups', () => {
      writeLog(fullRecord([{ key: 'other_key', value: 'value' }]));
      expect(cleanSavedOpenCLIGroups(profileDir).reason).toBe('no saved tab groups');
      expect(fs.existsSync(dbDir)).toBe(true);
    });

    it('keeps the database when a non-OpenCLI group is saved', () => {
      writeLog(fullRecord([
        opencliGroup,
        { key: PREFIX + OTHER_ID, value: `${OTHER_ID} My Research` },
      ]));
      expect(cleanSavedOpenCLIGroups(profileDir)).toEqual({
        removed: false,
        reason: 'saved groups include non-OpenCLI groups',
      });
      expect(fs.existsSync(path.join(dbDir, '000003.log'))).toBe(true);
    });

    it('removes a database holding only OpenCLI groups and their tabs', () => {
      writeLog(fullRecord([opencliGroup, opencliTab]));
      const result = cleanSavedOpenCLIGroups(profileDir);
      expect(result.removed).toBe(true);
      expect(result.reason).toBe('removed 1 saved OpenCLI groups (2 entries)');
      expect(fs.existsSync(dbDir)).toBe(false);
      // Only the LevelDB directory goes; the rest of the profile stays.
      expect(fs.existsSync(path.join(profileDir, 'Sync Data'))).toBe(true);
    });

    it('does not mistake a tab of a non-OpenCLI group for an OpenCLI group', () => {
      writeLog(fullRecord([
        opencliGroup,
        { key: `${PREFIX}tab2`, value: `${OTHER_ID} https://example.com/` },
        { key: PREFIX + OTHER_ID, value: `${OTHER_ID} My Research` },
      ]));
      expect(cleanSavedOpenCLIGroups(profileDir).removed).toBe(false);
    });

    it('ignores a non-OpenCLI group that was deleted later in the log', () => {
      writeLog(Buffer.concat([
        fullRecord([opencliGroup, { key: PREFIX + OTHER_ID, value: `${OTHER_ID} My Research` }]),
        fullRecord([{ key: PREFIX + OTHER_ID, del: true }]),
      ]));
      expect(cleanSavedOpenCLIGroups(profileDir).removed).toBe(true);
    });

    it('lets a later put override an earlier one for the same key', () => {
      writeLog(Buffer.concat([
        fullRecord([{ key: PREFIX + GROUP_ID, value: `${GROUP_ID} My Research` }]),
        fullRecord([{ key: PREFIX + GROUP_ID, value: `${GROUP_ID} OpenCLI Browser` }]),
      ]));
      expect(cleanSavedOpenCLIGroups(profileDir).removed).toBe(true);
    });

    it('treats a group whose entries were all deleted as no saved groups', () => {
      writeLog(Buffer.concat([
        fullRecord([opencliGroup]),
        fullRecord([{ key: PREFIX + GROUP_ID, del: true }]),
      ]));
      expect(cleanSavedOpenCLIGroups(profileDir).reason).toBe('no saved tab groups');
      expect(fs.existsSync(dbDir)).toBe(true);
    });

    it('reads records split across a 32 KiB block boundary', () => {
      // Leave 40 bytes in the first block so the split batch must continue in the next one.
      // The value length varint grows from 1 to 3 bytes for large values.
      const overhead = fullRecord([{ key: 'filler', value: '' }]).length + 2;
      const first = fullRecord([{ key: 'filler', value: 'x'.repeat(BLOCK - 40 - overhead) }]);
      expect(first.length).toBe(BLOCK - 40);
      const split = splitAcrossBlock(first.length, [opencliGroup, opencliTab]);
      const data = Buffer.concat([first, split]);
      expect(data.length).toBeGreaterThan(BLOCK);
      writeLog(data);
      const result = cleanSavedOpenCLIGroups(profileDir);
      expect(result.removed).toBe(true);
      expect(result.reason).toContain('(2 entries)');
    });

    it('skips block trailers too small for a record header', () => {
      // Fill the first block so that fewer than 7 bytes remain, then continue in the next block.
      const fillerValue = 'x'.repeat(BLOCK - 7 - 12 - 1 - 1 - 1 - 1 - 3 - 4);
      const filler = fullRecord([{ key: 'fil', value: fillerValue }]);
      expect(BLOCK - filler.length).toBeLessThan(7);
      const trailer = Buffer.alloc(BLOCK - filler.length);
      writeLog(Buffer.concat([filler, trailer, fullRecord([opencliGroup])]));
      expect(cleanSavedOpenCLIGroups(profileDir).removed).toBe(true);
    });

    it('merges entries across several log files in name order', () => {
      writeLog(fullRecord([{ key: PREFIX + OTHER_ID, value: `${OTHER_ID} My Research` }]), '000003.log');
      writeLog(Buffer.concat([
        fullRecord([{ key: PREFIX + OTHER_ID, del: true }]),
        fullRecord([opencliGroup]),
      ]), '000004.log');
      expect(cleanSavedOpenCLIGroups(profileDir).removed).toBe(true);
    });
  });
});
