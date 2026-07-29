import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

const NEW_STORY_URL = 'https://medium.com/new-story';

async function verifyMediumIdentity(page) {
    await page.goto(NEW_STORY_URL);
    await page.wait({ time: 1 });

    const result = await page.evaluate(`(() => {
        const editor = document.querySelector('[role="textbox"][contenteditable="true"]');
        const avatar = document.querySelector('.js-userActions img[alt], button[aria-haspopup="true"] img[alt]');
        return {
            url: location.href,
            hasEditor: !!editor,
            username: String(avatar?.getAttribute('alt') || '').trim(),
        };
    })()`);

    if (!result?.hasEditor || !String(result.url || '').includes('medium.com/new-story')) {
        throw new AuthRequiredError('medium.com', 'Medium editor requires an authenticated session');
    }
    if (!result.username) {
        throw new CommandExecutionError('Medium editor loaded but the account identity could not be determined');
    }
    return { username: result.username };
}

registerSiteAuthCommands({
    site: 'medium',
    domain: 'medium.com',
    loginUrl: 'https://medium.com/signin',
    columns: ['username'],
    verify: verifyMediumIdentity,
    poll: verifyMediumIdentity,
});
