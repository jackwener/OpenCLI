import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

function parseKeyword(value) {
    const keyword = String(value ?? '').trim();
    if (!keyword) {
        throw new ArgumentError('twitter mute-word keyword cannot be empty');
    }
    return keyword;
}

cli({
    site: 'twitter',
    name: 'mute-word',
    access: 'write',
    description: 'Add a muted word or phrase on Twitter/X',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'keyword', type: 'string', positional: true, required: true, help: 'Word or phrase to mute' },
    ],
    columns: ['keyword', 'status', 'message'],
    func: async (page, kwargs) => {
        if (!page) {
            throw new CommandExecutionError('Browser session required for twitter mute-word');
        }
        const keyword = parseKeyword(kwargs.keyword);

        await page.goto('https://x.com/settings/add_muted_keyword');
        await page.wait({ selector: '[data-testid="primaryColumn"]' }).catch(() => {});

        const result = await page.evaluate(`(async () => {
            const keyword = ${JSON.stringify(keyword)};
            let writeStarted = false;
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const visible = (node) => {
                if (!node) return false;
                const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
                return !style || (style.visibility !== 'hidden' && style.display !== 'none');
            };
            const textOf = (node) => String(node?.innerText || node?.textContent || '').trim();
            const lowerTextOf = (node) => textOf(node).toLowerCase();
            const exactTextOf = (node) => lowerTextOf(node).replace(/\\s+/g, ' ');
            const setNativeValue = (node, value) => {
                if ('value' in node) {
                    const prototype = Object.getPrototypeOf(node);
                    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
                    if (setter) setter.call(node, value);
                    else node.value = value;
                } else {
                    node.textContent = value;
                }
                let inputEvent;
                try {
                    inputEvent = new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value });
                } catch {
                    inputEvent = new Event('input', { bubbles: true });
                }
                node.dispatchEvent(inputEvent);
                node.dispatchEvent(new Event('change', { bubbles: true }));
            };
            const settingsSurface = () => document.querySelector('[data-testid="primaryColumn"]')
                || document.querySelector('main');
            const scopeFor = (node) => node?.closest('form, [data-testid="primaryColumn"], main') || settingsSurface();
            const keywordRows = () => {
                const surface = settingsSurface();
                if (!surface) return [];
                return Array.from(surface.querySelectorAll('[data-testid*="muted"], [data-testid*="keyword"], [role="listitem"], li'))
                    .filter((node) => visible(node) && !node.querySelector('input, textarea, [role="textbox"]'));
            };
            const rowSnapshot = () => keywordRows().map(textOf).filter(Boolean);
            const exactKeywordRows = () => keywordRows().filter((node) => textOf(node) === keyword);
            const hasNewExactKeywordRow = (beforeRows) => {
                const beforeExactCount = beforeRows.filter((text) => text === keyword).length;
                return exactKeywordRows().length > beforeExactCount;
            };
            const matchingToastTexts = () => Array.from(document.querySelectorAll('[role="status"], [data-testid="toast"], [data-testid*="toast"], [aria-live]'))
                .filter((node) => {
                    if (!visible(node)) return false;
                    const text = lowerTextOf(node);
                    return (text.includes('muted') || text.includes('added') || text.includes('saved') || text.includes('已') || text.includes('保存') || text.includes('添加'))
                        && text.includes(keyword.toLowerCase());
                })
                .map(exactTextOf);
            const hasNewSuccessToast = (beforeToasts) => {
                const beforeCounts = new Map();
                for (const text of beforeToasts) {
                    beforeCounts.set(text, (beforeCounts.get(text) || 0) + 1);
                }
                for (const text of matchingToastTexts()) {
                    const count = beforeCounts.get(text) || 0;
                    if (count > 0) {
                        beforeCounts.set(text, count - 1);
                    } else {
                        return true;
                    }
                }
                return false;
            };
            const findKeywordField = () => {
                const surface = settingsSurface();
                if (!surface) return null;
                const exact = Array.from(surface.querySelectorAll('input[name="keyword"], textarea[name="keyword"]'))
                    .filter(visible);
                if (exact.length > 0) return exact[0];
                const candidates = Array.from(surface.querySelectorAll('input[aria-label], textarea[aria-label], [role="textbox"]'))
                    .filter(visible);
                const semantic = candidates.find((node) => {
                    if (!visible(node)) return false;
                    const aria = String(node.getAttribute('aria-label') || '').trim().toLowerCase();
                    const placeholder = String(node.getAttribute('placeholder') || '').trim().toLowerCase();
                    return ['word or phrase', 'word', 'phrase', '关键词', '屏蔽词'].includes(aria)
                        || ['word or phrase', 'word', 'phrase', '关键词', '屏蔽词'].includes(placeholder);
                });
                return semantic || null;
            };
            const findSaveButton = (field) => {
                const labels = new Set(['save', 'add', 'done', '保存', '添加', '完成']);
                const scope = scopeFor(field);
                if (!scope) return null;
                return Array.from(scope.querySelectorAll('button, [role="button"]')).find((node) => {
                    if (!visible(node)) return false;
                    if (node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
                    const text = exactTextOf(node);
                    const aria = String(node.getAttribute('aria-label') || '').trim().toLowerCase();
                    return labels.has(text) || labels.has(aria);
                }) || null;
            };

            try {
                const field = findKeywordField();
                if (!field) {
                    return { ok: false, message: 'Could not find muted word input. Are you logged in?' };
                }
                field.focus?.();
                setNativeValue(field, keyword);
                await sleep(100);

                const beforePath = location.pathname;
                const beforeRows = rowSnapshot();
                const beforeToasts = matchingToastTexts();
                const saveButton = findSaveButton(field);
                if (!saveButton) {
                    return { ok: false, message: 'Could not find muted word Save button.' };
                }
                writeStarted = true;
                saveButton.click();

                for (let attempt = 0; attempt < 20; attempt += 1) {
                    await sleep(250);
                    if (beforePath !== '/settings/muted_keywords' && location.pathname === '/settings/muted_keywords') {
                        return { ok: true, message: 'Muted word added.' };
                    }
                    if (hasNewSuccessToast(beforeToasts)) {
                        return { ok: true, message: 'Muted word added.' };
                    }
                    if (hasNewExactKeywordRow(beforeRows)) {
                        return { ok: true, message: 'Muted word added.' };
                    }
                }
                return { ok: false, unconfirmed: true, message: 'Muted word submission did not show confirmation.' };
            } catch (error) {
                return { ok: false, unconfirmed: writeStarted, message: String(error?.message || error) };
            }
        })()`);

        if (result?.unconfirmed) {
            throw new TimeoutError(
                'twitter mute-word confirmation',
                5,
                `${result.message} Check muted words before retrying; the word may already have been added.`,
            );
        }
        if (!result?.ok) {
            throw new CommandExecutionError(
                result?.message || 'Could not add muted word.',
                'Nothing changed. Open Twitter/X muted word settings in the browser and retry.',
            );
        }

        return [{
            keyword,
            status: 'success',
            message: result.message || 'Muted word added.',
        }];
    },
});
