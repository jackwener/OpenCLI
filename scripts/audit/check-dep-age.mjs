#!/usr/bin/env node
// Verify dependencies meet the 90-day rule (CLAUDE.md §4.2). Walks the
// full lockfile, fetches publish times from npm, audits lifecycle
// scripts, and consults the structured exemption registry at
// .audit/exemptions/exemptions.json.
//
// Two enforcement tiers:
//   - DIRECT deps (declared in package.json): violations fail the audit
//   - TRANSITIVE deps (everything else in the lockfile): reported as
//     warnings; renovate.json's minimumReleaseAge covers ongoing updates
// Pass --strict-transitive to escalate transitive violations to failure.
//
// Always fail-closed on registry/parse errors. The previous direct-only
// fail-open implementation hid <90d transitive deps and silently passed
// when npm view returned errors.
//
// Usage:
//   node scripts/audit/check-dep-age.mjs                          # root
//   node scripts/audit/check-dep-age.mjs extension                # extension
//   node scripts/audit/check-dep-age.mjs --strict-transitive
//   node scripts/audit/check-dep-age.mjs extension --strict-transitive
//
// Exit codes:
//   0  OK (or only transitive warnings without --strict-transitive)
//   1  one or more direct-dep violations, errors, or (with --strict-transitive) transitive violations
//   2  invalid input (missing files, malformed exemptions)

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const strictTransitive = args.includes('--strict-transitive');
const subdir = args.find(a => !a.startsWith('--')) || '.';

const pkgPath = resolve(subdir, 'package.json');
const lockPath = resolve(subdir, 'package-lock.json');
const exemptionsPath = resolve('.audit/exemptions/exemptions.json');

if (!existsSync(pkgPath)) {
  console.error(`❌ ${pkgPath} not found`);
  process.exit(2);
}
if (!existsSync(lockPath)) {
  console.error(`❌ ${lockPath} not found — §4.2 requires a lockfile`);
  process.exit(2);
}

const today = new Date();
const ninetyDaysAgo = new Date(today.getTime() - 90 * 86400000);

const exemptions = new Map();
const expiredExemptions = [];
if (existsSync(exemptionsPath)) {
  let data;
  try {
    data = JSON.parse(readFileSync(exemptionsPath, 'utf8'));
  } catch (e) {
    console.error(`❌ Failed to parse ${exemptionsPath}: ${e.message}`);
    process.exit(2);
  }
  for (const e of data.exemptions || []) {
    if (!e.name || !e.version || !e.expiresOn || !e.reason) {
      console.error(`❌ Malformed exemption (need name, version, reason, expiresOn): ${JSON.stringify(e)}`);
      process.exit(2);
    }
    const expiry = new Date(e.expiresOn);
    if (Number.isNaN(expiry.getTime())) {
      console.error(`❌ Invalid expiresOn date in exemption ${e.name}@${e.version}: ${e.expiresOn}`);
      process.exit(2);
    }
    const key = `${e.name}@${e.version}`;
    if (today >= expiry) {
      expiredExemptions.push({ key, expiry: e.expiresOn });
      continue;
    }
    exemptions.set(key, e);
  }
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const directNames = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
]);

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const deps = new Map();
const installScripts = [];

for (const [path, info] of Object.entries(lock.packages || {})) {
  if (path === '') continue;
  if (info.link) continue;
  if (!info.version) continue;
  let name = info.name;
  if (!name) {
    const m = path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)$/);
    name = m ? m[1] : null;
  }
  if (!name) continue;
  const key = `${name}@${info.version}`;
  if (!deps.has(key)) deps.set(key, { name, version: info.version, paths: [] });
  deps.get(key).paths.push(path);
  if (info.hasInstallScript) {
    installScripts.push({ name, version: info.version, path });
  }
}

console.log(`Scanning ${deps.size} unique packages from ${lockPath}...`);
console.log(`Direct deps (from ${pkgPath}): ${directNames.size}`);
console.log(`Mode: ${strictTransitive ? 'STRICT (transitive violations fail)' : 'standard (transitive violations warn)'}`);
if (exemptions.size > 0) {
  console.log(`Active exemptions: ${[...exemptions.keys()].join(', ')}`);
}
if (expiredExemptions.length > 0) {
  console.log('⚠️  Expired exemptions (no longer in effect):');
  for (const e of expiredExemptions) console.log(`     ${e.key}  expired ${e.expiry}`);
}

const timeCache = new Map();
function getPublishTime(name, version) {
  if (!timeCache.has(name)) {
    try {
      const out = execFileSync('npm', ['view', name, 'time', '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      timeCache.set(name, JSON.parse(out));
    } catch (e) {
      timeCache.set(name, { __error: e.message.split('\n')[0] });
    }
  }
  const times = timeCache.get(name);
  if (times.__error) throw new Error(times.__error);
  return times[version];
}

let okCount = 0;
let exemptCount = 0;
const directViolations = [];
const transitiveViolations = [];
const errors = [];

for (const { name, version } of deps.values()) {
  const isDirect = directNames.has(name);
  try {
    const pubStr = getPublishTime(name, version);
    if (!pubStr) {
      errors.push({ name, version, reason: 'no publish time in registry', isDirect });
      continue;
    }
    const pub = new Date(pubStr);
    if (Number.isNaN(pub.getTime())) {
      errors.push({ name, version, reason: `unparseable timestamp: ${pubStr}`, isDirect });
      continue;
    }
    const ageDays = Math.floor((today.getTime() - pub.getTime()) / 86400000);
    if (pub < ninetyDaysAgo) {
      okCount++;
      continue;
    }
    const key = `${name}@${version}`;
    if (exemptions.has(key)) {
      exemptCount++;
      console.log(`  EXEMPT  ${(isDirect ? '[direct]    ' : '[transitive]')} ${key.padEnd(38)} age=${String(ageDays).padStart(4)}d  ${exemptions.get(key).reason}`);
      continue;
    }
    (isDirect ? directViolations : transitiveViolations).push({ name, version, ageDays, pubStr });
  } catch (e) {
    errors.push({ name, version, reason: e.message, isDirect });
  }
}

if (installScripts.length > 0) {
  console.log('\n=== Lifecycle script audit (preinstall/install/postinstall) ===');
  console.log(`(${installScripts.length} package(s) declare install scripts — review before trust)`);
  for (const { name, version, path } of installScripts) {
    console.log(`  ${name}@${version}  (${path})`);
  }
}

console.log('\n=== Summary ===');
console.log(`  OK (>=90d):                       ${okCount}`);
console.log(`  Exempt (active registration):     ${exemptCount}`);
console.log(`  Direct violations (fail):         ${directViolations.length}`);
console.log(`  Transitive violations (${strictTransitive ? 'fail' : 'warn'}): ${transitiveViolations.length}`);
console.log(`  Errors (fail):                    ${errors.length}`);
console.log(`  Lifecycle scripts:                ${installScripts.length}`);
console.log(`  Expired exemptions:               ${expiredExemptions.length}`);

if (directViolations.length > 0) {
  console.log('\n=== Direct violations (<90d, no exemption) — BLOCKING ===');
  for (const v of directViolations) {
    console.log(`  ❌ ${v.name}@${v.version}  age=${v.ageDays}d  published=${v.pubStr}`);
  }
}

if (transitiveViolations.length > 0) {
  const tag = strictTransitive ? '❌' : '⚠️ ';
  console.log(`\n=== Transitive violations (<90d, no exemption) — ${strictTransitive ? 'BLOCKING (--strict-transitive)' : 'WARNING (renovate enforces 90d on updates)'} ===`);
  for (const v of transitiveViolations) {
    console.log(`  ${tag} ${v.name}@${v.version}  age=${v.ageDays}d  published=${v.pubStr}`);
  }
}

if (errors.length > 0) {
  console.log('\n=== Errors (treated as failure — fix or add exemption) ===');
  for (const e of errors) {
    console.log(`  ⚠️  ${e.isDirect ? '[direct]    ' : '[transitive]'} ${e.name}@${e.version}  (${e.reason})`);
  }
}

if (expiredExemptions.length > 0 && (directViolations.length > 0 || errors.length > 0)) {
  console.log('\n💡 Hint: an expired exemption may be the cause — extend or rotate it in .audit/exemptions/exemptions.json');
}

const blocking = directViolations.length + errors.length + (strictTransitive ? transitiveViolations.length : 0);

if (blocking > 0) {
  console.log('\n❌ FAIL: §4.2 not satisfied — see blocking items above.');
  process.exit(1);
}

if (transitiveViolations.length > 0) {
  console.log('\n✅ PASS (with warnings): direct deps and active exemptions OK; transitive <90d items will be rotated by Renovate.');
} else {
  console.log('\n✅ PASS: all packages meet §4.2 (or have valid active exemption).');
}
process.exit(0);
