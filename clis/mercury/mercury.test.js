import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { normalizeReimbursementInput } from './utils.js';
import './check-login.js';
import './reimbursement-draft.js';
import './reimbursement-plan.js';

let tmpDir;
let receiptPath;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-mercury-test-'));
    receiptPath = path.join(tmpDir, 'receipt.png');
    fs.writeFileSync(receiptPath, 'receipt');
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function validArgs(overrides = {}) {
    return {
        receipt: receiptPath,
        amount: '140.00',
        currency: 'CNY',
        date: '2026-06-26',
        merchant: 'Example Merchant',
        category: 'Marketing & Advertising',
        notes: 'Example business purpose.',
        ...overrides,
    };
}

function createPageMock(evaluateResults, overrides = {}) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn()
            .mockImplementation(() => {
                if (!evaluateResults.length) throw new Error('unexpected evaluate call');
                return evaluateResults.shift();
            }),
        uploadFiles: vi.fn().mockResolvedValue({
            uploaded: true,
            files: 1,
            file_names: ['receipt.png'],
            target: '[data-testid="expense-attachment-upload"]',
            matches_n: 1,
            match_level: 'exact',
        }),
        setFileInput: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function loggedInState(overrides = {}) {
    return {
        url: 'https://app.mercury.com/expenses/my-expenses',
        loggedIn: true,
        hasSubmitExpense: true,
        hasReimbursements: true,
        title: 'Mercury',
        ...overrides,
    };
}

function createSurface(overrides = {}) {
    return {
        url: 'https://app.mercury.com/expenses/my-expenses',
        title: 'Mercury',
        hasFinalSubmit: false,
        hasForm: false,
        bodyPreview: 'My Expenses Submit expense',
        ...overrides,
    };
}

function clickResult(clicked = true) {
    return { clicked, blocked: false, text: clicked ? 'clicked' : '' };
}

function fillResult(touched = {}) {
    return {
        touched: {
            amount: true,
            currency: true,
            date: true,
            merchant: true,
            category: true,
            notes: true,
            ...touched,
        },
    };
}

function reviewState(overrides = {}) {
    return {
        url: 'https://app.mercury.com/expenses/review',
        title: 'Mercury',
        hasReview: true,
        hasSubmitExpenseButton: true,
        bodyPreview: 'Review Submit expense',
        ...overrides,
    };
}

describe('mercury reimbursement input validation', () => {
    it('normalizes valid input and keeps receipt absolute internally', () => {
        const input = normalizeReimbursementInput(validArgs());
        expect(input).toMatchObject({
            receipt: receiptPath,
            amount: '140.00',
            currency: 'CNY',
            date: '2026-06-26',
            merchant: 'Example Merchant',
            category: 'Marketing & Advertising',
            notes: 'Example business purpose.',
            ocrWaitSeconds: 8,
            closeAfterReview: false,
        });
    });

    it('rejects malformed local-only arguments before browser work', () => {
        expect(() => normalizeReimbursementInput(validArgs({ amount: '0' }))).toThrow(ArgumentError);
        expect(() => normalizeReimbursementInput(validArgs({ amount: '1.999' }))).toThrow(ArgumentError);
        expect(() => normalizeReimbursementInput(validArgs({ currency: 'US' }))).toThrow(ArgumentError);
        expect(() => normalizeReimbursementInput(validArgs({ date: '2026-02-30' }))).toThrow(ArgumentError);
        expect(() => normalizeReimbursementInput(validArgs({ 'ocr-wait-seconds': 'abc' }))).toThrow(ArgumentError);
        expect(() => normalizeReimbursementInput(validArgs({ receipt: path.join(tmpDir, 'missing.png') }))).toThrow(ArgumentError);
    });
});

describe('mercury reimbursement-plan', () => {
    it('validates locally and returns a deterministic basename-only plan', async () => {
        const command = getRegistry().get('mercury/reimbursement-plan');
        const rows = await command.func(validArgs());
        expect(rows).toEqual([expect.objectContaining({
            status: 'ready',
            receipt: 'receipt.png',
            amount: '140.00',
            currency: 'CNY',
            safety: expect.stringContaining('never clicks final Submit expense'),
        })]);
    });
});

describe('mercury reimbursement-draft', () => {
    const command = getRegistry().get('mercury/reimbursement-draft');

    it('throws AuthRequiredError instead of returning a fake draft when logged out', async () => {
        const page = createPageMock([loggedInState({ loggedIn: false, url: 'https://app.mercury.com/login' })]);
        await expect(command.func(page, validArgs())).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.uploadFiles).not.toHaveBeenCalled();
    });

    it('typed-fails malformed login state payloads', async () => {
        const page = createPageMock([{ url: 'https://app.mercury.com/expenses/my-expenses', title: 'Mercury' }]);
        await expect(command.func(page, validArgs())).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.uploadFiles).not.toHaveBeenCalled();
    });

    it('refuses to click when an existing review/submit surface is already open', async () => {
        const page = createPageMock([
            loggedInState(),
            createSurface({ hasFinalSubmit: true, hasForm: true, bodyPreview: 'Review Submit expense amount merchant' }),
        ]);
        await expect(command.func(page, validArgs())).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.uploadFiles).not.toHaveBeenCalled();
    });

    it('typed-fails if the create click probe sees a submit/review surface', async () => {
        const page = createPageMock([
            loggedInState(),
            createSurface(),
            { clicked: false, blocked: true, text: 'Submit expense' },
        ]);
        await expect(command.func(page, validArgs())).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.uploadFiles).not.toHaveBeenCalled();
    });

    it('typed-fails malformed create expense surface payloads', async () => {
        const page = createPageMock([
            loggedInState(),
            { url: 'https://app.mercury.com/expenses/my-expenses', title: 'Mercury', hasForm: false },
        ]);
        await expect(command.func(page, validArgs())).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.uploadFiles).not.toHaveBeenCalled();
    });

    it('typed-fails upload confirmation drift', async () => {
        const page = createPageMock([
            loggedInState(),
            createSurface(),
            clickResult(true),
        ], {
            uploadFiles: vi.fn().mockResolvedValue({ uploaded: false, files: 0 }),
        });
        await expect(command.func(page, validArgs())).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('typed-fails upload confirmation for the wrong file name', async () => {
        const page = createPageMock([
            loggedInState(),
            createSurface(),
            clickResult(true),
        ], {
            uploadFiles: vi.fn().mockResolvedValue({ uploaded: true, files: 1, file_names: ['other.png'] }),
        });
        await expect(command.func(page, validArgs())).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('typed-fails upload confirmation for the wrong input target', async () => {
        const page = createPageMock([
            loggedInState(),
            createSurface(),
            clickResult(true),
        ], {
            uploadFiles: vi.fn().mockResolvedValue({
                uploaded: true,
                files: 1,
                file_names: ['receipt.png'],
                target: '[data-testid="wrong"]',
                matches_n: 1,
            }),
        });
        await expect(command.func(page, validArgs())).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('typed-fails missed required field selectors before Review', async () => {
        const page = createPageMock([
            loggedInState(),
            createSurface(),
            clickResult(true),
            fillResult({ merchant: false }),
        ]);
        await expect(command.func(page, validArgs())).rejects.toThrow(/merchant/);
    });

    it('typed-fails if Mercury does not reach Review with final submit visible', async () => {
        const page = createPageMock([
            loggedInState(),
            createSurface(),
            clickResult(true),
            fillResult(),
            clickResult(true),
            reviewState({ hasReview: false, hasSubmitExpenseButton: false }),
        ]);
        await expect(command.func(page, validArgs())).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('typed-fails malformed review payloads', async () => {
        const page = createPageMock([
            loggedInState(),
            createSurface(),
            clickResult(true),
            fillResult(),
            clickResult(true),
            { url: 'https://app.mercury.com/expenses/review', title: 'Mercury', hasReview: true },
        ]);
        await expect(command.func(page, validArgs())).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('returns review-ready summary without clicking final Submit expense', async () => {
        const page = createPageMock([
            loggedInState(),
            createSurface(),
            clickResult(true),
            fillResult(),
            clickResult(true),
            reviewState(),
        ]);
        const rows = await command.func(page, validArgs());
        expect(rows).toEqual([expect.objectContaining({
            status: 'review_ready',
            receipt: 'receipt.png',
            uploaded: true,
            reviewReady: true,
            submitBlocked: true,
            warnings: 'final Submit expense was intentionally not clicked',
        })]);
        expect(page.uploadFiles).toHaveBeenCalledWith('[data-testid="expense-attachment-upload"]', [receiptPath]);
        expect(page.evaluate).toHaveBeenCalledTimes(6);
    });
});
