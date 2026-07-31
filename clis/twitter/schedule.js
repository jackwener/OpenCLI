import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const COMPOSE_URL = 'https://x.com/compose/post';
const DEFAULT_DELAY_MINUTES = 10;
const MIN_DELAY_MINUTES = 2;

function parsePositiveInt(value, name) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new ArgumentError(`${name} must be a non-negative integer`);
    }
    return parsed;
}

export function parseScheduleTarget(kwargs, now = new Date()) {
    const at = String(kwargs.at ?? '').trim();
    const hasExplicitDelay = kwargs['delay-minutes'] !== undefined
        && kwargs['delay-minutes'] !== null
        && kwargs['delay-minutes'] !== ''
        && Number(kwargs['delay-minutes']) !== DEFAULT_DELAY_MINUTES;
    if (at && hasExplicitDelay) {
        throw new ArgumentError('Use either --at or --delay-minutes, not both');
    }

    let target;
    if (at) {
        const normalized = at.includes('T') ? at : at.replace(' ', 'T');
        target = new Date(normalized);
        if (Number.isNaN(target.getTime())) {
            throw new ArgumentError('Invalid --at value. Use a local time like "2026-05-24 21:30"');
        }
    } else {
        const delayMinutes = kwargs['delay-minutes'] === undefined || kwargs['delay-minutes'] === null || kwargs['delay-minutes'] === ''
            ? DEFAULT_DELAY_MINUTES
            : parsePositiveInt(kwargs['delay-minutes'], 'delay-minutes');
        if (delayMinutes < MIN_DELAY_MINUTES) {
            throw new ArgumentError(`delay-minutes must be at least ${MIN_DELAY_MINUTES}`);
        }
        target = new Date(now.getTime() + delayMinutes * 60_000);
    }

    if (target.getTime() <= now.getTime() + 60_000) {
        throw new ArgumentError('Scheduled time must be at least one minute in the future');
    }

    return {
        year: target.getFullYear(),
        month: target.getMonth() + 1,
        day: target.getDate(),
        hour: target.getHours(),
        minute: target.getMinutes(),
        iso: target.toISOString(),
    };
}

async function focusComposer(page) {
    return page.evaluate(`(() => {
        const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
        const boxes = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]'));
        const box = boxes.find(visible) || boxes[0];
        if (!box) return { ok: false, message: 'Could not find the post composer text area. Are you logged in?' };
        box.focus();
        return { ok: true };
    })()`);
}

async function verifyComposerText(page, text) {
    return page.evaluate(`(async () => {
        const expected = ${JSON.stringify(text)};
        const normalize = s => String(s || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
        const normalizedExpected = normalize(expected);
        for (let i = 0; i < 40; i++) {
            const box = document.querySelector('[data-testid="tweetTextarea_0"]');
            const actual = box ? (box.innerText || box.textContent || '') : '';
            if (box && normalize(actual).includes(normalizedExpected)) return { ok: true };
            await new Promise(r => setTimeout(r, 250));
        }
        const box = document.querySelector('[data-testid="tweetTextarea_0"]');
        return {
            ok: false,
            message: 'Could not verify post text in the composer after typing.',
            actualText: box ? (box.innerText || box.textContent || '') : ''
        };
    })()`);
}

function isUnsupportedInsertTextError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    return lower.includes('unknown action') || lower.includes('not supported') || lower.includes('inserttext returned no inserted flag');
}

async function insertComposerText(page, text) {
    const focusResult = await focusComposer(page);
    if (!focusResult?.ok) return focusResult;

    const nativeInserters = [
        page.nativeType?.bind(page),
        page.insertText?.bind(page),
    ].filter(Boolean);

    for (const insert of nativeInserters) {
        try {
            await insert(text);
            const verified = await verifyComposerText(page, text);
            if (verified?.ok) return verified;
        }
        catch (err) {
            if (!isUnsupportedInsertTextError(err)) throw err;
        }
    }

    return page.evaluate(`(async () => {
        try {
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            const boxes = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]'));
            const box = boxes.find(visible) || boxes[0];
            if (!box) return { ok: false, message: 'Could not find the post composer text area. Are you logged in?' };
            const textToInsert = ${JSON.stringify(text)};
            const normalize = s => String(s || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
            box.focus();
            if (!document.execCommand('insertText', false, textToInsert)) {
                const dt = new DataTransfer();
                dt.setData('text/plain', textToInsert);
                box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
            }
            await new Promise(r => setTimeout(r, 500));
            const actual = box.innerText || box.textContent || '';
            if (normalize(actual).includes(normalize(textToInsert))) return { ok: true };
            return { ok: false, message: 'Could not verify post text in the composer after typing.', actualText: actual };
        } catch (e) { return { ok: false, message: String(e) }; }
    })()`);
}

async function setSchedule(page, target) {
    const openResult = await page.evaluate(`(async () => {
        const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
        const button = Array.from(document.querySelectorAll('[data-testid="scheduleOption"], button,[role="button"]'))
            .find((el) => visible(el) && /schedule post/i.test((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')));
        if (!button) return { ok: false, message: 'Could not find the Schedule post button.' };
        button.click();
        return { ok: true };
    })()`);
    if (!openResult?.ok) return openResult;

    await page.wait({ selector: '[data-testid="scheduledConfirmationPrimaryAction"]', timeout: 15 });
    return page.evaluate(`(async () => {
        try {
            const target = ${JSON.stringify(target)};
            const selects = Array.from(document.querySelectorAll('select'));
            if (selects.length < 5) {
                return { ok: false, message: 'Could not find schedule date/time controls.' };
            }

            const values = [target.month, target.day, target.year, target.hour, target.minute];
            for (let i = 0; i < values.length; i++) {
                const select = selects[i];
                select.value = String(values[i]);
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }

            await new Promise(r => setTimeout(r, 500));
            const confirm = document.querySelector('[data-testid="scheduledConfirmationPrimaryAction"]');
            if (!confirm || confirm.disabled || confirm.getAttribute('aria-disabled') === 'true') {
                return { ok: false, message: 'Schedule confirmation button is disabled or missing.' };
            }
            confirm.click();
            return { ok: true };
        } catch (e) {
            return { ok: false, message: String(e) };
        }
    })()`);
}

async function submitScheduledPost(page) {
    const clickResult = await page.evaluate(`(async () => {
        try {
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            const buttons = Array.from(document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'));
            const btn = buttons.find((el) => visible(el) && /schedule/i.test(el.textContent || '') && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
            if (!btn) return { ok: false, message: 'Schedule submit button is disabled or not found.' };
            btn.click();
            return { ok: true };
        } catch (e) { return { ok: false, message: String(e) }; }
    })()`);
    if (!clickResult?.ok) return clickResult;

    return page.evaluate(`(async () => {
        const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
        for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 500));
            const toasts = Array.from(document.querySelectorAll('[role="alert"], [data-testid="toast"]')).filter(visible);
            const successToast = toasts.find((el) => /will be sent|scheduled/i.test(el.textContent || ''));
            if (successToast) return { ok: true, message: (successToast.textContent || 'Post scheduled successfully.').trim() };
            const alert = toasts.find((el) => /failed|error|try again|not sent|could not/i.test(el.textContent || ''));
            if (alert) return { ok: false, message: (alert.textContent || 'Scheduled post failed.').trim() };
        }
        return { ok: false, message: 'Schedule submission did not complete before timeout.' };
    })()`);
}

cli({
    site: 'twitter',
    name: 'schedule',
    access: 'write',
    description: 'Schedule a new X post through the web composer',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', type: 'string', required: true, positional: true, help: 'The text content of the scheduled post' },
        { name: 'at', type: 'string', required: false, help: 'Local scheduled time, e.g. "2026-05-24 21:30"' },
        { name: 'delay-minutes', type: 'int', default: DEFAULT_DELAY_MINUTES, help: 'Schedule this many minutes from now' },
    ],
    columns: ['status', 'message', 'text', 'scheduledFor'],
    func: async (page, kwargs) => {
        if (!page) throw new CommandExecutionError('Browser session required for twitter schedule');
        const text = String(kwargs.text ?? '').trim();
        if (!text) throw new ArgumentError('Scheduled post text is required');
        const target = parseScheduleTarget(kwargs);

        await page.goto(COMPOSE_URL, { waitUntil: 'load', settleMs: 2500 });
        await page.wait({ selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });

        const scheduleResult = await setSchedule(page, target);
        if (!scheduleResult?.ok) {
            return [{ status: 'failed', message: scheduleResult?.message ?? 'Could not configure schedule.', text, scheduledFor: target.iso }];
        }

        await page.wait({ selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });
        const typeResult = await insertComposerText(page, text);
        if (!typeResult?.ok) {
            return [{ status: 'failed', message: typeResult?.message ?? 'Could not type scheduled post text.', text, scheduledFor: target.iso }];
        }

        await page.wait(1);
        const result = await submitScheduledPost(page);
        return [{
            status: result?.ok ? 'success' : 'failed',
            message: result?.message ?? 'Scheduled post failed.',
            text,
            scheduledFor: target.iso,
        }];
    }
});

export const __test__ = {
    parseScheduleTarget,
    setSchedule,
};
