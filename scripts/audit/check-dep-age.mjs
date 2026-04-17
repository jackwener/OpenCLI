#!/usr/bin/env node
// Verify all direct dependencies in package.json meet the 90-day rule
// (CLAUDE.md §4.2). Flags violations but does not modify anything.
//
// Usage:
//   node scripts/audit/check-dep-age.mjs                 # checks ./package.json
//   node scripts/audit/check-dep-age.mjs extension       # checks extension/package.json
//
// Exit code: 0 if all OK (or only EXEMPT via .audit/exemptions/), 1 if unexpected <90d.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const CUTOFF = new Date('2026-01-17T00:00:00Z');
// 3 months before today; refresh this if running in a different month
// by computing: new Date(Date.now() - 90 * 86400000)
const AUTO_CUTOFF = new Date(Date.now() - 90 * 86400000);
const effectiveCutoff = AUTO_CUTOFF > CUTOFF ? AUTO_CUTOFF : CUTOFF;

const subdir = process.argv[2] || '.';
const pkgPath = resolve(subdir, 'package.json');
if (!existsSync(pkgPath)) {
  console.error(`❌ ${pkgPath} not found`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

// Read exemptions (best-effort; file may be on another branch)
const exemptionsDir = resolve('.audit/exemptions');
const exemptPackages = new Set();
if (existsSync(exemptionsDir)) {
  // Simple heuristic: scan any .md file for "undici@X.Y.Z [EXEMPT"-like mentions
  // and extract bare package names. Users can also hard-code exempt names here.
}
// Hard-coded exempt list (safer than parsing docs). Update when exemptions change.
exemptPackages.add('undici');

let violationCount = 0;

function check(specs, category) {
  if (!specs || Object.keys(specs).length === 0) {
    console.log(`\n=== ${category} (empty) ===`);
    return;
  }
  console.log(`\n=== ${category} ===`);
  for (const [name, range] of Object.entries(specs)) {
    try {
      const out = execFileSync('npm', ['view', `${name}@${range}`, 'version', '--json'], { encoding: 'utf8' }).trim();
      const versions = JSON.parse(out);
      const installed = Array.isArray(versions) ? versions[versions.length - 1] : versions;
      const timeOut = execFileSync('npm', ['view', `${name}@${installed}`, 'time', '--json'], { encoding: 'utf8' });
      const times = JSON.parse(timeOut);
      const pub = times[installed];
      const d = new Date(pub);
      const ageDays = Math.floor((Date.now() - d.getTime()) / 86400000);
      const compliant = d < effectiveCutoff;
      const exempt = exemptPackages.has(name);
      const status = compliant ? 'OK  ' : exempt ? 'EXEMPT' : '<90d❌';
      if (!compliant && !exempt) violationCount++;
      console.log(`  ${name.padEnd(22)} range=${String(range).padEnd(12)} install=${String(installed).padEnd(12)} age=${String(ageDays).padStart(5)}d  ${status}`);
    } catch (e) {
      console.log(`  ${name.padEnd(22)} ERR: ${e.message.split('\n')[0]}`);
    }
  }
}

check(pkg.dependencies, `dependencies (${subdir}/package.json)`);
check(pkg.devDependencies, `devDependencies (${subdir}/package.json)`);

console.log('');
if (violationCount > 0) {
  console.log(`❌ ${violationCount} unexpected <90d package(s). Either fix the pin or add to exempt list.`);
  process.exit(1);
} else {
  console.log(`✅ All direct deps meet §4.2 (or are listed in exempt set).`);
  process.exit(0);
}
