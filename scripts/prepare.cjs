const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!fs.existsSync(path.join(process.cwd(), 'src'))) {
  process.exit(0);
}

const npmExecPath = process.env.npm_execpath;
const command = npmExecPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const args = npmExecPath ? [npmExecPath, 'run', 'build'] : ['run', 'build'];
const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: !npmExecPath && process.platform === 'win32',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
