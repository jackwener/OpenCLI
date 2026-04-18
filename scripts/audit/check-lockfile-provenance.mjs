#!/usr/bin/env node
// Verify lockfile provenance: every resolved dependency must point to the
// official npm registry and carry an integrity (SHA-512) digest. Without
// these checks an attacker who already has commit access could swap a
// package's tarball source or strip its integrity hash without changing
// the version string — bypassing 90-day age checks and supply-chain
// gates that key off (name, version) alone.
//
// Usage:
//   node scripts/audit/check-lockfile-provenance.mjs                    # root
//   node scripts/audit/check-lockfile-provenance.mjs extension          # extension
//   node scripts/audit/check-lockfile-provenance.mjs --allow-registry https://npm.example.com
//
// Exit codes:
//   0  every entry is registry-resolved and integrity-pinned
//   1  one or more entries fail provenance checks
//   2  invalid input

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const allowIdx = args.indexOf('--allow-registry');
const extraRegistries = allowIdx >= 0 && args[allowIdx + 1] ? [args[allowIdx + 1]] : [];
const subdir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--allow-registry') || '.';

const lockPath = resolve(subdir, 'package-lock.json');
if (!existsSync(lockPath)) {
  console.error(`❌ ${lockPath} not found`);
  process.exit(2);
}

const ALLOWED_REGISTRIES = [
  'https://registry.npmjs.org/',
  ...extraRegistries.map(r => r.endsWith('/') ? r : r + '/'),
];

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const issues = [];
let scanned = 0;

for (const [path, info] of Object.entries(lock.packages || {})) {
  if (path === '') continue;
  if (info.link) continue;
  if (!info.version) continue;
  scanned++;

  if (!info.resolved) {
    issues.push({ path, kind: 'missing-resolved', detail: '(no resolved url)' });
    continue;
  }
  if (!ALLOWED_REGISTRIES.some(r => info.resolved.startsWith(r))) {
    issues.push({ path, kind: 'unexpected-registry', detail: info.resolved });
  }
  if (!info.integrity) {
    issues.push({ path, kind: 'missing-integrity', detail: '(no SHA-512 hash)' });
    continue;
  }
  if (!info.integrity.startsWith('sha512-')) {
    issues.push({ path, kind: 'weak-integrity', detail: info.integrity.split('-')[0] || '(unknown)' });
  }
}

console.log(`Scanned ${scanned} packages from ${lockPath}`);
console.log(`Allowed registries: ${ALLOWED_REGISTRIES.join(', ')}`);

if (issues.length === 0) {
  console.log('✅ all packages registry-resolved and SHA-512 pinned');
  process.exit(0);
}

console.log(`\n=== Provenance issues (${issues.length}) ===`);
const byKind = {};
for (const i of issues) {
  (byKind[i.kind] ||= []).push(i);
}
for (const [kind, group] of Object.entries(byKind)) {
  console.log(`\n  [${kind}] ${group.length}`);
  for (const item of group.slice(0, 20)) {
    console.log(`    ${item.path}  ${item.detail}`);
  }
  if (group.length > 20) console.log(`    ... (${group.length - 20} more)`);
}

console.log(`\n❌ ${issues.length} provenance issue(s) — bypassing this gate would let a tarball-swap attack slip past --strict-new-transitive`);
process.exit(1);
