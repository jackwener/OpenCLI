#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const srcClisDir = path.join(root, 'clis');
const skillPath = path.join(root, 'skills', 'opencli-skill', 'SKILL.md');

const IGNORE_BASENAMES = new Set(['utils', 'shared', 'test-utils', 'index']);
const IGNORE_SUFFIXES = ['.test'];
const IGNORE_PATTERNS = [/(^|-)utils?($|-)/, /(^|-)helpers?($|-)/, /(^|-)shared($|-)/];
const VALID_EXTS = new Set(['.ts', '.js', '.yaml', '.yml']);

function listPlatforms() {
  return fs.readdirSync(srcClisDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

function listCommands(platform) {
  const dir = path.join(srcClisDir, platform);
  const names = new Set();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name);
    if (!VALID_EXTS.has(ext)) continue;
    const base = path.basename(e.name, ext);
    if (IGNORE_BASENAMES.has(base)) continue;
    if (IGNORE_SUFFIXES.some((s) => base.endsWith(s))) continue;
    if (IGNORE_PATTERNS.some((p) => p.test(base))) continue;
    names.add(base);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function replaceOrInsertAutoBlock(text, startTag, endTag, blockBody) {
  const block = `${startTag}\n${blockBody}\n${endTag}`;
  if (text.includes(startTag) && text.includes(endTag)) {
    const re = new RegExp(`${startTag}[\\s\\S]*?${endTag}`, 'm');
    return text.replace(re, block);
  }
  return `${text.trimEnd()}\n\n${block}\n`;
}

function updateDescription(text, description) {
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) throw new Error('SKILL.md missing frontmatter');
  const full = fm[0];
  const body = fm[1];
  let nextBody;
  if (/^description:\s*/m.test(body)) {
    nextBody = body.replace(/^description:\s*.*$/m, `description: '${description.replace(/'/g, "''")}'`);
  } else {
    nextBody = `${body}\ndescription: '${description.replace(/'/g, "''")}'`;
  }
  return text.replace(full, `---\n${nextBody}\n---\n`);
}

const platforms = listPlatforms();
const platformData = platforms.map((p) => ({ platform: p, commands: listCommands(p) }));
const totalPlatforms = platformData.length;
const totalCommands = platformData.reduce((s, p) => s + p.commands.length, 0);

const allPlatforms = platformData
  .slice()
  .map((p) => p.platform)
  .sort((a, b) => a.localeCompare(b))
  .join(', ');

const description = `Cross-platform web automation skill for search, retrieval, posting, interaction, and downloads. Supports platforms: ${allPlatforms}.`;

let skill = fs.readFileSync(skillPath, 'utf8');
skill = updateDescription(skill, description);

const lines = [];
lines.push(`- Total: **${totalPlatforms} platforms**, **${totalCommands} commands**`);
lines.push('');
for (const p of platformData) {
  const preview = p.commands.slice(0, 8).join(', ');
  const more = p.commands.length > 8 ? `, ... (+${p.commands.length - 8})` : '';
  lines.push(`- **${p.platform}** (${p.commands.length}): ${preview}${more}`);
}
lines.push('');
lines.push(`_Coverage derived from source adapters._`);

skill = replaceOrInsertAutoBlock(
  skill,
  '<!-- SUPPORTED_PLATFORMS:START -->',
  '<!-- SUPPORTED_PLATFORMS:END -->',
  lines.join('\n')
);

fs.writeFileSync(skillPath, skill);
console.log(`Updated ${path.relative(root, skillPath)} with ${totalPlatforms} platforms / ${totalCommands} commands.`);
