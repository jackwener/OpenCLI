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

// §4.4 exemption policy:
//   - every exemption MUST declare name, version, reason, documentRef,
//     addedOn, expiresOn (no implicit defaults — reviewers should always
//     see the audit trail)
//   - expiresOn must be within MAX_EXEMPTION_DAYS of addedOn so a single
//     waiver cannot become a permanent whitelist (matches the §4.2 90d
//     review cycle plus a one-cycle grace window)
const MAX_EXEMPTION_DAYS = 180;
const REQUIRED_FIELDS = ['name', 'version', 'reason', 'documentRef', 'addedOn', 'expiresOn'];

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
    const missing = REQUIRED_FIELDS.filter(f => !e[f]);
    if (missing.length > 0) {
      console.error(`❌ Malformed exemption (missing ${missing.join(', ')}): ${JSON.stringify(e)}`);
      process.exit(2);
    }
    const added = new Date(e.addedOn);
    const expiry = new Date(e.expiresOn);
    if (Number.isNaN(added.getTime())) {
      console.error(`❌ Invalid addedOn date in exemption ${e.name}@${e.version}: ${e.addedOn}`);
      process.exit(2);
    }
    if (Number.isNaN(expiry.getTime())) {
      console.error(`❌ Invalid expiresOn date in exemption ${e.name}@${e.version}: ${e.expiresOn}`);
      process.exit(2);
    }
    if (expiry <= added) {
      console.error(`❌ Exemption ${e.name}@${e.version}: expiresOn (${e.expiresOn}) must be after addedOn (${e.addedOn})`);
      process.exit(2);
    }
    const ttlDays = Math.floor((expiry.getTime() - added.getTime()) / 86400000);
    if (ttlDays > MAX_EXEMPTION_DAYS) {
      console.error(`❌ Exemption ${e.name}@${e.version}: TTL ${ttlDays}d exceeds the ${MAX_EXEMPTION_DAYS}-day cap (raise the cap explicitly with a code change if you really mean it)`);
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

function getLifecycleScripts(name, version) {
  // Fetch the full scripts object for this exact version and extract the
  // lifecycle-relevant fields. Asking npm view for individual sub-paths
  // collapses missing fields silently, so we read the whole object and
  // filter ourselves. Returns {preinstall?, install?, postinstall?} or
  // null if the registry call fails.
  try {
    const out = execFileSync(
      'npm',
      ['view', `${name}@${version}`, 'scripts', '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const raw = out.trim();
    if (!raw) return {};
    const all = JSON.parse(raw);
    if (typeof all !== 'object' || all === null) return {};
    const result = {};
    for (const f of ['preinstall', 'install', 'postinstall']) {
      if (typeof all[f] === 'string' && all[f].length > 0) result[f] = all[f];
    }
    return result;
  } catch {
    return null;
  }
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
  console.log(`(${installScripts.length} package(s) declare install scripts — review the actual commands below)`);
  for (const { name, version, path } of installScripts) {
    console.log(`\n  ${name}@${version}  (${path})`);
    const scripts = getLifecycleScripts(name, version);
    if (scripts === null) {
      console.log('    ⚠️  could not fetch script content from registry — review manually');
      continue;
    }
    const fields = ['preinstall', 'install', 'postinstall'];
    let any = false;
    for (const f of fields) {
      if (scripts[f]) {
        any = true;
        console.log(`    ${f}: ${scripts[f]}`);
      }
    }
    if (!any) {
      console.log('    (no preinstall/install/postinstall declared in published manifest — hasInstallScript may be set by a binding script)');
    }
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
