import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadLaunchRegistry = vi.hoisted(() => vi.fn());
const mockRemoveLaunchRegistryEntries = vi.hoisted(() => vi.fn());
const mockIsProcessAlive = vi.hoisted(() => vi.fn());
const mockTemporaryRoot = vi.hoisted(
  () => `${(process.env.TMPDIR ?? '/tmp').replace(/\/$/, '')}/opencli-test-temporary-profiles-${process.pid}`,
);

vi.mock('./instances.js', async () => {
  const actual = await vi.importActual<typeof import('./instances.js')>('./instances.js');
  const actualPath = await vi.importActual<typeof import('node:path')>('node:path');
  return {
    ...actual,
    readLaunchRegistry: mockReadLaunchRegistry,
    removeLaunchRegistryEntries: mockRemoveLaunchRegistryEntries,
    isProcessAlive: mockIsProcessAlive,
    temporaryBrowserLaunchRoot: () => mockTemporaryRoot,
    inferUserDataKind: (userDataDir?: string) => {
      if (!userDataDir) return 'unknown';
      const resolved = actualPath.resolve(userDataDir);
      const tempRoot = actualPath.resolve(mockTemporaryRoot);
      return resolved === tempRoot || resolved.startsWith(`${tempRoot}${actualPath.sep}`)
        ? 'temporary'
        : 'persistent';
    },
  };
});

import {
  listBrowserProfiles,
  persistentBrowserProfilesRoot,
  pruneTemporaryProfiles,
  profileLabel,
  removeBrowserProfile,
  resolvePersistentProfileDir,
} from './profiles.js';

describe('browser profiles helpers', () => {
  const createdPersistentDirs = new Set<string>();
  const temporaryRoot = mockTemporaryRoot;

  afterEach(() => {
    vi.restoreAllMocks();
    mockReadLaunchRegistry.mockReset();
    mockRemoveLaunchRegistryEntries.mockReset();
    mockIsProcessAlive.mockReset();

    for (const dir of createdPersistentDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    createdPersistentDirs.clear();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it('lists persistent and temporary profiles', async () => {
    const profileName = `vitest-profile-${Date.now()}`;
    const persistentDir = resolvePersistentProfileDir(profileName);
    const tempDir = path.join(temporaryRoot, 'port-9339-spec');

    fs.mkdirSync(persistentDir, { recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });
    createdPersistentDirs.add(persistentDir);

    mockReadLaunchRegistry.mockResolvedValue([
      {
        id: 'port-9339',
        pid: 111,
        port: 9339,
        endpoint: 'http://127.0.0.1:9339',
        profileName,
        userDataDir: persistentDir,
        userDataKind: 'persistent',
        launchMode: 'background',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      {
        id: 'port-9444',
        pid: 222,
        port: 9444,
        endpoint: 'http://127.0.0.1:9444',
        userDataDir: tempDir,
        userDataKind: 'temporary',
        launchMode: 'background',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ]);
    mockIsProcessAlive.mockImplementation((pid?: number) => pid === 111);

    const profiles = await listBrowserProfiles();

    expect(profiles).toEqual([
      expect.objectContaining({
        name: profileName,
        kind: 'persistent',
        status: 'in-use',
        ports: [9339],
        path: persistentDir,
      }),
      expect.objectContaining({
        name: 'port-9339-spec',
        kind: 'temporary',
        status: 'idle',
        ports: [],
        path: tempDir,
      }),
    ]);
  });

  it('removes a named persistent profile', async () => {
    const profileName = `vitest-rm-${Date.now()}`;
    const persistentDir = resolvePersistentProfileDir(profileName);

    fs.mkdirSync(persistentDir, { recursive: true });
    createdPersistentDirs.add(persistentDir);

    const registryEntries = [
      {
        id: 'port-9339',
        pid: 0,
        port: 9339,
        endpoint: 'http://127.0.0.1:9339',
        profileName,
        userDataDir: persistentDir,
        userDataKind: 'persistent',
        launchMode: 'background',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ];
    mockReadLaunchRegistry.mockResolvedValue(registryEntries);
    mockIsProcessAlive.mockReturnValue(false);
    mockRemoveLaunchRegistryEntries.mockImplementation(async (predicate) => registryEntries.filter(predicate).length);

    const report = await removeBrowserProfile(profileName);

    expect(report.removed).toBe(true);
    expect(report.removedRegistryEntries).toBe(1);
    expect(fs.existsSync(persistentDir)).toBe(false);
  });

  it('prunes unused temporary profiles and skips in-use ones', async () => {
    const activeDir = path.join(temporaryRoot, 'port-9222-active');
    const staleDir = path.join(temporaryRoot, 'port-9339-stale');
    fs.mkdirSync(activeDir, { recursive: true });
    fs.mkdirSync(staleDir, { recursive: true });

    const registryEntries = [
      {
        id: 'port-9222',
        pid: 111,
        port: 9222,
        endpoint: 'http://127.0.0.1:9222',
        userDataDir: activeDir,
        userDataKind: 'temporary',
        launchMode: 'background',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      {
        id: 'port-9339',
        pid: 0,
        port: 9339,
        endpoint: 'http://127.0.0.1:9339',
        userDataDir: staleDir,
        userDataKind: 'temporary',
        launchMode: 'background',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ];
    mockReadLaunchRegistry.mockResolvedValue(registryEntries);
    mockIsProcessAlive.mockImplementation((pid?: number) => pid === 111);
    mockRemoveLaunchRegistryEntries.mockImplementation(async (predicate) => registryEntries.filter(predicate).length);

    const report = await pruneTemporaryProfiles();

    expect(report.removedDirs).toEqual([staleDir]);
    expect(report.skippedInUse).toBe(1);
    expect(report.removedRegistryEntries).toBe(1);
    expect(fs.existsSync(activeDir)).toBe(true);
    expect(fs.existsSync(staleDir)).toBe(false);
  });

  it('formats profile labels for persistent and temporary entries', () => {
    expect(profileLabel({
      profileName: 'zhihu',
      userDataDir: path.join(persistentBrowserProfilesRoot(), 'zhihu'),
      userDataKind: 'persistent',
    })).toBe('zhihu');

    expect(profileLabel({
      userDataDir: path.join(temporaryRoot, 'port-9339-temp'),
      userDataKind: 'temporary',
    })).toBe('port-9339-temp');
  });
});
