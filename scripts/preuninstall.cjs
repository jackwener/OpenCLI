#!/usr/bin/env node
'use strict';

/**
 * Best-effort Native Messaging cleanup. Must be plain CJS so it still runs
 * after `dist/` is gone during npm uninstall.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const NAME = 'com.opencli.host';
const home = process.env.OPENCLI_CONFIG_DIR || path.join(os.homedir(), '.opencli');

function unlinkQuiet(filePath) {
  try { fs.unlinkSync(filePath); } catch { /* missing */ }
}

function darwinDirs() {
  const h = os.homedir();
  return [
    path.join(h, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
    path.join(h, 'Library/Application Support/Chromium/NativeMessagingHosts'),
    path.join(h, 'Library/Application Support/Microsoft Edge/NativeMessagingHosts'),
    path.join(h, 'Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts'),
    path.join(h, 'Library/Application Support/Arc/User Data/NativeMessagingHosts'),
  ];
}

function linuxDirs() {
  const h = os.homedir();
  return [
    path.join(h, '.config/google-chrome/NativeMessagingHosts'),
    path.join(h, '.config/chromium/NativeMessagingHosts'),
    path.join(h, '.config/microsoft-edge/NativeMessagingHosts'),
    path.join(h, '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts'),
  ];
}

function windowsKeys() {
  return [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NAME}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NAME}`,
    `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${NAME}`,
  ];
}

function main() {
  const dirs = process.platform === 'darwin' ? darwinDirs()
    : process.platform === 'win32' ? []
    : linuxDirs();
  for (const dir of dirs) unlinkQuiet(path.join(dir, `${NAME}.json`));
  unlinkQuiet(path.join(home, 'bin', process.platform === 'win32' ? 'opencli-host.cmd' : 'opencli-host'));
  unlinkQuiet(path.join(home, 'bin', `${NAME}.json`));
  if (process.platform === 'win32') {
    for (const key of windowsKeys()) {
      spawnSync('reg', ['delete', key, '/f'], { stdio: 'ignore' });
    }
  }
}

try {
  main();
} catch {
  // Uninstall must not fail because cleanup is best-effort.
}
