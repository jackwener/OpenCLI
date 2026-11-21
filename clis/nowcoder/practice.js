import { cli } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

const CAREER_TABS_URL = 'https://gw-c.nowcoder.com/api/sparta/question-tab/query-all-tab-list';
const PRACTICE_URL = 'https://gw-c.nowcoder.com/api/sparta/intelligent/getPCIntelligentList';

function positiveInteger(value, label) {
    const text = String(value ?? '').trim();
    if (!/^[1-9]\d*$/.test(text)) {
        throw new ArgumentError(`nowcoder practice ${label} must be a positive integer`);
    }
    const number = Number(text);
    if (!Number.isSafeInteger(number)) {
        throw new ArgumentError(`nowcoder practice ${label} is too large`);
    }
    return number;
}

function validateArgs(args) {
    positiveInteger(args.job ?? '11226', '--job');
    positiveInteger(args.limit ?? 20, '--limit');
}

async function fetchEnvelope(page, url, label) {
    let payload;
    try {
        payload = await page.fetchJson(url);
    } catch (error) {
        throw new CommandExecutionError(`${label} failed: ${error?.message || error}`);
    }
    if (!payload || typeof payload.success !== 'boolean' || !Number.isSafeInteger(payload.code)) {
        throw new CommandExecutionError(`${label} returned a malformed envelope`);
    }
    if (!payload.success || payload.code !== 0) {
        throw new CommandExecutionError(`${label} failed: ${payload.msg || 'unknown error'} (${payload.code})`);
    }
    return payload.data;
}

cli({
    site: 'nowcoder',
    name: 'practice',
    access: 'read',
    description: 'Categorized practice questions with progress',
    domain: 'www.nowcoder.com',
    args: [
        { name: 'job', type: 'str', default: '11226', help: 'Career ID (11226=Software, 11227=Hardware, 11229=Product, 11230=Finance)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of items' },
    ],
    columns: ['category', 'tag_id', 'id', 'subject', 'total', 'done', 'remaining'],
    validateArgs,
    navigateBefore: false,
    func: async (page, args) => {
        const careerJobId = positiveInteger(args.job ?? 11226, '--job');
        const limit = positiveInteger(args.limit ?? 20, '--limit');

        try {
            await page.goto('https://www.nowcoder.com');
        } catch (error) {
            throw new CommandExecutionError(`Nowcoder practice navigation failed: ${error?.message || error}`);
        }

        const tabs = await fetchEnvelope(page, CAREER_TABS_URL, 'Nowcoder career list request');
        if (!Array.isArray(tabs)) {
            throw new CommandExecutionError('Nowcoder career list request returned malformed data');
        }
        const career = tabs.find((tab) => Number(tab?.careerJobId) === careerJobId);
        if (!career) {
            throw new ArgumentError(
                `nowcoder practice has no question-job mapping for career ID ${careerJobId}; try 11226, 11227, 11229, or 11230`,
            );
        }
        const questionJobId = positiveInteger(career.questionJobId, 'question-job mapping');

        const url = new URL(PRACTICE_URL);
        url.searchParams.set('questionJobId', String(questionJobId));
        url.searchParams.set('isMember', 'false');
        const data = await fetchEnvelope(page, url.toString(), 'Nowcoder practice request');
        if (!data || !Array.isArray(data.tags)) {
            throw new CommandExecutionError('Nowcoder practice request returned malformed data');
        }

        const all = [];
        for (const tag of data.tags) {
            for (const item of (Array.isArray(tag?.items) ? tag.items : [])) {
                all.push({
                    category: tag.title || 'recommended',
                    tag_id: String(tag.tagId ?? ''),
                    id: String(item.id ?? ''),
                    subject: item.title || '',
                    total: item.tcount || 0,
                    done: item.rcount || 0,
                    remaining: item.leftCount || 0,
                });
            }
        }
        return all.slice(0, limit);
    },
});
