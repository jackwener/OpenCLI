import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './search.js';
import './app.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('flathub search adapter', () => {
    const cmd = getRegistry().get('flathub/search');

    it('round-trips appId into flathub.org URL and normalises updated_at unix-seconds to ISO', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            hits: [{
                app_id: 'org.mozilla.firefox', name: 'Firefox', summary: 'Web browser',
                developer_name: 'Mozilla', project_license: 'MPL-2.0', is_free_license: true,
                main_categories: 'network', installs_last_month: 100000,
                updated_at: 1730000000,
            }],
        }), { status: 200 })));
        const rows = await cmd.func({ query: 'firefox', limit: 5 });
        expect(rows[0]).toMatchObject({
            rank: 1, appId: 'org.mozilla.firefox', name: 'Firefox',
            license: 'MPL-2.0', isFreeLicense: true, mainCategories: 'network',
            installsLastMonth: 100000, updatedAt: '2024-10-27',
            url: 'https://flathub.org/apps/org.mozilla.firefox',
        });
    });
});
