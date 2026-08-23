/**
 * Install the Native Messaging host manifest so Chrome can spawn `opencli-host`.
 *
 * The manifest `path` cannot carry arguments, so we write a tiny wrapper next
 * to OpenCLI's config dir and point Chrome at that.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  EXTENSION_ORIGINS,
  NATIVE_HOST_NAME,
  nativeHostManifestPaths,
  opencliHome,
  windowsNativeHostRegistryKey,
} from './host-protocol.js';

export type NativeHostManifest = {
  name: string;
  description: string;
  path: string;
  type: 'stdio';
  allowed_origins: string[];
};

export function locateHostEntry(): { kind: 'js' | 'ts'; file: string } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const js = path.join(here, 'host-bin.js');
  if (fs.existsSync(js)) return { kind: 'js', file: js };
  const ts = path.join(here, 'host-bin.ts');
  if (fs.existsSync(ts)) return { kind: 'ts', file: ts };
  throw new Error('opencli host entry (host-bin.js) is missing; rebuild the package.');
}

export function hostWrapperPath(): string {
  const binDir = path.join(opencliHome(), 'bin');
  return path.join(binDir, process.platform === 'win32' ? 'opencli-host.cmd' : 'opencli-host');
}

export function writeHostWrapper(wrapperPath = hostWrapperPath()): string {
  const entry = locateHostEntry();
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  if (process.platform === 'win32') {
    const node = process.execPath.replace(/"/g, '""');
    const file = entry.file.replace(/"/g, '""');
    const args = entry.kind === 'ts' ? `"${node}" --import tsx/esm "${file}"` : `"${node}" "${file}"`;
    fs.writeFileSync(wrapperPath, `@echo off\r\n${args} %*\r\n`, 'utf8');
  } else {
    const args = entry.kind === 'ts'
      ? `"${process.execPath}" --import tsx/esm "${entry.file}"`
      : `"${process.execPath}" "${entry.file}"`;
    fs.writeFileSync(wrapperPath, `#!/bin/sh\nexec ${args} "$@"\n`, { encoding: 'utf8', mode: 0o755 });
    fs.chmodSync(wrapperPath, 0o755);
  }
  return wrapperPath;
}

export function buildNativeHostManifest(binaryPath: string, allowedOrigins: string[] = EXTENSION_ORIGINS): NativeHostManifest {
  return {
    name: NATIVE_HOST_NAME,
    description: 'OpenCLI native messaging host',
    path: binaryPath,
    type: 'stdio',
    allowed_origins: allowedOrigins,
  };
}

export function installNativeHostManifest(opts: {
  binaryPath?: string;
  directories?: string[];
  allowedOrigins?: string[];
} = {}): { files: string[]; binaryPath: string } {
  const binaryPath = opts.binaryPath ?? writeHostWrapper();
  const manifest = buildNativeHostManifest(binaryPath, opts.allowedOrigins);
  const body = JSON.stringify(manifest, null, 2) + '\n';
  const files: string[] = [];
  const dirs = opts.directories ?? nativeHostManifestPaths().filter((dir) => {
    const parent = path.dirname(dir);
    return fs.existsSync(parent);
  });
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${NATIVE_HOST_NAME}.json`);
    fs.writeFileSync(file, body, 'utf8');
    files.push(file);
  }
  if (process.platform === 'win32' && !opts.directories) {
    installWindowsRegistry(binaryPath, files);
  }
  return { files, binaryPath };
}

function installWindowsRegistry(manifestPathWritten: string, files: string[]): void {
  // Chrome on Windows reads the host path from the registry value, which
  // points at the manifest JSON (not the binary). Write a manifest next to
  // the wrapper and register that file.
  const manifestFile = path.join(opencliHome(), 'bin', `${NATIVE_HOST_NAME}.json`);
  const originManifest = files[0];
  if (originManifest) {
    fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
    fs.copyFileSync(originManifest, manifestFile);
  } else {
    fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
    fs.writeFileSync(
      manifestFile,
      JSON.stringify(buildNativeHostManifest(manifestPathWritten), null, 2) + '\n',
    );
  }
  spawnSync('reg', ['add', windowsNativeHostRegistryKey(), '/ve', '/t', 'REG_SZ', '/d', manifestFile, '/f'], {
    stdio: 'ignore',
  });
}

export function nativeHostManifestInstalled(): boolean {
  if (process.platform === 'win32') {
    const probe = spawnSync('reg', ['query', windowsNativeHostRegistryKey()], { encoding: 'utf8' });
    return probe.status === 0;
  }
  return nativeHostManifestPaths().some((dir) => fs.existsSync(path.join(dir, `${NATIVE_HOST_NAME}.json`)));
}
