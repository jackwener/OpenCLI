import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { ArgumentError } from './errors.js';
import { findPackageRoot } from './package-paths.js';

const MODULE_FILE = fileURLToPath(import.meta.url);

export interface OpenCliSkillInfo {
  name: string;
  description: string;
  version: string;
  path: string;
}

export interface OpenCliSkillReadResult {
  skill: string;
  path: string;
  content: string;
}

interface SkillFrontmatter {
  name?: unknown;
  description?: unknown;
  version?: unknown;
}

export function getSkillsRoot(packageRoot: string = findPackageRoot(MODULE_FILE)): string {
  return path.join(packageRoot, 'skills');
}

export function listOpenCliSkills(packageRoot?: string): OpenCliSkillInfo[] {
  const skillsRoot = getSkillsRoot(packageRoot);
  if (!fs.existsSync(skillsRoot)) return [];

  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('opencli-'))
    .map((entry) => readSkillInfo(skillsRoot, entry.name))
    .filter((entry): entry is OpenCliSkillInfo => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readOpenCliSkill(target: string, relpath = '', packageRoot?: string): OpenCliSkillReadResult {
  const { name, pathInSkill } = parseSkillTarget(target, relpath);
  if (!name.startsWith('opencli-')) {
    throw new ArgumentError(`Unknown OpenCLI skill: ${name}`, 'Run "opencli skills list" to see available OpenCLI skills.');
  }

  const skillsRoot = getSkillsRoot(packageRoot);
  const skillRoot = path.join(skillsRoot, name);
  if (!isDirectory(skillRoot) || !fs.existsSync(path.join(skillRoot, 'SKILL.md'))) {
    throw new ArgumentError(`Unknown OpenCLI skill: ${name}`, 'Run "opencli skills list" to see available OpenCLI skills.');
  }

  const relativePath = normalizeSkillPath(pathInSkill || 'SKILL.md');
  const absolutePath = path.resolve(skillRoot, relativePath);
  const relativeToRoot = path.relative(skillRoot, absolutePath);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new ArgumentError(`Invalid skill path: ${relativePath}`, 'Skill paths must stay inside the selected OpenCLI skill.');
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new ArgumentError(`Skill file not found: ${name}/${relativePath}`, 'Run "opencli skills list <skill>" is not supported yet; read SKILL.md or a known references/... file.');
  }

  return {
    skill: name,
    path: relativePath,
    content: fs.readFileSync(absolutePath, 'utf8'),
  };
}

function readSkillInfo(skillsRoot: string, name: string): OpenCliSkillInfo | null {
  const skillMdPath = path.join(skillsRoot, name, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) return null;
  const content = fs.readFileSync(skillMdPath, 'utf8');
  const fm = parseFrontmatter(content);
  return {
    name: typeof fm.name === 'string' && fm.name ? fm.name : name,
    description: typeof fm.description === 'string' ? fm.description : firstBodyParagraph(content),
    version: typeof fm.version === 'string' || typeof fm.version === 'number' ? String(fm.version) : '',
    path: `${name}/SKILL.md`,
  };
}

function parseSkillTarget(target: string, relpath: string): { name: string; pathInSkill: string } {
  const normalizedTarget = normalizeSkillPath(target);
  if (relpath) {
    return { name: normalizedTarget, pathInSkill: relpath };
  }
  const slash = normalizedTarget.indexOf('/');
  if (slash === -1) {
    return { name: normalizedTarget, pathInSkill: '' };
  }
  return {
    name: normalizedTarget.slice(0, slash),
    pathInSkill: normalizedTarget.slice(slash + 1),
  };
}

function normalizeSkillPath(raw: string): string {
  const normalized = raw.trim().replace(/\\/g, '/');
  if (!normalized || normalized.includes('\0')) {
    throw new ArgumentError('Skill path must be non-empty.');
  }
  if (normalized.startsWith('/') || normalized.split('/').some((part) => part === '..')) {
    throw new ArgumentError(`Invalid skill path: ${raw}`, 'Use a path relative to an OpenCLI skill directory.');
  }
  return path.posix.normalize(normalized);
}

function parseFrontmatter(content: string): SkillFrontmatter {
  if (!content.startsWith('---\n')) return {};
  const end = content.indexOf('\n---', 4);
  if (end < 0) return {};
  try {
    const parsed = yaml.load(content.slice(4, end));
    return parsed && typeof parsed === 'object' ? parsed as SkillFrontmatter : {};
  } catch {
    return parseLooseFrontmatter(content.slice(4, end));
  }
}

function parseLooseFrontmatter(raw: string): SkillFrontmatter {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (!['name', 'description', 'version'].includes(key)) continue;
    out[key] = value.trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function firstBodyParagraph(content: string): string {
  const body = content.startsWith('---\n')
    ? content.slice(Math.max(content.indexOf('\n---', 4) + 4, 0))
    : content;
  const paragraph = body
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s*/gm, '').trim())
    .find(Boolean);
  return paragraph ?? '';
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}
