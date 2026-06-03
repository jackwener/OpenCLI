// File-system access helpers for Trae SOLO local state.
//
// TRAE SOLO stores its conversation / skill / task state on disk under:
//   - ~/.trae/                           — user-scope (skills, extensions, rules)
//   - ~/Library/Application Support/TRAE SOLO/ModularData/ai-agent/
//                                        — per-task storage (snapshots, configs)
// All file accesses here are local-only and read-only by default. Write
// helpers (used by skill-fs-install / task-fs-delete / etc.) require the
// caller's explicit --yes flag, mirroring the safety pattern used by the
// other adapters (grok delete, antigravity delete, etc.).

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CommandExecutionError } from '@jackwener/opencli/errors';

export const TRAE_USER_DIR = path.join(os.homedir(), '.trae');
export const TRAE_SKILLS_DIR = path.join(TRAE_USER_DIR, 'skills');
export const TRAE_SKILL_CONFIG = path.join(TRAE_USER_DIR, 'skill-config.json');
export const TRAE_USER_RULES = path.join(TRAE_USER_DIR, 'user_rules.md');

export const TRAE_APP_SUPPORT = path.join(
    os.homedir(),
    'Library/Application Support/TRAE SOLO',
);
export const TRAE_AI_AGENT_DIR = path.join(
    TRAE_APP_SUPPORT,
    'ModularData/ai-agent',
);
export const TRAE_SNAPSHOT_DIR = path.join(TRAE_AI_AGENT_DIR, 'snapshot');
export const TRAE_AGENTCONFIG_DIR = path.join(TRAE_AI_AGENT_DIR, 'agentconfig');
export const TRAE_WORK_MODE_PROJECTS = path.join(
    TRAE_AI_AGENT_DIR,
    'work-mode-projects',
);
export const TRAE_DB_WAL = path.join(TRAE_AI_AGENT_DIR, 'database.db-wal');

// Quick existence + readable check.
export function assertReadable(p, label) {
    if (!fs.existsSync(p)) {
        throw new CommandExecutionError(
            `${label} not found: ${p}`,
            'Is Trae SOLO installed and run at least once?',
        );
    }
}

// Parse a Markdown SKILL.md and return its YAML-style front-matter as a
// plain object, plus a one-line description (first non-frontmatter
// non-heading paragraph). Handles missing/malformed front-matter
// gracefully — returns whatever it can.
export function parseSkillMd(skillDir) {
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
        return { name: path.basename(skillDir), description: '', tags: [] };
    }
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const fm = {};
    let body = content;
    if (content.startsWith('---\n')) {
        const end = content.indexOf('\n---\n', 4);
        if (end > 0) {
            const fmText = content.slice(4, end);
            for (const line of fmText.split('\n')) {
                const m = line.match(/^([\w_-]+):\s*(.*)$/);
                if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
            }
            body = content.slice(end + 5);
        }
    }
    // First non-empty, non-heading line of body = description fallback.
    if (!fm.description) {
        for (const line of body.split('\n')) {
            const t = line.trim();
            if (!t) continue;
            if (t.startsWith('#')) continue;
            fm.description = t.slice(0, 200);
            break;
        }
    }
    return {
        name: fm.name || path.basename(skillDir),
        description: fm.description || '',
        tags: fm.tags ? fm.tags.split(/\s+/) : [],
        version: fm.version || '',
        author: fm.author || '',
        path: skillDir,
    };
}

// Load skill-config.json (Trae's installed-skills registry).
export function readSkillConfig() {
    assertReadable(TRAE_SKILL_CONFIG, 'skill-config.json');
    return JSON.parse(fs.readFileSync(TRAE_SKILL_CONFIG, 'utf-8'));
}

// Atomically update skill-config.json — read, mutate via callback, write
// via tmp + rename to avoid Trae seeing a half-written file.
export function updateSkillConfig(mutate) {
    const conf = readSkillConfig();
    mutate(conf);
    const tmp = TRAE_SKILL_CONFIG + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(conf, null, 4));
    fs.renameSync(tmp, TRAE_SKILL_CONFIG);
}

// Refuse to mutate ai-agent on-disk state if database.db-wal was touched
// in the last `windowSec` seconds — Trae is probably writing.
export function checkAgentDbQuiet(windowSec = 5) {
    if (!fs.existsSync(TRAE_DB_WAL)) return; // first run
    const ageMs = Date.now() - fs.statSync(TRAE_DB_WAL).mtimeMs;
    if (ageMs < windowSec * 1000) {
        throw new CommandExecutionError(
            `Trae is actively writing (database.db-wal touched ${(ageMs / 1000).toFixed(1)}s ago).`,
            `Wait ${windowSec}+ s for Trae to settle, or quit Trae SOLO before mutating state.`,
        );
    }
}
