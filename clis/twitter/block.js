import { CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'twitter',
    name: 'block',
    access: 'write',
    description: 'Block a Twitter user',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'username', type: 'string', positional: true, required: true, help: 'Twitter screen name (without @)' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter block');
        const username = kwargs.username.replace(/^@/, '');
        await page.goto(`https://x.com/${username}`);
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const result = await page.evaluate(`(async () => {
        let writeStarted = false;
        try {
            let attempts = 0;
            const getPrimary = () => document.querySelector('[data-testid="primaryColumn"]');
            const isBlockMenuItem = (item) => {
                const text = String(item.textContent || '');
                const lower = text.toLowerCase();
                const isUnblockText = lower.includes('unblock') || text.includes('取消屏蔽') || text.includes('解除屏蔽');
                const isBlockText = (lower.includes('block') || text.includes('屏蔽')) && !isUnblockText;
                return item.getAttribute('data-testid') === 'block' || isBlockText;
            };
            if (!getPrimary()) {
                return { ok: false, message: 'Could not find profile surface. Are you logged in?' };
            }

            // Check if already blocked (profile shows "Blocked" / unblock button)
            while (attempts < 20) {
                const primary = getPrimary();
                if (!primary) {
                    return { ok: false, message: 'Could not find profile surface. Are you logged in?' };
                }
                const blockedIndicator = primary.querySelector('[data-testid$="-unblock"]');
                if (blockedIndicator) {
                    return { ok: true, message: 'Already blocking @${username}.' };
                }

                const moreBtn = primary.querySelector('[data-testid="userActions"]');
                if (moreBtn) break;

                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            const primary = getPrimary();
            const moreBtn = primary?.querySelector('[data-testid="userActions"]');
            if (!moreBtn) {
                return { ok: false, message: 'Could not find user actions menu. Are you logged in?' };
            }

            // Open the more actions menu
            moreBtn.click();

            // Poll the requested action, not the first batch of menu rows.
            const findBlockItem = () => Array.from(document.querySelectorAll('[role="menuitem"]')).find(isBlockMenuItem);
            let blockItem = findBlockItem();
            for (let i = 0; i < 20 && !blockItem; i++) {
                await new Promise(r => setTimeout(r, 250));
                blockItem = findBlockItem();
            }

            if (!blockItem) {
                return { ok: false, message: 'Could not find Block option in menu.' };
            }

            blockItem.click();

            // Confirm the block in the dialog
            let confirmBtn = null;
            for (let i = 0; i < 20 && !confirmBtn; i++) {
                await new Promise(r => setTimeout(r, 250));
                confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
            }
            if (!confirmBtn) {
                return { ok: false, message: 'Block confirmation dialog did not appear.' };
            }
            writeStarted = true;
            confirmBtn.click();

            // Verify. Poll: the write has already been sent at this point, so a
            // too-early read reports it unconfirmed on a block that did land.
            let verify = null;
            for (let i = 0; i < 20 && !verify; i++) {
                await new Promise(r => setTimeout(r, 250));
                verify = getPrimary()?.querySelector('[data-testid$="-unblock"]');
            }
            if (verify) {
                return { ok: true, message: 'Successfully blocked @${username}.' };
            } else {
                return { ok: false, unconfirmed: true, message: 'Block action initiated but UI did not update.' };
            }
        } catch (e) {
            return { ok: false, unconfirmed: writeStarted, message: e.toString() };
        }
    })()`);
        if (result.unconfirmed) {
            throw new TimeoutError('twitter block confirmation', 1.5, `${result.message} Check the profile before retrying; the block may already have succeeded.`);
        }
        if (!result.ok) {
            throw new CommandExecutionError(result.message, 'Nothing changed. Open the profile in the browser and retry.');
        }
        await page.wait(2);
        return [{
                status: 'success',
                message: result.message
            }];
    }
});
