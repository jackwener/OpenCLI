#!/usr/bin/env node
// Verify every direct dependency in root + extension package.json files uses
// an exact semver version. CLAUDE.md §4.1 requires exact pinning to keep
// supply-chain audits reproducible and disable silent minor/patch upgrades.
//
// Acceptance rule: the version string must be a complete semver
// (X.Y.Z, optionally with -prerelease and/or +build). Anything else is
// rejected: caret/tilde, comparators (>=, <), partial versions (1.2 / 1),
// wildcards (* / x), tags (latest, beta), or non-registry specs
// (git:, github:, file:, http:, npm: alias). peerDependencies are also
// scanned because a peer with a non-exact range can still influence
// resolution.
//
// Exit 0 on success, 1 on any non-exact pin.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Strict semver: X.Y.Z with optional -prerelease (alphanumeric/dot) and
// +build (alphanumeric/dot/hyphen). Mirrors the semver.org grammar.
const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const targets = ['package.json', 'extension/package.json'];
const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function classify(range) {
  const r = String(range).trim();
  if (r === '') return 'empty';
  if (/^[\^~><=]/.test(r)) return 'comparator/range';
  if (r.includes(' - ') || r.includes('||')) return 'range/union';
  if (r === '*' || /^x(\.|$)/i.test(r) || /(\.|^)x($|\.)/i.test(r)) return 'wildcard';
  if (/^(latest|next|beta|alpha|rc|canary)$/i.test(r)) return 'tag';
  if (/^(npm|file|link|workspace|github|git|git\+|http|https):/i.test(r) || /^[^@/]+\//.test(r)) return 'non-registry-spec';
  if (STRICT_SEMVER.test(r)) return 'exact';
  return 'partial-or-malformed';
}

let bad = 0;
for (const target of targets) {
  const pkg = JSON.parse(readFileSync(resolve(target), 'utf8'));
  let count = 0;
  for (const section of sections) {
    for (const [name, range] of Object.entries(pkg[section] || {})) {
      count++;
      const kind = classify(range);
      if (kind !== 'exact') {
        console.error(`  ❌ ${target} ${section}/${name}: "${range}" (${kind})`);
        bad++;
      }
    }
  }
  console.log(`  ${target}: scanned ${count} direct deps`);
}

if (bad > 0) {
  console.error(`\n❌ ${bad} non-exact pin(s) — §4.1 requires exact semver versions`);
  process.exit(1);
}
console.log('\n✅ All direct deps are exact-pinned (§4.1 OK)');
