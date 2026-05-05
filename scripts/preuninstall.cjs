const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function readDaemonPort() {
  const configDir = path.join(os.homedir(), '.opencli');
  try {
    const raw = fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8');
    let inDaemon = false;
    let port = NaN;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const section = trimmed.match(/^\[([A-Za-z0-9_.-]+)\]$/);
      if (section) {
        inDaemon = section[1] === 'daemon';
        continue;
      }
      if (!inDaemon) continue;
      const value = trimmed.match(/^port\s*=\s*(\d+)\s*(?:#.*)?$/)?.[1];
      if (value) port = Number(value);
    }
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 19825;
  } catch {
    return 19825;
  }
}

fetch(`http://127.0.0.1:${readDaemonPort()}/shutdown`, {
  method: 'POST',
  headers: { 'X-OpenCLI': '1' },
  signal: AbortSignal.timeout(3000),
}).catch(() => {});
