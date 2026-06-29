import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    MERCURY_EXPENSES_URL,
    RECEIPT_INPUT_SELECTOR,
    clickText,
    fillReimbursementFields,
    inspectMercury,
    normalizeReimbursementInput,
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
        if (!before.loggedIn) {
            return [{
                status: 'needs_login',
                url: before.url,
                receipt: input.receipt,
                uploaded: false,
                fieldsTouched: '',
                reviewReady: false,
                submitBlocked: true,
                warnings: 'Mercury redirected to login. Log in with the selected browser profile, then rerun.',
            }];
        }

        if (!before.hasSubmitExpense) {
            await page.goto(MERCURY_EXPENSES_URL, { waitUntil: 'load', settleMs: 1500 });
            await page.wait({ time: 1 });
        }

        const opened = await clickText(page, ['Submit expense', 'New expense']);
        if (!opened.clicked) {
            return [{
                status: 'blocked',
                url: before.url,
                receipt: input.receipt,
                uploaded: false,
                fieldsTouched: '',
                reviewReady: false,
                submitBlocked: true,
                warnings: 'Could not find the Mercury Submit expense button/link.',
            }];
        }

        await page.wait({ time: 2 });

        let uploaded = false;
        const uploadWarnings = [];
        try {
            if (page.setFileInput) {
                await page.setFileInput([input.receipt], RECEIPT_INPUT_SELECTOR);
            }
            else if (page.uploadFiles) {
                await page.uploadFiles(RECEIPT_INPUT_SELECTOR, [input.receipt]);
            }
            else {
                throw new Error('OpenCLI page object does not expose file upload support');
            }
            uploaded = true;
        }
        catch (error) {
            uploadWarnings.push(`upload failed: ${error instanceof Error ? error.message : String(error)}`);
        }

        if (input.ocrWaitSeconds > 0) await page.wait({ time: input.ocrWaitSeconds });

        const fields = await fillReimbursementFields(page, input);
        await page.wait({ time: 1 });

        const reviewClick = await clickText(page, ['Review']);
        await page.wait({ time: 2 });
        const review = await reviewSnapshot(page);

        if (input.closeAfterReview) {
            await clickText(page, ['Close']);
            await page.wait({ time: 1 });
        }

        const expectedFields = ['amount', 'currency', 'date', 'merchant', 'category', 'notes'];
        const missing = expectedFields.filter((key) => !fields.touched[key]);
        const warnings = [
            ...uploadWarnings,
            reviewClick.clicked ? '' : 'Review button was not clicked; inspect the page for validation errors.',
            missing.length > 0 ? `field selectors missed: ${missing.join(', ')}` : '',
            'final Submit expense was intentionally not clicked',
        ].filter(Boolean).join('; ');

        return [{
            status: review.hasSubmitExpenseButton ? 'review_ready' : 'draft_open',
            url: review.url,
            receipt: input.receipt,
            uploaded,
            fieldsTouched: JSON.stringify(fields.touched),
            reviewReady: review.hasSubmitExpenseButton,
            submitBlocked: true,
            warnings,
        }];
    },
});
