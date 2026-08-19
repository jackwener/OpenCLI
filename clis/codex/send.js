import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, selectorError } from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './_actions.js';
import { conversationSelectionArgs, openCodexConversation } from './sidebar.js';

const PICKER_ITEM_SELECTOR = '[data-list-navigation-item="true"]';

export function findUniquePickerOption(options, rawLabel) {
    const wanted = String(rawLabel ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!wanted) {
        throw new ArgumentError('--pick label cannot be empty');
    }
    const normalized = options.map((option, index) => ({
        index,
        title: String(option.title ?? ''),
        normalizedTitle: String(option.title ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
        normalizedText: String(option.text ?? option.title ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
    }));
    const exact = normalized.filter(item => item.normalizedTitle === wanted);
    if (exact.length === 1) {
        return exact[0];
    }
    if (exact.length > 1) {
        throw new CommandExecutionError(`Picker option "${rawLabel}" is ambiguous.`, `Matches: ${exact.map(item => item.title).join(', ')}`);
    }
    const partial = normalized.filter(item => item.normalizedText.includes(wanted));
    if (partial.length === 1) {
        return partial[0];
    }
    if (partial.length > 1) {
        throw new CommandExecutionError(`Picker option "${rawLabel}" is ambiguous.`, `Matches: ${partial.map(item => item.title).join(', ')}`);
    }
    return null;
}

function normalizeChipText(value) {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function chipMatchesLabel(chip, label) {
    const wanted = normalizeChipText(label);
    if (!wanted) {
        return false;
    }
    return [chip.name, chip.display].some((value) => {
        const candidate = normalizeChipText(value);
        return candidate !== '' && (candidate.includes(wanted) || wanted.includes(candidate));
    });
}

function describeComposerState(state) {
    return `text=${JSON.stringify(state.text)} chips=${JSON.stringify(state.chips.map(chip => chip.display || chip.name))}`;
}

export function findCodexComposerElement(doc = document) {
    let composer = doc.querySelector('textarea, [contenteditable="true"]');
    const editables = Array.from(doc.querySelectorAll('[contenteditable="true"]'));
    if (editables.length > 0) {
        composer = editables[editables.length - 1];
    }
    return composer;
}

async function readComposerState(page) {
    const state = unwrapEvaluateResult(await page.evaluate(`
      (function() {
        const injected = (${findCodexComposerElement.toString()})();
        if (!injected) return null;
        // Verification must read the element injection wrote into (the #1991
        // bug class); the tagged composer counts only when it wraps it.
        const composer = injected.closest('[data-codex-composer="true"]') || injected;
        const chips = Array.from(composer.querySelectorAll('[skill-mention-name]')).map((chip) => ({
          name: chip.getAttribute('skill-mention-name') || '',
          display: chip.getAttribute('skill-mention-display-name') || '',
        }));
        const clone = composer.cloneNode(true);
        clone.querySelectorAll('[skill-mention-name]').forEach((chip) => chip.remove());
        return {
          text: (composer.textContent || '').trim(),
          nonChipText: (clone.textContent || '').trim(),
          chips,
        };
      })()
    `));
    if (!state) {
        throw selectorError('Codex Composer input element');
    }
    return state;
}

async function pollComposerState(page) {
    let state = await readComposerState(page);
    for (let attempt = 0; attempt < 5 && state.text; attempt += 1) {
        await page.wait(0.25);
        state = await readComposerState(page);
    }
    return state;
}

export const sendCommand = cli({
    site: 'codex',
    name: 'send',
    access: 'write',
    description: 'Send text/commands to the current or selected Codex AI composer',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', required: true, positional: true, help: 'Text, command (e.g. /review), or skill (e.g. $imagegen)' },
        { name: 'pick', required: false, help: 'Picker option label to select when a slash command opens the picker (e.g. "Review Agent")' },
        ...conversationSelectionArgs,
    ],
    columns: ['Status', 'Project', 'Conversation', 'InjectedText'],
    func: async (page, kwargs) => {
        const textToInsert = kwargs.text;
        const pick = String(kwargs.pick ?? '').trim();
        if (kwargs.pick != null && !pick) {
            throw new ArgumentError('--pick label cannot be empty');
        }
        const selected = await openCodexConversation(page, kwargs);
        const injected = unwrapEvaluateResult(await page.evaluate(`
      (function(text) {
        const composer = (${findCodexComposerElement.toString()})();
        if (!composer) return false;

        composer.focus();
        document.execCommand('insertText', false, text);
        return true;
      })(${JSON.stringify(textToInsert)})
    `));
        if (!injected)
            throw selectorError('Codex Composer input element');
        // Wait for the UI to register the input
        await page.wait(0.5);
        let picked = null;
        if (pick) {
            const options = unwrapEvaluateResult(await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let items = [];
      for (let attempt = 0; attempt < 20; attempt += 1) {
        items = Array.from(document.querySelectorAll('${PICKER_ITEM_SELECTOR}'))
          .filter((it) => it instanceof HTMLElement && it.offsetParent);
        if (items.length) break;
        await wait(75);
      }
      // Picker titles are split into per-character spans for match
      // highlighting, so read the leading truncate div for the title and the
      // concatenated textContent (title plus description) for substrings.
      return items.map((el) => {
        const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
        const lead = el.querySelector('[class*="truncate"]');
        return { title: lead ? (lead.textContent || '').replace(/\\s+/g, ' ').trim() : text, text };
      });
    })()`));
            if (!Array.isArray(options) || options.length === 0) {
                throw new CommandExecutionError('Codex picker did not open after typing the command.', 'Check that the text opens a picker, or drop --pick.');
            }
            picked = findUniquePickerOption(options, pick);
            if (!picked) {
                throw new CommandExecutionError('No picker option matched.', `wanted=${pick} available=${JSON.stringify(options.map((option) => option.title))}`);
            }
            const clicked = unwrapEvaluateResult(await page.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('${PICKER_ITEM_SELECTOR}'))
        .filter((it) => it instanceof HTMLElement && it.offsetParent);
      const target = items[${picked.index}];
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      const init = {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: Math.round(rect.left + rect.width / 2),
        clientY: Math.round(rect.top + rect.height / 2),
      };
      // The picker only responds to the full pointer chain, and deferring it
      // keeps the eval response ahead of the re-render that closes the picker.
      Promise.resolve().then(() => {
        try {
          target.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
          target.dispatchEvent(new MouseEvent('mousedown', init));
          target.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
          target.dispatchEvent(new MouseEvent('mouseup', init));
          target.dispatchEvent(new MouseEvent('click', init));
        } catch {}
      });
      return true;
    })()`));
            if (clicked !== true) {
                throw new CommandExecutionError('Codex picker option disappeared before it could be clicked.', `wanted=${picked.title}`);
            }
            // The click above is deferred, so verify it landed: the picker must
            // close and the composer must hold a chip for the picked option.
            let applied = null;
            for (let attempt = 0; attempt < 20; attempt += 1) {
                const state = await readComposerState(page);
                const pickerOpen = unwrapEvaluateResult(await page.evaluate(`Array.from(document.querySelectorAll('${PICKER_ITEM_SELECTOR}')).some((it) => it instanceof HTMLElement && !!it.offsetParent)`)) === true;
                if (!pickerOpen && state.chips.some((chip) => chipMatchesLabel(chip, picked.title))) {
                    applied = state;
                    break;
                }
                applied = state;
                await page.wait(0.1);
            }
            if (!applied || !applied.chips.some((chip) => chipMatchesLabel(chip, picked.title))) {
                throw new CommandExecutionError(
                    'Codex picker selection did not reach the composer.',
                    `expected=${picked.title} ${describeComposerState(applied ?? { text: '', chips: [] })}`,
                );
            }
        }
        await page.pressKey('Enter');
        let state = await pollComposerState(page);
        if (state.text) {
            // The picker consumes Enter to insert the highlighted entry, so a
            // still-loaded composer is either the untouched draft or the chip
            // the picker resolved. Anything else was rewritten: never submit.
            const slashToken = /^\/\S+$/.test(textToInsert) ? textToInsert.slice(1) : '';
            const chipLabel = picked ? picked.title : slashToken;
            const unchangedDraft = state.chips.length === 0 && state.text === String(textToInsert).trim();
            const pickerResolvedCommand = chipLabel !== ''
                && state.chips.length === 1
                && state.nonChipText === ''
                && chipMatchesLabel(state.chips[0], chipLabel);
            if (!unchangedDraft && !pickerResolvedCommand) {
                throw new CommandExecutionError(
                    'Codex send was not submitted.',
                    `The composer now holds ${describeComposerState(state)}. Re-run with --pick <label> or press Escape in Codex first.`,
                );
            }
            await page.pressKey('Enter');
            state = await pollComposerState(page);
            if (state.text) {
                throw new CommandExecutionError('Codex send was not verified.', `The composer still holds an unsent draft: ${describeComposerState(state)}`);
            }
        }
        return [
            {
                Status: 'Success',
                Project: selected?.project || '',
                Conversation: selected?.conversation || '',
                InjectedText: textToInsert,
            },
        ];
    },
});
