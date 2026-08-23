import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EXTENSION_ORIGINS, NATIVE_HOST_NAME } from './host-protocol.js';
import { buildNativeHostManifest, installNativeHostManifest, writeHostWrapper } from './native-manifest.js';

describe('native host manifest install', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a Chrome Native Messaging manifest pinned to the stable extension origin', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-nmh-'));
    dirs.push(dir);
    const binary = path.join(dir, 'opencli-host');
    fs.writeFileSync(binary, '#!/bin/sh\n', { mode: 0o755 });
    const result = installNativeHostManifest({
      binaryPath: binary,
      directories: [path.join(dir, 'NativeMessagingHosts')],
    });
    expect(result.files).toHaveLength(1);
    const json = JSON.parse(fs.readFileSync(result.files[0], 'utf8'));
    expect(json).toEqual(buildNativeHostManifest(binary));
    expect(json.name).toBe(NATIVE_HOST_NAME);
    expect(json.type).toBe('stdio');
    expect(json.path).toBe(binary);
    expect(json.allowed_origins).toEqual(EXTENSION_ORIGINS);
  });

  it('writes an executable wrapper that points at the shipped host-bin', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-wrap-'));
    dirs.push(dir);
    const wrapper = path.join(dir, 'opencli-host');
    writeHostWrapper(wrapper);
    const body = fs.readFileSync(wrapper, 'utf8');
    expect(body).toContain(process.execPath);
    expect(body).toMatch(/host-bin\.(js|ts)/);
    expect(fs.statSync(wrapper).mode & 0o111).toBeTruthy();
  });
});
