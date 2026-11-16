import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

// Explicit capability guard, not a fabricated feed. No verified web nearby
// source was found. The App backend is deliberately outside this Web-only build.
export const command = cli({
    site: 'douyin', name: 'nearby', access: 'read',
    description: '能力检查：当前未验证抖音 Web 附近数据源；明确报不可用，不冒充附近结果',
    domain: 'www.douyin.com', strategy: Strategy.LOCAL, browser: false,
    args: [], columns: [],
    func: async () => {
        throw new CommandExecutionError(
            'Douyin nearby is unavailable in this Web-only build: no nearby data source has been verified.',
            'Keyword search is not nearby content. A real web nearby source must be observed and replayed before this capability can be enabled.',
        );
    },
});
