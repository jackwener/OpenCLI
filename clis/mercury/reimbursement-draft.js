import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    MERCURY_EXPENSES_URL,
    RECEIPT_INPUT_SELECTOR,
    assertCreateExpenseSurface,
    clickCreateExpenseButton,
    assertLoggedIn,
    fillReimbursementFields,
    inspectMercury,
    normalizeReimbursementInput,
    receiptBasename,
    reviewSnapshot,
} from './utils.js';

cli({
    site: 'mercury',
    name: 'reimbursement-draft',
    description: 'Create a Mercury reimbursement draft from a local receipt, correct OCR fields, and stop at Review',
    access: 'write',
    example: 'opencli --profile <profile> mercury reimbursement-draft --receipt /tmp/receipt.png --amount 140.00 --currency CNY --date 2026-06-26 --merchant "Example Merchant" --category "Marketing & Advertising" --notes "Example business purpose." -f json',
    domain: 'app.mercury.com',
    strategy: Strategy.UI,
    browser: true,
    siteSession: 'persistent',
    defaultWindowMode: 'foreground',
    navigateBefore: false,
    args: [
        { name: 'receipt', required: true, help: 'Local receipt/proof file path' },
        { name: 'amount', required: true, help: 'Original-currency amount, e.g. 140.00' },
        { name: 'currency', default: 'CNY', help: 'Original currency code' },
        { name: 'date', required: true, help: 'Expense date as YYYY-MM-DD' },
        { name: 'merchant', required: true, help: 'Merchant shown on the reimbursement' },
        { name: 'category', default: 'Marketing & Advertising', help: 'Mercury expense category' },
        { name: 'notes', required: true, help: 'Business purpose / reimbursement notes' },
        { name: 'ocr-wait-seconds', default: '8', help: 'Seconds to wait after receipt upload before correcting OCR-overwritten fields' },
        { name: 'close-after-review', type: 'boolean', default: false, help: 'Close the Review dialog after verification; final Submit is still never clicked' },
    ],
    columns: ['status', 'url', 'receipt', 'uploaded', 'fieldsTouched', 'reviewReady', 'submitBlocked', 'warnings'],
    func: async (page, kwargs) => {
        const input = normalizeReimbursementInput(kwargs);
        const before = await inspectMercury(page);
        assertLoggedIn(before);

        await page.goto(MERCURY_EXPENSES_URL, { waitUntil: 'load', settleMs: 1500 });
        await page.wait({ time: 1 });
        const createSurface = await assertCreateExpenseSurface(page);
        if (createSurface.hasFinalSubmit && /review/i.test(createSurface.bodyPreview || '')) {
            throw new CommandExecutionError('Mercury appears to have an existing expense review open; refusing to click a possible final Submit expense button');
        }

        const opened = await clickCreateExpenseButton(page);
        if (!opened.clicked) {
            throw new CommandExecutionError('Could not find the Mercury Submit expense or New expense button');
        }

        await page.wait({ time: 2 });

        if (!page.uploadFiles) {
            throw new CommandExecutionError('Mercury reimbursement-draft requires Browser Bridge uploadFiles support to verify the intended receipt input');
        }
        const upload = await page.uploadFiles(RECEIPT_INPUT_SELECTOR, [input.receipt]);
        if (!upload || upload.uploaded !== true || upload.files !== 1) {
            throw new CommandExecutionError('Mercury receipt upload did not confirm exactly one uploaded file');
        }
        if (upload.target !== RECEIPT_INPUT_SELECTOR || upload.matches_n !== 1) {
            throw new CommandExecutionError('Mercury receipt upload did not confirm the intended receipt input');
        }
        const uploadedNames = Array.isArray(upload.file_names) ? upload.file_names : [];
        if (!uploadedNames.includes(receiptBasename(input.receipt))) {
            throw new CommandExecutionError('Mercury receipt upload did not confirm the expected receipt file');
        }

        if (input.ocrWaitSeconds > 0) await page.wait({ time: input.ocrWaitSeconds });

        const fields = await fillReimbursementFields(page, input);
        await page.wait({ time: 1 });
        const expectedFields = ['amount', 'currency', 'date', 'merchant', 'category', 'notes'];
        const missing = expectedFields.filter((key) => !fields.touched[key]);
        if (missing.length > 0) {
            throw new CommandExecutionError(`Mercury reimbursement form fields were not all filled: ${missing.join(', ')}`);
        }

        const reviewClick = await page.evaluate(`(() => {
            const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
            const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"]'))
              .filter((node) => {
                const style = window.getComputedStyle(node);
                return style.visibility !== 'hidden' && style.display !== 'none' && node.offsetParent !== null;
              });
            const el = candidates.find((node) => norm(node.innerText || node.textContent || '') === 'review');
            if (!el) return { clicked: false };
            el.click();
            return { clicked: true, text: el.innerText || el.textContent || '' };
        })()`);
        if (!reviewClick || typeof reviewClick !== 'object' || typeof reviewClick.clicked !== 'boolean') {
            throw new CommandExecutionError('Mercury returned malformed Review click result');
        }
        if (!reviewClick.clicked) {
            throw new CommandExecutionError('Mercury Review button was not clicked; inspect the page for validation errors');
        }
        await page.wait({ time: 2 });
        const review = await reviewSnapshot(page);
        if (!review.hasReview || !review.hasSubmitExpenseButton) {
            throw new CommandExecutionError('Mercury did not reach the Review step with the final Submit expense button visible');
        }

        if (input.closeAfterReview) {
            await page.evaluate(`(() => {
                const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
                const el = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"]'))
                  .find((node) => norm(node.innerText || node.textContent || '') === 'close');
                el?.click();
                return { clicked: Boolean(el) };
            })()`);
            await page.wait({ time: 1 });
        }

        return [{
            status: 'review_ready',
            url: review.url,
            receipt: receiptBasename(input.receipt),
            uploaded: true,
            fieldsTouched: JSON.stringify(fields.touched),
            reviewReady: true,
            submitBlocked: true,
            warnings: 'final Submit expense was intentionally not clicked',
        }];
    },
});
