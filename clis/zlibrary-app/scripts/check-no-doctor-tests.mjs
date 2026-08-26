#!/usr/bin/env node
/**
 * CI gate: reject doctor-*.test.js files.
 *
 * Doctor commands are live-site probes that vitest/mocks cannot validate.
 * Any dedicated doctor test file is a spec violation.
 *
 * Usage: node scripts/check-no-doctor-tests.mjs [--fix]
 *   --fix  : delete offending files (for automated cleanup)
 */
import { readdirSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const CLIS_DIR = resolve(new URL('..', import.meta.url).pathname, 'clis');
const FIX = process.argv.includes('--fix');
let exitCode = 0;

function scanDir(dir) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...scanDir(full));
    } else if (entry.isFile() && /^doctor-.+\.test\.(js|ts|mjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const offenders = scanDir(CLIS_DIR);

for (const file of offenders) {
  const rel = relative(process.cwd(), file);
  if (FIX) {
    unlinkSync(file);
    console.error(`🗑️  Deleted doctor test: ${rel}`);
  } else {
    console.error(`❌ Doctor test file detected: ${rel}`);
    console.error(`   Doctor commands are live-site probes — vitest cannot validate them.`);
    console.error(`   See .trellis/spec/backend/opencli-doctor-diagnostics.md P8`);
    exitCode = 1;
  }
}

if (exitCode === 0 && !FIX) {
  console.log('✅ No doctor test files found');
}

process.exit(exitCode);
