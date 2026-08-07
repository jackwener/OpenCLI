import fs from 'node:fs';
import path from 'node:path';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const MERCURY_EXPENSES_URL = 'https://app.mercury.com/expenses/my-expenses';
export const RECEIPT_INPUT_SELECTOR = '[data-testid="expense-attachment-upload"]';

export function requireString(kwargs, name) {
    const value = kwargs[name];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new ArgumentError(`Missing required argument: ${name}`);
    }
    return value.trim();
}

export function optionalString(kwargs, name, fallback) {
    const value = kwargs[name];
    if (typeof value !== 'string' || value.trim() === '') return fallback;
    return value.trim();
}

export function optionalBoolean(kwargs, name, fallback = false) {
    const value = kwargs[name];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
        throw new ArgumentError(`Boolean argument ${name} must be true or false`);
    }
    return fallback;
}

function parseReceiptPath(kwargs) {
    const receipt = path.resolve(requireString(kwargs, 'receipt'));
    let stat;
    try {
        stat = fs.statSync(receipt, { throwIfNoEntry: false });
    }
    catch (error) {
        throw new ArgumentError(`Receipt file cannot be read: ${receipt}`, error instanceof Error ? error.message : undefined);
    }
    if (!stat || !stat.isFile()) {
        throw new ArgumentError(`Receipt file does not exist: ${receipt}`);
    }
    return receipt;
}

function parseAmount(kwargs) {
    const amount = requireString(kwargs, 'amount').replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
        throw new ArgumentError(`Amount must be a positive number with up to two decimals: ${amount}`);
    }
    return amount;
}

function parseCurrency(kwargs) {
    const currency = optionalString(kwargs, 'currency', 'CNY').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
        throw new ArgumentError(`Currency must be a three-letter ISO currency code: ${currency}`);
    }
    return currency;
}

function parseDate(kwargs) {
    const date = requireString(kwargs, 'date');
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        throw new ArgumentError(`Date must be YYYY-MM-DD: ${date}`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
        throw new ArgumentError(`Date must be a real calendar date: ${date}`);
    }
    return date;
}

function parseOcrWaitSeconds(kwargs) {
    const raw = optionalString(kwargs, 'ocr-wait-seconds', '8');
    if (!/^\d+$/.test(raw)) {
        throw new ArgumentError(`ocr-wait-seconds must be a non-negative integer: ${raw}`);
    }
    return Number(raw);
}

export function normalizeReimbursementInput(kwargs) {
    return {
        receipt: parseReceiptPath(kwargs),
        amount: parseAmount(kwargs),
        currency: parseCurrency(kwargs),
        date: parseDate(kwargs),
        merchant: requireString(kwargs, 'merchant'),
        category: optionalString(kwargs, 'category', 'Marketing & Advertising'),
        notes: requireString(kwargs, 'notes'),
        ocrWaitSeconds: parseOcrWaitSeconds(kwargs),
        closeAfterReview: optionalBoolean(kwargs, 'close-after-review', false),
    };
}

export function receiptBasename(receipt) {
    return path.basename(receipt);
}

export function assertObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new CommandExecutionError(`Mercury returned malformed ${label}`);
    }
    return value;
}

export function assertMercuryState(value, label = 'page state') {
    const state = assertObject(value, label);
    if (typeof state.url !== 'string' || typeof state.title !== 'string') {
        throw new CommandExecutionError(`Mercury returned malformed ${label}`);
    }
    return state;
}

function assertBooleanFields(state, label, fields) {
    for (const field of fields) {
        if (typeof state[field] !== 'boolean') {
            throw new CommandExecutionError(`Mercury returned malformed ${label}: ${field} must be boolean`);
        }
    }
    return state;
}

export async function inspectMercury(page) {
    await page.goto(MERCURY_EXPENSES_URL, { waitUntil: 'load', settleMs: 1500 });
    await page.wait({ time: 1 });

    const state = await page.evaluate(`(() => {
        const text = document.body?.innerText || '';
        const url = location.href;
        return {
            url,
            loggedIn: !/\\/login\\b/.test(url) && !/sign in|log in|password|passkey/i.test(text),
            hasSubmitExpense: /Submit expense/i.test(text),
            hasReimbursements: /Reimbursements|My Expenses|Submitted Expenses/i.test(text),
            title: document.title
        };
    })()`);
    return assertBooleanFields(assertMercuryState(state, 'login state'), 'login state', ['loggedIn', 'hasSubmitExpense', 'hasReimbursements']);
}

export async function clickText(page, labels) {
    const result = await page.evaluate(`(() => {
        const labels = ${JSON.stringify(labels)};
        const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const wanted = labels.map(norm);
        const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"]'))
          .filter((node) => {
            const style = window.getComputedStyle(node);
            return style.visibility !== 'hidden' && style.display !== 'none' && node.offsetParent !== null;
          });
        const el = candidates.find((node) => wanted.includes(norm(node.innerText || node.textContent || '')));
        if (!el) return { clicked: false, labels };
        el.click();
        return { clicked: true, text: el.innerText || el.textContent || '' };
    })()`);
    const payload = assertObject(result, 'click result');
    if (typeof payload.clicked !== 'boolean') throw new CommandExecutionError('Mercury returned malformed click result');
    return payload;
}

export async function clickCreateExpenseButton(page) {
    const result = await page.evaluate(`(() => {
        const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const wanted = new Set(['submit expense', 'new expense']);
        const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"]'))
          .filter((node) => {
            const style = window.getComputedStyle(node);
            return style.visibility !== 'hidden' && style.display !== 'none' && node.offsetParent !== null;
          })
          .filter((node) => wanted.has(norm(node.innerText || node.textContent || '')));
        const dangerous = candidates.find((node) => {
          const container = node.closest('[role="dialog"], dialog, form, [aria-modal="true"]');
          const context = String(container?.innerText || container?.textContent || '').replace(/\\s+/g, ' ').trim();
          return Boolean(container) || /Review|receipt|amount|merchant|category|notes|expense date/i.test(context);
        });
        if (dangerous) {
          return { clicked: false, blocked: true, text: dangerous.innerText || dangerous.textContent || '' };
        }
        const el = candidates[0];
        if (!el) return { clicked: false, blocked: false };
        el.click();
        return { clicked: true, blocked: false, text: el.innerText || el.textContent || '' };
    })()`);
    const payload = assertObject(result, 'create expense click result');
    if (typeof payload.clicked !== 'boolean' || typeof payload.blocked !== 'boolean') {
        throw new CommandExecutionError('Mercury returned malformed create expense click result');
    }
    if (payload.blocked) {
        throw new CommandExecutionError('Mercury is already showing a submit/review surface; refusing to click a possible final Submit expense button');
    }
    return payload;
}

export async function assertCreateExpenseSurface(page) {
    const state = await page.evaluate(`(() => {
        const text = document.body?.innerText || '';
        return {
            url: location.href,
            title: document.title,
            hasFinalSubmit: /Submit expense/i.test(text) && /Review|receipt|amount|merchant|category|notes/i.test(text),
            hasForm: /receipt|amount|merchant|category|notes|expense date/i.test(text),
            bodyPreview: text.replace(/\\s+/g, ' ').trim().slice(0, 600)
        };
    })()`);
    const payload = assertBooleanFields(assertMercuryState(state, 'expense form state'), 'expense form state', ['hasFinalSubmit', 'hasForm']);
    if (payload.hasFinalSubmit && !payload.hasForm) {
        throw new CommandExecutionError('Mercury is showing a submit button without a recognizable expense form; refusing to click');
    }
    return payload;
}

export async function fillReimbursementFields(page, input) {
    const result = await page.evaluate(`(() => {
        const payload = ${JSON.stringify(input)};
        const setNativeValue = (el, value) => {
            const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            setter?.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
        };
        const visible = (nodes) => nodes.find((node) => {
            const style = window.getComputedStyle(node);
            return style.visibility !== 'hidden' && style.display !== 'none' && node.offsetParent !== null;
        });
        const allInputs = Array.from(document.querySelectorAll('input, textarea'));
        const bySelector = (selector) => visible(Array.from(document.querySelectorAll(selector)));
        const byTextNear = (label) => {
            const nodes = Array.from(document.querySelectorAll('label, div, span, p'));
            for (const node of nodes) {
                if (!label.test(node.innerText || node.textContent || '')) continue;
                const box = node.closest('label, fieldset, div');
                const field = box?.querySelector('input, textarea');
                if (field) return field;
            }
            return undefined;
        };
        const amount = bySelector('input[id^="amount"], input[name*="amount" i]') || byTextNear(/amount/i);
        const merchant = bySelector('input[id^="merchant"], input[name*="merchant" i]') || byTextNear(/merchant/i);
        const notes = visible(Array.from(document.querySelectorAll('textarea'))) || byTextNear(/notes|memo|purpose/i);
        const date =
            bySelector('input[type="date"], input[id*="date" i], input[name*="date" i]') ||
            byTextNear(/date|expense date/i) ||
            allInputs.find((field) => /yyyy|mm|dd|\\d{4}-\\d{2}-\\d{2}/i.test(field.getAttribute('placeholder') || ''));
        const currency =
            bySelector('input[id*="currency" i], input[name*="currency" i]') ||
            byTextNear(/currency/i) ||
            allInputs.find((field) => /currency/i.test(field.getAttribute('aria-label') || ''));
        const category =
            bySelector('input[id*="category" i], input[name*="category" i]') ||
            byTextNear(/category/i) ||
            allInputs.find((field) =>
                /category|select/i.test(\`\${field.getAttribute('placeholder') || ''} \${field.getAttribute('aria-label') || ''}\`)
            );

        const touched = {};
        if (amount) { setNativeValue(amount, payload.amount); touched.amount = true; }
        if (currency) { setNativeValue(currency, payload.currency); touched.currency = true; }
        if (date) { setNativeValue(date, payload.date); touched.date = true; }
        if (merchant) { setNativeValue(merchant, payload.merchant); touched.merchant = true; }
        if (notes) { setNativeValue(notes, payload.notes); touched.notes = true; }
        if (category) {
            category.focus();
            setNativeValue(category, payload.category);
            category.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            category.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
            touched.category = true;
        }
        return { touched };
    })()`);
    const payload = assertObject(result, 'field fill result');
    if (!payload.touched || typeof payload.touched !== 'object' || Array.isArray(payload.touched)) {
        throw new CommandExecutionError('Mercury returned malformed field fill result');
    }
    return payload;
}

export async function reviewSnapshot(page) {
    const snapshot = await page.evaluate(`(() => {
        const text = document.body?.innerText || '';
        return {
            url: location.href,
            title: document.title,
            hasReview: /Review/i.test(text),
            hasSubmitExpenseButton: /Submit expense/i.test(text),
            bodyPreview: text.replace(/\\s+/g, ' ').trim().slice(0, 1200)
        };
    })()`);
    return assertBooleanFields(assertMercuryState(snapshot, 'review state'), 'review state', ['hasReview', 'hasSubmitExpenseButton']);
}

export function assertLoggedIn(state) {
    if (!state.loggedIn) {
        throw new AuthRequiredError('app.mercury.com', 'Mercury reimbursements require a logged-in browser session');
    }
}
