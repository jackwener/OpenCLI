import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { askCommand } from './ask.js';
import { extractDiffCommand } from './extract-diff.js';
import { historyCommand } from './history.js';
import { projectsCommand } from './projects.js';
import {
    collectCodexProjectsFromDocument,
    flattenCodexProjects,
    openCodexConversation,
    selectCodexConversationInDocument,
} from './sidebar.js';
import {
    findActiveCodexConversation,
    findCodexConversation,
    resolveActionConversation,
} from './_actions.js';
import {
    findUniqueModelOption,
    modelSelectionVerified,
} from './model.js';
import { findCodexComposerElement, findUniquePickerOption, sendCommand } from './send.js';

class FakeElement {
    constructor(tagName = 'div', attrs = {}, children = [], text = '') {
        this.tagName = tagName.toUpperCase();
        this.attrs = attrs;
        this.children = children;
        this.parentElement = null;
        this.textContent = text;
        this.innerText = text;
        this.className = attrs.class || '';
        this.listeners = new Map();
        for (const child of children) {
            child.parentElement = this;
        }
    }

    getAttribute(name) {
        return this.attrs[name] ?? null;
    }

    addEventListener(name, fn) {
        const listeners = this.listeners.get(name) || [];
        listeners.push(fn);
        this.listeners.set(name, listeners);
    }

    click() {
        for (const listener of this.listeners.get('click') || []) {
            listener();
        }
    }

    scrollIntoView() {
    }

    closest(selector) {
        let current = this;
        while (current) {
            if (matchesSelector(current, selector))
                return current;
            current = current.parentElement;
        }
        return null;
    }

    querySelectorAll(selector) {
        const selectors = selector.split(',').map(part => part.trim());
        const results = [];
        const visit = (node) => {
            if (selectors.some(part => matchesSelector(node, part))) {
                results.push(node);
            }
            for (const child of node.children) {
                visit(child);
            }
        };
        for (const child of this.children) {
            visit(child);
        }
        return results;
    }
}

function matchesSelector(node, selector) {
    if (selector === '[data-app-action-sidebar-project-row]') {
        return node.getAttribute('data-app-action-sidebar-project-row') !== null;
    }
    if (selector === '[data-app-action-sidebar-thread-row]') {
        return node.getAttribute('data-app-action-sidebar-thread-row') !== null;
    }
    if (selector === '[role="listitem"][aria-label]') {
        return node.getAttribute('role') === 'listitem' && node.getAttribute('aria-label') !== null;
    }
    if (selector === '.tabular-nums') {
        return String(node.className || '').split(/\s+/).includes('tabular-nums');
    }
    if (selector === '[class*="tabular-nums"]') {
        return String(node.className || '').includes('tabular-nums');
    }
    if (selector === '[class*="description"]') {
        return String(node.className || '').includes('description');
    }
    return false;
}

function el(tagName, attrs, children = [], text = '') {
    return new FakeElement(tagName, attrs, children, text);
}

function thread(attrs, title, updated) {
    return el('div', {
        role: 'button',
        'data-app-action-sidebar-thread-row': '',
        'data-app-action-sidebar-thread-title': title,
        'data-app-action-sidebar-thread-id': attrs.threadId,
        'data-app-action-sidebar-thread-host-id': attrs.hostId || '',
        'data-app-action-sidebar-thread-kind': attrs.kind || '',
        'data-app-action-sidebar-thread-active': attrs.active ? 'true' : 'false',
        'data-app-action-sidebar-thread-pinned': attrs.pinned ? 'true' : 'false',
    }, [
        el('span', { 'data-thread-title': '' }, [], title),
        el('span', { class: 'tabular-nums' }, [], updated),
    ], `${title} ${updated}`);
}

function project(label, projectPath, children) {
    return el('div', { role: 'listitem', 'aria-label': label }, [
        el('div', {
            role: 'button',
            'aria-expanded': 'true',
            'data-app-action-sidebar-project-row': '',
            'data-app-action-sidebar-project-label': label,
            'data-app-action-sidebar-project-id': projectPath,
        }, [], label),
        ...children,
    ]);
}

function fixtureDocument() {
    return el('document', {}, [
        project('stock', '/Users/youngcan/stock', [
            thread({ threadId: 'local:stock-sync', hostId: 'local', kind: 'local', active: true }, '同步各仓库最新代码', '4 小时'),
            thread({ threadId: 'local:trading-agents' }, '借鉴 TradingAgents', '2 小时'),
        ]),
        project('opencli', '/Users/youngcan/opencli', [
            thread({ threadId: 'local:opencli-groups' }, '统一 opencli 二级命令分组', '1 天'),
        ]),
    ]);
}

describe('codex sidebar helpers', () => {
    it('collects projects and visible conversations from Codex data attributes', () => {
        const projects = collectCodexProjectsFromDocument(fixtureDocument());

        expect(projects).toHaveLength(2);
        expect(projects[0]).toMatchObject({
            project: 'stock',
            projectPath: '/Users/youngcan/stock',
            collapsed: false,
        });
        expect(projects[0].conversations[0]).toMatchObject({
            index: 1,
            title: '同步各仓库最新代码',
            updated: '4 小时',
            active: true,
            threadId: 'local:stock-sync',
        });
    });

    it('flattens project rows with project filters', () => {
        const projects = collectCodexProjectsFromDocument(fixtureDocument());
        const rows = flattenCodexProjects(projects, { project: 'opencli' });

        expect(rows).toEqual([
            expect.objectContaining({
                Project: 'opencli',
                Index: 1,
                Title: '统一 opencli 二级命令分组',
                Updated: '1 天',
            }),
        ]);
    });

    it('rejects invalid project/history limits instead of silently ignoring them', () => {
        const projects = collectCodexProjectsFromDocument(fixtureDocument());

        expect(() => flattenCodexProjects(projects, { limit: '0' })).toThrowError(ArgumentError);
        expect(() => flattenCodexProjects(projects, { limit: '1.5' })).toThrowError(ArgumentError);
        expect(() => flattenCodexProjects(projects, { limit: 'abc' })).toThrowError(ArgumentError);
    });

    it('does not match nested project paths when filtering by a parent label', () => {
        const projects = collectCodexProjectsFromDocument(fixtureDocument());
        projects.push({
            index: 3,
            project: 'nested',
            projectPath: '/Users/youngcan/opencli/nested',
            collapsed: false,
            conversations: [
                { index: 1, title: 'Nested thread', updated: '', active: false, threadId: 'local:nested' },
            ],
        });

        const rows = flattenCodexProjects(projects, { project: 'opencli' });

        expect(rows.map(row => row.Project)).toEqual(['opencli']);
    });

    it('selects a conversation by project and title', () => {
        const doc = fixtureDocument();
        const selected = [];
        for (const row of doc.querySelectorAll('[data-app-action-sidebar-thread-row]')) {
            row.addEventListener('click', () => selected.push(row.getAttribute('data-app-action-sidebar-thread-id')));
        }

        const result = selectCodexConversationInDocument({
            project: 'stock',
            conversation: 'TradingAgents',
        }, doc);

        expect(result).toMatchObject({
            ok: true,
            selected: true,
            project: 'stock',
            conversation: '借鉴 TradingAgents',
            threadId: 'local:trading-agents',
            index: 2,
        });
        expect(selected).toEqual(['local:trading-agents']);
    });

    it('does not dispatch DOM click when native click is preferred', () => {
        const doc = fixtureDocument();
        const selected = [];
        for (const row of doc.querySelectorAll('[data-app-action-sidebar-thread-row]')) {
            row.addEventListener('click', () => selected.push(row.getAttribute('data-app-action-sidebar-thread-id')));
        }

        const result = selectCodexConversationInDocument({
            project: 'stock',
            conversation: 'TradingAgents',
            preferNativeClick: true,
        }, doc);

        expect(result).toMatchObject({
            ok: true,
            selected: true,
            threadId: 'local:trading-agents',
        });
        expect(selected).toEqual([]);
    });

    it('selects a conversation by index within a project', () => {
        const result = selectCodexConversationInDocument({
            project: '/Users/youngcan/opencli',
            index: '1',
        }, fixtureDocument());

        expect(result).toMatchObject({
            ok: true,
            project: 'opencli',
            conversation: '统一 opencli 二级命令分组',
            threadId: 'local:opencli-groups',
        });
    });

    it('finds a postcondition target by stable thread id', () => {
        const projects = collectCodexProjectsFromDocument(fixtureDocument());

        const result = findCodexConversation(projects, {
            threadId: 'local:trading-agents',
            project: 'wrong project',
            conversation: 'wrong title',
        });

        expect(result?.project.project).toBe('stock');
        expect(result?.conversation.title).toBe('借鉴 TradingAgents');
    });

    it('requires exactly one active conversation for active-chat write postconditions', () => {
        const projects = collectCodexProjectsFromDocument(fixtureDocument());
        expect(findActiveCodexConversation(projects)?.conversation.threadId).toBe('local:stock-sync');

        projects[1].conversations[0].active = true;
        expect(findActiveCodexConversation(projects)).toBeNull();
    });

    it('matches model options without allowing ambiguous substrings', () => {
        const labels = ['GPT-5.5', 'GPT-5.4', 'Medium', 'Extra High'];

        expect(findUniqueModelOption(labels, 'medium')).toBe('Medium');
        expect(findUniqueModelOption(labels, '5.5')).toBe('GPT-5.5');
        expect(() => findUniqueModelOption(labels, '5')).toThrowError(CommandExecutionError);
    });

    it('verifies model switch postconditions against the visible selector text', () => {
        expect(modelSelectionVerified('5.5 Extra High', 'GPT-5.5')).toBe(true);
        expect(modelSelectionVerified('5.5 Medium', 'Medium')).toBe(true);
        expect(modelSelectionVerified('5 High', 'GPT-5')).toBe(true);
        expect(modelSelectionVerified('5.5 Extra High', 'Medium')).toBe(false);
        expect(modelSelectionVerified('5.5 Extra High', 'High')).toBe(false);
        expect(modelSelectionVerified('5.5 Medium', 'GPT-5')).toBe(false);
    });

    it('requires a stable thread id for write action postconditions', async () => {
        const doc = fixtureDocument();
        const row = doc.querySelectorAll('[data-app-action-sidebar-thread-row]')[0];
        row.attrs['data-app-action-sidebar-thread-id'] = '';

        const page = {
            evaluate: async () => collectCodexProjectsFromDocument(doc),
        };

        await expect(resolveActionConversation(page, {})).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('reports exact thread-id misses as not found', () => {
        const result = selectCodexConversationInDocument({
            project: 'stock',
            threadId: 'local:missing',
        }, fixtureDocument());

        expect(result).toMatchObject({
            ok: false,
            error: 'Thread not found: local:missing',
        });
    });

    it('maps project/conversation misses to EmptyResultError in command selection', async () => {
        const page = {
            evaluate: async () => selectCodexConversationInDocument({ project: 'missing' }, fixtureDocument()),
        };

        await expect(openCodexConversation(page, { project: 'missing' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('maps missing sidebar DOM to CommandExecutionError instead of empty success', async () => {
        const page = {
            evaluate: async () => selectCodexConversationInDocument({ conversation: 'anything' }, el('document', {}, [])),
        };

        await expect(openCodexConversation(page, { conversation: 'anything' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps ambiguous conversation selection to ArgumentError', async () => {
        const duplicateDoc = el('document', {}, [
            project('alpha', '/tmp/alpha', [
                thread({ threadId: 'local:one' }, 'Shared title', '1 小时'),
            ]),
            project('beta', '/tmp/beta', [
                thread({ threadId: 'local:two' }, 'Shared title', '2 小时'),
            ]),
        ]);
        const page = {
            evaluate: async () => selectCodexConversationInDocument({ conversation: 'Shared title' }, duplicateDoc),
        };

        await expect(openCodexConversation(page, { conversation: 'Shared title' })).rejects.toBeInstanceOf(ArgumentError);
    });
});

describe('codex sidebar commands', () => {
    it('projects fails empty result instead of returning a sentinel row', async () => {
        const page = {
            evaluate: async () => [],
        };

        await expect(projectsCommand.func(page, {})).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('history fails empty result instead of returning a sentinel row', async () => {
        const page = {
            evaluate: async () => [],
        };

        await expect(historyCommand.func(page, {})).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('extract-diff fails empty result instead of returning a sentinel row', async () => {
        const page = {
            evaluate: async () => [],
        };

        await expect(extractDiffCommand.func(page)).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('extract-diff unwraps Browser Bridge envelopes before checking empty results', async () => {
        const page = {
            evaluate: async () => ({ session: 'codex', data: [] }),
        };

        await expect(extractDiffCommand.func(page)).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('ask rejects invalid timeout instead of falling back to the default', async () => {
        const page = {
            evaluate: async () => 0,
        };

        await expect(askCommand.func(page, { text: 'hello', timeout: 'bogus' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(askCommand.func(page, { text: 'hello', timeout: '0' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(askCommand.func(page, { text: 'hello', timeout: '1.5' })).rejects.toBeInstanceOf(ArgumentError);
    });
});

describe('codex send picker', () => {
    it('matches picker options without allowing ambiguous substrings', () => {
        const options = [
            { title: 'Review Agent', text: 'Review AgentFind actionable bugs in code changes' },
            { title: 'Explore Agent', text: 'Explore AgentAnswer questions about the codebase' },
            { title: 'Agent Builder', text: 'Agent BuilderBuild a custom agent skill' },
        ];

        expect(findUniquePickerOption(options, 'review agent')).toMatchObject({ title: 'Review Agent', index: 0 });
        expect(findUniquePickerOption(options, 'actionable bugs')).toMatchObject({ title: 'Review Agent', index: 0 });
        expect(findUniquePickerOption(options, 'missing option')).toBeNull();
        expect(() => findUniquePickerOption(options, 'agent')).toThrowError(CommandExecutionError);
        expect(() => findUniquePickerOption(options, '')).toThrowError(ArgumentError);
    });

    it('send presses Enter again when the picker resolved the slash command to a chip', async () => {
        const chipState = { text: '$review-agent', nonChipText: '', chips: [{ name: 'review-agent', display: 'Review Agent' }] };
        const clearedState = { text: '', nonChipText: '', chips: [] };
        let injectionDone = false;
        let enters = 0;
        const pressed = [];
        const page = {
            evaluate: async () => {
                if (!injectionDone) {
                    injectionDone = true;
                    return true;
                }
                return enters >= 2 ? clearedState : chipState;
            },
            wait: async () => {},
            pressKey: async (key) => {
                pressed.push(key);
                enters += 1;
            },
        };

        const rows = await sendCommand.func(page, { text: '/review' });

        expect(rows).toEqual([expect.objectContaining({ Status: 'Success', InjectedText: '/review' })]);
        expect(pressed).toEqual(['Enter', 'Enter']);
    });

    it('send throws instead of submitting when the composer was rewritten to something else', async () => {
        const mismatch = { text: '$deep-dive', nonChipText: '', chips: [{ name: 'deep-dive', display: 'Deep Dive' }] };
        let injectionDone = false;
        const pressed = [];
        const page = {
            evaluate: async () => {
                if (!injectionDone) {
                    injectionDone = true;
                    return true;
                }
                return mismatch;
            },
            wait: async () => {},
            pressKey: async (key) => { pressed.push(key); },
        };

        await expect(sendCommand.func(page, { text: '/review' })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(pressed).toEqual(['Enter']);
    });

    it('send retries once when the keypress did not register and then fails typed', async () => {
        const stuck = { text: '/review', nonChipText: '/review', chips: [] };
        let injectionDone = false;
        const pressed = [];
        const page = {
            evaluate: async () => {
                if (!injectionDone) {
                    injectionDone = true;
                    return true;
                }
                return stuck;
            },
            wait: async () => {},
            pressKey: async (key) => { pressed.push(key); },
        };

        await expect(sendCommand.func(page, { text: '/review' })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(pressed).toEqual(['Enter', 'Enter']);
    });

    it('send fails typed when the composer selector cannot be verified', async () => {
        let injectionDone = false;
        const page = {
            evaluate: async () => {
                if (!injectionDone) {
                    injectionDone = true;
                    return true;
                }
                return null;
            },
            wait: async () => {},
            pressKey: async () => {},
        };

        await expect(sendCommand.func(page, { text: 'hello' })).rejects.toMatchObject({ code: 'SELECTOR' });
    });

    it('send unwraps Browser Bridge envelopes before trusting injection success', async () => {
        const pressed = [];
        const page = {
            evaluate: async () => ({ session: 'codex', data: false }),
            wait: async () => {},
            pressKey: async (key) => { pressed.push(key); },
        };

        await expect(sendCommand.func(page, { text: 'hello' })).rejects.toMatchObject({ code: 'SELECTOR' });
        expect(pressed).toEqual([]);
    });

    it('send submits plain text with a single Enter when no picker appears', async () => {
        const cleared = { text: '', nonChipText: '', chips: [] };
        const calls = [];
        let injectionDone = false;
        const pressed = [];
        const page = {
            evaluate: async () => {
                calls.push('evaluate');
                if (!injectionDone) {
                    injectionDone = true;
                    return true;
                }
                return cleared;
            },
            wait: async () => {},
            pressKey: async (key) => { pressed.push(key); },
        };

        const rows = await sendCommand.func(page, { text: 'hello' });

        expect(rows).toEqual([expect.objectContaining({ Status: 'Success', InjectedText: 'hello' })]);
        expect(pressed).toEqual(['Enter']);
        expect(calls).toHaveLength(2);
    });

    it('send anchors injection and post-submit verification to the same composer element', async () => {
        const scripts = [];
        let injectionDone = false;
        const page = {
            evaluate: async (script) => {
                scripts.push(String(script));
                if (!injectionDone) {
                    injectionDone = true;
                    return true;
                }
                return { text: '', nonChipText: '', chips: [] };
            },
            wait: async () => {},
            pressKey: async () => {},
        };

        await sendCommand.func(page, { text: 'hello' });

        expect(scripts).toHaveLength(2);
        for (const script of scripts) {
            expect(script).toContain(findCodexComposerElement.toString());
        }
    });

    it('send clicks the matched picker item and verifies the chip before submitting', async () => {
        const responses = [
            true, // inject text
            [{ title: 'Review Agent', text: 'Review AgentFind actionable bugs in code changes' }], // picker options
            true, // click dispatched
            { text: '$review-agent', nonChipText: '', chips: [{ name: 'review-agent', display: 'Review Agent' }] }, // chip landed
            false, // picker closed
            { text: '', nonChipText: '', chips: [] }, // composer cleared after Enter
        ];
        const pressed = [];
        const page = {
            evaluate: async () => responses.shift(),
            wait: async () => {},
            pressKey: async (key) => { pressed.push(key); },
        };

        const rows = await sendCommand.func(page, { text: '/review', pick: 'Review Agent' });

        expect(rows).toEqual([expect.objectContaining({ Status: 'Success', InjectedText: '/review' })]);
        expect(pressed).toEqual(['Enter']);
        expect(responses).toHaveLength(0);
    });

    it('send retries Enter when the picked chip does not echo the slash token', async () => {
        const chipState = { text: '$agent-builder', nonChipText: '', chips: [{ name: 'agent-builder', display: 'Agent Builder' }] };
        const responses = [
            true, // inject text
            [{ title: 'Agent Builder', text: 'Agent BuilderBuild a custom agent skill' }], // picker options
            true, // click dispatched
            chipState, // chip landed
            false, // picker closed
            ...Array.from({ length: 6 }, () => chipState), // first Enter left the chip in place
            { text: '', nonChipText: '', chips: [] }, // composer cleared after the retry Enter
        ];
        const pressed = [];
        const page = {
            evaluate: async () => responses.shift(),
            wait: async () => {},
            pressKey: async (key) => { pressed.push(key); },
        };

        const rows = await sendCommand.func(page, { text: '/skills', pick: 'Agent Builder' });

        expect(rows).toEqual([expect.objectContaining({ Status: 'Success', InjectedText: '/skills' })]);
        expect(pressed).toEqual(['Enter', 'Enter']);
        expect(responses).toHaveLength(0);
    });

    it('send fails typed when the picker click did not insert the picked chip', async () => {
        const stuck = { text: '/review', nonChipText: '/review', chips: [] };
        const responses = [
            true, // inject text
            [{ title: 'Review Agent', text: 'Review AgentFind actionable bugs in code changes' }], // picker options
            true, // click dispatched
            ...Array.from({ length: 20 }, () => [stuck, false]).flat(), // chip never lands, picker closed
        ];
        const pressed = [];
        const page = {
            evaluate: async () => responses.shift(),
            wait: async () => {},
            pressKey: async (key) => { pressed.push(key); },
        };

        await expect(sendCommand.func(page, { text: '/review', pick: 'Review Agent' })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: 'Codex picker selection did not reach the composer.',
        });
        expect(pressed).toEqual([]);
        expect(responses).toHaveLength(0);
    });

    it('send surfaces picker candidates when --pick is ambiguous', async () => {
        const responses = [
            true, // inject text
            [
                { title: 'Review Agent', text: 'Review AgentFind actionable bugs in code changes' },
                { title: 'Explore Agent', text: 'Explore AgentAnswer questions about the codebase' },
            ], // picker options
        ];
        const pressed = [];
        const page = {
            evaluate: async () => responses.shift(),
            wait: async () => {},
            pressKey: async (key) => { pressed.push(key); },
        };

        await expect(sendCommand.func(page, { text: '/review', pick: 'agent' })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: 'Picker option "agent" is ambiguous.',
        });
        expect(pressed).toEqual([]);
        expect(responses).toHaveLength(0);
    });

    it('send rejects a --pick label that trims to empty', async () => {
        const page = {
            evaluate: async () => true,
            wait: async () => {},
            pressKey: async () => {},
        };

        await expect(sendCommand.func(page, { text: '/review', pick: '   ' })).rejects.toBeInstanceOf(ArgumentError);
    });
});
