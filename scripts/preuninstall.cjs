const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function readDaemonPort() {
  const configDir = path.join(os.homedir(), '.opencli');
  try {
    const raw = fs.readFileSync(path.join(configDir, 'config.json'), 'utf8');
    const port = Number(JSON.parse(raw)?.daemon?.port);
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
