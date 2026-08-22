const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!fs.existsSync(path.join(process.cwd(), 'src'))) {
  process.exit(0);
}

const npmExecPath = process.env.npm_execpath;
// npm, pnpm, and Yarn expose a JavaScript CLI entry here, which Node can run
// directly. Bun exposes its native executable instead; passing that binary to
// Node would make `bun install` fail during prepare, so use npm for non-JS
// runners (the build scripts themselves already invoke npm).
const hasJsExecPath = npmExecPath && /\.(?:c|m)?js$/i.test(npmExecPath);
const command = hasJsExecPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const args = hasJsExecPath ? [npmExecPath, 'run', 'build'] : ['run', 'build'];
const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: !hasJsExecPath && process.platform === 'win32',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
