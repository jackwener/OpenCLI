#!/usr/bin/env node
/**
 * Chrome Native Messaging entry. Manifest `path` points here (via wrapper).
 * Do not parse CLI flags: Chrome launches this with stdin/stdout only.
 */
import { runNativeHost } from './host.js';

runNativeHost().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
