// Shared helpers for Codex conversation management (pin/unpin/archive/rename).
//
// Codex App exposes 8 actions via the "Chat actions" header dropdown on the
// currently-active chat. We use that path because it's the only one that
// works regardless of window visibility:
//
//   - The per-row sidebar buttons (Pin chat / Archive chat) are React
//     hover-only — they're LAZILY MOUNTED only when the row is hovered,
//     AND only when `document.visibilityState === 'visible'`. When the
//     Codex window is hidden / minimized, even programmatic mouseenter
//     won't surface them.
//
//   - The Chat actions menu mounts its items on click, doesn't care about
//     window visibility, and supports all the operations we need:
//       Unpin chat  ⌥⌘P     (or "Pin chat" when not pinned)
//       Rename chat ⌥⌘R
//       Archive chat ⇧⌘A
//       Open side chat, Copy, Fork, Add automation…, Open in new window
//
// Caveat: this means each action targets the ACTIVE chat. We select the
// target first via openCodexConversation (using --project / --conversation
// / --index / --thread-id), then trigger the menu and click.

import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    collectCodexProjectsFromDocument,
    conversationSelectionArgs,
    hasConversationTarget,
    openCodexConversation,
} from './sidebar.js';

export { conversationSelectionArgs };

export function unwrapEvaluateResult(result) {
    if (result && typeof result === 'object' && 'data' in result && 'session' in result) {
        return result.data;
    }
    return result;
}

function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sameProject(a, b) {
    const left = cleanText(a).toLowerCase();
    const right = cleanText(b).toLowerCase();
    return !left || !right || left === right;
}

export function findCodexConversation(projects, ref) {
    if (!Array.isArray(projects)) {
        return null;
    }
    for (const project of projects) {
        for (const conversation of project.conversations || []) {
            if (ref.threadId && conversation.threadId === ref.threadId) {
                return { project, conversation };
            }
            if (!ref.threadId
                && ref.conversation
                && cleanText(conversation.title) === cleanText(ref.conversation)
                && sameProject(project.project, ref.project)) {
                return { project, conversation };
            }
        }
    }
    return null;
}

export function findActiveCodexConversation(projects) {
    const active = [];
    for (const project of projects || []) {
        for (const conversation of project.conversations || []) {
            if (conversation.active) {
                active.push({ project, conversation });
            }
        }
    }
    return active.length === 1 ? active[0] : null;
}

export async function readConversationProjects(page) {
    const projects = unwrapEvaluateResult(await page.evaluate(`(${collectCodexProjectsFromDocument.toString()})()`));
    if (!Array.isArray(projects)) {
        throw new CommandExecutionError('Codex sidebar extraction returned an invalid payload.');
    }
    return projects;
}

export async function resolveActionConversation(page, kwargs) {
    const selected = await openCodexConversation(page, kwargs);
    const projects = await readConversationProjects(page);
    const resolved = selected
        ? findCodexConversation(projects, selected)
        : findActiveCodexConversation(projects);
    if (!resolved) {
        const hint = hasConversationTarget(kwargs)
            ? 'The selected Codex conversation was not visible after selection.'
            : 'Pass --project/--conversation/--index/--thread-id, or keep the active conversation visible in the sidebar.';
        throw new CommandExecutionError('Could not resolve a stable Codex conversation identity.', hint);
    }
    if (!resolved.conversation.threadId) {
        throw new CommandExecutionError(
            'Could not resolve a stable Codex conversation identity.',
            'The selected sidebar row is missing its Codex thread id; selectors may have drifted.',
        );
    }
    return {
        project: resolved.project.project,
        projectPath: resolved.project.projectPath,
        conversation: resolved.conversation.title,
        threadId: resolved.conversation.threadId,
        pinned: resolved.conversation.pinned,
        index: resolved.conversation.index,
    };
}

function conversationRefForError(ref) {
    return ref.threadId || `${ref.project || '(unknown project)'}/${ref.conversation || '(unknown conversation)'}`;
}

/**
 * Open the "Chat actions" header menu on the currently-active chat and
 * click the menu item whose visible text matches one of `labelOptions`.
 *
 * Single-evaluate so the menu stays mounted while we click — and uses
 * the full pointer-event chain because radix's menu trigger only responds
 * to pointerdown/up sequences, not bare .click().
 *
 * Returns { ok, clicked? , reason?, detail? }.
 */
export async function clickChatActionsMenuItem(page, labelOptions) {
    const labelsJson = JSON.stringify(labelOptions);

    const result = unwrapEvaluateResult(await page.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const labels = ${labelsJson};

    const trigger = document.querySelector('button[aria-label="Chat actions"]');
    if (!(trigger instanceof HTMLButtonElement)) {
      return { ok: false, reason: 'Chat actions button not found in the chat header.' };
    }

    // Radix listens to pointer events — bare .click() is silently ignored.
    const rect = trigger.getBoundingClientRect();
    const init = {
      bubbles: true, cancelable: true, button: 0, buttons: 1,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
    };
    trigger.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
    trigger.dispatchEvent(new MouseEvent('mousedown', init));
    trigger.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
    trigger.dispatchEvent(new MouseEvent('mouseup', init));
    trigger.dispatchEvent(new MouseEvent('click', init));

    // Poll for menu items to mount (typically < 300ms).
    let menuItems = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(75);
      menuItems = Array.from(document.querySelectorAll('[role="menuitem"]'))
        .filter((it) => it instanceof HTMLElement && it.offsetParent);
      if (menuItems.length) break;
    }
    if (!menuItems.length) {
      return { ok: false, reason: 'Chat actions menu did not open after pointer click.' };
    }

    // Match by label — menu items render as "<label><kbd>shortcut</kbd>" so
    // we compare the leading text (innerText through the first newline /
    // kbd boundary).
    function leadingText(el) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('kbd').forEach((k) => k.remove());
      return (clone.textContent || '').trim();
    }

    let target = null;
    for (const item of menuItems) {
      const text = leadingText(item);
      for (const label of labels) {
        if (text === label || text.startsWith(label)) {
          target = item;
          break;
        }
      }
      if (target) break;
    }

    if (!target) {
      const visible = menuItems.map(leadingText);
      // Close the menu so it doesn't stay open as a side effect.
      document.body.click();
      return {
        ok: false,
        reason: 'No menu item matched the requested label.',
        detail: 'wanted=' + JSON.stringify(labels) + ' visible=' + JSON.stringify(visible),
      };
    }

    // Defer click to a microtask so the eval response returns BEFORE the
    // action triggers a re-render that could swallow our reply.
    const matchedLabel = leadingText(target);
    Promise.resolve().then(() => { try { target.click(); } catch {} });
    return { ok: true, clicked: matchedLabel };
  })()`));

    return result || { ok: false, reason: 'Empty result from page.evaluate.' };
}

/**
 * Convenience wrapper that selects the target first, then clicks the menu.
 */
export async function selectAndClickAction(page, kwargs, labelOptions) {
    const selected = await resolveActionConversation(page, kwargs);
    await page.wait(0.4);
    const result = await clickChatActionsMenuItem(page, labelOptions);
    if (!result.ok) {
        const detail = result.detail ? ` ${result.detail}` : '';
        throw new CommandExecutionError(
            `${result.reason || 'Failed to perform action.'}${detail}`,
            'Make sure Codex Desktop is running and the target conversation is selectable.',
        );
    }
    return { ...result, selected };
}

export async function waitForConversationPostcondition(page, ref, predicate, description, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    let lastMatch = null;
    while (Date.now() < deadline) {
        const projects = await readConversationProjects(page);
        lastMatch = findCodexConversation(projects, ref);
        if (predicate(lastMatch)) {
            return lastMatch;
        }
        await page.wait(0.2);
    }
    throw new CommandExecutionError(
        `Codex ${description} was not verified for ${conversationRefForError(ref)}.`,
        'The UI action may have failed or the sidebar selectors may have drifted.',
    );
}

export async function setConversationPinned(page, kwargs, desiredPinned) {
    const selected = await resolveActionConversation(page, kwargs);
    if (selected.pinned === desiredPinned) {
        return { status: desiredPinned ? 'already-pinned' : 'already-unpinned', selected };
    }
    const action = await selectAndClickAction(page, kwargs, [desiredPinned ? 'Pin chat' : 'Unpin chat']);
    await waitForConversationPostcondition(
        page,
        action.selected,
        match => match?.conversation?.pinned === desiredPinned,
        desiredPinned ? 'pin' : 'unpin',
    );
    return { status: desiredPinned ? 'pinned' : 'unpinned', selected: action.selected };
}

export async function archiveConversation(page, kwargs) {
    const selected = await selectAndClickAction(page, kwargs, ['Archive chat']);
    await waitForConversationPostcondition(
        page,
        selected.selected,
        match => !match,
        'archive',
    );
    return { status: 'archived', selected: selected.selected };
}
