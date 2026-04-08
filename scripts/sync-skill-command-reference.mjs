#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const srcClisDir = path.join(root, 'clis');
const skillCommandsDir = path.join(root, 'skills', 'opencli-skill', 'references', 'commands');

const IGNORE_BASENAMES = new Set(['utils', 'shared', 'test-utils', 'index']);
const IGNORE_SUFFIXES = ['.test'];
const IGNORE_PATTERNS = [/(^|-)utils?($|-)/, /(^|-)helpers?($|-)/, /(^|-)shared($|-)/];
const VALID_EXTS = new Set(['.ts', '.js', '.yaml', '.yml']);

function normalizeNewlines(s) { return s.replace(/\r\n/g, '\n'); }
function normalizeSpacing(s) {
  const lines = normalizeNewlines(s).split('\n');
  const out = [];
  let blank = 0;
  for (const line of lines) {
    if (!line.trim()) {
      blank += 1;
      if (blank <= 1) out.push('');
    } else {
      blank = 0;
      out.push(line.replace(/[ \t]+$/g, ''));
    }
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

function listPlatforms() {
  return fs.readdirSync(srcClisDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

function listCommandFiles(platform) {
  const dir = path.join(srcClisDir, platform);
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => ({ name: e.name, ext: path.extname(e.name), base: path.basename(e.name, path.extname(e.name)), full: path.join(dir, e.name) }))
    .filter((f) => VALID_EXTS.has(f.ext))
    .filter((f) => !IGNORE_BASENAMES.has(f.base))
    .filter((f) => !IGNORE_SUFFIXES.some((s) => f.base.endsWith(s)))
    .filter((f) => !IGNORE_PATTERNS.some((p) => p.test(f.base)))
    .sort((a, b) => a.base.localeCompare(b.base));
}

function parseDocSections(content) {
  const map = new Map();
  const regex = /^###\s+([^\n]+)\n([\s\S]*?)(?=\n###\s+|$)/gm;
  let m;
  while ((m = regex.exec(content)) !== null) {
    map.set(m[1].trim(), m[2].replace(/^\n+/, '').replace(/\n+$/, ''));
  }
  return map;
}

function matchQuoted(text, re) {
  const m = text.match(re);
  return m?.[2]?.trim();
}

function parseTsMeta(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const description = matchQuoted(src, /\bdescription\s*:\s*(["'`])([\s\S]*?)\1/);

  const args = [];
  const argsBlock = src.match(/\bargs\s*:\s*\[([\s\S]*?)\]\s*,\s*(?:columns|func)\s*:/);
  if (argsBlock) {
    const rowRegex = /\{([\s\S]*?)\}/g;
    let row;
    while ((row = rowRegex.exec(argsBlock[1])) !== null) {
      const body = row[1];
      const name = matchQuoted(body, /\bname\s*:\s*(["'`])([\s\S]*?)\1/);
      if (!name) continue;
      const required = /\brequired\s*:\s*true\b/.test(body);
      const positional = /\bpositional\s*:\s*true\b/.test(body);
      const type = matchQuoted(body, /\btype\s*:\s*(["'`])([\s\S]*?)\1/);
      const def = body.match(/\bdefault\s*:\s*([^,\n}]+)/)?.[1]?.trim();
      const help = matchQuoted(body, /\bhelp\s*:\s*(["'`])([\s\S]*?)\1/);
      args.push({ name, required, positional, type, defaultValue: def, help });
    }
  }

  return { description, args };
}

function parseYamlMeta(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const description = src.match(/^description:\s*(.+)$/m)?.[1]?.trim()?.replace(/^['"]|['"]$/g, '');

  const args = [];
  const lines = src.split(/\r?\n/);
  let inArgs = false;
  let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ');
    if (!inArgs) {
      if (/^args:\s*$/.test(line)) inArgs = true;
      continue;
    }
    if (/^[A-Za-z_][\w-]*:\s*/.test(line)) break;
    const itemStart = line.match(/^\s*-\s+name:\s*(.+)\s*$/);
    if (itemStart) {
      if (cur?.name) args.push(cur);
      cur = { name: itemStart[1].trim().replace(/^['"]|['"]$/g, ''), required: false, positional: false };
      continue;
    }
    if (!cur) continue;
    const kv = line.match(/^\s+([\w-]+):\s*(.+)\s*$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim();
    if (key === 'required') cur.required = /^true$/i.test(val);
    else if (key === 'positional') cur.positional = /^true$/i.test(val);
    else if (key === 'type') cur.type = val.replace(/^['"]|['"]$/g, '');
    else if (key === 'default') cur.defaultValue = val;
    else if (key === 'help') cur.help = val.replace(/^['"]|['"]$/g, '');
  }
  if (cur?.name) args.push(cur);

  return { description, args };
}

function parseCommandMeta(file) {
  try {
    if (file.ext === '.yaml' || file.ext === '.yml') return parseYamlMeta(file.full);
    if (file.ext === '.ts' || file.ext === '.js') return parseTsMeta(file.full);
  } catch {}
  return { description: undefined, args: [] };
}

function renderArgs(args) {
  if (!args.length) return '- Args: None';
  return ['- Args:', ...args.map((a) => {
    const tags = [a.required ? 'required' : 'optional'];
    if (a.type) tags.push(`type: ${a.type}`);
    if (a.defaultValue !== undefined) tags.push(`default: ${a.defaultValue}`);
    const suffix = a.help ? `; ${a.help}` : '';
    return `  - \`${a.name}\`(${tags.join('; ')})${suffix}`;
  })].join('\n');
}

function existingIsTodo(body) {
  if (!body) return true;
  return /^- Purpose:\s*(TODO|.+ operation)\b/m.test(body);
}

function buildSection(platform, cmd, existingBody, meta) {
  const purpose = meta.description || `${platform} ${cmd} operation`;
  const usage = `- Usage: \`opencli ${platform} ${cmd} [options] -f json\``;
  const argsBlock = renderArgs(meta.args);

  if (existingBody && existingBody.trim() && !existingIsTodo(existingBody)) {
    const body = existingBody.trim();
    const lines = body.split('\n');
    const hasPurpose = lines.some((l) => l.startsWith('- Purpose:'));
    const hasArgs = lines.some((l) => l.startsWith('- Args:'));
    const hasUsage = lines.some((l) => l.startsWith('- Usage:'));

    const out = [...lines];
    if (!hasPurpose) out.unshift(`- Purpose: ${purpose}`);
    if (!hasArgs) out.push(argsBlock);
    if (!hasUsage) out.push(usage);
    return `### ${cmd}\n${out.join('\n').trim()}\n`;
  }

  return `### ${cmd}\n- Purpose: ${purpose}\n${argsBlock}\n${usage}\n`;
}

function buildDoc(platform, files, oldContent) {
  const existing = oldContent ? parseDocSections(oldContent) : new Map();
  const parts = [`# ${platform}`, '', '## Commands', ''];

  for (const file of files) {
    const meta = parseCommandMeta(file);
    parts.push(buildSection(platform, file.base, existing.get(file.base), meta).trimEnd());
    parts.push('');
  }

  return normalizeSpacing(parts.join('\n'));
}

fs.mkdirSync(skillCommandsDir, { recursive: true });
const updated = [];

for (const platform of listPlatforms()) {
  const files = listCommandFiles(platform);
  const docPath = path.join(skillCommandsDir, `${platform}.md`);
  const oldContent = fs.existsSync(docPath) ? normalizeNewlines(fs.readFileSync(docPath, 'utf8')) : '';
  const next = buildDoc(platform, files, oldContent);
  if (normalizeSpacing(oldContent || '') !== next) {
    fs.writeFileSync(docPath, next, 'utf8');
    updated.push(path.relative(root, docPath));
  }
}

if (updated.length) {
  console.log(`Updated ${updated.length} command reference files:`);
  for (const f of updated) console.log(`- ${f}`);
} else {
  console.log('Command references already in sync.');
}
