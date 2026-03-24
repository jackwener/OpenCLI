#!/usr/bin/env node
/**
 * opencli — Make any website your CLI. AI-powered.
 */

// Ensure standard system paths are available for child processes.
// Some environments (GUI apps, cron, IDE terminals) launch with a minimal PATH
// that excludes /usr/local/bin, /usr/sbin, etc., causing external CLIs to fail.
if (process.platform !== 'win32') {
  const std = ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const cur = new Set((process.env.PATH ?? '').split(':').filter(Boolean));
  for (const p of std) cur.add(p);
  process.env.PATH = [...cur].join(':');
}

import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverClis, discoverPlugins } from './discovery.js';
import { getCompletions } from './completion.js';
import { runCli } from './cli.js';
import { emitHook } from './hooks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUILTIN_CLIS = path.resolve(__dirname, 'clis');
const USER_CLIS = path.join(os.homedir(), '.opencli', 'clis');

await discoverClis(BUILTIN_CLIS, USER_CLIS);
await discoverPlugins();
await emitHook('onStartup', { command: '__startup__', args: {} });

// ── Fast-path: handle --get-completions before commander parses ─────────
// Usage: opencli --get-completions --cursor <N> [word1 word2 ...]
const getCompIdx = process.argv.indexOf('--get-completions');
if (getCompIdx !== -1) {
  const rest = process.argv.slice(getCompIdx + 1);
  let cursor: number | undefined;
  const words: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--cursor' && i + 1 < rest.length) {
      cursor = parseInt(rest[i + 1], 10);
      i++; // skip the value
    } else {
      words.push(rest[i]);
    }
  }
  if (cursor === undefined) cursor = words.length;
  const candidates = getCompletions(words, cursor);
  process.stdout.write(candidates.join('\n') + '\n');
  process.exit(0);
}

runCli(BUILTIN_CLIS, USER_CLIS);
