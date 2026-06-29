import fs from 'node:fs';
import path from 'node:path';
import { CommandExecutionError } from '@jackwener/opencli/errors';

export const MERCURY_EXPENSES_URL = 'https://app.mercury.com/expenses/my-expenses';
export const RECEIPT_INPUT_SELECTOR = '[data-testid="expense-attachment-upload"]';

export function requireString(kwargs, name) {
    const value = kwargs[name];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new CommandExecutionError(`Missing required argument: ${name}`);
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
        return ['1', 'true', 'yes', 'y', 'on'].includes(value.toLowerCase());
    }
    return fallback;
}

export function normalizeReimbursementInput(kwargs) {
    const receipt = path.resolve(requireString(kwargs, 'receipt'));
    const stat = fs.statSync(receipt, { throwIfNoEntry: false });
    if (!stat || !stat.isFile()) {
        throw new CommandExecutionError(`Receipt file does not exist: ${receipt}`);
    }

    const amount = requireString(kwargs, 'amount').replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
        throw new CommandExecutionError(`Amount must be a positive number with up to two decimals: ${amount}`);
    }

    const date = requireString(kwargs, 'date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new CommandExecutionError(`Date must be YYYY-MM-DD: ${date}`);
    }

    const ocrWaitSecondsRaw = optionalString(kwargs, 'ocr-wait-seconds', '8');
    const ocrWaitSeconds = Math.max(0, Number(ocrWaitSecondsRaw) || 0);

    return {
        receipt,
        amount,
        currency: optionalString(kwargs, 'currency', 'CNY').toUpperCase(),
        date,
        merchant: requireString(kwargs, 'merchant'),
        category: optionalString(kwargs, 'category', 'Marketing & Advertising'),
        notes: requireString(kwargs, 'notes'),
        ocrWaitSeconds,
        closeAfterReview: optionalBoolean(kwargs, 'close-after-review', false),
    };
}

export async function inspectMercury(page) {
    await page.goto(MERCURY_EXPENSES_URL, { waitUntil: 'load', settleMs: 1500 });
    await page.wait({ time: 1 });

    return page.evaluate(`(() => {
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
}

export async function clickText(page, labels) {
    return page.evaluate(`(() => {
        const labels = ${JSON.stringify(labels)};
        const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const wanted = labels.map(norm);
        const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"]'));
        const el = candidates.find((node) => wanted.includes(norm(node.innerText || node.textContent || '')));
        if (!el) return { clicked: false, labels };
        el.click();
        return { clicked: true, text: el.innerText || el.textContent || '' };
    })()`);
}

export async function fillReimbursementFields(page, input) {
    return page.evaluate(`(() => {
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
}

export async function reviewSnapshot(page) {
    return page.evaluate(`(() => {
        const text = document.body?.innerText || '';
        return {
            url: location.href,
            hasReview: /Review|Submit expense/i.test(text),
            hasSubmitExpenseButton: /Submit expense/i.test(text),
            bodyPreview: text.replace(/\\s+/g, ' ').trim().slice(0, 1200)
        };
    })()`);
}
