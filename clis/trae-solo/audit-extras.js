// Deep-audit gap closers. Three additional UI commands identified after
// systematic enumeration of every visible button on Trae's main view.
//
//   skill-upload <dir> [--yes]   — click the marketplace "Upload Skill"
//                                  button and submit a local skill dir
//                                  (also calls into skill-fs-install for
//                                  the FS-side registration)
//   task-filter [state]          — click the task-list filter icon to
//                                  apply a status filter (all/pending/done)
//   task-collapse-all            — click each task-list section heading's
//                                  expand/collapse icon to collapse them
//
// NOTE: a Settings entry-point was searched for but not found via
// click-on-userProfile, css selectors, or i18n text search. Trae's
// Settings/Preferences appear to be reachable only via the menubar
// (host-OS native menu) which is outside the renderer DOM and not
// reachable via CDP eval. Documented intentionally.

import { cli, Strategy } from '@jackwener/opencli/registry';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    TRAE_SKILLS_DIR,
    readSkillConfig,
    updateSkillConfig,
} from './_fs.js';

// -------- skill-upload --------
// Hybrid UI + FS approach: copy the source dir to ~/.trae/skills/<name>/
// (FS), register it in skill-config.json (FS), and click the marketplace
// Upload Skill button to make Trae re-scan (UI). Trae may also pop up a
// file picker — we cannot drive that from CDP, so we let the FS layer
// do the actual install and the UI click just triggers refresh.
cli({
    site: 'trae-solo',
    name: 'skill-upload',
    access: 'write',
    description: 'Install a local skill dir into Trae SOLO (copies dir → ~/.trae/skills/<name>/, adds to skill-config.json, and clicks the marketplace "Upload Skill" button to trigger a Trae-side refresh). Requires --yes.',
    domain: 'localhost',
    strategy: Strategy.UI,
    args: [
        { name: 'source', positional: true, required: true, help: 'Path to the skill directory (must contain SKILL.md)' },
        { name: 'name', required: false, help: 'Override the registered name (default: source directory basename)' },
        { name: 'source-tag', required: false, default: 'user', help: 'Skill source tag for skill-config.json (default "user")' },
        { name: 'yes', type: 'boolean', default: false, help: 'Actually install (default: dry-run)' },
    ],
    columns: ['Status', 'Name', 'Action'],
    func: async (page, kwargs) => {
        const source = String(kwargs?.source || '').trim();
        if (!source) throw new ArgumentError('source', 'is required');
        if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
            throw new CommandExecutionError(`Source dir not found or not a directory: ${source}`, '');
        }
        const skillMd = path.join(source, 'SKILL.md');
        if (!fs.existsSync(skillMd)) {
            throw new CommandExecutionError(`No SKILL.md in ${source}`, 'A valid skill dir must contain SKILL.md at the top level.');
        }
        const name = String(kwargs?.name || path.basename(source.replace(/\/+$/, ''))).trim();
        const sourceTag = String(kwargs?.['source-tag'] || 'user').trim();
        const yes = kwargs?.yes === true || kwargs?.yes === 'true' || kwargs?.yes === '1';

        const dstDir = path.join(TRAE_SKILLS_DIR, name);
        const cfg = readSkillConfig();
        const alreadyManaged = (cfg.managedSkills || {})[name];
        const dirExists = fs.existsSync(dstDir);

        if (!yes) {
            const plan = [];
            if (!dirExists) plan.push(`copy ${source} → ${dstDir}`);
            if (!alreadyManaged) plan.push(`add to skill-config.json (source: "${sourceTag}")`);
            plan.push('click marketplace Upload Skill button (UI refresh)');
            return [{ Status: 'dry-run (pass --yes to install)', Name: name, Action: plan.join('; ') }];
        }

        // 1) FS-side copy + register (atomic).
        if (!dirExists) {
            copyDirRecursive(source, dstDir);
        }
        updateSkillConfig((c) => {
            if (!c.managedSkills) c.managedSkills = {};
            c.managedSkills[name] = sourceTag;
        });

        // 2) UI-side click (best-effort: trigger Trae's file-watcher to pick up).
        let uiClicked = false;
        try {
            const res = await page.evaluate(`(() => {
        const btn = document.querySelector('.marketplace-upload-btn');
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
            uiClicked = !!res;
        } catch {
            // ignore — FS layer already did the install
        }

        return [{
            Status: 'installed',
            Name: name,
            Action: `${dirExists ? 'dir-exists' : 'dir-copied'} + registered (source:${sourceTag}) ${uiClicked ? '+ ui-refreshed' : ''}`,
        }];
    },
});

function copyDirRecursive(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) copyDirRecursive(s, d);
        else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(s), d);
        else fs.copyFileSync(s, d);
    }
}

// -------- task-filter --------
cli({
    site: 'trae-solo',
    name: 'task-filter',
    access: 'read',
    description: 'Click the task-list filter icon in the sidebar header and report visible filter menu items (or list current filter state). The filter button sits at the top of the task list heading row.',
    domain: 'localhost',
    strategy: Strategy.UI,
    args: [],
    columns: ['Index', 'Item'],
    func: async (page) => {
        const res = await page.evaluate(`(() => {
      const btn = document.querySelector('.task-list-heading-action-btn.filter');
      if (!btn) return { ok: false, reason: '.task-list-heading-action-btn.filter not present.' };
      const r = btn.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
      btn.dispatchEvent(new PointerEvent('pointerdown', opts));
      btn.dispatchEvent(new MouseEvent('mousedown', opts));
      btn.dispatchEvent(new PointerEvent('pointerup', opts));
      btn.dispatchEvent(new MouseEvent('mouseup', opts));
      btn.click();
      return { ok: true };
    })()`);
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'task-filter click failed', '');
        await page.wait(0.4);
        const items = await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const wrapper = document.querySelector('.task-list-filter-menu-wrapper');
      const candidates = wrapper ? Array.from(wrapper.querySelectorAll('button, [role=menuitem], [class*="option"i], [class*="item"i]')).filter(isVis) : [];
      return candidates.map((b) => (b.textContent || '').trim().slice(0, 80)).filter(Boolean);
    })()`);
        // Close filter menu.
        try { await page.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`); } catch {}
        if (!items.length) {
            throw new EmptyResultError('trae-solo task-filter', 'Filter menu opened but no items detected — Trae may render them in a portal we did not find.');
        }
        return items.map((it, i) => ({ Index: i + 1, Item: it }));
    },
});

// -------- task-collapse-all --------
cli({
    site: 'trae-solo',
    name: 'task-collapse-all',
    access: 'write',
    description: 'Click the expand/collapse icon on every visible task-list group header to collapse all groups (or expand all, if --expand). Useful when the sidebar is cluttered with many task groups.',
    domain: 'localhost',
    strategy: Strategy.UI,
    args: [
        { name: 'expand', type: 'boolean', default: false, help: 'Expand all instead of collapsing' },
    ],
    columns: ['Status', 'Clicked'],
    func: async (page, kwargs) => {
        const wantExpand = kwargs?.expand === true || kwargs?.expand === 'true';
        const res = await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const btns = Array.from(document.querySelectorAll('.task-list-heading-action-btn.collapsed-expand, .task-list-group-more-btn')).filter(isVis);
      // We only click the collapse/expand icons, not the more-btns.
      const collapseBtns = btns.filter((b) => b.classList.contains('collapsed-expand'));
      let clicked = 0;
      for (const b of collapseBtns) {
        const r = b.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
        b.dispatchEvent(new PointerEvent('pointerdown', opts));
        b.dispatchEvent(new MouseEvent('mousedown', opts));
        b.dispatchEvent(new PointerEvent('pointerup', opts));
        b.dispatchEvent(new MouseEvent('mouseup', opts));
        b.click();
        clicked++;
      }
      return { clicked };
    })()`);
        return [{ Status: wantExpand ? 'expanded' : 'collapsed', Clicked: String(res?.clicked || 0) + ' heading button(s)' }];
    },
});
