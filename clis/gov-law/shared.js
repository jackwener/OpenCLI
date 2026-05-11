import { CliError } from '@jackwener/opencli/errors';

export async function navigateViaVueRouter(page, query) {
    await page.goto('https://flk.npc.gov.cn/index.html');
    await page.wait(4);

    const routerAvailable = await page.evaluate(`
      (async () => {
        const app = document.querySelector('#app');
        const router = app?.__vue_app__?.config?.globalProperties?.$router;
        if (!router) return false;
        await router.push({ path: '/search', query: ${JSON.stringify(query)} });
        return true;
      })()
    `);

    if (!routerAvailable) {
        throw new CliError(
            'FRAMEWORK_CHANGED',
            'Could not access Vue Router on flk.npc.gov.cn — the site may have been restructured.',
            'Please report this issue so the adapter can be updated.',
        );
    }

    await page.wait(5);
}

export async function extractLawResults(page, limit) {
    const data = await page.evaluate(`
      (async () => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        for (let i = 0; i < 40; i++) {
          if (document.querySelectorAll('.result-item').length > 0) break;
          await new Promise(r => setTimeout(r, 500));
        }
        const results = [];
        for (const el of document.querySelectorAll('.result-item')) {
          const title = normalize(el.querySelector('.title-content')?.textContent);
          if (!title) continue;
          const status = normalize(el.querySelector('[class*="status"]')?.textContent);
          const publish_date = normalize(el.querySelector('.publish-time')?.textContent).replace(/^公布日期[：:]\\s*/, '');
          const type = normalize(el.querySelector('.type')?.textContent);
          const department = normalize(el.querySelector('.department')?.textContent);
          results.push({ rank: results.length + 1, title, status, publish_date, type, department });
          if (results.length >= ${limit}) break;
        }
        return results;
      })()
    `);
    return Array.isArray(data) ? data : [];
}
