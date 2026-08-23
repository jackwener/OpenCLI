export const INSTAGRAM_HOME_URL = 'https://www.instagram.com/';

export async function gotoInstagramHome(page, forceReload = false) {
    if (forceReload) {
        await page.goto(`${INSTAGRAM_HOME_URL}?__opencli_reset=${Date.now()}`);
        await page.wait({ time: 1 });
    }
    await page.goto(INSTAGRAM_HOME_URL);
}
