/**
 * Medium story publisher via the logged-in browser editor.
 *
 * Usage:
 *   opencli medium publish "Article body" --title "Article title" --tags ai,writing
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

const NEW_STORY_URL = 'https://medium.com/new-story';
const MAX_TAGS = 5;
const EDITOR_READY_TIMEOUT_SECONDS = 15;
const PUBLISH_TIMEOUT_SECONDS = 30;

function requireText(value, name, maxLength) {
    const text = String(value ?? '').trim();
    if (!text) throw new ArgumentError(`${name} is required`);
    if (text.length > maxLength) throw new ArgumentError(`${name} exceeds ${maxLength} characters`);
    return text;
}

function parseTags(value) {
    if (!value) return [];
    const tags = String(value)
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);
    if (tags.length > MAX_TAGS) throw new ArgumentError(`Medium supports at most ${MAX_TAGS} tags`);
    for (const tag of tags) {
        if (tag.length > 50) throw new ArgumentError(`Medium tag exceeds 50 characters: ${tag}`);
    }
    return [...new Set(tags)];
}

async function waitForEditor(page) {
    for (let attempt = 0; attempt < EDITOR_READY_TIMEOUT_SECONDS * 2; attempt++) {
        const state = await page.evaluate(`(() => ({
            url: location.href,
            hasEditor: !!document.querySelector('[role="textbox"][contenteditable="true"]'),
        }))()`);
        if (state?.hasEditor && String(state.url || '').includes('medium.com/new-story')) return;
        if (attempt < EDITOR_READY_TIMEOUT_SECONDS * 2 - 1) await page.wait({ time: 0.5 });
    }
    throw new AuthRequiredError('medium.com', 'Medium editor did not load. Run `opencli medium login` and retry.');
}

async function fillStory(page, title, content) {
    const result = await page.evaluate(`(data => {
        const editor = document.querySelector('[role="textbox"][contenteditable="true"]');
        const titleEl = editor?.querySelector('[data-testid="editorTitleParagraph"], .graf--title');
        const bodyEl = editor?.querySelector('[data-testid="editorParagraphText"], p.graf--p');
        if (!editor || !titleEl || !bodyEl) return { ok: false, reason: 'Medium title or body editor not found' };

        const replace = (el, value) => {
            el.focus();
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('insertText', false, value);
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        };

        replace(titleEl, data.title);
        replace(bodyEl, data.content);
        const actualTitle = String(titleEl.innerText || titleEl.textContent || '').trim();
        const actualBody = String(bodyEl.innerText || bodyEl.textContent || '').trim();
        return { ok: actualTitle === data.title && actualBody === data.content, actualTitle, actualBody };
    })(${JSON.stringify({ title, content })})`);
    if (!result?.ok) {
        throw new CommandExecutionError(`Could not fill Medium story: ${result?.reason || 'content verification failed'}`);
    }
}

async function clickInitialPublish(page) {
    for (let attempt = 0; attempt < 20; attempt++) {
        const result = await page.evaluate(`(() => {
            const visible = el => !!el && el.offsetParent !== null;
            const button = Array.from(document.querySelectorAll('button'))
                .find(el => visible(el) && (el.matches('.js-publishButton') || (el.textContent || '').trim() === 'Publish'));
            if (!button) return { ok: false, retry: false, reason: 'Medium Publish button not found' };
            const disabled = button.disabled || button.classList.contains('js-buttonDisabledPrimary') ||
                button.getAttribute('aria-disabled') === 'true' || button.dataset.action === 'show-disabled-button-info';
            if (disabled) return { ok: false, retry: true, reason: 'Medium Publish button is still disabled' };
            button.click();
            return { ok: true };
        })()`);
        if (result?.ok) return;
        if (!result?.retry) throw new CommandExecutionError(result?.reason || 'Could not open Medium publish dialog');
        await page.wait({ time: 0.5 });
    }
    throw new CommandExecutionError('Medium Publish button remained disabled after filling the story');
}

async function addTags(page, tags) {
    for (const tag of tags) {
        let added = false;
        for (let attempt = 0; attempt < 10; attempt++) {
            const result = await page.evaluate(`(tag => {
                const visible = el => !!el && el.offsetParent !== null;
                const input = Array.from(document.querySelectorAll('input')).find(el => {
                    const hint = [el.placeholder, el.getAttribute('aria-label'), el.name].filter(Boolean).join(' ').toLowerCase();
                    return visible(el) && /tag|topic/.test(hint);
                });
                if (!input) return { ok: false, retry: true };
                input.focus();
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
                if (setter) setter.call(input, tag); else input.value = tag;
                input.dispatchEvent(new InputEvent('input', { bubbles: true, data: tag, inputType: 'insertText' }));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: true };
            })(${JSON.stringify(tag)})`);
            if (result?.ok) {
                added = true;
                await page.wait({ time: 0.5 });
                break;
            }
            await page.wait({ time: 0.5 });
        }
        if (!added) throw new CommandExecutionError(`Medium tag input did not appear for tag: ${tag}`);
    }
}

async function clickFinalPublish(page) {
    for (let attempt = 0; attempt < 20; attempt++) {
        const result = await page.evaluate(`(() => {
            const visible = el => !!el && el.offsetParent !== null;
            const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible);
            const target = buttons.find(el => /^(publish now|publish)$/i.test((el.innerText || el.textContent || '').trim()) && !el.matches('.js-publishButton'));
            if (!target) return { ok: false, retry: true };
            if (target.disabled || target.getAttribute('aria-disabled') === 'true') return { ok: false, retry: true, reason: 'Medium final Publish button is disabled' };
            target.click();
            return { ok: true, label: (target.innerText || target.textContent || '').trim() };
        })()`);
        if (result?.ok) return result;
        if (attempt < 19) await page.wait({ time: 0.5 });
    }
    throw new CommandExecutionError('Medium final Publish button did not appear');
}

async function waitForPublishedStory(page) {
    for (let attempt = 0; attempt < PUBLISH_TIMEOUT_SECONDS; attempt++) {
        await page.wait({ time: 1 });
        const result = await page.evaluate(`(() => {
            const url = location.href;
            const text = String(document.body?.innerText || '').toLowerCase();
            if (!/\/new-story(?:[/?#]|$)/.test(new URL(url).pathname) && /medium\.com\//.test(url)) return { ok: true, url };
            if (/could not publish|failed to publish|publish failed|try again/.test(text)) return { ok: false, error: 'Medium reported a publish failure' };
            return { ok: false };
        })()`);
        if (result?.ok) return result.url;
        if (result?.error) throw new CommandExecutionError(result.error);
    }
    throw new TimeoutError('medium publish confirmation', PUBLISH_TIMEOUT_SECONDS);
}

cli({
    site: 'medium',
    name: 'publish',
    access: 'write',
    description: 'Write and publish a Medium story from the logged-in browser session',
    domain: 'medium.com',
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'foreground',
    siteSession: 'persistent',
    args: [
        { name: 'content', type: 'string', positional: true, required: true, help: 'Story body text' },
        { name: 'title', type: 'string', required: true, help: 'Story title' },
        { name: 'tags', type: 'string', help: `Comma-separated topic tags (maximum ${MAX_TAGS})` },
    ],
    columns: ['status', 'title', 'url'],
    func: async (page, kwargs) => {
        if (!page) throw new CommandExecutionError('Browser session required for medium publish');
        const title = requireText(kwargs.title, '--title', 500);
        const content = requireText(kwargs.content, '<content>', 100_000);
        const tags = parseTags(kwargs.tags);

        await page.goto(NEW_STORY_URL);
        await waitForEditor(page);
        await fillStory(page, title, content);
        await clickInitialPublish(page);
        await addTags(page, tags);
        await clickFinalPublish(page);
        const url = await waitForPublishedStory(page);
        return [{ status: 'published', title, url }];
    },
});
