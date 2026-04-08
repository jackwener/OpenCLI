#!/usr/bin/env node
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function run(cmd) {
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

run('node scripts/sync-skill-command-reference.mjs');
run('node scripts/sync-skill-md.mjs');

console.log('✅ OpenCLI skill docs synced.');
