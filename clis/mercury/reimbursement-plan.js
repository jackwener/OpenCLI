import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeReimbursementInput, receiptBasename } from './utils.js';

cli({
    site: 'mercury',
    name: 'reimbursement-plan',
    description: 'Validate Mercury reimbursement inputs and print the draft plan without opening a browser',
    access: 'read',
    example: 'opencli mercury reimbursement-plan --receipt /tmp/receipt.png --amount 140.00 --currency CNY --date 2026-06-26 --merchant "Example Merchant" --category "Marketing & Advertising" --notes "Example business purpose." -f json',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'receipt', required: true, help: 'Local receipt/proof file path' },
        { name: 'amount', required: true, help: 'Original-currency amount, e.g. 140.00' },
        { name: 'currency', default: 'CNY', help: 'Original currency code' },
        { name: 'date', required: true, help: 'Expense date as YYYY-MM-DD' },
        { name: 'merchant', required: true, help: 'Merchant shown on the reimbursement' },
        { name: 'category', default: 'Marketing & Advertising', help: 'Mercury expense category' },
        { name: 'notes', required: true, help: 'Business purpose / reimbursement notes' },
        { name: 'ocr-wait-seconds', default: '8', help: 'Seconds the draft command waits after receipt upload before correcting OCR fields' },
        { name: 'close-after-review', type: 'boolean', default: false, help: 'For draft command: close the Review dialog after verification' },
    ],
    columns: ['status', 'receipt', 'amount', 'currency', 'date', 'merchant', 'category', 'notes', 'safety'],
    func: async (kwargs) => {
        const input = normalizeReimbursementInput(kwargs);
        return [{
            status: 'ready',
            receipt: receiptBasename(input.receipt),
            amount: input.amount,
            currency: input.currency,
            date: input.date,
            merchant: input.merchant,
            category: input.category,
            notes: input.notes,
            safety: 'reimbursement-draft stops at Mercury Review and never clicks final Submit expense',
        }];
    },
});
