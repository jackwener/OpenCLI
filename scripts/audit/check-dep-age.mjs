#!/usr/bin/env node
// Verify dependencies meet the 90-day rule (CLAUDE.md §4.2). Walks the
// full lockfile, fetches publish times from npm, audits lifecycle
// scripts, and consults the structured exemption registry at
// .audit/exemptions/exemptions.json.
//
// Three enforcement tiers:
//   - DIRECT deps (declared in package.json): violations fail the audit
//   - TRANSITIVE deps (everything else in the lockfile): reported as
//     warnings; renovate.json's minimumReleaseAge covers ongoing updates
//   - NEW TRANSITIVE deps (in current lockfile but absent in base ref):
//     these are the supply-chain attack vector — pass --strict-new-transitive
//     to fail on any new <90d transitive dep introduced since base
// Pass --strict-transitive to escalate ALL transitive violations to failure.
//
// Always fail-closed on registry/parse errors. The previous direct-only
// fail-open implementation hid <90d transitive deps and silently passed
// when npm view returned errors.
//
// Usage:
//   node scripts/audit/check-dep-age.mjs                                  # root, warn on transitive
//   node scripts/audit/check-dep-age.mjs extension
//   node scripts/audit/check-dep-age.mjs --strict-transitive              # ALL transitive must be >=90d
//   node scripts/audit/check-dep-age.mjs --strict-new-transitive          # only NEW <90d transitive blocks
//   node scripts/audit/check-dep-age.mjs --strict-new-transitive --base-ref origin/dev
//
// Exit codes:
//   0  OK (or only grandfathered transitive warnings)
//   1  any direct-dep violation, registry error, or (with --strict-*) qualifying transitive violation
//   2  invalid input (missing files, malformed exemptions, unreachable base ref)

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const strictTransitive = args.includes('--strict-transitive');
const strictNewTransitive = args.includes('--strict-new-transitive');
const baseRefIdx = args.indexOf('--base-ref');
const baseRef = baseRefIdx >= 0 && args[baseRefIdx + 1] ? args[baseRefIdx + 1] : 'origin/main';
const subdir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--base-ref') || '.';

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

function collectDeps(lockJson) {
  const out = new Map();
  for (const [path, info] of Object.entries(lockJson.packages || {})) {
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
    if (!out.has(key)) out.set(key, { name, version: info.version, paths: [] });
    out.get(key).paths.push(path);
  }
  return out;
}

// Build the (name, version, resolved, integrity) provenance set used by
// --strict-new-transitive baseline diffing. Comparing on (name, version)
// alone would let an attacker swap a package's tarball source or strip
// its integrity hash without changing the version string and have the
// audit treat it as grandfathered.
function collectProvenance(lockJson) {
  const out = new Set();
  for (const [path, info] of Object.entries(lockJson.packages || {})) {
    if (path === '') continue;
    if (info.link) continue;
    if (!info.version) continue;
    let name = info.name;
    if (!name) {
      const m = path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)$/);
      name = m ? m[1] : null;
    }
    if (!name) continue;
    out.add(`${name}@${info.version}|${info.resolved || ''}|${info.integrity || ''}`);
  }
  return out;
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const deps = collectDeps(lock);
const installScripts = [];
for (const [path, info] of Object.entries(lock.packages || {})) {
  if (info.hasInstallScript) {
    installScripts.push({ name: info.name || path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)$/)?.[1], version: info.version, path });
  }
}

// Build baseline provenance (name@version|resolved|integrity) set for
// new-transitive detection. If the base ref doesn't have the lockfile
// (first introduction) the script downgrades to "no baseline" and skips
// the new-transitive escalation rather than treating every entry as new.
let baselineKeys = null;
let baselineProvenance = null;
let baselineUnavailableReason = null;
if (strictNewTransitive) {
  const lockRelative = subdir === '.' ? 'package-lock.json' : `${subdir.replace(/\/$/, '')}/package-lock.json`;
  try {
    const baseLockText = execFileSync('git', ['show', `${baseRef}:${lockRelative}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const baseLock = JSON.parse(baseLockText);
    baselineKeys = new Set(collectDeps(baseLock).keys());
    baselineProvenance = collectProvenance(baseLock);
  } catch (e) {
    baselineUnavailableReason = e.message.split('\n')[0];
  }
}

console.log(`Scanning ${deps.size} unique packages from ${lockPath}...`);
console.log(`Direct deps (from ${pkgPath}): ${directNames.size}`);
let modeLabel;
if (strictTransitive) {
  modeLabel = 'STRICT-ALL-TRANSITIVE (every transitive <90d fails)';
} else if (strictNewTransitive) {
  if (baselineKeys) {
    modeLabel = `STRICT-NEW-TRANSITIVE (only transitive entries absent in ${baseRef} fail; baseline has ${baselineKeys.size} entries)`;
  } else {
    modeLabel = `STRICT-NEW-TRANSITIVE requested but baseline ${baseRef} unavailable (${baselineUnavailableReason}) — falling back to standard warn`;
  }
} else {
  modeLabel = 'standard (transitive violations warn)';
}
console.log(`Mode: ${modeLabel}`);
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
      const parsed = JSON.parse(out);
      // Guard against npm returning null/non-object (e.g. unpublished
      // package, registry hiccup). Without this the next access to
      // times.__error throws a TypeError that escapes the per-package
      // catch and aborts the whole audit run.
      if (typeof parsed !== 'object' || parsed === null) {
        timeCache.set(name, { __error: `npm view returned ${parsed === null ? 'null' : typeof parsed}` });
      } else {
        timeCache.set(name, parsed);
      }
    } catch (e) {
      timeCache.set(name, { __error: e.message.split('\n')[0] });
    }
  }
  const times = timeCache.get(name);
  if (times.__error) throw new Error(times.__error);
  return times[version];
}

function getLifecycleScripts(name, version) {
  // Fetch the full scripts object for this exact version and extract
  // lifecycle fields. Asking npm view for individual sub-paths collapses
  // missing fields silently, so we read the whole object and filter
  // ourselves. Throws on registry/parse failure so callers can fail
  // closed — the script's docstring promises fail-closed semantics on
  // EVERY registry interaction, not just the age lookup.
  let out;
  try {
    out = execFileSync(
      'npm',
      ['view', `${name}@${version}`, 'scripts', '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    throw new Error(`npm view scripts failed: ${e.message.split('\n')[0]}`);
  }
  const raw = out.trim();
  if (!raw) return {};
  let all;
  try {
    all = JSON.parse(raw);
  } catch (e) {
    throw new Error(`npm view scripts returned invalid JSON: ${e.message}`);
  }
  if (typeof all !== 'object' || all === null) return {};
  const result = {};
  for (const f of ['preinstall', 'install', 'postinstall']) {
    if (typeof all[f] === 'string' && all[f].length > 0) result[f] = all[f];
  }
  return result;
}

let okCount = 0;
let exemptCount = 0;
const directViolations = [];
const transitiveViolations = [];
const newTransitiveViolations = [];
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
    if (isDirect) {
      directViolations.push({ name, version, ageDays, pubStr });
    } else {
      // 4-tuple comparison: a tarball-source or integrity swap on the
      // same (name, version) counts as new even though the version
      // string is unchanged.
      const info = lock.packages[deps.get(key).paths[0]] || {};
      const provenanceKey = `${name}@${version}|${info.resolved || ''}|${info.integrity || ''}`;
      const isNew = baselineProvenance && !baselineProvenance.has(provenanceKey);
      if (isNew) {
        newTransitiveViolations.push({ name, version, ageDays, pubStr });
      } else {
        transitiveViolations.push({ name, version, ageDays, pubStr, grandfathered: !!baselineProvenance });
      }
    }
  } catch (e) {
    errors.push({ name, version, reason: e.message, isDirect });
  }
}

if (installScripts.length > 0) {
  console.log('\n=== Lifecycle script audit (preinstall/install/postinstall) ===');
  console.log(`(${installScripts.length} package(s) declare install scripts — review the actual commands below)`);
  for (const { name, version, path } of installScripts) {
    console.log(`\n  ${name}@${version}  (${path})`);
    let scripts;
    try {
      scripts = getLifecycleScripts(name, version);
    } catch (e) {
      // Fail closed: a registry failure here means we cannot verify
      // what the lifecycle script actually does, which is exactly the
      // signal a supply-chain attacker would want to suppress.
      errors.push({ name, version, reason: `lifecycle script fetch failed: ${e.message}`, isDirect: directNames.has(name) });
      console.log(`    ❌ failed to fetch script content (counted as audit failure): ${e.message}`);
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
console.log(`  OK (>=90d):                                ${okCount}`);
console.log(`  Exempt (active registration):              ${exemptCount}`);
console.log(`  Direct violations (fail):                  ${directViolations.length}`);
console.log(`  New transitive violations (${strictNewTransitive && baselineKeys ? 'fail' : 'warn'}, since ${baseRef}): ${newTransitiveViolations.length}`);
console.log(`  Grandfathered transitive violations (${strictTransitive ? 'fail' : 'warn'}): ${transitiveViolations.length}`);
console.log(`  Errors (fail):                             ${errors.length}`);
console.log(`  Lifecycle scripts:                         ${installScripts.length}`);
console.log(`  Expired exemptions:                        ${expiredExemptions.length}`);

if (directViolations.length > 0) {
  console.log('\n=== Direct violations (<90d, no exemption) — BLOCKING ===');
  for (const v of directViolations) {
    console.log(`  ❌ ${v.name}@${v.version}  age=${v.ageDays}d  published=${v.pubStr}`);
  }
}

if (newTransitiveViolations.length > 0) {
  const blocks = strictNewTransitive && baselineKeys;
  const tag = blocks ? '❌' : '⚠️ ';
  console.log(`\n=== New transitive violations (<90d, absent in ${baseRef}) — ${blocks ? 'BLOCKING (--strict-new-transitive)' : 'WARNING (enable --strict-new-transitive to block)'} ===`);
  for (const v of newTransitiveViolations) {
    console.log(`  ${tag} ${v.name}@${v.version}  age=${v.ageDays}d  published=${v.pubStr}`);
  }
}

if (transitiveViolations.length > 0) {
  const tag = strictTransitive ? '❌' : '⚠️ ';
  const label = baselineKeys ? `Grandfathered transitive violations (already in ${baseRef})` : 'Transitive violations (<90d, no exemption)';
  console.log(`\n=== ${label} — ${strictTransitive ? 'BLOCKING (--strict-transitive)' : 'WARNING (renovate enforces 90d on updates)'} ===`);
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

let blocking = directViolations.length + errors.length;
if (strictTransitive) blocking += transitiveViolations.length + newTransitiveViolations.length;
else if (strictNewTransitive && baselineKeys) blocking += newTransitiveViolations.length;

if (blocking > 0) {
  console.log('\n❌ FAIL: §4.2 not satisfied — see blocking items above.');
  process.exit(1);
}

const totalWarn = transitiveViolations.length + newTransitiveViolations.length;
if (totalWarn > 0) {
  console.log('\n✅ PASS (with warnings): direct deps and active exemptions OK; transitive <90d items will be rotated by Renovate.');
} else {
  console.log('\n✅ PASS: all packages meet §4.2 (or have valid active exemption).');
}
process.exit(0);
