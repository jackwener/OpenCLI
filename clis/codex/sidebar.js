import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeMatch(value) {
    return cleanText(value).toLowerCase();
}

function matchesProject(project, query) {
    if (!query)
        return true;
    const label = normalizeMatch(project.project);
    const projectPath = normalizeMatch(project.projectPath);
    const needle = normalizeMatch(query);
    if (!needle)
        return true;
    return label === needle
        || label.includes(needle)
        || projectPath === needle
        || projectPath.endsWith(`/${needle}`);
}

export function hasConversationTarget(kwargs) {
    return !!(kwargs?.project || kwargs?.conversation || kwargs?.index || kwargs?.['thread-id']);
}

export function parsePositiveIntegerOption(raw, label) {
    const value = cleanText(raw);
    if (!/^\d+$/.test(value)) {
        throw new ArgumentError(`${label} must be a positive integer`);
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new ArgumentError(`${label} must be a positive integer`);
    }
    return parsed;
}

export function parseOptionalPositiveIntegerOption(raw, label) {
    if (raw == null || cleanText(raw) === '') {
        return null;
    }
    return parsePositiveIntegerOption(raw, label);
}

export function requireNonEmptyOption(raw, label) {
    const value = cleanText(raw);
    if (!value) {
        throw new ArgumentError(`${label} cannot be empty`);
    }
    return value;
}

export function collectCodexProjectsFromDocument(doc = document) {
    const projectRowSelector = '[data-app-action-sidebar-project-row]';
    const threadRowSelector = '[data-app-action-sidebar-thread-row]';

    function visibleText(el) {
        return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function isRelativeTime(text) {
        return /^(?:(?:\d+\s*)?(?:刚刚|秒|分钟|小时|天|周|个月|年|sec|min|hr|hour|day|week|month|year|s|m|h|d|w)|.*\bago)$/i.test(text.trim());
    }

    function getUpdatedText(row, title) {
        const candidates = Array.from(row.querySelectorAll('.tabular-nums, [class*="tabular-nums"], [class*="description"]'))
            .map(visibleText)
            .filter(Boolean);
        const direct = candidates.find(isRelativeTime);
        if (direct)
            return direct;
        const fullText = visibleText(row);
        const suffix = fullText.replace(title, '').trim();
        return isRelativeTime(suffix) ? suffix : '';
    }

    return Array.from(doc.querySelectorAll(projectRowSelector)).map((projectRow, projectIndex) => {
        const label = projectRow.getAttribute('data-app-action-sidebar-project-label')
            || projectRow.getAttribute('aria-label')
            || visibleText(projectRow);
        const path = projectRow.getAttribute('data-app-action-sidebar-project-id') || '';
        const projectItem = projectRow.closest('[role="listitem"][aria-label]') || projectRow.parentElement;
        const threadRows = projectItem
            ? Array.from(projectItem.querySelectorAll(threadRowSelector))
            : [];
        const conversations = threadRows.map((row, index) => {
            const title = row.getAttribute('data-app-action-sidebar-thread-title') || visibleText(row);
            return {
                index: index + 1,
                title,
                updated: getUpdatedText(row, title),
                active: row.getAttribute('data-app-action-sidebar-thread-active') === 'true',
                pinned: row.getAttribute('data-app-action-sidebar-thread-pinned') === 'true',
                threadId: row.getAttribute('data-app-action-sidebar-thread-id') || '',
                hostId: row.getAttribute('data-app-action-sidebar-thread-host-id') || '',
                kind: row.getAttribute('data-app-action-sidebar-thread-kind') || '',
            };
        });

        return {
            index: projectIndex + 1,
            project: label,
            projectPath: path,
            collapsed: projectRow.getAttribute('data-app-action-sidebar-project-collapsed') === 'true'
                || projectRow.getAttribute('aria-expanded') === 'false',
            conversations,
        };
    });
}

export function selectCodexConversationInDocument(target, doc = document) {
    const projectRowSelector = '[data-app-action-sidebar-project-row]';
    const threadRowSelector = '[data-app-action-sidebar-thread-row]';

    function clean(value) {
        return String(value ?? '').replace(/\s+/g, ' ').trim();
    }

    function normalize(value) {
        return clean(value).toLowerCase();
    }

    function matches(value, query) {
        const haystack = normalize(value);
        const needle = normalize(query);
        return !!needle && (haystack === needle || haystack.includes(needle));
    }

    function projectLabel(row) {
        return row.getAttribute('data-app-action-sidebar-project-label')
            || row.getAttribute('aria-label')
            || row.textContent
            || '';
    }

    function projectPath(row) {
        return row.getAttribute('data-app-action-sidebar-project-id') || '';
    }

    function threadTitle(row) {
        return row.getAttribute('data-app-action-sidebar-thread-title')
            || row.textContent
            || '';
    }

    function centerPoint(row) {
        const rect = row.getBoundingClientRect?.();
        if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
            return {};
        }
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
        };
    }

    const projectRows = Array.from(doc.querySelectorAll(projectRowSelector));
    let projectRow = null;
    if (target.project) {
        projectRow = projectRows.find(row => matches(projectLabel(row), target.project))
            || projectRows.find(row => matches(projectPath(row), target.project));
        if (!projectRow) {
            return {
                ok: false,
                error: `Project not found: ${target.project}`,
                projects: projectRows.map(row => projectLabel(row)).filter(Boolean),
            };
        }
    }

    if (projectRow) {
        const collapsed = projectRow.getAttribute('data-app-action-sidebar-project-collapsed') === 'true'
            || projectRow.getAttribute('aria-expanded') === 'false';
        if (collapsed) {
            projectRow.scrollIntoView?.({ block: 'center' });
            if (!target.preferNativeClick) {
                projectRow.click();
            }
            return {
                ok: true,
                expanded: true,
                selected: false,
                project: projectLabel(projectRow),
                projectPath: projectPath(projectRow),
                ...centerPoint(projectRow),
            };
        }
    }

    const scope = projectRow
        ? (projectRow.closest('[role="listitem"][aria-label]') || projectRow.parentElement || doc)
        : doc;
    const threadRows = Array.from(scope.querySelectorAll(threadRowSelector));
    if (!threadRows.length) {
        return {
            ok: false,
            error: projectRow
                ? `No visible conversations under project: ${projectLabel(projectRow)}`
                : 'No visible Codex conversations found',
        };
    }

    let threadRow = null;
    if (target.threadId) {
        threadRow = threadRows.find(row => row.getAttribute('data-app-action-sidebar-thread-id') === target.threadId);
    }
    if (!threadRow && target.index != null) {
        const index = Number(target.index);
        if (!Number.isInteger(index) || index < 1) {
            return { ok: false, error: `Invalid conversation index: ${target.index}` };
        }
        threadRow = threadRows[index - 1] || null;
    }
    if (!threadRow && target.conversation) {
        const exact = threadRows.filter(row => normalize(threadTitle(row)) === normalize(target.conversation));
        threadRow = exact[0] || threadRows.find(row => matches(threadTitle(row), target.conversation)) || null;
        if (exact.length > 1 && !target.project) {
            return {
                ok: false,
                error: `Multiple conversations matched "${target.conversation}". Pass --project to disambiguate.`,
            };
        }
    }

    if (!threadRow) {
        return {
            ok: false,
            error: target.threadId
                ? `Thread not found: ${target.threadId}`
                : target.conversation
                ? `Conversation not found: ${target.conversation}`
                : 'Pass --conversation, --thread-id, or --index to select a Codex conversation',
            conversations: threadRows.map((row, index) => ({ index: index + 1, title: threadTitle(row) })),
        };
    }

    threadRow.scrollIntoView?.({ block: 'center' });
    if (!target.preferNativeClick) {
        threadRow.click();
    }
    return {
        ok: true,
        expanded: false,
        selected: true,
        project: projectRow ? projectLabel(projectRow) : '',
        projectPath: projectRow ? projectPath(projectRow) : '',
        conversation: threadTitle(threadRow),
        threadId: threadRow.getAttribute('data-app-action-sidebar-thread-id') || '',
        index: threadRows.indexOf(threadRow) + 1,
        ...centerPoint(threadRow),
    };
}

export function flattenCodexProjects(projects, opts = {}) {
    const projectFilter = opts.project;
    const limit = parseOptionalPositiveIntegerOption(opts.limit, 'codex --limit');
    const rows = [];
    for (const project of projects) {
        if (!matchesProject(project, projectFilter)) {
            continue;
        }
        const conversations = limit
            ? project.conversations.slice(0, limit)
            : project.conversations;
        if (conversations.length === 0) {
            rows.push({
                Project: project.project,
                Index: 0,
                Title: project.collapsed ? '(collapsed)' : '(no visible conversations)',
                Updated: '',
                Active: '',
                ProjectPath: project.projectPath,
                ThreadId: '',
            });
            continue;
        }
        for (const conversation of conversations) {
            rows.push({
                Project: project.project,
                Index: conversation.index,
                Title: conversation.title,
                Updated: conversation.updated,
                Active: conversation.active ? 'yes' : '',
                ProjectPath: project.projectPath,
                ThreadId: conversation.threadId,
            });
        }
    }
    return rows;
}

export async function readCodexProjects(page) {
    const projects = await page.evaluate(`(${collectCodexProjectsFromDocument.toString()})()`);
    if (!Array.isArray(projects)) {
        throw new CommandExecutionError('Codex sidebar project extraction returned an invalid payload');
    }
    return projects;
}

export async function openCodexConversation(page, kwargs) {
    if (!hasConversationTarget(kwargs))
        return null;
    const index = parseOptionalPositiveIntegerOption(kwargs.index, 'codex conversation --index');
    const threadId = kwargs['thread-id'] ? requireNonEmptyOption(kwargs['thread-id'], 'codex conversation --thread-id') : '';
    const target = {
        project: kwargs.project || '',
        conversation: kwargs.conversation || '',
        index: index == null ? '' : String(index),
        threadId,
        preferNativeClick: typeof page.nativeClick === 'function',
    };
    let result = await page.evaluate(`(${selectCodexConversationInDocument.toString()})(${JSON.stringify(target)})`);
    if (result?.expanded) {
        if (typeof page.nativeClick === 'function' && Number.isFinite(result.x) && Number.isFinite(result.y)) {
            await page.nativeClick(result.x, result.y);
        }
        await page.wait(0.75);
        result = await page.evaluate(`(${selectCodexConversationInDocument.toString()})(${JSON.stringify(target)})`);
    }
    if (!result?.ok || !result?.selected) {
        const detail = result?.conversations
            ? ` Available: ${result.conversations.map(item => `${item.index}. ${item.title}`).join('; ')}`
            : result?.projects
                ? ` Available projects: ${result.projects.join(', ')}`
                : '';
        const message = `${result?.error || 'Could not select Codex conversation'}${detail}`;
        if (result?.error?.startsWith('Invalid conversation index:')) {
            throw new ArgumentError(message);
        }
        if (result?.error?.startsWith('Multiple conversations matched')) {
            throw new ArgumentError(message, 'Pass --project or --thread-id to disambiguate the target conversation.');
        }
        if (result?.error?.startsWith('Project not found:')
            || result?.error?.startsWith('Conversation not found:')
            || result?.error?.startsWith('Thread not found:')
            || result?.error?.startsWith('No visible conversations under project:')) {
            throw new EmptyResultError('codex conversation', message);
        }
        throw new CommandExecutionError(message, 'Open the Codex sidebar and verify project/conversation rows are visible.');
    }
    if (typeof page.nativeClick === 'function' && Number.isFinite(result.x) && Number.isFinite(result.y)) {
        await page.nativeClick(result.x, result.y);
    }
    await page.wait(1);
    return result;
}

export const conversationSelectionArgs = [
    { name: 'project', required: false, help: 'Project label or path to select before running the command' },
    { name: 'conversation', required: false, help: 'Conversation title to select within --project' },
    { name: 'index', required: false, help: '1-based conversation index within --project' },
    { name: 'thread-id', required: false, help: 'Exact Codex thread id to select' },
];
